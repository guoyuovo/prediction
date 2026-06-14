// 浏览器抓取层：直连 CORS 开放的源(ESPN 计分板),拿"已完赛真实比分"。
//   移植自 engine/scripts/fetch-results.mjs 的解析,改用浏览器全局 fetch(Node18+ 也有,可直接测)。
//   输出形如 wc-results.json：{ results:[{date,et,group,home,away,hs,as,htHome,htAway,...}], _source, _fetchedAt }
//   纯函数,无 node:*;入参 fixtures(赛程) + canonNames(48 强规范名),均来自打包种子。

const ESPN_SB = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=';
const ESPN_SUM = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=';
const H = { 'User-Agent': 'Mozilla/5.0' };

const ESPN2CANON = {
  'United States': 'USA', USA: 'USA',
  'Bosnia-Herzegovina': 'Bosnia', 'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia',
  Czechia: 'Czechia', 'Czech Republic': 'Czechia',
  "Côte d'Ivoire": "Cote d'Ivoire", 'Ivory Coast': "Cote d'Ivoire",
  'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo',
  'Curaçao': 'Curacao', 'Cape Verde Islands': 'Cape Verde', 'Cabo Verde': 'Cape Verde',
  'IR Iran': 'Iran', 'Korea Republic': 'South Korea', 'South Korea': 'South Korea',
  'Türkiye': 'Turkey', Turkiye: 'Turkey', Turkey: 'Turkey',
};
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
function toCanon(name, canonSet) {
  if (ESPN2CANON[name]) return ESPN2CANON[name];
  if (canonSet.has(name)) return name;
  const a = stripAccents(name);
  for (const c of canonSet) if (stripAccents(c) === a) return c;
  return null;
}

async function getJson(url) {
  const r = await fetch(url, { headers: H });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function dateRange(startISO, now) {
  const out = [];
  let d = new Date(startISO + 'T00:00:00Z');
  const today = now || new Date();
  while (d <= today) {
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

async function fetchSummary(eventId) {
  try {
    const j = await getJson(ESPN_SUM + eventId);
    const out = { ht: {}, stats: {} };
    const comp = j && j.header && j.header.competitions && j.header.competitions[0];
    if (comp) for (const c of comp.competitors) {
      const hl = c.linescores;
      if (hl && hl.length) out.ht[c.team.id] = +hl[0].value || +hl[0].displayValue || 0;
    }
    for (const t of ((j && j.boxscore && j.boxscore.teams) || [])) {
      const id = t.team && t.team.id; if (!id) continue;
      const get = (n) => { const s = (t.statistics || []).find((x) => x.name === n); if (!s) return null; const v = s.value != null ? +s.value : +s.displayValue; return Number.isFinite(v) ? v : null; };
      out.stats[id] = { shots: get('totalShots'), sot: get('shotsOnTarget'), poss: get('possessionPct') };
    }
    return out;
  } catch (e) { return null; }
}

// 主入口：拉已完赛比分。fixtures = schedule-2026.fixtures；canonNames = Object.keys(teams)
export async function fetchResults({ fixtures, canonNames, withSummary = true, now = null } = {}) {
  const canonSet = new Set(canonNames);
  const fixtureByPair = new Map();
  for (const fx of fixtures) fixtureByPair.set([fx.home, fx.away].sort().join('||'), fx);

  const startDate = fixtures.map((f) => (f.et || '').slice(0, 10)).sort()[0] || '2026-06-11';
  const days = dateRange(startDate, now);

  const results = [], unmatched = [];
  for (const day of days) {
    let evs = [];
    try { evs = (await getJson(ESPN_SB + day)).events || []; } catch (e) { continue; }
    for (const e of evs) {
      const st = e.status && e.status.type;
      if (!st || st.state !== 'post') continue;
      const c = e.competitions[0];
      const eh = c.competitors.find((x) => x.homeAway === 'home');
      const ea = c.competitors.find((x) => x.homeAway === 'away');
      const homeC = toCanon(eh.team.displayName, canonSet), awayC = toCanon(ea.team.displayName, canonSet);
      if (!homeC || !awayC) { unmatched.push(`${eh.team.displayName} vs ${ea.team.displayName}`); continue; }
      const fx = fixtureByPair.get([homeC, awayC].sort().join('||'));
      if (!fx) { unmatched.push(`${homeC} vs ${awayC}`); continue; }
      let home = homeC, away = awayC, hs = +eh.score, as = +ea.score;
      if (fx.home !== homeC) { home = awayC; away = homeC; hs = +ea.score; as = +eh.score; }

      let htHome = null, htAway = null, stats = null;
      if (withSummary) {
        const sm = await fetchSummary(e.id);
        if (sm) {
          const ehId = eh.team.id, eaId = ea.team.id, fhIsEspnHome = fx.home === homeC;
          if (sm.ht[ehId] != null && sm.ht[eaId] != null) { htHome = fhIsEspnHome ? sm.ht[ehId] : sm.ht[eaId]; htAway = fhIsEspnHome ? sm.ht[eaId] : sm.ht[ehId]; }
          const sH = sm.stats[ehId], sA = sm.stats[eaId];
          if (sH && sA && sH.shots != null && sA.shots != null) stats = { home: fhIsEspnHome ? sH : sA, away: fhIsEspnHome ? sA : sH };
        }
      }
      results.push({ date: (fx.et || '').slice(0, 10), et: fx.et, group: fx.group, home, away, hs, as, htHome, htAway, stats, status: st.description, espnId: e.id });
    }
  }
  results.sort((a, b) => (a.et || '').localeCompare(b.et || ''));
  return {
    _source: 'site.api.espn.com fifa.world scoreboard (浏览器直连)',
    _fetchedAt: new Date().toISOString(),
    count: results.length, results, unmatched: [...new Set(unmatched)],
  };
}
