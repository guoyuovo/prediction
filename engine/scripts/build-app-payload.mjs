#!/usr/bin/env node
// 导出 uniapp 前端 payload.json（读 index-data.json + dual-data.json，零 HTML 依赖）。
// 用法：先 build-html --json-only + build-dual-page --json-only + fetch-hongcai，再 node scripts/build-app-payload.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const APP = process.env.APP_ROOT || join(ROOT, '..');
const OUT = join(APP, 'static/data');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/**
 * @param {string} jsonName
 * @param {string} htmlName
 * @returns {object}
 */
function readExport(jsonName, htmlName) {
  const jsonPath = join(ROOT, 'output', jsonName);
  if (existsSync(jsonPath)) {
    return JSON.parse(readFileSync(jsonPath, 'utf-8'));
  }
  const htmlPath = join(ROOT, 'output', htmlName);
  const html = readFileSync(htmlPath, 'utf-8');
  return JSON.parse(html.match(/<script id="data"[^>]*>([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
}

const idx = readExport('index-data.json', 'index.html');
const dual = readExport('dual-data.json', 'dual.html');
const experts = (() => { try { return loadJson('data/expert-plans.json'); } catch { return { plans: [] }; } })();

// 完赛场：合并 v2 赛前样本外预测
const comp = {};
for (const c of ((idx.v2 && idx.v2.completed) || [])) comp[`${c.home}|${c.away}`] = c;
for (const m of idx.matches) {
  if (m.result) {
    const c = comp[`${m.home}|${m.away}`];
    if (c) m.result.pre = { predOutcome: c.predOutcome, predScore: c.predScore, correct: c.correct, scoreHit: c.predScore === `${m.result.hs}-${m.result.as}`, p: [c.pHome, c.pDraw, c.pAway] };
  }
}

const DROP = ['move', 'feat', 't007m', 'maxP', 'homeAdv', 'odds', 'oddsSrc', 'egTotal', 'ouTrend'];
for (const m of idx.matches) for (const k of DROP) delete m[k];

const expertPlans = (experts.plans || []).filter((p) => p.unlocked && p.content && p.content.trim());

const payload = {
  meta: {
    date: idx.meta.date,
    iterations: idx.meta.iterations,
    teams: idx.meta.teams,
    dualSummary: dual.meta.summary,
    fetchedAt: dual.meta.fetchedAt,
    lastUpdate: new Date().toISOString(),
  },
  teams: { zh: idx.zh, profiles: idx.profiles, teams: idx.teams },
  champions: {
    champions: (idx.v2 && idx.v2.champions) || idx.champions,
    base: idx.champions,
    groups: (idx.v2 && idx.v2.groupTablesV2) || idx.groupTables,
  },
  matches: { matches: idx.matches },
  v2: idx.v2 || null,
  dual: {
    history: dual.history,
    future: dual.future,
    backtest: dual.backtest,
    tune: dual.tune,
    adjustments: dual.adjustments,
  },
  experts: { plans: expertPlans, total: expertPlans.length, fetchedAt: experts._fetchedAt },
};

const outPath = join(OUT, 'payload.json');
writeFileSync(outPath, JSON.stringify(payload));
console.log(`✓ payload.json → ${outPath} (${(JSON.stringify(payload).length / 1024).toFixed(1)}KB · ${idx.matches.length} 场 · ${expertPlans.length} 专家)`);
