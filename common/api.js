// 数据访问层：当前用 bundled 静态 JSON（H5 本地零配置可跑）。
//   注意：暂不调用 uniCloud（未关联云空间时其初始化可能干扰 H5 路由）。
//   待关联云空间后，再把 getData 内切回 co-data.getAll()（接口不变，页面不用改）。
import meta from '@/static/data/meta.json'
import teams from '@/static/data/teams.json'
import champions from '@/static/data/champions.json'
import matches from '@/static/data/matches.json'
import v2 from '@/static/data/v2.json'
import dual from '@/static/data/dual.json'
import experts from '@/static/data/experts.json'

const BUNDLED = { meta, teams, champions, matches, v2, dual, experts }

export function getData() {
  return Promise.resolve(BUNDLED)
}

export async function load(name) { return BUNDLED[name] }
export async function getMatch(seq) { return (matches.matches || []).find(m => String(m.seq) === String(seq)) }
export async function getDual(home, away) { return (dual.future || []).find(m => m.home === home && m.away === away) }
export async function getExperts(home, away) { return (experts.plans || []).filter(p => p.home === home && p.away === away) }

export const zh = teams.zh
export const nm = (t) => (teams.zh && teams.zh[t]) || t
