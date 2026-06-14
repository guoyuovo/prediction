// 云对象 co-data：用户端唯一入口。getAll() 返回我们计算好的全部最新结果。
//   优先读 wc_payload（compute 云函数定时写入：抓数据→跑模型→产出 payload）；
//   未就绪则回退随函数打包的 payload.json（由离线 build-app-payload 生成）。一次调用拿全部。
module.exports = {
  async getAll() {
    const db = uniCloud.database()
    try {
      const r = await db.collection('wc_payload').orderBy('updatedAt', 'desc').limit(1).get()
      if (r.data && r.data[0] && r.data[0].payload && r.data[0].payload.matches) {
        return { code: 0, source: 'db', updatedAt: r.data[0].updatedAt, data: r.data[0].payload }
      }
    } catch (e) { /* 集合不存在则用打包数据 */ }
    try {
      const payload = require('./payload.json')
      return { code: 0, source: 'bundled', data: payload }
    } catch (e) {
      return { code: 1, msg: 'payload 未就绪' }
    }
  }
}
