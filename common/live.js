/**
 * 滚球实时推荐计算（与云函数 live-rec 逻辑对齐，供客户端回退）。
 */

const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates='

/** ESPN 队名 → 本项目规范名（与 fetch-results / fetch-sources 一致） */
const ESPN2CANON = {
  'United States': 'USA', USA: 'USA',
  'Bosnia-Herzegovina': 'Bosnia', 'Bosnia and Herzegovina': 'Bosnia', 'Bosnia & Herzegovina': 'Bosnia',
  Czechia: 'Czechia', 'Czech Republic': 'Czechia',
  "Côte d'Ivoire": "Cote d'Ivoire", 'Ivory Coast': "Cote d'Ivoire",
  'DR Congo': 'DR Congo', 'Congo DR': 'DR Congo',
  'Curaçao': 'Curacao', 'Cape Verde Islands': 'Cape Verde', 'Cabo Verde': 'Cape Verde',
  'IR Iran': 'Iran', 'Korea Republic': 'South Korea',
  'Türkiye': 'Turkey', Turkiye: 'Turkey',
}

/**
 * @param {string} name
 * @returns {string}
 */
function stripAccents(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * @param {string} name
 * @returns {string}
 */
function canonEspn(name) {
  if (!name) return name
  if (ESPN2CANON[name]) return ESPN2CANON[name]
  const a = stripAccents(name)
  for (const [k, v] of Object.entries(ESPN2CANON)) {
    if (stripAccents(k) === a) return v
  }
  return name
}

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    uni.request({ url, timeout: 15000, success: (r) => resolve(r.data), fail: reject })
  })
}

/**
 * @param {string} s
 * @returns {string}
 */
function ymd(s) {
  return (s || '').slice(0, 10).replace(/-/g, '')
}

/**
 * @param {string} yyyymmdd
 * @param {number} delta
 * @returns {string}
 */
function shiftDay(yyyymmdd, delta) {
  const y = +yyyymmdd.slice(0, 4)
  const m = +yyyymmdd.slice(4, 6)
  const d = +yyyymmdd.slice(6, 8)
  const dt = new Date(Date.UTC(y, m - 1, d + delta))
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`
}

/**
 * @param {object} c ESPN competitor
 * @returns {number}
 */
function redOf(c) {
  return (c.statistics || []).reduce((n, s) => n + (/redCard/i.test(s.name) ? (+s.displayValue || 0) : 0), 0)
}

/**
 * 解析 ESPN event → 滚球推荐（与 live-rec 云函数同逻辑）。
 * @param {object} match
 * @param {object} ev ESPN event
 * @param {string} [note]
 */
export function liveFromEspnEvent(match, ev, note) {
  const comp = ev.competitions[0]
  const state = (ev.status && ev.status.type && ev.status.type.state) || 'unknown'
  const cs = comp.competitors
  const homeC = cs.find((c) => c.homeAway === 'home') || cs[0]
  const awayC = cs.find((c) => c !== homeC)
  const gh = parseInt(homeC.score, 10) || 0
  const ga = parseInt(awayC.score, 10) || 0
  const homeCanon = canonEspn((homeC.team || {}).displayName || '')
  const awayCanon = canonEspn((awayC.team || {}).displayName || '')
  const flip = homeCanon !== match.home
  const score = flip ? [ga, gh] : [gh, ga]
  const reds = flip ? [redOf(awayC), redOf(homeC)] : [redOf(homeC), redOf(awayC)]
  const minute = parseInt((ev.status && ev.status.displayClock) || '', 10)
    || Math.round(((ev.status && ev.status.clock) || 0) / 60)
  const [lh0, la0] = parseEg(match)
  const f = state === 'post' ? 0 : Math.max(0, Math.min(1, (90 - minute) / 90))
  let lh = lh0 * f
  let la = la0 * f
  if (reds[0] > 0) lh *= 0.7
  if (reds[1] > 0) la *= 0.7
  const a = analyzeLive(score[0], score[1], lh, la)
  const srcNote = state === 'post' ? 'ESPN 完场' : state === 'in' ? 'ESPN 滚球' : 'ESPN 赛前'
  return buildLiveRec({
    seq: match.seq,
    state,
    minute: state === 'post' ? 90 : minute,
    score,
    redCards: reds,
    a,
    note: note || `${srcNote}·参考·不改赛前预测`,
  })
}

/**
 * 浏览器/H5 直连 ESPN 计分板，按主客队匹配本场（容时区 ±1 天）。
 * @param {object} match
 * @returns {Promise<object|null>}
 */
export async function fetchLiveFromEspn(match) {
  if (!match || !match.home || !match.away) return null
  const base = ymd(match.kickoff || match.date)
  for (const day of [base, shiftDay(base, -1), shiftDay(base, 1)]) {
    try {
      const j = await httpGet(ESPN_SCOREBOARD + day)
      const events = (j && j.events) || []
      const ev = events.find((e) => {
        const cs = (e.competitions && e.competitions[0] && e.competitions[0].competitors) || []
        const names = cs.map((c) => canonEspn((c.team || {}).displayName || (c.team || {}).shortDisplayName || ''))
        return names.includes(match.home) && names.includes(match.away)
      })
      if (ev) return liveFromEspnEvent(match, ev)
    } catch (e) { /* 单天失败继续 */ }
  }
  return null
}

/**
 * @param {number} lambda
 * @param {number} k
 * @returns {number}
 */
function poisson(lambda, k) {
  let p = Math.exp(-lambda)
  for (let i = 1; i <= k; i++) p *= lambda / i
  return p
}

/**
 * 一次剩余进球卷积，导出实时指标。
 * @param {number} gh 主队已进
 * @param {number} ga 客队已进
 * @param {number} lh 主队剩余 λ
 * @param {number} la 客队剩余 λ
 */
export function analyzeLive(gh, ga, lh, la) {
  const N = 10
  const ph = []
  const pa = []
  for (let i = 0; i <= N; i++) {
    ph[i] = poisson(lh, i)
    pa[i] = poisson(la, i)
  }
  let pH = 0
  let pD = 0
  let pA = 0
  let moreGoals = 0
  const scoreProb = {}
  const totalProb = {}
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const w = ph[i] * pa[j]
      const fh = gh + i
      const fa = ga + j
      if (fh > fa) pH += w
      else if (fh === fa) pD += w
      else pA += w
      scoreProb[`${fh}-${fa}`] = (scoreProb[`${fh}-${fa}`] || 0) + w
      totalProb[fh + fa] = (totalProb[fh + fa] || 0) + w
      if (i + j > 0) moreGoals += w
    }
  }
  const round = (x) => Math.round(x * 1000) / 1000
  const overFor = (line) => {
    let o = 0
    for (const t in totalProb) if (+t > line) o += totalProb[t]
    return o
  }
  const topScores = Object.entries(scoreProb)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, p]) => ({ score: s, p: round(p) }))
  const nh = lh + la > 0 ? lh / (lh + la) : 0.5
  const p = [round(pH), round(pD), round(pA)]
  const ou = [1.5, 2.5, 3.5].map((line) => ({ line, over: round(overFor(line)) }))
  const lean = `${p[0] >= p[1] && p[0] >= p[2] ? '倾向主胜' : p[2] >= p[1] ? '倾向客胜' : '倾向平局'}·${overFor(2.5) >= 0.5 ? '大球' : '小球'}`
  return {
    p,
    ou,
    lean,
    moreGoals: round(moreGoals),
    nextGoal: [round(nh), round(1 - nh)],
    topScores,
    expFinal: [round(gh + lh), round(ga + la)],
  }
}

/**
 * 从场次对象解析赛前 λ。
 * @param {{ eg?: string }} match
 * @returns {[number, number]}
 */
export function parseEg(match) {
  const [lh0, la0] = String(match.eg || '0-0').split('-').map(Number)
  return [lh0 || 0, la0 || 0]
}

/**
 * 构建滚球推荐结果对象。
 * @param {object} opts
 * @param {string|number} opts.seq
 * @param {'pre'|'in'|'post'|string} opts.state
 * @param {number} opts.minute
 * @param {[number, number]} opts.score
 * @param {[number, number]} opts.redCards
 * @param {ReturnType<typeof analyzeLive>} a
 * @param {string} [opts.note]
 */
export function buildLiveRec({ seq, state, minute, score, redCards, a, note }) {
  return {
    seq,
    updatedAt: Date.now(),
    state,
    minute,
    score,
    redCards,
    p: a.p,
    ou: a.ou,
    moreGoals: a.moreGoals,
    nextGoal: a.nextGoal,
    topScores: a.topScores,
    expFinal: a.expFinal,
    lean: a.lean,
    note: note || '参考·不改赛前预测',
  }
}

/**
 * 赛前基线（0-0，全场 λ），云端/ESPN 不可用时的客户端回退。
 * @param {object} match 场次对象（需含 seq、eg）
 */
export function preMatchBaseline(match) {
  const [lh0, la0] = parseEg(match)
  const a = analyzeLive(0, 0, lh0, la0)
  return buildLiveRec({
    seq: match.seq,
    state: 'pre',
    minute: 0,
    score: [0, 0],
    redCards: [0, 0],
    a,
    note: '赛前基线（ESPN/云端均不可用）·参考·不改赛前预测',
  })
}

/**
 * 构建传给云函数的 hint（避免依赖 PAYLOAD_URL）。
 * @param {object} match
 */
export function liveHint(match) {
  if (!match) return null
  return {
    home: match.home,
    away: match.away,
    kickoff: match.kickoff || match.date,
    date: match.date,
    eg: match.eg,
    ou: match.ou,
  }
}
