// 比赛情境修正（针对 WC2026 的真实物理因素，俱乐部数据无法回测，故为【谨慎·先验型】小修正）：
//   ① 海拔：墨西哥城~2254m/瓜达拉哈拉~1607m。高原→总进球略增(疲劳+球速)；适应队(墨/厄/哥)获小幅 edge。
//   ② 休息/旅行：背靠背(<4天)或跨洲长途(>2500km)→该队小幅疲劳惩罚（美加墨横跨数千公里）。
//   产出每场 { eloAdjHome, eloAdjAway, goalScale }——eloAdj 折进有效 Elo（影响胜负+比分），goalScale 缩放总进球。
//   幅度刻意小（单项封顶±18 Elo / 进球±6%），只“轻推”不主导，且明确标注未经回测。
import { coordsOf, elevationOf, haversine, ALTITUDE_TEAMS, loadElevations } from './venues.mjs';

const accEdge = (team, elev) => (elev >= 1500 && ALTITUDE_TEAMS.has(team)) ? Math.round(Math.min(18, 0.012 * (elev - 1500))) : 0;
function fatigue(rest, travel) {
  let p = 0;
  if (rest < 4) p += 5 * (4 - rest);            // 3天-5 / 2天-10 / 1天-15
  if (travel > 2500) p += Math.min(8, 4 * (travel - 2500) / 2500); // 跨洲长途，封顶-8
  return -Math.min(15, Math.round(p));
}

// fixtures：按开球时间排序的 [{home, away, date(YYYY-MM-DD), venue}]
export function buildContext(fixtures) {
  const elevMap = loadElevations();
  const last = {}; // team -> {date, co}
  const ctx = {};
  for (const f of fixtures) {
    const venue = f.venue || '';
    const elev = elevationOf(venue, elevMap);
    const co = coordsOf(venue);
    const rt = (team) => {
      const L = last[team];
      if (!L) return { rest: 7, travel: 0 }; // 首战：充分休息、无累计旅行
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
