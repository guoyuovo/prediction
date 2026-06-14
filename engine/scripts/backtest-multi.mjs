#!/usr/bin/env node
// 多赛事验证（双模型对比）：足球5大联赛×多赛季(真实B365赔率)+NBA(自算Elo)
//   两套模型各跑一遍：加权模型(第一篇) vs 集成模型(第二篇)，并排对比。
// 用法：node scripts/backtest-multi.mjs

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import {
  predictWeighted, predictEnsemble, predictWeighted2, predictEnsemble2, metricsOf,
} from '../src/backtest-models.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getText = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc)\b/g, '').replace(/[^a-z]/g, '');
const FALIAS = {
  "Nott'm Forest": 'Forest', 'Ath Madrid': 'Atletico', 'Ath Bilbao': 'Athletic', 'Sociedad': 'Sociedad', 'Vallecano': 'Rayo Vallecano',
  'Espanol': 'Espanyol', 'Bayern Munich': 'Bayern', "M'gladbach": 'Gladbach', 'Ein Frankfurt': 'Frankfurt', 'Werder Bremen': 'Werder',
  'FC Koln': 'Koln', 'Milan': 'Milan', 'Paris SG': 'Paris SG',
};
const fKey = (t) => clubeloNorm(FALIAS[t] || t);

// clubelo 快照缓存
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
function eloOn(key, dateStr) {
  let best = null; for (const d in snapCache) if (d <= dateStr && (!best || d > best)) best = d;
  if (!best) best = Object.keys(snapCache).sort()[0];
  return best ? (snapCache[best]?.[key] ?? null) : null;
}

async function football(league, zh, code, label) {
  let csv; try { csv = await getText(`https://www.football-data.co.uk/mmz4281/${code}/${league}.csv`); } catch { return null; }
  const lines = csv.split('\n').filter(Boolean); const hdr = lines[0].split(','); const ix = (n) => hdr.indexOf(n);
  const C = { d: ix('Date'), h: ix('HomeTeam'), a: ix('AwayTeam'), r: ix('FTR'), bh: ix('B365H'), bd: ix('B365D'), ba: ix('B365A') };
  if (C.h < 0 || C.bh < 0) return null;
  const rowsW = [], rowsE = [];
  for (const l of lines.slice(1)) {
    const c = l.split(','); if (!c[C.h] || !c[C.r] || !c[C.bh]) continue;
    const [dd, mm, yy] = c[C.d].split('/'); const yr = +yy < 100 ? 2000 + +yy : +yy;
    const ds = `${yr}-${String(+mm).padStart(2, '0')}-${String(+dd).padStart(2, '0')}`;
    const eh = eloOn(fKey(c[C.h]), ds), ea = eloOn(fKey(c[C.a]), ds);
    if (eh == null || ea == null) continue;
    const odds = [+c[C.bh], +c[C.bd], +c[C.ba]]; const actual = c[C.r]; const eloFav = eh >= ea ? 'H' : 'A';
    rowsW.push({ p: predictWeighted(eh, ea, true, odds), actual, odds, eloFav });
    rowsE.push({ p: predictEnsemble(eh, ea, true, odds), actual, odds, eloFav });
  }
  if (!rowsW.length) return null;
  return { id: `${zh} ${label}`, sport: '足球', n: rowsW.length, weighted: metricsOf(rowsW), ensemble: metricsOf(rowsE) };
}

async function nba(seasons) {
  const csv = await getText('https://raw.githubusercontent.com/NocturneBear/NBA-Data-2010-2024/main/regular_season_totals_2010_2024.csv');
  const lines = csv.split('\n'); const hdr = lines[0].split(','); const ix = (n) => hdr.indexOf(n);
  const C = { sy: ix('SEASON_YEAR'), ab: ix('TEAM_ABBREVIATION'), gid: ix('GAME_ID'), gd: ix('GAME_DATE'), mu: ix('MATCHUP'), pts: ix('PTS') };
  const byGame = new Map();
  for (const l of lines.slice(1)) { const c = l.split(','); if (!c[C.gid]) continue; (byGame.get(c[C.gid]) || byGame.set(c[C.gid], []).get(c[C.gid])).push({ sy: c[C.sy], ab: c[C.ab], date: c[C.gd]?.slice(0, 10), mu: c[C.mu], pts: +c[C.pts] }); }
  const games = [];
  for (const [, gs] of byGame) { if (gs.length !== 2) continue; const home = gs.find((g) => / vs\.? /.test(g.mu)), away = gs.find((g) => / @ /.test(g.mu)); if (!home || !away) continue; games.push({ sy: home.sy, date: home.date, home: home.ab, away: away.ab, hp: home.pts, ap: away.pts }); }
  games.sort((a, b) => a.date.localeCompare(b.date));
  const elo = new Map(); const get = (t) => elo.has(t) ? elo.get(t) : 1500;
  const bw = {}, be = {};
  for (const g of games) {
    const eh = get(g.home), ea = get(g.away);
    const Eh = 1 / (1 + Math.pow(10, -((eh - ea + 100) / 400))); const W = g.hp > g.ap ? 1 : 0;
    if (seasons.includes(g.sy)) {
      const actual = W === 1 ? 'H' : 'A'; const eloFav = eh >= ea ? 'H' : 'A';
      (bw[g.sy] ||= []).push({ p: predictWeighted2(eh, ea), actual, eloFav });
      (be[g.sy] ||= []).push({ p: predictEnsemble2(eh, ea), actual, eloFav });
    }
    elo.set(g.home, eh + 20 * (W - Eh)); elo.set(g.away, ea + 20 * ((1 - W) - (1 - Eh)));
  }
  return seasons.filter((s) => bw[s]?.length).map((s) => ({ id: `NBA ${s}`, sport: 'NBA', n: bw[s].length, weighted: metricsOf(bw[s]), ensemble: metricsOf(be[s]) }));
}

console.log('多赛事双模型回测...');
const nf = await ensureSnapshots(biweekly(2021, 7, 2025, 6));
console.log(`  clubelo 快照 ${Object.keys(snapCache).length} 个（新增 ${nf}）`);
const results = [];
const FB = [['E0', '英超', [['2122', '21-22'], ['2223', '22-23'], ['2324', '23-24'], ['2425', '24-25']]], ['SP1', '西甲', [['2324', '23-24'], ['2425', '24-25']]], ['D1', '德甲', [['2324', '23-24'], ['2425', '24-25']]], ['I1', '意甲', [['2324', '23-24'], ['2425', '24-25']]], ['F1', '法甲', [['2324', '23-24'], ['2425', '24-25']]]];
for (const [lg, zh, seasons] of FB) for (const [code, label] of seasons) {
  const r = await football(lg, zh, code, label);
  if (r) { results.push(r); console.log(`  ${r.id}: ${r.n}场 | 加权 命中${(r.weighted.acc * 100).toFixed(1)}% ROI${(r.weighted.flat.roi * 100).toFixed(1)}% | 集成 命中${(r.ensemble.acc * 100).toFixed(1)}% ROI${(r.ensemble.flat.roi * 100).toFixed(1)}%`); }
}
console.log('NBA...');
try { for (const r of await nba(['2021-22', '2022-23', '2023-24'])) { results.push(r); console.log(`  ${r.id}: ${r.n}场 | 加权命中${(r.weighted.acc * 100).toFixed(1)}% | 集成命中${(r.ensemble.acc * 100).toFixed(1)}%`); } } catch (e) { console.log('  NBA FAIL', e.message); }

// 汇总（足球真实赔率部分）
function agg(model) {
  const fb = results.filter((r) => r.sport === '足球');
  const nAll = fb.reduce((s, r) => s + r.n, 0);
  const flatBets = fb.reduce((s, r) => s + r[model].flat.bets, 0);
  const flatProfit = fb.reduce((s, r) => s + r[model].flat.roi * r[model].flat.bets, 0);
  const valBets = fb.reduce((s, r) => s + r[model].value.bets, 0);
  const valProfit = fb.reduce((s, r) => s + r[model].value.roi * r[model].value.bets, 0);
  const accW = fb.reduce((s, r) => s + r[model].acc * r.n, 0) / nAll;
  return { matches: nAll, acc: accW, flatROI: flatBets ? flatProfit / flatBets : 0, valueROI: valBets ? valProfit / valBets : 0, valueBets: valBets };
}
const summary = { weighted: agg('weighted'), ensemble: agg('ensemble') };
writeFileSync(join(ROOT, 'data', 'backtest-multi.json'), JSON.stringify({
  _note: '多赛事双模型回测：加权模型(第一篇) vs 集成模型(第二篇)。足球真实B365赔率→真实ROI；NBA自算Elo→盈亏平衡。',
  builtAt: new Date().toISOString(), results, summary,
}, null, 2), 'utf-8');
console.log(`\n汇总（足球真实赔率）：`);
console.log(`  加权模型 命中${(summary.weighted.acc * 100).toFixed(1)}% 押主选ROI${(summary.weighted.flatROI * 100).toFixed(1)}% 价值ROI${(summary.weighted.valueROI * 100).toFixed(1)}%`);
console.log(`  集成模型 命中${(summary.ensemble.acc * 100).toFixed(1)}% 押主选ROI${(summary.ensemble.flatROI * 100).toFixed(1)}% 价值ROI${(summary.ensemble.valueROI * 100).toFixed(1)}%`);
console.log('✓ 写入 data/backtest-multi.json → node scripts/build-validation-page.mjs');
