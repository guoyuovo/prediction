#!/usr/bin/env node
// 双源真实赔率 + 亚盘/大小球线 + 场地（全部免 key）→ data/match-odds.json
//   源1 ESPN（site/core API，DraftKings）：1X2 + 让球线(spread) + 大小球线(OU) + 场地
//   源2 Bovada（公开 JSON）：3-way 1X2(decimal) + 大小球线
//   两源交叉验证（标注分歧），其均值作为模型市场子模型输入。
// 用法：node scripts/fetch-odds.mjs

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';
import { buildSchedule } from '../src/schedule.mjs';

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
const am2dec = (a) => (a > 0 ? a / 100 + 1 : 100 / -a + 1);
const H = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
const getJson = async (u, h = H) => { const r = await fetch(u, { headers: h }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

// 我方赛程的规范对阵（用于把各源的主客对齐到我们的口径）
const schedule = buildSchedule();
const pairIndex = new Map(); // "A|B"(sorted) -> {home,away}
for (const s of schedule) pairIndex.set([s.home, s.away].sort().join('|'), { home: s.home, away: s.away });
function orient(srcHome, srcAway, triple) {
  const our = pairIndex.get([srcHome, srcAway].sort().join('|'));
  if (!our) return null;
  // triple 是 [srcHome胜, 平, srcAway胜]，按我方 home/away 摆正
  const flip = our.home !== srcHome;
  return { key: `${our.home} vs ${our.away}`, our, triple: flip ? [triple[2], triple[1], triple[0]] : triple };
}

const meta = {};            // key -> { espn, bovada, ah, ahFav, ou, venue }
function ensure(k) { return (meta[k] ||= {}); }

// ---------- 源1：ESPN ----------
async function fetchEspn() {
  const dates = [...new Set(schedule.map((m) => m.et.slice(0, 10).replace(/-/g, '')))];
  let n = 0;
  for (const d of dates) {
    let sb;
    try { sb = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${d}`); } catch { continue; }
    for (const ev of sb.events || []) {
      const comp = ev.competitions?.[0]; if (!comp) continue;
      const hC = comp.competitors.find((c) => c.homeAway === 'home');
      const aC = comp.competitors.find((c) => c.homeAway === 'away');
      if (!hC || !aC) continue;
      const eh = norm(hC.team.displayName), ea = norm(aC.team.displayName);
      if (!KNOWN.has(eh) || !KNOWN.has(ea)) continue;
      let od; try { od = await getJson(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/${ev.id}/competitions/${ev.id}/odds`); } catch { continue; }
      const it = (od.items || [])[0]; if (!it) continue;
      const hm = it.homeTeamOdds?.moneyLine, dm = it.drawOdds?.moneyLine, am = it.awayTeamOdds?.moneyLine;
      if (typeof hm !== 'number' || typeof dm !== 'number' || typeof am !== 'number') continue;
      const o = orient(eh, ea, [am2dec(hm), am2dec(dm), am2dec(am)]); if (!o) continue;
      const mt = ensure(o.key);
      mt.espn = o.triple.map((x) => +x.toFixed(2));
      // 让球线（ESPN spread 为主队视角，负=主队让球）；摆正到我方口径
      if (typeof it.spread === 'number') {
        const homeFav = it.spread < 0;
        const favSrc = homeFav ? eh : ea;
        mt.ah = Math.abs(it.spread);
        mt.ahFav = favSrc === o.our.home ? 'home' : 'away';
      }
      if (typeof it.overUnder === 'number') mt.ou = it.overUnder;
      const venue = comp.venue?.fullName, city = comp.venue?.address?.city;
      if (venue) mt.venue = city ? `${venue} / ${city}` : venue;

      // DraftKings 让球开盘→当前（用于多庄家异动）
      const fav = (it.homeTeamOdds?.open?.favorite || (typeof it.spread === 'number' && it.spread < 0)) ? it.homeTeamOdds : it.awayTeamOdds;
      const favIsHome = fav === it.homeTeamOdds;
      const psNum = (ps) => ps ? parseFloat(ps.american ?? ps.alternateDisplayValue) : null;
      const decOf = (s) => s ? (s.decimal ?? s.value ?? null) : null;
      mt.dk = {
        favKey: favIsHome ? eh : ea,
        hOpen: psNum(fav?.open?.pointSpread), hCur: psNum(fav?.current?.pointSpread) ?? (typeof it.spread === 'number' ? (favIsHome ? it.spread : -it.spread) : null),
        wOpen: decOf(fav?.open?.spread), wCur: decOf(fav?.current?.spread),
      };
      n++;
    }
  }
  return n;
}

// ---------- 源2：Bovada ----------
async function fetchBovada() {
  let groups;
  try { groups = await getJson('https://www.bovada.lv/services/sports/event/coupon/events/A/description/soccer/fifa-world-cup'); }
  catch (e) { console.log('  Bovada 拉取失败：' + e.message); return 0; }
  const evs = groups.flatMap((g) => g.events || []);
  let n = 0;
  for (const ev of evs) {
    const comps = ev.competitors || [];
    const homeC = comps.find((c) => c.home) || comps[0];
    const awayC = comps.find((c) => !c.home) || comps[1];
    if (!homeC || !awayC) continue;
    const bh = norm(homeC.name), ba = norm(awayC.name);
    if (!KNOWN.has(bh) || !KNOWN.has(ba)) continue;
    const mk = (ev.displayGroups?.[0]?.markets || []).find((m) => /3-Way Moneyline/i.test(m.description) && !/1H|2H/i.test(m.description));
    if (!mk) continue;
    const get = (re) => mk.outcomes.find((o) => re.test(o.description));
    const oh = get(new RegExp('^' + homeC.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))?.price?.decimal;
    const oa = get(new RegExp('^' + awayC.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))?.price?.decimal;
    const odr = get(/Draw/i)?.price?.decimal;
    if (!oh || !oa || !odr) continue;
    const o = orient(bh, ba, [+oh, +odr, +oa]); if (!o) continue;
    const mt = ensure(o.key);
    mt.bovada = o.triple.map((x) => +(+x).toFixed(2));
    // 大小球线（Bovada Total）交叉校验
    const tot = (ev.displayGroups?.[0]?.markets || []).find((m) => /^Total$/i.test(m.description));
    const ouLine = tot?.outcomes?.[0]?.price?.handicap;
    if (ouLine && mt.ou == null) mt.ou = +ouLine;
    // Bovada 让球线（Goal Spread）当前值，favorite=让球为负的一方
    const gs = (ev.displayGroups?.[0]?.markets || []).find((m) => /Goal Spread/i.test(m.description) && !/1H|2H/i.test(m.description));
    if (gs) {
      const favO = gs.outcomes.find((x) => parseFloat(x.price?.handicap) < 0);
      if (favO) mt.bov = { favKey: norm(favO.description), hCur: parseFloat(favO.price.handicap), wCur: parseFloat(favO.price.decimal) };
    }
    n++;
  }
  return n;
}

console.log('双源抓取：ESPN + Bovada（免 key）...');
const nE = await fetchEspn();
console.log(`  ESPN: ${nE} 场`);
const nB = await fetchBovada();
console.log(`  Bovada: ${nB} 场`);

// ---------- 多庄家盘口异动（快照历史持久化）----------
let history = {};
try { history = loadJson('data/odds-history.json').history || {}; } catch { /* 首次 */ }
const now = new Date().toISOString();
function mkBook(name, hO, hC, wO, wC) {
  let pan = '持平', water = '平水';
  if (hO != null && hC != null) { const d = Math.abs(hC) - Math.abs(hO); pan = d > 0.05 ? '升盘' : d < -0.05 ? '降盘' : '持平'; }
  if (wO != null && wC != null) { const d = wC - wO; water = d > 0.03 ? '高水' : d < -0.03 ? '低水' : '平水'; }
  return { name, hOpen: hO, hCur: hC, pan, water };
}
let movedMatches = 0;
for (const [k, m] of Object.entries(meta)) {
  // 记录本次快照（与上次不同才追加）
  history[k] ||= [];
  const snap = { ts: now, dk: m.dk ? { h: m.dk.hCur, w: m.dk.wCur } : null, bov: m.bov ? { h: m.bov.hCur, w: m.bov.wCur } : null };
  const last = history[k][history[k].length - 1];
  if (!last || JSON.stringify([last.dk, last.bov]) !== JSON.stringify([snap.dk, snap.bov])) history[k].push(snap);
  history[k] = history[k].slice(-12);

  // 各庄家异动：DraftKings 用自带开盘线；Bovada 用快照历史(首次=开盘)
  const books = [];
  if (m.dk && m.dk.hOpen != null && m.dk.hCur != null) books.push(mkBook('DraftKings', m.dk.hOpen, m.dk.hCur, m.dk.wOpen, m.dk.wCur));
  const bovSnaps = history[k].filter((s) => s.bov && s.bov.h != null);
  if (bovSnaps.length >= 1) { const o = bovSnaps[0].bov, c = bovSnaps[bovSnaps.length - 1].bov; books.push(mkBook('Bovada', o.h, c.h, o.w, c.w)); }
  if (!books.length) continue;

  const up = books.filter((b) => b.pan === '升盘').length, dn = books.filter((b) => b.pan === '降盘').length;
  const hi = books.filter((b) => b.water === '高水').length, lo = books.filter((b) => b.water === '低水').length;
  const sig = +(up - dn + 0.5 * (lo - hi)).toFixed(1);
  const favKey = (m.dk && m.dk.favKey) || (m.bov && m.bov.favKey);
  m.move = {
    favKey, books, up, dn, hi, lo, sig,
    read: sig > 0 ? '市场看好让球方' : sig < 0 ? '受让方有价值' : '盘口稳定',
  };
  if (up || dn) movedMatches++;
}
writeFileSync(join(ROOT, 'data', 'odds-history.json'), JSON.stringify({
  _note: '盘口线快照历史（每次 fetch-odds 追加），用于跨快照计算多庄家升降盘。', history,
}, null, 2), 'utf-8');
console.log(`  盘口异动：${movedMatches} 场有升/降盘（DraftKings 自带开盘线即时生效，Bovada 随多次运行累积）`);

// 合成共识（供模型用）+ 分歧标注
const odds = {};
let divergent = 0;
for (const [k, m] of Object.entries(meta)) {
  const srcs = [m.espn, m.bovada].filter(Boolean);
  if (!srcs.length) continue;
  // 元素级平均 decimal 作为共识
  const cons = [0, 1, 2].map((i) => +(srcs.reduce((s, o) => s + o[i], 0) / srcs.length).toFixed(2));
  odds[k] = cons;
  // 分歧：两源去水位后主胜概率差 > 6%
  if (m.espn && m.bovada) {
    const imp = (o) => { const t = 1 / o[0] + 1 / o[1] + 1 / o[2]; return 1 / o[0] / t; };
    m.diverge = Math.abs(imp(m.espn) - imp(m.bovada)) > 0.06;
    if (m.diverge) divergent++;
  }
}

const out = {
  _note: '双源真实赔率（ESPN + Bovada，免 key）。odds=两源共识(decimal)，供模型市场子模型。meta 含各源原值、让球线 ah、大小球线 ou、场地 venue、分歧标记 diverge。',
  _fetchedAt: new Date().toISOString(),
  odds, meta,
};
writeFileSync(join(ROOT, 'data', 'match-odds.json'), JSON.stringify(out, null, 2), 'utf-8');
console.log(`\n✓ 写入 ${Object.keys(odds).length} 场双源赔率（${divergent} 场双源分歧>6%）→ data/match-odds.json`);
console.log('  含让球线 / 大小球线 / 场地。下一步：node scripts/fetch-weather.mjs ; node scripts/build-html.mjs');
