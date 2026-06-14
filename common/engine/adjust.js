// 赛前临场调整（浏览器安全端口，逻辑同 src/adjust.mjs）。
//   核心球员伤停/停赛 → 下调球队【有效 Elo】（仅作用于 v2 预测层，不污染滚动 Elo）。
//   src 在顶层无缓存（每次调用 loadJson）；这里同样【调用时】从 store 读取，缺失退化为空。

import { loadJson } from './util.js';
import { hasData } from './store.js';

export function loadAdjustments() {
  try {
    if (!hasData('data/manual/squad-adjustments.json')) return {};
    return loadJson('data/manual/squad-adjustments.json').adjustments || {};
  } catch { return {}; }
}

// 该队在 matchDate（YYYY-MM-DD，可空=不校验时效）生效的 Elo 惩罚（正数=下调）
export function eloPenaltyFor(team, adj, matchDate) {
  const a = adj && adj[team];
  if (!a || a.active === false) return 0;
  if (a.until && matchDate && matchDate > a.until) return 0;
  return +a.eloPenalty || 0;
}

// 当前生效的调整列表（用于看板展示）
export function activeAdjustments(adj) {
  return Object.entries(adj || {}).filter(([, a]) => a && a.active !== false && (+a.eloPenalty || 0) !== 0)
    .map(([team, a]) => ({ team, eloPenalty: +a.eloPenalty || 0, reason: a.reason || '', until: a.until || null }));
}
