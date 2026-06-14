#!/usr/bin/env node
// 敏感性分析（《方法论》7.3 / 8.4）：
//   将 Elo 随机扰动 σ 从 50 提高到 100，夺冠概率分布应趋于平缓
//   （强队概率下降、弱队概率上升），但 Top 5 排序保持不变。
// 用法: node scripts/sensitivity.mjs [--iterations 10000]

import { runMonteCarlo } from '../src/tournament.mjs';
import { CFG } from '../src/model.mjs';
import { zh } from '../src/names.mjs';
import { pct } from '../src/util.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const iterations = parseInt(arg('iterations', String(CFG.mc.iterations)), 10);

console.log(`敏感性分析：σ=50 vs σ=100，各 ${iterations.toLocaleString()} 次迭代...\n`);

const base = runMonteCarlo(iterations, 20260612, 50);
const wide = runMonteCarlo(iterations, 20260612, 100);

const wideMap = new Map(wide.results.map((r) => [r.team, r]));

console.log('  排名  球队               σ=50夺冠   σ=100夺冠   变化');
console.log('  ' + '─'.repeat(58));
base.results.slice(0, 10).forEach((r, i) => {
  const w = wideMap.get(r.team);
  const delta = w.champion - r.champion;
  const sign = delta >= 0 ? '+' : '';
  console.log(
    `  ${String(i + 1).padStart(2)}    ${zh(r.team).padEnd(9, '　')}` +
    `${pct(r.champion).padStart(8)} ${pct(w.champion).padStart(10)}   ${sign}${(delta * 100).toFixed(1)}pp`
  );
});

// 验证 Top5 排序是否保持不变
const top5a = base.results.slice(0, 5).map((r) => r.team).join(',');
const top5b = wide.results.slice(0, 5).map((r) => r.team).join(',');
console.log('');
console.log(top5a === top5b
  ? '✓ Top 5 排序在 σ=100 下保持不变（符合方法论 7.3 预期）'
  : `⚠ Top 5 排序发生变化：\n  σ=50:  ${top5a}\n  σ=100: ${top5b}`);
