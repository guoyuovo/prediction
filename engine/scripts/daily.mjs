#!/usr/bin/env node
// 每日一条龙：赛前刷新输入 → 赛后按赛果迭代 → 重算 + 导出 App payload.json。
// 用法：node scripts/daily.mjs   或   npm run daily

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const HEALTH_FILE = join(DIR, '..', 'data', 'run-health.json');
const STEPS = [
  ['赛前·场地海拔(一次性)', 'fetch-elevation.mjs'],
  ['赛前·官方真实 Elo', 'fetch-elo-official.mjs'],
  ['赛前·FIFA 积分/身价', 'fetch-fifa-ranking.mjs'],
  ['赛前·阵容评分 squad', 'build-squad-ratings.mjs'],
  ['赛前·赔率 ESPN+Bovada', 'fetch-odds.mjs'],
  ['赛前·赔率 Titan007 多庄', 'fetch-titan007-odds.mjs'],
  ['赛前·天气', 'fetch-weather.mjs'],
  ['赛前·伤停探测(兜底)', 'fetch-injuries.mjs'],
  ['赛后·完赛比分+射门', 'fetch-results.mjs'],
  ['赛后·滚动 Elo + live 校准', 'build-elo-v2.mjs'],
  ['赛后·滚动 xG 攻防', 'build-xg-v2.mjs'],
  ['赛后·按赛果校准平局乘子(样本足够才生效)', 'calibrate-live.mjs'],
  ['重算·72 场批量预测', 'batch-predict.mjs'],
  ['赛后·专家方案(网易红彩)', 'fetch-hongcai.mjs'],
  ['赛后·比分盘(Bovada 国际盘)', 'fetch-bo-odds.mjs'],
  ['导出·主看板 JSON', 'build-html.mjs --json-only'],
  ['导出·搏·串关(娱乐)', 'build-bo.mjs'],
  ['导出·双模型 JSON', 'build-dual-page.mjs --json-only'],
  ['导出·App payload.json', 'build-app-payload.mjs'],
];

const t0 = Date.now();
const results = [];
console.log(`\n═══ 每日一条龙开始（${new Date().toISOString()}）═══\n`);
for (const [label, script] of STEPS) {
  process.stdout.write(`▶ ${label} …`);
  const s = Date.now();
  const sp = script.indexOf(' ');
  const file = sp >= 0 ? script.slice(0, sp) : script;
  const args = sp >= 0 ? script.slice(sp + 1) : '';
  try {
    execSync(`node "${join(DIR, file)}"${args ? ` ${args}` : ''}`, { stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(` ✓ (${((Date.now() - s) / 1000).toFixed(1)}s)`);
    results.push({ label, ok: true });
  } catch (e) {
    const msg = (e.stderr?.toString() || e.stdout?.toString() || e.message || '').trim().split('\n').pop();
    console.log(` ✗ ${msg}`);
    results.push({ label, ok: false, msg });
  }
  // 增量写健康度：最后的 build-app-payload 步骤会读它，把"哪几步失败"带进 payload.meta.health
  try {
    writeFileSync(HEALTH_FILE, JSON.stringify({
      at: new Date().toISOString(),
      failed: results.filter((r) => !r.ok).map((r) => r.label),
      ok: results.filter((r) => r.ok).length,
      total: STEPS.length,
    }));
  } catch { /* 写健康度失败不影响主流程 */ }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\n═══ 完成：${ok}/${results.length} 步成功 · 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s ═══`);
const failed = results.filter((r) => !r.ok);
if (failed.length) { console.log('失败步骤（不影响已成功部分）：'); for (const f of failed) console.log(`  ✗ ${f.label} — ${f.msg}`); }
console.log('App 数据：static/data/payload.json');
process.exit(failed.some((f) => /导出/.test(f.label)) ? 1 : 0);
