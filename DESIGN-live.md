# 滚球实时推荐 + 数据刷新 — 设计文档（定稿 v1.0）

> 已拍板:后端走 **uniCloud**,但**最小化上云**——抓取与重算全部留在本地,
> 云端只负责"存 / 送 / 滚球"。本文为实现依据。

---

## 0. 关键决策(已定)

1. **后端 = uniCloud**(非 CDN-only、非 GH Actions)。
2. **最小化上云**:云端零抓取、零模型、零常驻 cron。
3. **抓取 + 重算全部本地**:你本机在国内,实测 `daily.mjs` 16/16 全过——
   ESPN/eloratings(境外)+ Titan007/红彩/体彩(国内)**本机全抓得到**,
   所以"国内源必须上云"对本方案不成立。
4. **滚球 = 手动触发**(点击才请求)+ 服务端 **60s 短缓存**(并发点击塌缩成 1 次抓取)。
5. **滚球只作参考,绝不修改赛前预测**(`matches.json` 原样不动)。
6. 现有 `fetch-hongcai` / `fetch-jingcai` 云函数**冗余**(本地已抓)→ 停用/删。

---

## 1. 本地 vs 云 分工

| 任务 | 放哪 | 理由 |
|---|---|---|
| 抓 ESPN 结果/Elo/赔率/天气 | 🖥️ 本地 | 境外源,本机直连 |
| 抓 Titan007/红彩/体彩 | 🖥️ 本地 | 本机在国内,实测可抓 |
| 滚动 Elo/xG/蒙特卡洛/批量预测 | 🖥️ 本地 | 重 CPU,~5 分钟 |
| odds-history 累积 / 组 payload | 🖥️ 本地 | 有状态;build-app-payload 现成 |
| 历史回测/调参 | 🖥️ 本地 | 一次性,已剥离 |
| **存快照 wc_payload** | ☁️ 云 | always-on 存储 |
| **送数据 co-data** | ☁️ 云 | 前端随时读、小程序原生 |
| **接收 payload put-payload** | ☁️ 云(瘦) | 本地跑完 POST 上来 |
| **滚球 live-rec** | ☁️ 云(瘦) | 按点击+常驻,本机给不了 |

---

## 2. 最小云清单(4 个,真正算东西的只有滚球)

```
☁️ wc_payload   DB,放本地算好的全量快照(~250KB)
☁️ co-data      读,返回快照给前端                 ← 已有,优先读 wc_payload,回退打包
☁️ put-payload  瘦写入,本地 daily 跑完 POST(带密钥) ← 新
☁️ live-rec     滚球,点击触发 + 60s 缓存            ← 新,唯一云端计算
```

云上**零抓取、零模型、零常驻 cron**。

---

## 3. 数据流

```
[本地] node engine/scripts/daily.mjs
   → 全抓 + 全算 + build-app-payload 组 payload
   → POST payload 到 put-payload(带密钥)
        └─ put-payload 写 wc_payload(DB)

[前端] 列表/详情 → co-data.getAll() → 读 wc_payload(回退打包 JSON)
       点击某场"实时推荐" → live-rec(seq)
                              ├─ 查 wc_live_cache 该场,<60s 直接返回
                              └─ 过期 → 读 wc_payload 取 λ + 抓 ESPN live → 条件泊松 → 写缓存 → 返回
```

---

## 4. 滚球模型(条件泊松,纯数学,不依赖大数据)

输入:赛前 λ(`matches.json.eg`,如 `2.6-0.5`,已有)+ ESPN 实时比分 + 当前分钟。

```
剩余比例   f   = clamp((90 - 分钟 + 补时) / 90, 0, 1)
剩余期望   λh' = λh × f ,  λa' = λa × f
最终       = 当前比分 + 泊松(λh') , 当前比分 + 泊松(λa')
实时 P(主/平/客) = 剩余进球泊松卷积(0..6 球收敛)
实时大小球       = P(总进球 > 盘口 | 当前总进球 + 剩余泊松)
```
- 可选增强(便宜):ESPN 有红牌 → 少一人则该队 λ' 打折(×0.7)。
- 输出:实时概率条 + "实时倾向"标签,**显著标注「参考 · 不改赛前预测 · 理性购彩 · 18+」**。
- 计算量 < 1ms。瓶颈是 1 次 ESPN 抓取,被 60s 缓存兜住。

---

## 5. 数据结构

`wc_payload`(DB,put-payload 覆盖写):
```
{ updatedAt, payload: { meta, teams, champions, matches, v2, dual, experts } }
```
（结构 = 现有 co-data/payload.json,co-data 已兼容。）

`wc_live_cache`(DB,live-rec 写,滚球缓存):
```json
{ "seq": 7, "updatedAt": "...",
  "minute": 63, "score": [1,0], "redCards": [0,0],
  "p": [0.71,0.20,0.09], "ou": { "line": 2.5, "over": 0.28 },
  "lean": "倾向主胜·小球", "note": "参考·不改赛前预测" }
```

---

## 6. 成本 / 服务器压力

| 云组件 | 频率 | 压力 |
|---|---|---|
| put-payload | 本地一天几次 | 忽略 |
| co-data | ∝ 用户开 App | 唯一随用户涨;只读单 doc,大了再拆/缓存 |
| live-rec | 点击 × 60s 缓存 | 并发塌缩成 1 次抓取,封顶 |

> 无常驻 cron、无云端 MC、无云端爬虫。压力基本只剩"只读 co-data"。
> GB-s / 调用次数全程在免费额度量级。

---

## 7. 合规

实时推荐更敏感(近似诱导即时投注):实时块**必须显著标注**
`仅供参考 · 理性购彩 · 18+`,且与赛前预测视觉区隔。沿用主站免责体系。

---

## 8. 分阶段

- **阶段 0(前提)**:关联 uniCloud 云空间(manifest 现为空)。
- **阶段 1(本次开工)**:
  1. `put-payload` 瘦函数(收 payload 写 wc_payload,密钥校验)
  2. `build-app-payload` 加可选"推送到 put-payload"步骤
  3. `live-rec` 滚球函数(条件泊松 + 60s 缓存)+ 前端实时参考块
  4. 停用冗余的 fetch-hongcai/fetch-jingcai
  → 拿到 uniCloud 全部架构收益,**零模型上云**。
- **阶段 2(可选,以后)**:若要彻底去本地依赖,再把 fetch+compute 移植成 uniCloud cron(~3.5 天,见评估)。

---

## 9. 待确认

1. uniCloud 阿里云 **Node 运行时版本**(云函数统一用 `uniCloud.httpclient`,规避 fetch 版本风险)。
2. **滚球玩法**:先只胜平负(建议),大小球二期。
3. **轮询/刷新**:滚球为手动点击,无轮询;可加"刷新"按钮(仍走 60s 缓存)。
4. 阶段 0 关联云空间需你的 uniCloud 账号操作。
