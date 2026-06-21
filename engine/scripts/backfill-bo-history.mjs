#!/usr/bin/env node
// 一次性回填:从 static/data/payload.json 的 git 历史里,提取每个历史快照真实展示过的系统搏推荐,
//   按时间正序灌入 bo-history(firstSeen=该注首次出现的提交日),再用当前赛果统一结算。
//   —— 这些都是当时真实推荐过的注(非事后编造),只是过去未持久化;回填后即有真实战绩可查。
//   幂等:每次运行先清空 bo-history.json 重建。之后日常 build-bo 会继续增量累积。
// 用法:node scripts/backfill-bo-history.mjs

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../src/util.mjs';
import { archiveAndSettle } from '../src/bo-history.mjs';

const FILE = join(ROOT, 'data', 'bo-history.json');
const PAYLOAD = 'static/data/payload.json';
const SINCE = '91cc9a9'; // 「搏·串关」上线提交

// 1) 清空,从零重建
if (existsSync(FILE)) rmSync(FILE);

// 2) 取 payload.json 的全部历史提交(正序:旧→新),含提交日
const log = execSync(`git -C "${join(ROOT, '..')}" log --reverse --format=%H@%ad --date=short ${SINCE}..HEAD -- ${PAYLOAD}`, { encoding: 'utf-8' }).trim();
const commits = log ? log.split('\n').map((l) => { const [sha, date] = l.split('@'); return { sha, date }; }) : [];
console.log(`payload.json 历史提交:${commits.length} 个`);

const EMPTY = new Map(); // 回填阶段不结算,只存档(保证 firstSeen 取最早)
let ok = 0, withSys = 0;
for (const { sha, date } of commits) {
  let payload;
  try { payload = JSON.parse(execSync(`git -C "${join(ROOT, '..')}" show ${sha}:${PAYLOAD}`, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })); }
  catch { continue; }
  ok++;
  const system = payload.bo && payload.bo.system;
  if (!system) continue;
  // 仅保留结构完整的注(legKeys/legs/tier),交给与线上同一套 archiveAndSettle
  const clean = {};
  for (const risk of Object.keys(system)) {
    const s = system[risk] || {};
    const f = (arr) => (arr || []).filter((p) => p.legKeys && p.legs && p.tier);
    clean[risk] = { singles: f(s.singles), parlays: f(s.parlays) };
  }
  archiveAndSettle(clean, EMPTY, date);
  withSys++;
}
console.log(`成功读取 ${ok} 版,含系统注 ${withSys} 版`);

// 3) 用当前赛果统一结算(传空 system → 只结算已存档的待结算注)
const idx = JSON.parse(readFileSync(join(ROOT, 'output', 'index-data.json'), 'utf-8'));
const resultsIndex = new Map();
for (const m of idx.matches) if (m.result && m.result.hs != null) resultsIndex.set(`${m.home} vs ${m.away}`, { hs: m.result.hs, as: m.result.as });
const today = new Date().toISOString().slice(0, 10);
const out = archiveAndSettle({}, resultsIndex, today);

const o = out.summary.overall;
console.log(`\n✓ 回填完成:共 ${o.total} 注 · 已结算 ${o.settled}(中 ${o.win}/负 ${o.lose}) · 待开 ${o.pending} · 总命中率 ${o.winRate != null ? (o.winRate * 100).toFixed(1) + '%' : '—'}`);
console.log(`  稳搏:命中率 ${pctOf(out.summary.byRisk.steady)} ROI ${roiOf(out.summary.byRisk.steady)} | 激进:命中率 ${pctOf(out.summary.byRisk.aggressive)} ROI ${roiOf(out.summary.byRisk.aggressive)}`);
console.log('  下一步:重跑 build-bo.mjs + build-app-payload.mjs 让 payload 带上回填后的历史。');

function pctOf(a) { return a.winRate != null ? (a.winRate * 100).toFixed(1) + '%' : '—'; }
function roiOf(a) { return a.roi != null ? (a.roi > 0 ? '+' : '') + (a.roi * 100).toFixed(0) + '%' : '—'; }
