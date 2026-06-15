// 数据访问层：
//   · getData() —— 打包静态 JSON 秒开（可选先拉云存储 REMOTE_URL）。单例缓存。
//   · refresh() —— 客户端重算：浏览器抓 ESPN 完赛 + 跑引擎(预测/滚动Elo/夺冠MC) → 更新数据。
//     引擎动态导入(不进首屏);失败保留现状。这是"前端自刷新"的主路径(网页端 CORS 可直连 ESPN)。
import meta from '@/static/data/meta.json'
import teams from '@/static/data/teams.json'
import champions from '@/static/data/champions.json'
import matches from '@/static/data/matches.json'
import v2 from '@/static/data/v2.json'
import dual from '@/static/data/dual.json'
import experts from '@/static/data/experts.json'

const BUNDLED = { meta, teams, champions, matches, v2, dual, experts }

// ← 部署后填:put-payload 返回的云存储 payload.json 公网地址。留空则只用打包数据。
const REMOTE_URL = ''

function uniGet(url) {
  return new Promise((resolve, reject) => {
    uni.request({ url, timeout: 8000, success: (r) => resolve(r.data), fail: reject })
  })
}

let _cache = null
function fetchData() {
  if (_cache) return _cache
  _cache = (async () => {
    if (REMOTE_URL) {
      try {
        const d = await uniGet(REMOTE_URL + (REMOTE_URL.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000))
        if (d && d.matches && d.matches.matches) return d
      } catch (e) { /* 网络失败 → 回退打包数据 */ }
    }
    return BUNDLED
  })()
  return _cache
}

export function getData() { return fetchData() }

// 客户端重算并更新缓存。页面拿到返回值后重新赋值即可刷新显示。失败返回 null(保留现状)。
export async function refresh(opts) {
  try {
    const bundled = await fetchData()
    const { recomputeClient } = await import('@/common/engine/client.js')
    const fresh = await recomputeClient(bundled, opts)
    if (fresh && fresh.matches && fresh.matches.matches) { _cache = Promise.resolve(fresh); return fresh }
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

// 滚球实时推荐(手动触发):点击某场 → 调云端 live-rec.get(seq, hint)。
//   云端失败时 H5 直连 ESPN；仍失败才回退赛前基线。
export async function getLive(seq, match) {
  const { preMatchBaseline, liveHint, fetchLiveFromEspn } = await import('@/common/live.js')
  const hint = liveHint(match)
  try {
    const co = uniCloud.importObject('live-rec', { customUI: true })
    const res = await co.get(seq, hint)
    if (res && res.code === 0) return { data: res.data, error: null }
  } catch (e) { /* 云端不可用 → 走 ESPN 客户端 */ }

  try {
    const fromEspn = await fetchLiveFromEspn(match)
    if (fromEspn) return { data: fromEspn, error: null }
  } catch (e) { /* ESPN 失败 → 赛前基线 */ }

  if (match && match.eg) {
    return {
      data: preMatchBaseline(match),
      error: '云端与 ESPN 均不可用，以下为赛前基线',
    }
  }
  return { data: null, error: '无法获取实时数据' }
}

export const zh = teams.zh
export const nm = (t) => (teams.zh && teams.zh[t]) || t
