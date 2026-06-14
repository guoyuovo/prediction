#!/usr/bin/env node
// 纯 node 自主抓伤停：API-Football /injuries（结构化 JSON）→ data/manual/injuries-suggested.json
//   这是「node 能不能拿到伤停」的干净答案：能，但需一个免费 API key。
//   免费 key：https://www.api-football.com/ 注册（或 RapidAPI 的 API-Football），免费层 100 次/天。
//   用法：APIFOOTBALL_KEY=你的key node scripts/fetch-injuries-api.mjs
//   产出是「建议稿」injuries-suggested.json（不直接覆盖人工策展的 squad-adjustments.json，需你过目搬运）。
//   ⚠ 无 key 时优雅退出并给指引；此脚本未在真实 key 下端到端验证，字段映射可能需按实际响应微调。

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const KEY = process.env.APIFOOTBALL_KEY || process.env.API_FOOTBALL_KEY || '';
const SEASON = +(process.env.WC_SEASON || 2026);
const LEAGUE = +(process.env.WC_LEAGUE_ID || 1); // API-Football：World Cup = 1

if (!KEY) {
  console.log('未设置 APIFOOTBALL_KEY —— node 完全有能力抓，只差一个免费 key：');
  console.log('  1) 去 https://www.api-football.com/ 免费注册拿 key（免费层 100 次/天）');
  console.log('  2) APIFOOTBALL_KEY=你的key node scripts/fetch-injuries-api.mjs');
  console.log('  无 key 时的替代：① Claude /schedule 跑 WebFetch 抓 ESPN 伤停追踪页（免 key，最稳）');
  console.log('                  ② 直接编辑 data/manual/squad-adjustments.json 人工录入');
  process.exit(0);
}

const teams = loadJson('data/teams.json').teams;
const canon = Object.keys(teams);
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const ALIAS = { 'united states': 'USA', czechia: 'Czechia', 'czech republic': 'Czechia', 'bosnia and herzegovina': 'Bosnia', "côte d'ivoire": "Cote d'Ivoire", 'ivory coast': "Cote d'Ivoire", curaçao: 'Curacao', 'cape verde': 'Cape Verde', 'dr congo': 'DR Congo', iran: 'Iran', 'south korea': 'South Korea' };
const toCanon = (name) => { const n = norm(name); if (ALIAS[(name || '').toLowerCase()]) return ALIAS[(name || '').toLowerCase()]; return canon.find((c) => norm(c) === n) || null; };

// 伤停严重度 → 单人 Elo 惩罚权重（粗略；"Missing Fixture/长期"重于"Questionable"）
const sev = (type) => /out|injur|surgery|acl|ruptur|fracture|torn|achill/i.test(type || '') ? 16 : /doubt|question/i.test(type || '') ? 6 : 12;

console.log(`API-Football /injuries：league=${LEAGUE} season=${SEASON} ...`);
let rows = [];
try {
  const r = await fetch(`https://v3.football.api-sports.io/injuries?league=${LEAGUE}&season=${SEASON}`, { headers: { 'x-apisports-key': KEY } });
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) console.log('  API 提示:', JSON.stringify(j.errors));
  rows = j.response || [];
} catch (e) { console.log('  抓取失败:', e.message); process.exit(1); }
console.log(`  返回 ${rows.length} 条伤停记录`);

const byTeam = {};
for (const it of rows) {
  const team = toCanon(it.team?.name);
  if (!team) continue;
  (byTeam[team] ||= []).push({ player: it.player?.name || '?', type: it.player?.type || it.player?.reason || '', reason: it.player?.reason || '' });
}

const adjustments = {};
for (const [team, list] of Object.entries(byTeam)) {
  const pen = Math.min(80, list.reduce((s, p) => s + sev(p.type), 0));
  adjustments[team] = { eloPenalty: pen, reason: list.map((p) => `${p.player}(${p.type || p.reason || '伤'})`).join('+'), active: true };
}

writeFileSync(join(ROOT, 'data', 'manual', 'injuries-suggested.json'), JSON.stringify({
  _note: 'API-Football 自动抓取的伤停【建议稿】。请过目后把合适条目搬到 squad-adjustments.json（penalty 为粗略累加，按阵容深度/市场是否已price-in自行调整）。',
  _source: 'API-Football /injuries', _builtAt: new Date().toISOString(), adjustments,
}, null, 2), 'utf-8');

console.log(`✓ ${Object.keys(adjustments).length} 队有伤停 → data/manual/injuries-suggested.json（建议稿，需过目搬运）`);
for (const [t, a] of Object.entries(adjustments)) console.log(`  ${t} -${a.eloPenalty}: ${a.reason}`);
