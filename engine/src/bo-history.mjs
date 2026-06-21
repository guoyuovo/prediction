// 「搏·串关」系统荐彩历史:逐日存档系统搏推荐 → 按赛果结算 → 汇总胜率/赔率,供前端查询。
//   存储 engine/data/bo-history.json(随仓库提交,跨 CI 运行持久累积)。
//   一注 = 一个稳定 id(risk#tier#已排序的腿键),同一注多日重复推荐只记一次(保留首次推荐时的赔率)。
//   结算:一注的全部腿都有赛果时即结算;每腿命中=赛果1X2==推荐选项,整注命中=全腿命中(串关全中才算赢)。
//   口径诚实:胜率=已结算命中/已结算总数;赔率=推荐时连乘赔率;ROI=每注押1单位的净回报率(恒为娱乐参考)。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './util.mjs';

const FILE = join(ROOT, 'data', 'bo-history.json');
const outcome = (hs, as) => (hs > as ? 'H' : hs === as ? 'D' : 'A'); // 1X2 赛果

function load() {
  if (!existsSync(FILE)) return { picks: {} };
  try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return { picks: {} }; }
}

const pickId = (risk, tier, legKeys) => `${risk}#${tier}#${[...legKeys].sort().join(',')}`;

// 汇总一组已结算注的胜率/赔率/ROI
function agg(picks) {
  const settled = picks.filter((p) => p.status !== 'pending');
  const win = settled.filter((p) => p.status === 'win');
  const ret = win.reduce((s, p) => s + p.odds, 0);          // 每注押 1,赢则回 odds
  const winOdds = win.map((p) => p.odds);
  return {
    total: picks.length,
    settled: settled.length,
    pending: picks.length - settled.length,
    win: win.length,
    lose: settled.length - win.length,
    winRate: settled.length ? +(win.length / settled.length).toFixed(3) : null,
    roi: settled.length ? +((ret - settled.length) / settled.length).toFixed(3) : null, // 净回报率
    avgWinOdds: winOdds.length ? +(winOdds.reduce((a, b) => a + b, 0) / winOdds.length).toFixed(2) : null,
  };
}

// systemByRisk: { steady:{singles,parlays}, aggressive:{singles,parlays} }
// resultsIndex: Map<"Home vs Away", {hs,as}>
// 返回注入 payload 的 history 摘要;副作用:写回 bo-history.json
export function archiveAndSettle(systemByRisk, resultsIndex, today) {
  const db = load();
  db.picks ||= {};

  // 1) 存档当前系统搏推荐(新注才记,旧注仅更新 lastSeen)
  for (const risk of Object.keys(systemByRisk)) {
    const sys = systemByRisk[risk] || {};
    for (const pk of [...(sys.singles || []), ...(sys.parlays || [])]) {
      const id = pickId(risk, pk.tier, pk.legKeys);
      const ex = db.picks[id];
      if (ex) { ex.lastSeen = today; continue; }
      db.picks[id] = {
        id, risk, tier: pk.tier, tag: pk.tag,
        odds: pk.odds, pAdj: pk.pAdj,
        legs: pk.legs.map((l) => ({ key: l.key, home: l.home, away: l.away, sel: l.sel, selZh: l.selZh, odds: l.odds })),
        firstSeen: today, lastSeen: today,
        status: 'pending', settledAt: null, legResults: null,
      };
    }
  }

  // 2) 结算:全部腿都有赛果的待结算注
  for (const p of Object.values(db.picks)) {
    if (p.status !== 'pending') continue;
    const res = p.legs.map((l) => ({ l, r: resultsIndex.get(l.key) }));
    if (res.some((x) => !x.r)) continue; // 还有腿未完赛
    const legResults = res.map(({ l, r }) => {
      const actualSel = outcome(r.hs, r.as);
      return { key: l.key, sel: l.sel, selZh: l.selZh, actualSel, actualScore: `${r.hs}-${r.as}`, hit: actualSel === l.sel };
    });
    p.legResults = legResults;
    p.status = legResults.every((x) => x.hit) ? 'win' : 'lose';
    p.settledAt = today;
  }

  db._note = '「搏·串关」系统荐彩历史(逐日存档+按赛果结算)。一注=risk#tier#腿键;胜率=已结算命中率;赔率=推荐时连乘。仅娱乐参考。';
  db.updatedAt = today;
  writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf-8');

  // 3) 构建注入 payload 的摘要(全部待结算 + 最近 150 注已结算)
  const all = Object.values(db.picks);
  const summary = {
    overall: agg(all),
    byRisk: { steady: agg(all.filter((p) => p.risk === 'steady')), aggressive: agg(all.filter((p) => p.risk === 'aggressive')) },
    byTier: Object.fromEntries([1, 2, 3, 4].map((t) => [t, agg(all.filter((p) => p.tier === t))])),
  };
  const settled = all.filter((p) => p.status !== 'pending').sort((a, b) => (b.settledAt || '').localeCompare(a.settledAt || '')).slice(0, 150);
  const pending = all.filter((p) => p.status === 'pending').sort((a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
  return { summary, items: [...pending, ...settled] };
}
