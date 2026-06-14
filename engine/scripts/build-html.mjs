#!/usr/bin/env node
// 生成自包含的 HTML 预测看板 → output/index.html
// 把蒙特卡洛模拟 + 72 场预测的数据嵌入页面，浏览器离线打开即可查看。
// 用法: node scripts/build-html.mjs [--iterations 20000]

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { predictMatch, getTeam } from '../src/model.mjs';
import { runMonteCarlo, setEngine } from '../src/tournament.mjs';
import { buildSchedule } from '../src/schedule.mjs';
import { loadAdjustments, eloPenaltyFor } from '../src/adjust.mjs';
import { buildContext } from '../src/context.mjs';
import { loadJson, ROOT } from '../src/util.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const groups = loadJson('data/groups.json').groups;
const cfg = loadJson('config/model.json');
const iterations = parseInt(arg('iterations', String(cfg.mc.iterations)), 10);

console.log(`生成 HTML 看板（含 ${iterations.toLocaleString()} 次模拟）...`);
const sim = runMonteCarlo(iterations);

// 队名中文映射 + 球队档案 + 实力数据 + 赔率
const zhMap = loadJson('data/team-names-zh.json').names;
const profiles = loadJson('data/team-profiles.json').profiles;
const teamsData = loadJson('data/teams.json').teams;
const oddsFile = loadJson('data/match-odds.json');
const matchOdds = oddsFile.odds;
const oddsMeta = oddsFile.meta || {};
let weatherData = {};
try { weatherData = loadJson('data/weather.json').weather || {}; } catch { /* 可选 */ }
const zhName = (k) => zhMap[k] || k;
const HOSTS = new Set(loadJson('data/groups.json').hosts);

// ── v2：滚动 Elo + 完赛验证（可选，缺失则页面降级提示）──
const teamsV2 = (() => { try { return loadJson('data/teams-v2.json'); } catch { return null; } })();
const v2Backtest = (() => { try { return loadJson('data/backtest-v2.json'); } catch { return null; } })();
const wcResults = (() => { try { return loadJson('data/wc-results.json'); } catch { return null; } })();
// 已完赛队对（朝向与赛程一致）→ 用于在「全部对阵」标记真实结果、在 v2 区分剩余场
const playedMap = new Map();
for (const r of (wcResults?.results || [])) playedMap.set(`${r.home} vs ${r.away}`, r);
const ADJ = loadAdjustments();
// 用 v2 滚动后 Elo 预测某场（其余特征沿用基础真实值；东道主主场逻辑同基础模型；扣减临场伤停惩罚）
function predictV2(home, away, matchDate) {
  if (!teamsV2) return null;
  const homeAdv = HOSTS.has(home) && !HOSTS.has(away);
  const c = ctxOf(home, away);
  const Hobj = { name: home, ...teamsData[home], elo: teamsV2.teams[home].elo - eloPenaltyFor(home, ADJ, matchDate) + (c.eloAdjHome || 0) };
  const Aobj = { name: away, ...teamsData[away], elo: teamsV2.teams[away].elo - eloPenaltyFor(away, ADJ, matchDate) + (c.eloAdjAway || 0) };
  return predictMatch(Hobj, Aobj, { neutral: !homeAdv, goalScale: c.goalScale || 1 });
}
const eloMoved = new Set((v2Backtest?.eloChanges || []).map((c) => c.team));

// FIFA 积分 → 在 48 强中的排名
const fifaRankMap = {};
Object.entries(teamsData).sort((a, b) => b[1].fifa - a[1].fifa).forEach(([k], i) => { fifaRankMap[k] = i + 1; });

// 从我们自己的模型数据生成「模型驱动因素」
function buildDrivers(H, A, p, homeAdv, hasOdds) {
  const out = [];
  const ed = teamsData[H].elo - teamsData[A].elo;
  if (Math.abs(ed) < 30) out.push('双方 Elo 接近，实力较为均衡');
  else out.push(`${zhName(ed > 0 ? H : A)} Elo 评分领先（${Math.abs(ed)}分）`);
  const fd = (teamsData[H].form || 0) - (teamsData[A].form || 0);
  if (Math.abs(fd) < 0.12) out.push('两队近期状态接近');
  else out.push(`${zhName(fd > 0 ? H : A)} 近10场状态更佳`);
  out.push(homeAdv ? `${zhName(H)} 获得主场优势加成` : '本场为中立场地，无主场优势加成');
  if (hasOdds) out.push('已纳入去庄家水位后的市场赔率');
  if (teamsData[H].value !== teamsData[A].value)
    out.push(`${zhName(teamsData[H].value > teamsData[A].value ? H : A)} 的阵容身价占优`);
  return out;
}

// 体彩推荐（从我们的概率/比分/期望进球生成）
function buildRec(p, H, A) {
  const maxP = Math.max(p.pHome, p.pDraw, p.pAway);
  const dir = p.pHome === maxP ? `${zhName(H)} 主胜` : p.pAway === maxP ? `${zhName(A)} 客胜` : '平局';
  const spf = maxP >= 0.55 ? `${dir}（概率 ${(maxP * 100).toFixed(0)}%）` : `倾向不明显（最高 ${(maxP * 100).toFixed(0)}%），建议观望或关注让球`;
  const tot = p.expGoals.home + p.expGoals.away;
  const ou = tot < 2.5 ? '小球' : tot > 2.9 ? '大球' : '中性';
  const eloGap = Math.abs(teamsData[H].elo - teamsData[A].elo);
  const rq = eloGap >= 150 ? `${zhName(teamsData[H].elo > teamsData[A].elo ? H : A)} 让球方向` : '实力接近，让球价值有限';
  return { spf, score: p.score, total: `预测 ${Math.round(tot)} 球，${ou}方向`, rq };
}

// 全部 72 场预测（按真实赛程时间排序）
const schedule = buildSchedule();
// 场地情境（海拔/休息/旅行）：按全 72 场时间序构建
const venueOf = (h, a) => { const k = `${h} vs ${a}`; return (oddsMeta[k] && oddsMeta[k].venue) || (weatherData[k] && weatherData[k].venue) || ''; };
const CTX = buildContext(schedule.map((s) => ({ home: s.home, away: s.away, date: s.date, venue: venueOf(s.home, s.away) })));
const ctxOf = (h, a) => CTX[`${h}|${a}`] || { goalScale: 1, eloAdjHome: 0, eloAdjAway: 0 };
const matches = schedule.map((s) => {
  const homeAdv = HOSTS.has(s.home) && !HOSTS.has(s.away);
  const c = ctxOf(s.home, s.away);
  const Hc = { name: s.home, ...teamsData[s.home], elo: teamsData[s.home].elo + (c.eloAdjHome || 0) };
  const Ac = { name: s.away, ...teamsData[s.away], elo: teamsData[s.away].elo + (c.eloAdjAway || 0) };
  const p = predictMatch(Hc, Ac, { neutral: !homeAdv, goalScale: c.goalScale || 1 });
  const maxP = Math.max(p.pHome, p.pDraw, p.pAway);
  const pick = p.pHome >= p.pDraw && p.pHome >= p.pAway ? 'H' : p.pAway >= p.pDraw ? 'A' : 'D';
  const mkey = `${s.home} vs ${s.away}`;
  const o = matchOdds[mkey] || null;
  let implied = null;
  if (o) { const m = 1 / o[0] + 1 / o[1] + 1 / o[2]; implied = [1 / o[0] / m, 1 / o[1] / m, 1 / o[2] / m]; }
  const tot = p.expGoals.home + p.expGoals.away;
  const md = oddsMeta[mkey] || {};
  // 亚盘读盘：用我方预期净胜球对比让球线
  let ah = null;
  if (md.ah != null && md.ahFav) {
    const favKey = md.ahFav === 'home' ? s.home : s.away;
    const margin = md.ahFav === 'home' ? p.expGoals.home - p.expGoals.away : p.expGoals.away - p.expGoals.home;
    ah = {
      favZh: zhName(favKey), line: md.ah, ahFav: md.ahFav,
      read: margin > md.ah + 0.3 ? `模型看好${zhName(favKey)}穿盘` : margin < md.ah - 0.3 ? `模型偏向受让方` : '模型与盘口接近',
    };
  }
  // 大小球读盘
  let ou = null;
  if (md.ou != null) ou = { line: md.ou, read: tot > md.ou + 0.2 ? '模型偏大球' : tot < md.ou - 0.2 ? '模型偏小球' : '与盘口接近' };
  const wx = weatherData[mkey] || null;
  const res = playedMap.get(mkey) || null;
  const result = res ? { hs: res.hs, as: res.as, ht: res.htHome != null ? `${res.htHome}-${res.htAway}` : null, r: res.hs > res.as ? 'H' : res.hs < res.as ? 'A' : 'D', goals: res.goals || [], stats: res.stats || null } : null;
  return {
    seq: s.seq, round: s.round, g: s.group,
    result,
    date: s.date, time: s.time, weekday: s.weekday, kickoff: s.kickoff,
    home: p.home, away: p.away, homeAdv,
    h: p.pHome, d: p.pDraw, a: p.pAway,
    pick, maxP,
    score: p.score,
    eg: `${p.expGoals.home.toFixed(1)}-${p.expGoals.away.toFixed(1)}`,
    egTotal: +tot.toFixed(2),
    ouTrend: tot < 2.5 ? '倾向小球' : tot > 2.9 ? '倾向大球' : '盘口中性',
    // 实力对比（我们的数据）
    cmp: {
      elo: [teamsData[s.home].elo, teamsData[s.away].elo],
      value: [teamsData[s.home].value, teamsData[s.away].value],
      fifa: [fifaRankMap[s.home], fifaRankMap[s.away]],
      style: [(profiles[s.home] || {}).style || '?', (profiles[s.away] || {}).style || '?'],
    },
    odds: o, implied,
    src: { espn: md.espn || null, bovada: md.bovada || null, diverge: !!md.diverge },
    titan007: md.titan007 || null, titan007Co: md.titan007Companies || null,
    t007m: md.titan007Market || null, oddsSrc: md.oddsSource || null, espnBovada: md.espnBovada || null,
    ah, ou, venue: md.venue || null, wx,
    move: md.move ? { ...md.move, favZh: zhName(md.move.favKey) } : null,
    drivers: buildDrivers(s.home, s.away, p, homeAdv, !!o),
    rec: buildRec(p, s.home, s.away),
    // 子模型明细 [胜,平,负]
    sub: {
      base: [p.sub.base.h, p.sub.base.d, p.sub.base.a],
      mkt: p.sub.market ? [p.sub.market.h, p.sub.market.d, p.sub.market.a] : null,
    },
    feat: p.features,
  };
});

// 分组出线表
const groupTables = {};
for (const [g, teams] of Object.entries(groups)) {
  groupTables[g] = teams
    .map((t) => sim.results.find((r) => r.team === t))
    .sort((x, y) => y.r32 - x.r32);
}

// ── v2 区块：完赛验证 + 滚动 Elo 变化 + 剩余场 v2 vs 基础 预测对比 ──
function buildV2Block() {
  if (!teamsV2 || !v2Backtest) return null;
  const remaining = [];
  for (const s of schedule) {
    const mkey = `${s.home} vs ${s.away}`;
    if (playedMap.has(mkey)) continue; // 已完赛不算预测
    const changed = eloMoved.has(s.home) || eloMoved.has(s.away);
    if (!changed) continue; // 与基础模型相同的场次不重复列出
    const homeAdv = HOSTS.has(s.home) && !HOSTS.has(s.away);
    const b = predictMatch(s.home, s.away, { neutral: !homeAdv });
    const v = predictV2(s.home, s.away, s.date);
    const pk = (p) => (p.pHome >= p.pDraw && p.pHome >= p.pAway ? 'H' : p.pAway >= p.pDraw ? 'A' : 'D');
    remaining.push({
      seq: s.seq, date: s.date, time: s.time, g: s.group, home: s.home, away: s.away,
      base: [b.pHome, b.pDraw, b.pAway], v2: [v.pHome, v.pDraw, v.pAway],
      pickBase: pk(b), pickV2: pk(v), baseScore: b.score, v2Score: v.score,
      eloBase: [teamsData[s.home].elo, teamsData[s.away].elo],
      eloV2: [teamsV2.teams[s.home].elo, teamsV2.teams[s.away].elo],
      flip: pk(b) !== pk(v),
    });
  }
  // v2 重跑整届蒙特卡洛：注入 v2 滚动 Elo 引擎，并把已完赛结果固定（不再随机重抽）
  const known = new Map();
  for (const r of (wcResults?.results || [])) {
    known.set(`${r.home}|${r.away}`, { gh: r.hs, ga: r.as });
    known.set(`${r.away}|${r.home}`, { gh: r.as, ga: r.hs });
  }
  // 模拟用 v2 Elo（扣临场伤停惩罚，整届生效；MC 无单场日期故按整届计）
  const getTeamV2 = (name) => ({ name, ...teamsData[name], elo: teamsV2.teams[name].elo - eloPenaltyFor(name, ADJ, null) });
  setEngine({ getTeam: getTeamV2, predictMatch });
  const v2sim = runMonteCarlo(iterations, 20260612, cfg.mc.eloSigma, { knownResults: known });
  setEngine({ getTeam, predictMatch }); // 还原基础引擎，避免影响后续
  const baseMap = Object.fromEntries(sim.results.map((r) => [r.team, r]));
  const champions = v2sim.results.map((r) => ({
    team: r.team, elo: r.elo, r32: r.r32, qf: r.qf, sf: r.sf, final: r.final, champion: r.champion,
    baseChampion: (baseMap[r.team] || {}).champion ?? 0, baseR32: (baseMap[r.team] || {}).r32 ?? 0,
  }));
  const groupTablesV2 = {};
  for (const [g, ts] of Object.entries(groups)) {
    groupTablesV2[g] = ts.map((t) => v2sim.results.find((r) => r.team === t))
      .sort((x, y) => y.r32 - x.r32)
      .map((r) => ({ team: r.team, r32: r.r32, champion: r.champion, baseR32: (baseMap[r.team] || {}).r32 ?? 0 }));
  }

  return {
    meta: { ...teamsV2._v2meta, summary: v2Backtest.summary, fetchedAt: wcResults?._fetchedAt || null, source: wcResults?._source || null, knownFixed: known.size / 2 },
    completed: v2Backtest.matches,
    eloChanges: v2Backtest.eloChanges,
    timeline: v2Backtest.timeline || [],
    calibration: v2Backtest.calibration || [],
    remaining,
    champions,
    groupTablesV2,
  };
}

const payload = {
  meta: {
    version: cfg.version,
    date: '2026-06-13',
    iterations,
    teams: sim.results.length,
  },
  champions: sim.results,
  matches,
  groupTables,
  zh: zhMap,
  profiles,
  teams: Object.fromEntries(Object.entries(teamsData).map(([k, v]) => [k, { elo: v.elo, value: v.value }])),
  v2: buildV2Block(),
};

const html = renderHtml(payload);

// 自检：①内嵌 JSON 可解析 ②客户端脚本语法正确（防止模板转义把脚本写坏）
const dataBlock = html.match(/<script id="data"[^>]*>([\s\S]*?)<\/script>/);
JSON.parse(dataBlock[1].replace(/\\u003c/g, '<'));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const clientScript = scripts[scripts.length - 1][1];
try {
  new Function(clientScript); // 仅编译不执行，语法错误会在此抛出
} catch (e) {
  console.error('✗ 客户端脚本语法错误，已中止写入：', e.message);
  process.exit(1);
}

const outPath = join(ROOT, 'output', 'index.html');
writeFileSync(outPath, html, 'utf-8');
console.log(`✓ HTML 看板已写入 ${outPath}（已通过 JSON + 脚本语法自检）`);
console.log(`  浏览器打开即可查看（双击文件或 start output/index.html）`);

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>2026 世界杯预测看板</title>
<style>
  :root {
    --bg: #0f1115; --panel: #181b22; --panel2: #1f232c; --line: #2a2f3a;
    --txt: #e6e8ec; --muted: #8b93a1; --accent: #4ea1ff; --green: #36c275;
    --red: #ff5d6c; --amber: #ffc23d; --gold: #ffd24a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--txt);
    font: 14px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", Roboto, sans-serif; }
  .wrap { max-width: 1160px; margin: 0 auto; padding: 28px 18px 60px; }
  header h1 { margin: 0 0 6px; font-size: 26px; }
  .sub { color: var(--muted); font-size: 13px; }
  .sub code { color: var(--accent); }
  .tabs { display: flex; gap: 8px; margin: 22px 0 18px; flex-wrap: wrap; }
  .tab { padding: 8px 16px; background: var(--panel); border: 1px solid var(--line);
    border-radius: 8px; cursor: pointer; color: var(--muted); user-select: none; }
  .tab.active { background: var(--accent); border-color: var(--accent); color: #06101f; font-weight: 600; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 18px; margin-bottom: 18px; }
  .panel h2 { margin: 0 0 14px; font-size: 17px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: var(--panel2); }
  .bar { position: relative; height: 18px; background: var(--panel2); border-radius: 4px; overflow: hidden; min-width: 90px; }
  .bar > span { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
  .rank { color: var(--muted); width: 30px; }
  .pick-H { color: var(--green); } .pick-A { color: var(--red); } .pick-D { color: var(--amber); }
  .triple { display: flex; height: 16px; border-radius: 4px; overflow: hidden; min-width: 150px; }
  .triple > i { display: block; }
  .triple .h { background: var(--green); } .triple .d { background: var(--amber); } .triple .a { background: var(--red); }
  .legend { display: flex; gap: 14px; color: var(--muted); font-size: 12px; margin-bottom: 10px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  .controls { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
  select, input { background: var(--panel2); color: var(--txt); border: 1px solid var(--line);
    border-radius: 7px; padding: 7px 10px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px; }
  .gcard h3 { margin: 0 0 10px; font-size: 14px; color: var(--accent); }
  .gcard table th, .gcard table td { padding: 5px 7px; font-size: 13px; }
  .pill { padding: 1px 7px; border-radius: 999px; font-size: 11px; background: var(--panel2); color: var(--muted); }
  .gold td:first-child { color: var(--gold); font-weight: 600; }
  .hide { display: none; }
  .pgrid { grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .pcard h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 15px; color: var(--txt); }
  .tier { padding: 1px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .tier-S  { background: var(--gold);  color: #1a1405; }
  .tier-Ap { background: var(--green); color: #06200f; }
  .tier-A  { background: var(--accent); color: #06101f; }
  .tier-Bp { background: #36b8c2; color: #052022; }
  .tier-B  { background: #4a5364; color: #dfe3ea; }
  .tier-C  { background: #2a2f3a; color: var(--muted); }
  .pmeta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--muted); font-size: 12px; margin-bottom: 8px; }
  .pmeta b { color: var(--txt); font-weight: 600; }
  .plist { margin: 6px 0 0; padding: 0; list-style: none; font-size: 12px; }
  .plist li { padding: 1px 0; }
  .plist .plus::before  { content: "▲ "; color: var(--green); }
  .plist .minus::before { content: "▼ "; color: var(--red); }
  footer { color: var(--muted); font-size: 12px; margin-top: 26px; line-height: 1.7; }
  .teamcell { font-weight: 600; }
  .mrow { cursor: pointer; }
  .mrow:hover td { background: var(--panel2); }
  .caret { color: var(--accent); display: inline-block; width: 10px; }
  .detail { background: #14181f; border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 4px 0; }
  .dcols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 760px) { .dcols { grid-template-columns: 1fr; } }
  .dsub { color: var(--accent); font-size: 12px; font-weight: 600; margin: 12px 0 6px; }
  .dsub:first-child { margin-top: 0; }
  .detail .t th, .detail .t td { padding: 4px 7px; font-size: 12px; }
  .drec { margin-top: 12px; background: #191e26; border: 1px solid var(--line); border-radius: 6px; padding: 8px 14px; }
  .dmeta { color: var(--muted); font-size: 12px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
  .kv span { color: var(--muted); }
  .drv { margin: 4px 0 0; padding-left: 18px; font-size: 12px; }
  .drv li { padding: 1px 0; }
  .gold { color: var(--gold); }
  .small { color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>⚽ 2026 世界杯预测看板</h1>
    <div class="sub">模型 <code id="m-ver"></code> · <span id="m-date"></span> · 蒙特卡洛 <span id="m-iter"></span> 次 · <span id="m-teams"></span> 队 · <a href="dual.html" style="color:var(--accent)">双模型共同推断页 →</a></div>
  </header>

  <div class="tabs">
    <div class="tab active" data-tab="champ">夺冠概率</div>
    <div class="tab" data-tab="groups">分组出线</div>
    <div class="tab" data-tab="matches">全部对阵</div>
    <div class="tab" data-tab="picks">最稳 / 爆冷</div>
    <div class="tab" data-tab="profiles">球队档案</div>
    <div class="tab" data-tab="v2">v2 · 完赛验证</div>
  </div>

  <!-- 夺冠概率 -->
  <section id="tab-champ">
    <div class="panel">
      <h2>夺冠概率排行</h2>
      <table>
        <thead><tr>
          <th class="rank">#</th><th>球队</th><th class="num">进32强</th><th class="num">进8强</th>
          <th class="num">进4强</th><th class="num">进决赛</th><th>夺冠概率</th>
        </tr></thead>
        <tbody id="champ-body"></tbody>
      </table>
    </div>
  </section>

  <!-- 分组出线 -->
  <section id="tab-groups" class="hide">
    <div class="panel">
      <h2>各组出线概率（按进32强排序）</h2>
      <div class="grid" id="groups-grid"></div>
    </div>
  </section>

  <!-- 全部对阵 -->
  <section id="tab-matches" class="hide">
    <div class="panel">
      <h2>72 场小组赛预测</h2>
      <div class="controls">
        <label>分组
          <select id="f-group"><option value="">全部</option></select>
        </label>
        <label>搜索球队 <input id="f-text" placeholder="如 Brazil" /></label>
        <label>排序
          <select id="f-sort">
            <option value="time">按比赛时间</option>
            <option value="group">按分组</option>
            <option value="conf">按确定性(高→低)</option>
            <option value="upset">按爆冷(低→高)</option>
          </select>
        </label>
      </div>
      <div class="legend"><span><i class="h" style="background:var(--green)"></i>主胜</span><span><i class="d" style="background:var(--amber)"></i>平局</span><span><i class="a" style="background:var(--red)"></i>客胜</span><span style="margin-left:auto">时间为北京时间（示意赛程）</span></div>
      <table>
        <thead><tr>
          <th>时间</th><th>组</th><th>对阵</th><th class="num">主胜</th><th class="num">平</th><th class="num">客胜</th>
          <th>分布</th><th>预测</th><th>比分</th>
        </tr></thead>
        <tbody id="matches-body"></tbody>
      </table>
    </div>
  </section>

  <!-- 最稳 / 爆冷 -->
  <section id="tab-picks" class="hide">
    <div class="panel">
      <h2>🟢 最稳热门（单场最高胜率 TOP 10）</h2>
      <table><thead><tr><th>对阵</th><th>预测</th><th class="num">胜率</th><th>分布</th><th>比分</th></tr></thead>
        <tbody id="surest-body"></tbody></table>
    </div>
    <div class="panel">
      <h2>🔴 最高爆冷风险（三态最接近 TOP 10）</h2>
      <table><thead><tr><th>对阵</th><th class="num">主胜</th><th class="num">平</th><th class="num">客胜</th><th>分布</th><th>最高概率</th></tr></thead>
        <tbody id="upset-body"></tbody></table>
    </div>
  </section>

  <!-- 球队档案 -->
  <section id="tab-profiles" class="hide">
    <div class="panel">
      <h2>48 强深度档案 <span class="small">（数据截止 2026-06-05，标 ≈ 为估算补全）</span></h2>
      <div class="controls">
        <label>大洲
          <select id="p-confed"><option value="">全部</option></select>
        </label>
        <label>战力分级
          <select id="p-tier"><option value="">全部</option></select>
        </label>
        <label>搜索 <input id="p-text" placeholder="如 巴西 / Haaland" /></label>
      </div>
      <div class="grid pgrid" id="profiles-grid"></div>
    </div>
  </section>

  <!-- v2 · 完赛验证 -->
  <section id="tab-v2" class="hide">
    <div class="panel">
      <h2>v2 · 实时滚动 Elo + 完赛验证 <span class="small" id="v2-sub"></span></h2>
      <p class="small" id="v2-intro" style="margin-top:-6px"></p>
      <div class="grid" id="v2-cards" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin-bottom:6px"></div>
    </div>
    <div class="panel" id="v2-calib-panel">
      <h2>live 校准 <span class="small">（本届预测可信度，随完赛自动累积）</span></h2>
      <div class="dcols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div>
          <div class="dsub" style="color:var(--accent);font-size:12px;font-weight:600;margin-bottom:6px">置信度校准（预测最高概率 → 实际命中）</div>
          <table><thead><tr><th>预测区间</th><th class="num">场次</th><th class="num">实际命中</th></tr></thead><tbody id="v2-calib-body"></tbody></table>
        </div>
        <div>
          <div class="dsub" style="color:var(--accent);font-size:12px;font-weight:600;margin-bottom:6px">累积命中率 / Brier 时间线</div>
          <table><thead><tr><th class="num">#</th><th>对阵</th><th class="num">累积命中</th><th class="num">累积Brier</th></tr></thead><tbody id="v2-timeline-body"></tbody></table>
        </div>
      </div>
      <div class="small" style="margin-top:8px">样本越多越可信；理想情况下各区间实际命中应接近其预测概率，55% 上下应有命中率跳变。</div>
    </div>
    <div class="panel" id="v2-champ-panel">
      <h2>v2 更新夺冠概率 <span class="small">（已完赛结果固定 + 滚动 Elo 重跑 1 万次模拟；Δ 为相对基础模型的变化）</span></h2>
      <table>
        <thead><tr>
          <th class="rank">#</th><th>球队</th><th class="num">进32强</th><th class="num">进4强</th>
          <th class="num">进决赛</th><th class="num">基础夺冠</th><th class="num">v2 夺冠</th><th class="num">Δ</th><th>v2 夺冠概率</th>
        </tr></thead>
        <tbody id="v2-champ-body"></tbody>
      </table>
    </div>
    <div class="panel" id="v2-groups-panel">
      <h2>v2 更新出线概率 <span class="small">（按 v2 进32强排序，括号为相对基础变化）</span></h2>
      <div class="grid" id="v2-groups-grid"></div>
    </div>
    <div class="panel" id="v2-completed-panel">
      <h2>已完赛逐场对账（赛前预测 vs 实际，样本外）</h2>
      <div class="legend"><span>✓ 命中 / ✗ 未中</span><span style="margin-left:auto">半场为 ESPN best-effort</span></div>
      <table>
        <thead><tr>
          <th>时间</th><th>组</th><th>对阵</th><th>实际(半/全)</th>
          <th class="num">预测 主/平/客</th><th>赛前预测</th><th>结果</th><th>比分预测</th><th class="num">ΔElo</th>
        </tr></thead>
        <tbody id="v2-completed-body"></tbody>
      </table>
    </div>
    <div class="panel" id="v2-elo-panel">
      <h2>滚动 Elo 变化（已完赛驱动）</h2>
      <table>
        <thead><tr><th>球队</th><th class="num">基础 Elo</th><th class="num">v2 Elo</th><th class="num">Δ</th><th>变化</th></tr></thead>
        <tbody id="v2-elo-body"></tbody>
      </table>
    </div>
    <div class="panel" id="v2-remaining-panel">
      <h2>后续场次：v2 vs 基础模型 逐场对比 <span class="small">（仅列 Elo 已变动队伍的未赛场——其余场次两模型预测相同；▲ 为换边）</span></h2>
      <div class="legend"><span><i class="h" style="background:var(--green)"></i>主胜</span><span><i class="d" style="background:var(--amber)"></i>平</span><span><i class="a" style="background:var(--red)"></i>客胜</span><span style="margin-left:auto">每格含胜平负分布 + 预测比分</span></div>
      <table>
        <thead><tr>
          <th>时间</th><th>对阵（Elo 基础→v2）</th>
          <th>基础模型（主/平/客 + 比分）</th><th>v2 模型（主/平/客 + 比分）</th><th>变化</th>
        </tr></thead>
        <tbody id="v2-remaining-body"></tbody>
      </table>
    </div>
  </section>

  <footer>
    免责声明：本看板基于统计模型与历史数据，仅供娱乐参考，不是理财建议。足球比赛存在高度不确定性，任何预测都无法保证准确。购彩有节制，请理性投注，量力而行。<br/>
    数据为内置 48 队近似实力值（示意，可在 data/teams.json 与 data/groups.json 中替换）。重新生成：<code>node scripts/build-html.mjs</code>
  </footer>
</div>

<script id="data" type="application/json">${json}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const pct = (x) => (x * 100).toFixed(1) + '%';
const $ = (s) => document.querySelector(s);
// 中文队名（英文原名作小字附注）
const nm = (t) => (DATA.zh[t] || t);
const nmFull = (t) => DATA.zh[t] ? (DATA.zh[t] + ' <span class="small">' + t + '</span>') : t;

// 头部
$('#m-ver').textContent = DATA.meta.version;
$('#m-date').textContent = DATA.meta.date;
$('#m-iter').textContent = DATA.meta.iterations.toLocaleString();
$('#m-teams').textContent = DATA.meta.teams;

// Tabs
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('section').forEach((s) => s.classList.add('hide'));
    $('#tab-' + t.dataset.tab).classList.remove('hide');
  };
});

// 夺冠概率
const maxChamp = Math.max(...DATA.champions.map((c) => c.champion)) || 1;
$('#champ-body').innerHTML = DATA.champions.slice(0, 24).map((c, i) => {
  const w = Math.max(2, (c.champion / maxChamp) * 100);
  return '<tr>' +
    '<td class="rank">' + (i + 1) + '</td>' +
    '<td class="teamcell">' + nmFull(c.team) + '</td>' +
    '<td class="num">' + pct(c.r32) + '</td>' +
    '<td class="num">' + pct(c.qf) + '</td>' +
    '<td class="num">' + pct(c.sf) + '</td>' +
    '<td class="num">' + pct(c.final) + '</td>' +
    '<td><div class="bar"><span style="width:' + w + '%;background:var(--gold)"></span></div>' +
    '<span class="small" style="margin-left:6px">' + pct(c.champion) + '</span></td>' +
    '</tr>';
}).join('');

// 分组
$('#groups-grid').innerHTML = Object.entries(DATA.groupTables).map(([g, rows]) => {
  const body = rows.map((r, i) =>
    '<tr class="' + (i < 2 ? 'gold' : '') + '">' +
    '<td>' + nm(r.team) + '</td>' +
    '<td class="num">' + pct(r.r32) + '</td>' +
    '<td class="num">' + pct(r.champion) + '</td></tr>'
  ).join('');
  return '<div class="panel gcard"><h3>组 ' + g + ' <span class="pill">前2出线</span></h3>' +
    '<table><thead><tr><th>球队</th><th class="num">进32</th><th class="num">夺冠</th></tr></thead>' +
    '<tbody>' + body + '</tbody></table></div>';
}).join('');

// 三态分布条（悬停显示集成 + 各子模型明细）
function subLine(label, v) {
  return v ? '\\n' + label + ' ' + pct(v[0]) + '/' + pct(v[1]) + '/' + pct(v[2]) : '';
}
function tripleTitle(m) {
  let t = '集成 主胜 ' + pct(m.h) + ' / 平 ' + pct(m.d) + ' / 客胜 ' + pct(m.a);
  if (m.sub) {
    t += subLine('特征模型', m.sub.base) + subLine('去水位赔率', m.sub.mkt);
  }
  return t;
}
function triple(m) {
  return '<div class="triple" title="' + tripleTitle(m) + '">' +
    '<i class="h" style="width:' + m.h * 100 + '%"></i>' +
    '<i class="d" style="width:' + m.d * 100 + '%"></i>' +
    '<i class="a" style="width:' + m.a * 100 + '%"></i></div>';
}
function pickLabel(m) {
  if (m.pick === 'H') return '<span class="pick-H">' + nm(m.home) + ' 胜</span>';
  if (m.pick === 'A') return '<span class="pick-A">' + nm(m.away) + ' 胜</span>';
  return '<span class="pick-D">平局</span>';
}

// 全部对阵
const fGroup = $('#f-group');
[...new Set(DATA.matches.map((m) => m.g))].forEach((g) => {
  const o = document.createElement('option'); o.value = g; o.textContent = '组 ' + g; fGroup.appendChild(o);
});
function renderMatches() {
  const g = fGroup.value;
  const txt = $('#f-text').value.trim().toLowerCase();
  const sort = $('#f-sort').value;
  let list = DATA.matches.filter((m) => {
    if (g && m.g !== g) return false;
    if (!txt) return true;
    const hay = (m.home + ' ' + m.away + ' ' + nm(m.home) + ' ' + nm(m.away)).toLowerCase();
    return hay.includes(txt);
  });
  if (sort === 'conf') list = [...list].sort((a, b) => b.maxP - a.maxP);
  else if (sort === 'upset') list = [...list].sort((a, b) => a.maxP - b.maxP);
  else if (sort === 'group') list = [...list].sort((a, b) => a.g.localeCompare(b.g) || a.seq - b.seq);
  else list = [...list].sort((a, b) => a.seq - b.seq); // 按比赛时间
  $('#matches-body').innerHTML = list.map((m) =>
    '<tr class="mrow" data-seq="' + m.seq + '" title="点击展开详情">' +
    '<td class="small" style="white-space:nowrap"><span class="caret">▸</span> ' + m.date.slice(5) + ' ' + m.time +
      '<br><span style="opacity:.7;padding-left:14px">' + m.weekday + ' · 第' + m.round + '轮</span></td>' +
    '<td><span class="pill">' + m.g + '</span>' + (m.sub && m.sub.mkt ? ' <span class="pill" style="color:var(--accent)" title="该场融合了去水位赔率共识(权重0.35)">赔</span>' : '') + '</td>' +
    '<td class="teamcell">' + nm(m.home) + ' <span class="small">vs</span> ' + nm(m.away) + '</td>' +
    '<td class="num">' + pct(m.h) + '</td><td class="num">' + pct(m.d) + '</td><td class="num">' + pct(m.a) + '</td>' +
    '<td>' + triple(m) + '</td><td>' + pickLabel(m) + '</td>' +
    '<td>' + m.score + (m.result ? ' <span class="pill" style="color:var(--green)" title="真实完赛比分">实 ' + m.result.hs + '-' + m.result.as + (m.result.r === m.pick ? ' ✓' : '') + '</span>' : '') + '</td></tr>' +
    '<tr class="drow" data-for="' + m.seq + '" style="display:none"><td colspan="9">' + matchDetail(m) + '</td></tr>'
  ).join('');
}

// 逐场详情卡（全部由我们自己的模型/数据生成）
function f3(v) { return v ? pct(v[0]) + ' / ' + pct(v[1]) + ' / ' + pct(v[2]) : '—'; }
function matchDetail(m) {
  const c = m.cmp;
  const sr = (label, o) => o ? '<tr><td>' + label + '</td><td class="num">' + o[0] + '</td><td class="num">' + o[1] + '</td><td class="num">' + o[2] + '</td></tr>' : '';
  const t007row = m.titan007 ? '<tr><td><b class="gold">Titan007共识(' + (m.titan007Co || '?') + '家)</b></td><td class="num">' + m.titan007[0].toFixed(2) + '</td><td class="num">' + m.titan007[1].toFixed(2) + '</td><td class="num">' + m.titan007[2].toFixed(2) + '</td></tr>' : '';
  const oddsRows = (m.titan007 || (m.src && (m.src.espn || m.src.bovada)))
    ? t007row +
      sr('ESPN', m.espnBovada || m.src.espn) + sr('Bovada', m.src.bovada) +
      (!m.titan007 && m.odds ? '<tr><td>双源共识</td><td class="num">' + m.odds[0] + '</td><td class="num">' + m.odds[1] + '</td><td class="num">' + m.odds[2] + '</td></tr>' : '') +
      '<tr><td>喂模型(去水位)</td><td class="num">' + pct(m.implied[0]) + '</td><td class="num">' + pct(m.implied[1]) + '</td><td class="num">' + pct(m.implied[2]) + '</td></tr>'
    : '<tr><td colspan="4" class="small">该场暂无赔率数据，市场子模型未参与（权重已归一）</td></tr>';
  const wxLine = m.wx ? '最高' + m.wx.tmax + '°C / 最低' + m.wx.tmin + '°C · 降水 ' + m.wx.precip + 'mm · 风 ' + m.wx.wind + 'km/h' : '暂无';
  return '<div class="detail">' +
    (m.venue || m.wx ? '<div class="dmeta">📍 ' + (m.venue || '场地待定') + (m.wx ? '　🌤 ' + wxLine : '') + '</div>' : '') +
    '<div class="dcols">' +
      '<div><div class="dsub">实力对比（我方数据）</div>' +
        '<table class="t"><thead><tr><th>指标</th><th>' + nm(m.home) + '</th><th>' + nm(m.away) + '</th></tr></thead><tbody>' +
        '<tr><td>Elo 评分</td><td>' + c.elo[0] + '</td><td>' + c.elo[1] + '</td></tr>' +
        '<tr><td>FIFA 排名(48内)</td><td>' + c.fifa[0] + '</td><td>' + c.fifa[1] + '</td></tr>' +
        '<tr><td>阵容身价</td><td>€' + c.value[0] + 'M</td><td>€' + c.value[1] + 'M</td></tr>' +
        '<tr><td>战术风格</td><td class="small">' + c.style[0] + '</td><td class="small">' + c.style[1] + '</td></tr>' +
        '</tbody></table>' +
        '<div class="dsub">赔率对比' + (m.titan007 ? '（Titan007 多庄共识优先喂模型）' : '') + (m.src && m.src.diverge ? ' <span style="color:var(--amber)">⚠双源分歧>6%</span>' : '') + '</div>' +
        '<table class="t"><thead><tr><th>数据源</th><th>主胜</th><th>平</th><th>客胜</th></tr></thead><tbody>' +
        oddsRows +
        '<tr><td>模型概率</td><td class="num">' + pct(m.h) + '</td><td class="num">' + pct(m.d) + '</td><td class="num">' + pct(m.a) + '</td></tr>' +
        '</tbody></table>' +
      '</div>' +
      '<div>' +
        '<div class="dsub">子模型明细（胜/平/负）</div>' +
        '<div class="kv"><span>特征模型</span><b>' + f3(m.sub.base) + '</b></div>' +
        '<div class="kv"><span>去水位赔率(融合0.35)</span><b>' + f3(m.sub.mkt) + '</b></div>' +
        (m.feat ? '<div class="kv"><span>特征贡献</span><b class="small">Elo ' + m.feat.elo.toFixed(2) + ' · FIFA ' + m.feat.fifa.toFixed(2) + ' · 身价 ' + m.feat.value.toFixed(2) + ' · 状态 ' + m.feat.form.toFixed(2) + ' · 阵容 ' + m.feat.squad.toFixed(2) + '</b></div>' : '') +
        '<div class="dsub">亚盘 / 大小球（真实盘口线）</div>' +
        (m.ah ? '<div class="kv"><span>让球盘口</span><b>' + m.ah.favZh + ' 让 ' + m.ah.line + ' 球 · <span class="gold">' + m.ah.read + '</span></b></div>' : '<div class="kv"><span>让球盘口</span><b class="small">暂无</b></div>') +
        (m.move && (m.move.up || m.move.dn || m.move.hi || m.move.lo) ?
          '<div class="kv"><span>盘口异动(' + m.move.books.length + '家)</span><b>升' + m.move.up + '/降' + m.move.dn + ' 高' + m.move.hi + '/低' + m.move.lo +
          ' · <span class="' + (m.move.sig > 0 ? 'pick-H' : m.move.sig < 0 ? 'pick-A' : '') + '">信号' + (m.move.sig > 0 ? '+' : '') + m.move.sig + ' ' + m.move.read + '</span></b></div>' +
          '<div class="kv" style="border:none"><span class="small"></span><span class="small" style="text-align:right">' +
          m.move.books.map((b) => b.name + ' ' + b.hOpen + '→' + b.hCur + ' ' + b.pan).join('；') + '</span></div>' : '') +
        (m.ou ? '<div class="kv"><span>大小球盘口</span><b>盘口 ' + m.ou.line + ' · 模型预期 ' + m.egTotal + ' 球 · <span class="gold">' + m.ou.read + '</span></b></div>' : '<div class="kv"><span>大小球</span><b>' + m.ouTrend + '（预期 ' + m.egTotal + ' 球）</b></div>') +
        (m.t007m ? '<div class="dsub">Titan007 市场情绪（上百家庄）</div>' +
          (m.t007m.move ? '<div class="kv"><span>欧赔异动</span><b>开盘→即时 主胜概率漂移 ' + (m.t007m.move.driftHomeProb >= 0 ? '+' : '') + (m.t007m.move.driftHomeProb * 100).toFixed(1) + 'pp · <span class="' + (m.t007m.move.signal > 0 ? 'pick-H' : m.t007m.move.signal < 0 ? 'pick-A' : '') + '">信号 ' + (m.t007m.move.signal > 0 ? '+' : '') + m.t007m.move.signal + ' · ' + m.t007m.move.lean + '</span></b></div>' : '') +
          (m.t007m.ou ? '<div class="kv"><span>大小球(Titan007)</span><b>共识盘口 ' + m.t007m.ou.line + ' · <span class="gold">倾向' + m.t007m.ou.lean + '</span>（大球水' + m.t007m.ou.over + '/小球水' + m.t007m.ou.under + '）</b></div>' : '') : '') +
        '<div class="dsub">模型驱动因素</div>' +
        '<ul class="drv">' + m.drivers.map((x) => '<li>' + x + '</li>').join('') + '</ul>' +
      '</div>' +
    '</div>' +
    '<div class="drec">' +
      '<div class="dsub">体彩推荐（模型生成）</div>' +
      '<div class="kv"><span>单场胜平负</span><b>' + m.rec.spf + '</b></div>' +
      '<div class="kv"><span>让球方向</span><b>' + m.rec.rq + '</b></div>' +
      '<div class="kv"><span>预测比分</span><b class="gold">' + m.rec.score + '</b></div>' +
      '<div class="kv"><span>总进球</span><b>' + m.rec.total + '</b></div>' +
    '</div></div>';
}

// 点击行展开/收起详情
$('#matches-body').addEventListener('click', (e) => {
  const row = e.target.closest('.mrow');
  if (!row) return;
  const drow = document.querySelector('.drow[data-for="' + row.dataset.seq + '"]');
  if (!drow) return;
  const open = drow.style.display !== 'none';
  drow.style.display = open ? 'none' : 'table-row';
  const caret = row.querySelector('.caret');
  if (caret) caret.textContent = open ? '▸' : '▾';
});

fGroup.onchange = renderMatches;
$('#f-text').oninput = renderMatches;
$('#f-sort').onchange = renderMatches;
renderMatches();

// 最稳 / 爆冷
const surest = [...DATA.matches].sort((a, b) => b.maxP - a.maxP).slice(0, 10);
const upset = [...DATA.matches].sort((a, b) => a.maxP - b.maxP).slice(0, 10);
$('#surest-body').innerHTML = surest.map((m) =>
  '<tr><td class="teamcell">' + nm(m.home) + ' vs ' + nm(m.away) + '</td>' +
  '<td>' + pickLabel(m) + '</td>' +
  '<td class="num">' + pct(m.maxP) + '</td>' +
  '<td>' + triple(m) + '</td><td>' + m.score + '</td></tr>'
).join('');
$('#upset-body').innerHTML = upset.map((m) =>
  '<tr><td class="teamcell">' + nm(m.home) + ' vs ' + nm(m.away) + '</td>' +
  '<td class="num">' + pct(m.h) + '</td><td class="num">' + pct(m.d) + '</td><td class="num">' + pct(m.a) + '</td>' +
  '<td>' + triple(m) + '</td><td class="num">最高 ' + pct(m.maxP) + '</td></tr>'
).join('');

// ── 球队档案 ──
const TIER_CLS = { 'S': 'tier-S', 'A+': 'tier-Ap', 'A': 'tier-A', 'B+': 'tier-Bp', 'B': 'tier-B', 'C': 'tier-C' };
const TIER_ORDER = ['S', 'A+', 'A', 'B+', 'B', 'C'];
const profList = Object.entries(DATA.profiles).map(([team, p]) => ({ team, ...p, elo: (DATA.teams[team] || {}).elo || 0, value: (DATA.teams[team] || {}).value || 0 }))
  .sort((a, b) => b.elo - a.elo);

const pConfed = $('#p-confed'), pTier = $('#p-tier');
[...new Set(profList.map((p) => p.confed))].forEach((c) => {
  const o = document.createElement('option'); o.value = c; o.textContent = c; pConfed.appendChild(o);
});
TIER_ORDER.filter((t) => profList.some((p) => p.tier === t)).forEach((t) => {
  const o = document.createElement('option'); o.value = t; o.textContent = t + ' 级'; pTier.appendChild(o);
});

function renderProfiles() {
  const c = pConfed.value, t = pTier.value, txt = $('#p-text').value.trim().toLowerCase();
  const list = profList.filter((p) => {
    if (c && p.confed !== c) return false;
    if (t && p.tier !== t) return false;
    if (!txt) return true;
    const hay = (p.team + ' ' + nm(p.team) + ' ' + p.coach + ' ' + p.star + ' ' + p.style).toLowerCase();
    return hay.includes(txt);
  });
  $('#profiles-grid').innerHTML = list.map((p) =>
    '<div class="panel pcard">' +
      '<h3>' + nm(p.team) + ' <span class="small">' + p.team + (p.est ? ' ≈' : '') + '</span>' +
      '<span class="tier ' + (TIER_CLS[p.tier] || 'tier-C') + '" style="margin-left:auto">' + p.tier + '</span></h3>' +
      '<div class="pmeta">' +
        '<span>Elo <b>' + p.elo + '</b></span>' +
        '<span>身价 <b>€' + p.value + 'M</b></span>' +
        '<span>平均年龄 <b>' + p.age + '</b></span>' +
        '<span>' + p.confed + '</span>' +
      '</div>' +
      '<div class="pmeta">' +
        '<span>教练 <b>' + p.coach + '</b></span>' +
        '<span>核心 <b>' + p.star + '</b></span>' +
      '</div>' +
      '<div class="pmeta"><span>风格 <b>' + p.style + '</b></span><span>世界杯最佳 <b>' + p.best + '</b></span></div>' +
      '<ul class="plist">' +
        p.strengths.map((s) => '<li class="plus">' + s + '</li>').join('') +
        p.concerns.map((s) => '<li class="minus">' + s + '</li>').join('') +
      '</ul>' +
    '</div>'
  ).join('');
}
pConfed.onchange = renderProfiles;
pTier.onchange = renderProfiles;
$('#p-text').oninput = renderProfiles;
renderProfiles();

// ── v2 · 完赛验证 ──
(function renderV2() {
  const v2 = DATA.v2;
  if (!v2 || !v2.completed || !v2.completed.length) {
    $('#v2-sub').textContent = '';
    $('#v2-intro').textContent = '暂无已完赛数据：本届世界杯尚未开赛或未抓到完赛比分。运行 node scripts/fetch-results.mjs && node scripts/build-elo-v2.mjs 后重建。';
    ['#v2-completed-panel', '#v2-elo-panel', '#v2-remaining-panel'].forEach((s) => $(s).classList.add('hide'));
    $('#v2-cards').innerHTML = '';
    return;
  }
  const s = v2.meta.summary;
  $('#v2-sub').textContent = '基于 ' + s.matches + ' 场完赛 · 抓取 ' + (v2.meta.fetchedAt || '').slice(0, 10);
  $('#v2-intro').textContent = v2.meta.note || '';
  const card = (label, val, hint) => '<div class="panel" style="padding:12px 14px;margin:0"><div class="small">' + label + '</div><div style="font-size:22px;font-weight:700;margin-top:4px">' + val + '</div>' + (hint ? '<div class="small" style="margin-top:2px">' + hint + '</div>' : '') + '</div>';
  $('#v2-cards').innerHTML =
    card('完赛场次', s.matches) +
    card('1X2 命中', (s.accuracy1X2 * 100).toFixed(0) + '%', '方向') +
    card('Brier', s.brierAvg, '越低越好·盲猜0.67') +
    card('波胆命中', (s.scoreHit * 100).toFixed(0) + '%', '精确比分') +
    card('log-loss', s.loglossAvg, '越低越好');
  const tri = (a) => '<div class="triple" style="min-width:120px" title="主 ' + pct(a[0]) + ' / 平 ' + pct(a[1]) + ' / 客 ' + pct(a[2]) + '"><i class="h" style="width:' + a[0] * 100 + '%"></i><i class="d" style="width:' + a[1] * 100 + '%"></i><i class="a" style="width:' + a[2] * 100 + '%"></i></div>';
  const resLabel = (r) => r === 'H' ? '<span class="pick-H">主胜</span>' : r === 'A' ? '<span class="pick-A">客胜</span>' : '<span class="pick-D">平</span>';
  // Δ 着色（百分点）
  const dpp = (now, was) => {
    const d = (now - was) * 100;
    if (Math.abs(d) < 0.05) return '<span class="small">±0</span>';
    const cls = d > 0 ? 'pick-H' : 'pick-A';
    return '<span class="' + cls + '">' + (d > 0 ? '+' : '') + d.toFixed(1) + '</span>';
  };

  // live 校准 + 时间线
  if (v2.calibration && v2.calibration.length) {
    $('#v2-calib-body').innerHTML = v2.calibration.map((c) =>
      '<tr><td>' + c.range + '</td><td class="num">' + c.n + '</td><td class="num">' + (c.hitRate == null ? '<span class="small">—</span>' : (c.hitRate * 100).toFixed(0) + '%') + '</td></tr>'
    ).join('');
    $('#v2-timeline-body').innerHTML = (v2.timeline || []).map((t) =>
      '<tr><td class="num">' + t.i + '</td><td class="small">' + nm(t.label.split('-')[0]) + ' vs ' + nm(t.label.split('-').slice(1).join('-')) + '</td><td class="num">' + (t.accCum * 100).toFixed(0) + '%</td><td class="num">' + t.brierCum.toFixed(3) + '</td></tr>'
    ).join('');
  } else $('#v2-calib-panel').classList.add('hide');

  // v2 更新夺冠概率（重跑模拟，已完赛固定）
  if (v2.champions && v2.champions.length) {
    const maxC = Math.max.apply(null, v2.champions.map((c) => c.champion)) || 1;
    $('#v2-champ-body').innerHTML = v2.champions.slice(0, 24).map((c, i) =>
      '<tr>' +
      '<td class="rank">' + (i + 1) + '</td>' +
      '<td class="teamcell">' + nmFull(c.team) + '</td>' +
      '<td class="num">' + pct(c.r32) + '</td>' +
      '<td class="num">' + pct(c.sf) + '</td>' +
      '<td class="num">' + pct(c.final) + '</td>' +
      '<td class="num small">' + pct(c.baseChampion) + '</td>' +
      '<td class="num"><b>' + pct(c.champion) + '</b></td>' +
      '<td class="num">' + dpp(c.champion, c.baseChampion) + '</td>' +
      '<td><div class="bar"><span style="width:' + Math.max(2, c.champion / maxC * 100) + '%;background:var(--gold)"></span></div></td>' +
      '</tr>'
    ).join('');
  } else $('#v2-champ-panel').classList.add('hide');

  // v2 更新出线概率（分组）
  if (v2.groupTablesV2) {
    $('#v2-groups-grid').innerHTML = Object.entries(v2.groupTablesV2).map(function (e) {
      const g = e[0], rows = e[1];
      const body = rows.map((r, i) =>
        '<tr class="' + (i < 2 ? 'gold' : '') + '">' +
        '<td>' + nm(r.team) + '</td>' +
        '<td class="num">' + pct(r.r32) + '</td>' +
        '<td class="num">' + dpp(r.r32, r.baseR32) + '</td></tr>'
      ).join('');
      return '<div class="panel gcard"><h3>组 ' + g + ' <span class="pill">前2出线</span></h3>' +
        '<table><thead><tr><th>球队</th><th class="num">进32</th><th class="num">Δ</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div>';
    }).join('');
  } else $('#v2-groups-panel').classList.add('hide');
  $('#v2-completed-body').innerHTML = v2.completed.map((m) =>
    '<tr>' +
    '<td class="small" style="white-space:nowrap">' + (m.et || '').slice(5, 10) + '</td>' +
    '<td><span class="pill">' + m.group + '</span></td>' +
    '<td class="teamcell">' + nm(m.home) + ' <span class="small">vs</span> ' + nm(m.away) + '</td>' +
    '<td><b>' + m.hs + '-' + m.as + '</b>' + (m.ht ? ' <span class="small">(半 ' + m.ht + ')</span>' : '') + '</td>' +
    '<td>' + tri([m.pHome, m.pDraw, m.pAway]) + '</td>' +
    '<td>' + resLabel(m.predOutcome) + '</td>' +
    '<td>' + (m.correct ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>') + '</td>' +
    '<td>' + m.predScore + (m.scoreHit ? ' <span style="color:var(--green)">✓</span>' : '') + '</td>' +
    '<td class="num">' + (m.eloDelta >= 0 ? '+' : '') + m.eloDelta + '</td>' +
    '</tr>'
  ).join('');
  $('#v2-elo-body').innerHTML = v2.eloChanges.map((c) =>
    '<tr><td class="teamcell">' + nmFull(c.team) + '</td>' +
    '<td class="num">' + c.before + '</td><td class="num">' + c.after + '</td>' +
    '<td class="num ' + (c.delta >= 0 ? 'pick-H' : 'pick-A') + '">' + (c.delta >= 0 ? '+' : '') + c.delta + '</td>' +
    '<td><div class="bar" style="min-width:80px"><span style="width:' + Math.min(100, Math.abs(c.delta) / 30 * 100) + '%;background:' + (c.delta >= 0 ? 'var(--green)' : 'var(--red)') + '"></span></div></td></tr>'
  ).join('');
  // 单格：胜平负分布条 + 预测比分 + 倾向
  const cmpCell = (p, score, pick) => tri(p) +
    '<div class="small" style="margin-top:3px">比分 <b class="gold">' + score + '</b> · ' + resLabel(pick) + ' ' + pct(Math.max(p[0], p[1], p[2])) + '</div>';
  if (!v2.remaining.length) $('#v2-remaining-body').innerHTML = '<tr><td colspan="5" class="small">暂无受影响的未赛场次</td></tr>';
  else $('#v2-remaining-body').innerHTML = v2.remaining.map((m) => {
    const scoreChg = m.baseScore !== m.v2Score;
    const chg = m.flip
      ? '<span class="gold">▲ 换边<br>' + resLabel(m.pickBase) + '→' + resLabel(m.pickV2) + '</span>'
      : (scoreChg ? '比分微调<br><span class="small" style="opacity:.8">' + m.baseScore + '→' + m.v2Score + '</span>' : '<span class="small">基本一致</span>');
    return '<tr>' +
      '<td class="small" style="white-space:nowrap">' + m.date.slice(5) + ' ' + m.time + '<br><span class="pill">' + m.g + '</span></td>' +
      '<td class="teamcell">' + nm(m.home) + ' <span class="small">vs</span> ' + nm(m.away) +
        '<br><span class="small" style="font-weight:400">Elo ' + m.eloBase[0] + '→' + m.eloV2[0] + ' · ' + m.eloBase[1] + '→' + m.eloV2[1] + '</span></td>' +
      '<td>' + cmpCell(m.base, m.baseScore, m.pickBase) + '</td>' +
      '<td>' + cmpCell(m.v2, m.v2Score, m.pickV2) + '</td>' +
      '<td class="small">' + chg + '</td>' +
      '</tr>';
  }).join('');
})();
</script>
</body>
</html>`;
}
