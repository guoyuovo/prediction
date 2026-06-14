#!/usr/bin/env node
// 从公开的国际比赛全历史数据集计算真实 Elo + 近期状态 + 近期攻防（xG 代理锚定）
//   数据集：martj42/international_results（CC0，约 4.9 万场，1872→今）
//   方法：标准 World Football Elo（eloratings.net 同款）
//     E_A = 1/(1+10^((R_B - R_A + 主场)/400))，初始 1500
//     R' = R + K·(W - E)，K 按赛事重要性 × 净胜球修正
//     主场优势：非中立场 +100；世界杯 K0=60、洲际赛/联赛=50、预选赛=40、其他=30、友谊=20
//
// 数据准备（任选）：
//   node scripts/fetch-data.mjs          # 自动下载 results.csv 到 data/
//   或手动下载 results.csv 放到 data/
// 运行：node scripts/build-elo.mjs
//   → 更新 data/teams.json 的 elo/form，data/team-xg.json 的 att/def

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const CSV = join(ROOT, 'data', 'results.csv');
if (!existsSync(CSV)) {
  console.error('✗ 缺少 data/results.csv，请先运行：node scripts/fetch-data.mjs');
  process.exit(1);
}

// 数据集队名 → 本项目队名（仅列出不一致的）
const ALIAS = {
  'United States': 'USA',
  'Ivory Coast': "Cote d'Ivoire",
  'Bosnia and Herzegovina': 'Bosnia',
  'Czech Republic': 'Czechia',
  'Curaçao': 'Curacao',
};
const norm = (n) => ALIAS[n] || n;

// 赛事重要性 → K0
function kBase(t) {
  const s = t.toLowerCase();
  if (s === 'friendly') return 20;
  if (s.includes('world cup')) return s.includes('qualif') ? 40 : 60;
  if (s.includes('qualif')) return 40;
  if (s.includes('euro') || s.includes('copa am') || s.includes('cup of nations') ||
      s.includes('asian cup') || s.includes('gold cup') || s.includes('confederations') ||
      s.includes('nations league') || s.includes('finals')) return 50;
  return 30;
}

// 净胜球修正系数（eloratings.net）
function gdMult(gd) {
  if (gd <= 1) return 1;
  if (gd === 2) return 1.5;
  if (gd === 3) return 1.75;
  return 1.75 + (gd - 3) / 8;
}

// 简易 CSV 行解析（处理引号内逗号，如 "Washington, D.C."）
function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

console.log('读取 data/results.csv ...');
const lines = readFileSync(CSV, 'utf8').split('\n');
const elo = new Map();
const get = (t) => (elo.has(t) ? elo.get(t) : 1500);

// 每队最近比赛记录（用于 form 与攻防）。opp 用于攻防的对手强度调整。
const history = new Map(); // team -> [{gf, ga, res, opp}]
function pushHist(team, gf, ga, res, opp) {
  if (!history.has(team)) history.set(team, []);
  history.get(team).push({ gf, ga, res, opp });
}

let played = 0;
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = parseLine(lines[i]);
  const [date, hRaw, aRaw, hs, as, tour] = c;
  const neutral = (c[c.length - 1] || '').trim().toUpperCase() === 'TRUE';
  if (hs === 'NA' || as === 'NA' || hs === '' || as === '') continue; // 跳过未来比赛
  const gh = parseInt(hs, 10), ga = parseInt(as, 10);
  if (Number.isNaN(gh) || Number.isNaN(ga)) continue;

  const home = norm(hRaw), away = norm(aRaw);
  const Rh = get(home), Ra = get(away);

  const dr = Rh - Ra + (neutral ? 0 : 100); // 主场优势 +100
  const We = 1 / (Math.pow(10, -dr / 400) + 1);
  const W = gh > ga ? 1 : gh === ga ? 0.5 : 0;
  const K = kBase(tour) * gdMult(Math.abs(gh - ga));

  elo.set(home, Rh + K * (W - We));
  elo.set(away, Ra + K * ((1 - W) - (1 - We)));

  pushHist(home, gh, ga, gh > ga ? 1 : gh === ga ? 0 : -1, away);
  pushHist(away, ga, gh, ga > gh ? 1 : gh === ga ? 0 : -1, home);
  played++;
}
console.log(`处理 ${played} 场已完赛比赛，覆盖 ${elo.size} 支球队/地区`);

// 近期状态：最近 10 场加权（越近权重越高），归一到 -1..1
function calcForm(team) {
  const h = (history.get(team) || []).slice(-10);
  if (!h.length) return 0;
  let num = 0, den = 0;
  h.forEach((m, i) => { const w = i + 1; num += w * m.res; den += w; });
  return +(num / den).toFixed(3);
}
// 近期攻防（xG 代理）：对手强度调整的真实近期进/失球 + Elo 锚定
// 思路：用真实最近 20 场的进/失球，但按「对手真实 Elo 的攻防强度」折算——
//   打防守强的对手进球更值钱、被进攻弱的对手破门更扣分——消除小国暴打地区鱼腩的虚高。
//   再与 Elo 锚定按 W_REAL 混合（W_REAL=0.5 在原文12场比分上最优，且较旧版多一份真实占比）。
// 真 xG（射门质量级）国家队无免费数据，这是行业上限（文章 5.4 同款局限）。
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const LEAGUE_AVG = 1.3;
const W_REAL = 0.5; // 真实进球占比；(1-W_REAL) 为 Elo 锚定
function eloImplied(elo) {
  const t = (elo - 1500) / 600; // 1500→0, 2100→1
  return { att: clamp(1.05 + t * 0.95, 0.7, 2.2), def: clamp(1.45 - t * 0.8, 0.55, 1.85) };
}
function calcAttDef(team) {
  const ei = eloImplied(get(team));
  const h = (history.get(team) || []).slice(-20);
  if (h.length < 5) return { att: +ei.att.toFixed(2), def: +ei.def.toFixed(2) }; // 样本太少，用 Elo 锚定
  let aSum = 0, dSum = 0;
  for (const m of h) {
    const oe = eloImplied(get(m.opp));
    aSum += m.gf * (LEAGUE_AVG / Math.max(oe.def, 0.4)); // 对手防强 → 进球加权
    dSum += m.ga * (LEAGUE_AVG / Math.max(oe.att, 0.4)); // 对手攻弱 → 失球加权
  }
  const realAtt = aSum / h.length, realDef = dSum / h.length;
  const att = clamp(W_REAL * realAtt + (1 - W_REAL) * ei.att, 0.7, 2.4);
  const def = clamp(W_REAL * realDef + (1 - W_REAL) * ei.def, 0.5, 2.0);
  return { att: +att.toFixed(2), def: +def.toFixed(2) };
}

// 写回 teams.json（elo/form）与 team-xg.json（att/def）
const teamsFile = loadJson('data/teams.json');
const xgFile = loadJson('data/team-xg.json');
const ourTeams = Object.keys(teamsFile.teams);

let missing = [];
for (const t of ourTeams) {
  if (!history.has(t)) { missing.push(t); continue; }
  teamsFile.teams[t].elo = Math.round(get(t));
  teamsFile.teams[t].form = calcForm(t);
  delete teamsFile.teams[t]._est;
  const ad = calcAttDef(t);
  if (ad && xgFile.teams[t]) { xgFile.teams[t].att = ad.att; xgFile.teams[t].def = ad.def; }
}

teamsFile._note = '2026 世界杯 48 强。elo/form 由 scripts/build-elo.mjs 从国际比赛全历史数据集（martj42/international_results, ~4.9万场）按标准 Elo 公式计算所得（真实）。fifa/value 为档案近似值（当前集成模型未直接使用）。';
teamsFile._builtAt = new Date().toISOString();
xgFile._note = 'xG 攻防代理。att/def = 0.5·(对手强度调整的真实近20场进/失球) + 0.5·(Elo 锚定)。真实进球按对手 Elo 攻防折算以消除鱼腩刷分。非 StatsBomb 射门级 xG（国家队无免费源，行业上限）。';

writeFileSync(join(ROOT, 'data', 'teams.json'), JSON.stringify(teamsFile, null, 2), 'utf-8');
writeFileSync(join(ROOT, 'data', 'team-xg.json'), JSON.stringify(xgFile, null, 2), 'utf-8');

// 打印 Top 12 核对
const ranked = ourTeams.filter((t) => history.has(t)).sort((a, b) => get(b) - get(a));
console.log('\n计算所得 Elo TOP 12：');
ranked.slice(0, 12).forEach((t, i) => {
  console.log(`  ${String(i + 1).padStart(2)}  ${t.padEnd(16)} Elo ${Math.round(get(t))}  form ${calcForm(t).toFixed(2)}`);
});
if (missing.length) console.log(`\n⚠ 数据集中未找到（保留原值）：${missing.join(', ')}`);
console.log('\n✓ 已更新 data/teams.json 与 data/team-xg.json');
console.log('  下一步：node scripts/batch-predict.mjs ; node scripts/build-html.mjs');
