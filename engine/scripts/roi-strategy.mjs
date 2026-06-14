// ROI 策略实验：在真实联赛+真实B365赔率上，逐注收集，做训练/测试split，
// 对比多种下注选择规则的真实 ROI，找样本外能改善 ROI 的规则（防过拟合）。
// 用法：node scripts/roi-strategy.mjs
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictWeighted, predictEnsemble } from '../src/backtest-models.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getText = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc)\b/g, '').replace(/[^a-z]/g, '');
const FALIAS = { "Nott'm Forest": 'Forest', 'Ath Madrid': 'Atletico', 'Ath Bilbao': 'Athletic', 'Vallecano': 'Rayo Vallecano', 'Espanol': 'Espanyol', 'Bayern Munich': 'Bayern', "M'gladbach": 'Gladbach', 'Ein Frankfurt': 'Frankfurt', 'Werder Bremen': 'Werder', 'FC Koln': 'Koln' };
const fKey = (t) => clubeloNorm(FALIAS[t] || t);
const snapCache = existsSync(join(ROOT, 'data', 'clubelo-snapshots.json')) ? loadJson('data/clubelo-snapshots.json').snaps || {} : {};
function eloOn(key, ds) { let best = null; for (const d in snapCache) if (d <= ds && (!best || d > best)) best = d; if (!best) best = Object.keys(snapCache).sort()[0]; return best ? (snapCache[best]?.[key] ?? null) : null; }
const demargin = (o) => { const a = 1 / o[0], b = 1 / o[1], c = 1 / o[2], m = a + b + c; return [a / m, b / m, c / m]; };

async function collect(league, code) {
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
    const odds = [+c[C.bh], +c[C.bd], +c[C.ba]]; if (!(odds[0] > 1 && odds[2] > 1)) continue;
    const pW = predictWeighted(eh, ea, true, odds), pE = predictEnsemble(eh, ea, true, odds);
    rows.push({ pW, pE, odds, imp: demargin(odds), actual: c[C.r] });
  }
  return rows;
}

const idx = { H: 0, D: 1, A: 2 };
const argmax = (p) => p[0] >= p[1] && p[0] >= p[2] ? 'H' : (p[2] >= p[1] ? 'A' : 'D');
// 单注收益（押 1 单位在 outcome 上）
function pnl(r, outcome) { const oi = idx[outcome]; return outcome === r.actual ? r.odds[oi] - 1 : -1; }

// 策略：给一行，返回要押的 outcome 或 null（不押）。model='pW'|'pE'
const STRATS = {
  '平注·全押argmax': (r, m) => argmax(r[m]),
  '价值(edge>0)': (r, m) => { const o = argmax(r[m]); return r[m][idx[o]] > r.imp[idx[o]] ? o : null; },
  '价值edge>5%': (r, m) => { const o = argmax(r[m]); return r[m][idx[o]] - r.imp[idx[o]] > 0.05 ? o : null; },
  '价值edge>10%': (r, m) => { const o = argmax(r[m]); return r[m][idx[o]] - r.imp[idx[o]] > 0.10 ? o : null; },
  '信心>50%': (r, m) => { const o = argmax(r[m]); return r[m][idx[o]] > 0.5 ? o : null; },
  '信心>60%': (r, m) => { const o = argmax(r[m]); return r[m][idx[o]] > 0.6 ? o : null; },
  '只押市场热门': (r, m) => { const o = argmax(r[m]); const fav = r.odds[0] <= r.odds[2] ? 'H' : 'A'; return o === fav ? o : null; },
  '避冷门(赔率<3)': (r, m) => { const o = argmax(r[m]); return r[m][idx[o]] && r.odds[idx[o]] < 3 ? o : null; },
  '只押客胜argmax': (r, m) => argmax(r[m]) === 'A' ? 'A' : null,
  '跟市场最低赔': (r) => r.odds[0] <= r.odds[1] && r.odds[0] <= r.odds[2] ? 'H' : (r.odds[2] <= r.odds[1] ? 'A' : 'D'),
};

function roiOf(rows, strat, m) {
  let bets = 0, profit = 0, wins = 0;
  for (const r of rows) { const o = strat(r, m); if (!o) continue; bets++; const p = pnl(r, o); profit += p; if (p > 0) wins++; }
  return { bets, roi: bets ? profit / bets : 0, win: bets ? wins / bets : 0 };
}

// 训练=24-25之前；测试=各联赛 24-25
const TRAIN = [['E0', '2122'], ['E0', '2223'], ['E0', '2324'], ['SP1', '2324'], ['D1', '2324'], ['I1', '2324'], ['F1', '2324']];
const TEST = [['E0', '2425'], ['SP1', '2425'], ['D1', '2425'], ['I1', '2425'], ['F1', '2425']];

console.log('抓取训练/测试数据...');
const train = [], test = [];
for (const [lg, c] of TRAIN) train.push(...await collect(lg, c));
for (const [lg, c] of TEST) test.push(...await collect(lg, c));
console.log(`训练 ${train.length} 场 · 测试 ${test.length} 场\n`);

for (const m of ['pW', 'pE']) {
  console.log(`===== ${m === 'pW' ? '加权模型' : '集成模型'} =====`);
  console.log('策略'.padEnd(20), '训练ROI  注数 | 测试ROI  注数');
  const ranked = [];
  for (const [name, strat] of Object.entries(STRATS)) {
    const tr = roiOf(train, strat, m), te = roiOf(test, strat, m);
    ranked.push({ name, tr, te });
    console.log(name.padEnd(20), (tr.roi * 100).toFixed(1).padStart(6), String(tr.bets).padStart(5), ' |', (te.roi * 100).toFixed(1).padStart(6), String(te.bets).padStart(5));
  }
  const bestTrain = ranked.filter(r => r.tr.bets > 50).sort((a, b) => b.tr.roi - a.tr.roi)[0];
  console.log(`→ 训练最优: 「${bestTrain.name}」 训练ROI ${(bestTrain.tr.roi*100).toFixed(1)}% → 样本外测试ROI ${(bestTrain.te.roi*100).toFixed(1)}%\n`);
}

// ── 客胜策略稳健性：分联赛拆解（测试集）──
console.log('\n===== 「只押客胜argmax」分联赛稳健性（加权模型，测试集24-25）=====');
const awayStrat = (r) => argmax(r.pW) === 'A' ? 'A' : null;
for (const [lg, c] of TEST) {
  const rows = await collect(lg, c);
  const s = roiOf(rows, awayStrat, 'pW');
  let sumOdds = 0, nb = 0;
  for (const r of rows) if (awayStrat(r)) { sumOdds += r.odds[2]; nb++; }
  console.log(`  ${lg} 24-25`.padEnd(14), `客胜注${String(s.bets).padStart(4)}  胜率${(s.win*100).toFixed(0)}%  均赔${(sumOdds/nb).toFixed(2)}  ROI ${(s.roi*100).toFixed(1)}%`);
}
