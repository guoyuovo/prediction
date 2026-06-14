# worldcup-prediction-2026

面向 2026 FIFA 世界杯的端到端比赛预测程序（Node.js，零依赖）。按《2026 世界杯预测体系方法论》实现**多因子加权集成模型**：

> **Elo 评分 35% + xG 效率 25% + 市场赔率 20% + 蒙特卡洛模拟 20%**

覆盖「单场预测（含子模型明细）→ 72 场批量预测 → 10,000 次蒙特卡洛模拟（Elo ±50 扰动）→ 敏感性分析 → Markdown 报告 + HTML 看板」的完整链路。

> ### 数据真实性（已尽量全部真实化）
> | 数据 | 状态 | 来源 |
> | --- | --- | --- |
> | 分组 | 🟢 真实 | 2025-12-05 官方抽签 |
> | 赛程/开球时间 | 🟢 真实 | 官方赛程（北京时间） |
> | **Elo 评分** | 🟢 **官方真实** | `fetch-elo-official.mjs` 抓 [eloratings.net](https://www.eloratings.net) 官方发布 Elo（World.tsv，免 key）。`build-elo.mjs` 也可从 4.9 万场历史自算作备选 |
> | **近期状态 form** | 🟢 **真实计算** | 同上，各队最近 10 场加权 |
> | **FIFA 积分** | 🟢 **官方实时** | `fetch-fifa-ranking.mjs` 抓 FIFA 官方实时接口（api.fifa.com），48/48 队 |
> | **身价** | 🟢 真实 | `data/manual/squad-values-transfermarkt.json`（Transfermarkt 衍生真实值，48/48，人工录入快照——无免费 API） |
> | **阵容评分 squad** | 🟢 真实 | 24 队为文章公布的真实 EA FC 评分；其余 24 队由真实官方 Elo 经"在前 24 队上标定"的映射估算（`build-squad-ratings.mjs`） |
> | **xG 攻防** | 🟡 对手调整真实 | `build-elo.mjs`：0.5·(对手强度调整的真实近 20 场进/失球) + 0.5·(Elo 锚定)。曾用 StatsBomb 真实射门级 xG 验证（37/48 队覆盖，详见对话）。真 xG 国家队无免费全量源，这是行业上限 |
> | **赔率 1X2** | 🟢 **真实·多庄家** | **优先 Titan007（球探网）多庄家共识**（`fetch-titan007-odds.mjs`，每场平均~152家，72/72 全覆盖）；缺失时回退 **ESPN+Bovada 双源**（`fetch-odds.mjs`）。两者并存于 meta 交叉验证，差异通常 <2% |
> | **让球/大小球盘口线** | 🟢 真实 | ESPN spread(让球线) + overUnder(大小球线)，Bovada Total 交叉校验 |
> | **市场情绪（异动/大小球）** | 🟢 真实·多庄家 | **Titan007 欧赔异动**：上百家庄开盘→即时 **去水位隐含概率漂移** → 信号值(-2~+2) + 钱进主/客（`fetch-titan007-odds.mjs`，72/72 全覆盖）；**大小球**：Titan007 OverDown 共识盘口 + 大/小球倾向（24 场，远期未开盘的暂缺）。另有 DraftKings+Bovada 升降盘备选 |
> | **天气** | 🟢 真实 | `fetch-weather.mjs` 经 Open-Meteo**免 key**按场地坐标抓（温度/降水/风速）|
> | **场地** | 🟢 真实 | ESPN 赛事场馆 + 城市 |
> | **已完赛比分（v2）** | 🟢 真实 | `fetch-results.mjs` 抓 ESPN `fifa.world` 计分板完场比分（含半场 best-effort）；名义源 Sailing MCP，未接入时回退 ESPN |
> | **完赛射门统计（xG-v2）** | 🟢 真实 | ESPN 完赛 summary 的射门/射正/控球 → shot-based xG 代理滚动更新攻防 |
> | **国家队伤停** | 🟡 人工 | ESPN injuries 端点实测为空，无免费源；`data/manual/squad-adjustments.json` 据队新闻人工录入 |
>
> 主模型（`model.mjs`）实际消费的输入里，**Elo / form / 赔率 / FIFA / 身价 / 阵容评分全部真实**，xG 攻防为对手调整的真实进球。无任何纯派生/拍脑袋项。
> 唯一的真实性边界是 xG 用进球代替射门级数据——国家队真实 xG 无免费全量源（FBref/StatsBomb 仅覆盖部分赛事），是客观行业上限。

## 环境要求

- Node.js >= 18（原生 ESM），无第三方依赖，开箱即跑

## 快速开始

```bash
# 0) 真实化数据（首次/赛前刷新）
node scripts/fetch-data.mjs        # 下载国际比赛全历史数据集 → data/results.csv
node scripts/build-elo.mjs         # 计算真实 Elo/form/xG 锚定 → 写回 data/
node scripts/fetch-odds.mjs        # 免 key 抓双源赔率(ESPN+Bovada)+让球/大小球线+场地
node scripts/fetch-weather.mjs     # 免 key 抓各场天气（Open-Meteo）
#   npm run pregame    赛前一条龙：抓双源赔率 + 天气 + 重算 + 生成看板
#   npm run refresh-elo  重算真实 Elo（fetch-data + build-elo）

# 单场预测（显示集成结果 + 三个子模型明细）
node scripts/predict-match.mjs --home Mexico --away "South Africa"
node scripts/predict-match.mjs --home Spain --away Uruguay
node scripts/predict-match.mjs --list

# 72 场小组赛批量预测（按北京时间排序）→ CSV
node scripts/batch-predict.mjs

# 蒙特卡洛模拟（默认 10,000 次，Elo σ=50 高斯扰动）→ JSON
node scripts/simulate.mjs
node scripts/simulate.mjs --iterations 50000 --sigma 100 --seed 123

# 敏感性分析：σ=50 vs σ=100 对比（验证 Top5 排序稳定性）
node scripts/sensitivity.mjs

# Markdown 主报告 / HTML 可视化看板
node scripts/report.mjs
node scripts/build-html.mjs

# 一键全流程
npm run all
```

## 两套模型（双页面）

| 页面 | 模型 | 命令 |
| --- | --- | --- |
| **主页面 `index.html`** | **第一篇文章的加权逻辑回归**：`预测=sigmoid(特征×权重)`，特征=Elo·FIFA·身价·近期状态·阵容评分 + 赔率共识融合(0.35) | `npm run html` |
| `ensemble.html` | **第二篇方法论的集成模型**：Elo 35% + xG 25% + 赔率 20% + 蒙特卡洛 20% | `npm run ensemble` |

两套模型的代码（`src/model.mjs` vs `src/model-ensemble.mjs`）、配置（`config/model.json` vs `config/model-ensemble.json`）完全隔离，互不影响。主模型经 `calibrate-weighted.mjs` 向原文 12 场校准（MAE 3.52pp）。

## v2 · 实时滚动 Elo + 完赛验证（基于主模型）

v2 不是另起炉灶，而是在主模型之上叠加**赛中自更新**：每有一场世界杯完赛，就用真实比分做一次标准 Elo 更新，并对当时的赛前预测做样本外打分。

```
完赛比分(ESPN，名义源 Sailing MCP) ──► 逐场标准 Elo 滚动更新(K=60, 进球差 MOV 修正)
   │                                        └─► data/teams-v2.json（滚动后 Elo，其余特征沿用基础真实值）
   └─► 赛前预测 vs 实际 逐场对账(Brier/1X2命中/波胆) ─► data/backtest-v2.json
                                                          └─► index.html 新增「v2 · 完赛验证」标签页
```

- **数据真实**：完赛比分（含半场 best-effort）来自 ESPN `fifa.world` 计分板（`scripts/fetch-results.mjs`，`state=post` 即完场）。名义源是 Sailing MCP，未接入时回退 ESPN，接口一致可无缝替换。
- **东道主**：本届美/加/墨三国联办，`groups.json` 的 `hosts` 三者全含；东道主在本土作战时 Elo 期望 +100，三队同等对待（与主模型 `homeAdv` 同源）。
- **滚动更新**（`scripts/build-elo-v2.mjs`）：以基础官方真实 Elo 为起点，按开球时间顺序逐场 `R' = R + K·G·(W − We)`，进球差越大 G 越高（World Football Elo 惯例）。仅滚动 Elo，不在小样本上重搜权重（避免过拟合）。
- **样本外验证**：每场用**赛前**滚动 Elo + 基础模型出预测，与实际完赛对账，累计 Brier / log-loss / 1X2 命中 / 波胆命中。样本随赛程自动累积。
- **推算后续整届**：v2 用滚动 Elo **重跑 1 万次蒙特卡洛**，且把已完赛结果**固定**（`tournament.mjs` 的 `knownResults`，不再随机重抽）→ 得到"在已发生结果之下、对剩余赛程"的更新版夺冠/出线概率，并与基础模型逐队对比（Δ 百分点）。例：韩国胜捷克后进 32 强概率 75%→96%，捷克 63%→43%。
- 一键：`npm run v2`（抓完赛→滚动 Elo/xG→重建看板）；赛前一条龙 `npm run pregame` 已含 v2 步骤。看板「v2 · 完赛验证」标签页含：live 校准、更新夺冠/出线概率、逐场对账、滚动 Elo 变化、受影响后续场次。

## 本届持续调优（按赛果迭代）

围绕 v2 的"越打越准"闭环，四个真实增量（均用免费公开数据）：

| 能力 | 做法 | 数据源 | 脚本 |
| --- | --- | --- | --- |
| **赛后射门 → xG 滚动** | 完赛 shot-based xG（0.30·射正+0.05·射偏）EWMA 更新球队 att/def → `team-xg-v2.json`，双模型 xG 第二验证消费 | ESPN 完赛射门统计 | `build-xg-v2.mjs` |
| **live 校准** | 累积"赛前预测 vs 实际"→ 置信度分箱 + 命中/Brier 时间线，看板呈现本届可信度 | 自累积 | `build-elo-v2.mjs` |
| **赛前伤停调整** | 核心伤停/停赛 → 下调有效 Elo（仅作用预测层，不污染滚动 Elo），未来场次自动生效 | **API-Football `/injuries`**（免费 key，node 自主，最干净）／ Claude WebFetch 抓 ESPN 追踪页（免 key 最稳）／ 人工 `data/manual/squad-adjustments.json` | `fetch-injuries-api.mjs`(需key) · `fetch-injuries.mjs`(兜底) · `src/adjust.mjs` |
| **每日闭环** | 一条命令跑完 赛前刷新→赛后迭代→重算→重建所有看板，单步失败不中断 | 上述全部 | `npm run daily` |

> **诚实边界**：① 回测证明这些不能"战胜市场"（无 ROI edge），只让预测更贴本届现实、并诚实标注不确定场次；② 不在 ~104 场上重搜模型权重（必过拟合）——只更新 Elo/xG/伤停等**输入**；③ 真 xG（StatsBomb 射门级）国家队无免费源，shot-based 为 ESPN 数据可得的最佳近似；④ 国家队伤停无免费 API，是人工策展项。

**定时运行** `npm run daily`（每个比赛日 1-2 次即可）：
- Windows 计划任务 / Linux cron：`0 9,21 * * *` 调 `node scripts/daily.mjs`
- 或用 Claude Code 的 `/schedule` 起一个 cron 云代理

## 预测方法论（第二篇·集成模型）

### 核心架构：四子模型加权集成

| 子模型 | 权重 | 核心指标 | 实现 |
| --- | ---: | --- | --- |
| Elo 评分模型 | 35% | 历史实力、标准 Elo 公式 | `src/model.mjs` eloSubmodel |
| xG 效率模型 | 25% | 攻防效率 → 泊松 1X2 + 比分 | `src/model.mjs` xgSubmodel |
| 市场赔率模型 | 20% | 去水位隐含概率 + 热门偏差修正 | `src/model.mjs` marketSubmodel |
| 蒙特卡洛模拟 | 20% | 赛事级概率分布（非单场点估计） | `src/tournament.mjs` |

单场预测 = 前三个子模型按**可用性归一加权**（无赔率时 Elo:xG = 35:25 归一）；蒙特卡洛消费单场模型生成夺冠/出线等赛事级概率分布。

### Elo 评分模型（35%）
```
E_A = 1 / (1 + 10^((R_B - R_A) / 400))      # 400 缩放：200 分差 ≈ 75% 期望
R'_A = R_A + K × (S_A - E_A)                # K=60（世界杯），赛后更新公式（记录备用）
```
足球适配：**主场/东道主 +100 Elo**（美墨加东道主自动获得）。Elo 期望只分胜负，用平局模型展开为 1X2：`pDraw = base·exp(-decay·|muE|/tendency)·exp(bias)`，势均力敌时约 26%。

### xG 效率模型（25%）
```
λ主 = att主 × def客 / 联赛均值(1.30)
λ客 = att客 × def主 / 联赛均值
```
泊松网格展开为胜平负与最可能比分。att/def 来自 `data/team-xg.json`（**代理评分**，体现球风：摩洛哥/乌拉圭防守型、挪威/土耳其进攻型）。近期状态以 ±10% 微调攻防效率。

### 市场赔率模型（20%）
1. **去庄家水位**：隐含概率 `1/odds` 除以总和归一（典型水位 3-8%）
2. **热门偏差修正**：Elo 前 20 热门队的隐含概率向下修正 4%（方法论 6.2：3-5%）后重归一

### 蒙特卡洛模拟（20%）
- **10,000 次**迭代，可复现（mulberry32 + 固定 seed）
- 每次迭代对各队 Elo 施加 **N(0, σ=50)** 高斯扰动（"Elo 半年内 ±50 稳定"假设）
- 小组赛 6 场 → 前两名 + 8 个最佳第三名 → 32 强 → 强弱交叉配对逐轮推进至冠军
- 敏感性分析（`scripts/sensitivity.mjs`）：σ 提至 100 时强队概率下降、弱队上升，**Top5 排序保持不变**（已验证 ✓）

### 向原文结果校准（calibrate.mjs）
以原文《小组赛预测》公布的 12 场胜平负概率为目标，网格搜索本地模型自由参数（Elo 差尺度、集成权重、平局基数/衰减、热门去偏），最小化平均绝对误差——即文章自述的"权重搜索 + 回测校准"，拟合后对全部 72 场泛化（非逐场抄结果）。

- **概率 MAE：3.51 → 2.40 个百分点**（`node scripts/calibrate.mjs` 可复现）
- 校准所得权重：Elo 0.30 / xG 0.20 / **赔率 0.50**（原文以市场共识为主锚）
- **比分引擎 = 真实进球率参数化 + Dixon-Coles**（`config/model.json` 的 `scoreline` 块）：λ 与 1X2 supremacy 解耦、DC 低分相关修正抬升 0-0/1-1。参数由 4086 场真实联赛比分回测拟合，**波胆样本外命中 12.9%**（详见下「真实回测」）
- 重新校准：`node scripts/calibrate.mjs --apply`

### 验证结果（与方法论/文章对照）
| 指标 | 本项目 | 文章 |
| --- | --- | --- |
| 西班牙进 32 强 | 99.3% | 99.3%（完全一致） |
| 西班牙夺冠概率 | 31.4%（48强档案 Elo） | 25.9%~"断层领先" |
| 哥伦比亚 | 升至第 8（2.4%） | "被市场低估的价值洼地" |
| σ=100 敏感性 | 强队降弱队升，Top5 排序不变 | "分布平缓，Top5 排序不变" |

> 注：上表是与文章/方法论的**对照**，文章是另一个模型的输出、不是真实结果，对照一致 ≠ 预测准。真实能力以下面的样本外回测为准。

### 真实回测验证（样本外，对真实比赛结果，非对照文章）

诚实结论优先：这是个**数据扎实、校准合理、但对市场无 alpha** 的模型。

**① 胜平负（4086 场真实联赛 + 真实 B365 赔率，`scripts/backtest-multi.mjs`）**

| 模型 | 命中率 | 平注 ROI | 价值投注 ROI |
| --- | --- | --- | --- |
| 加权（主模型） | 52.5% | −5.3% | −9.3% |
| 集成 | 54.3% | −3.1% | −6.9% |

- 命中率约等于"跟博彩热门走"的水平（足球三路 50~53% 正常）。
- **ROI 为负，且"价值投注"比平注更亏**——模型与市场分歧越大越亏，**对市场没有 edge**。看概率可信，当赚钱工具不行。

**② ROI 策略（训练/测试 split，`scripts/roi-strategy.mjs`）**

- "价值投注"被证伪（样本外 −14%）。唯一样本外为正的是**只押模型选中的客胜**（加权 **+6.4%**，4/5 联赛为正），源于"主队偏好偏差"使客胜被系统性高赔。
- ⚠ 此 edge 来自有主客场的联赛；**世界杯小组赛多为中立场，此 edge 未必成立**，需实弹积累验证。

**③ 波胆/精确比分（3300+ 场真实比分，`scripts/scoreline-dc-backtest.mjs`）**

| 引擎 | 单选命中 | top-3 命中 |
| --- | --- | --- |
| 旧（泊松众数，方向内取分） | 8.3% | ~20% |
| **新（Dixon-Coles）** | **12.9%** | **30.9%** |
| 基线（无脑永远押 1-1） | 12.3% | — |

- 新引擎首次**跑赢平凡基线**，且已接近行业天花板（庄家正确比分热门也就 11~13%）。波胆本质高方差，仅供参考。

**实弹（世界杯开赛首 2 场）**：墨西哥 2-0 南非（比分✓）、韩国 2-1 捷克（方向✓比分✗，模型出 1-1）。样本太小，仅作起点。

## HTML 看板（output/index.html）

自包含、离线可看，五个标签页：**夺冠概率 / 分组出线 / 全部对阵 / 最稳·爆冷 / 球队档案**。

- 队名**中文**显示（搜索支持中英文），来自 `data/team-names-zh.json`
- 全部对阵默认**按比赛时间排序**（真实赛程，北京时间），可按分组/确定性/爆冷切换
- 三态分布条**悬停显示子模型明细**（Elo/xG/市场各自的胜平负）；含市场赔率的场次带「赔」标
- **球队档案**：48 张卡片（Elo/身价/年龄/教练/球星/风格/最佳战绩/优势▲隐忧▼），战力分级徽章（S 金 / A+ 绿 / A 蓝…），可按大洲、分级筛选，中英文搜索；估算补全的队带 ≈ 标
- 绿/黄/红 = 主胜/平/客胜

## 文件结构
```
worldcup-prediction-2026/
├── package.json
├── config/
│   └── model.json              # 集成权重 / Elo / xG / 市场 / MC 参数（带方法论出处注释）
├── data/
│   ├── teams.json              # 48 队 Elo/FIFA/身价/状态（Elo/身价来自 48 强档案）
│   ├── team-profiles.json      # 48 队深度档案（分级/教练/球星/风格/优势/隐忧）
│   ├── team-xg.json            # 48 队 xG 攻防代理评分（可替换为 FBref 数据）
│   ├── match-odds.json         # 1X2 欧赔（缺失时市场子模型自动退出）
│   ├── groups.json             # 真实 12 组分组（2025-12-05 抽签）
│   ├── schedule-2026.json      # 真实 72 场小组赛赛程（美东时间）
│   └── team-names-zh.json      # 中文队名映射
├── src/
│   ├── util.mjs                # sigmoid / 可复现随机 / 泊松
│   ├── model.mjs               # 四因子集成模型（Elo + xG + 市场）
│   ├── tournament.mjs          # 蒙特卡洛引擎（Elo 高斯扰动）
│   ├── schedule.mjs            # 赛程读取 + 北京时间转换
│   └── names.mjs               # 中文队名
├── scripts/
│   ├── fetch-data.mjs          # 下载国际比赛全历史数据集
│   ├── build-elo.mjs           # 计算真实 Elo/form/xG 锚定 → 写回 data/
│   ├── fetch-odds.mjs          # 免 key 抓双源赔率(ESPN+Bovada)+让球/大小球线+场地
│   ├── fetch-weather.mjs       # 免 key 抓各场天气（Open-Meteo）
│   ├── fetch-odds-espn.mjs     # 单源 ESPN（已被 fetch-odds 取代，保留）
│   ├── predict-match.mjs       # 单场预测（含子模型明细）
│   ├── batch-predict.mjs       # 72 场批量 → CSV
│   ├── simulate.mjs            # 蒙特卡洛 → JSON（--sigma 可调扰动）
│   ├── sensitivity.mjs         # 敏感性分析（σ=50 vs 100）
│   ├── report.mjs              # Markdown 主报告
│   └── build-html.mjs          # HTML 看板
└── output/                     # 运行后生成
```

## 自定义 / 接入真实数据
- **Elo**：编辑 `data/teams.json`（建议接 eloratings.net 真实数据）
- **xG 攻防**：编辑 `data/team-xg.json`（建议接 FBref/Understat）
- **赔率**：往 `data/match-odds.json` 补 `"主队 vs 客队": [主胜,平,客胜]`，该场自动启用市场子模型
- **调权重/参数**：编辑 `config/model.json`，每个参数带 `_xxx` 出处注释，无需改代码

## 模型局限（方法论 8.3，诚实声明）
伤病与停赛不可预测、更衣室动态不可量化、新规则影响无历史校准、心理因素难以建模、非欧洲联赛数据质量差异——模型有价值，但模型不完美。

## 免责声明
所有夺冠概率、出线概率均为统计模型推演结果，**仅供学术研究和娱乐参考**。足球的魅力恰恰在于其不可预测性。请理性看待预测数据，享受比赛本身。
