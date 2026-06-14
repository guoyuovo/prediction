#!/usr/bin/env node
// 生成『原文方案』页面 → output/article.html
// 完全隔离：只读 data/article-predictions.json，不依赖 src/model.mjs 等任何本地计算。
// 数据为原文发布的预测快照（逐场录入），保证比分/概率与原文逐字一致。
// 用法：node scripts/build-article-page.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const D = JSON.parse(readFileSync(join(ROOT, 'data', 'article-predictions.json'), 'utf-8'));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function oddsRow(label, o) {
  if (!o) return '';
  return `<tr><td>${label}</td><td class="num">${o[0]}</td><td class="num">${o[1]}</td><td class="num">${o[2]}</td><td class="small">${o[3] || ''}</td></tr>`;
}

function matchCard(m) {
  const [h, d, a] = m.probs;
  const max = Math.max(h, d, a);
  const cls = (v) => (v === max ? ' style="color:var(--gold);font-weight:700"' : '');
  const cmp = m.compare;
  const advTag = (who) => who === '主队' ? '<span class="adv adv-h">主</span>' : who === '客队' ? '<span class="adv adv-a">客</span>' : '<span class="adv">—</span>';
  const conf = { high: '高', medium: '中', low: '低' };
  const risk = { low: '低', medium: '中', high: '高' };

  return `<div class="mcard">
    <div class="mhead">
      <div>
        <span class="grp">${m.group}组</span>
        <b>${esc(m.home)} <span class="vs">vs</span> ${esc(m.away)}</b>
      </div>
      <div class="small">${m.date} ${m.weekday} · 开赛 ${m.kickoff} · ${esc(m.venue)}</div>
      <div class="small">置信度 <b>${conf[m.confidence] || m.confidence}</b> · 冷门风险 <b>${risk[m.upset] || m.upset}</b> · ${esc(m.weather)}</div>
    </div>

    <div class="probs">
      <div class="pcell"><div class="plab">主胜 ${esc(m.home)}</div><div class="pval"${cls(h)}>${h}%</div></div>
      <div class="pcell"><div class="plab">平局</div><div class="pval"${cls(d)}>${d}%</div></div>
      <div class="pcell"><div class="plab">客胜 ${esc(m.away)}</div><div class="pval"${cls(a)}>${a}%</div></div>
      <div class="pcell score"><div class="plab">预测比分</div><div class="pval">${esc(m.score)}</div></div>
    </div>
    <div class="bar3"><i class="h" style="width:${h}%"></i><i class="d" style="width:${d}%"></i><i class="a" style="width:${a}%"></i></div>

    <div class="cols">
      <div>
        <div class="sub">实力对比</div>
        <table class="t">
          <thead><tr><th>指标</th><th>${esc(m.home)}</th><th>${esc(m.away)}</th><th>优势</th></tr></thead>
          <tbody>
            <tr><td>FIFA排名</td><td>${cmp.fifa[0]}</td><td>${cmp.fifa[1]}</td><td>${advTag(cmp.fifa[2])}</td></tr>
            <tr><td>阵容身价</td><td>${cmp.value[0]}</td><td>${cmp.value[1]}</td><td>${advTag(cmp.value[2])}</td></tr>
            <tr><td>阵容评分</td><td>${cmp.squad[0]}</td><td>${cmp.squad[1]}</td><td>${advTag(cmp.squad[2])}</td></tr>
            <tr><td>Elo评分</td><td>${cmp.elo[0]}</td><td>${cmp.elo[1]}</td><td>${advTag(cmp.elo[2])}</td></tr>
            <tr><td>战术风格</td><td class="small">${esc(cmp.style[0])}</td><td class="small">${esc(cmp.style[1])}</td><td>—</td></tr>
          </tbody>
        </table>
        <div class="sub">双源赔率对比</div>
        <table class="t">
          <thead><tr><th>数据源</th><th>主胜</th><th>平局</th><th>客胜</th><th>公司数</th></tr></thead>
          <tbody>
            ${oddsRow('Titan007共识', m.odds.titan007)}
            ${oddsRow('The Odds API', m.odds.oddsapi)}
            <tr><td>模型概率</td><td class="num">${h}%</td><td class="num">${d}%</td><td class="num">${a}%</td><td>—</td></tr>
          </tbody>
        </table>
        ${m.divergence ? `<div class="diverge">⚠ ${esc(m.divergence)}</div>` : ''}
      </div>
      <div>
        <div class="sub">市场情绪</div>
        <div class="kv"><span>亚盘方向</span><b>${esc(m.market.ah)}</b></div>
        <div class="kv"><span>大小球</span><b>${esc(m.market.ou)}</b></div>
        <div class="sub">模型驱动因素</div>
        <ul class="drv">${m.drivers.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${m.tactical && m.tactical.length ? `<div class="sub">战术对位</div><ul class="drv">${m.tactical.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>

    <div class="rec">
      <div class="sub">体彩推荐</div>
      <div class="kv"><span>单场胜平负 SPF</span><b>${esc(m.rec.spf)}</b></div>
      ${m.rec.rqspf ? `<div class="kv"><span>让球胜平负 RQSPF</span><b>${esc(m.rec.rqspf)}</b></div>` : ''}
      <div class="kv"><span>比分推荐</span><b class="gold">${esc(m.rec.score)}</b></div>
      <div class="kv"><span>总进球</span><b>${esc(m.rec.total)}</b></div>
      ${m.rec.ah ? `<div class="kv"><span>亚盘参考</span><b>${esc(m.rec.ah)}</b></div>` : ''}
    </div>
  </div>`;
}

// 按日期分组
const byDate = {};
for (const m of D.matches) (byDate[`${m.date} ${m.weekday}`] ||= []).push(m);

const matchesHtml = Object.entries(byDate).map(([day, ms]) =>
  `<h2 class="dayh">${day}</h2>${ms.map(matchCard).join('')}`
).join('');

const champHtml = D.champions.map((c) =>
  `<tr><td class="rank">${c.rank}</td><td>${esc(c.team)}</td><td class="num"><b>${c.pct}%</b></td></tr>`
).join('');

const top5Html = D.top5.map((t) =>
  `<tr><td class="rank">${t.rank}</td><td>${esc(t.match)}</td><td><span class="dir">${esc(t.dir)}</span></td><td class="num"><b>${t.pct}%</b></td><td class="small">${t.date}</td></tr>`
).join('');

const parlayHtml = D.parlays.map((p) =>
  `<div class="parlay"><div class="sub">${esc(p.name)} <span class="small">（${esc(p.note)}）</span></div>` +
  p.legs.map((l) => `<div class="kv"><span>${esc(l[0])}</span><b>${esc(l[1])} ${l[2]}%</b></div>`).join('') + `</div>`
).join('');

const comboHtml = D.combos.map((c) =>
  `<tr><td>${esc(c.name)}</td><td>${esc(c.combo)}</td><td>${esc(c.dir)}</td><td class="num"><b>${c.joint}%</b></td></tr>`
).join('');

const sourcesHtml = D.sources.map((s) =>
  `<tr><td>${esc(s[0])}</td><td>${esc(s[1])}</td><td class="small">${esc(s[2])}</td></tr>`
).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(D.meta.title)}</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--panel2:#1f232c;--line:#2a2f3a;--txt:#e6e8ec;--muted:#8b93a1;--accent:#4ea1ff;--green:#36c275;--red:#ff5d6c;--amber:#ffc23d;--gold:#ffd24a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",Roboto,sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 18px 70px}
  h1{margin:0 0 4px;font-size:24px}
  .banner{background:linear-gradient(90deg,#23304a,#1a1f2b);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0 22px}
  .banner .small{color:var(--muted)}
  .dayh{font-size:16px;margin:26px 0 12px;padding-left:10px;border-left:3px solid var(--accent)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px}
  .panel h2{margin:0 0 12px;font-size:17px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-size:12px;font-weight:600}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .rank{color:var(--muted);width:34px}
  .small{color:var(--muted);font-size:12px}
  .gold{color:var(--gold)}
  .mcard{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
  .mhead{margin-bottom:12px}
  .mhead b{font-size:16px}
  .vs{color:var(--muted);font-weight:400;font-size:13px;margin:0 4px}
  .grp{background:var(--panel2);color:var(--accent);padding:1px 8px;border-radius:999px;font-size:12px;margin-right:8px}
  .probs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:8px}
  .pcell{background:var(--panel2);border-radius:8px;padding:8px 10px;text-align:center}
  .pcell.score{background:#22282f}
  .plab{color:var(--muted);font-size:12px;margin-bottom:3px}
  .pval{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
  .bar3{display:flex;height:8px;border-radius:4px;overflow:hidden;margin-bottom:14px}
  .bar3 .h{background:var(--green)}.bar3 .d{background:var(--amber)}.bar3 .a{background:var(--red)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:760px){.cols{grid-template-columns:1fr}.probs{grid-template-columns:repeat(2,1fr)}}
  .sub{color:var(--accent);font-size:13px;font-weight:600;margin:12px 0 6px}
  .t th,.t td{padding:5px 7px;font-size:13px}
  .adv{font-size:11px;padding:0 6px;border-radius:999px;background:var(--panel2);color:var(--muted)}
  .adv-h{background:rgba(54,194,117,.18);color:var(--green)}
  .adv-a{background:rgba(255,93,108,.18);color:var(--red)}
  .diverge{margin-top:8px;color:var(--amber);font-size:12px;background:rgba(255,194,61,.08);padding:6px 10px;border-radius:6px}
  .kv{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px dashed var(--line)}
  .kv span{color:var(--muted)}
  .drv{margin:4px 0;padding-left:18px;font-size:13px}
  .drv li{padding:1px 0}
  .rec{margin-top:14px;background:#191e26;border:1px solid var(--line);border-radius:8px;padding:10px 14px}
  .dir{background:var(--panel2);padding:1px 8px;border-radius:999px;font-size:12px}
  .parlay{background:var(--panel2);border-radius:8px;padding:10px 14px;margin-bottom:10px}
  .lockwrap{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:760px){.lockwrap{grid-template-columns:1fr}}
  .pill{display:inline-block;background:var(--panel2);border-radius:999px;padding:3px 10px;margin:3px 4px 0 0;font-size:12px}
  .lock .pill{background:rgba(54,194,117,.15);color:var(--green)}
  .wait .pill{background:rgba(255,194,61,.13);color:var(--amber)}
  footer{color:var(--muted);font-size:12px;margin-top:24px;line-height:1.8}
  .topnote{background:rgba(78,161,255,.08);border:1px solid rgba(78,161,255,.25);border-radius:8px;padding:8px 12px;color:#cfe0ff;font-size:12px;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(D.meta.title)}</h1>
  <div class="banner">
    <div>${esc(D.meta.snapshot)}</div>
    <div class="small">引擎：${esc(D.meta.engine)}</div>
    <div class="topnote">本页为<b>原文发布预测的忠实复刻</b>（逐场录入，比分/概率与原文逐字一致），与本项目本地集成模型完全隔离、互不影响。</div>
  </div>

  <div class="panel">
    <h2>夺冠概率</h2>
    <table><thead><tr><th class="rank">名次</th><th>球队</th><th class="num">夺冠概率</th></tr></thead><tbody>${champHtml}</tbody></table>
    <div class="small" style="margin-top:8px">${esc(D.championsNote)}</div>
  </div>

  ${matchesHtml}

  <div class="panel">
    <h2>可锁定 / 需观望</h2>
    <div class="lockwrap">
      <div class="lock"><div class="sub">✅ 可以锁定的方向</div>${D.summary.lock.map((x) => `<span class="pill">${esc(x)}</span>`).join('')}</div>
      <div class="wait"><div class="sub">⏳ 需要再观望</div>${D.summary.wait.map((x) => `<span class="pill">${esc(x)}</span>`).join('')}</div>
    </div>
  </div>

  <div class="panel">
    <h2>全场最高概率 Top 5（截至 6-14）</h2>
    <table><thead><tr><th class="rank">#</th><th>对阵</th><th>方向</th><th class="num">概率</th><th>日期</th></tr></thead><tbody>${top5Html}</tbody></table>
  </div>

  <div class="panel">
    <h2>过关方案</h2>
    ${parlayHtml}
    <div class="sub">2串1 推荐</div>
    <table><thead><tr><th>方案</th><th>组合</th><th>方向</th><th class="num">联合概率</th></tr></thead><tbody>${comboHtml}</tbody></table>
    <div class="small" style="margin-top:6px">建议容错投注，赔率以 lottery.gov.cn 为准。</div>
  </div>

  <div class="panel">
    <h2>数据来源说明</h2>
    <table><thead><tr><th>数据项</th><th>来源</th><th>说明</th></tr></thead><tbody>${sourcesHtml}</tbody></table>
  </div>

  <footer>免责声明：${esc(D.disclaimer)}</footer>
</div>
</body>
</html>`;

writeFileSync(join(ROOT, 'output', 'article.html'), html, 'utf-8');
console.log('✓ 原文方案页面已生成 → output/article.html');
console.log('  与本地模型完全隔离；比分/概率为原文录入值，逐字一致。');
