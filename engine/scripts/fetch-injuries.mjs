#!/usr/bin/env node
// best-effort 抓 ESPN 各队伤停 → data/injuries.json（原始）+ 给出建议。
//   ⚠ 实测 ESPN fifa.world 的国家队 injuries 端点多为空——本脚本仅作兜底/探测，
//     真正可用的是人工策展 data/manual/squad-adjustments.json（见 src/adjust.mjs）。
// 用法：node scripts/fetch-injuries.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getJson = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

const teamsZh = loadJson('data/teams.json').teams;
const canon = Object.keys(teamsZh);
const ALIAS = { 'United States': 'USA', 'Czechia': 'Czechia', 'Bosnia and Herzegovina': 'Bosnia', "Côte d'Ivoire": "Cote d'Ivoire", 'Curaçao': 'Curacao', 'IR Iran': 'Iran' };
const toCanon = (espn) => { if (ALIAS[espn]) return ALIAS[espn]; if (teamsZh[espn]) return espn; const n = norm(espn); return canon.find((c) => norm(c) === n) || null; };

console.log('探测 ESPN 国家队伤停 ...');
let idMap = {};
try {
  const list = (await getJson('https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams')).sports[0].leagues[0].teams;
  for (const t of list) { const c = toCanon(t.team.displayName); if (c) idMap[c] = t.team.id; }
} catch (e) { console.log('  ⚠ teams 列表失败：' + e.message); }

const injuries = {}; let withInj = 0, totalInj = 0;
for (const [team, id] of Object.entries(idMap)) {
  try {
    const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${id}/injuries`);
    const items = j.injuries || j.items || [];
    if (items.length) {
      withInj++;
      injuries[team] = items.map((it) => ({ name: it.athlete?.displayName || it.displayName || '?', status: it.status || it.type?.description || '?', detail: it.details?.type || it.shortComment || '' }));
      totalInj += items.length;
    }
  } catch { /* 端点常空/404，忽略 */ }
}

writeFileSync(join(ROOT, 'data', 'injuries.json'), JSON.stringify({
  _note: 'ESPN 国家队伤停探测结果（best-effort）。国家队伤停多为空——以 data/manual/squad-adjustments.json 人工策展为准。',
  builtAt: new Date().toISOString(), teamsProbed: Object.keys(idMap).length, teamsWithInjuries: withInj, totalInjuries: totalInj, injuries,
}, null, 2), 'utf-8');

console.log(`  探测 ${Object.keys(idMap).length} 队，${withInj} 队有伤停记录，共 ${totalInj} 条 → data/injuries.json`);
if (!totalInj) {
  console.log('  （ESPN API 端点未提供国家队伤停，符合预期）');
  console.log('  ✅ 可靠免费源是【伤停追踪页】，用 Claude WebFetch 结构化提取后写入 data/manual/squad-adjustments.json：');
  console.log('     · ESPN: https://www.espn.com/soccer/story/_/id/48572979/2026-fifa-world-cup-injuries-tracker-which-stars-miss-latest-info');
  console.log('     · Flashscore / Covers / worldcupwiki 亦有伤停列表');
  console.log('     （纯 node 无法跑 WebFetch；自动化需 Claude /schedule 云代理，或 API-Football /injuries 付费 key）');
}
else for (const [t, arr] of Object.entries(injuries)) console.log(`  ${t}: ` + arr.map((x) => `${x.name}(${x.status})`).join(', '));
console.log('  调整在 v2/双模型的未来场次预测生效（src/adjust.mjs）。');
