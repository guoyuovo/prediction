#!/usr/bin/env node
// 统一导航首页 → output/home.html（链接所有页面）
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const has = (f) => existsSync(join(ROOT, 'output', f));

const groups = [
  {
    title: '🔮 预测（2026 世界杯）', cards: [
      { f: 'index.html', t: '主预测看板', d: '第一篇文章的加权模型（Elo·FIFA·身价·状态·阵容+赔率融合）。72 场预测、夺冠概率、分组出线、球队档案、逐场详情（双源赔率/盘口异动/天气/场地）。', tag: '主模型', c: 'a' },
      { f: 'ensemble.html', t: '集成模型', d: '第二篇方法论：Elo 35% + xG 25% + 赔率 20% + 蒙特卡洛 20%。含三子模型逐场明细。与主页面隔离对照。', tag: '第二篇', c: 'p' },
      { f: 'article.html', t: '原文方案复刻', d: '原文发布预测的逐字复刻（前 12 场），作为校准基准。', tag: '基准', c: 'g' },
    ],
  },
  {
    title: '🔬 回测验证（真实历史数据 · 双模型对比）', cards: [
      { f: 'validation.html', t: '多赛事验证', d: '5 大联赛×多赛季(真实B365赔率)+NBA，加权 vs 集成对比。结论：两模型均跑不赢市场。', tag: '7700+场', c: 'b' },
      { f: 'backtest-epl.html', t: '英超回测', d: '英超 2024-25，双模型真实 ROI（B365 结算）。', tag: '真实ROI', c: 'b' },
      { f: 'backtest.html', t: '欧冠回测', d: '欧冠 2024-25，双模型命中率/校准/盈亏平衡赔率。', tag: '命中率', c: 'b' },
    ],
  },
];

const cardHtml = (c) => has(c.f)
  ? `<a class="card ${c.c}" href="${c.f}"><div class="ctag">${c.tag}</div><div class="ct">${c.t}</div><div class="cd">${c.d}</div></a>`
  : `<div class="card off"><div class="ct">${c.t}</div><div class="cd">（未生成）</div></div>`;

const html = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>2026 世界杯预测系统 · 导航</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--line:#2a2f3a;--txt:#e6e8ec;--muted:#8b93a1;--accent:#4ea1ff;--purple:#a78bfa;--green:#36c275;--blue:#36b8c2;--gold:#ffd24a}
  *{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 50% -10%,#1a2740,#0f1115);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",Roboto,sans-serif;min-height:100vh}
  .wrap{max-width:1040px;margin:0 auto;padding:48px 18px 70px}
  h1{margin:0 0 6px;font-size:30px}.sub{color:var(--muted);margin-bottom:8px}
  .meta{color:var(--muted);font-size:12px;margin-bottom:28px}
  h2{font-size:16px;margin:28px 0 12px;color:var(--txt)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;text-decoration:none;color:var(--txt);transition:transform .12s,border-color .12s;position:relative}
  .card:hover{transform:translateY(-3px);border-color:var(--accent)}
  .card.off{opacity:.45}
  .ctag{position:absolute;top:14px;right:14px;font-size:11px;padding:2px 9px;border-radius:999px;background:#222a36;color:var(--muted)}
  .card.a .ctag{background:rgba(78,161,255,.18);color:var(--accent)}
  .card.p .ctag{background:rgba(167,139,250,.18);color:var(--purple)}
  .card.b .ctag{background:rgba(54,184,194,.18);color:var(--blue)}
  .card.g .ctag{background:rgba(255,210,74,.18);color:var(--gold)}
  .ct{font-size:17px;font-weight:700;margin-bottom:8px}.cd{color:var(--muted);font-size:13px;line-height:1.6}
  footer{color:var(--muted);font-size:12px;margin-top:36px;line-height:1.8}
</style></head><body><div class="wrap">
  <h1>⚽ 2026 世界杯预测系统</h1>
  <div class="sub">两套模型 · 真实数据（Elo eloratings · 双源赔率 ESPN+Bovada · 天气 Open-Meteo）· 多赛事回测验证</div>
  <div class="meta">数据真实化：官方 Elo / 双源真实赔率 / 让球·大小球·盘口异动 / 天气场地 / clubelo 回测 Elo。FIFA·阵容为代理（小权重）。</div>
  ${groups.map((g) => `<h2>${g.title}</h2><div class="grid">${g.cards.map(cardHtml).join('')}</div>`).join('')}
  <footer>免责声明：所有预测基于统计模型与历史数据，仅供娱乐参考，不构成投注建议。购彩有节制，理性投注。<br/>
  一键刷新：<code>npm run pregame</code>（赛前数据）· <code>npm run validate</code>（回测）· <code>npm run home</code>（本页）</footer>
</div></body></html>`;
writeFileSync(join(ROOT, 'output', 'home.html'), html, 'utf-8');
console.log('✓ 导航首页 → output/home.html');
