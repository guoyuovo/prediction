#!/usr/bin/env node
// 多赛事验证页面（双模型对比）→ output/validation.html（隔离：只读 data/backtest-multi.json）
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const D = JSON.parse(readFileSync(join(ROOT, 'data', 'backtest-multi.json'), 'utf-8'));
const pct = (x) => (x * 100).toFixed(1) + '%';
const sign = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const rc = (x) => (x >= 0 ? 'var(--green)' : 'var(--red)');
const fb = D.results.filter((r) => r.sport === '足球');
const nba = D.results.filter((r) => r.sport === 'NBA');
const sw = D.summary.weighted, se = D.summary.ensemble;

const fbRows = fb.map((r) => `<tr>
  <td>${r.id}</td><td class="num">${r.n}</td>
  <td class="num">${pct(r.weighted.acc)}</td><td class="num" style="color:${rc(r.weighted.flat.roi)}">${sign(r.weighted.flat.roi)}</td>
  <td class="num" style="border-left:1px solid var(--line)">${pct(r.ensemble.acc)}</td><td class="num" style="color:${rc(r.ensemble.flat.roi)}">${sign(r.ensemble.flat.roi)}</td>
</tr>`).join('');
const nbaRows = nba.map((r) => `<tr>
  <td>${r.id}</td><td class="num">${r.n}</td>
  <td class="num">${pct(r.weighted.acc)}</td><td class="num">${r.weighted.breakeven?.toFixed(2) ?? '—'}</td>
  <td class="num" style="border-left:1px solid var(--line)">${pct(r.ensemble.acc)}</td><td class="num">${r.ensemble.breakeven?.toFixed(2) ?? '—'}</td>
</tr>`).join('');

const better = se.acc > sw.acc ? '集成模型' : '加权模型';
const html = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>多赛事验证 · 双模型对比</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--panel2:#1f232c;--line:#2a2f3a;--txt:#e6e8ec;--muted:#8b93a1;--accent:#4ea1ff;--purple:#a78bfa;--green:#36c275;--red:#ff5d6c;--gold:#ffd24a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",Roboto,sans-serif}
  .wrap{max-width:1040px;margin:0 auto;padding:28px 18px 70px}h1{margin:0 0 4px;font-size:24px}
  .banner{background:linear-gradient(90deg,#1d2a40,#1a1f2b);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0 18px}
  .small{color:var(--muted);font-size:12px}
  .cmp{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
  .mcard{border-radius:12px;padding:16px 18px;border:1px solid var(--line)}
  .mcard.w{background:linear-gradient(160deg,#192230,#181b22)}.mcard.e{background:linear-gradient(160deg,#241f3a,#181b22)}
  .mcard h3{margin:0 0 10px;font-size:15px}.mcard .big{font-size:22px;font-weight:700}
  .kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed var(--line);font-size:13px}.kv span{color:var(--muted)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px}
  .panel h2{margin:0 0 12px;font-size:16px}
  table{width:100%;border-collapse:collapse}th,td{padding:6px 9px;text-align:left;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-size:12px;font-weight:600}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .grphead th{text-align:center;font-size:13px}
  .wcol{color:var(--accent)}.ecol{color:var(--purple)}
  .verdict{border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.7;border:1px solid rgba(255,93,108,.3);background:rgba(255,93,108,.07);color:#ffc9cf}
  footer{color:var(--muted);font-size:12px;margin-top:24px;line-height:1.8}
  a{color:var(--accent)}
</style></head><body><div class="wrap">
  <h1>🔬 多赛事验证 · 双模型对比</h1>
  <div class="banner">
    <div>足球 5 大联赛 × 多赛季（真实 B365 赔率）+ NBA（自算 Elo） · 无泄漏 walk-forward</div>
    <div class="small">同一批真实比赛，分别用 <span class="wcol">加权模型(第一篇)</span> 与 <span class="ecol">集成模型(第二篇)</span> 预测并对比 · clubelo Elo · football-data.co.uk</div>
  </div>

  <div class="cmp">
    <div class="mcard w"><h3 class="wcol">加权模型（主页面）</h3>
      <div class="kv"><span>足球命中率</span><b class="big">${pct(sw.acc)}</b></div>
      <div class="kv"><span>押主选 ROI</span><b style="color:${rc(sw.flatROI)}">${sign(sw.flatROI)}</b></div>
      <div class="kv"><span>价值投注 ROI</span><b style="color:${rc(sw.valueROI)}">${sign(sw.valueROI)}</b></div>
    </div>
    <div class="mcard e"><h3 class="ecol">集成模型（第二篇）</h3>
      <div class="kv"><span>足球命中率</span><b class="big">${pct(se.acc)}</b></div>
      <div class="kv"><span>押主选 ROI</span><b style="color:${rc(se.flatROI)}">${sign(se.flatROI)}</b></div>
      <div class="kv"><span>价值投注 ROI</span><b style="color:${rc(se.valueROI)}">${sign(se.valueROI)}</b></div>
    </div>
  </div>

  <div class="panel"><div class="verdict">
    📊 ${se.acc.toFixed(4) === sw.acc.toFixed(4) ? '两模型命中率接近' : `<b>${better}</b>在 ${sw.matches.toLocaleString()} 场足球上命中率更高（${pct(se.acc)} vs ${pct(sw.acc)}）`}。
    但<b>两套模型的真实 ROI 都为负</b>（加权 ${sign(sw.flatROI)} / 集成 ${sign(se.flatROI)}）——无论哪种结构，纯 Elo+赔率 都<b>跑不赢高效博彩市场</b>。模型差异影响命中率与校准，但都不构成盈利策略。
  </div></div>

  <div class="panel">
    <h2>足球（真实 B365 赔率 → 真实 ROI）</h2>
    <table>
      <thead>
        <tr class="grphead"><th rowspan="2">联赛/赛季</th><th rowspan="2" class="num">场次</th><th colspan="2" class="wcol">加权模型</th><th colspan="2" class="ecol" style="border-left:1px solid var(--line)">集成模型</th></tr>
        <tr><th class="num">命中率</th><th class="num">押主选ROI</th><th class="num" style="border-left:1px solid var(--line)">命中率</th><th class="num">押主选ROI</th></tr>
      </thead>
      <tbody>${fbRows}</tbody>
    </table>
  </div>

  <div class="panel">
    <h2>NBA（自算 Elo · 2 路 · 盈亏平衡赔率）</h2>
    <table>
      <thead>
        <tr class="grphead"><th rowspan="2">赛季</th><th rowspan="2" class="num">场次</th><th colspan="2" class="wcol">加权模型</th><th colspan="2" class="ecol" style="border-left:1px solid var(--line)">集成模型</th></tr>
        <tr><th class="num">命中率</th><th class="num">平衡赔率</th><th class="num" style="border-left:1px solid var(--line)">命中率</th><th class="num">平衡赔率</th></tr>
      </thead>
      <tbody>${nbaRows}</tbody>
    </table>
    <div class="small" style="margin-top:8px">NBA 上集成模型命中率显著更高——其更陡的 Elo 映射(d/400)更适配 NBA 悬殊的实力差；加权模型的尺度(2.5)是为足球三路校准的，偏平。</div>
  </div>

  <footer>免责声明：回测基于历史数据，过往不代表未来，不构成投注建议。← <a href="home.html">返回导航</a><br/>
  复跑：node scripts/backtest-multi.mjs &amp;&amp; node scripts/build-validation-page.mjs</footer>
</div></body></html>`;

writeFileSync(join(ROOT, 'output', 'validation.html'), html, 'utf-8');
console.log('✓ 双模型验证页面已生成 → output/validation.html');
