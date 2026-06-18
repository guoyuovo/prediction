// "搏·串关" 选腿 + 组合 — 纯函数,供 build-bo(线上) 与 backtest-parlay(回测) 共用同一逻辑。
//   定位:娱乐性高赔串关。命中概率/EV 一律用【市场去水概率 q】(回测证明模型在长尾系统性高估,价值腿 0/6 全黑);
//   模型只当 ⚑lean 风味标签,不进选腿打分、不声称价值。EV 恒为负,如实呈现。数据同源铁律:单腿 q/odds 同源。
//
//   风险分档(治"为高赔而高赔"):稳搏=温和冷门带、激进=长尾带,两档 q 不重叠;档内按"命中×回报几何平衡分"选腿,
//   几何平均任一子分趋 0 总分趋 0 → 数学上杜绝"为高赔单边拉满"(老 bug 根因:每场取最高赔=必选 q 最低长尾)。

export const PARLAY_CFG = {
  POOL_K: 6,                                          // 候选池上限
  TIERS: { single: 3, two: 3, three: 2, four: 2 },    // 各档出注数上限
  IND_DISCOUNT: 0.92,                                 // 组合命中率相关性保守折扣 pAdj=∏q·0.92^(关数-1)
};

export const RISK_BANDS = {
  steady:     { key: 'steady',     label: '稳搏',   qLo: 0.17, qHi: 0.40, wHit: 0.65 }, // 温和冷门·偏命中(甜点 q≈0.32)
  aggressive: { key: 'aggressive', label: '激进搏', qLo: 0.06, qHi: 0.17, wHit: 0.35 }, // 长尾大赔·偏回报(甜点 q≈0.10)
};

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const SELS = ['H', 'D', 'A'];
const SEL_ZH = { H: '主胜', D: '平局', A: '客胜' };

// 去水位:含 vig 隐含概率归一为市场真实概率 q;vig=倒数和(overround)。通用:传 N 个赔率。
export function devig(odds) {
  const inv = odds.map((o) => 1 / o);
  const vig = inv.reduce((a, b) => a + b, 0);
  return { q: inv.map((x) => x / vig), vig };
}

// —— 通用选项(任意玩法的单个结果)打分:只吃市场概率 q ——
// 落档:只看 q(odds≈1/(q·vig) 与 q 单调,不另设 odds 闸,避免与 q 边界打架——这正是上一版"稳搏推荐为空"的 bug)
export function inBand(opt, b) { return opt.q >= b.qLo && opt.q < b.qHi; }
// 几何平衡分:命中分=q 在带内位置、回报分=其补(q 越低赔率越高);score=hit^wHit × ret^(1−wHit),
//   在 hit=wHit 处取峰(稳搏偏命中→甜点偏高 q,激进偏回报→甜点偏低 q);几何形式使带边缘项→0,杜绝"为高赔单边拉满"。
export function scoreOption(opt, b) {
  const hit = clamp01((opt.q - b.qLo) / (b.qHi - b.qLo));
  const ret = 1 - hit;
  return +(Math.pow(hit, b.wHit) * Math.pow(ret, 1 - b.wHit)).toFixed(4);
}
// 从某玩法的全部选项里,选出该风险档的推荐项(返回 {sel, score} 或 null)
export function pickRec(options, b) {
  let best = null;
  for (const o of options) {
    if (!inBand(o, b)) continue;
    const s = scoreOption(o, b);
    if (!best || s > best.score) best = { sel: o.sel, score: s };
  }
  return best;
}

// 单场 1X2 → 三选一候选腿(系统荐彩/回测用)。q/odds 同源;modelP 仅作风味。
export function legsOfMatch(match) {
  const { q } = devig(match.odds);
  return SELS.map((sel, i) => {
    const odds = match.odds[i], qi = q[i], modelP = match.p[i];
    return {
      key: match.key, seq: match.seq, home: match.home, away: match.away, src: match.src,
      sel, selZh: SEL_ZH[sel],
      q: +qi.toFixed(4), modelP: +modelP.toFixed(4), odds: +odds.toFixed(2),
      // 平局(D)不挂 ⚑:实测模型对平局零区分度(完赛 0/9,真打平场 pDraw 均值≈全样本均值,平局从不当 argmax),
      //   "modelP>q" 只是平局底噪偏高(悬殊局尤甚)的伪信号,非真 edge。仅 H/A 保留风味 lean。
      lean: sel !== 'D' && modelP > qi, evHonest: +(qi * odds - 1).toFixed(4),
    };
  });
}

// 候选池:每场至多 1 腿,在风险档甜区内按几何平衡分取最高(根治"为高赔而高赔"),全局按分降序取前 POOL_K。
export function selectPool(matches, { risk = 'steady' } = {}) {
  const b = RISK_BANDS[risk]; const best = new Map();
  for (const m of matches) {
    for (const leg of legsOfMatch(m)) {
      if (!inBand(leg, b)) continue;
      leg._score = scoreOption(leg, b);
      const cur = best.get(m.key);
      if (!cur || leg._score > cur._score) best.set(m.key, leg);
    }
  }
  return [...best.values()].sort((a, c) => c._score - a._score).slice(0, PARLAY_CFG.POOL_K);
}

function combos(arr, k) {
  if (k === 1) return arr.map((x) => [x]);
  const out = [];
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combos(arr.slice(i + 1), k - 1)) out.push([arr[i], ...rest]);
  return out;
}

// 组合诚实计算:赔率连乘(=回报倍数,含 vig 复利);命中率 p=∏q(裸独立近似)、pAdj=∏q·0.92^(关-1)(保守折扣,UI 主显);
//   EV=p×odds−1 用裸 p 算 → 恒为负,不靠折扣粉饰。
function settleParlay(legs, tier, tag) {
  const oddsC = legs.reduce((s, l) => s * l.odds, 1);
  const pRaw = legs.reduce((s, l) => s * l.q, 1);
  const pAdj = pRaw * Math.pow(PARLAY_CFG.IND_DISCOUNT, tier - 1);
  return {
    tier, tag,
    legKeys: legs.map((l) => `${l.key}|${l.sel}`),
    legs: legs.map((l) => ({ key: l.key, seq: l.seq, home: l.home, away: l.away, sel: l.sel, selZh: l.selZh, q: l.q, modelP: l.modelP, odds: l.odds, lean: l.lean })),
    odds: +oddsC.toFixed(2), p: +pRaw.toFixed(4), pAdj: +pAdj.toFixed(4),
    ev: +(pRaw * oddsC - 1).toFixed(3), leanCount: legs.filter((l) => l.lean).length,
  };
}

// 系统荐彩自动出注:单关 + 2/3/4 关。稳搏档按命中率(p)优先、激进档按回报(赔率)优先。EV 恒负如实。
export function buildParlays(pool, { risk = 'steady' } = {}) {
  const c = PARLAY_CFG;
  const cmp = risk === 'aggressive' ? (a, b) => b.odds - a.odds : (a, b) => b.p - a.p;
  const single = RISK_BANDS[risk] ? RISK_BANDS[risk].label : '搏';
  const singles = pool.slice(0, c.TIERS.single).map((l) => settleParlay([l], 1, single + '单'));
  const tier2 = combos(pool, 2).map((ls) => settleParlay(ls, 2, '2串1')).sort(cmp).slice(0, c.TIERS.two);
  const tier3 = combos(pool, 3).map((ls) => settleParlay(ls, 3, '3串1')).sort(cmp).slice(0, c.TIERS.three);
  const tier4 = combos(pool, 4).map((ls) => settleParlay(ls, 4, '4串1')).sort(cmp).slice(0, c.TIERS.four);
  return { singles, parlays: [...tier2, ...tier3, ...tier4] };
}
