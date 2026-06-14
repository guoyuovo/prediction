#!/usr/bin/env node
// 概率校准实验：对英超回测做温度缩放（temperature scaling）
//   过度自信 → 把 3 路概率往均匀方向收缩。在训练集(前60%)拟合温度 T，
//   测试集(后40%)验证——无泄漏。对比校准前后的 LogLoss/Brier/校准/价值投注 ROI。
// 用法：node scripts/backtest-calibrated.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const D = loadJson('data/backtest-epl.json');
const rows = [...D.rows].sort((a, b) => a.date.localeCompare(b.date));
const split = Math.floor(rows.length * 0.6);
const train = rows.slice(0, split), test = rows.slice(split);

// 温度缩放：cal_i = softmax(log(p_i)/T)
function calibrate(p, T) {
  const logits = p.map((x) => Math.log(Math.max(x, 1e-9)) / T);
  const mx = Math.max(...logits);
  const ex = logits.map((x) => Math.exp(x - mx));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((x) => x / s);
}
const probsOf = (r) => [r.pH, r.pD, r.pA];
const actIdx = (r) => ({ H: 0, D: 1, A: 2 }[r.actual]);
const logloss = (set, T) => -set.reduce((s, r) => s + Math.log(Math.max(calibrate(probsOf(r), T)[actIdx(r)], 1e-9)), 0) / set.length;

// 在训练集网格搜索最优 T
let bestT = 1, bestLL = Infinity;
for (let T = 1.0; T <= 3.0; T += 0.05) { const ll = logloss(train, T); if (ll < bestLL) { bestLL = ll; bestT = +T.toFixed(2); } }

// 测试集评估
function evalSet(set, T) {
  const brier = set.reduce((s, r) => { const cal = calibrate(probsOf(r), T); const t = [r.actual === 'H', r.actual === 'D', r.actual === 'A']; return s + cal.reduce((ss, p, i) => ss + (p - t[i]) ** 2, 0); }, 0) / set.length;
  const ll = logloss(set, T);
  // 校准表（按主选概率分桶）
  const pickIdx = (r) => ({ H: 0, D: 1, A: 2 }[r.predPick]);
  const buckets = [[0.33, 0.45], [0.45, 0.55], [0.55, 0.65], [0.65, 0.75], [0.75, 0.85], [0.85, 1.01]];
  const calib = buckets.map(([lo, hi]) => {
    const b = set.filter((r) => { const cp = calibrate(probsOf(r), T)[pickIdx(r)]; return cp >= lo && cp < hi; });
    return { range: `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%`, n: b.length, pred: b.length ? b.reduce((s, r) => s + calibrate(probsOf(r), T)[pickIdx(r)], 0) / b.length : 0, actual: b.length ? b.filter((r) => r.hit).length / b.length : 0 };
  });
  // ROI：押主选不变（温度缩放不改 argmax）；价值投注随校准变化
  const flat = roi(set, () => true);
  const valueRaw = roi(set, (r) => r.pPick > r.impPick);
  const valueCal = roi(set, (r) => calibrate(probsOf(r), T)[pickIdx(r)] > r.impPick);
  return { brier, logloss: ll, calib, flat, valueRaw, valueCal, n: set.length };
}
function roi(set, filter) {
  const b = set.filter(filter); if (!b.length) return { bets: 0, winRate: 0, roi: 0, profit: 0 };
  let profit = 0, w = 0; for (const r of b) { if (r.hit) { profit += r.oddPick - 1; w++; } else profit -= 1; }
  return { bets: b.length, winRate: w / b.length, roi: profit / b.length, profit: +profit.toFixed(2) };
}

const raw = evalSet(test, 1.0);
const cal = evalSet(test, bestT);

console.log(`英超概率校准实验（训练 ${train.length} 场 / 测试 ${test.length} 场，无泄漏）`);
console.log(`拟合最优温度 T = ${bestT}（T>1 = 收缩过度自信）\n`);
console.log('测试集对比          校准前      校准后');
console.log(`  LogLoss          ${raw.logloss.toFixed(3)}      ${cal.logloss.toFixed(3)}  ${cal.logloss < raw.logloss ? '↓更好' : ''}`);
console.log(`  Brier            ${raw.brier.toFixed(3)}      ${cal.brier.toFixed(3)}  ${cal.brier < raw.brier ? '↓更好' : ''}`);
console.log('\n校准表（主选概率 预测 vs 实际）:');
console.log('  区间       校准前(预测/实际)        校准后(预测/实际)');
for (let i = 0; i < raw.calib.length; i++) {
  const a = raw.calib[i], b = cal.calib[i];
  console.log(`  ${a.range.padEnd(9)} ${a.n}场 ${(a.pred * 100).toFixed(0)}%/${(a.actual * 100).toFixed(0)}%      ${b.n}场 ${(b.pred * 100).toFixed(0)}%/${(b.actual * 100).toFixed(0)}%`);
}
console.log('\nROI（测试集，真实 B365 赔率）:');
console.log(`  每场押主选(不受校准影响)  ${raw.flat.bets}场 ROI ${(raw.flat.roi * 100).toFixed(1)}%`);
console.log(`  价值投注 校准前           ${raw.valueRaw.bets}场 胜率${(raw.valueRaw.winRate * 100).toFixed(1)}% ROI ${(raw.valueRaw.roi * 100).toFixed(1)}%`);
console.log(`  价值投注 校准后           ${cal.valueCal.bets}场 胜率${(cal.valueCal.winRate * 100).toFixed(1)}% ROI ${(cal.valueCal.roi * 100).toFixed(1)}%`);

writeFileSync(join(ROOT, 'data', 'backtest-epl-calibrated.json'), JSON.stringify({
  _note: '英超概率校准实验：温度缩放，训练集拟合 T、测试集验证。',
  bestT, train: train.length, test: test.length, raw, cal,
}, null, 2), 'utf-8');
console.log('\n✓ 写入 data/backtest-epl-calibrated.json');
