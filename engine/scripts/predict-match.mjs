#!/usr/bin/env node
// 单场比赛预测引擎（多因子加权集成：Elo 35% · xG 25% · 市场赔率 20%，按可用性归一）
// 用法:
//   node scripts/predict-match.mjs --home France --away Senegal
//   node scripts/predict-match.mjs --home Mexico --away "South Africa"
//   node scripts/predict-match.mjs --home Spain --away Uruguay --neutral false   # 显式主场+100
//   node scripts/predict-match.mjs --list

import { predictMatch, listTeams } from '../src/model.mjs';
import { zh } from '../src/names.mjs';
import { pct } from '../src/util.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  console.log('可用球队（共 ' + listTeams().length + ' 支）:');
  console.log(listTeams().sort().map((t) => `${zh(t)}(${t})`).join(' · '));
  process.exit(0);
}

if (!args.home || !args.away) {
  console.error('用法: node scripts/predict-match.mjs --home <主队> --away <客队> [--neutral false]');
  process.exit(1);
}

const opts = {};
if (args.neutral === 'false') opts.neutral = false;
const p = predictMatch(args.home, args.away, opts);

const fav =
  p.pHome >= p.pDraw && p.pHome >= p.pAway ? `${zh(p.home)} 胜` :
  p.pAway >= p.pDraw ? `${zh(p.away)} 胜` : '平局';

const f3 = (m) => `${pct(m.h)}/${pct(m.d)}/${pct(m.a)}`;

console.log('');
console.log(`  ${zh(p.home)} (${p.home})  vs  ${zh(p.away)} (${p.away})`);
console.log('  ' + '─'.repeat(52));
console.log(`  集成预测   主胜 ${pct(p.pHome).padStart(6)}   平局 ${pct(p.pDraw).padStart(6)}   客胜 ${pct(p.pAway).padStart(6)}`);
console.log(`  最可能结果: ${fav}`);
console.log('');
console.log('  子模型明细（胜/平/负）:');
console.log(`    特征模型      ${f3(p.sub.base)}   (Elo差 ${p.eloDiff >= 0 ? '+' : ''}${Math.round(p.eloDiff)})`);
if (p.sub.market) {
  console.log(`    去水位赔率    ${f3(p.sub.market)}   (赔率 ${p.sub.market.odds.join('/')}, 融合权重 0.35)`);
} else {
  console.log('    去水位赔率    无赔率数据，未融合');
}
const ft = p.features;
console.log(`  特征贡献      Elo ${ft.elo.toFixed(2)} · FIFA ${ft.fifa.toFixed(2)} · 身价 ${ft.value.toFixed(2)} · 状态 ${ft.form.toFixed(2)} · 阵容 ${ft.squad.toFixed(2)}`);
console.log('');
console.log(`  预期进球    ${p.expGoals.home.toFixed(2)} - ${p.expGoals.away.toFixed(2)}`);
console.log(`  预测比分    ${p.score}  (与胜负方向一致)`);
console.log(`  概率最高比分 ${p.topScores.map((s) => `${s.score} (${pct(s.p)})`).join('   ')}`);
console.log('');
