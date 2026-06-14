#!/usr/bin/env node
// 英超 2024-25 双模型回测（加权 vs 集成），真实 B365 赔率 → 真实 ROI。
// 用法：node scripts/backtest-league.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictWeighted, predictEnsemble, metricsOf } from '../src/backtest-models.mjs';

const CSV = join(ROOT, 'data', 'epl-2024-25.csv');
const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc)\b/g, '').replace(/[^a-z]/g, '');
const ALIAS = { "Nott'm Forest": 'Forest' };
const tkey = (t) => clubeloNorm(ALIAS[t] || t);
if (!existsSync(CSV)) { console.error('✗ 缺少 data/epl-2024-25.csv'); process.exit(1); }
const lines = readFileSync(CSV, 'utf8').split('\n').filter(Boolean);
const hdr = lines[0].split(','); const ix = (n) => hdr.indexOf(n);
const C = { d: ix('Date'), h: ix('HomeTeam'), a: ix('AwayTeam'), r: ix('FTR'), bh: ix('B365H'), bd: ix('B365D'), ba: ix('B365A') };

const snap = existsSync(join(ROOT, 'data', 'clubelo-snapshots.json')) ? loadJson('data/clubelo-snapshots.json').snaps : {};
const snapDates = Object.keys(snap).sort();
function eloOn(key, d) { let best = null; for (const x of snapDates) if (x <= d && (!best || x > best)) best = x; if (!best) best = snapDates[0]; return best ? (snap[best]?.[key] ?? null) : null; }

const rowsW = [], rowsE = [];
for (const l of lines.slice(1)) {
  const c = l.split(','); if (!c[C.h] || !c[C.r] || !c[C.bh]) continue;
  const [dd, mm, yy] = c[C.d].split('/'); const yr = +yy < 100 ? 2000 + +yy : +yy;
  const ds = `${yr}-${String(+mm).padStart(2, '0')}-${String(+dd).padStart(2, '0')}`;
  const eh = eloOn(tkey(c[C.h]), ds), ea = eloOn(tkey(c[C.a]), ds);
  if (eh == null || ea == null) continue;
  const odds = [+c[C.bh], +c[C.bd], +c[C.ba]]; const actual = c[C.r]; const eloFav = eh >= ea ? 'H' : 'A';
  rowsW.push({ p: predictWeighted(eh, ea, true, odds), actual, odds, eloFav });
  rowsE.push({ p: predictEnsemble(eh, ea, true, odds), actual, odds, eloFav });
}
const out = {
  _note: '英超 2024-25 双模型回测，真实 B365 赔率结算 ROI。',
  meta: { competition: '英超 Premier League', season: '2024-25', matches: rowsW.length, hasOdds: true },
  weighted: metricsOf(rowsW), ensemble: metricsOf(rowsE),
};
writeFileSync(join(ROOT, 'data', 'backtest-epl.json'), JSON.stringify(out, null, 2), 'utf-8');
console.log(`英超回测 ${rowsW.length} 场：`);
console.log(`  加权 命中${(out.weighted.acc * 100).toFixed(1)}% 押主选ROI${(out.weighted.flat.roi * 100).toFixed(1)}% 价值ROI${(out.weighted.value.roi * 100).toFixed(1)}%`);
console.log(`  集成 命中${(out.ensemble.acc * 100).toFixed(1)}% 押主选ROI${(out.ensemble.flat.roi * 100).toFixed(1)}% 价值ROI${(out.ensemble.value.roi * 100).toFixed(1)}%`);
console.log('✓ data/backtest-epl.json');
