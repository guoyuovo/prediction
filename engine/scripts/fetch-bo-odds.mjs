#!/usr/bin/env node
// 抓取「搏·串关」比分类盘口(波胆 crs / 进球数 ttg / 半全场 hafu)→ data/bo-odds.json。
//   源:Bovada 公开 JSON(免 key/免登录,境外 CI 可直连——取代旧竞彩 sporttery 源,
//       因竞彩 webapi 仅国内可达,GitHub runner 在境外永远抓不到、导致线上长期挂🔒)。
//   口径:国际庄(Bovada)。比分盘抽水实测~30%(与竞彩~28-37% 接近),去水概率/系统推荐与竞彩几乎一致。
//   覆盖:Bovada 当期世界杯 coupon 中开出比分类盘的场次(约 30+ 场);队名经 NAME_MAP 归一、朝向对齐到我方赛程。
//   失败兜底:沿用上次 data/bo-odds.json(不写空、不 exit(1))。
// 用法:node scripts/fetch-bo-odds.mjs

import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { buildSchedule } from '../src/schedule.mjs';

const COUPON = 'https://www.bovada.lv/services/sports/event/coupon/events/A/description/soccer/fifa-world-cup';
const H = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };

const KNOWN = new Set(Object.keys(loadJson('data/teams.json').teams));
const NAME_MAP = {
  'United States': 'USA', 'USA': 'USA',
  'Korea Republic': 'South Korea', 'South Korea': 'South Korea',
  'Türkiye': 'Turkey', 'Turkiye': 'Turkey', 'Turkey': 'Turkey',
  'Czechia': 'Czechia', 'Czech Republic': 'Czechia',
  'Ivory Coast': "Cote d'Ivoire", "Côte d'Ivoire": "Cote d'Ivoire", "Cote d'Ivoire": "Cote d'Ivoire",
  'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia',
  'Curaçao': 'Curacao', 'Curacao': 'Curacao',
  'Cabo Verde': 'Cape Verde', 'Cape Verde': 'Cape Verde',
  'Congo DR': 'DR Congo', 'DR Congo': 'DR Congo',
};
const norm = (n) => NAME_MAP[n] || n;
const dec = (o) => (o.price ? parseFloat(o.price.decimal) : null);
const vpct = (odds) => Math.round((odds.reduce((s, o) => s + 1 / o, 0) - 1) * 100);

// 我方赛程规范对阵(把 Bovada 主客对齐到我们的口径)
const schedule = buildSchedule();
const pairIndex = new Map();
for (const s of schedule) pairIndex.set([s.home, s.away].sort().join('|'), { home: s.home, away: s.away });
function orient(srcHome, srcAway) {
  const our = pairIndex.get([srcHome, srcAway].sort().join('|'));
  if (!our) return null;
  return { our, flip: our.home !== srcHome }; // flip=true 表示 Bovada 主客与我方相反
}

// 全部市场拍平(跨 displayGroups)
const allMarkets = (ev) => (ev.displayGroups || []).flatMap((d) => d.markets || []);
const isFT = (m) => !m.outcomes.some((o) => /1H/i.test(o.description)); // 排除上半场盘

// 波胆 crs:Bovada "Correct Score"(全场),取数值档最全的那个 → [{score,odds}] (我方朝向)
function parseCrs(ev, flip) {
  const cands = allMarkets(ev).filter((m) => /^Correct Score$/i.test(m.description) && isFT(m));
  if (!cands.length) return null;
  const m = cands.sort((a, b) => b.outcomes.length - a.outcomes.length)[0];
  const cs = [];
  for (const o of m.outcomes) {
    const mm = /^(\d+)\s*-\s*(\d+)$/.exec(o.description.trim());
    const od = dec(o);
    if (!mm || !(od > 0)) continue;
    const [h, a] = [+mm[1], +mm[2]];
    cs.push({ score: flip ? `${a}-${h}` : `${h}-${a}`, odds: +od.toFixed(2) });
  }
  if (cs.length < 6) return null;
  cs.sort((a, b) => a.odds - b.odds);
  return { cs, csVigPct: vpct(cs.map((c) => c.odds)) };
}

// 进球数 ttg:Bovada "Exact Goals Scored"(全场·非单队) → [{goals,odds}] (朝向无关)
function parseTtg(ev) {
  const cands = allMarkets(ev).filter((m) => /^Exact Goals Scored$/i.test(m.description) && isFT(m));
  if (!cands.length) return null;
  const m = cands.sort((a, b) => b.outcomes.length - a.outcomes.length)[0];
  const ttg = [];
  for (const o of m.outcomes) {
    const od = dec(o); if (!(od > 0)) continue;
    const ex = /^Exactly\s+(\d+)$/i.exec(o.description.trim());
    const ov = /^(\d+)\s*(?:and Over|\+)/i.exec(o.description.trim());
    const goals = ex ? String(+ex[1]) : ov ? `${+ov[1]}+` : null;
    if (goals == null) continue;
    ttg.push({ goals, odds: +od.toFixed(2) });
  }
  if (ttg.length < 4) return null;
  return { ttg, ttgVigPct: vpct(ttg.map((t) => t.odds)) };
}

// 半全场 hafu:Bovada "Half Time / Full Time" 9 档 "HT - FT" → [{combo,label,odds}] (我方朝向)
const HAFU_ZH = { h: '胜', d: '平', a: '负' };
function parseHafu(ev, flip, srcHome, srcAway) {
  const m = allMarkets(ev).find((x) => /^Half Time \/ Full Time$/i.test(x.description));
  if (!m) return null;
  const side = (s) => {
    const t = s.trim();
    if (/^(draw|tie)$/i.test(t)) return 'd';
    if (norm(t) === srcHome) return 'h';
    if (norm(t) === srcAway) return 'a';
    return null;
  };
  const sw = { h: 'a', d: 'd', a: 'h' };
  const hafu = [];
  for (const o of m.outcomes) {
    const od = dec(o); if (!(od > 0)) continue;
    const parts = o.description.split(/\s+-\s+/);
    if (parts.length !== 2) continue;
    let ht = side(parts[0]), ft = side(parts[1]);
    if (!ht || !ft) continue;
    if (flip) { ht = sw[ht]; ft = sw[ft]; }
    const combo = ht + ft;
    hafu.push({ combo, label: `半${HAFU_ZH[ht]}全${HAFU_ZH[ft]}`, odds: +od.toFixed(2) });
  }
  if (hafu.length < 6) return null;
  return { hafu, hafuVigPct: vpct(hafu.map((h) => h.odds)) };
}

async function main() {
  let groups;
  try { groups = await (await fetch(COUPON, { headers: H })).json(); }
  catch (e) { console.log('✗ Bovada 拉取失败:' + e.message + ' —— 保留上次 bo-odds.json,跳过。'); return; }

  const evs = (Array.isArray(groups) ? groups : []).flatMap((g) => g.events || []);
  if (!evs.length) { console.log('✗ Bovada 0 场 —— 保留上次数据,跳过。'); return; }

  const out = {};
  let nCrs = 0, nTtg = 0, nHafu = 0; const unmatched = new Set();
  for (const ev of evs) {
    const comps = ev.competitors || [];
    const hC = comps.find((c) => c.home) || comps[0];
    const aC = comps.find((c) => !c.home) || comps[1];
    if (!hC || !aC) continue;
    const bh = norm(hC.name), ba = norm(aC.name);
    if (!KNOWN.has(bh) || !KNOWN.has(ba)) { unmatched.add(`${hC.name} vs ${aC.name}`); continue; }
    const or = orient(bh, ba);
    if (!or) { unmatched.add(`${bh} vs ${ba}`); continue; }

    const crs = parseCrs(ev, or.flip);
    const ttg = parseTtg(ev);
    const hafu = parseHafu(ev, or.flip, bh, ba);
    if (!crs && !ttg && !hafu) continue;

    const rec = { homeCanon: or.our.home, awayCanon: or.our.away };
    if (crs) { rec.cs = crs.cs; rec.csVigPct = crs.csVigPct; nCrs++; }
    if (ttg) { rec.ttg = ttg.ttg; rec.ttgVigPct = ttg.ttgVigPct; nTtg++; }
    if (hafu) { rec.hafu = hafu.hafu; rec.hafuVigPct = hafu.hafuVigPct; nHafu++; }
    out[`${or.our.home} vs ${or.our.away}`] = rec;
  }

  if (!nCrs) {
    console.log('✗ Bovada 比分盘 0 场可用 —— 保留上次数据,跳过。');
    if (existsSync(join(ROOT, 'data', 'bo-odds.json'))) return; // 有旧数据则保留
  }

  writeFileSync(join(ROOT, 'data', 'bo-odds.json'), JSON.stringify({
    _note: '「搏·串关」比分类盘口(波胆/进球数/半全场)。源:Bovada 国际庄(免 key/免登录,境外可达)。仅娱乐——比分盘抽水~30%,EV 必深负,绝不讲价值。覆盖 Bovada 当期开盘场次。',
    _source: 'bovada.lv soccer/fifa-world-cup coupon (Correct Score + Exact Goals Scored + Half Time/Full Time)',
    _fetchedAt: new Date().toISOString(),
    count: nCrs, ttgCount: nTtg, hafuCount: nHafu, matches: out,
  }, null, 2), 'utf-8');
  console.log(`✓ Bovada 比分盘 ${nCrs} 场 · 进球数 ${nTtg} 场 · 半全场 ${nHafu} 场 → data/bo-odds.json`);
  if (unmatched.size) console.log(`  ⚠ 未匹配(跳过):${[...unmatched].slice(0, 8).join(' / ')}`);
}

main();
