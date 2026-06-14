// v2 滚动 Elo（浏览器安全端口，逻辑同 scripts/build-elo-v2.mjs）。
// 以基础真实 Elo 为起点，对已完赛比赛做标准 World Football Elo 滚动（K=60, MOV 修正，
// 东道主本土 +HOME_BONUS），并返回滚动后的 teams-v2 表 + 样本外回测摘要。
// 不写文件；输入全部来自 store（teams.json / groups.json / wc-results.json + config）。

import { loadJson } from './util.js';
import { predictMatch, getCfg } from './model.js';

const movG = (gd) => (gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8);
const oneHot = (o) => ({ H: o === 'H' ? 1 : 0, D: o === 'D' ? 1 : 0, A: o === 'A' ? 1 : 0 });

/**
 * 计算 v2 滚动 Elo。返回 { teamsV2, backtest }。
 * teamsV2 形如 teams.json：{ ...base, teams: {name: {...t, elo}}, _v2meta }。
 */
export function buildEloV2() {
  const CFG = getCfg();
  const K = CFG.elo.kFactor ?? 60;
  const HOME_BONUS = CFG.elo.homeBonus ?? 60;

  const base = loadJson('data/teams.json');
  const teams = base.teams;
  const hosts = new Set(loadJson('data/groups.json').hosts);
  const wc = loadJson('data/wc-results.json');
  const played = wc.results || [];

  const elo = {};
  for (const [name, t] of Object.entries(teams)) elo[name] = t.elo;
  const eloStart = { ...elo };

  const log = [];
  let sBrier = 0, sLogloss = 0, nCorrect = 0, nScoreHit = 0, nDirHit = 0;

  for (const m of played) {
    const { home, away, hs, as } = m;
    if (teams[home] == null || teams[away] == null) continue;

    const Hobj = { name: home, ...teams[home], elo: elo[home] };
    const Aobj = { name: away, ...teams[away], elo: elo[away] };
    const pred = predictMatch(Hobj, Aobj); // neutral 默认 true
    const actual = hs > as ? 'H' : hs < as ? 'A' : 'D';
    const p = { H: pred.pHome, D: pred.pDraw, A: pred.pAway };
    const predOutcome = p.H >= p.D && p.H >= p.A ? 'H' : p.A >= p.D ? 'A' : 'D';
    const y = oneHot(actual);
    const brier = (p.H - y.H) ** 2 + (p.D - y.D) ** 2 + (p.A - y.A) ** 2;
    const logloss = -Math.log(Math.max(p[actual], 1e-9));
    const correct = predOutcome === actual;
    const scoreHit = pred.score === `${hs}-${as}`;
    sBrier += brier; sLogloss += logloss; if (correct) nCorrect++; if (scoreHit) nScoreHit++; if (correct) nDirHit++;

    const homeAdv = hosts.has(home) && !hosts.has(away);
    const dr = elo[home] - elo[away] + (homeAdv ? HOME_BONUS : 0);
    const weHome = 1 / (1 + 10 ** (-dr / 400));
    const wHome = hs > as ? 1 : hs === as ? 0.5 : 0;
    const delta = K * movG(Math.abs(hs - as)) * (wHome - weHome);
    const eloBefore = { home: elo[home], away: elo[away] };
    elo[home] = Math.round((elo[home] + delta) * 10) / 10;
    elo[away] = Math.round((elo[away] - delta) * 10) / 10;

    log.push({
      et: m.et, group: m.group, home, away, hs, as,
      ht: m.htHome != null ? `${m.htHome}-${m.htAway}` : null,
      actual, predOutcome, correct,
      pHome: +p.H.toFixed(3), pDraw: +p.D.toFixed(3), pAway: +p.A.toFixed(3),
      predScore: pred.score, scoreHit, brier: +brier.toFixed(3), logloss: +logloss.toFixed(3),
      homeAdv, eloDelta: +delta.toFixed(1),
      eloHomeBefore: eloBefore.home, eloHomeAfter: elo[home],
      eloAwayBefore: eloBefore.away, eloAwayAfter: elo[away],
    });
  }

  const v2 = { ...base, teams: {} };
  const eloChanges = [];
  for (const [name, t] of Object.entries(teams)) {
    v2.teams[name] = { ...t, elo: elo[name] };
    if (elo[name] !== eloStart[name]) eloChanges.push({ team: name, before: eloStart[name], after: elo[name], delta: +(elo[name] - eloStart[name]).toFixed(1) });
  }
  eloChanges.sort((a, b) => b.delta - a.delta);
  v2._v2meta = {
    note: 'v2：基础官方真实 Elo 起点 + 已完赛比赛标准 Elo 滚动更新（K=' + K + '，MOV 修正，东道主本土 +' + HOME_BONUS + '）。其余字段沿用基础真实值。',
    basedOn: base._eloSource || '(teams.json elo)',
    scoresFrom: wc._source,
    matchesApplied: log.length,
  };

  const n = log.length || 1;
  const summary = {
    matches: log.length,
    accuracy1X2: +(nCorrect / n).toFixed(3),
    brierAvg: +(sBrier / n).toFixed(3),
    loglossAvg: +(sLogloss / n).toFixed(3),
    scoreHit: +(nScoreHit / n).toFixed(3),
    dirHit: +(nDirHit / n).toFixed(3),
  };
  let cc = 0, cb = 0;
  const timeline = log.map((m, i) => { cc += m.correct ? 1 : 0; cb += m.brier; return { i: i + 1, et: m.et, label: `${m.home}-${m.away}`, accCum: +(cc / (i + 1)).toFixed(3), brierCum: +(cb / (i + 1)).toFixed(3) }; });
  const calBins = [[0, 0.45], [0.45, 0.55], [0.55, 0.65], [0.65, 1.01]];
  const calibration = calBins.map(([lo, hi]) => {
    const sub = log.filter((m) => { const mx = Math.max(m.pHome, m.pDraw, m.pAway); return mx >= lo && mx < hi; });
    const hit = sub.filter((m) => m.correct).length;
    return { range: `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`, n: sub.length, hitRate: sub.length ? +(hit / sub.length).toFixed(3) : null };
  });

  return {
    teamsV2: v2,
    backtest: { summary, matches: log, eloChanges, timeline, calibration },
  };
}
