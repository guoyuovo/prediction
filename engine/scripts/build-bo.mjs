#!/usr/bin/env node
// 构建 "搏·价值串关" 数据 → output/bo-data.json(供 build-app-payload 注入 payload.bo)。
//   1X2 价值串:读 output/index-data.json 的未来场(站点同款 h/d/a 概率 + 共识赔率,与回测同源),
//     用 src/parlay.mjs(与回测完全相同的逻辑)选腿组 2/3/4 关。
//   波胆娱乐卡:读 data/jingcai-crs.json(竞彩真实比分盘口) + 模型 DC topScores,仅展示,绝不并入串关。
//   ⚠️ 娱乐定位:组合 EV 通常为负;高赔腿有 favorite-longshot 偏差(回测已证 0/6),不做任何价值承诺。
// 用法:先 build-html --json-only,再 node scripts/build-bo.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictMatch } from '../src/model.mjs';
import { selectPool, buildParlays } from '../src/parlay.mjs';

const idx = JSON.parse(readFileSync(join(ROOT, 'output', 'index-data.json'), 'utf-8'));
const crs = existsSync(join(ROOT, 'data', 'jingcai-crs.json')) ? loadJson('data/jingcai-crs.json') : { matches: {} };

// —— 未来场(无 result)→ parlay.mjs 的 match 对象;共识赔率 m.odds[H,D,A] 与模型 m.h/d/a 同源 ——
const future = idx.matches.filter((m) => !m.result && Array.isArray(m.odds) && m.odds.length === 3);
const matches = future.map((m) => ({
  key: `${m.home} vs ${m.away}`, seq: m.seq, home: m.home, away: m.away,
  p: [m.h, m.d, m.a], odds: m.odds, src: 'consensus',
  date: m.date, time: m.time, kickoff: m.kickoff, group: m.g,
}));

const pool = selectPool(matches);
const { singles, parlays } = buildParlays(pool);

// 给腿/注补上开球时间(便于前端展示)
const dateOf = new Map(matches.map((m) => [m.key, { date: m.date, time: m.time, group: m.group }]));
const enrich = (pl) => ({ ...pl, legs: pl.legs.map((l) => ({ ...l, ...(dateOf.get(`${l.home} vs ${l.away}`) || {}) })) });

// —— 波胆娱乐卡:竞彩真实比分盘口 + 模型 DC topScores(朝向对齐到我们的赛程)——
const csCards = [];
for (const m of future) {
  const j = crs.matches[`${m.home} vs ${m.away}`] || crs.matches[`${m.away} vs ${m.home}`];
  if (!j) continue;
  const flip = j.homeCanon !== m.home; // 竞彩朝向与我们相反 → 比分 a-b 翻转
  const market = j.cs.filter((c) => /^\d+-\d+$/.test(c.score)).map((c) => {
    const [a, b] = c.score.split('-').map(Number);
    return { score: flip ? `${b}-${a}` : c.score, odds: c.odds };
  }).sort((a, b) => a.odds - b.odds).slice(0, 8);
  // 模型最可能比分(DC topScores;娱乐,base-elo 差异可忽略)
  let model = [];
  try { model = (predictMatch(m.home, m.away, { neutral: !m.homeAdv }).topScores || []).map((t) => ({ score: t.score, p: +t.p.toFixed(3), fairOdds: +(1 / t.p).toFixed(2) })); } catch { /* */ }
  csCards.push({
    key: `${m.home} vs ${m.away}`, seq: m.seq, home: m.home, away: m.away,
    date: m.date, time: m.time, matchNum: j.matchNum,
    csOverround: j.csOverround, vigPct: Math.round((j.csOverround - 1) * 100),
    market, model,
  });
}

const bo = {
  note: '娱乐性价值串关 · 模型驱动 · 极小样本不可外推 · 高赔=低概率长期负EV · 波胆为竞彩真盘口(抽水~35%)仅娱乐',
  generatedAt: new Date().toISOString(),
  legsPool: pool.length,
  singles: singles.map(enrich),
  parlays: parlays.map(enrich),
  cs: csCards,
};

writeFileSync(join(ROOT, 'output', 'bo-data.json'), JSON.stringify(bo, null, 2), 'utf-8');
console.log(`✓ bo-data.json:候选腿池 ${pool.length} · 单关 ${singles.length} · 串关 ${parlays.length} · 竞彩波胆卡 ${csCards.length}`);
if (parlays.length) { const t = parlays[0]; console.log(`  样例最优串(${t.tier}关):×${t.odds} 命中概率${(t.p * 100).toFixed(1)}% EV=${t.ev} [${t.tag}] ${t.legs.map((l) => l.home + l.selZh).join(' + ')}`); }
