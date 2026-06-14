// 小组赛真实赛程（浏览器安全端口，逻辑同 src/schedule.mjs）。
// 从注入的 data/schedule-2026.json 读取（美东时间），转北京时间并按开球时间排序。
// 改动：FIXTURES 由顶层 const 改为 buildSchedule() 内调用时读取（刷新正确）。

import { loadJson } from './util.js';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmt2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 生成有序赛程数组（按比赛时间升序）：
 * [{ seq, round, group, home, away, et, date, time, weekday, kickoff, epoch }]
 * date/time/kickoff/weekday 均为北京时间。
 */
export function buildSchedule() {
  const FIXTURES = loadJson('data/schedule-2026.json').fixtures;
  const list = FIXTURES.map((f) => {
    const t = new Date(f.et);
    const bj = new Date(t.getTime() + 8 * 3600000);
    const date = `${bj.getUTCFullYear()}-${fmt2(bj.getUTCMonth() + 1)}-${fmt2(bj.getUTCDate())}`;
    const time = `${fmt2(bj.getUTCHours())}:${fmt2(bj.getUTCMinutes())}`;
    return {
      group: f.group,
      home: f.home,
      away: f.away,
      et: f.et,
      date,
      time,
      weekday: WEEKDAY[bj.getUTCDay()],
      kickoff: `${date} ${time}`,
      epoch: t.getTime(),
    };
  });

  list.sort((a, b) => a.epoch - b.epoch);

  const seen = {};
  list.forEach((m, i) => {
    m.seq = i;
    seen[m.group] = (seen[m.group] || 0) + 1;
    m.round = Math.ceil(seen[m.group] / 2);
  });
  return list;
}
