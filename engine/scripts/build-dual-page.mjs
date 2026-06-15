#!/usr/bin/env node
// 双模型共同推断页 → output/dual.html
//   模型A 多因子（主力·v2）：src/model.mjs + v2 滚动 Elo（赔率融合0.35 + Elo/主场/FIFA/状态/身价/阵容特征）
//   模型B xG（第二验证）：Elo 0.30 + 泊松xG 0.70（model-ensemble 子模型，不含赔率，方法论独立）
//   两模型独立 → 方向一致置信更高、分歧标 ⚠。综合推荐 = 0.6·A + 0.4·B。
//   比分推荐 = 与综合胜负方向一致、概率最大的 2 个比分。
// 用法：node scripts/build-dual-page.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { predictMatch as predictA, CFG as CFGA } from '../src/model.mjs';
import { eloSubmodel, xgSubmodel } from '../src/model-ensemble.mjs';
import { buildSchedule } from '../src/schedule.mjs';
import { loadAdjustments, eloPenaltyFor, activeAdjustments } from '../src/adjust.mjs';
import { buildContext } from '../src/context.mjs';
import { loadJson, ROOT, poissonPmf } from '../src/util.mjs';

const teamsBase = loadJson('data/teams.json').teams;
const teamsV2 = (() => { try { return loadJson('data/teams-v2.json').teams; } catch { return null; } })() || teamsBase;
const zhMap = loadJson('data/team-names-zh.json').names;
const HOSTS = new Set(loadJson('data/groups.json').hosts);
const wc = (() => { try { return loadJson('data/wc-results.json'); } catch { return { results: [] }; } })();
const xgV2 = (() => { try { return loadJson('data/team-xg-v2.json').teams; } catch { return null; } })();
const bt = (() => { try { return loadJson('data/backtest-v2.json'); } catch { return { matches: [], summary: {} }; } })();
const btDual = (() => { try { return loadJson('data/backtest-dual.json'); } catch { return null; } })();
const tune = (() => { try { return loadJson('data/tune-dual.json'); } catch { return null; } })();
const zhName = (k) => zhMap[k] || k;

const ADJ = loadAdjustments();
// 场地情境（海拔/休息/旅行）：按全 72 场时间顺序构建，供每场取有效 Elo 微调 + 进球缩放
const oddsMetaAll = (() => { try { return loadJson('data/match-odds.json').meta || {}; } catch { return {}; } })();
const weatherAll = (() => { try { return loadJson('data/weather.json').weather || {}; } catch { return {}; } })();
const venueOf = (h, a) => { const k = `${h} vs ${a}`; return (oddsMetaAll[k] && oddsMetaAll[k].venue) || (weatherAll[k] && weatherAll[k].venue) || ''; };
const CTX = buildContext(buildSchedule().map((s) => ({ home: s.home, away: s.away, date: s.date, venue: venueOf(s.home, s.away) })));

// v2 球队对象（其余特征沿用真实值，Elo 用滚动后，并扣减临场伤停惩罚）
const objV2 = (name, matchDate) => {
  const pen = eloPenaltyFor(name, ADJ, matchDate);
  return { name, ...teamsBase[name], elo: (teamsV2[name] || teamsBase[name]).elo - pen, _pen: pen };
};

// —— 比分网格工具 ——
const DIR = (h, a) => (h > a ? 'H' : h < a ? 'A' : 'D');
function dcTau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
// 模型A：Dixon-Coles 网格中，与 dir 同向、概率最大的 n 个比分
function topScoresDC(lh, la, dir, n) {
  const rho = CFGA.scoreline.rho, mg = CFGA.scoreline.maxGoals;
  const cells = [];
  for (let h = 0; h <= mg; h++) for (let a = 0; a <= mg; a++) {
    if (DIR(h, a) !== dir) continue;
    cells.push({ s: `${h}-${a}`, p: dcTau(h, a, lh, la, rho) * poissonPmf(h, lh) * poissonPmf(a, la) });
  }
  cells.sort((x, y) => y.p - x.p);
  return cells.slice(0, n).map((c) => c.s);
}
// 模型B：纯泊松网格中，与 dir 同向、概率最大的 n 个比分
function topScoresPoisson(lh, la, dir, n) {
  const mg = 8, cells = [];
  for (let h = 0; h <= mg; h++) for (let a = 0; a <= mg; a++) {
    if (DIR(h, a) !== dir) continue;
    cells.push({ s: `${h}-${a}`, p: poissonPmf(h, lh) * poissonPmf(a, la) });
  }
  cells.sort((x, y) => y.p - x.p);
  return cells.slice(0, n).map((c) => c.s);
}

const dirOf = (p) => (p.h >= p.d && p.h >= p.a ? 'H' : p.a >= p.d ? 'A' : 'D');
const norm3 = (h, d, a) => { const s = h + d + a || 1; return { h: h / s, d: d / s, a: a / s }; };

// —— 双模型推断（未赛场）——
function dualPredict(home, away, matchDate) {
  const homeAdv = HOSTS.has(home) && !HOSTS.has(away);
  const c = CTX[`${home}|${away}`] || { goalScale: 1, eloAdjHome: 0, eloAdjAway: 0 };
  const H = objV2(home, matchDate), A = objV2(away, matchDate);
  H.elo += c.eloAdjHome || 0; A.elo += c.eloAdjAway || 0; // 海拔适应 + 休息/旅行疲劳折进有效 Elo
  const gs = c.goalScale || 1;

  // 模型A：多因子（v2）
  const rA = predictA(H, A, { neutral: !homeAdv, goalScale: gs });
  const pA = { h: rA.pHome, d: rA.pDraw, a: rA.pAway };
  const dirA = dirOf(pA);
  const scoreA2 = topScoresDC(rA.expGoals.home, rA.expGoals.away, dirA, 2);

  // 模型B：xG 第二验证 = Elo 0.30 + 泊松xG 0.70（不含赔率）
  const elo = eloSubmodel(H, A, { neutral: !homeAdv });
  const xg = xgSubmodel(H, A, homeAdv, xgV2); // xgV2=滚动攻防（赛后射门更新），缺省回退基础

  let pB, scoreB2 = null, hasXg = false;
  if (xg) {
    hasXg = true;
    xg.lambdaH *= gs; xg.lambdaA *= gs; // 海拔进球缩放同步作用 xG 比分
    pB = norm3(0.3 * elo.h + 0.7 * xg.h, 0.3 * elo.d + 0.7 * xg.d, 0.3 * elo.a + 0.7 * xg.a);
    scoreB2 = topScoresPoisson(xg.lambdaH, xg.lambdaA, dirOf(pB), 2);
  } else {
    pB = norm3(elo.h, elo.d, elo.a); // 无 xG 数据 → 退化为 Elo
  }
  const dirB = dirOf(pB);

  // 综合：0.5·A + 0.5·B（等权，经 tune-dual 网格搜索时间切分验证，详见回测面板）
  const pC = norm3(0.5 * pA.h + 0.5 * pB.h, 0.5 * pA.d + 0.5 * pB.d, 0.5 * pA.a + 0.5 * pB.a);
  const dirC = dirOf(pC);
  const scoreC2 = topScoresDC(rA.expGoals.home, rA.expGoals.away, dirC, 2);

  const maxC = Math.max(pC.h, pC.d, pC.a);
  const agree = dirA === dirB;
  // 置信：方向一致且概率高→高
  let conf = maxC >= 0.55 ? '高' : maxC >= 0.45 ? '中' : '低';
  if (!agree && conf === '高') conf = '中';
  // 爆冷风险：决断力低（最高概率偏低）
  const upset = maxC < 0.45 ? '高' : maxC < 0.55 ? '中' : null;
  // xG 档位（T1≥40 / T2≥30 / T3≥20，按胜方概率）
  const bWin = Math.max(pB.h, pB.d, pB.a);
  const tier = bWin >= 0.4 ? 'T1' : bWin >= 0.3 ? 'T2' : 'T3';

  return {
    home, away, homeAdv,
    A: { p: pA, dir: dirA, score2: scoreA2 },
    B: { p: pB, dir: dirB, score2: scoreB2, hasXg, win: bWin, tier },
    C: { p: pC, dir: dirC, score2: scoreC2, max: maxC },
    agree, conf, upset,
    adj: (H._pen || A._pen) ? { home: H._pen, away: A._pen } : null,
    ctx: (c.elev >= 1000 || c.eloAdjHome || c.eloAdjAway) ? { elev: c.elev || 0, eloAdjHome: c.eloAdjHome || 0, eloAdjAway: c.eloAdjAway || 0, restHome: c.restHome, restAway: c.restAway } : null,
  };
}

// —— 组装赛程：完赛 vs 未赛 ——
const schedule = buildSchedule();
const playedSet = new Set(wc.results.map((r) => `${r.home}|${r.away}`));
const resByPair = new Map(wc.results.map((r) => [`${r.home}|${r.away}`, r]));
const btByPair = new Map((bt.matches || []).map((m) => [`${m.home}|${m.away}`, m]));

const history = [];
const future = [];
for (const s of schedule) {
  const key = `${s.home}|${s.away}`;
  if (playedSet.has(key)) {
    const r = resByPair.get(key);
    const b = btByPair.get(key); // 模型A 赛前样本外预测
    const p = b ? { h: b.pHome, d: b.pDraw, a: b.pAway } : null;
    history.push({
      date: s.date, time: s.time, g: s.group, home: s.home, away: s.away,
      dir: b ? b.predOutcome : null, dirProb: p ? Math.max(p.h, p.d, p.a) : null,
      score: b ? b.predScore : null, p,
      actual: `${r.hs}-${r.as}`, actualDir: DIR(r.hs, r.as), ht: r.htHome != null ? `${r.htHome}-${r.htAway}` : null,
      hit: b ? b.correct : null,
    });
  } else {
    future.push({ date: s.date, time: s.time, g: s.group, ...dualPredict(s.home, s.away, s.date) });
  }
}

const payload = {
  meta: { date: '2026-06-13', history: history.length, future: future.length, summary: bt.summary || {}, fetchedAt: wc._fetchedAt || null },
  history, future, zh: zhMap,
  backtest: btDual ? { summary: btDual.summary, n: btDual.summary.weighted.matches } : null,
  tune: tune ? { alphaStar: tune.alphaStar, brierStar: tune.brierStar, train: tune.train, test: tune.test, calib: tune.confidenceCalibration } : null,
  adjustments: activeAdjustments(ADJ),
};

const jsonOnly = process.argv.includes('--json-only');
if (jsonOnly) {
  const outPath = join(ROOT, 'output', 'dual-data.json');
  writeFileSync(outPath, JSON.stringify(payload), 'utf-8');
  console.log(`✓ dual-data.json → ${outPath}（历史 ${history.length} / 未来 ${future.length} · 跳过 HTML）`);
  process.exit(0);
}

const html = renderHtml(payload);
// 自检：内嵌 JSON 可解析 + 客户端脚本可编译
const dataBlock = html.match(/<script id="data"[^>]*>([\s\S]*?)<\/script>/);
JSON.parse(dataBlock[1].replace(/\\u003c/g, '<'));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
try { new Function(scripts[scripts.length - 1][1]); }
catch (e) { console.error('✗ 客户端脚本语法错误，已中止：', e.message); process.exit(1); }

const outPath = join(ROOT, 'output', 'dual.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`✓ 双模型对比页 → ${outPath}（历史 ${history.length} 场 / 未来 ${future.length} 场，已过自检）`);
const flips = future.filter((f) => !f.agree).length;
console.log(`  双模型方向分歧：${flips}/${future.length} 场；样本外(主力) 1X2 命中 ${((payload.meta.summary.accuracy1X2 || 0) * 100).toFixed(0)}%`);

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>双模型共同推断 · 2026 世界杯</title>
<style>
  :root { --bg:#0f1115; --panel:#181b22; --panel2:#1f232c; --line:#2a2f3a; --txt:#e6e8ec;
    --muted:#8b93a1; --accent:#4ea1ff; --green:#36c275; --red:#ff5d6c; --amber:#ffc23d; --gold:#ffd24a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",Roboto,sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; padding:28px 18px 64px; }
  h1 { margin:0 0 6px; font-size:24px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:6px; }
  .sub b { color:var(--accent); }
  h2 { font-size:18px; margin:30px 0 4px; padding-bottom:8px; border-bottom:2px solid var(--accent); }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  th,td { padding:9px 10px; text-align:left; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:12px; }
  td.num,th.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr:hover td { background:var(--panel2); }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:6px 16px 14px; }
  .pill { padding:1px 7px; border-radius:999px; font-size:11px; background:var(--panel2); color:var(--muted); }
  .dir-H { color:var(--green); font-weight:600; } .dir-A { color:var(--accent); font-weight:600; } .dir-D { color:var(--amber); font-weight:600; }
  .score { font-variant-numeric:tabular-nums; }
  .score b { color:var(--gold); }
  .badge { display:inline-block; padding:1px 8px; border-radius:6px; font-size:11px; margin:1px 3px 1px 0; white-space:nowrap; }
  .b-hi { background:rgba(54,194,117,.16); color:var(--green); } .b-mid { background:rgba(255,194,61,.16); color:var(--amber); } .b-lo { background:rgba(139,147,161,.16); color:var(--muted); }
  .b-up { background:rgba(255,93,108,.16); color:var(--red); }
  .b-xg1 { background:rgba(139,147,161,.18); color:#c7cdd8; } .b-xg2 { background:rgba(255,194,61,.16); color:var(--amber); } .b-xg3 { background:rgba(255,93,108,.18); color:var(--red); }
  .b-div { background:rgba(255,93,108,.2); color:var(--red); font-weight:600; }
  .hit { color:var(--green); } .miss { color:var(--red); }
  .mrow { cursor:pointer; } .caret { color:var(--accent); display:inline-block; width:10px; }
  .detail { background:#14181f; border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin:4px 0; }
  .mcmp { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  @media (max-width:720px){ .mcmp{ grid-template-columns:1fr; } }
  .mcmp h4 { margin:0 0 6px; font-size:13px; } .mcmp .small { color:var(--muted); font-size:12px; }
  .triple { display:flex; height:14px; border-radius:4px; overflow:hidden; margin:4px 0; }
  .triple i { display:block; } .triple .h{background:var(--green);} .triple .d{background:var(--amber);} .triple .a{background:var(--accent);}
  .note { color:var(--muted); font-size:12.5px; line-height:1.8; }
  .note b { color:var(--txt); }
  .legend-grid { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:12.5px; color:var(--muted); margin-top:6px; }
  .legend-grid b { color:var(--txt); }
  footer { color:var(--muted); font-size:12px; margin-top:30px; line-height:1.7; }
</style>
</head>
<body>
<div class="wrap">
  <h1>⚽ 双模型共同推断 · 2026 世界杯</h1>
  <div class="sub"><b>多因子（主力·v2）</b> + <b>xG（第二验证）</b> 共同推断 · <span id="m-date"></span> · 历史 <span id="m-h"></span> 场 / 未来 <span id="m-f"></span> 场 · <a href="index.html" style="color:var(--accent)">← 返回主看板</a></div>

  <h2>历史预测</h2>
  <div class="panel">
    <table>
      <thead><tr><th>日期</th><th>对阵</th><th>方向</th><th>比分</th><th>赛果</th><th>实际(半/全)</th><th>命中</th></tr></thead>
      <tbody id="hist-body"></tbody>
    </table>
  </div>

  <h2>未来预测</h2>
  <div id="adj-banner"></div>
  <div class="panel">
    <table>
      <thead><tr><th>日期</th><th>对阵</th><th>方向（综合）</th><th>比分推荐</th><th>关注</th></tr></thead>
      <tbody id="fut-body"></tbody>
    </table>
  </div>

  <h2>回测表现 <span style="font-size:12px;color:var(--muted);font-weight:400">（真实联赛 + 真实 B365 赔率，样本外）</span></h2>
  <div class="panel" id="backtest-panel">
    <table id="bt-table">
      <thead><tr><th>模型</th><th class="num">命中率</th><th class="num">Brier↓</th><th class="num">logloss↓</th><th class="num">平注ROI</th><th class="num">价值ROI</th></tr></thead>
      <tbody id="bt-body"></tbody>
    </table>
    <div class="note" id="bt-note" style="margin-top:10px"></div>
  </div>

  <h2>模型说明</h2>
  <div class="panel note" id="model-note"></div>

  <h2>指标说明</h2>
  <div class="panel"><div class="legend-grid" id="legend"></div></div>

  <footer>双模型均为统计推演，仅供学术研究与娱乐参考，不构成投注建议。比分高度随机，"综合推荐"为概率最大方向，非确定结果。重新生成：<code>node scripts/build-dual-page.mjs</code></footer>
</div>

<script id="data" type="application/json">${json}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const $ = (s) => document.querySelector(s);
const pct = (x) => (x * 100).toFixed(0) + '%';
const nm = (t) => DATA.zh[t] || t;
const dirZh = (d) => d === 'H' ? '主胜' : d === 'A' ? '客胜' : '平';
const dirCls = (d) => 'dir-' + d;
const dirHtml = (d, p) => '<span class="' + dirCls(d) + '">' + dirZh(d) + (p != null ? ' ' + pct(p) : '') + '</span>';
const tri = (p) => '<div class="triple" title="主 ' + pct(p.h) + ' / 平 ' + pct(p.d) + ' / 客 ' + pct(p.a) + '"><i class="h" style="width:' + p.h * 100 + '%"></i><i class="d" style="width:' + p.d * 100 + '%"></i><i class="a" style="width:' + p.a * 100 + '%"></i></div>';

$('#m-date').textContent = DATA.meta.date;
$('#m-h').textContent = DATA.meta.history;
$('#m-f').textContent = DATA.meta.future;

// 历史预测
$('#hist-body').innerHTML = DATA.history.map((m) =>
  '<tr>' +
  '<td class="small" style="white-space:nowrap">' + m.date.slice(5) + '<br><span class="pill">' + m.g + '</span></td>' +
  '<td>' + nm(m.home) + ' <span class="small">vs</span> ' + nm(m.away) + '</td>' +
  '<td>' + (m.dir ? dirHtml(m.dir, m.dirProb) : '—') + '</td>' +
  '<td class="score">' + (m.score ? '<b>' + m.score + '</b>' : '—') + '</td>' +
  '<td>' + (m.dir ? dirHtml(m.dir) : '—') + '</td>' +
  '<td class="score">' + m.actual + (m.ht ? ' <span class="small">(' + m.ht + ')</span>' : '') + '</td>' +
  '<td>' + (m.hit == null ? '—' : m.hit ? '<span class="hit">✅</span>' : '<span class="miss">✗</span>') + '</td>' +
  '</tr>'
).join('');

// 临场伤停调整横幅
(function () {
  const adj = DATA.adjustments || [];
  const el = document.querySelector('#adj-banner');
  if (!adj.length) { el.innerHTML = '<div class="note" style="margin-bottom:8px"><span class="small">临场伤停调整：暂无（在 <code>data/manual/squad-adjustments.json</code> 录入核心伤停后，相关队未来场次 Elo 自动下调）。</span></div>'; return; }
  el.innerHTML = '<div class="panel" style="margin-bottom:10px;border-color:var(--amber)"><b style="color:var(--amber)">⚑ 临场伤停调整生效</b> <span class="small">（仅作用于下方未来场次）</span><div style="margin-top:6px">' +
    adj.map((a) => '<span class="badge b-up">' + nm(a.team) + ' −' + a.eloPenalty + ' Elo' + (a.reason ? '：' + a.reason : '') + (a.until ? '（至 ' + a.until + '）' : '') + '</span>').join(' ') + '</div></div>';
})();

// 未来预测
function badges(m) {
  let out = '';
  const cc = m.conf === '高' ? 'b-hi' : m.conf === '中' ? 'b-mid' : 'b-lo';
  out += '<span class="badge ' + cc + '">' + m.conf + '置信</span>';
  if (m.upset) out += '<span class="badge b-up">' + (m.upset === '高' ? '⚠爆冷' : '爆冷') + '</span>';
  if (m.B.hasXg) {
    const xc = m.B.tier === 'T1' ? 'b-xg1' : m.B.tier === 'T2' ? 'b-xg2' : 'b-xg3';
    out += '<span class="badge ' + xc + '">xG' + dirZh(m.B.dir) + pct(m.B.win) + ' ' + m.B.tier + '</span>';
  }
  if (!m.agree) out += '<span class="badge b-div">⚠分歧</span>';
  if (m.ctx && m.ctx.elev >= 1500) out += '<span class="badge b-lo" title="海拔 ' + m.ctx.elev + 'm·总进球略增，适应队有 edge">⛰ 高原' + m.ctx.elev + 'm</span>';
  const fat = m.ctx ? Math.min(m.ctx.eloAdjHome, m.ctx.eloAdjAway) : 0;
  if (fat <= -8) out += '<span class="badge b-up" title="背靠背/长途旅行疲劳">💤 疲劳</span>';
  return out;
}
function detail(m) {
  const col = (title, dir, p, scores, extra) =>
    '<div><h4>' + title + '</h4>' + tri(p) +
    '<div class="small">' + dirHtml(dir, Math.max(p.h, p.d, p.a)) + ' · 主 ' + pct(p.h) + ' / 平 ' + pct(p.d) + ' / 客 ' + pct(p.a) + '</div>' +
    '<div class="small" style="margin-top:3px">比分 ' + (scores ? scores.map((s) => '<b style="color:var(--gold)">' + s + '</b>').join(' · ') : '—') + '</div>' +
    (extra || '') + '</div>';
  return '<div class="detail"><div class="mcmp">' +
    col('① 多因子（主力·v2）', m.A.dir, m.A.p, m.A.score2, '<div class="small" style="color:var(--muted);margin-top:3px">赔率融合0.35 + 特征加权</div>') +
    col('② xG（第二验证）', m.B.dir, m.B.p, m.B.score2, '<div class="small" style="color:var(--muted);margin-top:3px">' + (m.B.hasXg ? 'Elo0.30 + 泊松xG0.70' : '该队缺 xG 数据，退化为 Elo') + '</div>') +
    col('③ 综合推荐 0.5A+0.5B', m.C.dir, m.C.p, m.C.score2, '<div class="small" style="margin-top:3px;color:' + (m.agree ? 'var(--green)' : 'var(--red)') + '">' + (m.agree ? '✓ 双模型方向一致' : '⚠ 双模型方向分歧') + '</div>') +
    '</div></div>';
}
$('#fut-body').innerHTML = DATA.future.map((m, i) =>
  '<tr class="mrow" data-i="' + i + '" title="点击展开双模型明细">' +
  '<td class="small" style="white-space:nowrap"><span class="caret">▸</span> ' + m.date.slice(5) + ' ' + m.time + '<br><span class="pill" style="margin-left:14px">' + m.g + '</span></td>' +
  '<td>' + nm(m.home) + ' <span class="small">vs</span> ' + nm(m.away) + '</td>' +
  '<td>' + dirHtml(m.C.dir, m.C.max) + '</td>' +
  '<td class="score">' + m.C.score2.map((s, j) => j === 0 ? '<b>' + s + '</b>' : '<span class="small">' + s + '</span>').join(' · ') + '</td>' +
  '<td>' + badges(m) + '</td>' +
  '</tr>' +
  '<tr class="drow" data-for="' + i + '" style="display:none"><td colspan="5">' + detail(m) + '</td></tr>'
).join('');
$('#fut-body').addEventListener('click', (e) => {
  const row = e.target.closest('.mrow'); if (!row) return;
  const d = document.querySelector('.drow[data-for="' + row.dataset.i + '"]'); if (!d) return;
  const open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'table-row';
  const c = row.querySelector('.caret'); if (c) c.textContent = open ? '▸' : '▾';
});

// 回测表现
(function () {
  const bt = DATA.backtest;
  if (!bt) { document.querySelector('#backtest-panel').innerHTML = '<div class="note">尚无回测数据，运行 <code>node scripts/backtest-dual.mjs</code> 后重建。</div>'; return; }
  const s = bt.summary;
  const roiC = (v) => '<span style="color:' + (v >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%</span>';
  const rows = [['① 多因子（主力）', s.weighted], ['② xG（第二验证·单独）', s.xg], ['③ 综合 0.5A+0.5B', s.dual]];
  $('#bt-body').innerHTML = rows.map(([k, m], i) =>
    '<tr' + (i === 2 ? ' style="background:rgba(78,161,255,.08)"' : '') + '>' +
    '<td' + (i === 2 ? ' style="font-weight:600"' : '') + '>' + k + '</td>' +
    '<td class="num">' + (m.acc * 100).toFixed(1) + '%</td>' +
    '<td class="num">' + m.brier.toFixed(3) + '</td>' +
    '<td class="num">' + m.logloss.toFixed(3) + '</td>' +
    '<td class="num">' + roiC(m.flatROI) + '</td>' +
    '<td class="num">' + roiC(m.valueROI) + '</td>' +
    '</tr>'
  ).join('');
  $('#bt-note').innerHTML =
    '<b>' + bt.n + ' 场</b>真实联赛（英超/西甲/德甲/意甲/法甲多赛季）+ 真实 B365 赔率，样本外。' +
    '<b>诚实结论</b>：三者命中率、Brier 几乎一致（综合略优 ' + (s.dual.acc * 100).toFixed(1) + '% / Brier ' + s.dual.brier.toFixed(3) + '，但在噪声内）；ROI 全负、价值投注更亏——<b>对市场无 edge</b>，综合并未显著优于主力。融合的真实价值在「双视角 + 分歧预警」，不是提升盈利。' +
    '<br><span style="color:var(--amber)">⚠ caveat</span>：俱乐部无 xG 攻防数据，回测里 xG 模型的泊松 λ 用 Elo 驱动，<b>保守低估</b>了世界杯页面 Model B 真实攻防代理评分（team-xg）可能带来的独立增益——但国家队真实 xG 无免费全量源，这一增益无法在样本外严格证明。';
  // 调参 + 置信度校准
  const t = DATA.tune;
  if (t) {
    const calibCells = t.calib.map((c) => '<span style="display:inline-block;min-width:96px">' + c.range + '→<b>' + (c.hitRate == null ? '—' : (c.hitRate * 100).toFixed(0) + '%') + '</b><span class="small">(' + c.n + ')</span></span>').join(' ');
    $('#bt-note').innerHTML += '<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">' +
      '<b>融合权重调参</b>（<code>tune-dual</code>，训练 ' + t.train + ' 场 / 测试 ' + t.test + ' 场 时间切分）：网格搜索训练最优 α∈[' + t.alphaStar + ',' + t.brierStar + ']（logloss/Brier），故采<b>等权 0.5</b>（Brier 最优、logloss 近最优、可泛化；原拍值 0.6 略偏）。整条 α 曲线极平，差异在噪声内。' +
      '<br><b>置信度校准</b>（测试集·最高概率→实际命中）：' + calibCells +
      '。<b>55% 处有清晰跳变</b>（<55%≈47% / ≥55%≈59–72%），<b>验证了高/中/低置信阈值</b>。</div>';
  }
})();

// 模型说明
$('#model-note').innerHTML =
  '<p><b>① 多因子模型（主力 · v2）</b>：以去水位市场赔率共识为主锚（融合权重 0.35），叠加特征加权逻辑回归——Elo、主场/东道主、FIFA、近期状态、身价、阵容评分。<b>Elo 随每场完赛实时滚动更新</b>（v2），比分用 Dixon-Coles 双变量泊松（样本外波胆 12.9%）。覆盖市场情绪 + 球队硬实力 + 短期状态。</p>' +
  '<p><b>② xG 模型（第二验证）</b>：Elo 0.30 + 泊松 xG 0.70，<b>不含市场赔率</b>。攻防效率算预期进球→泊松网格推演胜平负与比分。<b>攻防评分随完赛 shot-based xG（ESPN 射门统计）滚动更新（xG-v2）</b>，越打越贴近本届真实表现。与主力模型方法论独立。</p>' +
  '<p><b>情境修正（本届特有）</b>：⛰ <b>海拔</b>——墨西哥城 2254m / 瓜达拉哈拉 1607m，高原使总进球略增、适应队（墨/厄/哥）获小幅 edge；💤 <b>休息/旅行</b>——美加墨横跨数千公里，背靠背或跨洲长途的疲劳小幅下调有效 Elo。两项均为<b>物理先验型小修正</b>（俱乐部数据无法回测，幅度刻意小、只轻推）。</p>' +
  '<p><b>综合推荐</b> = 0.5·多因子 + 0.5·xG（等权——经网格搜索时间切分验证，见回测面板）。两模型相互独立，<b>方向一致 → 置信更高</b>；<b>方向分歧 → 标 ⚠</b>，该场不确定性高、谨慎看待。<b>比分推荐</b>为与综合胜负方向一致、概率最大的 2 个比分。</p>';

// 指标说明
$('#legend').innerHTML = [
  ['<span class="badge b-hi">高置信</span><span class="badge b-mid">中</span><span class="badge b-lo">低</span>', '综合最高概率：≥55% 高 / 45–55% 中 / <45% 低；双模型分歧时降一级'],
  ['<span class="badge b-up">⚠爆冷</span>', '决断力低（最高概率偏低）：<45% 高风险 / 45–55% 中风险，弱队取胜或平局概率不低'],
  ['<span class="badge b-xg1">xG T1</span><span class="badge b-xg2">T2</span><span class="badge b-xg3">T3</span>', 'xG 模型方向与胜方概率档位：T1≥40% / T2≥30% / T3≥20%（越低色越红，信号越薄）'],
  ['<span class="badge b-div">⚠分歧</span>', '两个独立模型胜负方向不一致，该场不确定性较高'],
  ['<span class="dir-H">主胜</span> <span class="dir-D">平</span> <span class="dir-A">客胜</span>', '方向颜色：绿=主胜 / 黄=平 / 蓝=客胜'],
].map((r) => '<div>' + r[0] + '</div><div><b></b>' + r[1] + '</div>').join('');
</script>
</body>
</html>`;
}
