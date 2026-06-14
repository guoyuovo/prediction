#!/usr/bin/env node
// 导出 uniapp 前端所需的真实数据 JSON → <App根>/static/data/*.json
//   复用已验证的 output/index.html、output/dual.html 内嵌数据 + data/expert-plans.json，
//   拆成按页面组织的干净 JSON，前端 bundled 直读（零云端依赖即可测）。
//   engine/ 作为 App 子目录：App 根 = ROOT/..（ROOT=engine/）。可用 APP_ROOT 覆盖。
// 用法：先 build-html + build-dual-page + fetch-hongcai，再 node scripts/build-app-payload.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const APP = process.env.APP_ROOT || join(ROOT, '..');
const OUT = join(APP, 'static/data');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const extract = (html) => JSON.parse(html.match(/<script id="data"[^>]*>([\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
const idx = extract(readFileSync(join(ROOT, 'output', 'index.html'), 'utf-8'));
const dual = extract(readFileSync(join(ROOT, 'output', 'dual.html'), 'utf-8'));
const experts = (() => { try { return loadJson('data/expert-plans.json'); } catch { return { plans: [] }; } })();

const write = (name, obj) => { writeFileSync(join(OUT, name), JSON.stringify(obj)); console.log(`  ✓ ${name} (${(JSON.stringify(obj).length / 1024).toFixed(1)}KB)`); };

console.log('导出前端数据 → ' + OUT);
// 元信息
write('meta.json', {
  date: idx.meta.date, iterations: idx.meta.iterations, teams: idx.meta.teams,
  dualSummary: dual.meta.summary, fetchedAt: dual.meta.fetchedAt,
  lastUpdate: new Date().toISOString(),
});
// 中文名 + 球队档案 + 实力
write('teams.json', { zh: idx.zh, profiles: idx.profiles, teams: idx.teams });
// 夺冠 + 分组（用 v2 更新版，回退基础）
write('champions.json', {
  champions: (idx.v2 && idx.v2.champions) || idx.champions,
  base: idx.champions,
  groups: (idx.v2 && idx.v2.groupTablesV2) || idx.groupTables,
});
// 72 场对阵（含 base 预测、子模型、赔率、天气、海拔、伤停、结果）
// 完赛场：把「赛前样本外预测 vs 实际」合并进 result.pre（来自 v2.completed）
const comp = {}; for (const c of ((idx.v2 && idx.v2.completed) || [])) comp[`${c.home}|${c.away}`] = c;
for (const m of idx.matches) {
  if (m.result) {
    const c = comp[`${m.home}|${m.away}`];
    if (c) m.result.pre = { predOutcome: c.predOutcome, predScore: c.predScore, correct: c.correct, scoreHit: c.predScore === `${m.result.hs}-${m.result.as}`, p: [c.pHome, c.pDraw, c.pAway] };
  }
}
write('matches.json', { matches: idx.matches });
// v2 完赛验证（夺冠Δ/出线Δ/校准/时间线/对账/Elo变化/受影响后续）
write('v2.json', idx.v2 || null);
// 双模型（历史 + 未来 + 回测 + 调参 + 伤停调整）
write('dual.json', {
  history: dual.history, future: dual.future,
  backtest: dual.backtest, tune: dual.tune, adjustments: dual.adjustments,
});
// 专家方案
write('experts.json', { plans: experts.plans || [], total: experts.total || 0, fetchedAt: experts._fetchedAt });

// 合并 payload → co-data 云对象目录（部署即可一次返回全部；后续 compute 可改写 DB）
const CO = join(APP, 'uniCloud-aliyun/cloudfunctions/co-data');
const payload = {
  meta: { date: idx.meta.date, iterations: idx.meta.iterations, teams: idx.meta.teams, dualSummary: dual.meta.summary, fetchedAt: dual.meta.fetchedAt, lastUpdate: new Date().toISOString() },
  teams: { zh: idx.zh, profiles: idx.profiles, teams: idx.teams },
  champions: { champions: (idx.v2 && idx.v2.champions) || idx.champions, base: idx.champions, groups: (idx.v2 && idx.v2.groupTablesV2) || idx.groupTables },
  matches: { matches: idx.matches },
  v2: idx.v2 || null,
  dual: { history: dual.history, future: dual.future, backtest: dual.backtest, tune: dual.tune, adjustments: dual.adjustments },
  experts: { plans: experts.plans || [], total: experts.total || 0, fetchedAt: experts._fetchedAt },
};
if (existsSync(CO)) { writeFileSync(join(CO, 'payload.json'), JSON.stringify(payload)); console.log('  ✓ co-data/payload.json'); }

// 可选：推送到 uniCloud put-payload，写入 wc_payload（本地跑完自动上云）。
//   配环境变量 PUT_PAYLOAD_URL(put-payload 的 URL 化地址) + PUT_SECRET(与云函数一致)即生效。
if (process.env.PUT_PAYLOAD_URL && process.env.PUT_SECRET) {
  try {
    const res = await fetch(process.env.PUT_PAYLOAD_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: process.env.PUT_SECRET, payload }),
    });
    console.log(`  ✓ 推送 put-payload → wc_payload (HTTP ${res.status})`);
  } catch (e) { console.log(`  ⚠ 推送 put-payload 失败(忽略，本地数据已生成)：${e.message}`); }
}

console.log(`✓ 导出完成（${idx.matches.length} 场 · ${(idx.v2 && idx.v2.champions || idx.champions).length} 队 · ${(experts.plans || []).length} 专家方案）`);
