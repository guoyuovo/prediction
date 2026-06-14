// 抓 Titan007（球探网）多庄家欧赔共识 → 写入 data/titan007-odds.json，并把命中的世界杯场次
// 合并进 data/match-odds.json 的 titan007 字段（与 ESPN+Bovada 双源并存，可交叉验证）。
//
// 零依赖：GBK 用 Node 内置 TextDecoder('gbk') 解码，无需 iconv-lite/cheerio。
// 端点（逆向自 titan007 站点）：
//   赛程ID:  http://data.titan007.com/soccer_scheduleid.js   （今日featured比赛ID列表）
//   欧赔feed: http://1x2d.titan007.com/<id>.js                 （英文队名/联赛 + game=Array(各庄家赔率)）
//             game 行: companyId|recId|公司名|初H|初D|初A|...|即H|即D|即A|... （字段10/11/12=即时1X2）
// 补充ID：data/manual/titan007-match-ids.csv（每行一个ID，可选，用于全72场覆盖；从 titan007 比赛页URL取）
//
// 用法：node scripts/fetch-titan007-odds.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36', Referer: 'http://1x2.titan007.com/' };
const GBK = new TextDecoder('gbk');

async function getText(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: HDR }); if (!r.ok) throw new Error('HTTP ' + r.status); return GBK.decode(new Uint8Array(await r.arrayBuffer())); }
    catch (e) { if (i === 3) throw e; await new Promise((res) => setTimeout(res, 700)); }
  }
}

// Titan007 英文队名 → 本项目 teams.json key（仅列不一致者）
const ALIAS = {
  'United States': 'USA', 'Korea Republic': 'South Korea', 'South Korea': 'South Korea',
  'Ivory Coast': "Cote d'Ivoire", "Cote d'Ivoire": "Cote d'Ivoire", 'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia', 'IR Iran': 'Iran',
  'Iran': 'Iran', 'Turkiye': 'Turkey', 'Türkiye': 'Turkey', 'Cape Verde Islands': 'Cape Verde',
  'Cabo Verde': 'Cape Verde', 'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo',
  'Democratic Rep Congo': 'DR Congo', 'DR Congo (Congo Kinshasa)': 'DR Congo', 'Curacao': 'Curacao',
};
const TEAMS = new Set(Object.keys(loadJson('data/teams.json').teams));
const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
function toKey(name) {
  const n = norm(name);
  if (ALIAS[n]) return ALIAS[n];
  if (TEAMS.has(n)) return n;
  // 宽松匹配：去掉 FC/National 等
  const n2 = n.replace(/\b(FC|National|Team)\b/gi, '').trim();
  if (TEAMS.has(n2)) return n2;
  return null;
}

// 解析 1x2d feed：返回 {home, away, league, time, consensus:[H,D,A], companies, move}
// move = 欧赔异动市场情绪（各庄 初赔f3-5 → 即时赔f10-12）：赔率走低=钱进=看好。
function parseFeed(t) {
  const get = (k) => (t.match(new RegExp(`${k}="([^"]*)"`)) || [])[1]; // 不要求 var 前缀（首行有 BOM 会污染 var）
  const home = get('hometeam'), away = get('guestteam'), league = get('matchname');
  const m = t.match(/var game=Array\(([\s\S]*?)\);/);
  if (!m) return null;
  const rows = m[1].split('","').map((s) => s.replace(/^"|"$/g, ''));
  const devig = (h, d, a) => { const x = 1 / h, y = 1 / d, z = 1 / a, s = x + y + z; return [x / s, z / s]; }; // [pHome,pAway]
  let sh = 0, sd = 0, sa = 0, n = 0, dHome = 0, nm = 0;
  for (const row of rows) {
    const f = row.split('|');
    const ih = +f[3], idr = +f[4], ia = +f[5], h = +f[10], d = +f[11], a = +f[12]; // 初H/D/A、即时H/D/A
    if (h > 1 && d > 1 && a > 1 && h < 100 && a < 1000) {
      sh += h; sd += d; sa += a; n++;
      if (ih > 1 && idr > 1 && ia > 1) { const [ph0] = devig(ih, idr, ia); const [ph1] = devig(h, d, a); dHome += ph1 - ph0; nm++; } // 隐含主胜概率 开盘→即时 漂移
    }
  }
  if (!n) return null;
  // 情绪信号：去水位隐含概率漂移（不受冷门大赔率噪声影响）。正=钱往主队移、负=往客队移。
  const drift = nm ? dHome / nm : 0; // 典型 ±0.005~0.03
  const signal = Math.max(-2, Math.min(2, Math.round(drift * 80 * 2) / 2));
  const lean = signal >= 0.5 ? '钱进主胜' : signal <= -0.5 ? '钱进客胜' : '中性';
  return { home, away, league, time: get('MatchTime'), consensus: [sh / n, sd / n, sa / n], companies: n,
    move: { driftHomeProb: +drift.toFixed(4), signal, lean } };
}

// 解析 OverDown_n.aspx（大小球）：返回 {line, lean, over, under}
function parseOU(t) {
  const rows = (t.match(/<tr[\s\S]*?<\/tr>/g) || []).filter((r) => /[0-9](?:\/[0-9.]+)?\b/.test(r) && /\b[01]\.\d{2}\b/.test(r) && r.length < 900);
  const lineCount = {}; let overW = 0, underW = 0, nn = 0, underCheaper = 0, overCheaper = 0;
  for (const r of rows) {
    const c = r.replace(/<[^>]+>/g, '\t').replace(/\t+/g, '\t').replace(/&[a-z]+;/g, '').split('\t').map((x) => x.trim()).filter(Boolean);
    // 期望 [盘口, 大球水, 小球水, time]
    const line = c[0], ow = +c[1], uw = +c[2];
    if (!/^\d+(?:\/\d+(?:\.\d+)?|\.\d+)?$/.test(line || '') || !(ow > 0.5 && ow < 2) || !(uw > 0.5 && uw < 2)) continue;
    lineCount[line] = (lineCount[line] || 0) + 1; overW += ow; underW += uw; nn++;
    if (uw < ow) underCheaper++; else if (ow < uw) overCheaper++;
  }
  if (!nn) return null;
  const line = Object.entries(lineCount).sort((a, b) => b[1] - a[1])[0][0]; // 众数盘口
  const lean = underCheaper > overCheaper * 1.2 ? '小球' : overCheaper > underCheaper * 1.2 ? '大球' : '中性';
  return { line, lean, over: +(overW / nn).toFixed(2), under: +(underW / nn).toFixed(2), samples: nn };
}

// 并发抓取池
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } })); return out; }
// 只取队名/联赛（轻量，扫段判定 WC 用）
function peekFeed(t) { const g = (k) => (t.match(new RegExp(`${k}="([^"]*)"`)) || [])[1]; return { league: g('matchname'), home: g('hometeam'), away: g('guestteam') }; }

async function main() {
  const argFrom = (process.argv.find((a) => a.startsWith('--from=')) || '').split('=')[1];
  const argTo = (process.argv.find((a) => a.startsWith('--to=')) || '').split('=')[1];

  // 1) 种子 ID：今日featured（含若干WC）+ 手填CSV
  const sched = await getText('http://data.titan007.com/soccer_scheduleid.js');
  let seeds = [...new Set((sched.match(/\d{6,}/g) || []))].map(Number);
  const csv = join(ROOT, 'data', 'manual', 'titan007-match-ids.csv');
  if (existsSync(csv)) seeds.push(...readFileSync(csv, 'utf8').split(/[\r\n,]+/).map((s) => s.trim()).filter((s) => /^\d{6,}$/.test(s)).map(Number));

  // 2) 找出 WC 种子，据此定位扫描窗口（WC 比赛 ID 集中在一个带内）
  const seedFeeds = await pool([...new Set(seeds)], 14, async (id) => { const t = await getText(`http://1x2d.titan007.com/${id}.js`); return { id, ...peekFeed(t) }; });
  const wcSeeds = seedFeeds.filter((f) => f && /world cup/i.test(f.league || '')).map((f) => f.id);
  let from, to;
  if (argFrom && argTo) { from = +argFrom; to = +argTo; }
  else if (wcSeeds.length) { from = Math.min(...wcSeeds) - 15; to = Math.min(...wcSeeds) + 720; } // 覆盖全部 72 场分布带（含 md3，ID 跨度约 +670）
  else { console.log('未发现 WC 种子，且未给 --from/--to，仅用种子ID。可手填 CSV 或传范围。'); from = to = null; }

  // 3) 扫段 + 种子，抓 1x2d feed 解析（只留 WC 或能映射到我方的）
  const idset = new Set([...new Set(seeds)]);
  if (from && to) for (let i = from; i <= to; i++) idset.add(i);
  const ids = [...idset];
  console.log(`扫描 ${ids.length} 个 ID（窗口 ${from}~${to}），抓取中...`);

  const out = {};
  const parsed = await pool(ids, 16, async (id) => { const t = await getText(`http://1x2d.titan007.com/${id}.js`); return { id, feed: parseFeed(t) }; });
  let wc = 0, mapped = 0;
  for (const r of parsed) {
    if (!r || !r.feed) continue; const feed = r.feed;
    const isWC = /world cup/i.test(feed.league || '');
    const hk = toKey(feed.home), ak = toKey(feed.away);
    if (!isWC && !(hk && ak)) continue;
    if (isWC) wc++;
    const key = `${hk || feed.home} vs ${ak || feed.away}`;
    out[key] = { id: r.id, league: feed.league, home: feed.home, away: feed.away, homeKey: hk, awayKey: ak, titan007: feed.consensus.map((x) => +x.toFixed(4)), companies: feed.companies, move: feed.move };
    if (hk && ak) mapped++;
  }
  console.log(`解析成功，其中 World Cup 场次 ${wc}，可映射到我方48队 ${mapped}`);

  // 2.5) 大小球：对保留场次抓 OverDown 页解析（可 --no-ou 跳过；页较大，仅对已保留的场次抓）
  if (!process.argv.includes('--no-ou')) {
    const entries = Object.values(out);
    process.stdout.write(`抓大小球(OverDown) ${entries.length} 场...`);
    let ouN = 0;
    await pool(entries, 8, async (v) => { try { const ou = parseOU(new TextDecoder('utf-8').decode(await (await fetch(`http://vip.titan007.com/OverDown_n.aspx?id=${v.id}`, { headers: HDR })).arrayBuffer())); if (ou) { v.ou = ou; ouN++; } } catch { /* */ } });
    console.log(` 成功 ${ouN}`);
  }

  // 3) 写 data/titan007-odds.json
  writeFileSync(join(ROOT, 'data', 'titan007-odds.json'),
    JSON.stringify({ _note: 'Titan007 多庄家欧赔共识（即时1X2均值）。companies=参与取均的庄家数。', _fetchedAt: new Date().toISOString(), odds: out }, null, 2));

  // 4) 合并进 match-odds.json 的 titan007 字段（仅能映射到我方对阵的）
  const moPath = join(ROOT, 'data', 'match-odds.json');
  const mo = loadJson('data/match-odds.json');
  mo.odds = mo.odds || {};
  let merged = 0;
  for (const v of Object.values(out)) {
    if (!v.homeKey || !v.awayKey) continue;
    const k1 = `${v.homeKey} vs ${v.awayKey}`;
    if (mo.meta && mo.meta[k1]) { mo.meta[k1].titan007 = v.titan007; mo.meta[k1].titan007Companies = v.companies; mo.meta[k1].titan007Market = { move: v.move, ou: v.ou || null }; }
    // 优先用 Titan007 共识喂模型（覆盖 odds 字段；ESPN+Bovada 仍留在 meta 供交叉验证）
    if (mo.meta && mo.meta[k1]) { mo.meta[k1].espnBovada = mo.odds[k1] || mo.meta[k1].espn || null; mo.meta[k1].oddsSource = 'titan007'; }
    mo.odds[k1] = v.titan007.map((x) => +x.toFixed(4));
    merged++;
  }
  if (merged) { mo._titan007MergedAt = new Date().toISOString(); mo._oddsPriority = 'Titan007 共识优先（合并自 titan007-odds.json）；缺失场次回退 ESPN+Bovada'; writeFileSync(moPath, JSON.stringify(mo, null, 2)); }

  console.log(`✓ 写入 data/titan007-odds.json（${Object.keys(out).length} 场）`);
  console.log(`✓ 合并进 match-odds.json 的 titan007 字段：${merged} 场`);
  // 打印命中的世界杯场次
  const wcRows = Object.values(out).filter((v) => /world cup/i.test(v.league || ''));
  if (wcRows.length) { console.log('\n命中世界杯场次：'); for (const v of wcRows) console.log(`  ${(v.home + ' vs ' + v.away).padEnd(34)} 共识 ${v.titan007.map((x) => x.toFixed(2)).join('/')}  (${v.companies}家)  ${v.homeKey && v.awayKey ? '✓映射' : '✗未映射'}`); }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
