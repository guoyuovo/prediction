#!/usr/bin/env node
// xG-v2：以 team-xg.json 攻防代理为起点，用【已完赛射门数据】算 shot-based xG，
//   按时间顺序对参赛队的 att/def 做 EWMA 滚动更新 → data/team-xg-v2.json。
//   这是「按赛果迭代 xG 模型」的真实增量：射门比进球更稳，能更早反映球队真实攻防。
// 用法：node scripts/build-xg-v2.mjs
//
//   shot-based xG ≈ 0.30·射正 + 0.05·(总射门 − 射正)  —— 粗代理（射正≈0.3 转化、射偏≈0.05）。
//   真 StatsBomb 射门级 xG 国家队无免费源；此为 ESPN 射门统计可得的最佳近似，明确标注。

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const K = 0.20;            // EWMA 步长（单场噪声大，取小）
const LEAGUE_AVG = loadJson('config/model-ensemble.json').xg.leagueAvg || 1.3;
const ATT_CLAMP = [1.0, 2.6], DEF_CLAMP = [0.45, 1.7];
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
const shotXg = (s) => s && s.shots != null ? 0.30 * (s.sot || 0) + 0.05 * Math.max(0, (s.shots || 0) - (s.sot || 0)) : null;

const baseXg = loadJson('data/team-xg.json');
const xg = {}; for (const [k, v] of Object.entries(baseXg.teams)) xg[k] = { att: v.att, def: v.def };
const start = JSON.parse(JSON.stringify(xg));
const wc = (() => { try { return loadJson('data/wc-results.json'); } catch { return { results: [] }; } })();

const log = [];
let applied = 0, skipped = 0;
for (const m of wc.results) {
  const { home, away, stats } = m;
  if (!xg[home] || !xg[away]) continue;
  const xgH = shotXg(stats?.home), xgA = shotXg(stats?.away);
  if (xgH == null || xgA == null) { skipped++; continue; } // 无射门数据则跳过（不更新）
  // 快照赛前值
  const aH = xg[home].att, dH = xg[home].def, aA = xg[away].att, dA = xg[away].def;
  const lamH = (aH * dA) / LEAGUE_AVG; // 模型对 H 的预期进球
  const lamA = (aA * dH) / LEAGUE_AVG;
  // 按 表现/预期 比值做乘性 EWMA：进攻看自己造的 xG，防守看对手造的 xG
  xg[home].att = clamp(aH * (1 - K + K * (xgH / lamH)), ATT_CLAMP);
  xg[home].def = clamp(dH * (1 - K + K * (xgA / lamA)), DEF_CLAMP);
  xg[away].att = clamp(aA * (1 - K + K * (xgA / lamA)), ATT_CLAMP);
  xg[away].def = clamp(dA * (1 - K + K * (xgH / lamH)), DEF_CLAMP);
  applied++;
  log.push({
    et: m.et, home, away, score: `${m.hs}-${m.as}`,
    xgFor: { home: +xgH.toFixed(2), away: +xgA.toFixed(2) },
    shots: { home: `${stats.home.shots}/${stats.home.sot}`, away: `${stats.away.shots}/${stats.away.sot}` },
    attHome: [aH, +xg[home].att.toFixed(3)], defHome: [dH, +xg[home].def.toFixed(3)],
    attAway: [aA, +xg[away].att.toFixed(3)], defAway: [dA, +xg[away].def.toFixed(3)],
  });
}

const out = {
  _note: 'xG-v2：team-xg.json 起点 + 已完赛 shot-based xG（0.30·射正+0.05·射偏）EWMA(K=' + K + ') 滚动更新 att/def。仅参赛且有射门数据的队变动；其余沿用基础值。',
  _source: 'ESPN 射门统计（data/wc-results.json stats）',
  builtAt: new Date().toISOString(), applied, skipped,
  teams: xg, changes: [],
};
for (const k of Object.keys(xg)) {
  if (Math.abs(xg[k].att - start[k].att) > 1e-6 || Math.abs(xg[k].def - start[k].def) > 1e-6)
    out.changes.push({ team: k, att: [start[k].att, +xg[k].att.toFixed(3)], def: [start[k].def, +xg[k].def.toFixed(3)] });
}
writeFileSync(join(ROOT, 'data', 'team-xg-v2.json'), JSON.stringify(out, null, 2), 'utf-8');
writeFileSync(join(ROOT, 'data', 'backtest-xg-v2.json'), JSON.stringify({ _note: 'xG-v2 逐场更新日志', builtAt: out.builtAt, log }, null, 2), 'utf-8');

console.log(`xG-v2：应用 ${applied} 场（跳过无射门 ${skipped} 场）`);
for (const c of log) console.log(`  ${c.home} ${c.score} ${c.away}  xG ${c.xgFor.home}-${c.xgFor.away} (射 ${c.shots.home} vs ${c.shots.away})  att主 ${c.attHome[0]}→${c.attHome[1]} · att客 ${c.attAway[0]}→${c.attAway[1]}`);
console.log(`✓ → data/team-xg-v2.json（${out.changes.length} 队攻防变动） · data/backtest-xg-v2.json`);
console.log('  下一步：node scripts/build-dual-page.mjs');
