#!/usr/bin/env node
// 抓 网易红彩 免费专家方案(世界杯) + 逐条详情 → data/expert-plans.json
//   列表：https://hongcai.163.com/api/web/free/0/9999（data.threads）
//   详情：https://hongcai.163.com/api/web/thread/query/{threadId}/0（data.content/matchList/expertData）
//   showContent===1 的方案完整可见（正文+推荐选项+赔率）；===0 仅元信息+深链。
// 用法：node scripts/fetch-hongcai.mjs
//   合规：展示页须标注"专家观点来自第三方·仅供参考·理性购彩·18+"。

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson } from '../src/util.mjs';

const H = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hongcai.163.com/free.html' };
const getJson = async (u) => { const r = await fetch(u, { headers: H }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

const zhMap = loadJson('data/team-names-zh.json').names;
const zh2en = {}; for (const [en, zh] of Object.entries(zhMap)) zh2en[zh] = en;

// 红彩中文队名偶有截断(如"阿尔及利"缺"亚")：先精确查，落空再按【唯一前缀】兜底匹配，
// 仍不唯一则返回 null（宁缺毋错，避免映射到错误球队）。
function resolveZh(name) {
  if (!name) return null;
  if (zh2en[name]) return zh2en[name];
  const cands = Object.keys(zh2en).filter((zh) => zh.startsWith(name) || name.startsWith(zh));
  return cands.length === 1 ? zh2en[cands[0]] : null;
}

function extractRecommends(ml) {
  const out = [];
  const pull = (plays) => {
    for (const pv of (plays || [])) {
      const items = (pv.itemVoList || []).filter((i) => i.isRecommend).map((i) => ({ name: i.playItemName, odds: i.odds }));
      if (items.length) out.push({ play: pv.playName, code: pv.playCode, items });
    }
  };
  pull(ml.playVoList); pull(ml.extraRecommendPlays);
  return out;
}

console.log('抓 网易红彩 免费专家方案(世界杯) + 详情 ...');
let threads = [];
try { threads = (await getJson('https://hongcai.163.com/api/web/free/0/9999')).data.threads || []; }
catch (e) { console.error('✗ 列表失败：' + e.message); process.exit(1); }
const wc = threads.filter((t) => t.earliestMatch && t.earliestMatch.leagueName === '世界杯');

const plans = [];
for (const t of wc) {
  const m = t.earliestMatch;
  const base = {
    threadId: t.threadId, title: t.threadTitle || t.title || '', publishTime: t.publishTime,
    free: t.price === 0, price: t.price, previousPrice: t.previousPrice,
    type: t.xStringOne || (t.matchNum > 1 ? '串关' : '单场'), matchNum: t.matchNum,
    matchZh: `${m.homeName} vs ${m.guestName}`, home: resolveZh(m.homeName), away: resolveZh(m.guestName),
    matchTime: m.matchTime, matchInfoId: m.matchInfoId,
    expert: { name: (t.expert || {}).nickname || '?', avatar: (t.expert || {}).avatar || '', slogan: (t.expert || {}).slogan || '' },
    link: `https://hongcai.163.com/thread.html?threadId=${t.threadId}`,
    unlocked: false, content: '', recommends: [], recentForm: [], jcNum: '', homeIcon: '', awayIcon: '',
  };
  try {
    const d = (await getJson(`https://hongcai.163.com/api/web/thread/query/${t.threadId}/0`)).data;
    const ed = d.expertData || {};
    Object.assign(base.expert, {
      desc: ed.desc || '', hitRate: ed.hitRate, recent: ed.bAllRate || '', follower: ed.follower,
      planCount: ed.planCount, maxWin: ed.maxWin,
    });
    base.unlocked = d.showContent === 1;
    if (base.unlocked) {
      base.content = d.content || '';
      const ml = (d.matchList || [])[0] || {};
      base.recommends = extractRecommends(ml);
      base.jcNum = ml.jcNum || '';
      base.homeIcon = (ml.homeTeam || {}).teamIcon || '';
      base.awayIcon = (ml.guestTeam || {}).teamIcon || '';
      base.recentForm = ((ml.matchAnalyData || {}).dishroad || []).slice(0, 6).map((x) => ({
        date: x.matchTime, home: x.homeName, hs: x.homeScore, as: x.guestScore, away: x.guestName,
        half: x.halfScore, handicap: x.handicap, ou: x.overUnder,
      }));
    }
  } catch (e) { /* 详情失败保留元信息 */ }
  plans.push(base);
}

writeFileSync(join(ROOT, 'data', 'expert-plans.json'), JSON.stringify({
  _note: '网易红彩免费专家方案(世界杯) + 详情。unlocked=true 含正文/推荐/赔率/专家战绩/近期走势；false 仅元信息+深链。展示须标注：专家观点来自第三方·仅供参考·理性购彩·18+。',
  _source: 'hongcai.163.com /api/web/free/0/9999 + /thread/query/{id}/0',
  _fetchedAt: new Date().toISOString(),
  total: wc.length, unlocked: plans.filter((p) => p.unlocked).length, plans,
}, null, 2), 'utf-8');

console.log(`✓ 世界杯方案 ${wc.length} 条（${plans.filter((p) => p.unlocked).length} 条完整可见）→ data/expert-plans.json`);
for (const p of plans) console.log(`  ${p.expert.name}(命中${p.expert.hitRate ?? '?'}) · ${p.matchZh} · ${p.unlocked ? '✓含' + p.recommends.map((r) => r.play).join('/') : '🔒锁定'} · ${p.title.slice(0, 20)}`);
