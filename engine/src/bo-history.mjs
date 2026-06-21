// 「搏」推荐历史:逐日存档【每场·每玩法的推荐单】(胜平负/波胆/进球数/半全场 × 稳搏/激进)
//   → 按赛果结算 → 供前端按 玩法+风险+状态 筛选查询。
//   存储 engine/data/bo-history.json(随仓库提交,跨 CI 运行持久累积)。
//   一条 = 一个稳定 id(play#risk#对阵);同一场同玩法同风险多日重复推荐只记一次(保留首次推荐的选项与赔率)。
//   结算:该场有赛果即结算,各玩法规则:
//     had  赛果1X2==推荐  | crs  比分 hs-as==推荐 | ttg  总进球(7+封顶)==推荐 | hafu 半场+全场1X2 组合==推荐
//   口径诚实:胜率=已结算命中率;赔率=推荐时赔率;ROI=每注押1单位净回报率。仅娱乐参考。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './util.mjs';

const FILE = join(ROOT, 'data', 'bo-history.json');
const RISKS = ['steady', 'aggressive'];
const o1x2 = (h, a) => (h > a ? 'h' : h === a ? 'd' : 'a'); // 小写:用于 hafu 组合
const O1X2 = (h, a) => o1x2(h, a).toUpperCase();            // 大写 H/D/A:用于 had

function load() {
  if (!existsSync(FILE)) return { picks: {} };
  try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return { picks: {} }; }
}

// 单条推荐 + 该场赛果 r{hs,as,ht} → {actualSel, hit} | null(无法结算)
function settleOne(play, sel, r) {
  if (r.hs == null || r.as == null) return null;
  if (play === 'had') { const a = O1X2(r.hs, r.as); return { actualSel: a, hit: a === sel }; }
  if (play === 'crs') { const a = `${r.hs}-${r.as}`; return { actualSel: a, hit: a === sel }; }
  if (play === 'ttg') { const t = r.hs + r.as; const a = t >= 7 ? '7+' : String(t); return { actualSel: a, hit: a === sel }; }
  if (play === 'hafu') {
    const [hh, ha] = String(r.ht || '').split('-').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(ha)) return null; // 无半场比分 → 暂不结算
    const a = o1x2(hh, ha) + o1x2(r.hs, r.as);
    return { actualSel: a, hit: a === sel };
  }
  return null;
}

function agg(picks) {
  const settled = picks.filter((p) => p.status !== 'pending');
  const win = settled.filter((p) => p.status === 'win');
  const ret = win.reduce((s, p) => s + p.odds, 0);
  const winOdds = win.map((p) => p.odds);
  return {
    total: picks.length, settled: settled.length, pending: picks.length - settled.length,
    win: win.length, lose: settled.length - win.length,
    winRate: settled.length ? +(win.length / settled.length).toFixed(3) : null,
    roi: settled.length ? +((ret - settled.length) / settled.length).toFixed(3) : null,
    avgWinOdds: winOdds.length ? +(winOdds.reduce((a, b) => a + b, 0) / winOdds.length).toFixed(2) : null,
  };
}

// legCandidates:build-bo 的四玩法逐场候选腿(每条带 play/home/away/date/rec{steady,aggressive}/options)
// resultsIndex:Map<"Home vs Away", {hs,as,ht}>
// 返回注入 payload 的 history(items 全量 + 简要 overall);副作用:写回 bo-history.json
export function archiveAndSettle(legCandidates, resultsIndex, today) {
  const db = load();
  db.picks ||= {};

  // 1) 存档:每场·每玩法·每风险的推荐单(新条目才记,旧的仅更新 lastSeen)
  for (const lc of legCandidates || []) {
    const matchKey = `${lc.home} vs ${lc.away}`;
    for (const risk of RISKS) {
      const sel = lc.rec && lc.rec[risk];
      if (!sel) continue;
      const opt = (lc.options || []).find((o) => o.sel === sel);
      if (!opt) continue;
      const id = `${lc.play}#${risk}#${matchKey}`;
      const ex = db.picks[id];
      if (ex) { ex.lastSeen = today; continue; }
      db.picks[id] = {
        id, play: lc.play, risk, matchKey, home: lc.home, away: lc.away, date: lc.date || null,
        sel, selZh: opt.selZh, odds: opt.odds, q: opt.q != null ? opt.q : null,
        firstSeen: today, lastSeen: today,
        status: 'pending', settledAt: null, actualSel: null, actualScore: null, hit: null,
      };
    }
  }

  // 2) 结算:该场有赛果的待结算单
  for (const p of Object.values(db.picks)) {
    if (p.status !== 'pending') continue;
    const r = resultsIndex.get(p.matchKey);
    if (!r) continue;
    const s = settleOne(p.play, p.sel, r);
    if (!s) continue;
    p.actualSel = s.actualSel;
    p.actualScore = `${r.hs}-${r.as}`;
    p.hit = s.hit;
    p.status = s.hit ? 'win' : 'lose';
    p.settledAt = today;
  }

  db._note = '「搏」每场·每玩法推荐单历史(逐日存档+按赛果结算)。一条=play#risk#对阵;胜率=已结算命中率;赔率=推荐时。仅娱乐参考。';
  db.updatedAt = today;
  writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf-8');

  // 3) 注入 payload:全量 items(按比赛日升序,"从第一场开始") + 总览(前端再按 玩法/风险 现算)
  const all = Object.values(db.picks).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.play.localeCompare(b.play));
  return { overall: agg(all), items: all };
}
