#!/usr/bin/env node
// 双模型共同推断 回测：在 5 大联赛多赛季真实比赛 + 真实 B365 赔率上，并排评测
//   ① 多因子（主力）predictWeighted   ② xG第二验证（单独）predictXgValid   ③ 综合 0.5A+0.5B predictDual
// 与 scripts/backtest-multi.mjs 同数据同口径，可直接对比。
//   ⚠ 俱乐部无 xG 攻防数据，xG 模型泊松 λ 用 Elo 驱动（保守低估真实 att/def 增益）。
// 用法：node scripts/backtest-dual.mjs

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictWeighted, predictXgValid, predictDual, metricsOf } from '../src/backtest-models.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getText = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc)\b/g, '').replace(/[^a-z]/g, '');
const FALIAS = {
  "Nott'm Forest": 'Forest', 'Ath Madrid': 'Atletico', 'Ath Bilbao': 'Athletic', 'Vallecano': 'Rayo Vallecano',
  'Espanol': 'Espanyol', 'Bayern Munich': 'Bayern', "M'gladbach": 'Gladbach', 'Ein Frankfurt': 'Frankfurt', 'Werder Bremen': 'Werder', 'FC Koln': 'Koln',
};
const fKey = (t) => clubeloNorm(FALIAS[t] || t);

const SNAP_FILE = join(ROOT, 'data', 'clubelo-snapshots.json');
let snapCache = existsSync(SNAP_FILE) ? loadJson('data/clubelo-snapshots.json').snaps || {} : {};
async function ensureSnapshots(dates) {
  let nf = 0;
  for (const d of dates) {
    if (snapCache[d]) continue;
    try { const t = await getText('http://api.clubelo.com/' + d); const map = {}; for (const l of t.split('\n').slice(1)) { const c = l.split(','); if (c[1] && c[4]) map[clubeloNorm(c[1])] = +c[4]; } if (Object.keys(map).length) { snapCache[d] = map; nf++; } } catch { /* */ }
  }
  if (nf) writeFileSync(SNAP_FILE, JSON.stringify({ _note: 'clubelo 历史 Elo 快照缓存', snaps: snapCache }), 'utf-8');
  return nf;
}
function biweekly(y0, m0, y1, m1) { const o = []; for (let y = y0; y <= y1; y++) for (let m = 1; m <= 12; m++) { if (y === y0 && m < m0) continue; if (y === y1 && m > m1) break; o.push(`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-15`); } return o; }
function eloOn(key, dateStr) { let best = null; for (const d in snapCache) if (d <= dateStr && (!best || d > best)) best = d; if (!best) best = Object.keys(snapCache).sort()[0]; return best ? (snapCache[best]?.[key] ?? null) : null; }

async function football(league, zh, code, label) {
  let csv; try { csv = await getText(`https://www.football-data.co.uk/mmz4281/${code}/${league}.csv`); } catch { return null; }
  const lines = csv.split('\n').filter(Boolean); const hdr = lines[0].split(','); const ix = (n) => hdr.indexOf(n);
  const C = { d: ix('Date'), h: ix('HomeTeam'), a: ix('AwayTeam'), r: ix('FTR'), bh: ix('B365H'), bd: ix('B365D'), ba: ix('B365A') };
  if (C.h < 0 || C.bh < 0) return null;
  const rW = [], rX = [], rD = [];
  for (const l of lines.slice(1)) {
    const c = l.split(','); if (!c[C.h] || !c[C.r] || !c[C.bh]) continue;
    const [dd, mm, yy] = c[C.d].split('/'); const yr = +yy < 100 ? 2000 + +yy : +yy;
    const ds = `${yr}-${String(+mm).padStart(2, '0')}-${String(+dd).padStart(2, '0')}`;
    const eh = eloOn(fKey(c[C.h]), ds), ea = eloOn(fKey(c[C.a]), ds);
    if (eh == null || ea == null) continue;
    const odds = [+c[C.bh], +c[C.bd], +c[C.ba]]; const actual = c[C.r]; const eloFav = eh >= ea ? 'H' : 'A';
    rW.push({ p: predictWeighted(eh, ea, true, odds), actual, odds, eloFav });
    rX.push({ p: predictXgValid(eh, ea, true, odds), actual, odds, eloFav });
    rD.push({ p: predictDual(eh, ea, true, odds), actual, odds, eloFav });
  }
  if (!rW.length) return null;
  return { id: `${zh} ${label}`, n: rW.length, weighted: metricsOf(rW), xg: metricsOf(rX), dual: metricsOf(rD) };
}

console.log('双模型共同推断 回测...');
const nf = await ensureSnapshots(biweekly(2021, 7, 2025, 6));
console.log(`  clubelo 快照 ${Object.keys(snapCache).length} 个（新增 ${nf}）`);
const results = [];
const FB = [['E0', '英超', [['2122', '21-22'], ['2223', '22-23'], ['2324', '23-24'], ['2425', '24-25']]], ['SP1', '西甲', [['2324', '23-24'], ['2425', '24-25']]], ['D1', '德甲', [['2324', '23-24'], ['2425', '24-25']]], ['I1', '意甲', [['2324', '23-24'], ['2425', '24-25']]], ['F1', '法甲', [['2324', '23-24'], ['2425', '24-25']]]];
for (const [lg, zh, seasons] of FB) for (const [code, label] of seasons) {
  const r = await football(lg, zh, code, label);
  if (r) { results.push(r); console.log(`  ${r.id}: ${r.n}场 | 主力 ${(r.weighted.acc * 100).toFixed(1)}%/ROI${(r.weighted.flat.roi * 100).toFixed(1)}% | xG ${(r.xg.acc * 100).toFixed(1)}%/ROI${(r.xg.flat.roi * 100).toFixed(1)}% | 综合 ${(r.dual.acc * 100).toFixed(1)}%/ROI${(r.dual.flat.roi * 100).toFixed(1)}%`); }
}

function agg(model) {
  const nAll = results.reduce((s, r) => s + r.n, 0);
  const accW = results.reduce((s, r) => s + r[model].acc * r.n, 0) / nAll;
  const brierW = results.reduce((s, r) => s + r[model].brier * r.n, 0) / nAll;
  const loglossW = results.reduce((s, r) => s + r[model].logloss * r.n, 0) / nAll;
  const flatBets = results.reduce((s, r) => s + r[model].flat.bets, 0);
  const flatProfit = results.reduce((s, r) => s + r[model].flat.roi * r[model].flat.bets, 0);
  const valBets = results.reduce((s, r) => s + r[model].value.bets, 0);
  const valProfit = results.reduce((s, r) => s + r[model].value.roi * r[model].value.bets, 0);
  return { matches: nAll, acc: accW, brier: brierW, logloss: loglossW, flatROI: flatBets ? flatProfit / flatBets : 0, valueROI: valBets ? valProfit / valBets : 0, valueBets: valBets };
}
const summary = { weighted: agg('weighted'), xg: agg('xg'), dual: agg('dual') };
writeFileSync(join(ROOT, 'data', 'backtest-dual.json'), JSON.stringify({
  _note: '双模型共同推断回测：主力(多因子) vs xG第二验证(单独) vs 综合(0.5A+0.5B)。5大联赛多赛季真实B365赔率。⚠俱乐部无xG攻防，xG模型泊松λ用Elo驱动（保守低估真实att/def增益）。',
  builtAt: new Date().toISOString(), results, summary,
}, null, 2), 'utf-8');

const row = (k, m) => `  ${k}  命中 ${(m.acc * 100).toFixed(1)}% · Brier ${m.brier.toFixed(3)} · logloss ${m.logloss.toFixed(3)} · 平注ROI ${(m.flatROI * 100).toFixed(1)}% · 价值ROI ${(m.valueROI * 100).toFixed(1)}%(${m.valueBets}注)`;
console.log(`\n汇总（${summary.weighted.matches} 场真实比赛 + 真实 B365 赔率）：`);
console.log(row('① 多因子(主力)  ', summary.weighted));
console.log(row('② xG(第二验证)  ', summary.xg));
console.log(row('③ 综合(0.5A+0.5B)', summary.dual));
console.log('✓ 写入 data/backtest-dual.json');
