// 数据访问层：getData() HTTP 拉 REMOTE_URL → 回退打包 payload.json（零云函数）。
// 全员同步靠 GitHub Actions + jsDelivr；滚球 getLive() 直连 ESPN。
import payload from '@/static/data/payload.json'

/** @type {{ meta: object, teams: object, champions: object, matches: object, v2: object, dual: object, experts: object }} */
const BUNDLED = payload

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/guoyuovo/prediction@master/static/data/'
const VERSION_URL = CDN_BASE + 'version.json'
const REMOTE_URL = CDN_BASE + 'payload.json' // 兜底：拉不到指针时直连(可能吃边缘缓存)

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
 * HTTP 直拉最新 payload（不走云函数）。
 * 先拉小指针 version.json（带分钟级 cache-buster），再按内容寻址文件名拉 payload：
 * 该文件名随内容变化，jsDelivr 对新路径必然回源，绕开 @master 的分支解析缓存与 12h 边缘缓存。
 * 指针拉取失败时回退直连 payload.json（可能吃缓存，但好过内置包）。
 * @returns {Promise<object|null>}
 */
async function fetchRemotePayload() {
  const bust = '?t=' + Math.floor(Date.now() / 60000)
  // 首选：指针 → 内容寻址文件（保证拿到的就是最新那一版）
  try {
    const v = await uniGet(VERSION_URL + bust)
    if (v && v.file) {
      const d = await uniGet(CDN_BASE + v.file) // 内容寻址，不变，无需 cache-buster
      if (isValidPayload(d)) return d
    }
  } catch (e) { /* 指针不可用 → 回退直连 */ }
  // 兜底：直连 payload.json（旧机制，可能拿到边缘缓存的稍旧版本）
  try {
    const d = await uniGet(REMOTE_URL + bust)
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
    // 标记数据来源：remote=线上最新；bundled=离线内置包(发版时冻结，可能较旧)。
    // 页面据此显示「离线快照」横幅，避免用户把旧的内置数据误当最新。
    if (remote) return { ...remote, meta: { ...remote.meta, source: 'remote' } }
    return { ...BUNDLED, meta: { ...BUNDLED.meta, source: 'bundled' } }
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
