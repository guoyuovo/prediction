// 数据访问层：
//   · getData() —— HTTP 拉 REMOTE_URL（零云函数）→ 回退打包 JSON。
//   · refresh() —— 浏览器本地重算，不推云。
//
// 【GitHub 自动更新 · 推荐】
//   1. 仓库推到 GitHub，启用 Actions（.github/workflows/refresh.yml 每 3h 跑 daily）
//   2. 跑通后填入 REMOTE_URL（jsDelivr，替换成你的 owner/repo 与分支）：
//      https://cdn.jsdelivr.net/gh/OWNER/REPO@master/static/data/payload.json
//   3. App 打开即 HTTP 拉 payload.json，全员最新，无云函数。
//
// 【uniCloud 推云 · 可选】GitHub Secrets 配 PUT_PAYLOAD_URL + PUT_SECRET，或本机 daily 推云。
import meta from '@/static/data/meta.json'
import teams from '@/static/data/teams.json'
import champions from '@/static/data/champions.json'
import matches from '@/static/data/matches.json'
import v2 from '@/static/data/v2.json'
import dual from '@/static/data/dual.json'
import experts from '@/static/data/experts.json'

const BUNDLED = { meta, teams, champions, matches, v2, dual, experts }

// HTTP 数据源。GitHub Actions 更新后填 jsDelivr 地址；留空则用打包数据。
// 示例（GitHub master 分支）：https://cdn.jsdelivr.net/gh/OWNER/REPO@master/static/data/payload.json
const REMOTE_URL = ''

/**
 * @param {object|null} data
 * @returns {boolean}
 */
function isValidPayload(data) {
  return !!(data && data.matches && data.matches.matches && data.meta)
}

function uniGet(url) {
  return new Promise((resolve, reject) => {
    uni.request({ url, timeout: 8000, success: (r) => resolve(r.data), fail: reject })
  })
}

/**
 * HTTP 直拉云存储 payload（不走云函数，仅 CDN/流量）。
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
function fetchData() {
  if (_cache) return _cache
  _cache = (async () => {
    const remote = await fetchRemotePayload()
    return remote || BUNDLED
  })()
  return _cache
}

export function getData() { return fetchData() }

/** 浏览器本地重算；不调用云函数。 */
export async function refresh(opts) {
  try {
    const bundled = await fetchData()
    const { recomputeClient } = await import('@/common/engine/client.js')
    const fresh = await recomputeClient(bundled, opts)
    if (fresh && fresh.matches && fresh.matches.matches) {
      _cache = Promise.resolve(fresh)
      return fresh
    }
  } catch (e) { /* 抓取/计算失败 → 保留现状 */ }
  return null
}

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

// 滚球实时推荐：H5 直连 ESPN；失败回退赛前基线（零云函数）。
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

export const zh = teams.zh
export const nm = (t) => (teams.zh && teams.zh[t]) || t
