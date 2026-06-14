'use strict';
// 云函数 fetch-jingcai：抓中国体育彩票官方竞彩足球赔率 → 集合 wc_jc_odds
//   ⚠ 该接口在境外/部分 IP 有 WAF(403/567)，但阿里云国内云函数 IP 大概率可通——部署后看返回。
//   为稳妥：成功则同时存「原始 value」到 wc_jc_raw，便于按真实响应结构微调解析（首次部署务必看一眼原始结构）。
//   合规：展示页须标注"竞彩数据来自中国体育彩票官方·仅供参考·理性购彩·18+"。
const db = uniCloud.database();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Referer': 'https://www.sporttery.cn/',
  'Accept': 'application/json, text/plain, */*',
};
const ENDPOINT = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=had,hhad,crs,ttg,hafu&channel=c';

exports.main = async () => {
  let body;
  try {
    const res = await uniCloud.httpclient.request(ENDPOINT, { method: 'GET', dataType: 'json', timeout: 25000, headers: HEADERS });
    if (res.status !== 200) return { code: 1, msg: 'HTTP ' + res.status + '（疑似 WAF，需换头/确认云端 IP）' };
    body = res.data;
  } catch (e) { return { code: 1, msg: '抓取失败: ' + e.message }; }

  // 存原始，便于核对结构
  try { await db.collection('wc_jc_raw').where({}).remove(); } catch (e) {}
  try { await db.collection('wc_jc_raw').add({ value: body, at: Date.now() }); } catch (e) {}

  // best-effort 解析（按 sporttery 常见结构 value.matchInfoList[].subMatchList[]；实际以原始为准微调）
  const out = [];
  try {
    const list = (body && body.value && body.value.matchInfoList) || [];
    for (const day of list) {
      for (const sm of (day.subMatchList || day.matchList || [])) {
        out.push({
          league: sm.leagueAbbName || sm.leagueName || '',
          matchNum: sm.matchNumStr || sm.matchNum || '',
          homeZh: sm.homeTeamAbbName || sm.homeTeamAllName || sm.homeName || '',
          awayZh: sm.awayTeamAbbName || sm.awayTeamAllName || sm.awayName || '',
          matchDate: sm.matchDate || sm.businessDate || '',
          // 各玩法赔率原样带回（字段名以原始为准）
          had: sm.had || null, hhad: sm.hhad || null, crs: sm.crs || null, ttg: sm.ttg || null, hafu: sm.hafu || null,
          updatedAt: Date.now(),
        });
      }
    }
  } catch (e) { return { code: 2, msg: '解析异常（看 wc_jc_raw 调整）: ' + e.message }; }

  if (out.length) {
    try { await db.collection('wc_jc_odds').where({}).remove(); } catch (e) {}
    await db.collection('wc_jc_odds').add(out);
  }
  return { code: 0, parsed: out.length, note: out.length ? 'ok' : '解析0条，请看 wc_jc_raw 原始结构调整字段映射' };
};
