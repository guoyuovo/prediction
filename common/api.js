// 数据访问层：优先拉云存储上的 payload.json（CDN，put-payload 上传），
//   失败 / 未配置时回退随 App 打包的静态 JSON（H5 本地零配置可跑）。
//   全 App 只取一次（单例缓存），getData/load/getMatch 共用同一份数据。
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

// 滚球实时推荐(手动触发):点击某场 → 调云端 live-rec.get(seq)。
//   未关联云空间/失败时返回 null,前端按"暂不可用"处理。仅作参考,不改赛前预测。
export async function getLive(seq) {
  try {
    const co = uniCloud.importObject('live-rec', { customUI: true })
    const res = await co.get(seq)
    if (res && res.code === 0) return res.data
    return null
  } catch (e) { return null }
}

export const zh = teams.zh
export const nm = (t) => (teams.zh && teams.zh[t]) || t
