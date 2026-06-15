#!/usr/bin/env node
// 赛果驱动·实时校准（仅平局乘子，单参数·防过拟合·样本阈值）
//   背景：daily 的滚动 Elo/xG 已让"球队实力"随赛果自适应，但模型的平局倾向是固定参数，
//        早期被报告诟病"平局预测偏少"。本脚本用 backtest-v2.json 里累积的【世界杯真实赛果】
//        + 当时的样本外预测，网格搜索一个【平局概率乘子 liveMult】，最小化 logloss。
//   为什么只调 1 个参数：世界杯样本少（小样本多参数网格必过拟合）。平局乘子是命中收益最高、
//        最契合报告关切的单参数，且与 model.mjs 出口变换完全一致 → 标定=线上，自洽收敛。
//   防过拟合三道闸：① 样本不足(MIN_MATCHES)直接跳过不改配置；② 按样本量对最优值做收缩
//        (n 越大越敢动)；③ 绝对乘子夹在 [0.5,2.0]，单次相对调整夹在网格 [0.7,1.4]。
//   写入：config/model.json 的 draw.liveMult（model.mjs 在赔率融合后应用，默认 1 = 不改动）。
//   用法：node scripts/calibrate-live.mjs            # 跑并写入（样本足够时）
//         node scripts/calibrate-live.mjs --dry-run  # 只算不写
//
// 注：backtest-v2.json 由 build-elo-v2.mjs 产出，其预测已含上一次的 liveMult，
//     故这里搜到的是【相对乘子】，最终 liveMult = 旧值 × 相对最优 → 逐日收敛到 1。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const P = (p) => join(ROOT, p);
const load = (p) => JSON.parse(readFileSync(P(p), 'utf-8'));

const MIN_MATCHES = +(process.env.CALIB_MIN || 20); // 样本阈值：少于此不调（防过拟合）
const FULL_TRUST = 40;                               // 达到此样本量才"全力"采用最优值
const GRID_LO = 0.7, GRID_HI = 1.4, GRID_STEP = 0.05;
const ABS_LO = 0.5, ABS_HI = 2.0;                    // 绝对乘子硬边界
const DRY = process.argv.includes('--dry-run');

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const IDX = { H: 0, D: 1, A: 2 };

// 平局乘子变换：与 model.mjs 出口处完全一致（pDraw×g 后夹紧，主客按 (1-新)/(1-旧) 等比缩放）
function applyMult(p, g) {
  const nd = clamp(p[1] * g, 0.02, 0.92);
  const k = (1 - nd) / (1 - p[1]);
  return [p[0] * k, nd, p[2] * k];
}
function logloss(rows, g) {
  let s = 0;
  for (const r of rows) { const q = applyMult(r.p, g); s += -Math.log(Math.max(q[IDX[r.actual]], 1e-9)); }
  return s / rows.length;
}

// —— 读真实赛果样本 ——
if (!existsSync(P('data/backtest-v2.json'))) {
  console.log('· 无 backtest-v2.json（还没产出样本外预测），跳过实时校准。');
  process.exit(0);
}
const bt = load('data/backtest-v2.json');
const rows = (bt.matches || [])
  .filter((m) => m.actual && m.pHome != null && m.pDraw != null && m.pAway != null)
  .map((m) => ({ p: [m.pHome, m.pDraw, m.pAway], actual: m.actual }));
const n = rows.length;

if (n < MIN_MATCHES) {
  console.log(`· 真实赛果样本 ${n} < 阈值 ${MIN_MATCHES}，跳过实时校准（样本太少，自动调参易过拟合）。`);
  process.exit(0);
}

// —— 网格搜相对最优乘子 ——
let best = { g: 1, ll: logloss(rows, 1) };
const base = best.ll;
for (let g = GRID_LO; g <= GRID_HI + 1e-9; g += GRID_STEP) {
  g = +g.toFixed(2);
  const ll = logloss(rows, g);
  if (ll < best.ll) best = { g, ll };
}

// —— 按样本量收缩（n 越大越敢用最优值；n=MIN→半力起步，n≥FULL→全力）——
const trust = clamp((n - MIN_MATCHES) / (FULL_TRUST - MIN_MATCHES), 0, 1) * 0.5 + 0.5;
const gRel = 1 + (best.g - 1) * trust;

const cfg = load('config/model.json');
const prevMult = cfg.draw.liveMult ?? 1;
const newMult = +clamp(prevMult * gRel, ABS_LO, ABS_HI).toFixed(3);

// —— 透明对照：实际平局率 vs 校准前后预测平局率 ——
const realDrawRate = rows.filter((r) => r.actual === 'D').length / n;
const predBefore = rows.reduce((s, r) => s + applyMult(r.p, 1)[1], 0) / n; // 当前(已含旧 liveMult)
const predAfter = rows.reduce((s, r) => s + applyMult(r.p, gRel)[1], 0) / n;

console.log(`赛果驱动·实时校准（样本 ${n} 场，阈值 ${MIN_MATCHES}）`);
console.log(`  logloss 基线 ${base.toFixed(4)} → 相对最优 g=${best.g}（${best.ll.toFixed(4)}）· 收缩信任 ${trust.toFixed(2)} → 实用相对 ${gRel.toFixed(3)}`);
console.log(`  平局率：实际 ${(realDrawRate * 100).toFixed(1)}% · 校准前预测 ${(predBefore * 100).toFixed(1)}% → 校准后 ${(predAfter * 100).toFixed(1)}%`);
console.log(`  draw.liveMult：${prevMult} → ${newMult}${DRY ? ' (dry-run，未写入)' : ''}`);

if (DRY) process.exit(0);

cfg.draw.liveMult = newMult;
cfg._liveCalibration = `赛果驱动：${n} 场样本网格搜平局乘子，logloss ${base.toFixed(4)}→${best.ll.toFixed(4)}，liveMult ${prevMult}→${newMult}（builtAt ${new Date().toISOString()}）`;
writeFileSync(P('config/model.json'), JSON.stringify(cfg, null, 2), 'utf-8');
console.log('✓ 已写入 config/model.json（draw.liveMult）');
