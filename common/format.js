// 格式化与小工具
export const pct = (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%')
export const pct1 = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%')
export const dirZh = (d) => (d === 'H' ? '主胜' : d === 'A' ? '客胜' : '平')
export const dirColor = (d) => (d === 'H' ? '#36c275' : d === 'A' ? '#4ea1ff' : '#ffc23d')
export const confColor = (c) => (c === '高' ? '#36c275' : c === '中' ? '#ffc23d' : '#8b93a1')
export const fix = (v, n = 1) => (v == null ? '—' : Number(v).toFixed(n))
