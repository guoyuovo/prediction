// 主模型：加权逻辑回归 + 校准 sigmoid（《2026 世界杯赛事预测 Skill》第一篇文章）
//   预测 = sigmoid(特征 × 权重)
//   特征：Elo 差 · FIFA 差 · 身价对数比 · 近期状态差 · 阵容评分差
//   归一化：sigmoid(Elo_diff/420)、sigmoid(FIFA_diff/280)、sigmoid(form_diff×2.2)、sigmoid(log(身价比))
//   主队优势 +60 Elo；平局倾向 1.413 / 平局偏向 -0.15
//   外部融合：赔率共识权重 0.35（最终 = 0.65·特征模型 + 0.35·去水位赔率）
//
// 真实数据：Elo=eloratings.net 官方；身价=Transfermarkt(档案)；赔率=ESPN+Bovada 双源；
//          近期状态=4.9万场历史计算；FIFA=近似；阵容评分=代理(由 Elo 映射)。

import { sigmoid, clamp, poissonPmf, loadJson } from './util.mjs';

const CFG = loadJson('config/model.json');
const TEAMS = loadJson('data/teams.json').teams;
const XG = loadJson('data/team-xg.json').teams; // 治本：比分用真实 xG 攻防 λ
const ODDS = loadJson('data/match-odds.json').odds;
const HOSTS = new Set(loadJson('data/groups.json').hosts);

// 阵容评分回退代理：仅当 teams.json 无 squad 字段时用（由 Elo 线性映射）。
// 正常情况下 squad 由 scripts/build-squad-ratings.mjs 写入真实值（文章真实 EA 评分 + 真实 Elo 标定估算）。
function squadProxy(elo) {
  return clamp(66 + (elo - 1500) / 700 * 20, 60, 90);
}

export function getTeam(name) {
  const t = TEAMS[name];
  if (!t) throw new Error(`未知球队: ${name}（请检查 data/teams.json）`);
  return { name, ...t, squad: t.squad ?? squadProxy(t.elo) };
}
export function listTeams() { return Object.keys(TEAMS); }

// 经 sigmoid 归一并中心化到 [-1,1] 的带符号特征
const feat = (diff, scale) => 2 * (sigmoid(diff / scale) - 0.5);

/**
 * 单场预测（特征加权式）。
 * @param {string|object} home 主队
 * @param {string|object} away 客队
 * @param {object} opts { neutral:false 显式主场, scores:false 跳过比分 }
 */
export function predictMatch(home, away, opts = {}) {
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
  const fForm = feat(((H.form || 0) - (A.form || 0)) * CFG.norm.formScale, 1) ; // form_diff×2.2 已在内
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

  // --- live 校准：赛果驱动的平局乘子（calibrate-live.mjs 按真实赛果标定，默认 1 不改动）---
  const dm = CFG.draw.liveMult ?? 1;
  if (dm !== 1) {
    const nd = clamp(pDraw * dm, 0.02, 0.92);
    const k = (1 - nd) / (1 - pDraw);
    pDraw = nd; pHome *= k; pAway *= k;
  }

  // --- 比分（Dixon-Coles 双变量泊松，最大化波胆命中）---
  const sc = CFG.scoreline;
  const { lambdaH, lambdaA } = goalLambdas(H, A, homeAdv, opts.goalScale || 1);
  const topScores = opts.scores === false ? null : dcTopScores(lambdaH, lambdaA, sc.rho, sc.maxGoals, 3);
  const outcome = pHome >= pDraw && pHome >= pAway ? 'H' : pAway >= pDraw ? 'A' : 'D';
  // scoreML = DC 全局最可能比分（纯波胆，回测命中 ~12.9%，可为平局）
  // scoreInOutcome = 与 1X2 方向一致的最可能比分
  // score(头条展示) = 与胜负方向自洽：全局最可能比分若本就同向则直接用（多数场次，保留波胆优势）；
  //                   若矛盾（如主胜却 1-1）则取方向内比分，避免自相矛盾。
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
    sub: { base, market }, // base=特征模型；market=去水位赔率（融合权重 0.35）
  };
}

// 比分进球期望 λ（真实进球率参数化，与 1X2 supremacy 解耦）：
//   z = (elo主 - elo客)/eloScale；λ主 = exp(A + 主场Bh + S·z)，λ客 = exp(A - S·z)
//   参数 A/homeAdv/supremacy/rho 由 3300+ 场真实联赛比分回测拟合（波胆样本外 12.9%）。
//   均场 λ ≈ 主1.16/客1.00（真实进球水平），让势均力敌场预测出 1-1。
function goalLambdas(H, A, homeAdv, goalScale = 1) {
  const sc = CFG.scoreline;
  const z = (H.elo - A.elo) / sc.eloScale;
  // 主场加成：有东道主优势 → 全给主队；中立场 → 对半分给两队（保持总进球一致）
  const hb = homeAdv ? sc.homeAdv : sc.homeAdv / 2;
  const ab = homeAdv ? 0 : sc.homeAdv / 2;
  // goalScale：海拔总进球缩放（高原球速/疲劳→略增），对称作用两队，保持 supremacy 不变
  const lambdaH = Math.exp(sc.A + hb + sc.supremacy * z) * goalScale;
  const lambdaA = Math.exp(sc.A + ab - sc.supremacy * z) * goalScale;
  return { lambdaH, lambdaA };
}

// Dixon-Coles 低比分相关性修正 τ（ρ<0 抬升 0-0/1-1）
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
// DC 全局最可能比分（波胆头条）
function dcMode(lh, la, rho, maxGoals) {
  let best = null;
  for (const c of dcGrid(lh, la, rho, maxGoals)) if (!best || c.p > best.p) best = c;
  return `${best.h}-${best.a}`;
}
function dcTopScores(lh, la, rho, maxGoals, n) {
  return dcGrid(lh, la, rho, maxGoals).sort((x, y) => y.p - x.p).slice(0, n).map((c) => ({ score: `${c.h}-${c.a}`, p: c.p }));
}
// 与 1X2 方向一致的最可能比分（展示用）
function bestScoreForOutcome(lh, la, outcome, maxGoals, rho) {
  let best = null;
  for (const c of dcGrid(lh, la, rho, maxGoals)) {
    const ok = outcome === 'H' ? c.h > c.a : outcome === 'A' ? c.h < c.a : c.h === c.a; if (!ok) continue;
    if (!best || c.p > best.p) best = c;
  }
  return `${best.h}-${best.a}`;
}

export { CFG };
