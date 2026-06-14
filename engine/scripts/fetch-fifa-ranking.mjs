// 抓真实 FIFA 积分（实时官方接口）+ 应用真实 Transfermarkt 身价快照 → 写回 data/teams.json。
//
//   FIFA：https://api.fifa.com/api/v3/fifarankings/rankings/live（免 key，实时官方排名/积分）
//   身价：data/manual/squad-values-transfermarkt.json（无免费 API，人工录入的真实 TM 快照，£M ×1.17 折 €M）
//
// 只覆盖 fifa / value 两列，elo/form（build-elo.mjs 真算）原样保留。
//
//   node scripts/fetch-fifa-ranking.mjs

import { readFileSync, writeFileSync } from 'fs';

const FIFA_URL = 'https://api.fifa.com/api/v3/fifarankings/rankings/live?gender=1&sportType=0&language=en';

// FIFA 接口队名 → 本项目 teams.json key（仅列出与 key 不同名者，其余同名直接命中）
const FIFA_ALIAS = {
  'IR Iran': 'Iran',
  'Korea Republic': 'South Korea',
  'Türkiye': 'Turkey',
  "Côte d'Ivoire": "Cote d'Ivoire",
  'Congo DR': 'DR Congo',
  'Bosnia and Herzegovina': 'Bosnia',
  'Cabo Verde': 'Cape Verde',
  'Curaçao': 'Curacao',
  'United States': 'USA',
};

const GBP_TO_EUR = 1.17;

async function main() {
  const teamsPath = 'data/teams.json';
  const db = JSON.parse(readFileSync(teamsPath, 'utf8'));
  const keys = new Set(Object.keys(db.teams));

  // ── 1) FIFA 积分（实时） ──────────────────────────────
  const res = await fetch(FIFA_URL, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
  if (!res.ok) throw new Error(`FIFA 接口失败：HTTP ${res.status}`);
  const json = await res.json();

  let fifaHit = 0;
  const missFifa = new Set(keys);
  for (const t of json.Results) {
    const raw = t.TeamName?.[0]?.Description;
    if (!raw) continue;
    const key = FIFA_ALIAS[raw] || raw;
    if (!keys.has(key)) continue;
    db.teams[key].fifa = Math.round(t.TotalPoints);
    db.teams[key].fifaRank = t.Rank;
    missFifa.delete(key);
    fifaHit++;
  }

  // ── 2) Transfermarkt 身价（真实快照） ─────────────────
  const vsnap = JSON.parse(readFileSync('data/manual/squad-values-transfermarkt.json', 'utf8'));
  let valHit = 0;
  const missVal = new Set(keys);
  for (const [key, gbpM] of Object.entries(vsnap.values)) {
    if (!keys.has(key)) { console.warn(`  ⚠ 身价快照含未知队名：${key}`); continue; }
    db.teams[key].value = Math.round(gbpM * GBP_TO_EUR); // £M → €M
    missVal.delete(key);
    valHit++;
  }

  // ── 写回 ──────────────────────────────────────────────
  db._fifaSource = 'api.fifa.com/v3 fifarankings/live（实时官方真实）';
  db._valueSource = `Transfermarkt 衍生快照 ${vsnap._fetchedAt}（${vsnap._source}）`;
  db._extrasFetchedAt = new Date().toISOString();
  db._note = '2026 世界杯 48 强。elo/form 由 build-elo.mjs 从 ~4.9 万场国际比赛历史按标准 Elo 真算；fifa 由 fetch-fifa-ranking.mjs 抓 FIFA 官方实时接口（真实）；value 为 Transfermarkt 衍生身价快照（真实，人工录入，£M×1.17 折 €M）。';

  writeFileSync(teamsPath, JSON.stringify(db, null, 2) + '\n');

  console.log(`✓ FIFA 积分：命中 ${fifaHit}/48${missFifa.size ? '，缺：' + [...missFifa].join(', ') : ''}`);
  console.log(`✓ 身价快照：命中 ${valHit}/48${missVal.size ? '，缺：' + [...missVal].join(', ') : ''}`);
  console.log(`✓ 已写回 ${teamsPath}`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
