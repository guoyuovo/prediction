// 构建真实阵容评分 squad（EA FC 风格，~66–90 档）写入 data/teams.json。
//
//   数据真实性：
//   ① 文章已公布真实 EA 阵容评分的 24 队 → 直接采用（ground truth，两位小数）。
//   ② 其余 24 队 → 用真实官方 Elo（eloratings.net）经"在 ①24 队上拟合"的线性映射估算。
//      映射系数 squad = a·elo + b 由 ①标定（非拍脑袋），R²≈0.69。
//
//   说明：EA 阵容评分约 31% 方差是 EA 自家球员判断，Elo/身价都重建不出来；无可免费抓取的
//   全 48 队 EA 源（sofifa/futwiz 等均 Cloudflare 反爬），故 ② 为真实 Elo 标定估算，已显式标注。
//
//   依赖 elo 已是真实官方值（先跑 scripts/fetch-elo-official.mjs）。
//   用法：node scripts/build-squad-ratings.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/util.mjs';

// 文章 article-predictions.json 用中文队名，映射到 teams.json 的 key
const ZH2KEY = {
  '墨西哥': 'Mexico', '南非': 'South Africa', '韩国': 'South Korea', '捷克': 'Czechia',
  '加拿大': 'Canada', '波黑': 'Bosnia', '美国': 'USA', '巴拉圭': 'Paraguay',
  '卡塔尔': 'Qatar', '瑞士': 'Switzerland', '巴西': 'Brazil', '摩洛哥': 'Morocco',
  '海地': 'Haiti', '苏格兰': 'Scotland', '澳大利亚': 'Australia', '土耳其': 'Turkey',
  '德国': 'Germany', '库拉索': 'Curacao', '荷兰': 'Netherlands', '日本': 'Japan',
  '科特迪瓦': "Cote d'Ivoire", '厄瓜多尔': 'Ecuador', '瑞典': 'Sweden', '突尼斯': 'Tunisia',
};

const db = JSON.parse(readFileSync(join(ROOT, 'data', 'teams.json'), 'utf8'));
const art = JSON.parse(readFileSync(join(ROOT, 'data', 'article-predictions.json'), 'utf8'));

// ① 抽取文章真实 EA 阵容评分（24 队）
const real = {}; // key -> squad
for (const m of art.matches) {
  for (const [side, idx] of [['home', 0], ['away', 1]]) {
    const key = ZH2KEY[m[side]];
    const sq = Number(m.compare?.squad?.[idx]);
    if (key && db.teams[key] && Number.isFinite(sq)) real[key] = sq;
  }
}

// ② 在 24 队上最小二乘拟合 squad = a·elo + b
const pts = Object.entries(real).map(([k, s]) => [db.teams[k].elo, s]);
const n = pts.length;
let sx = 0, sy = 0, sxx = 0, sxy = 0;
for (const [e, s] of pts) { sx += e; sy += s; sxx += e * e; sxy += e * s; }
const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const b = (sy - a * sx) / n;
let sse = 0, sst = 0; const my = sy / n;
for (const [e, s] of pts) { const p = a * e + b; sse += (s - p) ** 2; sst += (s - my) ** 2; }
const r2 = 1 - sse / sst;

// 写入全 48 队
let nReal = 0, nMap = 0;
for (const key of Object.keys(db.teams)) {
  if (key in real) { db.teams[key].squad = real[key]; nReal++; }
  else { db.teams[key].squad = Math.round((a * db.teams[key].elo + b) * 100) / 100; nMap++; }
}

db._squadSource = `阵容评分：${nReal} 队为文章公布的真实 EA FC 评分；${nMap} 队由真实官方 Elo 经标定映射 squad=${a.toFixed(5)}·elo+${b.toFixed(2)}（在前 ${nReal} 队上拟合，R²=${r2.toFixed(2)}）估算。`;
db._squadFit = { a: Number(a.toFixed(6)), b: Number(b.toFixed(4)), r2: Number(r2.toFixed(4)), nReal };

writeFileSync(join(ROOT, 'data', 'teams.json'), JSON.stringify(db, null, 2) + '\n');

console.log(`✓ squad 写入 ${nReal + nMap}/48：真实EA ${nReal} 队 · Elo标定 ${nMap} 队`);
console.log(`  映射 squad = ${a.toFixed(5)}·elo + ${b.toFixed(2)}  R²=${r2.toFixed(3)}  RMSE=${Math.sqrt(sse / n).toFixed(2)}`);
console.log(`  已写回 data/teams.json`);
