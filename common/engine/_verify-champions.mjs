// 验证脚本：用真实输入喂浏览器端口 computeChampions，对照 static/data/champions.json。
// 仅本文件允许用 node:fs（只读喂数据；端口本身不用 fs）。
// 运行：node common/engine/_verify-champions.mjs （cwd = d:\test\prediction）

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeChampions } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');            // d:\test\prediction
const ENGINE = join(ROOT, 'engine');
const j = (p) => JSON.parse(readFileSync(p, 'utf-8'));

// —— 加载真实输入（与 build-html 一致；含 squad-adjustments 供 v2 临场惩罚）——
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
  squadAdj: j(join(ENGINE, 'data', 'manual', 'squad-adjustments.json')),
};

const expected = j(join(ROOT, 'static', 'data', 'champions.json'));
const expChamps = expected.champions;
const expByTeam = new Map(expChamps.map((c) => [c.team, c]));

// —— 计算（默认 iterations = cfg.mc.iterations = 10000，seed/sigma 与 build-html 一致）——
const out = computeChampions(data);
const got = out.champions;
const gotByTeam = new Map(got.map((c) => [c.team, c]));

// —— 对照夺冠概率（核心成功判据）+ 各轮次概率（提示）——
const TOL = 0.01; // 夺冠概率绝对容差
let pass = true;
let teamCount = 0;
let maxDiffChamp = 0, maxDiffTeam = '';
let maxDiffBase = 0, maxDiffBaseTeam = '';
const fields = ['r32', 'qf', 'sf', 'final', 'champion'];
const maxDiffByField = Object.fromEntries(fields.map((f) => [f, 0]));
const violations = [];

if (got.length !== expChamps.length) {
  pass = false;
  console.log(`队伍数不一致：expected=${expChamps.length} got=${got.length}`);
}

for (const e of expChamps) {
  const g = gotByTeam.get(e.team);
  if (!g) { pass = false; violations.push(`缺少球队 ${e.team}`); continue; }
  teamCount++;

  for (const f of fields) {
    const d = Math.abs((e[f] ?? 0) - (g[f] ?? 0));
    if (d > maxDiffByField[f]) maxDiffByField[f] = d;
  }
  const dC = Math.abs(e.champion - g.champion);
  if (dC > maxDiffChamp) { maxDiffChamp = dC; maxDiffTeam = e.team; }
  if (dC > TOL) { pass = false; violations.push(`${e.team}: champion expected=${e.champion} got=${g.champion.toFixed(4)} |Δ|=${dC.toFixed(4)}`); }

  const dB = Math.abs((e.baseChampion ?? 0) - (g.baseChampion ?? 0));
  if (dB > maxDiffBase) { maxDiffBase = dB; maxDiffBaseTeam = e.team; }
}

// —— 输出 ——
console.log(`对照 ${expChamps.length} 队夺冠概率，容差 ${TOL}（绝对）`);
console.log(`各轮次最大绝对差：` + fields.map((f) => `${f} ${maxDiffByField[f].toFixed(4)}`).join(' · '));
console.log(`v2 夺冠概率 max|Δ| = ${maxDiffChamp.toFixed(4)}  (@${maxDiffTeam})`);
console.log(`base 夺冠概率 max|Δ| = ${maxDiffBase.toFixed(4)}  (@${maxDiffBaseTeam})`);

if (violations.length) {
  console.log(`\n超出容差 (${violations.length})：`);
  for (const v of violations.slice(0, 50)) console.log('  ' + v);
}

console.log(`\n${pass ? 'PASS' : 'FAIL'} — champions 夺冠概率 ${pass ? '全部' : '未全部'}落在 ±${TOL} 内（max|Δ|=${maxDiffChamp.toFixed(4)}）`);
process.exit(pass ? 0 : 1);
