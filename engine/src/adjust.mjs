// 赛前临场调整：核心球员伤停/停赛 → 下调球队【有效 Elo】（仅作用于预测层，不污染滚动 Elo）。
//   国家队伤停无可靠免费 API（ESPN injuries 端点为空），故以人工策展为主（data/manual/squad-adjustments.json）。
import { loadJson } from './util.mjs';

export function loadAdjustments() {
  try { return loadJson('data/manual/squad-adjustments.json').adjustments || {}; } catch { return {}; }
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
