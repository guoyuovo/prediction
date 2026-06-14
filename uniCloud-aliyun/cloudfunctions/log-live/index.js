'use strict';
// log-live(定时云函数,每 5 分钟):自动轮询"可能在踢"的场次,复用 live-rec 记录推荐快照。
//   目的:让滚球胜率统计【无偏】——不依赖用户是否点开。只写库(live-rec 内部写 wc_live_log),不展示。
//   依赖:环境变量 PAYLOAD_URL(云存储 payload.json 地址,同 live-rec)。
//   空跑早退:无"在踢窗口"的场次时几乎不干活(只拉一次 payload)。
const PAYLOAD_URL = process.env.PAYLOAD_URL || '';

// "YYYY-MM-DD HH:MM"(北京时间)→ UTC 毫秒
function kickoffMs(s) {
  try { return new Date(String(s).replace(' ', 'T') + '+08:00').getTime(); } catch (e) { return 0; }
}

exports.main = async () => {
  if (!PAYLOAD_URL) return { code: 1, msg: '未配置 PAYLOAD_URL' };

  let payload;
  try {
    payload = (await uniCloud.httpclient.request(PAYLOAD_URL, { method: 'GET', dataType: 'json', timeout: 10000 })).data;
  } catch (e) { return { code: 2, msg: '拉 payload 失败: ' + e.message }; }

  const ms = (payload && payload.matches && payload.matches.matches) || [];
  const now = Date.now();
  // 粗筛"在踢窗口":未完赛 且 开球时间在 [开球-10min, 开球+150min]
  const live = ms.filter((m) => {
    if (m.result || !m.kickoff) return false;
    const ko = kickoffMs(m.kickoff);
    return ko && now >= ko - 10 * 60000 && now <= ko + 150 * 60000;
  });
  if (!live.length) return { code: 0, checked: 0, logged: 0 }; // 空跑早退

  // 复用 live-rec.get():它内部会抓 ESPN + 算 + 在 state='in' 时写 wc_live_log
  const liveRec = uniCloud.importObject('live-rec');
  let logged = 0;
  for (const m of live) {
    try {
      const r = await liveRec.get(m.seq);
      if (r && r.data && r.data.state === 'in') logged++;
    } catch (e) { /* 单场失败不影响其它 */ }
  }
  return { code: 0, checked: live.length, logged };
};
