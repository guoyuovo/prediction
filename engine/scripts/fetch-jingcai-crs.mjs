#!/usr/bin/env node
// 抓取中国竞彩官方【比分(correct-score)固定赔率】→ data/jingcai-crs.json
//   源:webapi.sporttery.cn getMatchCalculatorV1(poolCode=had,crs),免费公开 JSON,无需登录。
//   用途:"搏·串关" 波胆部分的【真实市场盘口】(此前项目无 CS 赔率)。
//   ⚠️ 比分盘 overround≈1.35(抽水~35%,是 1X2 的 6 倍)——只配娱乐展示,EV 必深负,绝不并入价值串关、绝不讲价值。
//   覆盖:仅竞彩当期选入的少数场次(非全 72 场);中文队名经 team-names-zh 反查映射到 canonical。
//   失败兜底:沿用上次数据(不写空、不 exit(1));竞彩对连续请求有轻微限流,内置重试。
// 用法:node scripts/fetch-jingcai-crs.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const URL = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=had,crs&channel=c';
const HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36', Referer: 'https://www.sporttery.cn/' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// canonical→中文 反转为 中文→canonical(竞彩用中文全名)
const ZH = loadJson('data/team-names-zh.json');
const zhMap = ZH.names || ZH;
const ZH2CANON = Object.fromEntries(Object.entries(zhMap).map(([en, zh]) => [zh, en]));
const ALIAS = { '刚果民主共和国': 'DR Congo', '刚果金': 'DR Congo', '科特迪瓦': "Cote d'Ivoire", '土耳其': 'Turkey' };
const norm = (s) => (s || '').replace(/\s+/g, '').trim();
const toCanon = (zh) => ZH2CANON[norm(zh)] || ALIAS[norm(zh)] || null;

async function getJson(tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(URL, { headers: HDR });
      const t = await r.text();
      if (t[0] !== '{') throw new Error('非 JSON(限流?)');
      return JSON.parse(t);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(800 * (i + 1)); // 退避重试,避开限流
    }
  }
}

// crs 字段 → 比分赔率数组(竞彩 home-away 朝向),并算 overround
function parseCrs(crs) {
  const cs = [];
  let invSum = 0;
  for (const k in crs) {
    const m = /^s(\d\d)s(\d\d)$/.exec(k);
    if (!m) continue;
    const odds = parseFloat(crs[k]);
    if (!(odds > 0)) continue;
    cs.push({ score: `${+m[1]}-${+m[2]}`, odds: +odds.toFixed(2) });
    invSum += 1 / odds;
  }
  // 其他档(胜其他/平其他/负其他):键名形如 sh/sd/sa 或带 99,best-effort 收进 overround
  for (const k in crs) {
    if (/^s\d\ds\d\d$/.test(k) || /f$/.test(k)) continue;
    const o = parseFloat(crs[k]);
    if (o > 0 && /^(s?[hda]|other|.*99.*)/i.test(k)) { invSum += 1 / o; cs.push({ score: `其他:${k}`, odds: +o.toFixed(2) }); }
  }
  cs.sort((a, b) => a.odds - b.odds);
  return { cs, overround: +invSum.toFixed(3) };
}

async function main() {
  let j;
  try { j = await getJson(); }
  catch (e) { console.log(`✗ 竞彩抓取失败(${e.message})——保留上次 jingcai-crs.json,跳过。`); return; }

  const arr = [];
  for (const d of (j.value?.matchInfoList || [])) { if (d.subMatchList) arr.push(...d.subMatchList); else arr.push(d); }

  const out = {};
  const unmatched = [];
  let csCount = 0;
  for (const m of arr) {
    if (!m.crs || !m.crs.s01s00) continue; // 无比分盘
    const homeCanon = toCanon(m.homeTeamAllName), awayCanon = toCanon(m.awayTeamAllName);
    if (!homeCanon || !awayCanon) { unmatched.push(`${m.homeTeamAllName} vs ${m.awayTeamAllName}`); continue; }
    const { cs, overround } = parseCrs(m.crs);
    const had = m.had ? [parseFloat(m.had.h), parseFloat(m.had.d), parseFloat(m.had.a)].filter((x) => x > 0) : null;
    out[`${homeCanon} vs ${awayCanon}`] = {
      matchNum: m.matchNumStr || m.matchNum || null,
      homeCanon, awayCanon, homeZh: m.homeTeamAllName, awayZh: m.awayTeamAllName,
      had: had && had.length === 3 ? had : null,
      cs, csOverround: overround, // ≈1.35 → 抽水~35%
    };
    csCount++;
  }

  if (!csCount) { console.log('✗ 竞彩返回 0 场可用比分盘——保留上次数据,跳过。'); return; }

  writeFileSync(join(ROOT, 'data', 'jingcai-crs.json'), JSON.stringify({
    _note: '中国竞彩官方比分(CS)固定赔率。仅娱乐展示——抽水~35%,EV 必深负,绝不并入价值串关。覆盖竞彩当期选入场次。',
    _source: 'webapi.sporttery.cn getMatchCalculatorV1 (poolCode=crs)',
    _fetchedAt: new Date().toISOString(),
    count: csCount, matches: out,
  }, null, 2), 'utf-8');
  console.log(`✓ 竞彩比分盘 ${csCount} 场 → data/jingcai-crs.json`);
  if (unmatched.length) console.log(`  ⚠ 未匹配(跳过,非本届48强或别名缺失):${[...new Set(unmatched)].slice(0, 8).join(' / ')}`);
}

main();
