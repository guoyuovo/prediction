// 基础工具函数：sigmoid、可复现随机数、泊松采样、JSON 读取

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// mulberry32：可复现的伪随机数发生器（确定性模拟，符合文中“非 AI 拍脑袋”的可重复理念）
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Knuth 泊松采样
export function samplePoisson(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// 泊松概率质量函数
export function poissonPmf(k, lambda) {
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

export function loadJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf-8'));
}

export function pct(x) {
  return (x * 100).toFixed(1) + '%';
}
