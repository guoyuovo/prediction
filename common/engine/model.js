// 主模型：加权逻辑回归 + 校准 sigmoid（浏览器安全端口，逻辑同 src/model.mjs）。
//
// 与 src/model.mjs 的【唯一】区别：
//   - src 在模块顶层用 const 读 loadJson(...)；浏览器刷新需用新数据，顶层 const 会陈旧。
//   - 这里把 CFG/TEAMS/XG/ODDS/HOSTS 改为【调用时】从 store 读取（cfg()/teams()/... 访问器）。
//     只要重算前 setData(...) 注入新数据，predictMatch 即用最新数据，刷新正确。
//   - 所有模型数学（特征、平局模型、赔率融合、Dixon-Coles 比分）逐行保持一致。

import { sigmoid, clamp, poissonPmf, loadJson } from './util.js';

// —— 调用时数据访问器（替代 src 的顶层 const，解决刷新陈旧问题）——
const cfg = () => loadJson('config/model.json');
const teamsTbl = () => loadJson('data/teams.json').teams;
const oddsTbl = () => loadJson('data/match-odds.json').odds;
const hostsSet = () => new Set(loadJson('data/groups.json').hosts);

// 阵容评分回退代理：仅当 teams.json 无 squad 字段时用（由 Elo 线性映射）。
function squadProxy(elo) {
  return clamp(66 + (elo - 1500) / 700 * 20, 60, 90);
}

export function getTeam(name) {
  const TEAMS = teamsTbl();
  const t = TEAMS[name];
  if (!t) throw new Error(`未知球队: ${name}（请检查 data/teams.json）`);
  return { name, ...t, squad: t.squad ?? squadProxy(t.elo) };
}
export function listTeams() { return Object.keys(teamsTbl()); }

// 经 sigmoid 归一并中心化到 [-1,1] 的带符号特征
const feat = (diff, scale) => 2 * (sigmoid(diff / scale) - 0.5);

/**
 * 单场预测（特征加权式）。
 * @param {string|object} home 主队（名或带 elo 覆盖的对象）
 * @param {string|object} away 客队
 * @param {object} opts { neutral:false 显式主场, scores:false 跳过比分, goalScale:1 }
 */
export function predictMatch(home, away, opts = {}) {
  const CFG = cfg();
  const ODDS = oddsTbl();
  const HOSTS = hostsSet();

  const H = typeof home === 'string' ? getTeam(home) : home;
  const A = typeof away === 'string' ? getTeam(away) : away;
  const neutral = opts.neutral !== false;
  const homeAdv = !neutral || (HOSTS.has(H.name) && !HOSTS.has(A.name));

  // --- 特征工程 ---
  let eloDiff = H.elo - A.elo;
  if (homeAdv) eloDiff += CFG.elo.homeBonus; // 主队优势 +60
  eloDiff *= CFG.elo.diffScale ?? 1;
  const fElo = feat(eloDiff, CFG.norm.eloScale);
  const fFifa = feat((H.fifa || 0) - (A.fifa || 0), CFG.norm.fifaScale);
  const fValue = 2 * (sigmoid(Math.log((H.value || 1) / (A.value || 1))) - 0.5);
  const fForm = feat(((H.form || 0) - (A.form || 0)) * CFG.norm.formScale, 1);
  const fSquad = feat(H.squad - A.squad, 8);

  // --- 加权线性组合 → 对数几率 mu ---
  const w = CFG.weights;
  const lin = w.elo * fElo + w.fifa * fFifa + w.value * fValue + w.form * fForm + w.squad * fSquad + w.home * (homeAdv ? 1 : 0);
  const mu = CFG.scale * lin;

  // --- 平局模型（平局倾向 / 平局偏向）---
  const d = CFG.draw;
  const pDraw0 = clamp(d.base * Math.exp((-d.decay * Math.abs(mu)) / d.tendency) * Math.exp(d.bias), 0.04, 0.5);
  const pHomeCond = sigmoid(mu);
  let pHome = (1 - pDraw0) * pHomeCond;
  let pDraw = pDraw0;
  let pAway = (1 - pDraw0) * (1 - pHomeCond);

  // 子模型：纯特征模型(base) 与 去水位赔率(market)
  const base = { h: pHome, d: pDraw, a: pAway };
  let market = null;
  const o = ODDS[`${H.name} vs ${A.name}`] || null;
  if (o) {
    let [oh, od, oa] = o; let ph = 1 / oh, pd = 1 / od, pa = 1 / oa; const m = ph + pd + pa;
    market = { h: ph / m, d: pd / m, a: pa / m, odds: o };
    // 外部融合：赔率共识权重 0.35
    const f = CFG.oddsFusion;
    pHome = (1 - f) * pHome + f * market.h;
    pDraw = (1 - f) * pDraw + f * market.d;
    pAway = (1 - f) * pAway + f * market.a;
  }

  // --- 比分（Dixon-Coles 双变量泊松）---
  const sc = CFG.scoreline;
  const { lambdaH, lambdaA } = goalLambdas(H, A, homeAdv, opts.goalScale || 1, CFG);
  const topScores = opts.scores === false ? null : dcTopScores(lambdaH, lambdaA, sc.rho, sc.maxGoals, 3);
  const outcome = pHome >= pDraw && pHome >= pAway ? 'H' : pAway >= pDraw ? 'A' : 'D';
  const scoreML = opts.scores === false ? null : dcMode(lambdaH, lambdaA, sc.rho, sc.maxGoals);
  const scoreInOutcome = opts.scores === false ? null : bestScoreForOutcome(lambdaH, lambdaA, outcome, sc.maxGoals, sc.rho);
  const dirOf = (s) => { const [x, y] = s.split('-').map(Number); return x > y ? 'H' : x < y ? 'A' : 'D'; };
  const score = opts.scores === false ? null : (dirOf(scoreML) === outcome ? scoreML : scoreInOutcome);

  return {
    home: H.name, away: A.name, neutral, pHome, pDraw, pAway,
    eloDiff: H.elo - A.elo + (homeAdv ? CFG.elo.homeBonus : 0),
    expGoals: { home: lambdaH, away: lambdaA },
    score, scoreML, scoreInOutcome, topScores,
    features: { elo: fElo, fifa: fFifa, value: fValue, form: fForm, squad: fSquad },
    sub: { base, market },
  };
}

// 比分进球期望 λ
function goalLambdas(H, A, homeAdv, goalScale = 1, CFG) {
  const sc = CFG.scoreline;
  const z = (H.elo - A.elo) / sc.eloScale;
  const hb = homeAdv ? sc.homeAdv : sc.homeAdv / 2;
  const ab = homeAdv ? 0 : sc.homeAdv / 2;
  const lambdaH = Math.exp(sc.A + hb + sc.supremacy * z) * goalScale;
  const lambdaA = Math.exp(sc.A + ab - sc.supremacy * z) * goalScale;
  return { lambdaH, lambdaA };
}

// Dixon-Coles 低比分相关性修正 τ
function dcTau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
function dcGrid(lh, la, rho, maxGoals) {
  const cells = [];
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++)
    cells.push({ h, a, p: dcTau(h, a, lh, la, rho) * poissonPmf(h, lh) * poissonPmf(a, la) });
  return cells;
}
function dcMode(lh, la, rho, maxGoals) {
  let best = null;
  for (const c of dcGrid(lh, la, rho, maxGoals)) if (!best || c.p > best.p) best = c;
  return `${best.h}-${best.a}`;
}
function dcTopScores(lh, la, rho, maxGoals, n) {
  return dcGrid(lh, la, rho, maxGoals).sort((x, y) => y.p - x.p).slice(0, n).map((c) => ({ score: `${c.h}-${c.a}`, p: c.p }));
}
function bestScoreForOutcome(lh, la, outcome, maxGoals, rho) {
  let best = null;
  for (const c of dcGrid(lh, la, rho, maxGoals)) {
    const ok = outcome === 'H' ? c.h > c.a : outcome === 'A' ? c.h < c.a : c.h === c.a; if (!ok) continue;
    if (!best || c.p > best.p) best = c;
  }
  return `${best.h}-${best.a}`;
}

// CFG 兼容导出：原 src 导出 const CFG；这里改为访问器以保持刷新正确。
export { cfg as getCfg };
