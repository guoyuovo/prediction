#!/usr/bin/env node
// "搏·串关" 回测:在已完赛比赛上,用【与上线完全相同的 src/parlay.mjs 逻辑】选腿组串并按真实赛果结算。
//   数据:backtest-v2.json(每场模型 pHome/pDraw/pAway + 真实 actual) + match-odds.json(共识 1X2 赔率,与 build-bo 同源)。
//   对比三策略:A 搏(市场可能性≥下限里挑高赔) / B 无脑最高赔(无可能性下限) / C 保守(模型最高概率)。同结构公平对比。
//   ⚠️ 极小样本:结论只为看机制与数量级,ROI 由"是否撞中那几注"主导=survivorship 噪声,严禁外推到真实下注。
// 用法:node scripts/backtest-parlay.mjs

import { ROOT, loadJson } from '../src/util.mjs';
import { selectPool, buildParlays, legsOfMatch, PARLAY_CFG } from '../src/parlay.mjs';

const bt = loadJson('data/backtest-v2.json');
const ODDS = loadJson('data/match-odds.json').odds;

// 已完赛 → match 对象(canonical 朝向;共识赔率同源)
const matches = [];
let noOdds = 0;
for (const m of bt.matches) {
  const o = ODDS[`${m.home} vs ${m.away}`];
  if (!o || o.length !== 3) { noOdds++; continue; }
  matches.push({
    key: `${m.home} vs ${m.away}`, seq: m.seq ?? m.et, home: m.home, away: m.away,
    p: [m.pHome, m.pDraw, m.pAway], odds: o, src: 'consensus',
    actual: m.actual, // H/D/A 真值(仅回测用)
  });
}
const actualOf = new Map(matches.map((m) => [m.key, m.actual]));

// —— 三种选池器(都遵守"每场至多1腿 + 取前 POOL_K"结构,保证公平)——
function poolValue(ms) { return selectPool(ms); }                                   // A:市场可能性≥下限里挑高赔
function poolByOdds(ms) {                                                            // B:每场最高赔腿(无可能性下限)
  return ms.map((m) => legsOfMatch(m).sort((a, b) => b.odds - a.odds)[0])
    .sort((a, b) => b.odds - a.odds).slice(0, PARLAY_CFG.POOL_K);
}
function poolByProb(ms) {                                                            // C:每场模型最高概率腿
  return ms.map((m) => legsOfMatch(m).sort((a, b) => b.modelP - a.modelP)[0])
    .sort((a, b) => b.modelP - a.modelP).slice(0, PARLAY_CFG.POOL_K);
}

// 结算:腿命中 = sel===actual;串关全中才算中,回报=组合赔率(等额 1 注)
function settle(allParlays) {
  let staked = 0, ret = 0, hits = 0;
  const byTier = {};
  for (const pl of allParlays) {
    const win = pl.legKeys.every((lk) => { const [key, sel] = lk.split('|'); return actualOf.get(key) === sel; });
    staked += 1; if (win) { ret += pl.odds; hits++; }
    const t = byTier[pl.tier] || (byTier[pl.tier] = { n: 0, hit: 0, ret: 0 });
    t.n++; if (win) { t.hit++; t.ret += pl.odds; }
  }
  return { staked, ret: +ret.toFixed(2), hits, roi: staked ? +((ret - staked) / staked * 100).toFixed(1) : 0, byTier };
}

function run(name, poolFn) {
  const pool = poolFn(matches);
  const { singles, parlays } = buildParlays(pool);
  const all = [...singles, ...parlays];
  const r = settle(all);
  const tiers = Object.entries(r.byTier).map(([t, v]) => `${t}关 ${v.hit}/${v.n}`).join(' · ');
  console.log(`${name.padEnd(18)} 腿池 ${pool.length} · 注 ${r.staked}(中 ${r.hits}) · 回报 ${r.ret} · ROI ${r.roi}%   [${tiers}]`);
  return { name, pool: pool.length, ...r };
}

console.log(`\n搏·串关回测(已完赛 ${matches.length} 场${noOdds ? `,${noOdds} 场无赔率跳过` : ''})`);
console.log(`阈值(未标定先验): 市场可能性 q≥${PARLAY_CFG.Q_FLOOR} 赔率≥${PARLAY_CFG.ODDS_MIN} · 池上限 ${PARLAY_CFG.POOL_K}\n`);

// 搏腿池明细(透明):命中概率用市场 q,模型仅作风味
const vpool = selectPool(matches);
if (vpool.length) {
  console.log('搏腿池(q≥下限里挑高赔,每场1腿):');
  for (const l of vpool) console.log(`  ${l.home} vs ${l.away} | ${l.selZh} 市场q=${l.q} 模型p=${l.modelP}${l.lean ? '⚑模型偏爱' : ''} 赔率=${l.odds} | 实际=${actualOf.get(l.key)}${actualOf.get(l.key) === l.sel ? '✓' : '✗'}`);
  console.log('');
} else {
  console.log('搏腿池为空(无腿过闸)。\n');
}

run('A 搏(高赔)', poolValue);
run('B 无脑最高赔', poolByOdds);
run('C 保守(最高概率)', poolByProb);

console.log('\n⚠️ 样本极小(20 场量级):三/四关常仅 0–1 注命中,ROI 由 survivorship 主导,统计上无意义,严禁外推到真实下注。');
console.log('   随真实赛程累积到 ≥50–100 场再跑本脚本,才有讨论显著性的基础;在那之前不放宽任何阈值。');
