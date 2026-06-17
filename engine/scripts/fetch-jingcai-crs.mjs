#!/usr/bin/env node
// 抓取中国竞彩官方盘口 → data/jingcai-crs.json:胜平负 had / 让球 hhad / 比分 crs / 进球数 ttg / 半全场 hafu。
//   源:webapi.sporttery.cn getMatchCalculatorV1,免费公开 JSON,无需登录。
//   ⚠️ 分批请求:一次请求 ≥4 个 poolCode 会触发腾讯 WAF 403,故拆成 had,hhad,crs 与 ttg,hafu 两批合并。
//   ⚠️ 抽水(实测):had≈13% / 比分≈35% / 进球数≈25% / 半全场≈25% —— 仅娱乐展示,EV 必深负,绝不讲价值。
//   覆盖:仅竞彩当期选入场次(约 12~18 场,非全 72);中文队名经 team-names-zh 反查映射。
//   失败兜底:沿用上次数据(不写空、不 exit(1))。
// 用法:node scripts/fetch-jingcai-crs.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const API = (pool) => `https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=${pool}&channel=c`;
const BATCHES = ['had,hhad,crs', 'ttg,hafu']; // 分批避 WAF
const HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36', Referer: 'https://www.sporttery.cn/' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ZH = loadJson('data/team-names-zh.json');
const zhMap = ZH.names || ZH;
const ZH2CANON = Object.fromEntries(Object.entries(zhMap).map(([en, zh]) => [zh, en]));
const ALIAS = { '刚果民主共和国': 'DR Congo', '刚果金': 'DR Congo', '科特迪瓦': "Cote d'Ivoire", '土耳其': 'Turkey' };
const norm = (s) => (s || '').replace(/\s+/g, '').trim();
const toCanon = (zh) => ZH2CANON[norm(zh)] || ALIAS[norm(zh)] || null;

async function getBatch(pool, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API(pool), { headers: HDR });
      const t = await r.text();
      if (t[0] !== '{') throw new Error('非 JSON(WAF/限流) HTTP' + r.status);
      const j = JSON.parse(t);
      const arr = [];
      for (const d of (j.value?.matchInfoList || [])) { if (d.subMatchList) arr.push(...d.subMatchList); else arr.push(d); }
      return arr;
    } catch (e) {
      if (i === tries - 1) { console.log(`  ⚠ poolCode=${pool} 抓取失败:${e.message}`); return null; }
      await sleep(900 * (i + 1));
    }
  }
}

const ov = (invSum) => +invSum.toFixed(3);                 // overround
const vpct = (invSum) => Math.round((invSum - 1) * 100);   // 抽水%

// 比分 crs → [{score:'h-a',odds}] (竞彩主客朝向) + overround
function parseCrs(crs) {
  const cs = []; let inv = 0;
  for (const k in crs) { const m = /^s(\d\d)s(\d\d)$/.exec(k); if (!m) continue; const o = parseFloat(crs[k]); if (o > 0) { cs.push({ score: `${+m[1]}-${+m[2]}`, odds: +o.toFixed(2) }); inv += 1 / o; } }
  cs.sort((a, b) => a.odds - b.odds);
  return { cs, overround: ov(inv), vigPct: vpct(inv) };
}
// 进球数 ttg → [{goals:'0'..'7+',odds}] (s7=7+) + overround
function parseTtg(ttg) {
  const out = []; let inv = 0;
  for (let g = 0; g <= 7; g++) { const o = parseFloat(ttg['s' + g]); if (o > 0) { out.push({ goals: g === 7 ? '7+' : String(g), odds: +o.toFixed(2) }); inv += 1 / o; } }
  return { ttg: out, overround: ov(inv), vigPct: vpct(inv) };
}
// 半全场 hafu → [{combo,label,odds}] (竞彩主客朝向,h=主胜/d=平/a=客胜,首字=半场 次字=全场) + overround
const HAFU_KEYS = ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'];
const HAFU_ZH = { h: '胜', d: '平', a: '负' };
function parseHafu(hafu) {
  const out = []; let inv = 0;
  for (const k of HAFU_KEYS) { const o = parseFloat(hafu[k]); if (o > 0) { out.push({ combo: k, label: `半${HAFU_ZH[k[0]]}全${HAFU_ZH[k[1]]}`, odds: +o.toFixed(2) }); inv += 1 / o; } }
  return { hafu: out, overround: ov(inv), vigPct: vpct(inv) };
}

const triple = (x) => (x ? [parseFloat(x.h), parseFloat(x.d), parseFloat(x.a)].map((v) => +v.toFixed(2)) : null);

async function main() {
  const out = {};
  let csCount = 0; const unmatched = [];

  // 批1:had / hhad / crs —— 建基础记录
  const b1 = await getBatch(BATCHES[0]);
  if (!b1) { console.log('✗ 竞彩主批抓取失败——保留上次 jingcai-crs.json,跳过。'); return; }
  for (const m of b1) {
    if (!m.crs || !m.crs.s01s00) continue;
    const hc = toCanon(m.homeTeamAllName), ac = toCanon(m.awayTeamAllName);
    if (!hc || !ac) { unmatched.push(`${m.homeTeamAllName} vs ${m.awayTeamAllName}`); continue; }
    const had = triple(m.had); const hh = triple(m.hhad);
    const { cs, overround, vigPct } = parseCrs(m.crs);
    out[`${hc} vs ${ac}`] = {
      matchNum: m.matchNumStr || m.matchNum || null, homeCanon: hc, awayCanon: ac,
      homeZh: m.homeTeamAllName, awayZh: m.awayTeamAllName,
      had: had && had.every((x) => x > 0) ? had : null,
      hhad: hh && hh.every((x) => x > 0) ? { goalLine: m.hhad?.goalLine ?? '', odds: hh } : null,
      cs, csOverround: overround, csVigPct: vigPct,
    };
    csCount++;
  }
  if (!csCount) { console.log('✗ 竞彩 0 场可用——保留上次数据,跳过。'); return; }

  // 批2:ttg / hafu —— 合并进已有记录(按规范队对)
  await sleep(1200);
  const b2 = await getBatch(BATCHES[1]);
  let ttgN = 0, hafuN = 0;
  if (b2) {
    for (const m of b2) {
      const hc = toCanon(m.homeTeamAllName), ac = toCanon(m.awayTeamAllName);
      const rec = hc && ac && out[`${hc} vs ${ac}`]; if (!rec) continue;
      if (m.ttg && m.ttg.s0 != null) { const t = parseTtg(m.ttg); rec.ttg = t.ttg; rec.ttgVigPct = t.vigPct; ttgN++; }
      if (m.hafu && m.hafu.hh != null) { const h = parseHafu(m.hafu); rec.hafu = h.hafu; rec.hafuVigPct = h.vigPct; hafuN++; }
    }
  } else { console.log('  ⚠ ttg/hafu 批未取到,本次只更新 had/hhad/crs。'); }

  writeFileSync(join(ROOT, 'data', 'jingcai-crs.json'), JSON.stringify({
    _note: '中国竞彩官方盘口(胜平负/让球/比分/进球数/半全场)。仅娱乐展示——抽水高(比分~35%/进球~25%/半全~25%/胜平负~13%),EV必深负,绝不讲价值。覆盖竞彩当期选入场次。',
    _source: 'webapi.sporttery.cn getMatchCalculatorV1 (poolCode 分批: had,hhad,crs + ttg,hafu)',
    _fetchedAt: new Date().toISOString(),
    count: csCount, ttgCount: ttgN, hafuCount: hafuN, matches: out,
  }, null, 2), 'utf-8');
  console.log(`✓ 竞彩盘口 ${csCount} 场(含让球) · 进球数 ${ttgN} 场 · 半全场 ${hafuN} 场 → data/jingcai-crs.json`);
  if (unmatched.length) console.log(`  ⚠ 未匹配(跳过):${[...new Set(unmatched)].slice(0, 8).join(' / ')}`);
}

main();
