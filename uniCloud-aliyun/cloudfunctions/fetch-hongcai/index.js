'use strict';
// 云函数 fetch-hongcai：抓网易红彩免费专家方案(世界杯) + 逐条详情 → 集合 wc_expert_plans
//   列表 /api/web/free/0/9999（data.threads）；详情 /api/web/thread/query/{id}/0（content/matchList/expertData）。
//   showContent===1 完整可见（正文+推荐+赔率+战绩+走势）；===0 仅元信息+深链。已离线验证。
//   合规：展示页须标注"专家观点来自第三方·仅供参考·理性购彩·18+"。
const db = uniCloud.database();
const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hongcai.163.com/free.html' };

const ZH2EN = {
  '墨西哥': 'Mexico', '南非': 'South Africa', '韩国': 'South Korea', '捷克': 'Czechia', '加拿大': 'Canada',
  '波黑': 'Bosnia', '卡塔尔': 'Qatar', '瑞士': 'Switzerland', '巴西': 'Brazil', '摩洛哥': 'Morocco',
  '海地': 'Haiti', '苏格兰': 'Scotland', '美国': 'USA', '巴拉圭': 'Paraguay', '澳大利亚': 'Australia',
  '土耳其': 'Turkey', '德国': 'Germany', '库拉索': 'Curacao', '科特迪瓦': "Cote d'Ivoire", '厄瓜多尔': 'Ecuador',
  '荷兰': 'Netherlands', '日本': 'Japan', '瑞典': 'Sweden', '突尼斯': 'Tunisia', '比利时': 'Belgium',
  '埃及': 'Egypt', '伊朗': 'Iran', '新西兰': 'New Zealand', '西班牙': 'Spain', '佛得角': 'Cape Verde',
  '沙特阿拉伯': 'Saudi Arabia', '乌拉圭': 'Uruguay', '法国': 'France', '塞内加尔': 'Senegal', '伊拉克': 'Iraq',
  '挪威': 'Norway', '阿根廷': 'Argentina', '阿尔及利亚': 'Algeria', '奥地利': 'Austria', '约旦': 'Jordan',
  '葡萄牙': 'Portugal', '刚果(金)': 'DR Congo', '乌兹别克斯坦': 'Uzbekistan', '哥伦比亚': 'Colombia',
  '英格兰': 'England', '克罗地亚': 'Croatia', '加纳': 'Ghana', '巴拿马': 'Panama',
};
const getJson = async (u) => { const r = await uniCloud.httpclient.request(u, { method: 'GET', dataType: 'json', timeout: 20000, headers: HEADERS }); return r.data; };
function recommends(ml) {
  const out = [];
  const pull = (plays) => { for (const pv of (plays || [])) { const items = (pv.itemVoList || []).filter((i) => i.isRecommend).map((i) => ({ name: i.playItemName, odds: i.odds })); if (items.length) out.push({ play: pv.playName, code: pv.playCode, items }); } };
  pull(ml.playVoList); pull(ml.extraRecommendPlays); return out;
}

exports.main = async () => {
  let threads = [];
  try { threads = ((await getJson('https://hongcai.163.com/api/web/free/0/9999')).data || {}).threads || []; }
  catch (e) { return { code: 1, msg: '列表失败: ' + e.message }; }
  const wc = threads.filter((t) => t.earliestMatch && t.earliestMatch.leagueName === '世界杯');
  const now = Date.now();
  const plans = [];
  for (const t of wc) {
    const m = t.earliestMatch;
    const p = {
      threadId: t.threadId, title: t.threadTitle || t.title || '', publishTime: t.publishTime,
      free: t.price === 0, price: t.price, previousPrice: t.previousPrice,
      type: t.xStringOne || (t.matchNum > 1 ? '串关' : '单场'), matchNum: t.matchNum,
      matchZh: m.homeName + ' vs ' + m.guestName, home: ZH2EN[m.homeName] || null, away: ZH2EN[m.guestName] || null,
      matchTime: m.matchTime, league: m.leagueName,
      expert: { name: (t.expert || {}).nickname || '?', avatar: (t.expert || {}).avatar || '', slogan: (t.expert || {}).slogan || '' },
      link: 'https://hongcai.163.com/thread.html?threadId=' + t.threadId,
      unlocked: false, content: '', recommends: [], recentForm: [], jcNum: '', homeIcon: '', awayIcon: '', updatedAt: now,
    };
    try {
      const d = ((await getJson('https://hongcai.163.com/api/web/thread/query/' + t.threadId + '/0')).data) || {};
      const ed = d.expertData || {};
      Object.assign(p.expert, { desc: ed.desc || '', hitRate: ed.hitRate, recent: ed.bAllRate || '', follower: ed.follower, planCount: ed.planCount, maxWin: ed.maxWin });
      p.unlocked = d.showContent === 1;
      if (p.unlocked) {
        p.content = d.content || '';
        const ml = (d.matchList || [])[0] || {};
        p.recommends = recommends(ml); p.jcNum = ml.jcNum || '';
        p.homeIcon = (ml.homeTeam || {}).teamIcon || ''; p.awayIcon = (ml.guestTeam || {}).teamIcon || '';
        p.recentForm = ((ml.matchAnalyData || {}).dishroad || []).slice(0, 6).map((x) => ({ date: x.matchTime, home: x.homeName, hs: x.homeScore, as: x.guestScore, away: x.guestName, half: x.halfScore }));
      }
    } catch (e) { /* 保留元信息 */ }
    plans.push(p);
  }
  const col = db.collection('wc_expert_plans');
  try { await col.where({ league: '世界杯' }).remove(); } catch (e) {}
  if (plans.length) await col.add(plans);
  return { code: 0, total: wc.length, unlocked: plans.filter((p) => p.unlocked).length, updatedAt: now };
};
