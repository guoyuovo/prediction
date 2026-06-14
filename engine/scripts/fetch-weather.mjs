#!/usr/bin/env node
// 各场比赛日天气 → data/weather.json（Open-Meteo，免 key）
//   按场地城市坐标 + 比赛日期（美东时间）抓最高/最低温、降水、风速。
// 用法：node scripts/fetch-weather.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { buildSchedule } from '../src/schedule.mjs';

// 16 座主办城市坐标（按场地 city 关键词匹配）
const CITY = [
  [/Mexico City/i, 19.30, -99.15], [/Guadalajara|Zapopan/i, 20.67, -103.40],
  [/Monterrey|Guadalupe/i, 25.69, -100.31], [/Atlanta/i, 33.75, -84.39],
  [/Boston|Foxborough/i, 42.09, -71.26], [/Arlington|Dallas/i, 32.75, -97.08],
  [/Houston/i, 29.68, -95.41], [/Kansas City/i, 39.05, -94.48],
  [/Inglewood|Los Angeles/i, 33.95, -118.34], [/Miami/i, 25.96, -80.24],
  [/East Rutherford|New York|New Jersey/i, 40.81, -74.07], [/Philadelphia/i, 39.90, -75.17],
  [/Santa Clara|San Francisco|Bay Area/i, 37.40, -121.97], [/Seattle/i, 47.59, -122.33],
  [/Vancouver/i, 49.28, -123.11], [/Toronto/i, 43.64, -79.39],
];
const coords = (venue) => { for (const [re, la, lo] of CITY) if (re.test(venue || '')) return [la, lo]; return null; };

const meta = loadJson('data/match-odds.json').meta || {};
const schedule = buildSchedule();
const dateOf = Object.fromEntries(schedule.map((s) => [`${s.home} vs ${s.away}`, s.et.slice(0, 10)]));

const cache = new Map(); // "lat,lon,date" -> daily
async function fetchDay(la, lo, date) {
  const key = `${la},${lo},${date}`;
  if (cache.has(key)) return cache.get(key);
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`;
  try {
    const j = await (await fetch(u)).json();
    const d = j.daily;
    const out = d && d.time?.length ? {
      tmax: d.temperature_2m_max[0], tmin: d.temperature_2m_min[0],
      precip: d.precipitation_sum[0], wind: d.wind_speed_10m_max[0],
    } : null;
    cache.set(key, out); return out;
  } catch { return null; }
}

console.log('抓取各场天气（Open-Meteo）...');
const weather = {};
let n = 0, noCoord = 0;
for (const [key, m] of Object.entries(meta)) {
  const c = coords(m.venue); const date = dateOf[key];
  if (!c || !date) { noCoord++; continue; }
  const w = await fetchDay(c[0], c[1], date);
  if (w) { weather[key] = { ...w, venue: m.venue }; n++; }
}

writeFileSync(join(ROOT, 'data', 'weather.json'), JSON.stringify({
  _note: '各场比赛日天气（Open-Meteo 预报，免 key）。tmax/tmin 摄氏度，precip 毫米，wind km/h。',
  _fetchedAt: new Date().toISOString(), weather,
}, null, 2), 'utf-8');
console.log(`✓ 写入 ${n} 场天气 → data/weather.json` + (noCoord ? `（${noCoord} 场缺场地坐标）` : ''));
console.log('  下一步：node scripts/build-html.mjs');
