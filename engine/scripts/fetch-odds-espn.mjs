#!/usr/bin/env node
// 免 key 抓取真实 1X2 赔率 → data/match-odds.json
//   来源：ESPN 公开接口（site.api + sports.core.api），多家庄家共识
//   覆盖小组赛日期窗口，逐场取各 provider 的让球(moneyline) 主/平/客，
//   美式赔率转十进制后求均值，按我们的队名归一写入。
// 用法：node scripts/fetch-odds-espn.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { buildSchedule } from '../src/schedule.mjs';

const KNOWN = new Set(Object.keys(loadJson('data/teams.json').teams));

// ESPN 队名 → 本项目队名（仅列不一致的）
const NAME_MAP = {
  'United States': 'USA', 'USA': 'USA',
  'Korea Republic': 'South Korea', 'South Korea': 'South Korea',
  'Türkiye': 'Turkey', 'Turkiye': 'Turkey', 'Turkey': 'Turkey',
  'Czechia': 'Czechia', 'Czech Republic': 'Czechia',
  'Ivory Coast': "Cote d'Ivoire", "Côte d'Ivoire": "Cote d'Ivoire",
  'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia', 'Bosnia-Herzegovina': 'Bosnia',
  'Curaçao': 'Curacao', 'Curacao': 'Curacao',
  'Cabo Verde': 'Cape Verde', 'Cape Verde': 'Cape Verde',
  'Congo DR': 'DR Congo', 'DR Congo': 'DR Congo', 'Congo-Kinshasa': 'DR Congo',
};
const norm = (n) => NAME_MAP[n] || n;

// 美式赔率 → 十进制
const am2dec = (a) => (a > 0 ? a / 100 + 1 : 100 / -a + 1);

// 小组赛日期窗口（取自真实赛程的 ET 日期，去重）
const dates = [...new Set(buildSchedule().map((m) => m.et.slice(0, 10).replace(/-/g, '')))];
// 因美东晚场会跨到次日 ET，补充窗口两端各 1 天
const allDates = [...new Set([...dates, '20260611', '20260628'])].sort();

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const oddsFile = loadJson('data/match-odds.json');
const odds = oddsFile.odds || {};
let updated = 0;
const unmatched = new Set();

console.log(`抓取 ESPN 赔率，覆盖 ${allDates.length} 个比赛日 ...`);
for (const d of allDates) {
  let sb;
  try {
    sb = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${d}`);
  } catch { continue; }

  for (const ev of sb.events || []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const homeC = comp.competitors.find((c) => c.homeAway === 'home');
    const awayC = comp.competitors.find((c) => c.homeAway === 'away');
    if (!homeC || !awayC) continue;
    const home = norm(homeC.team.displayName || homeC.team.name);
    const away = norm(awayC.team.displayName || awayC.team.name);
    if (!KNOWN.has(home)) { unmatched.add(homeC.team.displayName); continue; }
    if (!KNOWN.has(away)) { unmatched.add(awayC.team.displayName); continue; }
    const key = `${home} vs ${away}`;
    if (odds[key]?._locked) continue;

    // 取该场各 provider 的 moneyline 主/平/客
    let oddsData;
    try {
      oddsData = await getJson(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/${ev.id}/competitions/${ev.id}/odds`);
    } catch { continue; }

    const H = [], D = [], A = [];
    for (const it of oddsData.items || []) {
      const h = it.homeTeamOdds?.moneyLine, dd = it.drawOdds?.moneyLine, a = it.awayTeamOdds?.moneyLine;
      if (typeof h === 'number' && typeof dd === 'number' && typeof a === 'number') {
        H.push(am2dec(h)); D.push(am2dec(dd)); A.push(am2dec(a));
      }
    }
    if (!H.length) continue;
    const avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
    odds[key] = [Number(avg(H).toFixed(2)), Number(avg(D).toFixed(2)), Number(avg(A).toFixed(2))];
    updated++;
    console.log(`  ✓ ${key}  ${odds[key].join('/')}  (${H.length} 家)`);
  }
}

oddsFile.odds = odds;
oddsFile._note = "1X2 欧赔（decimal）。经 ESPN 公开接口抓取，多家庄家 moneyline 取均值。缺失场次市场子模型自动退出、权重归一。";
oddsFile._source = 'ESPN site/core API（免 key），美式赔率转十进制';
oddsFile._fetchedAt = new Date().toISOString();
writeFileSync(join(ROOT, 'data', 'match-odds.json'), JSON.stringify(oddsFile, null, 2), 'utf-8');

console.log(`\n✓ 写入/更新 ${updated} 场真实赔率 → data/match-odds.json`);
if (unmatched.size) console.log(`⚠ 未匹配队名（需在 NAME_MAP 补充）：${[...unmatched].join(', ')}`);
console.log('  下一步：node scripts/batch-predict.mjs ; node scripts/build-html.mjs');
