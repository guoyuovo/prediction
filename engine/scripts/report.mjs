#!/usr/bin/env node
// 报告生成：综合批量预测 + 蒙特卡洛模拟，输出 Markdown 主报告
// 用法: node scripts/report.mjs [--iterations 20000]
// 输出 output/world-cup-2026-report.md

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { predictMatch } from '../src/model.mjs';
import { runMonteCarlo } from '../src/tournament.mjs';
import { loadJson, ROOT, pct } from '../src/util.mjs';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const groups = loadJson('data/groups.json').groups;
const cfg = loadJson('config/model.json');
const oddsMeta = loadJson('data/match-odds.json').meta || {};
const iterations = parseInt(arg('iterations', String(cfg.mc.iterations)), 10);

console.log(`生成报告（含 ${iterations.toLocaleString()} 次模拟）...`);
const sim = runMonteCarlo(iterations);

// 收集所有小组赛预测
const matches = [];
for (const [g, teams] of Object.entries(groups)) {
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const p = predictMatch(teams[i], teams[j], { neutral: true });
      const maxP = Math.max(p.pHome, p.pDraw, p.pAway);
      matches.push({ g, p, maxP });
    }
  }
}

const surest = [...matches].sort((a, b) => b.maxP - a.maxP).slice(0, 8);
const closest = [...matches].sort((a, b) => a.maxP - b.maxP).slice(0, 8);

const L = [];
L.push('# 2026 世界杯预测报告');
L.push('');
L.push(`- 模型版本：\`${cfg.version}\``);
L.push(`- 生成日期：2026-06-12`);
L.push(`- 蒙特卡洛迭代：${iterations.toLocaleString()} 次`);
L.push('- 数据：真实 Elo(eloratings官方) / FIFA(官方实时) / 身价(Transfermarkt) / 状态 / 阵容评分；赔率优先 Titan007 多庄共识');
L.push('');
L.push('> 免责声明：基于统计模型与历史数据，仅供娱乐参考，不是理财建议。购彩有节制，理性投注，量力而行。');
L.push('');

L.push('## 一、夺冠概率 TOP 10');
L.push('');
L.push('| 排名 | 球队 | 进32强 | 进8强 | 进4强 | 进决赛 | 夺冠 |');
L.push('| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
sim.results.slice(0, 10).forEach((r, i) => {
  L.push(`| ${i + 1} | ${r.team} | ${pct(r.r32)} | ${pct(r.qf)} | ${pct(r.sf)} | ${pct(r.final)} | ${pct(r.champion)} |`);
});
L.push('');
const champ = sim.results[0];
L.push(`**${champ.team}** 领跑，夺冠概率 ${pct(champ.champion)}。`);
L.push('');

L.push('## 二、最稳热门（单场最高胜率）');
L.push('');
L.push('| 比赛 | 预测 | 主胜 | 平 | 客胜 | 最可能比分 |');
L.push('| --- | --- | ---: | ---: | ---: | --- |');
surest.forEach(({ p }) => {
  const pick = p.pHome >= p.pAway ? `${p.home} 胜` : `${p.away} 胜`;
  L.push(`| ${p.home} vs ${p.away} | ${pick} | ${pct(p.pHome)} | ${pct(p.pDraw)} | ${pct(p.pAway)} | ${p.score} |`);
});
L.push('');

L.push('## 三、最高爆冷风险（三态最接近）');
L.push('');
L.push('| 比赛 | 主胜 | 平 | 客胜 | 不确定性 |');
L.push('| --- | ---: | ---: | ---: | --- |');
closest.forEach(({ p, maxP }) => {
  L.push(`| ${p.home} vs ${p.away} | ${pct(p.pHome)} | ${pct(p.pDraw)} | ${pct(p.pAway)} | 最高仅 ${pct(maxP)} |`);
});
L.push('');

L.push('## 四、分组出线概率');
L.push('');
for (const [g, teams] of Object.entries(groups)) {
  L.push(`**组 ${g}**`);
  L.push('');
  L.push('| 球队 | 进32强 | 进8强 | 夺冠 |');
  L.push('| --- | ---: | ---: | ---: |');
  const rows = teams
    .map((t) => sim.results.find((r) => r.team === t))
    .sort((a, b) => b.r32 - a.r32);
  rows.forEach((r) => L.push(`| ${r.team} | ${pct(r.r32)} | ${pct(r.qf)} | ${pct(r.champion)} |`));
  L.push('');
}

// 市场情绪（Titan007 多庄共识）
const t007Rows = Object.entries(oddsMeta).filter(([, m]) => m.titan007 && m.titan007Market);
if (t007Rows.length) {
  L.push('## 五、市场情绪（Titan007 多庄共识）');
  L.push('');
  L.push(`覆盖 ${t007Rows.length} 场。共识=上百家庄即时欧赔均值（已优先喂模型）；异动=开盘→即时去水位主胜概率漂移（钱往哪边走）；大小球=Titan007 共识盘口倾向。`);
  L.push('');
  L.push('| 对阵 | Titan007共识(主/平/客) | 庄家数 | 欧赔异动信号 | 大小球 |');
  L.push('| --- | --- | ---: | --- | --- |');
  for (const [k, m] of t007Rows) {
    const t = m.titan007, mv = m.titan007Market.move, ou = m.titan007Market.ou;
    const sig = mv ? `${mv.signal >= 0 ? '+' : ''}${mv.signal} ${mv.lean}` : '—';
    const ouS = ou ? `${ou.line} 倾向${ou.lean}` : '—';
    L.push(`| ${k} | ${t.map((x) => x.toFixed(2)).join(' / ')} | ${m.titan007Companies || '?'} | ${sig} | ${ouS} |`);
  }
  L.push('');
}

L.push('---');
L.push('');
L.push('生成方式：`node scripts/report.mjs`。模型方法见 README 与 `config/model.json`。');

const md = L.join('\n');
const outPath = join(ROOT, 'output', 'world-cup-2026-report.md');
writeFileSync(outPath, md, 'utf-8');
console.log(`✓ 报告已写入 ${outPath}`);
