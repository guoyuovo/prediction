// 数据访问层：getData() HTTP 拉 REMOTE_URL → 回退打包 payload.json（零云函数）。
// 全员同步靠 GitHub Actions + jsDelivr；滚球 getLive() 直连 ESPN。
import payload from '@/static/data/payload.json'

/** @type {{ meta: object, teams: object, champions: object, matches: object, v2: object, dual: object, experts: object }} */
const BUNDLED = payload

const REMOTE_URL = 'https://cdn.jsdelivr.net/gh/guoyuovo/prediction@master/static/data/payload.json'

/**
 * @param {object|null} data
 * @returns {boolean}
 */
function isValidPayload(data) {
  return !!(data && data.matches && data.matches.matches && data.meta)
}

/**
 * @param {string} url
 * @returns {Promise<object>}
 */
function uniGet(url) {
  return new Promise((resolve, reject) => {
    uni.request({ url, timeout: 8000, success: (r) => resolve(r.data), fail: reject })
  })
}

/**
 * HTTP 直拉 payload.json（不走云函数）。
 * @returns {Promise<object|null>}
 */
async function fetchRemotePayload() {
  if (!REMOTE_URL) return null
  try {
    const d = await uniGet(REMOTE_URL + (REMOTE_URL.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000))
    if (isValidPayload(d)) return d
  } catch (e) { /* 网络失败 → 回退打包 */ }
  return null
}

let _cache = null

/** @returns {Promise<typeof BUNDLED>} */
function fetchData() {
  if (_cache) return _cache
  _cache = (async () => {
    const remote = await fetchRemotePayload()
    return remote || BUNDLED
  })()
  return _cache
}

export function getData() { return fetchData() }

export async function load(name) { return (await fetchData())[name] }

export async function getMatch(seq) {
  const d = await fetchData()
  return (d.matches.matches || []).find(m => String(m.seq) === String(seq))
}

export async function getDual(home, away) {
  const d = await fetchData()
  return (d.dual.future || []).find(m => m.home === home && m.away === away)
}

export async function getExperts(home, away) {
  const d = await fetchData()
  return (d.experts.plans || []).filter(p => p.home === home && p.away === away)
}

/** 滚球：H5/App 直连 ESPN；失败回退赛前基线。 */
export async function getLive(seq, match) {
  const { preMatchBaseline, fetchLiveFromEspn } = await import('@/common/live.js')
  try {
    const fromEspn = await fetchLiveFromEspn(match)
    if (fromEspn) return { data: fromEspn, error: null }
  } catch (e) { /* ESPN 失败 → 赛前基线 */ }

  if (match && match.eg) {
    return {
      data: preMatchBaseline(match),
      error: 'ESPN 暂不可用，以下为赛前基线',
    }
  }
  return { data: null, error: '无法获取实时数据' }
}

export const zh = BUNDLED.teams?.zh || {}
/** @param {string} t */
export const nm = (t) => zh[t] || t
