// co-data(云对象): 返回云存储 payload 快照，供前端 getData() 读取。
//   URL 由 put-payload 上传后写入 wc_config，无需手填 REMOTE_URL。
const db = uniCloud.database();
const CONFIG_ID = 'payload';

module.exports = {
  /** @returns {{ code: number, data?: object, msg?: string, url?: string }} */
  async getAll() {
    try {
      const cfg = await db.collection('wc_config').doc(CONFIG_ID).get();
      const url = cfg.data && cfg.data.url;
      if (!url) return { code: 1, msg: '云端 payload 未初始化（请先点「更新」同步）' };
      const r = await uniCloud.httpclient.request(url, { method: 'GET', dataType: 'json', timeout: 15000 });
      const data = r.data;
      if (!data || !data.matches || !data.matches.matches) {
        return { code: 2, msg: '云存储 payload 格式异常' };
      }
      return { code: 0, data, url, updatedAt: cfg.data.updatedAt };
    } catch (e) {
      return { code: 3, msg: e.message || '读取云存储失败' };
    }
  },
};
