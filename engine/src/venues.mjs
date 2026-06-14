// 场地地理：城市坐标 + 海拔 + 距离。供海拔修正、休息/旅行疲劳修正复用。
//   坐标来自 fetch-weather 的城市表；海拔由 fetch-elevation 抓 Open-Meteo 写入 venues-geo.json。
import { loadJson } from './util.mjs';

// venue 文本 → [城市key, lat, lon]（16 主办城市）
export const CITY = [
  ['MexicoCity', /Mexico City/i, 19.30, -99.15], ['Guadalajara', /Guadalajara|Zapopan/i, 20.67, -103.40],
  ['Monterrey', /Monterrey|Guadalupe/i, 25.69, -100.31], ['Atlanta', /Atlanta/i, 33.75, -84.39],
  ['Boston', /Boston|Foxborough/i, 42.09, -71.26], ['Dallas', /Arlington|Dallas/i, 32.75, -97.08],
  ['Houston', /Houston/i, 29.68, -95.41], ['KansasCity', /Kansas City/i, 39.05, -94.48],
  ['LosAngeles', /Inglewood|Los Angeles/i, 33.95, -118.34], ['Miami', /Miami/i, 25.96, -80.24],
  ['NewYork', /East Rutherford|New York|New Jersey/i, 40.81, -74.07], ['Philadelphia', /Philadelphia/i, 39.90, -75.17],
  ['BayArea', /Santa Clara|San Francisco|Bay Area/i, 37.40, -121.97], ['Seattle', /Seattle/i, 47.59, -122.33],
  ['Vancouver', /Vancouver/i, 49.28, -123.11], ['Toronto', /Toronto/i, 43.64, -79.39],
];

export function cityOf(venue) { for (const c of CITY) if (c[1].test(venue || '')) return c[0]; return null; }
export function coordsOf(venue) { for (const c of CITY) if (c[1].test(venue || '')) return [c[2], c[3]]; return null; }

// 海拔适应国家队（高原主场/球员常年高原）→ 高海拔场地获小幅 edge
export const ALTITUDE_TEAMS = new Set(['Mexico', 'Ecuador', 'Colombia']);

let _elev = null;
export function loadElevations() {
  if (_elev) return _elev;
  try { _elev = loadJson('data/venues-geo.json').elevations || {}; } catch { _elev = {}; }
  return _elev;
}
export function elevationOf(venue, elevMap) {
  const city = cityOf(venue); if (!city) return 0;
  const m = elevMap || loadElevations();
  return m[city]?.elevation ?? 0;
}

// 两坐标 haversine 距离（km）
export function haversine(a, b) {
  if (!a || !b) return 0;
  const R = 6371, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
