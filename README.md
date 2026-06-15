# 2026 世界杯预测 · uniapp

预测看板 + 透明回测/验证 + 荐彩参考 + 专家方案聚合。一套代码 H5/小程序/App。

## 快速测试

1. HBuilderX 打开本项目 → 运行 → **运行到浏览器(H5)** 或 App。
2. 5 个 tab：**赛事** · **荐彩** · **专家** · **回测** · **关于**。
3. 打开即 HTTP 拉 GitHub/jsDelivr 最新 `payload.json`；离线回退打包数据。

## 数据更新

- **全员同步**：GitHub Actions 每小时跑 `engine/scripts/daily.mjs` → 提交 `static/data/payload.json`。
- **滚球实时**：详情页直连 ESPN API（不经过 GitHub）。
- 本地重算：`cd engine && npm run daily`

## 合规

预测为统计推演，**非投注建议**；回测显示对市场无稳定盈利优势。竞彩数据来自中国体育彩票官方；专家方案来自第三方(网易红彩)、观点仅供参考不代表本站。**理性购彩、量力而行、未满 18 周岁禁止参与**；不承诺中奖、不诱导、不代购。
