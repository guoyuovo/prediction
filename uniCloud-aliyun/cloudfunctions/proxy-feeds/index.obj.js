// proxy-feeds(云对象):前端绕 CORS 的瘦代理。前端把"浏览器抓不到的源"URL 丢进来,
//   服务端代抓 + 10 分钟缓存返回。仅白名单域名(防开放代理滥用)。零计算。
//   用途:网易红彩(CORS=null)、Titan007(CORS 只许自家域)。
//   前端:uniCloud.importObject('proxy-feeds').get(url)
const db = uniCloud.database();
const dbCmd = db.command;
const TTL = 10 * 60 * 1000; // 10 分钟缓存

// 只允许这些主机(后缀匹配),其余一律拒绝
const ALLOW_HOSTS = ['hongcai.163.com', 'titan007.com', 'webapi.sporttery.cn', 'eloratings.net'];

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}
const allowed = (url) => { const h = hostOf(url); return !!h && ALLOW_HOSTS.some((a) => h === a || h.endsWith('.' + a)); };

module.exports = {
  // dataType: 'json' | 'text'(默认 json;Titan007 等返回 js/文本时传 'text')
  async get(url, dataType = 'json') {
    if (!allowed(url)) return { code: 403, msg: '域名不在白名单' };

    // 1) 查缓存
    try {
      const c = await db.collection('wc_proxy_cache').where({ url }).orderBy('ts', 'desc').limit(1).get();
      if (c.data && c.data[0] && Date.now() - c.data[0].ts < TTL) {
        return { code: 0, cached: true, ts: c.data[0].ts, data: c.data[0].data };
      }
    } catch (e) {}

    // 2) 代抓
    let data;
    try {
      const r = await uniCloud.httpclient.request(url, {
        method: 'GET', dataType, timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://' + hostOf(url) + '/' },
      });
      if (r.status !== 200) return { code: 1, msg: 'HTTP ' + r.status };
      data = r.data;
    } catch (e) { return { code: 2, msg: '代抓失败: ' + e.message }; }

    // 3) 写缓存(留最新)
    const ts = Date.now();
    try {
      await db.collection('wc_proxy_cache').add({ url, ts, data });
      await db.collection('wc_proxy_cache').where({ url, ts: dbCmd.lt(ts) }).remove();
    } catch (e) {}

    return { code: 0, cached: false, ts, data };
  },
};
