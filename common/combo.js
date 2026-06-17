// M串N 组合(前端现算)——竞彩"过关":勾 K 场(每场 1 腿)→ 生成所有 2..K 关组合 = 2^K−K−1 注。
//   命中率/EV 全用市场去水 q(诚实口径,与引擎 parlay.mjs 一致);EV 恒为负,如实显示。
//   pAdj = ∏q · 0.92^(关-1):跨场弱相关的保守折扣(裸 ∏q 偏乐观),UI 主显 pAdj、裸 p 作对照。
const IND_DISCOUNT = 0.92

function combosOf(arr, k) {
  if (k === 1) return arr.map((x) => [x])
  const out = []
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combosOf(arr.slice(i + 1), k - 1)) out.push([arr[i], ...rest])
  return out
}

/** 单注结算。legs = 该注各腿(每腿来自不同场)。 */
export function settleCombo(legs, tier) {
  const odds = legs.reduce((s, l) => s * l.odds, 1)
  const pRaw = legs.reduce((s, l) => s * l.q, 1)
  const pAdj = pRaw * Math.pow(IND_DISCOUNT, tier - 1)
  return {
    tier, tag: `${tier}串1`, legs,
    odds: +odds.toFixed(2),     // 回报倍数(含 vig 复利)
    p: +pRaw.toFixed(4),        // 裸 ∏q
    pAdj: +pAdj.toFixed(4),     // 保守命中率(主显)
    ev: +(pRaw * odds - 1).toFixed(3), // 恒为负
  }
}

/**
 * picks = 用户每场选的腿数组,每腿 { key, home, away, sel, selZh, q, odds, play, lean }
 * 返回 { k, total, label:'K串N', byTier:[{tier, bets:[...]}] }
 */
export function buildCombos(picks, kMax = 4) {
  const k = Math.min(picks.length, kMax)
  if (k < 2) return { k: picks.length, total: 0, label: '', byTier: [] }
  const pool = picks.slice(0, k)
  const byTier = []; let total = 0
  for (let j = 2; j <= k; j++) {
    const bets = combosOf(pool, j).map((ls) => settleCombo(ls, j))
    byTier.push({ tier: j, bets }); total += bets.length
  }
  return { k, total, label: `${k}串${total}`, byTier }
}
