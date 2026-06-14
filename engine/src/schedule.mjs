// 小组赛真实赛程：从 data/schedule-2026.json 读取（美东时间 EDT），
// 转换为北京时间（UTC+8）并按开球时间排序。

import { loadJson } from './util.mjs';

const FIXTURES = loadJson('data/schedule-2026.json').fixtures;
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
  const list = FIXTURES.map((f) => {
    const t = new Date(f.et); // 解析含 -04:00 偏移 → 正确的绝对时刻
    const bj = new Date(t.getTime() + 8 * 3600000); // 北京时间 = UTC+8（用 UTC 字段读取）
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

  // 轮次：每组每个比赛日有 2 场，故第 n 次出场属于第 ceil(n/2) 轮
  const seen = {};
  list.forEach((m, i) => {
    m.seq = i;
    seen[m.group] = (seen[m.group] || 0) + 1;
    m.round = Math.ceil(seen[m.group] / 2);
  });
  return list;
}
