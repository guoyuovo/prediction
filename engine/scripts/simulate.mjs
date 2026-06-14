#!/usr/bin/env node
// 蒙特卡洛模拟（默认 10,000 次 + Elo σ=50 高斯扰动）
// 用法: node scripts/simulate.mjs [--iterations 10000] [--seed 20260612] [--sigma 50]
// 输出 output/tournament-simulation-2026.json

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMonteCarlo } from '../src/tournament.mjs';
import { CFG } from '../src/model.mjs';
import { zh } from '../src/names.mjs';
import { ROOT, pct } from '../src/util.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const iterations = parseInt(arg('iterations', String(CFG.mc.iterations)), 10);
const seed = parseInt(arg('seed', '20260612'), 10);
const sigma = parseFloat(arg('sigma', String(CFG.mc.eloSigma)));

console.log(`蒙特卡洛模拟：${iterations.toLocaleString()} 次迭代 (seed=${seed}, Elo扰动 σ=${sigma}) ...`);
const t0 = Date.now();
const sim = runMonteCarlo(iterations, seed, sigma);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const outPath = join(ROOT, 'output', 'tournament-simulation-2026.json');
writeFileSync(outPath, JSON.stringify(sim, null, 2), 'utf-8');

console.log(`\n夺冠概率 TOP 12：\n`);
console.log('  排名  球队               32强    8强     4强     决赛    冠军');
console.log('  ' + '─'.repeat(64));
sim.results.slice(0, 12).forEach((r, i) => {
  const name = `${zh(r.team)}`.padEnd(9, '　');
  console.log(
    `  ${String(i + 1).padStart(2)}    ${name}` +
    `${pct(r.r32).padStart(6)} ${pct(r.qf).padStart(6)} ${pct(r.sf).padStart(6)} ${pct(r.final).padStart(6)} ${pct(r.champion).padStart(6)}`
  );
});
console.log(`\n✓ 用时 ${secs}s，完整结果写入 ${outPath}`);
