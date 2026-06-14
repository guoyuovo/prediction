// 前端入口：打包种子(Vite 直接 import JSON)+ 调 recompute。供 api.js 动态导入(按需加载,不进首屏)。
//   说明:withSummary 默认 false(列表刷新不抓每场 summary,快;半场/射门在详情页按需补)。
import { recompute } from './compute-payload.js';

import base from './seeds/teams.json';
import groups from './seeds/groups.json';
import schedule2026 from './seeds/schedule-2026.json';
import modelCfg from './seeds/model.json';
import modelEnsembleCfg from './seeds/model-ensemble.json';
import matchOdds from './seeds/match-odds.json';
import weather from './seeds/weather.json';
import venuesGeo from './seeds/venues-geo.json';
import teamXg from './seeds/team-xg.json';
import squadAdj from './seeds/squad-adjustments.json';

const seeds = { base, groups, schedule2026, modelCfg, modelEnsembleCfg, matchOdds, weather, venuesGeo, teamXg, squadAdj };

// 浏览器里抓 ESPN 完赛 + 跑引擎(预测/滚动Elo/夺冠MC)→ 返回与打包同形状的数据集。
export async function recomputeClient(bundled, { iterations = 1500, withSummary = false } = {}) {
  return recompute({ seeds, bundled, iterations, withSummary });
}
