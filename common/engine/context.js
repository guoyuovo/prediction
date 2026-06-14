// 比赛情境修正（浏览器安全端口，逻辑同 src/context.mjs）。
// 海拔适应 + 休息/旅行疲劳 → 每场 { eloAdjHome, eloAdjAway, goalScale }。
// 无 fs 依赖；仅经 venues.js 间接读 store。

import { coordsOf, elevationOf, haversine, ALTITUDE_TEAMS, loadElevations } from './venues.js';

const accEdge = (team, elev) => (elev >= 1500 && ALTITUDE_TEAMS.has(team)) ? Math.round(Math.min(18, 0.012 * (elev - 1500))) : 0;
function fatigue(rest, travel) {
  let p = 0;
  if (rest < 4) p += 5 * (4 - rest);
  if (travel > 2500) p += Math.min(8, 4 * (travel - 2500) / 2500);
  return -Math.min(15, Math.round(p));
}

// fixtures：按开球时间排序的 [{home, away, date(YYYY-MM-DD), venue}]
export function buildContext(fixtures) {
  const elevMap = loadElevations();
  const last = {};
  const ctx = {};
  for (const f of fixtures) {
    const venue = f.venue || '';
    const elev = elevationOf(venue, elevMap);
    const co = coordsOf(venue);
    const rt = (team) => {
      const L = last[team];
      if (!L) return { rest: 7, travel: 0 };
      const rest = Math.max(0, Math.round((Date.parse(f.date) - Date.parse(L.date)) / 86400000));
      return { rest, travel: (L.co && co) ? haversine(L.co, co) : 0 };
    };
    const rh = rt(f.home), ra = rt(f.away);
    const eloAdjHome = accEdge(f.home, elev) + fatigue(rh.rest, rh.travel);
    const eloAdjAway = accEdge(f.away, elev) + fatigue(ra.rest, ra.travel);
    const goalScale = elev > 1000 ? +(1 + Math.min(0.06, 0.035 * (elev - 1000) / 1000)).toFixed(3) : 1;
    ctx[`${f.home}|${f.away}`] = {
      venue, elev, goalScale, eloAdjHome, eloAdjAway,
      restHome: rh.rest, restAway: ra.rest, travelHome: rh.travel, travelAway: ra.travel,
    };
    last[f.home] = { date: f.date, co }; last[f.away] = { date: f.date, co };
  }
  return ctx;
}
