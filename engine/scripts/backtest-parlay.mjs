#!/usr/bin/env node
// "搏·串关" 回测:在已完赛比赛上,用【与上线相同的 src/parlay.mjs 选腿逻辑】组串并按真实赛果结算。
//   数据:backtest-v2.json(每场模型 pHDA + 真实 actual) + match-odds.json(共识 1X2 赔率,与 build-bo 同源)。
//   验证两件事:① 新分档选腿不再"为高赔而高赔"(打印稳搏/激进各场选了哪条);② 各策略命中/ROI 数量级。
//   ⚠️ 极小样本:ROI 由"是否撞中那几注"主导=survivorship 噪声,统计上无意义,严禁外推到真实下注。
// 用法:node scripts/backtest-parlay.mjs

import { ROOT, loadJson } from '../src/util.mjs';
import { selectPool, buildParlays, legsOfMatch, RISK_BANDS, PARLAY_CFG } from '../src/parlay.mjs';

const bt = loadJson('data/backtest-v2.json');
const ODDS = loadJson('data/match-odds.json').odds;

const matches = []; let noOdds = 0;
for (const m of bt.matches) {
  const o = ODDS[`${m.home} vs ${m.away}`];
  if (!o || o.length !== 3) { noOdds++; continue; }
  matches.push({ key: `${m.home} vs ${m.away}`, seq: m.seq ?? m.et, home: m.home, away: m.away, p: [m.pHome, m.pDraw, m.pAway], odds: o, src: 'consensus', actual: m.actual });
}
const actualOf = new Map(matches.map((m) => [m.key, m.actual]));

function settle(parlays) {
  let staked = 0, ret = 0, hits = 0; const byTier = {};
  for (const pl of parlays) {
    const win = pl.legKeys.every((lk) => { const [key, sel] = lk.split('|'); return actualOf.get(key) === sel; });
    staked += 1; if (win) { ret += pl.odds; hits++; }
    const t = byTier[pl.tier] || (byTier[pl.tier] = { n: 0, hit: 0 }); t.n++; if (win) t.hit++;
  }
  return { staked, ret: +ret.toFixed(2), hits, roi: staked ? +((ret - staked) / staked * 100).toFixed(1) : 0, byTier };
}

function runPool(name, pool) {
  const { singles, parlays } = buildParlays(pool, { risk: name.includes('激进') ? 'aggressive' : 'steady' });
  const r = settle([...singles, ...parlays]);
  const tiers = Object.entries(r.byTier).map(([t, v]) => `${t}关${v.hit}/${v.n}`).join(' ');
  console.log(`${name.padEnd(16)} 池${pool.length} · 注${r.staked}(中${r.hits}) · 回报${r.ret} · ROI ${r.roi}%  [${tiers}]`);
}

console.log(`\n搏·串关回测(已完赛 ${matches.length} 场${noOdds ? `,${noOdds} 场无赔率跳过` : ''})`);
console.log(`分档(q-only,主观风险旋钮非回测最优): 稳搏 q∈[${RISK_BANDS.steady.qLo},${RISK_BANDS.steady.qHi}) · 激进 q∈[${RISK_BANDS.aggressive.qLo},${RISK_BANDS.aggressive.qHi}) · 池≤${PARLAY_CFG.POOL_K}\n`);

for (const risk of ['steady', 'aggressive']) {
  const pool = selectPool(matches, { risk });
  console.log(`【${RISK_BANDS[risk].label}】选腿池(每场1腿,几何平衡分):`);
  if (!pool.length) console.log('  (本档无场落入甜区)');
  for (const l of pool) console.log(`  ${l.home} v ${l.away} | ${l.selZh} q=${(l.q * 100).toFixed(0)}% @${l.odds}${l.lean ? ' ⚑' : ''} | 实际${actualOf.get(l.key)}${actualOf.get(l.key) === l.sel ? '✓' : '✗'}`);
  runPool(RISK_BANDS[risk].label, pool);
  console.log('');
}

// 基线对比(同"每场1腿+池"结构)
const byOdds = matches.map((m) => legsOfMatch(m).sort((a, b) => b.odds - a.odds)[0]).sort((a, b) => b.odds - a.odds).slice(0, PARLAY_CFG.POOL_K);
const byProb = matches.map((m) => legsOfMatch(m).sort((a, b) => b.modelP - a.modelP)[0]).sort((a, b) => b.modelP - a.modelP).slice(0, PARLAY_CFG.POOL_K);
runPool('基线·无脑最高赔', byOdds);
runPool('基线·模型最高概率', byProb);

console.log('\n⚠️ 样本极小:三/四关常仅 0–1 注命中,ROI=survivorship 噪声,统计上无意义,严禁外推。阈值为体验默认值,非统计最优。');
