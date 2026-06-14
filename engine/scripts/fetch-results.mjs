#!/usr/bin/env node
// 抓取 2026 世界杯【已完赛】真实比分（ESPN 计分板，免 key）→ data/wc-results.json
//   v2 模型的数据入口：逐场已完赛结果用于滚动 Elo 更新与样本外验证。
//   名义来源是 Sailing MCP；当其未接入时用 ESPN 真实计分板（项目抓赔率同源）。
//   半场比分 ESPN 计分板不稳定提供，best-effort 走 summary 端点，拿不到则记 null。
// 用法：node scripts/fetch-results.mjs
//
// 真实数据：比分来自 ESPN fifa.world scoreboard（state=post 即完场），无任何虚构。

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const H = { 'User-Agent': 'Mozilla/5.0' };
const getJson = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.json(); };

// ESPN 队名 → 本项目规范名（data/teams.json 键）。仅列不一致者；其余同名直接命中。
const ESPN2CANON = {
  'United States': 'USA', 'USA': 'USA',
  'Bosnia-Herzegovina': 'Bosnia', 'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia',
  'Czechia': 'Czechia', 'Czech Republic': 'Czechia',
  "Côte d'Ivoire": "Cote d'Ivoire", 'Ivory Coast': "Cote d'Ivoire",
  'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo', 'DR Congo (Democratic Republic of Congo)': 'DR Congo',
  'Curaçao': 'Curacao', 'Cape Verde Islands': 'Cape Verde', 'Cabo Verde': 'Cape Verde',
  'IR Iran': 'Iran', 'Korea Republic': 'South Korea', 'South Korea': 'South Korea',
};
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
function toCanon(espnName, canonSet) {
  if (ESPN2CANON[espnName]) return ESPN2CANON[espnName];
  if (canonSet.has(espnName)) return espnName;
  const a = stripAccents(espnName);
  for (const c of canonSet) if (stripAccents(c) === a) return c;
  return null; // 未匹配（非本届 48 强或映射缺失）
}

// 生成 [startDate, today] 的 YYYYMMDD 列表
function dateRange(startISO) {
  const out = [];
  const today = new Date();
  let d = new Date(startISO + 'T00:00:00Z');
  while (d <= today) {
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

// best-effort 一次抓取：半场比分(linescores) + 射门统计(boxscore)，按 ESPN team.id 归键
async function fetchSummary(eventId) {
  try {
    const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${eventId}`);
    const out = { ht: {}, stats: {} };
    const comp = j?.header?.competitions?.[0];
    if (comp) for (const c of comp.competitors) {
      const hl = c.linescores;
      if (hl?.length) out.ht[c.team.id] = +hl[0].value || +hl[0].displayValue || 0;
    }
    for (const t of (j?.boxscore?.teams || [])) {
      const id = t.team?.id; if (!id) continue;
      const get = (n) => { const s = (t.statistics || []).find((x) => x.name === n); if (!s) return null; const v = s.value != null ? +s.value : +s.displayValue; return Number.isFinite(v) ? v : null; };
      out.stats[id] = { shots: get('totalShots'), sot: get('shotsOnTarget'), poss: get('possessionPct') };
    }
    // 进球时间线（keyEvents 中的进球：分钟 + 球队id + 射手）
    out.goals = [];
    for (const e of (j?.keyEvents || [])) {
      const isGoal = e.scoringPlay || /goal/i.test(e.type?.text || '');
      if (!isGoal || /own goal/i.test(e.text || '') ? false : isGoal) {
        const min = e.clock?.displayValue || '';
        const scorer = (e.participants || []).map((p) => p.athlete?.displayName).filter(Boolean)[0] || '';
        const own = /own goal/i.test(e.text || '');
        out.goals.push({ teamId: e.team?.id, min, scorer, own, pen: /penalty/i.test(e.text || '') });
      }
    }
    return out;
  } catch { return null; }
}

const sched = loadJson('data/schedule-2026.json').fixtures;
const teams = loadJson('data/teams.json').teams;
const canonSet = new Set(Object.keys(teams));
// 无序队对 → 赛程项（取 home/away 朝向 + 分组 + 开球时间）
const fixtureByPair = new Map();
for (const fx of sched) fixtureByPair.set([fx.home, fx.away].sort().join('||'), fx);

const startDate = sched.map((f) => (f.et || '').slice(0, 10)).sort()[0] || '2026-06-11';
const days = dateRange(startDate);
console.log(`抓取 ESPN 世界杯完赛比分：${days[0]} → ${days[days.length - 1]}（${days.length} 天）...`);

const results = [];
const unmatched = [];
for (const day of days) {
  let evs = [];
  try { evs = (await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${day}`)).events || []; }
  catch (e) { console.log(`  ⚠ ${day} 拉取失败：${e.message}`); continue; }
  for (const e of evs) {
    const st = e.status?.type;
    if (st?.state !== 'post') continue; // 只要完场
    const c = e.competitions[0];
    const eh = c.competitors.find((x) => x.homeAway === 'home');
    const ea = c.competitors.find((x) => x.homeAway === 'away');
    const ehName = eh.team.displayName, eaName = ea.team.displayName;
    const homeC = toCanon(ehName, canonSet), awayC = toCanon(eaName, canonSet);
    if (!homeC || !awayC) { unmatched.push(`${ehName} vs ${eaName}`); continue; }
    const fx = fixtureByPair.get([homeC, awayC].sort().join('||'));
    if (!fx) { unmatched.push(`${homeC} vs ${awayC}（非小组赛赛程）`); continue; }
    // 朝向对齐到赛程的 home/away
    let home = homeC, away = awayC, hs = +eh.score, as = +ea.score;
    if (fx.home !== homeC) { home = awayC; away = homeC; hs = +ea.score; as = +eh.score; }
    const sm = await fetchSummary(e.id);
    let htHome = null, htAway = null, stats = null, goals = [];
    if (sm) {
      const ehId = eh.team.id, eaId = ea.team.id, fhIsEspnHome = fx.home === homeC;
      if (sm.ht[ehId] != null && sm.ht[eaId] != null) { htHome = fhIsEspnHome ? sm.ht[ehId] : sm.ht[eaId]; htAway = fhIsEspnHome ? sm.ht[eaId] : sm.ht[ehId]; }
      const sH = sm.stats[ehId], sA = sm.stats[eaId];
      if (sH && sA && sH.shots != null && sA.shots != null) stats = { home: fhIsEspnHome ? sH : sA, away: fhIsEspnHome ? sA : sH };
      // 进球时间线，side 标记主/客
      goals = (sm.goals || []).map((g) => ({ min: g.min, scorer: g.scorer, own: g.own, pen: g.pen, side: g.teamId === ehId ? (fhIsEspnHome ? 'home' : 'away') : (fhIsEspnHome ? 'away' : 'home') }))
        .sort((a, b) => parseInt(a.min) - parseInt(b.min));
    }
    results.push({
      date: (fx.et || '').slice(0, 10), et: fx.et, group: fx.group,
      home, away, hs, as, htHome, htAway, stats, goals,
      status: st.description, espnId: e.id,
    });
    console.log(`  ✓ ${home} ${hs}-${as} ${away}` + (htHome != null ? `  (半 ${htHome}-${htAway})` : '') + `  [${st.description}]`);
  }
}

// 按开球时间排序（滚动 Elo 需要时间顺序）
results.sort((a, b) => (a.et || '').localeCompare(b.et || ''));

const out = {
  _note: '2026 世界杯已完赛真实比分（ESPN fifa.world scoreboard，state=post）。v2 模型逐场滚动 Elo + 验证的数据入口。半场 best-effort，缺失记 null。',
  _source: 'site.api.espn.com fifa.world scoreboard/summary（名义源 Sailing MCP，未接入时回退 ESPN）',
  _fetchedAt: new Date().toISOString(),
  count: results.length,
  results,
};
writeFileSync(join(ROOT, 'data', 'wc-results.json'), JSON.stringify(out, null, 2), 'utf-8');
console.log(`✓ 共 ${results.length} 场完赛 → data/wc-results.json`);
if (unmatched.length) console.log('  ⚠ 未匹配（已跳过）：' + [...new Set(unmatched)].join(' / '));
console.log('  下一步：node scripts/build-elo-v2.mjs');
