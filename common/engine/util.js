// 基础工具函数：sigmoid、可复现随机数、泊松采样、JSON 读取（浏览器安全版）。
// 数学逻辑与 src/util.mjs 完全一致；仅去掉 node:fs/url/path，loadJson 改走可注入注册表。

import { loadJson as loadJsonFromStore } from './store.js';

// 兼容旧引用：原 src/util.mjs 暴露 ROOT 供 writeFileSync 拼路径。浏览器无文件系统，
// 这里保留一个占位常量，避免移植模块若引用 ROOT 时报错（本端口不写文件）。
export const ROOT = '';

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// mulberry32：可复现的伪随机数发生器（确定性模拟）
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

// loadJson：浏览器安全，转发到可注入注册表（store.js）。
export function loadJson(relPath) {
  return loadJsonFromStore(relPath);
}

export function pct(x) {
  return (x * 100).toFixed(1) + '%';
}
