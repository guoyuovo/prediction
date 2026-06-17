// "搏·串关" 选腿 + 组合 — 纯函数,供 build-bo(线上) 与 backtest-parlay(回测) 共用同一逻辑。
//   定位:娱乐性高赔串关。在【市场认为还有点可能】(去水概率 q ≥ 下限)的结果里,挑【赔率高】的组 2/3/4 关。
//
//   ⚠️ 诚实口径(关键,见 memory/parlay-edge-findings 回测实证):
//   - "可能性"用【市场去水概率 q】,不用我们模型的概率——回测证明模型在长尾(冷门/客胜/平)系统性高估,
//     用模型概率会选出"自信的幻觉"(价值腿回测 0/6)。市场在尾部比我们准,故用 q 当可能性标尺。
//   - 展示的命中概率与 EV 全用市场 q 计算 → 每注 EV 恒为负(=被抽水复利吃掉),如实呈现,绝不打绿色正 EV。
//   - 模型只当【风味标签 lean】:某腿模型比市场更看好就标记一下,但不据此声称价值、不进入选腿打分。
//   数据同源铁律:单腿 q、odds 必须来自同一市场源。

export const PARLAY_CFG = {
  Q_FLOOR: 0.08,   // 闸1 市场去水概率下限(排掉纯不可能;这是诚实的"可能性"标尺)
  ODDS_MIN: 2.20,  // 闸2 赔率下限(才算"搏";同时隐含 q 上限,排大热)
  POOL_K: 6,       // 候选池上限(按赔率降序取前 K)
  TIERS: { single: 3, two: 3, three: 2, four: 2 }, // 各档出注数上限
};

const SELS = ['H', 'D', 'A'];
const SEL_ZH = { H: '主胜', D: '平局', A: '客胜' };

// 去水位:1X2 含 vig 隐含概率归一为市场真实概率 q;vig=倒数和(overround)
export function devig(odds3) {
  const inv = odds3.map((o) => 1 / o);
  const vig = inv[0] + inv[1] + inv[2];
  return { q: inv.map((x) => x / vig), vig };
}

// 单场 → 候选腿(三选一各一条)。q/odds 同源;modelP 仅作风味,不参与选腿打分。
//   match: { key, seq, home, away, p:[pH,pD,pA], odds:[oH,oD,oA], src }
export function legsOfMatch(match) {
  const { q } = devig(match.odds);
  return SELS.map((sel, i) => {
    const odds = match.odds[i], qi = q[i], modelP = match.p[i];
    return {
      key: match.key, seq: match.seq, home: match.home, away: match.away, src: match.src,
      sel, selZh: SEL_ZH[sel],
      q: +qi.toFixed(4),          // 市场去水概率 = 诚实命中概率
      modelP: +modelP.toFixed(4), // 模型概率(仅风味标签用)
      odds: +odds.toFixed(2),
      lean: modelP > qi,          // 模型比市场更看好 → 风味标签(不代表价值)
      evHonest: +(qi * odds - 1).toFixed(4), // 用市场 q 算 → 恒为负(=抽水)
    };
  });
}

// 闸:市场可能性下限 + 赔率下限
export function passesGates(leg) {
  return leg.q >= PARLAY_CFG.Q_FLOOR && leg.odds >= PARLAY_CFG.ODDS_MIN;
}

// 候选池:每场至多 1 腿(取该场过闸腿里【赔率最高】=最"搏"的那条,消同场相关/互斥),
//   全局按赔率降序取前 POOL_K。
export function selectPool(matches) {
  const best = new Map();
  for (const m of matches) {
    for (const leg of legsOfMatch(m)) {
      if (!passesGates(leg)) continue;
      const cur = best.get(m.key);
      if (!cur || leg.odds > cur.odds) best.set(m.key, leg);
    }
  }
  return [...best.values()].sort((a, b) => b.odds - a.odds).slice(0, PARLAY_CFG.POOL_K);
}

function combos(arr, k) {
  if (k === 1) return arr.map((x) => [x]);
  const out = [];
  for (let i = 0; i <= arr.length - k; i++)
    for (const rest of combos(arr.slice(i + 1), k - 1)) out.push([arr[i], ...rest]);
  return out;
}

// 组合诚实计算:赔率连乘(=回报倍数 retX,含 vig 复利);命中概率连乘市场 q(独立近似,UI 须注明偏乐观);
//   EV 用市场 q → 恒为负(串得越多越负)。模型偏爱腿数 leanCount 仅作风味展示。
function settleParlay(legs, tier, tag) {
  const oddsC = legs.reduce((s, l) => s * l.odds, 1);
  const pC = legs.reduce((s, l) => s * l.q, 1);
  return {
    tier, tag,
    legKeys: legs.map((l) => `${l.key}|${l.sel}`),
    legs: legs.map((l) => ({ key: l.key, seq: l.seq, home: l.home, away: l.away, sel: l.sel, selZh: l.selZh, q: l.q, modelP: l.modelP, odds: l.odds, lean: l.lean })),
    odds: +oddsC.toFixed(2), // retX 回报倍数
    p: +pC.toFixed(4),       // 诚实命中概率(市场口径,偏乐观因独立近似)
    ev: +(pC * oddsC - 1).toFixed(3), // 恒为负
    leanCount: legs.filter((l) => l.lean).length,
  };
}

// 出注:单关(高赔) + 2/3 关(按市场命中概率挑"最有戏"的) + 4 关(按赔率挑"最大回报"的纯娱乐)。
//   所有 EV 恒为负——这是诚实结果,UI 如实呈现,不造正期望错觉。
export function buildParlays(pool) {
  const c = PARLAY_CFG;
  const singles = pool.slice(0, c.TIERS.single).map((l) => settleParlay([l], 1, '高赔单'));
  const tier2 = combos(pool, 2).map((ls) => settleParlay(ls, 2, '双串'))
    .sort((a, b) => b.p - a.p).slice(0, c.TIERS.two);
  const tier3 = combos(pool, 3).map((ls) => settleParlay(ls, 3, '三串'))
    .sort((a, b) => b.p - a.p).slice(0, c.TIERS.three);
  const tier4 = combos(pool, 4).map((ls) => settleParlay(ls, 4, '搏一搏·纯娱乐'))
    .sort((a, b) => b.odds - a.odds).slice(0, c.TIERS.four);
  return { singles, parlays: [...tier2, ...tier3, ...tier4] };
}
