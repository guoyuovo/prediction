#!/usr/bin/env node
// 单赛事回测页面（双模型对比）→ output/*.html（隔离：只读 data/backtest-*.json）
// 用法：node scripts/build-backtest-page.mjs --data data/backtest-cl.json --out output/backtest.html

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const D = JSON.parse(readFileSync(join(ROOT, arg('data', 'data/backtest-cl.json')), 'utf-8'));
const OUT = arg('out', 'output/backtest.html');
const pct = (x) => (x * 100).toFixed(1) + '%';
const sign = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const rc = (x) => (x >= 0 ? 'var(--green)' : 'var(--red)');
const w = D.weighted, e = D.ensemble, hasOdds = D.meta.hasOdds;

function metricCard(label, W, E, cls) {
  return `<div class="mcard ${cls}"><h3 class="${cls}col">${label}</h3>
    <div class="kv"><span>命中率</span><b class="big">${pct(W.acc)}</b></div>
    <div class="kv"><span>Brier</span><b>${W.brier.toFixed(3)}</b></div>
    <div class="kv"><span>LogLoss</span><b>${W.logloss.toFixed(3)}</b></div>
    ${hasOdds
      ? `<div class="kv"><span>押主选 ROI</span><b style="color:${rc(W.flat.roi)}">${sign(W.flat.roi)}</b></div>
         <div class="kv"><span>价值投注 ROI</span><b style="color:${rc(W.value.roi)}">${sign(W.value.roi)}</b></div>`
      : `<div class="kv"><span>盈亏平衡赔率</span><b class="gold">${W.breakeven?.toFixed(2) ?? '—'}</b></div>`}
  </div>`;
}
const verdict = hasOdds
  ? `两模型真实 ROI 分别为 加权 ${sign(w.flat.roi)} / 集成 ${sign(e.flat.roi)}——${w.flat.roi < 0 && e.flat.roi < 0 ? '<b>均为负，跑不赢市场</b>' : '存在边际，需更大样本验证'}。`
  : `两模型命中率 加权 ${pct(w.acc)} / 集成 ${pct(e.acc)}（该赛事无免费历史赔率，用盈亏平衡赔率表达）。`;

const html = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>回测 · ${D.meta.competition} ${D.meta.season}</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--panel2:#1f232c;--line:#2a2f3a;--txt:#e6e8ec;--muted:#8b93a1;--accent:#4ea1ff;--purple:#a78bfa;--green:#36c275;--red:#ff5d6c;--gold:#ffd24a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",Roboto,sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 18px 70px}h1{margin:0 0 4px;font-size:23px}
  .banner{background:linear-gradient(90deg,#1d2a40,#1a1f2b);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0 18px}
  .small{color:var(--muted);font-size:12px}.gold{color:var(--gold)}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .mcard{border-radius:12px;padding:16px 18px;border:1px solid var(--line)}
  .mcard.w{background:linear-gradient(160deg,#192230,#181b22)}.mcard.e{background:linear-gradient(160deg,#241f3a,#181b22)}
  .mcard h3{margin:0 0 10px;font-size:15px}.big{font-size:22px;font-weight:700}
  .wcol{color:var(--accent)}.ecol{color:var(--purple)}
  .kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--line);font-size:13px}.kv span{color:var(--muted)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px}
  .verdict{border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.7;border:1px solid rgba(78,161,255,.25);background:rgba(78,161,255,.07);color:#cfe0ff}
  footer{color:var(--muted);font-size:12px;margin-top:24px;line-height:1.8}a{color:var(--accent)}
</style></head><body><div class="wrap">
  <h1>📊 回测 · ${D.meta.competition} ${D.meta.season}</h1>
  <div class="banner">
    <div>${D.meta.matches} 场 · 无泄漏 walk-forward · 同一批真实比赛分别用两套模型预测</div>
    <div class="small"><span class="wcol">加权模型(第一篇)</span> vs <span class="ecol">集成模型(第二篇)</span> · 俱乐部 Elo clubelo.com${hasOdds ? ' · 真实 B365 赔率' : ''}</div>
  </div>
  <div class="cmp">${metricCard('加权模型（主页面）', w, e, 'w')}${metricCard('集成模型（第二篇）', e, w, 'e')}</div>
  <div class="panel"><div class="verdict">${verdict}</div></div>
  <footer>免责声明：回测基于历史数据，不构成投注建议。← <a href="home.html">返回导航</a><br/>
  复跑见 README。</footer>
</div></body></html>`;
writeFileSync(join(ROOT, OUT), html, 'utf-8');
console.log(`✓ 双模型回测页面 → ${OUT}`);
