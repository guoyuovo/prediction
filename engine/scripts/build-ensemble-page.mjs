#!/usr/bin/env node
// 第二篇方法论（Elo+xG+赔率+蒙特卡洛 集成模型）独立页面 → output/ensemble.html
//   与主页面(加权模型)隔离：使用 src/model-ensemble.mjs。
// 用法：node scripts/build-ensemble-page.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ensemble from '../src/model-ensemble.mjs';
import { runMonteCarlo, setEngine } from '../src/tournament.mjs';
import { buildSchedule } from '../src/schedule.mjs';
import { loadJson, ROOT, pct } from '../src/util.mjs';

setEngine(ensemble); // 蒙特卡洛改用集成引擎
const zh = loadJson('data/team-names-zh.json').names;
const nm = (k) => zh[k] || k;
const cfg = loadJson('config/model-ensemble.json');

console.log('生成第二篇方法论(集成模型)页面...');
const sim = runMonteCarlo(10000);
const champs = sim.results.slice(0, 12);

const schedule = buildSchedule();
const matches = schedule.map((s) => {
  const p = ensemble.predictMatch(s.home, s.away, { neutral: true });
  return {
    g: s.group, home: s.home, away: s.away, kickoff: s.kickoff,
    h: p.pHome, d: p.pDraw, a: p.pAway, score: p.score,
    elo: p.sub.elo ? [p.sub.elo.h, p.sub.elo.d, p.sub.elo.a] : null,
    xg: p.sub.xg ? [p.sub.xg.h, p.sub.xg.d, p.sub.xg.a] : null,
    mkt: p.sub.market ? [p.sub.market.h, p.sub.market.d, p.sub.market.a] : null,
  };
});

const f3 = (v) => v ? v.map((x) => pct(x)).join('/') : '—';
const champRows = champs.map((r, i) => `<tr><td class="rank">${i + 1}</td><td>${nm(r.team)}</td><td class="num">${pct(r.r32)}</td><td class="num">${pct(r.qf)}</td><td class="num"><b>${pct(r.champion)}</b></td></tr>`).join('');
const matchRows = matches.map((m) => `<tr>
  <td class="small">${m.kickoff.slice(5)}</td><td><span class="pill">${m.g}</span></td>
  <td class="teamcell">${nm(m.home)} <span class="small">vs</span> ${nm(m.away)}</td>
  <td class="num">${pct(m.h)}</td><td class="num">${pct(m.d)}</td><td class="num">${pct(m.a)}</td><td>${m.score}</td>
  <td class="small">${f3(m.elo)}</td><td class="small">${f3(m.xg)}</td><td class="small">${f3(m.mkt)}</td>
</tr>`).join('');

const html = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>第二篇方法论 · 集成模型</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--panel2:#1f232c;--line:#2a2f3a;--txt:#e6e8ec;--muted:#8b93a1;--accent:#a78bfa;--green:#36c275;--red:#ff5d6c;--amber:#ffc23d;--gold:#ffd24a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",Roboto,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:28px 18px 70px}h1{margin:0 0 4px;font-size:24px}
  .banner{background:linear-gradient(90deg,#2a2350,#1a1f2b);border:1px solid var(--line);border-radius:12px;padding:14px 18px;margin:14px 0 20px}
  .small{color:var(--muted);font-size:12px}.banner .small{color:#c9bfff}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:18px}
  .panel h2{margin:0 0 12px;font-size:17px}
  table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-size:12px;font-weight:600}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .rank{color:var(--muted);width:30px}.teamcell{font-weight:600}
  .pill{padding:1px 7px;border-radius:999px;font-size:11px;background:var(--panel2);color:var(--muted)}
  .scroll{max-height:600px;overflow:auto}
  .topnote{background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.3);border-radius:8px;padding:8px 12px;color:#d8ccff;font-size:12px;margin-top:10px}
  footer{color:var(--muted);font-size:12px;margin-top:24px;line-height:1.8}
</style></head><body><div class="wrap">
  <h1>🧪 第二篇方法论 · 多因子集成模型</h1>
  <div class="banner">
    <div>Elo 35% + xG 25% + 市场赔率 20% + 蒙特卡洛 20%（《2026 世界杯预测体系方法论》）</div>
    <div class="small">模型版本 ${cfg.version} · 与主页面（第一篇加权模型）完全隔离，互不影响</div>
    <div class="topnote">本页是<b>第二篇方法论</b>的集成模型实现。主页面 index.html 用的是第一篇文章的加权逻辑回归模型。两套模型/数据隔离，可对照差异。</div>
  </div>

  <div class="panel">
    <h2>夺冠概率 TOP 12（10,000 次蒙特卡洛 + Elo 扰动）</h2>
    <table><thead><tr><th class="rank">#</th><th>球队</th><th class="num">进32强</th><th class="num">进8强</th><th class="num">夺冠</th></tr></thead><tbody>${champRows}</tbody></table>
  </div>

  <div class="panel">
    <h2>72 场预测 · 三子模型明细</h2>
    <div class="scroll"><table><thead><tr><th>时间</th><th>组</th><th>对阵</th><th class="num">主</th><th class="num">平</th><th class="num">客</th><th>比分</th><th>Elo(35%)</th><th>xG(25%)</th><th>市场(20%)</th></tr></thead>
    <tbody>${matchRows}</tbody></table></div>
    <div class="small" style="margin-top:8px">后三列为各子模型独立给出的胜/平/负，集成按 Elo:xG:市场 = 0.30:0.20:0.50 加权（校准后）。</div>
  </div>

  <footer>免责声明：统计模型推演，仅供娱乐参考。本页与主页面、原文页、回测页均隔离。<br/>
  复跑：node scripts/build-ensemble-page.mjs</footer>
</div></body></html>`;

writeFileSync(join(ROOT, 'output', 'ensemble.html'), html, 'utf-8');
console.log('✓ 集成模型页面已生成 → output/ensemble.html');
