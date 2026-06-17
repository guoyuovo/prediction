#!/usr/bin/env node
// 导出 uniapp 前端 payload.json（读 index-data.json + dual-data.json，零 HTML 依赖）。
// 用法：先 build-html --json-only + build-dual-page --json-only + fetch-hongcai，再 node scripts/build-app-payload.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const health = (() => { try { return loadJson('data/run-health.json'); } catch { return null; } })();
// "搏·串关"(娱乐):缺失则降级为 null,前端不渲染该板块
const bo = (() => { try { return JSON.parse(readFileSync(join(ROOT, 'output', 'bo-data.json'), 'utf-8')); } catch { return null; } })();
// 竞彩官方盘口(胜平负/让球/比分),按 jcNum(如"周三021")索引,供专家方案展示全盘 + 高亮选中
const jcByNum = (() => {
  try {
    const j = loadJson('data/jingcai-crs.json').matches; const map = {};
    for (const v of Object.values(j)) if (v.matchNum) map[v.matchNum] = { had: v.had, hhad: v.hhad, cs: (v.cs || []).filter((c) => /^\d+-\d+$/.test(c.score)).slice(0, 14), csVigPct: Math.round((v.csOverround - 1) * 100) };
    return map;
  } catch { return {}; }
})();

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

const expertPlans = (experts.plans || []).filter((p) => p.unlocked && p.content && p.content.trim())
  .map((p) => (p.jcNum && jcByNum[p.jcNum]) ? { ...p, markets: jcByNum[p.jcNum] } : p); // 挂竞彩全盘口(有则)

const lastUpdate = new Date().toISOString();
const payload = {
  meta: {
    date: idx.meta.date,
    iterations: idx.meta.iterations,
    teams: idx.meta.teams,
    dualSummary: dual.meta.summary,
    fetchedAt: dual.meta.fetchedAt,
    lastUpdate,
    health: health ? { failed: health.failed || [], at: health.at } : null,
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
  bo,
};

const payloadStr = JSON.stringify(payload);

// 内容寻址：文件名随内容(hash)变化。新内容 = 新路径，jsDelivr 对没见过的路径必然回源，
// 绕开 @master 的「分支→commit 解析缓存」和 12h 边缘缓存——这是「刷新仍拿到旧数据」的根治点。
// 相同内容在 git 里只存一份 blob，不会撑大仓库历史。
const hash = createHash('sha256').update(payloadStr).digest('hex').slice(0, 12);
const hashedName = `payload.${hash}.json`;

// 清理上一版的 hash 文件，工作区只保留「稳定名 + 当前 hash」两份
for (const f of readdirSync(OUT)) {
  if (/^payload\.[0-9a-f]{12}\.json$/.test(f) && f !== hashedName) rmSync(join(OUT, f));
}

// 稳定名：供 App 打包内置(import)、向后兼容、以及拉不到指针时的兜底
writeFileSync(join(OUT, 'payload.json'), payloadStr);
// 内容寻址版本：App 经 version.json 指针拉取，保证「拿到的就是这一版」
writeFileSync(join(OUT, hashedName), payloadStr);
// 小指针(~120B)：只有它是可变名，App 先拉它(带 cache-buster)再按 file 拉不可变的 payload
writeFileSync(join(OUT, 'version.json'), JSON.stringify({ file: hashedName, lastUpdate, fetchedAt: dual.meta.fetchedAt }));

console.log(`✓ payload.json + ${hashedName} + version.json → ${OUT} (${(payloadStr.length / 1024).toFixed(1)}KB · ${idx.matches.length} 场 · ${expertPlans.length} 专家)`);
