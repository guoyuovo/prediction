// 客户端"重算"编排：抓 ESPN 完赛 → 跑引擎(预测+滚动Elo+夺冠MC) → 并进打包数据 → 输出 App 数据形状。
//   纯函数:种子(seeds)与打包基线(bundled)由调用方注入(Vue 用 import / Node 测试用 fs)。无 node:*、无 JSON import。
//
//   设计要点:用打包种子时,逐场预测与打包基线【完全一致】(已 _verify 72/72),
//   故"重算"真正带来的新值 = 新完赛结果 + 对账 + 随赛果滚动的夺冠/出线概率。
//   展示性富字段(赔率/场地/天气/cmp/让球/大小球)沿用打包基线,只覆盖 h/d/a/score + result。

import { computePredictions, computeChampions } from './index.js';
import { fetchResults } from './fetch-sources.js';

const dirOf = (hs, as) => (hs > as ? 'H' : hs < as ? 'A' : 'D');

/**
 * @param {object} o
 *   seeds   = { base, groups, schedule2026, modelCfg, modelEnsembleCfg, matchOdds, weather, venuesGeo, teamXg, squadAdj }
 *   bundled = 打包基线数据集 { meta, teams, champions, matches, v2, dual, experts }
 *   iterations = 夺冠 MC 次数(客户端默认 3000,够稳又快;打包基线用 10000)
 * @returns 同 bundled 形状,但 matches 并入新结果/对账、champions 用最新滚动概率、meta 时间更新
 */
export async function recompute({ seeds, bundled, iterations = 3000, now = null, withSummary = true } = {}) {
  const canonNames = Object.keys(seeds.base.teams);
  // 1) 抓最新完赛比分(浏览器直连 ESPN)
  const wc = await fetchResults({ fixtures: seeds.schedule2026.fixtures, canonNames, withSummary, now });

  const data = {
    base: seeds.base, groups: seeds.groups, schedule2026: seeds.schedule2026,
    modelCfg: seeds.modelCfg, modelEnsembleCfg: seeds.modelEnsembleCfg, matchOdds: seeds.matchOdds,
    weather: seeds.weather, venuesGeo: seeds.venuesGeo, teamXg: seeds.teamXg, squadAdj: seeds.squadAdj,
    results: wc, withV2: true,
  };

  // 2) 预测 + v2 逐场对账(轻)
  const pred = computePredictions(data);
  const predBySeq = new Map(pred.matches.map((m) => [m.seq, m]));
  const backBypair = new Map(((pred.v2Backtest && pred.v2Backtest.matches) || []).map((b) => [`${b.home}|${b.away}`, b]));

  // 3) 夺冠/出线(重,MC)
  const champ = computeChampions(data, { iterations });

  // 4) 并进打包基线
  const resByPair = new Map();
  for (const r of wc.results) resByPair.set(`${r.home}|${r.away}`, r);

  const matches = (bundled.matches.matches || []).map((bm) => {
    const m = { ...bm };
    const p = predBySeq.get(bm.seq);
    if (p) { m.h = p.pHome; m.d = p.pDraw; m.a = p.pAway; m.pick = p.pick; m.score = p.score; }
    const r = resByPair.get(`${bm.home}|${bm.away}`);
    if (r) {
      const back = backBypair.get(`${bm.home}|${bm.away}`);
      m.result = {
        hs: r.hs, as: r.as, r: dirOf(r.hs, r.as),
        ht: r.htHome != null ? `${r.htHome}-${r.htAway}` : null,
        stats: r.stats || null, goals: bm.result && bm.result.goals || [],
        pre: back ? {
          predOutcome: back.predOutcome, predScore: back.predScore,
          correct: back.correct, scoreHit: back.scoreHit,
          p: [back.pHome, back.pDraw, back.pAway],
        } : null,
      };
    } else {
      m.result = null;
    }
    return m;
  });

  const iso = (now ? new Date(now) : new Date()).toISOString();
  return {
    ...bundled,
    meta: { ...bundled.meta, fetchedAt: wc._fetchedAt, lastUpdate: iso, source: 'client' },
    matches: { matches },
    champions: {
      champions: champ.champions,
      base: bundled.champions.base,
      groups: champ.groups,
    },
  };
}
