#!/usr/bin/env node
// v2 模型核心：以基础模型的【官方真实 Elo】为起点，按时间顺序对每场【已完赛】比赛
// 做标准 World Football Elo 滚动更新（K=60 世界杯，进球差 MOV 修正），并在每场赛前
// 用基础模型做【真正样本外】预测，与实际结果对照（Brier / log-loss / 1X2 命中 / 波胆）。
//   输入：data/teams.json（基础真实 Elo）+ data/wc-results.json（ESPN 真实完赛比分）
//   输出：data/teams-v2.json（滚动后 Elo）+ data/backtest-v2.json（逐场验证日志）
// 用法：node scripts/build-elo-v2.mjs
//
// 东道主：本届美/加/墨三国联办，groups.json hosts 三者全含；东道主在本土作战时
//         Elo 期望与基础模型一致地获得 +100 主场，三队同等对待。

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictMatch, CFG } from '../src/model.mjs';

const K = CFG.elo.kFactor ?? 60;            // 世界杯 K=60（World Football Elo 惯例）
const HOME_BONUS = CFG.elo.homeBonus ?? 60; // 东道主本土 Elo 期望加成（与基础模型同源）

const base = loadJson('data/teams.json');
const teams = base.teams;
const hosts = new Set(loadJson('data/groups.json').hosts);
const wc = loadJson('data/wc-results.json');
const played = wc.results || [];

// 滚动 Elo 工作副本（仅 elo 滚动，其余字段沿用基础真实值）
const elo = {};
for (const [name, t] of Object.entries(teams)) elo[name] = t.elo;
const eloStart = { ...elo };

// World Football Elo 进球差修正 G
const movG = (gd) => (gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8);
const oneHot = (o) => ({ H: o === 'H' ? 1 : 0, D: o === 'D' ? 1 : 0, A: o === 'A' ? 1 : 0 });

const log = [];
let sBrier = 0, sLogloss = 0, nCorrect = 0, nScoreHit = 0, nDirHit = 0;

for (const m of played) {
  const { home, away, hs, as } = m;
  if (teams[home] == null || teams[away] == null) { console.log(`  ⚠ 跳过未知队：${home}/${away}`); continue; }

  // —— 赛前样本外预测（用当前滚动 Elo，基础模型逻辑，含赔率融合）——
  const Hobj = { name: home, ...teams[home], elo: elo[home] };
  const Aobj = { name: away, ...teams[away], elo: elo[away] };
  const pred = predictMatch(Hobj, Aobj); // neutral 默认 true → 东道主&非东道主才得主场
  const actual = hs > as ? 'H' : hs < as ? 'A' : 'D';
  const p = { H: pred.pHome, D: pred.pDraw, A: pred.pAway };
  const predOutcome = p.H >= p.D && p.H >= p.A ? 'H' : p.A >= p.D ? 'A' : 'D';
  const y = oneHot(actual);
  const brier = (p.H - y.H) ** 2 + (p.D - y.D) ** 2 + (p.A - y.A) ** 2;
  const logloss = -Math.log(Math.max(p[actual], 1e-9));
  const correct = predOutcome === actual;
  const scoreHit = pred.score === `${hs}-${as}`;
  const dirHit = correct; // 方向命中即 1X2 命中
  sBrier += brier; sLogloss += logloss; if (correct) nCorrect++; if (scoreHit) nScoreHit++; if (dirHit) nDirHit++;

  // —— 滚动 Elo 更新（标准 Elo + MOV）——
  const homeAdv = hosts.has(home) && !hosts.has(away);
  const dr = elo[home] - elo[away] + (homeAdv ? HOME_BONUS : 0);
  const weHome = 1 / (1 + 10 ** (-dr / 400));
  const wHome = hs > as ? 1 : hs === as ? 0.5 : 0;
  const delta = K * movG(Math.abs(hs - as)) * (wHome - weHome);
  const eloBefore = { home: elo[home], away: elo[away] };
  elo[home] = Math.round((elo[home] + delta) * 10) / 10;
  elo[away] = Math.round((elo[away] - delta) * 10) / 10;

  log.push({
    et: m.et, group: m.group, home, away, hs, as,
    ht: m.htHome != null ? `${m.htHome}-${m.htAway}` : null,
    actual, predOutcome, correct,
    pHome: +p.H.toFixed(3), pDraw: +p.D.toFixed(3), pAway: +p.A.toFixed(3),
    predScore: pred.score, scoreHit, brier: +brier.toFixed(3), logloss: +logloss.toFixed(3),
    homeAdv, eloDelta: +delta.toFixed(1),
    eloHomeBefore: eloBefore.home, eloHomeAfter: elo[home],
    eloAwayBefore: eloBefore.away, eloAwayAfter: elo[away],
  });
}

// —— 写 teams-v2.json（滚动后 Elo，其余字段不动）——
const v2 = { ...base, teams: {} };
const eloChanges = [];
for (const [name, t] of Object.entries(teams)) {
  v2.teams[name] = { ...t, elo: elo[name] };
  if (elo[name] !== eloStart[name]) eloChanges.push({ team: name, before: eloStart[name], after: elo[name], delta: +(elo[name] - eloStart[name]).toFixed(1) });
}
eloChanges.sort((a, b) => b.delta - a.delta);
v2._v2meta = {
  note: 'v2：基础官方真实 Elo 起点 + 已完赛比赛标准 Elo 滚动更新（K=' + K + '，MOV 修正，东道主本土 +' + HOME_BONUS + '）。其余字段（fifa/value/form/squad）沿用基础真实值。',
  basedOn: base._eloSource || '(teams.json elo)',
  scoresFrom: wc._source,
  matchesApplied: log.length,
  builtAt: new Date().toISOString(),
};
writeFileSync(join(ROOT, 'data', 'teams-v2.json'), JSON.stringify(v2, null, 2), 'utf-8');

// —— 写 backtest-v2.json（逐场验证）——
const n = log.length || 1;
const summary = {
  matches: log.length,
  accuracy1X2: +(nCorrect / n).toFixed(3),
  brierAvg: +(sBrier / n).toFixed(3),
  loglossAvg: +(sLogloss / n).toFixed(3),
  scoreHit: +(nScoreHit / n).toFixed(3),
  dirHit: +(nDirHit / n).toFixed(3),
  note: '样本外（赛前预测 vs 实际完赛）。样本量小，仅作滚动起点；随赛程推进自动累积。Brier 越低越好(0~2)，三路盲猜≈0.667。',
};
// —— live 校准：累积时间线 + 置信度分箱（随赛程自动累积）——
let cc = 0, cb = 0;
const timeline = log.map((m, i) => { cc += m.correct ? 1 : 0; cb += m.brier; return { i: i + 1, et: m.et, label: `${m.home}-${m.away}`, accCum: +(cc / (i + 1)).toFixed(3), brierCum: +(cb / (i + 1)).toFixed(3) }; });
const calBins = [[0, 0.45], [0.45, 0.55], [0.55, 0.65], [0.65, 1.01]];
const calibration = calBins.map(([lo, hi]) => {
  const sub = log.filter((m) => { const mx = Math.max(m.pHome, m.pDraw, m.pAway); return mx >= lo && mx < hi; });
  const hit = sub.filter((m) => m.correct).length;
  return { range: `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`, n: sub.length, hitRate: sub.length ? +(hit / sub.length).toFixed(3) : null };
});
// bakedLiveMult：记录本次烤进 matches[].p* 的平局乘子，供 calibrate-live 准确剥离还原基础预测
// （避免依赖"calibrate 时的配置值==build 时的配置值"这一隐式耦合）。
writeFileSync(join(ROOT, 'data', 'backtest-v2.json'), JSON.stringify({ summary, bakedLiveMult: CFG.draw.liveMult ?? 1, matches: log, eloChanges, timeline, calibration, builtAt: v2._v2meta.builtAt }, null, 2), 'utf-8');

console.log(`v2 滚动 Elo：应用 ${log.length} 场已完赛`);
for (const m of log) console.log(`  ${m.home} ${m.hs}-${m.as} ${m.away}  预测${m.predOutcome}/实际${m.actual} ${m.correct ? '✓' : '✗'}  比分预测${m.predScore}${m.scoreHit ? '✓' : ''}  Δelo ${m.eloDelta >= 0 ? '+' : ''}${m.eloDelta}`);
console.log(`样本外：1X2 命中 ${(summary.accuracy1X2 * 100).toFixed(0)}% · Brier ${summary.brierAvg} · 波胆命中 ${(summary.scoreHit * 100).toFixed(0)}%`);
console.log('Elo 变动 TOP：' + eloChanges.slice(0, 6).map((c) => `${c.team} ${c.delta >= 0 ? '+' : ''}${c.delta}`).join(' · '));
console.log('✓ → data/teams-v2.json · data/backtest-v2.json');
console.log('  下一步：node scripts/build-html.mjs');
