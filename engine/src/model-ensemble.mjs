// 多因子加权集成模型（《2026 世界杯预测体系方法论》）
//
//   子模型              权重    职责
//   Elo 评分模型        35%    历史对战实力 → 1X2
//   xG 效率模型         25%    攻防效率（泊松）→ 1X2 + 比分
//   市场赔率模型        20%    去水位隐含概率 + 热门偏差修正 → 1X2
//   蒙特卡洛模拟        20%    赛事级概率分布（见 src/tournament.mjs，不参与单场点估计）
//
//   Elo 核心公式：E_A = 1 / (1 + 10^((R_B - R_A) / 400))
//   足球适配：主场/东道主 +100 Elo；世界杯 K=60（赛后更新用，本项目仅记录）
//   单场集成 = 各可用子模型概率向量按权重归一加权

import { sigmoid, clamp, poissonPmf, loadJson } from './util.mjs';

const CFG = loadJson('config/model-ensemble.json');
const TEAMS = loadJson('data/teams.json').teams;
const XG = loadJson('data/team-xg.json').teams;
const ODDS = loadJson('data/match-odds.json').odds;
const HOSTS = new Set(loadJson('data/groups.json').hosts);
const LN10 = Math.log(10);

// 市场热门偏差修正对象：Elo 前 N 的热门队
const FAVORITES = new Set(
  Object.entries(TEAMS)
    .sort((a, b) => b[1].elo - a[1].elo)
    .slice(0, CFG.market.favoriteTopN)
    .map(([n]) => n)
);

export function getTeam(name) {
  const t = TEAMS[name];
  if (!t) throw new Error(`未知球队: ${name}（请检查 data/teams.json）`);
  return { name, ...t };
}

export function listTeams() {
  return Object.keys(TEAMS);
}

// ── 子模型 1：Elo 评分模型（35%）──────────────────────────────
function eloSubmodel(H, A, opts) {
  let d = H.elo - A.elo;
  // 东道主（美墨加）自动获得 +100；双东道主相遇则抵消
  if (HOSTS.has(H.name) && !HOSTS.has(A.name)) d += CFG.elo.hostBonus;
  if (HOSTS.has(A.name) && !HOSTS.has(H.name)) d -= CFG.elo.hostBonus;
  // 显式指定主场（如 --neutral false）时额外 +100
  if (opts.neutral === false) d += CFG.elo.homeBonus;
  // Elo 差尺度校准（config 历史标定值；默认 1 = 不变）
  d *= CFG.elo.diffScale ?? 1;

  // E = 1/(1+10^(-d/400)) ≡ sigmoid(d/400 · ln10)
  const muE = (d / CFG.elo.scale) * LN10;
  const E = sigmoid(muE);

  // Elo 期望只分胜负，用平局模型展开为 1X2
  const dr = CFG.draw;
  const pD = clamp(
    dr.base * Math.exp((-dr.decay * Math.abs(muE)) / dr.tendency) * Math.exp(dr.bias),
    0.04, 0.5
  );
  return { h: (1 - pD) * E, d: pD, a: (1 - pD) * (1 - E), eloDiff: d, expectancy: E };
}

// ── 子模型 2：xG 效率模型（25%）──────────────────────────────
// xgTable 可注入（如 team-xg-v2 滚动攻防）；缺省用基础 team-xg.json。
function xgSubmodel(H, A, homeAdv, xgTable) {
  const x = CFG.xg;
  const T = xgTable || XG;
  const xh = T[H.name];
  const xa = T[A.name];
  if (!xh || !xa) return null;

  // 近期状态以 ±10% 微调攻防效率
  const attH = xh.att * (1 + x.formImpact * (H.form || 0));
  const defH = xh.def * (1 - x.formImpact * (H.form || 0));
  const attA = xa.att * (1 + x.formImpact * (A.form || 0));
  const defA = xa.def * (1 - x.formImpact * (A.form || 0));

  // 主场/东道主加成：主队进球期望上浮、客队下压（与 Elo 的 +100 主场优势一致）
  const hb = homeAdv ? (x.homeBoost || 1) : 1;
  const ad = homeAdv ? (x.awayDamp || 1) : 1;
  const lambdaH = ((attH * defA) / x.leagueAvg) * hb;
  const lambdaA = ((attA * defH) / x.leagueAvg) * ad;

  // 泊松网格 → 胜平负
  let h = 0, d = 0, a = 0;
  for (let gh = 0; gh <= x.maxGoals; gh++) {
    const ph = poissonPmf(gh, lambdaH);
    for (let ga = 0; ga <= x.maxGoals; ga++) {
      const p = ph * poissonPmf(ga, lambdaA);
      if (gh > ga) h += p;
      else if (gh === ga) d += p;
      else a += p;
    }
  }
  const s = h + d + a; // 截断尾部后归一
  return { h: h / s, d: d / s, a: a / s, lambdaH, lambdaA };
}

// ── 子模型 3：市场赔率模型（20%）─────────────────────────────
function marketSubmodel(H, A) {
  let o = ODDS[`${H.name} vs ${A.name}`];
  let flipped = false;
  if (!o) {
    o = ODDS[`${A.name} vs ${H.name}`];
    if (o) flipped = true;
  }
  if (!o) return null;
  let [oh, od, oa] = flipped ? [o[2], o[1], o[0]] : o;

  // 第一步：去庄家水位（隐含概率 / 总和）
  let ph = 1 / oh, pd = 1 / od, pa = 1 / oa;
  const margin = ph + pd + pa; // 通常 1.03~1.08
  ph /= margin; pd /= margin; pa /= margin;

  // 第二步：热门偏差修正——热门强队隐含概率向下修 4%
  if (FAVORITES.has(H.name) && ph >= pa) ph *= 1 - CFG.market.favoriteBias;
  else if (FAVORITES.has(A.name) && pa > ph) pa *= 1 - CFG.market.favoriteBias;
  const s = ph + pd + pa;
  return { h: ph / s, d: pd / s, a: pa / s, margin, odds: [oh, od, oa] };
}

// ── 集成 ─────────────────────────────────────────────────────
/**
 * 单场比赛预测（多因子加权集成）。
 * @param {string|object} home 主队名或球队对象（蒙特卡洛扰动时传对象）
 * @param {string|object} away 客队
 * @param {object} opts { neutral:false 显式主场加成, scores:false 跳过比分枚举 }
 */
export function predictMatch(home, away, opts = {}) {
  const H = typeof home === 'string' ? getTeam(home) : home;
  const A = typeof away === 'string' ? getTeam(away) : away;

  // 是否给主队主场加成：显式主场 或 东道主（美墨加）在己方主场对非东道主
  const homeAdv = opts.neutral === false || (HOSTS.has(H.name) && !HOSTS.has(A.name));

  const elo = eloSubmodel(H, A, opts);
  const xg = xgSubmodel(H, A, homeAdv);
  const market = marketSubmodel(H, A);

  // 按可用子模型归一加权
  const w = CFG.ensemble;
  const parts = [[elo, w.elo]];
  if (xg) parts.push([xg, w.xg]);
  if (market) parts.push([market, w.odds]);
  const totalW = parts.reduce((s, [, pw]) => s + pw, 0);

  let pHome = 0, pDraw = 0, pAway = 0;
  for (const [m, pw] of parts) {
    pHome += (pw / totalW) * m.h;
    pDraw += (pw / totalW) * m.d;
    pAway += (pw / totalW) * m.a;
  }

  // 比分与预期进球来自 xG 子模型
  const lambdaH = xg ? xg.lambdaH : CFG.xg.leagueAvg;
  const lambdaA = xg ? xg.lambdaA : CFG.xg.leagueAvg;
  const topScores = opts.scores === false ? null : topScorelines(lambdaH, lambdaA, CFG.xg.maxGoals, 3);

  // 预测比分：在「集成预测的胜负方向」内取最可能比分（与胜平负自洽，对齐原文逻辑）
  const outcome = pHome >= pDraw && pHome >= pAway ? 'H' : pAway >= pDraw ? 'A' : 'D';
  const score = opts.scores === false ? null : bestScoreForOutcome(lambdaH, lambdaA, outcome, CFG.xg.maxGoals);

  return {
    home: H.name,
    away: A.name,
    pHome, pDraw, pAway,
    eloDiff: elo.eloDiff,
    expGoals: { home: lambdaH, away: lambdaA },
    score,        // 与胜负方向一致的预测比分（headline）
    topScores,    // 不限方向的概率最高 3 个比分（明细）
    sub: { elo, xg, market }, // 子模型明细
  };
}

// 在指定胜负方向内取概率最高的比分
function bestScoreForOutcome(lambdaH, lambdaA, outcome, maxGoals) {
  let best = null;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const ok = outcome === 'H' ? h > a : outcome === 'A' ? h < a : h === a;
      if (!ok) continue;
      const p = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA);
      if (!best || p > best.p) best = { h, a, p };
    }
  }
  return `${best.h}-${best.a}`;
}

function topScorelines(lambdaH, lambdaA, maxGoals, n) {
  const cells = [];
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      cells.push({ h, a, p: poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) });
    }
  }
  cells.sort((x, y) => y.p - x.p);
  return cells.slice(0, n).map((c) => ({ score: `${c.h}-${c.a}`, p: c.p }));
}

// 对外暴露子模型，供「双模型对比」页独立调用（xG 第二验证 = Elo 0.30 + 泊松xG 0.70，不含赔率）
export { CFG, eloSubmodel, xgSubmodel, marketSubmodel };
