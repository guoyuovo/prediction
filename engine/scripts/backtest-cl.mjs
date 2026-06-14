#!/usr/bin/env node
// 欧冠 2024-25 双模型回测（加权 vs 集成）。赛果 openfootball；俱乐部 Elo clubelo（快照缓存，无泄漏）。
// CL 无免费历史赔率 → 命中率/校准/盈亏平衡赔率。用法：node scripts/backtest-cl.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictWeighted, predictEnsemble, metricsOf } from '../src/backtest-models.mjs';

const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc|cp|ssc|as|ofk|gnk|nk|bsc|vfb|vfl|rb|fk|sk)\b/g, '').replace(/[^a-z]/g, '');
const ALIAS = { 'Sporting Clube de Portugal': 'Sporting CP', 'Lille OSC': 'Lille', 'FC Bayern München': 'Bayern', 'FK Shakhtar Donetsk': 'Shakhtar', 'FC Red Bull Salzburg': 'Salzburg', 'Manchester City FC': 'Man City', 'FC Internazionale Milano': 'Inter', 'Paris Saint-Germain FC': 'Paris SG', 'Club Brugge KV': 'Brugge', 'Borussia Dortmund': 'Dortmund', 'ŠK Slovan Bratislava': 'Slovan', 'Feyenoord Rotterdam': 'Feyenoord', 'Bayer 04 Leverkusen': 'Leverkusen', 'Sport Lisboa e Benfica': 'Benfica', 'Stade Brestois 29': 'Brest', 'Atalanta BC': 'Atalanta', 'Club Atlético de Madrid': 'Atletico' };
const strip = (s) => s.replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();
const tkey = (t) => clubeloNorm(ALIAS[t] || strip(t));

const CSV = join(ROOT, 'data', 'cl-2024-25.txt');
if (!existsSync(CSV)) { console.error('✗ 缺少 data/cl-2024-25.txt'); process.exit(1); }
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const matches = []; let cur = null;
for (const raw of readFileSync(CSV, 'utf8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  const dm = line.match(/^\s*\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/);
  if (dm) { cur = `${dm[3]}-${String(MON[dm[1]] + 1).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}`; continue; }
  const mm = line.match(/^\s*(?:\d{1,2}:\d{2}\s+)?(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)/);
  if (mm && cur) matches.push({ date: cur, home: strip(mm[1]), away: strip(mm[2]), hs: +mm[3], as: +mm[4] });
}

const snap = existsSync(join(ROOT, 'data', 'clubelo-snapshots.json')) ? loadJson('data/clubelo-snapshots.json').snaps : {};
const snapDates = Object.keys(snap).sort();
function eloOn(key, d) { let best = null; for (const x of snapDates) if (x <= d && (!best || x > best)) best = x; if (!best) best = snapDates[0]; return best ? (snap[best]?.[key] ?? null) : null; }

const rowsW = [], rowsE = [];
for (const m of matches) {
  const eh = eloOn(tkey(m.home), m.date), ea = eloOn(tkey(m.away), m.date);
  if (eh == null || ea == null) continue;
  const actual = m.hs > m.as ? 'H' : m.hs < m.as ? 'A' : 'D'; const eloFav = eh >= ea ? 'H' : 'A';
  rowsW.push({ p: predictWeighted(eh, ea, true, null), actual, eloFav });
  rowsE.push({ p: predictEnsemble(eh, ea, true, null), actual, eloFav });
}
const out = {
  _note: '欧冠 2024-25 双模型回测（无免费赔率→盈亏平衡）。',
  meta: { competition: 'UEFA Champions League', season: '2024-25', matches: rowsW.length, hasOdds: false },
  weighted: metricsOf(rowsW), ensemble: metricsOf(rowsE),
};
writeFileSync(join(ROOT, 'data', 'backtest-cl.json'), JSON.stringify(out, null, 2), 'utf-8');
console.log(`欧冠回测 ${rowsW.length} 场：`);
console.log(`  加权 命中${(out.weighted.acc * 100).toFixed(1)}% 平衡赔率${out.weighted.breakeven?.toFixed(2)}`);
console.log(`  集成 命中${(out.ensemble.acc * 100).toFixed(1)}% 平衡赔率${out.ensemble.breakeven?.toFixed(2)}`);
console.log('✓ data/backtest-cl.json');
