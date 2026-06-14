#!/usr/bin/env node
// 批量预测：72 场小组赛，按真实赛程（北京时间）顺序输出
// 输出 output/match-predictions-2026.csv

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { predictMatch } from '../src/model.mjs';
import { buildSchedule } from '../src/schedule.mjs';
import { zh } from '../src/names.mjs';
import { ROOT, pct } from '../src/util.mjs';

const schedule = buildSchedule();

const rows = [[
  'kickoff_bj', 'weekday', 'round', 'group',
  'home', 'away', 'home_zh', 'away_zh',
  'p_home', 'p_draw', 'p_away', 'pick', 'top_score', 'exp_goals',
]];

console.log('批量预测 72 场小组赛（按北京时间排序）...\n');
let lastDate = '';
for (const s of schedule) {
  const p = predictMatch(s.home, s.away, { neutral: true });
  const pick = p.pHome >= p.pDraw && p.pHome >= p.pAway ? 'H' : p.pAway >= p.pDraw ? 'A' : 'D';
  rows.push([
    s.kickoff, s.weekday, `R${s.round}`, s.group,
    p.home, p.away, zh(p.home), zh(p.away),
    p.pHome.toFixed(4), p.pDraw.toFixed(4), p.pAway.toFixed(4),
    pick, p.score,
    `${p.expGoals.home.toFixed(2)}-${p.expGoals.away.toFixed(2)}`,
  ]);
  if (s.date !== lastDate) {
    console.log(`\n── ${s.date} ${s.weekday} ──`);
    lastDate = s.date;
  }
  console.log(
    `  ${s.time}  组${s.group}  ${(zh(p.home) + ' ' + p.home).padEnd(22)} ` +
    `${pct(p.pHome).padStart(6)}|${pct(p.pDraw).padStart(6)}|${pct(p.pAway).padStart(6)}  ${zh(p.away)} ${p.away}`
  );
}

const csv = rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c}"` : c)).join(',')).join('\n');
const outPath = join(ROOT, 'output', 'match-predictions-2026.csv');
// 加 BOM 以便 Excel 正确识别 UTF-8 中文
writeFileSync(outPath, '﻿' + csv, 'utf-8');
console.log(`\n✓ 共 ${schedule.length} 场，已写入 ${outPath}`);
