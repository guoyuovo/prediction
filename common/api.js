// 数据访问层：优先云端 co-data.getAll()（部署并关联云空间后生效），
//   失败 / 未关联云空间时回退随 App 打包的静态 JSON（H5 本地零配置可跑）。
//   全 App 只取一次（单例缓存），getData/load/getMatch 共用同一份数据。
import meta from '@/static/data/meta.json'
import teams from '@/static/data/teams.json'
import champions from '@/static/data/champions.json'
import matches from '@/static/data/matches.json'
import v2 from '@/static/data/v2.json'
import dual from '@/static/data/dual.json'
import experts from '@/static/data/experts.json'

const BUNDLED = { meta, teams, champions, matches, v2, dual, experts }

let _cache = null
function fetchData() {
  if (_cache) return _cache
  _cache = (async () => {
    try {
      const co = uniCloud.importObject('co-data', { customUI: true })
      const res = await co.getAll()
      if (res && res.code === 0 && res.data && res.data.matches) return res.data
    } catch (e) { /* 未关联云空间 / 网络失败 → 回退打包数据 */ }
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
