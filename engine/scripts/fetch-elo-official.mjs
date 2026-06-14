#!/usr/bin/env node
// 抓取 eloratings.net 官方真实 Elo（免 key）→ 覆盖 data/teams.json 的 elo
//   World.tsv: 国家代码 + 当前 Elo；en.teams.tsv: 代码 → 国名
//   只更新 elo 字段，form/xg/value/fifa 不变（form/xg 仍由 build-elo.mjs 计算）。
// 用法：node scripts/fetch-elo-official.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getText = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };

// 我方队名 → eloratings 队名（仅不一致的）
const ALIAS = {
  'USA': 'United States', "Cote d'Ivoire": 'Ivory Coast', 'Curacao': 'Curaçao',
  'Bosnia': 'Bosnia and Herzegovina',
};

console.log('抓取 eloratings.net 官方 Elo ...');
const codeName = await getText('https://www.eloratings.net/en.teams.tsv');
const c2n = {};
for (const l of codeName.split('\n')) { const [c, n] = l.split('\t'); if (c && n) c2n[c.trim()] = n.trim(); }
const world = await getText('https://www.eloratings.net/World.tsv');
const name2elo = {};
for (const l of world.split('\n')) { const c = l.split('\t'); if (c[2] && c[3]) { const nm = c2n[c[2].trim()]; if (nm) name2elo[nm] = Math.round(+c[3]); } }
console.log(`  解析 ${Object.keys(name2elo).length} 支球队的官方 Elo`);

const file = loadJson('data/teams.json');
let updated = 0; const missing = [];
for (const team of Object.keys(file.teams)) {
  const elo = name2elo[ALIAS[team] || team];
  if (elo == null) { missing.push(team); continue; }
  file.teams[team].elo = elo;
  updated++;
}
file._eloSource = `eloratings.net 官方 Elo（World.tsv），抓取于 ${new Date().toISOString()}`;
writeFileSync(join(ROOT, 'data', 'teams.json'), JSON.stringify(file, null, 2), 'utf-8');

console.log(`✓ 更新 ${updated}/${Object.keys(file.teams).length} 队官方 Elo → data/teams.json`);
if (missing.length) console.log('  ⚠ 未匹配（保留原值）：' + missing.join(', '));
const top = Object.entries(file.teams).sort((a, b) => b[1].elo - a[1].elo).slice(0, 6);
console.log('  TOP6：' + top.map(([k, v]) => k + ' ' + v.elo).join(' · '));
console.log('  下一步：node scripts/calibrate.mjs --apply（可选，重新校准）; node scripts/build-html.mjs');
