# 2026 世界杯预测 · uniapp(uniCloud 阿里云)

预测看板 + 透明回测/验证 + 荐彩参考 + 专家方案聚合。一套代码 H5/小程序/App。
设计文档见 [DESIGN.md](./DESIGN.md)。模型与离线数据生成在 `d:\test\prediction`。

## 快速测试（零云端依赖）

v1 前端直接读 **bundled 真实数据**（`static/data/*.json`），无需配置云端即可跑：

1. HBuilderX 打开本项目 → 运行 → **运行到浏览器(H5)**。
2. 5 个 tab：**赛事**(夺冠/分组/对阵) · **荐彩** · **专家** · **回测** · **关于**。
3. 点对阵/方案进详情。

## 数据从哪来 / 如何刷新

- `static/data/*.json` 由 `d:\test\prediction` 的模型算出后导出：
  ```bash
  cd d:\test\prediction
  npm run daily              # 拉最新数据 + 跑模型（v2 滚动 Elo/xG + 海拔/疲劳/伤停 + 双模型 + 回测）
  node scripts/fetch-hongcai.mjs        # 抓 163 免费专家方案
  node scripts/build-app-payload.mjs    # 导出 → 本项目 static/data/*.json
  ```
- 数据文件：`meta / teams / champions / matches / v2 / dual / experts`。
- 切换数据访问只需改 `common/api.js` 的 `load()`（bundled ↔ clientDB）。

## 云端（生产更新层，可选）

`uniCloud-aliyun/cloudfunctions/`：
| 云函数 | 状态 | 说明 |
| --- | --- | --- |
| `fetch-hongcai` | ✅ 已验证可跑 | 抓 163 免费专家方案 → `wc_expert_plans`（含定时触发） |
| `fetch-jingcai` | ⚠ 待云端验证 | 抓体彩官方竞彩 → `wc_jc_odds`/`wc_jc_raw`。本机 WAF 403，国内云函数 IP 大概率可通；**首次部署务必看 `wc_jc_raw` 原始结构**再微调字段映射 |

部署：HBuilderX 右键云函数 → 上传部署运行。`database/*.schema.json` 已设只读权限（前端 clientDB 可读）。

> 后续上云全量：把 9 个模型移植成 `common/wc-models`(CJS) + `compute` 云函数（见 DESIGN.md §6/§4），让云端定时算，前端 `load()` 切 clientDB。本期先 bundled 跑通。

## 合规

预测为统计推演，**非投注建议**；回测显示对市场无稳定盈利优势。竞彩数据来自中国体育彩票官方；专家方案来自第三方(网易红彩)、观点仅供参考不代表本站。**理性购彩、量力而行、未满 18 周岁禁止参与**；不承诺中奖、不诱导、不代购。
