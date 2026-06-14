// 回测用双模型预测核心：输入 Elo(+真实赔率)，分别按
//   - 加权模型（第一篇，config/model.json）：sigmoid(特征×权重) + 赔率融合
//   - 集成模型（第二篇，config/model-ensemble.json）：Elo子模型 + 市场子模型 加权
// 俱乐部/NBA 无 FIFA/身价/form/xG，故仅用 Elo + 赔率（两模型的可迁移核心）。
// 同时提供 3 路（足球）与 2 路（NBA）版本，及指标/ROI 助手。

import { sigmoid, clamp, loadJson, poissonPmf } from './util.mjs';

const W = loadJson('config/model.json');           // 加权模型
const E = loadJson('config/model-ensemble.json');  // 集成模型
const SC = W.scoreline;                            // Dixon-Coles 比分参数
const LN10 = Math.log(10);
const HOME_FB = 65;   // 俱乐部主场优势（两模型统一，隔离结构差异）
const HOME_NBA = 100; // NBA 主场优势

function demargin(odds) {
  const ph = 1 / odds[0], pd = 1 / odds[1], pa = 1 / odds[2], m = ph + pd + pa;
  return [ph / m, pd / m, pa / m];
}

// ---------- 3 路（足球）----------
export function predictWeighted(eloH, eloA, homeAdv, odds, home = HOME_FB) {
  let d = (eloH - eloA + (homeAdv ? home : 0)) * (W.elo.diffScale ?? 1);
  const fElo = 2 * (sigmoid(d / W.norm.eloScale) - 0.5);
  const mu = W.scale * (W.weights.elo * fElo + W.weights.home * (homeAdv ? 1 : 0));
  const dr = W.draw;
  const pD = clamp(dr.base * Math.exp((-dr.decay * Math.abs(mu)) / dr.tendency) * Math.exp(dr.bias), 0.04, 0.5);
  let h = (1 - pD) * sigmoid(mu), dd = pD, a = (1 - pD) * (1 - sigmoid(mu));
  if (odds) { const f = W.oddsFusion, mk = demargin(odds); h = (1 - f) * h + f * mk[0]; dd = (1 - f) * dd + f * mk[1]; a = (1 - f) * a + f * mk[2]; }
  return [h, dd, a];
}
export function predictEnsemble(eloH, eloA, homeAdv, odds, home = HOME_FB) {
  let d = (eloH - eloA + (homeAdv ? home : 0)) * (E.elo.diffScale ?? 1);
  const muE = (d / E.elo.scale) * LN10, Ex = sigmoid(muE);
  const dr = E.draw;
  const pD = clamp(dr.base * Math.exp((-dr.decay * Math.abs(muE)) / dr.tendency) * Math.exp(dr.bias), 0.04, 0.5);
  const elo = [(1 - pD) * Ex, pD, (1 - pD) * (1 - Ex)];
  const parts = [[elo, E.ensemble.elo]];
  if (odds) parts.push([demargin(odds), E.ensemble.odds]);
  const tw = parts.reduce((s, [, w]) => s + w, 0);
  const out = [0, 0, 0];
  for (const [p, w] of parts) for (let i = 0; i < 3; i++) out[i] += (w / tw) * p[i];
  return out;
}

// ---------- 双模型共同推断（回测版）----------
// 注意：俱乐部无 xG 攻防数据，故 xG 第二验证模型的泊松 λ 用 Elo 驱动（结构同主页面、
//       输入降级为 Elo）。这会保守低估真实 att/def 可能带来的增益，但能如实测「独立
//       第二模型 + 0.6/0.4 融合结构」对市场锚定主力模型的净影响。
function dcTau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
// Elo 驱动的 Dixon-Coles 泊松 → 1X2（与 model.mjs goalLambdas 同式）
function poisson1x2(eloH, eloA, homeAdv, home) {
  const z = (eloH - eloA + (homeAdv ? home : 0)) / SC.eloScale;
  const hb = homeAdv ? SC.homeAdv : SC.homeAdv / 2;
  const ab = homeAdv ? 0 : SC.homeAdv / 2;
  const lh = Math.exp(SC.A + hb + SC.supremacy * z);
  const la = Math.exp(SC.A + ab - SC.supremacy * z);
  let h = 0, d = 0, a = 0;
  for (let x = 0; x <= SC.maxGoals; x++) for (let y = 0; y <= SC.maxGoals; y++) {
    const p = dcTau(x, y, lh, la, SC.rho) * poissonPmf(x, lh) * poissonPmf(y, la);
    if (x > y) h += p; else if (x === y) d += p; else a += p;
  }
  const s = h + d + a; return [h / s, d / s, a / s];
}
// xG 第二验证：Elo 0.30 + 泊松 0.70（不含赔率，与市场独立）
export function predictXgValid(eloH, eloA, homeAdv, _odds, home = HOME_FB) {
  const dd = (eloH - eloA + (homeAdv ? home : 0)) * (E.elo.diffScale ?? 1);
  const muE = (dd / E.elo.scale) * LN10, Ex = sigmoid(muE);
  const dr = E.draw;
  const pD = clamp(dr.base * Math.exp((-dr.decay * Math.abs(muE)) / dr.tendency) * Math.exp(dr.bias), 0.04, 0.5);
  const elo = [(1 - pD) * Ex, pD, (1 - pD) * (1 - Ex)];
  const pois = poisson1x2(eloH, eloA, homeAdv, home);
  const out = [0, 0, 0]; for (let i = 0; i < 3; i++) out[i] = 0.30 * elo[i] + 0.70 * pois[i];
  const s = out[0] + out[1] + out[2]; return [out[0] / s, out[1] / s, out[2] / s];
}
// 综合推荐：0.5·多因子(主力) + 0.5·xG(第二验证)
//   等权——经 scripts/tune-dual.mjs 时间切分网格搜索：训练最优 α∈[0.3,0.5]（logloss/Brier），
//   0.5 为 Brier 最优且 logloss 近最优、可泛化到测试集，最稳健可解释（原拍值 0.6 略偏）。
export function predictDual(eloH, eloA, homeAdv, odds, home = HOME_FB) {
  const A = predictWeighted(eloH, eloA, homeAdv, odds, home);
  const B = predictXgValid(eloH, eloA, homeAdv, odds, home);
  return [0.5 * A[0] + 0.5 * B[0], 0.5 * A[1] + 0.5 * B[1], 0.5 * A[2] + 0.5 * B[2]];
}

// ---------- 2 路（NBA，无平局/赔率）----------
export function predictWeighted2(eloH, eloA) {
  const d = (eloH - eloA + HOME_NBA) * (W.elo.diffScale ?? 1);
  const fElo = 2 * (sigmoid(d / W.norm.eloScale) - 0.5);
  const mu = W.scale * (W.weights.elo * fElo + W.weights.home);
  const pH = sigmoid(mu);
  return [pH, 0, 1 - pH];
}
export function predictEnsemble2(eloH, eloA) {
  const d = (eloH - eloA + HOME_NBA) * (E.elo.diffScale ?? 1);
  const pH = sigmoid((d / E.elo.scale) * LN10);
  return [pH, 0, 1 - pH];
}

// ---------- 指标 + ROI ----------
// rows: [{ p:[h,d,a], actual:'H'|'D'|'A', odds?, eloFav:'H'|'A', twoWay? }]
export function metricsOf(rows) {
  const n = rows.length;
  const idx = (o) => ({ H: 0, D: 1, A: 2 }[o]);
  const pick = (r) => { const m = Math.max(...r.p); return r.p[0] === m ? 'H' : (r.p[2] === m && r.p[2] >= r.p[1]) ? 'A' : (r.p[1] === m ? 'D' : 'A'); };
  const acc = rows.filter((r) => pick(r) === r.actual).length / n;
  const favAcc = rows.filter((r) => r.eloFav === r.actual).length / n;
  const brier = rows.reduce((s, r) => { const t = [r.actual === 'H', r.actual === 'D', r.actual === 'A']; return s + r.p.reduce((ss, p, i) => ss + (p - t[i]) ** 2, 0); }, 0) / n;
  const logloss = -rows.reduce((s, r) => s + Math.log(Math.max(r.p[idx(r.actual)], 1e-9)), 0) / n;
  const out = { n, acc, favAcc, brier, logloss };
  // ROI（有真实赔率时）
  if (rows[0]?.odds) {
    const roi = (filter) => {
      const b = rows.filter(filter); if (!b.length) return { bets: 0, winRate: 0, roi: 0 };
      let pr = 0, w = 0;
      for (const r of b) { const pk = pick(r); const oi = idx(pk); const hit = pk === r.actual; if (hit) { pr += r.odds[oi] - 1; w++; } else pr -= 1; }
      return { bets: b.length, winRate: w / b.length, roi: pr / b.length };
    };
    out.flat = roi(() => true);
    out.value = roi((r) => { const pk = pick(r); const oi = idx(pk); const imp = demargin(r.odds)[oi]; return r.p[oi] > imp; });
  } else {
    const w = rows.filter((r) => pick(r) === r.actual).length;
    out.breakeven = w ? n / w : null;
  }
  return out;
}
