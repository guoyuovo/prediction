// 场地地理（浏览器安全端口，逻辑同 src/venues.mjs）。
// 改动：loadElevations 去掉模块级缓存 _elev，改为每次从 store 读取（刷新正确：
//        重算注入新 venues-geo.json 时不被陈旧缓存挡住）；缺失则返回 {}。

import { loadJson } from './util.js';
import { hasData } from './store.js';

// venue 文本 → [城市key, 正则, lat, lon]（16 主办城市）
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

// 海拔适应国家队
export const ALTITUDE_TEAMS = new Set(['Mexico', 'Ecuador', 'Colombia']);

export function loadElevations() {
  if (!hasData('data/venues-geo.json')) return {};
  return loadJson('data/venues-geo.json').elevations || {};
}
export function elevationOf(venue, elevMap) {
  const city = cityOf(venue); if (!city) return 0;
  const m = elevMap || loadElevations();
  return (m[city] && m[city].elevation != null) ? m[city].elevation : 0;
}

// 两坐标 haversine 距离（km）
export function haversine(a, b) {
  if (!a || !b) return 0;
  const R = 6371, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}
