#!/usr/bin/env node
// 双模型融合权重 网格搜索（防过拟合·时间切分）
//   综合 = α·多因子(主力) + (1-α)·xG(第二验证)
//   训练集=早赛季(21-22/22-23/23-24) 选 α*（最小化 logloss）；测试集=最新 24-25 验证泛化。
//   另输出综合模型的「置信度校准表」（最高概率分箱 → 实际命中率）用于定 高/中/低 阈值。
// 用法：node scripts/tune-dual.mjs
//   ⚠ 同 backtest：俱乐部 xG 模型泊松 λ 用 Elo 驱动，保守。

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictWeighted, predictXgValid, metricsOf } from '../src/backtest-models.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getText = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc)\b/g, '').replace(/[^a-z]/g, '');
const FALIAS = { "Nott'm Forest": 'Forest', 'Ath Madrid': 'Atletico', 'Ath Bilbao': 'Athletic', 'Vallecano': 'Rayo Vallecano', 'Espanol': 'Espanyol', 'Bayern Munich': 'Bayern', "M'gladbach": 'Gladbach', 'Ein Frankfurt': 'Frankfurt', 'Werder Bremen': 'Werder', 'FC Koln': 'Koln' };
const fKey = (t) => clubeloNorm(FALIAS[t] || t);
const SNAP_FILE = join(ROOT, 'data', 'clubelo-snapshots.json');
let snapCache = existsSync(SNAP_FILE) ? loadJson('data/clubelo-snapshots.json').snaps || {} : {};
function eloOn(key, ds) { let best = null; for (const d in snapCache) if (d <= ds && (!best || d > best)) best = d; if (!best) best = Object.keys(snapCache).sort()[0]; return best ? (snapCache[best]?.[key] ?? null) : null; }

// 收集所有比赛行：预存 A、B 概率向量（线性融合可任意 α 复算）
async function collect(league, code, label) {
  let csv; try { csv = await getText(`https://www.football-data.co.uk/mmz4281/${code}/${league}.csv`); } catch { return []; }
  const lines = csv.split('\n').filter(Boolean); const hdr = lines[0].split(','); const ix = (n) => hdr.indexOf(n);
  const C = { d: ix('Date'), h: ix('HomeTeam'), a: ix('AwayTeam'), r: ix('FTR'), bh: ix('B365H'), bd: ix('B365D'), ba: ix('B365A') };
  if (C.h < 0 || C.bh < 0) return [];
  const rows = [];
  for (const l of lines.slice(1)) {
    const c = l.split(','); if (!c[C.h] || !c[C.r] || !c[C.bh]) continue;
    const [dd, mm, yy] = c[C.d].split('/'); const yr = +yy < 100 ? 2000 + +yy : +yy;
    const ds = `${yr}-${String(+mm).padStart(2, '0')}-${String(+dd).padStart(2, '0')}`;
    const eh = eloOn(fKey(c[C.h]), ds), ea = eloOn(fKey(c[C.a]), ds);
    if (eh == null || ea == null) continue;
    const odds = [+c[C.bh], +c[C.bd], +c[C.ba]];
    rows.push({ pA: predictWeighted(eh, ea, true, odds), pB: predictXgValid(eh, ea, true, odds), actual: c[C.r], odds, eloFav: eh >= ea ? 'H' : 'A', season: label });
  }
  return rows;
}

const blend = (rows, a) => rows.map((m) => ({ p: [a * m.pA[0] + (1 - a) * m.pB[0], a * m.pA[1] + (1 - a) * m.pB[1], a * m.pA[2] + (1 - a) * m.pB[2]], actual: m.actual, odds: m.odds, eloFav: m.eloFav }));
const metAt = (rows, a) => metricsOf(blend(rows, a));

console.log('双模型融合权重 网格搜索（时间切分防过拟合）...');
console.log(`  clubelo 快照 ${Object.keys(snapCache).length} 个`);
const FB = [['E0', [['2122', '21-22'], ['2223', '22-23'], ['2324', '23-24'], ['2425', '24-25']]], ['SP1', [['2324', '23-24'], ['2425', '24-25']]], ['D1', [['2324', '23-24'], ['2425', '24-25']]], ['I1', [['2324', '23-24'], ['2425', '24-25']]], ['F1', [['2324', '23-24'], ['2425', '24-25']]]];
let all = [];
for (const [lg, seasons] of FB) for (const [code, label] of seasons) { const r = await collect(lg, code, label); all = all.concat(r); }
const TRAIN = all.filter((m) => m.season !== '24-25');
const TEST = all.filter((m) => m.season === '24-25');
console.log(`  总 ${all.length} 场 → 训练 ${TRAIN.length}（21-22~23-24） / 测试 ${TEST.length}（24-25）`);

// 网格 α 0..1 step 0.05，训练集按 logloss 选优
const grid = [];
for (let a = 0; a <= 1.0001; a += 0.05) { a = +a.toFixed(2); const tr = metAt(TRAIN, a); grid.push({ a, trainLogloss: tr.logloss, trainBrier: tr.brier, trainAcc: tr.acc }); }
const best = grid.reduce((b, g) => (g.trainLogloss < b.trainLogloss ? g : b), grid[0]);
const bestBrierG = grid.reduce((b, g) => (g.trainBrier < b.trainBrier ? g : b), grid[0]);

// 在测试集上比较：α*  vs  现用0.6  vs  纯主力1.0  vs  纯xG 0.0
const cmp = {};
for (const [k, a] of [['alphaStar', best.a], ['current_0.6', 0.6], ['pureMain_1.0', 1.0], ['pureXg_0.0', 0.0], ['brierStar', bestBrierG.a]]) {
  const m = metAt(TEST, a);
  cmp[k] = { alpha: a, acc: m.acc, brier: m.brier, logloss: m.logloss, flatROI: m.flat.roi, valueROI: m.value.roi };
}

// 置信度校准：综合(α*)在测试集上，最高概率分箱 → 实际命中率
const calibRows = blend(TEST, best.a);
const pick = (p) => { const m = Math.max(...p); return p[0] === m ? 'H' : (p[2] === m && p[2] >= p[1]) ? 'A' : (p[1] === m ? 'D' : 'A'); };
const bins = [[0, 0.40], [0.40, 0.45], [0.45, 0.50], [0.50, 0.55], [0.55, 0.65], [0.65, 1.01]];
const calib = bins.map(([lo, hi]) => {
  const sub = calibRows.filter((r) => { const mx = Math.max(...r.p); return mx >= lo && mx < hi; });
  const hit = sub.filter((r) => pick(r.p) === r.actual).length;
  return { range: `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`, n: sub.length, hitRate: sub.length ? +(hit / sub.length).toFixed(3) : null };
});

writeFileSync(join(ROOT, 'data', 'tune-dual.json'), JSON.stringify({
  _note: '双模型融合权重网格搜索（时间切分）。综合=α·主力+(1-α)·xG。训练21-22~23-24选α*，测试24-25验证。⚠俱乐部xG用Elo驱动泊松，保守。',
  builtAt: new Date().toISOString(), train: TRAIN.length, test: TEST.length,
  grid, alphaStar: best.a, brierStar: bestBrierG.a, testCompare: cmp, confidenceCalibration: calib,
}, null, 2), 'utf-8');

console.log(`\n训练集最优 α*（按 logloss）= ${best.a}（logloss ${best.trainLogloss.toFixed(4)}）；按 Brier 最优 = ${bestBrierG.a}`);
console.log('网格（训练 logloss）：' + grid.filter((g) => Math.round(g.a * 100) % 10 === 0).map((g) => `${g.a}:${g.trainLogloss.toFixed(4)}`).join('  '));
console.log(`\n测试集(24-25, ${TEST.length}场) 对比：`);
const row = (k, m) => `  ${k.padEnd(14)} α=${m.alpha.toFixed(2)} | 命中 ${(m.acc * 100).toFixed(1)}% · Brier ${m.brier.toFixed(4)} · logloss ${m.logloss.toFixed(4)} · 平注ROI ${(m.flatROI * 100).toFixed(1)}%`;
console.log(row('α* (训练选)', cmp.alphaStar));
console.log(row('现用 0.6', cmp['current_0.6']));
console.log(row('纯主力 1.0', cmp['pureMain_1.0']));
console.log(row('纯xG 0.0', cmp['pureXg_0.0']));
console.log('\n置信度校准（综合 α*，测试集，最高概率分箱→实际命中）：');
for (const c of calib) console.log(`  ${c.range.padEnd(10)} ${String(c.n).padStart(4)}场  命中 ${c.hitRate == null ? '—' : (c.hitRate * 100).toFixed(1) + '%'}`);
console.log('✓ 写入 data/tune-dual.json');
