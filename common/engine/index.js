// 浏览器安全预测入口（无 node:*）。
//
// computePredictions(data) 复刻 scripts/build-html.mjs 中 `matches` 数组的生成逻辑：
//   基础 teams + 情境修正(context) → src/model.mjs predictMatch（neutral / goalScale）。
//   并额外按 scripts/build-elo-v2.mjs 计算滚动 Elo（teamsV2 + 回测摘要）。
//
// 刷新正确性：每次调用都 setData(...) 整表替换注入最新数据；所有移植模块在【调用时】
// 从 store 读数（非模块顶层 const），故第二次用不同 results 重算会反映新结果。

import { setData } from './store.js';
import { predictMatch } from './model.js';
import { buildSchedule } from './schedule.js';
import { buildContext } from './context.js';
import { buildEloV2 } from './elo-v2.js';

/**
 * 计算 72 场预测（+ 可选 v2 滚动 Elo / 回测摘要）。
 *
 * @param {object} data 内存数据对象（键即 src 中 loadJson 用的相对路径所需内容）：
 *   必填：
 *     base        = teams.json 整体（{ teams: {...} }）
 *     groups      = groups.json 整体（{ groups, hosts }）
 *     schedule2026= schedule-2026.json 整体（{ fixtures }）
 *     modelCfg    = config/model.json 整体
 *     matchOdds   = match-odds.json 整体（{ odds, meta }）—— 赔率子模型 + 场地来源
 *   可选（缺省则相应修正退化为无影响）：
 *     weather     = weather.json 整体（{ weather }）—— 场地来源备选
 *     venuesGeo   = venues-geo.json 整体（{ elevations }）—— 海拔修正
 *     teamXg      = team-xg.json 整体（主模型不用，留作兼容/集成扩展）
 *     results     = wc-results.json 整体（{ results }）—— v2 滚动 Elo 输入
 *     modelEnsembleCfg = config/model-ensemble.json（集成模型，可选）
 *   开关：
 *     withV2      = 是否计算 v2 滚动 Elo（默认：有 results 时计算）
 *
 * @returns {{ matches: Array, teamsV2?: object, v2Backtest?: object }}
 *   matches[i] = { seq, round, group, date, time, weekday, kickoff,
 *                  home, away, homeAdv, pHome, pDraw, pAway, pick, score, expGoals }
 */
export function computePredictions(data) {
  const {
    base, groups, schedule2026, modelCfg, matchOdds,
    weather, venuesGeo, teamXg, results, modelEnsembleCfg,
    withV2,
  } = data || {};

  // —— 注入数据到 store（键 = src 中 loadJson 入参）——
  const reg = {
    'data/teams.json': base,
    'data/groups.json': groups,
    'data/schedule-2026.json': schedule2026,
    'config/model.json': modelCfg,
    'data/match-odds.json': matchOdds,
  };
  if (weather) reg['data/weather.json'] = weather;
  if (venuesGeo) reg['data/venues-geo.json'] = venuesGeo;
  if (teamXg) reg['data/team-xg.json'] = teamXg;
  if (results) reg['data/wc-results.json'] = results;
  if (modelEnsembleCfg) reg['config/model-ensemble.json'] = modelEnsembleCfg;
  setData(reg);

  const teamsData = base.teams;
  const HOSTS = new Set(groups.hosts);
  const oddsMeta = (matchOdds && matchOdds.meta) || {};
  const weatherData = (weather && weather.weather) || {};

  // —— 72 场（按真实赛程时间排序）——
  const schedule = buildSchedule();

  // 场地情境：venue 来源同 build-html（oddsMeta.venue → weather.venue）
  const venueOf = (h, a) => {
    const k = `${h} vs ${a}`;
    return (oddsMeta[k] && oddsMeta[k].venue) || (weatherData[k] && weatherData[k].venue) || '';
  };
  const CTX = buildContext(schedule.map((s) => ({ home: s.home, away: s.away, date: s.date, venue: venueOf(s.home, s.away) })));
  const ctxOf = (h, a) => CTX[`${h}|${a}`] || { goalScale: 1, eloAdjHome: 0, eloAdjAway: 0 };

  const matches = schedule.map((s) => {
    const homeAdv = HOSTS.has(s.home) && !HOSTS.has(s.away);
    const c = ctxOf(s.home, s.away);
    const Hc = { name: s.home, ...teamsData[s.home], elo: teamsData[s.home].elo + (c.eloAdjHome || 0) };
    const Ac = { name: s.away, ...teamsData[s.away], elo: teamsData[s.away].elo + (c.eloAdjAway || 0) };
    const p = predictMatch(Hc, Ac, { neutral: !homeAdv, goalScale: c.goalScale || 1 });
    const pick = p.pHome >= p.pDraw && p.pHome >= p.pAway ? 'H' : p.pAway >= p.pDraw ? 'A' : 'D';
    return {
      seq: s.seq, round: s.round, group: s.group,
      date: s.date, time: s.time, weekday: s.weekday, kickoff: s.kickoff,
      home: p.home, away: p.away, homeAdv,
      pHome: p.pHome, pDraw: p.pDraw, pAway: p.pAway,
      pick, score: p.score,
      expGoals: { home: p.expGoals.home, away: p.expGoals.away },
    };
  });

  const out = { matches };

  // —— v2 滚动 Elo（可选）——
  const doV2 = withV2 != null ? withV2 : !!(results && (results.results || []).length);
  if (doV2 && results) {
    const v2 = buildEloV2();
    out.teamsV2 = v2.teamsV2;
    out.v2Backtest = v2.backtest;
  }

  return out;
}

export { setData } from './store.js';
export { predictMatch, getTeam, listTeams } from './model.js';
export { buildSchedule } from './schedule.js';
export { buildContext } from './context.js';
export { buildEloV2 } from './elo-v2.js';
