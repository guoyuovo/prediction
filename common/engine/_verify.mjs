// 验证脚本：用真实输入喂浏览器端口 computePredictions，逐场对照 static/data/matches.json。
// 仅本文件允许用 node:fs（只读喂数据；端口本身不用 fs）。
// 运行：node common/engine/_verify.mjs （cwd = d:\test\prediction）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computePredictions } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');            // d:\test\prediction
const ENGINE = join(ROOT, 'engine');
const j = (p) => JSON.parse(readFileSync(p, 'utf-8'));

// —— 加载真实输入 ——
const data = {
  base: j(join(ENGINE, 'data', 'teams.json')),
  groups: j(join(ENGINE, 'data', 'groups.json')),
  schedule2026: j(join(ENGINE, 'data', 'schedule-2026.json')),
  modelCfg: j(join(ENGINE, 'config', 'model.json')),
  matchOdds: j(join(ENGINE, 'data', 'match-odds.json')),
  weather: j(join(ENGINE, 'data', 'weather.json')),
  venuesGeo: j(join(ENGINE, 'data', 'venues-geo.json')),
  teamXg: j(join(ENGINE, 'data', 'team-xg.json')),
  results: j(join(ENGINE, 'data', 'wc-results.json')),
};

const expected = j(join(ROOT, 'static', 'data', 'matches.json'));
const expMatches = Array.isArray(expected) ? expected : expected.matches;

// —— 计算 ——
const out = computePredictions(data);
const got = out.matches;

// —— 对照 ——
const TOL = 1e-6;
let pass = true;
let okCount = 0;
const mismatches = [];

if (got.length !== expMatches.length) {
  pass = false;
  mismatches.push({ seq: '-', field: 'count', expected: expMatches.length, got: got.length });
}

// 以 seq 对齐（两边都按赛程顺序，seq 0..71）
const gotBySeq = new Map(got.map((m) => [m.seq, m]));
for (const e of expMatches) {
  const g = gotBySeq.get(e.seq);
  if (!g) { pass = false; mismatches.push({ seq: e.seq, field: 'missing', expected: `${e.home} vs ${e.away}`, got: '(none)' }); continue; }

  let rowOk = true;
  const cmpF = (field, exp, gv) => {
    if (Math.abs(exp - gv) > TOL) { rowOk = false; mismatches.push({ seq: e.seq, m: `${e.home} vs ${e.away}`, field, expected: exp, got: gv }); }
  };
  cmpF('pHome(h)', e.h, g.pHome);
  cmpF('pDraw(d)', e.d, g.pDraw);
  cmpF('pAway(a)', e.a, g.pAway);
  if (e.score !== g.score) { rowOk = false; mismatches.push({ seq: e.seq, m: `${e.home} vs ${e.away}`, field: 'score', expected: e.score, got: g.score }); }
  if (e.pick !== g.pick) { rowOk = false; mismatches.push({ seq: e.seq, m: `${e.home} vs ${e.away}`, field: 'pick', expected: e.pick, got: g.pick }); }
  // eg 为 .toFixed(1) 字符串，附带核对（不计入硬失败，仅提示）
  const egGot = `${g.expGoals.home.toFixed(1)}-${g.expGoals.away.toFixed(1)}`;
  if (e.eg != null && e.eg !== egGot) { mismatches.push({ seq: e.seq, m: `${e.home} vs ${e.away}`, field: 'eg(warn)', expected: e.eg, got: egGot }); }

  // 对阵朝向核对
  if (e.home !== g.home || e.away !== g.away) { rowOk = false; mismatches.push({ seq: e.seq, field: 'fixture', expected: `${e.home} vs ${e.away}`, got: `${g.home} vs ${g.away}` }); }

  if (rowOk) okCount++; else pass = false;
}

// —— 输出 ——
console.log(`对照 ${expMatches.length} 场，硬字段(h/d/a/score/pick/fixture)全匹配：${okCount} 场`);
const hard = mismatches.filter((x) => !String(x.field).includes('warn'));
const warns = mismatches.filter((x) => String(x.field).includes('warn'));
if (hard.length) {
  console.log(`\n不匹配 (${hard.length})：`);
  for (const x of hard.slice(0, 50)) {
    console.log(`  seq ${x.seq} [${x.m || ''}] ${x.field}: expected=${JSON.stringify(x.expected)} got=${JSON.stringify(x.got)}`);
  }
  if (hard.length > 50) console.log(`  ...另有 ${hard.length - 50} 条`);
}
if (warns.length) {
  console.log(`\neg 提示性差异 (${warns.length})（不计入 PASS/FAIL）：`);
  for (const x of warns.slice(0, 20)) console.log(`  seq ${x.seq} [${x.m}] expected=${x.expected} got=${x.got}`);
}

// v2 摘要（若计算）
if (out.v2Backtest) {
  console.log(`\nv2 滚动 Elo：应用 ${out.v2Backtest.summary.matches} 场完赛 · 1X2 命中 ${(out.v2Backtest.summary.accuracy1X2 * 100).toFixed(0)}% · Brier ${out.v2Backtest.summary.brierAvg}`);
}

console.log(`\n${pass ? 'PASS' : 'FAIL'} — ${okCount}/${expMatches.length} 场硬字段匹配`);
process.exit(pass ? 0 : 1);
