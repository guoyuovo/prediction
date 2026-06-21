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
  const lc = payload.bo && payload.bo.legCandidates;
  if (!Array.isArray(lc) || !lc.length) continue;
  // 只保留结构完整的候选腿(play/home/away/rec/options),交给与线上同一套 archiveAndSettle
  const clean = lc.filter((c) => c.play && c.home && c.away && c.rec && Array.isArray(c.options));
  if (!clean.length) continue;
  archiveAndSettle(clean, EMPTY, date);
  withSys++;
}
console.log(`成功读取 ${ok} 版,含候选腿 ${withSys} 版`);

// 3) 用当前赛果统一结算(传空 legCandidates → 只结算已存档的待结算单)
const idx = JSON.parse(readFileSync(join(ROOT, 'output', 'index-data.json'), 'utf-8'));
const resultsIndex = new Map();
for (const m of idx.matches) if (m.result && m.result.hs != null) resultsIndex.set(`${m.home} vs ${m.away}`, { hs: m.result.hs, as: m.result.as, ht: m.result.ht });
const today = new Date().toISOString().slice(0, 10);
const out = archiveAndSettle([], resultsIndex, today);

const o = out.overall;
const byPlay = {};
for (const it of out.items) { const k = it.play; (byPlay[k] ||= { s: 0, w: 0 }); if (it.status !== 'pending') { byPlay[k].s++; if (it.status === 'win') byPlay[k].w++; } }
console.log(`\n✓ 回填完成:共 ${o.total} 单 · 已结算 ${o.settled}(中 ${o.win}/负 ${o.lose}) · 待开 ${o.pending} · 总命中率 ${o.winRate != null ? (o.winRate * 100).toFixed(1) + '%' : '—'}`);
for (const [k, v] of Object.entries(byPlay)) console.log(`  ${k}: 已结算 ${v.s} 命中 ${v.w}${v.s ? ' (' + (v.w / v.s * 100).toFixed(0) + '%)' : ''}`);
console.log('  下一步:重跑 build-bo.mjs + build-app-payload.mjs 让 payload 带上回填后的历史。');
