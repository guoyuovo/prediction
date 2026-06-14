#!/usr/bin/env node
// 下载国际比赛全历史数据集 → data/results.csv
//   来源：martj42/international_results（CC0 公共领域），约 4.9 万场，1872→今
// 用法：node scripts/fetch-data.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/util.mjs';

const URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';

console.log('下载国际比赛数据集 ...');
const res = await fetch(URL);
if (!res.ok) {
  console.error(`✗ 下载失败 HTTP ${res.status}`);
  process.exit(1);
}
const text = await res.text();
const out = join(ROOT, 'data', 'results.csv');
writeFileSync(out, text, 'utf-8');
const rows = text.split('\n').length - 1;
console.log(`✓ 已保存 ${rows} 行 → ${out}（${(text.length / 1024 / 1024).toFixed(1)}MB）`);
console.log('  下一步：node scripts/build-elo.mjs');
