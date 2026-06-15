// live-rec(云对象,滚球实时推荐)：前端点击某场 → get(seq)。
//   赛前 λ(wc_payload.matches[].eg) + ESPN 实时比分 → 条件泊松 → 实时胜平负/大小球。
//   ⚠ 仅作参考，绝不修改赛前预测。手动触发 + 60s 服务端缓存(并发点击塌缩成 1 次抓取)。
//   ESPN 字段沿用 fetch-results 已验证结构；live 专有字段(displayClock 等)部署后看真实响应微调。
const db = uniCloud.database();
const dbCmd = db.command;
const TTL = 60 * 1000;
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=';

// ESPN 队名 → 本项目规范名(与 fetch-results 一致)
const ESPN2CANON = {
  'United States': 'USA', USA: 'USA',
  'Bosnia-Herzegovina': 'Bosnia', 'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia',
  'Czech Republic': 'Czechia', Czechia: 'Czechia',
  "Côte d'Ivoire": "Cote d'Ivoire", 'Ivory Coast': "Cote d'Ivoire",
  'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo',
  'Curaçao': 'Curacao', 'Cape Verde Islands': 'Cape Verde', 'Cabo Verde': 'Cape Verde',
  'IR Iran': 'Iran', 'Korea Republic': 'South Korea',
  'Türkiye': 'Turkey', Turkiye: 'Turkey',
};
const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const canon = (n) => {
  if (!n) return n;
  if (ESPN2CANON[n]) return ESPN2CANON[n];
  const a = stripAccents(n);
  for (const [k, v] of Object.entries(ESPN2CANON)) if (stripAccents(k) === a) return v;
  return n;
};
const round = (x) => Math.round(x * 1000) / 1000;

function poisson(lambda, k) { let p = Math.exp(-lambda); for (let i = 1; i <= k; i++) p *= lambda / i; return p; }

// 一次剩余进球卷积，导出全部实时指标：胜平负 / 多档大小球 / 还会进球 / 下个进球 / 终场Top比分 / 预期进球
function analyze(gh, ga, lh, la) {
  const N = 10, ph = [], pa = [];
  for (let i = 0; i <= N; i++) { ph[i] = poisson(lh, i); pa[i] = poisson(la, i); }
  let pH = 0, pD = 0, pA = 0, moreGoals = 0;
  const scoreProb = {}, totalProb = {};
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const w = ph[i] * pa[j];
    const fh = gh + i, fa = ga + j;
    if (fh > fa) pH += w; else if (fh === fa) pD += w; else pA += w;
    scoreProb[`${fh}-${fa}`] = (scoreProb[`${fh}-${fa}`] || 0) + w;
    totalProb[fh + fa] = (totalProb[fh + fa] || 0) + w;
    if (i + j > 0) moreGoals += w;
  }
  const overFor = (line) => { let o = 0; for (const t in totalProb) if (+t > line) o += totalProb[t]; return o; };
  const topScores = Object.entries(scoreProb).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, p]) => ({ score: s, p: round(p) }));
  const nh = (lh + la) > 0 ? lh / (lh + la) : 0.5;
  const p = [round(pH), round(pD), round(pA)];
  const ou = [1.5, 2.5, 3.5].map((line) => ({ line, over: round(overFor(line)) }));
  const lean = `${p[0] >= p[1] && p[0] >= p[2] ? '倾向主胜' : (p[2] >= p[1] ? '倾向客胜' : '倾向平局')}·${overFor(2.5) >= 0.5 ? '大球' : '小球'}`;
  return {
    p, ou, lean,
    moreGoals: round(moreGoals),          // 还会不会再进球
    nextGoal: [round(nh), round(1 - nh)],  // 下个进球归属(主/客)
    topScores,                             // 最可能终场比分 Top3
    expFinal: [round(gh + lh), round(ga + la)], // 两队最终预期进球
  };
}

function ymd(s) { return (s || '').slice(0, 10).replace(/-/g, ''); }
function shiftDay(yyyymmdd, delta) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6), d = +yyyymmdd.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`;
}
const redOf = (c) => (c.statistics || []).reduce((n, s) => n + (/redCard/i.test(s.name) ? (+s.displayValue || 0) : 0), 0);
const dirOf = (p) => (p[0] >= p[1] && p[0] >= p[2] ? 'H' : (p[2] >= p[1] ? 'A' : 'D'));

// 从云存储拉 payload(取赛前 λ + 完赛结果)。配环境变量 PAYLOAD_URL(同前端 REMOTE_URL)。
// 前端 hint 为回退：未配 PAYLOAD_URL 时直接用页面已有场次数据。
const PAYLOAD_URL = process.env.PAYLOAD_URL || '';
async function getPayload() {
  if (!PAYLOAD_URL) return null;
  try {
    const r = await uniCloud.httpclient.request(PAYLOAD_URL, { method: 'GET', dataType: 'json', timeout: 10000 });
    return r.data;
  } catch (e) { return null; }
}

/** @param {string|number} seq @param {object|null} payload @param {object|null} hint */
function resolveMatch(seq, payload, hint) {
  const ms = (payload && payload.matches && payload.matches.matches) || [];
  const fromPayload = ms.find((m) => String(m.seq) === String(seq));
  if (fromPayload) return fromPayload;
  if (hint && hint.home && hint.away) {
    return {
      seq,
      home: hint.home,
      away: hint.away,
      kickoff: hint.kickoff || hint.date,
      date: hint.date,
      eg: hint.eg || '0-0',
      ou: hint.ou,
    };
  }
  return null;
}

/** ESPN 未收录时返回赛前基线（0-0 + 全场 λ） */
function preBaseline(match) {
  const [lh0, la0] = String(match.eg || '0-0').split('-').map(Number);
  const a = analyze(0, 0, lh0, la0);
  return {
    seq: match.seq, updatedAt: Date.now(), state: 'pre', minute: 0,
    score: [0, 0], redCards: [0, 0],
    p: a.p, ou: a.ou, moreGoals: a.moreGoals, nextGoal: a.nextGoal,
    topScores: a.topScores, expFinal: a.expFinal, lean: a.lean,
    note: '赛前基线（ESPN 暂无该场）·参考·不改赛前预测',
  };
}

module.exports = {
  async get(seq, hint) {
    // 1) 缓存命中(<60s)直接返回
    try {
      const c = await db.collection('wc_live_cache').where({ seq }).orderBy('updatedAt', 'desc').limit(1).get();
      if (c.data && c.data[0] && Date.now() - c.data[0].updatedAt < TTL) return { code: 0, cached: true, data: c.data[0] };
    } catch (e) { /* 集合不存在则继续 */ }

    // 2) 从 payload 或前端 hint 取该场赛前 λ
    const payload = await getPayload();
    const match = resolveMatch(seq, payload, hint);
    if (!match) return { code: 1, msg: '无此场次数据（请刷新页面后重试）' };
    const [lh0, la0] = String(match.eg || '0-0').split('-').map(Number);
    const ouLine = (match.ou && match.ou.line) != null ? match.ou.line : 2.5;

    // 3) 抓 ESPN 当天计分板(容时区，查 ±1 天)，按队名匹配本场
    let ev = null;
    const base = ymd(match.kickoff || match.date);
    for (const day of [base, shiftDay(base, -1), shiftDay(base, 1)]) {
      try {
        const j = await uniCloud.httpclient.request(ESPN_SCOREBOARD + day, { method: 'GET', dataType: 'json', timeout: 15000 });
        const events = (j.data && j.data.events) || [];
        ev = events.find((e) => {
          const cs = (e.competitions && e.competitions[0] && e.competitions[0].competitors) || [];
          const names = cs.map((c) => canon((c.team || {}).displayName || (c.team || {}).shortDisplayName || ''));
          return names.includes(match.home) && names.includes(match.away);
        });
        if (ev) break;
      } catch (e) { /* 单天失败继续 */ }
    }
    if (!ev) {
      // ESPN 尚未收录（未开赛/未列入）→ 返回赛前基线，而非直接失败
      const rec = preBaseline(match);
      try {
        await db.collection('wc_live_cache').add(rec);
        await db.collection('wc_live_cache').where({ seq, updatedAt: dbCmd.lt(rec.updatedAt) }).remove();
      } catch (e) {}
      return { code: 0, cached: false, preOnly: true, data: rec };
    }

    // 4) 解析实时状态
    const comp = ev.competitions[0];
    const state = ev.status && ev.status.type && ev.status.type.state; // pre / in / post
    const cs = comp.competitors;
    const homeC = cs.find((c) => c.homeAway === 'home') || cs[0];
    const awayC = cs.find((c) => c !== homeC);
    const gh = parseInt(homeC.score) || 0, ga = parseInt(awayC.score) || 0;
    const reds = [redOf(homeC), redOf(awayC)];
    const minute = parseInt((ev.status && ev.status.displayClock) || '') || Math.round(((ev.status && ev.status.clock) || 0) / 60);

    // 5) 条件泊松：剩余时间比例 × 赛前 λ（红牌打折），导出全套实时指标
    const f = state === 'post' ? 0 : Math.max(0, Math.min(1, (90 - minute) / 90));
    let lh = lh0 * f, la = la0 * f;
    if (reds[0] > 0) lh *= 0.7;            // 主队少人 → 进攻打折
    if (reds[1] > 0) la *= 0.7;
    const a = analyze(gh, ga, lh, la);

    const rec = {
      seq, updatedAt: Date.now(), state: state || 'unknown', minute,
      score: [gh, ga], redCards: reds,
      p: a.p,                  // 实时胜平负
      ou: a.ou,                // 多档大小球 [{line,over}]
      moreGoals: a.moreGoals,  // 还会再进球的概率
      nextGoal: a.nextGoal,    // 下个进球归属 [主,客]
      topScores: a.topScores,  // 最可能终场比分 Top3
      expFinal: a.expFinal,    // 两队最终预期进球
      lean: a.lean, note: '参考·不改赛前预测',
    };

    // 6) 写缓存(留最新)
    try {
      await db.collection('wc_live_cache').add(rec);
      await db.collection('wc_live_cache').where({ seq, updatedAt: dbCmd.lt(rec.updatedAt) }).remove();
    } catch (e) {}

    // 7) 入库:仅在比赛进行中(state='in')记录推荐快照,供事后核算胜率
    if (state === 'in') {
      try {
        await db.collection('wc_live_log').add({
          seq, minute, ts: rec.updatedAt, score: rec.score,
          p: rec.p, dir: dirOf(rec.p),
          over25: (a.ou.find((o) => o.line === 2.5) || {}).over,
        });
      } catch (e) {}
    }

    return { code: 0, cached: false, data: rec };
  },

  // 滚球推荐胜率核算:把已完赛场次的历史推荐快照 vs 实际结果对账
  async stats() {
    const payload = await getPayload();
    const ms = (payload && payload.matches && payload.matches.matches) || [];
    const res = {};
    for (const m of ms) if (m.result) res[m.seq] = { dir: m.result.r, total: (m.result.hs || 0) + (m.result.as || 0) };
    const finishedSeqs = Object.keys(res).map(Number);
    if (!finishedSeqs.length) return { code: 0, samples: 0, msg: '暂无已完赛场次' };

    let logs = [];
    try {
      const r = await db.collection('wc_live_log').where({ seq: dbCmd.in(finishedSeqs) }).limit(1000).get();
      logs = r.data || [];
    } catch (e) {}

    let n = 0, dirHit = 0, ouHit = 0, brier = 0;
    const phase = { '0-30': { n: 0, h: 0 }, '30-60': { n: 0, h: 0 }, '60-90': { n: 0, h: 0 } };
    for (const L of logs) {
      const r = res[L.seq]; if (!r) continue;
      n++;
      const dh = L.dir === r.dir; if (dh) dirHit++;
      const overPred = (L.over25 || 0) >= 0.5, overAct = r.total > 2.5;
      if (overPred === overAct) ouHit++;
      const act = [r.dir === 'H' ? 1 : 0, r.dir === 'D' ? 1 : 0, r.dir === 'A' ? 1 : 0];
      brier += (L.p || [0, 0, 0]).reduce((s, pi, i) => s + (pi - act[i]) ** 2, 0);
      const ph = L.minute < 30 ? '0-30' : L.minute < 60 ? '30-60' : '60-90';
      phase[ph].n++; if (dh) phase[ph].h++;
    }
    const round = (x) => Math.round(x * 1000) / 1000;
    return {
      code: 0, samples: n,
      dirHitRate: n ? round(dirHit / n) : null,   // 胜平负方向命中率
      ouHitRate: n ? round(ouHit / n) : null,      // 大小球(2.5)命中率
      brierAvg: n ? round(brier / n) : null,       // 越低越好(三路盲猜≈0.667)
      byPhase: phase,                              // 按比赛阶段分桶(越早越难)
    };
  },
};
