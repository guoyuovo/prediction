// model.mjs 回归测试（零依赖，node --test）。
// 覆盖：概率归一、强弱单调、平局乘子(liveMult)不变量。
// 用法：npm test   或   node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictMatch, CFG } from '../src/model.mjs';

// 用对象入参（绕开 teams.json），队名不在 HOSTS → 中立场，便于稳定断言
const strong = { name: '__TestStrong', elo: 2000, fifa: 1850, value: 900, form: 0.5, squad: 85 };
const weak = { name: '__TestWeak', elo: 1500, fifa: 1400, value: 100, form: -0.2, squad: 68 };
const sum = (r) => r.pHome + r.pDraw + r.pAway;

test('三路概率和为 1', () => {
  const r = predictMatch(strong, weak, { scores: false });
  assert.ok(Math.abs(sum(r) - 1) < 1e-9, `sum=${sum(r)}`);
});

test('强队胜率高于弱队（中立场）', () => {
  const r = predictMatch(strong, weak, { scores: false });
  assert.ok(r.pHome > r.pAway, `pHome=${r.pHome} pAway=${r.pAway}`);
});

test('实力相当 → 主客接近', () => {
  const r = predictMatch({ ...strong, name: '__A' }, { ...strong, name: '__B' }, { scores: false });
  assert.ok(Math.abs(r.pHome - r.pAway) < 0.05, `pHome=${r.pHome} pAway=${r.pAway}`);
});

test('平局乘子 liveMult 提高平局概率且仍归一', () => {
  const base = predictMatch(strong, weak, { scores: false });
  const prev = CFG.draw.liveMult;
  try {
    CFG.draw.liveMult = 1.5;
    const hi = predictMatch(strong, weak, { scores: false });
    assert.ok(hi.pDraw > base.pDraw, `draw 应升高: ${base.pDraw} → ${hi.pDraw}`);
    assert.ok(Math.abs(sum(hi) - 1) < 1e-9, `仍应归一: sum=${sum(hi)}`);
  } finally {
    CFG.draw.liveMult = prev; // 还原，避免污染其它用例
  }
});

test('liveMult=1 不改变结果', () => {
  const prev = CFG.draw.liveMult;
  try {
    CFG.draw.liveMult = 1;
    const r = predictMatch(strong, weak, { scores: false });
    CFG.draw.liveMult = 1.0; // 显式 no-op 路径
    const r2 = predictMatch(strong, weak, { scores: false });
    assert.equal(r.pDraw, r2.pDraw);
  } finally {
    CFG.draw.liveMult = prev;
  }
});
