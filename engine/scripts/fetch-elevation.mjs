#!/usr/bin/env node
// 抓 16 主办城市海拔（Open-Meteo elevation，免 key）→ data/venues-geo.json
//   海拔修正用：墨西哥城~2240m、瓜达拉哈拉~1566m 高原显著，其余近海平面。
// 用法：node scripts/fetch-elevation.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/util.mjs';
import { CITY } from '../src/venues.mjs';

const getJson = async (u) => { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

console.log('抓主办城市海拔（Open-Meteo）...');
const elevations = {};
for (const [city, , la, lo] of CITY) {
  try {
    const j = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
    const e = Array.isArray(j.elevation) ? j.elevation[0] : j.elevation;
    elevations[city] = { lat: la, lon: lo, elevation: Math.round(e) };
    console.log(`  ${city.padEnd(12)} ${Math.round(e)}m`);
  } catch (err) { console.log(`  ⚠ ${city}: ${err.message}`); elevations[city] = { lat: la, lon: lo, elevation: 0 }; }
}

writeFileSync(join(ROOT, 'data', 'venues-geo.json'), JSON.stringify({
  _note: '16 主办城市坐标 + 海拔（Open-Meteo elevation，免 key）。海拔修正/旅行距离用。',
  builtAt: new Date().toISOString(), elevations,
}, null, 2), 'utf-8');
const high = Object.entries(elevations).filter(([, v]) => v.elevation >= 1000).map(([k, v]) => `${k} ${v.elevation}m`);
console.log(`✓ → data/venues-geo.json（高原场地：${high.join(' · ') || '无'}）`);
