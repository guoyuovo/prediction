#!/usr/bin/env node
// 构建 "搏·串关" 数据 → output/bo-data.json(供 build-app-payload 注入 payload.bo)。
//   产出:
//   - legCandidates:四玩法(胜平负had / 波胆crs / 进球数ttg / 半全场hafu)逐场全候选腿,每腿带
//     市场去水 q、赔率、模型风味 modelP/lean、分档(稳搏/激进)、各档推荐项 rec —— 供前端"自选串关"现算 M串N。
//   - system:1X2 系统荐彩自动注(稳搏/激进各一组,沿用旧 singles/parlays 字段向后兼容)。
//   - cs:波胆单场展示卡(真实竞彩盘口 + 模型最可能比分)。
//   - coverage:各玩法覆盖场次(前端据此置灰)。
//   诚实框架:命中率/EV 全用市场 q;模型仅 ⚑lean 风味(半全场无模型→null);EV 恒负如实;crs 抽水~35% 仅娱乐。
// 用法:先 build-html --json-only,再 node scripts/build-bo.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { predictMatch, goalGrid } from '../src/model.mjs';
import { RISK_BANDS, devig, inBand, pickRec, selectPool, buildParlays } from '../src/parlay.mjs';

const idx = JSON.parse(readFileSync(join(ROOT, 'output', 'index-data.json'), 'utf-8'));
const crsData = existsSync(join(ROOT, 'data', 'jingcai-crs.json')) ? loadJson('data/jingcai-crs.json') : { matches: {} };

const future = idx.matches.filter((m) => !m.result && Array.isArray(m.odds) && m.odds.length === 3);
const baseOf = (m) => ({ key: `${m.home} vs ${m.away}`, seq: m.seq, home: m.home, away: m.away, group: m.g, date: m.date, time: m.time });

// 一个玩法 → 候选腿对象:算 q(去水)、挂 modelP/lean、标分档、定各档推荐
//   marketOdds: [{ sel, selZh, odds }];  modelPof(sel)->概率|null
function buildCandidate(base, play, vigPct, marketOdds, modelPof) {
  const odds = marketOdds.map((o) => o.odds);
  const { q } = devig(odds);
  const options = marketOdds.map((o, i) => {
    const mp = modelPof ? modelPof(o.sel) : null;
    const qi = q[i];
    return {
      sel: o.sel, selZh: o.selZh, q: +qi.toFixed(4), odds: o.odds,
      // 平局(had 的 D)不挂 ⚑:模型对平局无区分度,modelP>q 是底噪伪信号(详见 parlay.mjs legsOfMatch)
      modelP: mp != null ? +mp.toFixed(4) : null, lean: mp != null && mp > qi && o.sel !== 'D',
      bands: { steady: inBand({ q: qi, odds: o.odds }, RISK_BANDS.steady), aggressive: inBand({ q: qi, odds: o.odds }, RISK_BANDS.aggressive) },
    };
  });
  const rS = pickRec(options, RISK_BANDS.steady), rA = pickRec(options, RISK_BANDS.aggressive);
  return { ...base, play, vigPct, rec: { steady: rS ? rS.sel : null, aggressive: rA ? rA.sel : null }, options };
}

const legCandidates = [];

// —— 胜平负 had:全 52 未来场,共识赔率 + v2 模型(站点同款 m.h/d/a)——
for (const m of future) {
  const b = baseOf(m);
  const market = [
    { sel: 'H', selZh: '主胜', odds: m.odds[0] },
    { sel: 'D', selZh: '平局', odds: m.odds[1] },
    { sel: 'A', selZh: '客胜', odds: m.odds[2] },
  ];
  const mp = { H: m.h, D: m.d, A: m.a };
  legCandidates.push(buildCandidate(b, 'had', 6, market, (sel) => mp[sel]));
}

// —— 波胆/进球数/半全场:仅竞彩覆盖场(朝向对齐到我们的赛程)——
let nCrs = 0, nTtg = 0, nHafu = 0;
for (const m of future) {
  const j = crsData.matches[`${m.home} vs ${m.away}`] || crsData.matches[`${m.away} vs ${m.home}`];
  if (!j) continue;
  const flip = j.homeCanon !== m.home; // 竞彩朝向与我们相反
  const b = baseOf(m);
  // 模型 DC 分布(我们主客朝向)
  let grid = null;
  try { grid = goalGrid(m.home, m.away, { neutral: !m.homeAdv }); } catch { /* */ }

  // 波胆 crs
  if (j.cs && j.cs.length) {
    const market = j.cs.filter((c) => /^\d+-\d+$/.test(c.score)).slice(0, 14).map((c) => { // 前14档(低赔=高概率;4球+概率近0,裁掉省体积)
      const [a, bb] = c.score.split('-').map(Number);
      const score = flip ? `${bb}-${a}` : c.score;
      return { sel: score, selZh: score, odds: c.odds };
    });
    legCandidates.push(buildCandidate(b, 'crs', j.csVigPct ?? 35, market, (sel) => grid ? (grid.scoreP[sel] || 0) : null));
    nCrs++;
  }
  // 进球数 ttg(朝向无关)
  if (j.ttg && j.ttg.length) {
    const market = j.ttg.map((t) => ({ sel: t.goals, selZh: t.goals + '球', odds: t.odds }));
    legCandidates.push(buildCandidate(b, 'ttg', j.ttgVigPct ?? 25, market, (sel) => {
      if (!grid) return null; const k = sel === '7+' ? 7 : +sel; return grid.totalP[k];
    }));
    nTtg++;
  }
  // 半全场 hafu(无模型 → modelP=null;朝向翻转则 h<->a 互换)
  if (j.hafu && j.hafu.length) {
    const swap = { h: 'a', d: 'd', a: 'h' }; const zh = { h: '胜', d: '平', a: '负' };
    const market = j.hafu.map((x) => {
      const c = flip ? swap[x.combo[0]] + swap[x.combo[1]] : x.combo;
      return { sel: c, selZh: `半${zh[c[0]]}全${zh[c[1]]}`, odds: x.odds };
    });
    legCandidates.push(buildCandidate(b, 'hafu', j.hafuVigPct ?? 25, market, null)); // 无半场模型
    nHafu++;
  }
}

// —— 系统荐彩:1X2 自动注(稳搏/激进各一组)——
const m1x2 = future.map((m) => ({ key: `${m.home} vs ${m.away}`, seq: m.seq, home: m.home, away: m.away, p: [m.h, m.d, m.a], odds: m.odds, src: 'consensus' }));
const system = {};
for (const risk of ['steady', 'aggressive']) {
  const pool = selectPool(m1x2, { risk });
  system[risk] = buildParlays(pool, { risk });
}

// —— 波胆单场娱乐卡(真实盘口 + 模型最可能比分)——
const dateOf = new Map(future.map((m) => [`${m.home} vs ${m.away}`, m]));
const cs = [];
for (const lc of legCandidates) {
  if (lc.play !== 'crs') continue;
  const m = dateOf.get(lc.key); if (!m) continue;
  let model = [];
  try { model = (predictMatch(m.home, m.away, { neutral: !m.homeAdv }).topScores || []).map((t) => ({ score: t.score, p: +t.p.toFixed(3), fairOdds: +(1 / t.p).toFixed(2) })); } catch { /* */ }
  const market = [...lc.options].sort((a, b) => a.odds - b.odds).slice(0, 8).map((o) => ({ score: o.sel, odds: o.odds }));
  cs.push({ key: lc.key, seq: lc.seq, home: lc.home, away: lc.away, date: lc.date, time: lc.time, vigPct: lc.vigPct, market, model });
}

const coverage = { had: future.length, crs: nCrs, ttg: nTtg, hafu: nHafu };
const bo = {
  note: '娱乐性串关 · 命中率/EV用市场去水q · 模型仅⚑风味 · EV恒负如实 · 竞彩抽水高(波胆~35%) · 小样本不可外推',
  generatedAt: new Date().toISOString(),
  coverage, legCandidates, system,
  // 向后兼容当前前端(稳搏系统注 + 波胆卡):
  singles: system.steady.singles, parlays: system.steady.parlays, cs,
};

writeFileSync(join(ROOT, 'output', 'bo-data.json'), JSON.stringify(bo, null, 2), 'utf-8');
console.log(`✓ bo-data.json:候选腿 ${legCandidates.length}(had ${coverage.had}/crs ${nCrs}/ttg ${nTtg}/hafu ${nHafu}) · 系统注 稳${system.steady.parlays.length}/激${system.aggressive.parlays.length} · 波胆卡 ${cs.length}`);
