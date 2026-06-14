# 世界杯预测 · uniapp + uniCloud(阿里云) 设计方案

> 版本 v1 · 2026-06-14 · 平台 uniCloud 阿里云 · 一套代码 H5/小程序/App
> 模型与算法源自 `d:\test\prediction`（Node 零依赖），本项目负责"云端算 + 前端显"。

---

## 0. 决策基线（已定）

| 项 | 决定 |
| --- | --- |
| 首期范围 | **预测 + 回测/验证 并行全上**（一步到位完整看板） |
| 前端读取 | **clientDB(JQL) 直读** + DB Schema 只读权限；单场 what-if 走云对象 |
| 用户体系 | **先免登录只读**（uni-id 架构预留，本期不实现） |
| 后端 | uniCloud 阿里云：定时云函数算 + 云数据库存 + 公共模块共享模型 |

---

## 1. 定位与原则

- **带透明战绩的预测工具**，不是"荐彩"。差异化 = 预测 + **可验证的回测/校准** + **双模型分歧预警** + 全程真实数据与诚实 caveat。
- **算在云端、显在前端**：抓数据/跑模型只在云端定时执行（几十秒级），前端只读已算好的快照，秒开、零计算、无 CORS。
- **算法零改动**：现有模型逻辑原样移植（仅 ESM→CJS、fetch→httpclient、写文件→写库）。
- **合规**：全程"仅供学术研究与娱乐参考、非投注建议"，不承诺胜率，不诱导购彩。

---

## 2. 总体架构

```
┌─ uniCloud 阿里云 ────────────────────────────────────────────────┐
│  定时触发器(每比赛日 2-3 次)                                       │
│     ├─▶ fetch-data   云函数：httpclient 抓 Elo/FIFA/赔率/天气/海拔/ │
│     │                 完赛比分+射门/伤停 → 原始集合                  │
│     └─▶ compute      云函数：滚动 Elo/xG + 蒙特卡洛 + 72场预测 +    │
│                       双模型 + 回测/校准 → 预测集合                  │
│                              │ 写                                   │
│                    云数据库 collections                            │
│                              ▲ 读                                  │
│      clientDB(JQL 只读)  ◀───┤                                     │
│      co-predict(云对象)  ◀───┘  单场 what-if / 聚合                 │
└──────────────────────────────┼────────────────────────────────────┘
                               ▼ uniCloud SDK
   uniapp 前端（H5/小程序/App）：JQL 读快照 → Vue 渲染
```

**为什么这样**：抓数据有 CORS（前端直连 ESPN/球探网会被拦）→放云函数；蒙特卡洛/回测耗时→定时算一次全员读；读多写少→clientDB 直读开发最快。

---

## 3. 功能 / 页面清单（完整）

主导航 **tabBar 5 项**：赛事 · 荐彩 · 专家 · 回测 · 关于
（「赛事」聚合 夺冠/分组/全部对阵/双模型；荐彩、专家方案为本次新增独立 tab）。

| # | 页面(路由) | tabBar | 内容 | 数据集合 |
| --- | --- | --- | --- | --- |
| 1 | `pages/champions/index` | 夺冠 | v2 更新夺冠榜(进32/4强/决赛/夺冠 + Δvs基础)、分组出线(12组+Δ)、最稳/爆冷 TOP10 | wc_champions, wc_groups |
| 2 | `pages/matches/index` | 对阵 | 72 场列表，筛选(分组/时间/确定性/爆冷)、三态分布条、真实结果徽章 | wc_matches |
| 3 | `pages/match/detail?seq=` | — | 单场详情：双模型明细、子模型(Elo/xG/市场)、多庄赔率、让球/大小球、天气、**海拔/疲劳**、**伤停**、比分推荐 top2、驱动因素、体彩参考 | wc_matches |
| 4 | `pages/dual/index` | 双模型 | 历史预测(对账✓✗) + 未来预测(综合方向+比分top2+置信/爆冷/xG-Tn/⚠分歧/⛰海拔/💤疲劳) | wc_matches, wc_results |
| 5 | `pages/backtest/index` | 回测 | 三模型(主力/xG/综合)4086场 命中·Brier·logloss·ROI；融合权重网格曲线；置信度校准表 | wc_backtest |
| 6 | `pages/validation/index` | 回测(子) | live 校准(本届累积命中/Brier 时间线 + 置信分箱)、完赛逐场对账、滚动 Elo 变化 | wc_results, wc_backtest |
| 7 | `pages/teams/index` | (关于内/独立) | 48 队档案：Elo/身价/教练/球星/风格/分级，中英搜索、按洲/分级筛选 | wc_teams |
| 8 | `pages/team/detail?name=` | — | 单队档案 + 该队赛程与预测 | wc_teams, wc_matches |
| 9 | `pages/about/index` | 关于 | 模型说明(多因子/xG/海拔/疲劳/伤停)、指标说明、**诚实 caveat**、数据来源与更新时间、免责声明 | wc_meta |

> 「回测」tab 内用顶部分段切「回测表现 / live 校准 / 完赛对账」三屏。

### 3b. 荐彩 + 专家方案（新增功能）

#### A. 荐彩推荐（`pages/jingcai/index`，tab「荐彩」）
- **数据**：体彩官方竞彩（胜平负 had / 让球胜平负 hhad / 比分 crs / 总进球 ttg / 半全场 hafu）。
- **内容**：每场列官方竞彩各玩法赔率 + **我方模型推荐**（已有 `buildRec`：单场胜平负/让球方向/预测比分/大小球倾向）并排对照，标"模型 vs 官方赔率隐含"。
- **数据可得性**：⚠ 体彩官方 `webapi.sporttery.cn` 本机 WAF 403/567，**需阿里云国内 IP 部署后验证**；不通则降级用已有 Titan007 多庄共识盘口。
- **合规**：页内固定"竞彩数据来自中国体育彩票，仅供参考，理性购彩，未满 18 岁禁止"。

#### B. 专家方案（`pages/expert/index` + `pages/expert/detail?threadId=`，tab「专家」）
- **数据**：网易红彩免费方案 `hongcai.163.com/api/web/free/entrance`（**已验证可拿、免鉴权**）。
- **列表**：按对阵聚合，每条显示 专家(头像/昵称/slogan)、对阵(关联我方赛程)、标题、免费标记、发布时间；可只看"匹配到当前世界杯赛程"的方案。**已实测 6 条世界杯方案 100% 匹配我方赛程**。
- **详情**：点击 → 展示该方案**所有可得字段** + **我方模型对同场的预测**（交叉对照"专家观点 vs 模型概率"）+ 深链到 163 看完整正文。
  - ⚠ 具体推荐选项(胜平负/比分)与分析正文被 163 **登录门控**（`/free/thread/{id}` 未登录返回非法参数）→ App 内展示元信息 + 模型对照，正文通过深链跳 163。如后续拿到 163 授权再补全。
- **合规**：标注"专家方案来自第三方(网易红彩)、观点仅供参考、不代表本站、理性购彩、18+"。

### 通用组件（`components/`）
- `triple-bar` 三态分布条(主/平/客)
- `pred-badge` 徽章(置信/爆冷/xG-Tn/分歧/海拔/疲劳/伤停)
- `score-rec` 比分推荐(top2 同向)
- `kpi-card` 概览卡
- `calib-table` 校准表
- `team-card` 球队卡
- `empty / loading / update-time` 状态条

---

## 4. 云端设计

### 4.1 公共模块（移植后的模型核心）
`uni_modules/wc-models/uniCloud/cloudfunctions/common/wc-models/`（或 `cloudfunctions/common/wc-models`）

```
common/wc-models/
├── package.json            # { "name":"wc-models", "main":"index.js" }
├── index.js                # 导出 predict/ensemble/tournament/backtest 等
├── model.js                # ← src/model.mjs (CJS)
├── model-ensemble.js       # ← src/model-ensemble.mjs
├── tournament.js           # ← src/tournament.mjs
├── adjust.js               # ← src/adjust.mjs
├── context.js              # ← src/context.mjs
├── venues.js               # ← src/venues.mjs
├── schedule.js             # ← src/schedule.mjs
├── backtest-models.js      # ← src/backtest-models.mjs
├── util.js                 # ← src/util.mjs（去掉 fs/ROOT 依赖，数据改入参）
└── data/                   # 静态只读数据随模块打包
    ├── config-model.json   teams-base.json groups.json schedule-2026.json
    ├── team-xg.json team-profiles.json team-names-zh.json venues-geo.json
```
> 动态数据（赔率/完赛/天气/elo-v2/xg-v2/伤停）不打包，运行时从 DB 入参。

### 4.2 云函数 / 云对象

| 名称 | 类型 | 触发 | 职责 | 超时建议 |
| --- | --- | --- | --- | --- |
| `fetch-data` | 普通云函数 | **定时**(比赛日 2-3 次) | `uniCloud.httpclient` 抓 Elo/FIFA/赔率(ESPN+Bovada+Titan007)/天气/海拔/完赛比分+射门/伤停探测 → 写 `raw_*`/动态集合 | 300s |
| `compute` | 普通云函数 | fetch 成功后触发(URL 调用)或紧随定时 | 读动态+静态 → 滚动 Elo/xG、蒙特卡洛、72场预测、双模型、回测/校准 → 写预测集合 + `wc_meta` | 120s |
| `co-predict` | 云对象 | 前端调用 | `predictMatch(home,away,opts)` 单场实时 what-if；可选聚合查询 | 10s |
| `seed-static` | 普通云函数 | 手动一次 | 把静态档案 seed 进 `wc_teams` 等（或直接打包不入库） | 30s |
| `fetch-hongcai` | 普通云函数 | 随 fetch-data 定时 | 抓 163 红彩免费方案 → `wc_expert_plans`（**已验证可跑**） | 30s |
| `fetch-jingcai` | 普通云函数 | 随 fetch-data 定时 | 抓体彩官方竞彩赔率 → `wc_jc_odds`（⚠云端验证；不通降级 Titan007） | 60s |

> **拆 fetch + compute** 是为避开单函数超时（仅抓赔率就 ~60s）。compute 内部不再发网络请求，纯计算。
> **httpclient 替换**：所有 `fetch(url)` → `uniCloud.httpclient.request(url,{method,data,dataType:'json',timeout})`。

### 4.3 定时触发配置
`cloudfunctions/fetch-data/package.json` 内 `cloudfunction-config.triggers`：
```json
{ "triggers": [{ "name": "daily", "type": "timer", "config": "0 0 9,15,21 * * * *" }] }
```
（阿里云 cron 7 段；示例每天 9/15/21 点。compute 由 fetch-data 末尾用 `uniCloud.importObject`/URL 调起，或单设定时晚 2 分钟。）

---

## 5. 数据库集合设计（clientDB 只读）

| 集合 | 文档量 | 关键字段 | 前端读 |
| --- | --- | --- | --- |
| `wc_meta` | 1 | `lastUpdate, eloSource, dataFreshness, season, modelVersion` | ✓ |
| `wc_matches` | 72 | `seq,date,time,group,home,away,homeAdv, pred{h,d,a,score,topScores,expGoals,sub}, dual{A,B,C,conf,upset,agree,scores}, ctx{elev,eloAdj,rest,travel}, odds{titan007,espn,bovada,implied}, ah,ou,weather,venue, adj{home,away}, result{hs,as,ht,r}` | ✓ |
| `wc_champions` | 48 | `team,elo, r32,qf,sf,final,champion, baseChampion,baseR32` | ✓ |
| `wc_groups` | 12 | `group, rows:[{team,r32,champion,baseR32}]` | ✓ |
| `wc_teams` | 48 | `team,zh, elo,eloV2, value,age,coach,star,style,tier,confed,strengths,concerns, xg{att,def}` | ✓ |
| `wc_results` | N | `et,group,home,away,hs,as,ht, predOutcome,correct,predScore,scoreHit,brier, eloDelta..., stats{shots,sot,poss}` | ✓ |
| `wc_backtest` | 3-5 | `type(multi/dual/tune), summary, results, grid, calibration` | ✓ |
| `wc_adjustments` | 动态 | `team,eloPenalty,reason,until,active`（本期只读展示） | ✓ |
| `wc_jc_odds` | 72 | `home,away,had,hhad,crs,ttg,hafu`（体彩竞彩各玩法赔率）+ `modelRec`(我方推荐) | ✓ |
| `wc_expert_plans` | 动态 | `threadId,expert{name,avatar,slogan},home,away,matchZh,title,free,price,publishTime,link`（关联 `wc_matches`） | ✓ |

**DB Schema 权限**（每个 `*.schema.json`）：
```json
{ "permission": { "read": true, "create": false, "update": false, "delete": false } }
```
> 全公开只读；写操作仅云函数（云端用 `db` 跳过 schema 权限）。本期无用户，故无需 `auth`。

**前端读取示例（JQL）**：
```js
const db = uniCloud.database()
const { data } = await db.collection('wc_matches').orderBy('seq','asc').limit(100).get()
```

---

## 6. 模型移植清单（算法零改动）

| 现有 `d:\test\prediction` | 移植到 | 改动点 |
| --- | --- | --- |
| `src/model.mjs` 等 9 个核心 `.mjs` | `common/wc-models/*.js` | `import`→`require`、`export`→`module.exports`；`loadJson(path)` 改为"数据入参"或从打包 `data/` 读 |
| `scripts/fetch-*.mjs` 的网络层 | `fetch-data` 云函数 | `fetch`→`uniCloud.httpclient`；解析逻辑照搬 |
| `writeFileSync(data/*.json)` | DB `collection().add/update` | 动态数据写库；静态随模块打包 |
| `scripts/build-html / build-dual-page` 的"算 payload"部分 | `compute` 云函数 | 保留 payload 计算，**删掉 HTML 字符串拼接**（前端 Vue 接管） |
| `output/*.html` | — | 弃用，前端渲染替代 |

> ⚠ 不要把 `clubelo-snapshots.json`(1.5M)、`results.csv`(3.7M) 打包进云函数——仅回测用，且回测结果已是少量汇总数字，直接把 `wc_backtest` 汇总入库即可，原始大文件留在 `d:\test\prediction` 离线算。

---

## 7. 数据流（一次更新闭环）

```
定时 → fetch-data：抓 8 类外部数据 → 写 raw/动态集合 + 静态(已打包)
     → compute  ：读全部 → 滚动 Elo/xG → MC(固定已完赛) → 72场预测+双模型+情境修正
                  → 回测/校准汇总 → 覆盖写 wc_matches/champions/groups/teams/results/backtest
                  → 更新 wc_meta.lastUpdate
前端 → onLoad：JQL 拉对应集合 → pinia/store 缓存 → 组件渲染（顶部显 lastUpdate）
```

---

## 8. 前端目录结构（建议）

```
pages/
├── champions/index.vue      对阵/matches/index.vue   match/detail.vue
├── dual/index.vue           backtest/index.vue       validation/index.vue
├── teams/index.vue          team/detail.vue          about/index.vue
components/  (triple-bar, pred-badge, score-rec, kpi-card, calib-table, team-card, ...)
store/  (pinia: predictions, results, backtest, meta —— 带本地缓存+TTL)
common/  (api.js 封装 JQL 读取; format.js 概率/比分格式化; theme.scss 暗色令牌)
static/  (icons, flags 国旗)
```
> 沿用现有 dual.html 的**暗色令牌**（`#0f1115/#181b22/绿#36c275/红#ff5d6c/黄#ffc23d/金#ffd24a`）做 `theme.scss`，视觉与现网一致。

---

## 9. 关键技术注意点

1. **ESM→CJS**：阿里云云函数默认 CJS。逐文件转 `module.exports`；`util.js` 去掉 `node:fs`/`ROOT`，数据走入参。
2. **httpclient**：替代全局 `fetch`；注意阿里云出网需在控制台开通/配置，部分源(Titan007)响应慢需 `timeout: 30000` 并容错。
3. **超时/拆分**：fetch 与 compute 分离；fetch 内各源 try/catch 互不影响（沿用 `daily.mjs` 容错思路）。
4. **冷启动/包体**：公共模块只带必要静态 JSON，大历史文件排除。
5. **幂等**：compute 用覆盖写（先按 key upsert），定时重复跑结果一致。
6. **时区**：开球时间存 UTC，前端按北京时间显示（沿用 `schedule.mjs` 逻辑）。
7. **回测数据**：4086 场回测在离线端(`d:\test\prediction`)算好，只把 `summary/grid/calibration` 少量结果入 `wc_backtest`；本届 live 校准由 compute 增量算。
8. **伤停**：本期 `wc_adjustments` 只读展示；P3 再加后台编辑(需登录鉴权)。

---

## 10. 分期与里程碑（首期并行全上）

**P0 · 打通"算→存→显"（骨架）**
- [ ] 移植 9 个模型文件为 `common/wc-models`（CJS），本地 `node` 自测 predict 一致
- [ ] 写 `compute` 云函数：把现有完整 payload(matches/champions/groups/dual/backtest) 一次性写入各集合
- [ ] 建 8 个集合 + schema 只读权限
- [ ] 前端 3 页(夺冠/对阵/详情) clientDB 读通

**P1 · 完整看板（预测+回测并行）**
- [ ] 双模型页 + 回测页 + 验证页(live校准/对账) + 球队档案 + 关于
- [ ] 通用组件库 + 暗色主题 + 顶部更新时间
- [ ] `co-predict` 云对象：单场 what-if

**P2 · 自动化**
- [ ] `fetch-data` 接 httpclient 抓 8 类数据 + 定时触发
- [ ] fetch→compute 串联 + 容错 + 日志

**P3 · 用户(可选，后期)**
- [ ] uni-id 登录 + 收藏球队/场次 + uni-push 开赛提醒 + 伤停后台编辑

---

## 11. 风险与诚实声明

- 模型**对市场无 ROI edge**（回测已证），产品定位是"透明预测+战绩可查"，**不得宣传稳赚/高胜率**。
- 海拔/疲劳/伤停为**物理先验型小修正**，未经样本外验证，前端在「关于」如实标注。
- 数据源为公开免费接口，存在不稳定/字段变动风险，fetch 层需容错与降级。
- 全站底部固定免责：仅供学术研究与娱乐参考，非投注建议，理性看待。
- **荐彩/专家方案合规**：竞彩数据来自中国体育彩票官方；专家方案来自第三方(网易红彩)、观点仅供参考、不代表本站；全程"理性购彩、量力而行、未满 18 周岁禁止参与"；不承诺中奖、不诱导投注、不代购。

---

*本设计随实现迭代更新。算法实现细节以 `d:\test\prediction` 源码为准。*
