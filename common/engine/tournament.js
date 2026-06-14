// 蒙特卡洛模拟引擎（浏览器安全端口，逻辑同 src/tournament.mjs）。
//   迭代次数：默认 config/model.json mc.iterations = 10,000
//   每次迭代：对各队 Elo 施加 N(0, σ=50) 高斯扰动
//   流程：小组赛 → 各组排名 + 8 个最佳第三名 → 32 强对阵 → 逐级推进至冠军
//
// 与 src/tournament.mjs 的【唯一】区别：
//   - src 在模块顶层 const 读 loadJson('data/groups.json') / 默认 CFG；浏览器刷新需用新数据。
//   - 这里把 GROUPS_DATA / CFG 改为【调用时】从 store 读取（loadJson 访问器）。
//     只要重算前 setData(...) 注入最新数据，runMonteCarlo 即用最新数据，刷新正确。
//   - setEngine 注入与 src 一致：默认主模型 predictMatch/getTeam，可注入 v2 引擎。
//   - 所有模拟数学（高斯扰动、采样、小组排序、淘汰赛配对、轮次累计）逐行保持一致。

import { makeRng, samplePoisson, loadJson } from './util.js';
import { predictMatch as defaultPredict, getTeam as defaultGetTeam, getCfg } from './model.js';

// 可切换引擎（默认主模型；v2 / 集成页面可注入）
let predictMatch = defaultPredict;
let getTeam = defaultGetTeam;
export function setEngine(engine) {
  if (engine?.predictMatch) predictMatch = engine.predictMatch;
  if (engine?.getTeam) getTeam = engine.getTeam;
}
// 还原默认引擎（端口便捷方法；避免上次注入残留影响后续）
export function resetEngine() {
  predictMatch = defaultPredict;
  getTeam = defaultGetTeam;
}

// 调用时数据访问器（替代 src 顶层 const，解决刷新陈旧问题）
const groupsData = () => loadJson('data/groups.json');

// Box-Muller 高斯采样
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 本次迭代的扰动球队表：Elo + N(0, sigma)
function perturbTeams(allTeams, sigma, rng) {
  const map = new Map();
  for (const name of allTeams) {
    const t = getTeam(name);
    map.set(name, { ...t, elo: t.elo + sigma * gauss(rng) });
  }
  return map;
}

// 采样单场结果：返回 { result: 'H'|'D'|'A', gh, ga }
function sampleMatch(pred, rng) {
  const r = rng();
  let result;
  if (r < pred.pHome) result = 'H';
  else if (r < pred.pHome + pred.pDraw) result = 'D';
  else result = 'A';

  // 比分用 xG 泊松采样，并按结果做最小修正以自洽
  let gh = samplePoisson(pred.expGoals.home, rng);
  let ga = samplePoisson(pred.expGoals.away, rng);
  if (result === 'H' && gh <= ga) gh = ga + 1;
  if (result === 'A' && ga <= gh) ga = gh + 1;
  if (result === 'D') ga = gh;
  return { result, gh, ga };
}

// 模拟一个小组（T 为本迭代的扰动球队表；known=已完赛固定结果，不再随机抽样）
function simulateGroup(teamNames, T, rng, known) {
  const stats = {};
  for (const t of teamNames) {
    stats[t] = { team: t, pts: 0, gf: 0, ga: 0, gd: 0, elo: T.get(t).elo };
  }
  for (let i = 0; i < teamNames.length; i++) {
    for (let j = i + 1; j < teamNames.length; j++) {
      const a = teamNames[i];
      const b = teamNames[j];
      let m;
      const kr = known ? known.get(a + '|' + b) : null;
      if (kr) m = { result: kr.gh > kr.ga ? 'H' : kr.gh < kr.ga ? 'A' : 'D', gh: kr.gh, ga: kr.ga };
      else {
        const pred = predictMatch(T.get(a), T.get(b), { scores: false });
        m = sampleMatch(pred, rng);
      }
      stats[a].gf += m.gh; stats[a].ga += m.ga;
      stats[b].gf += m.ga; stats[b].ga += m.gh;
      if (m.result === 'H') stats[a].pts += 3;
      else if (m.result === 'A') stats[b].pts += 3;
      else { stats[a].pts += 1; stats[b].pts += 1; }
    }
  }
  for (const t of teamNames) stats[t].gd = stats[t].gf - stats[t].ga;
  return Object.values(stats).sort(
    (x, y) =>
      y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.elo - x.elo || (rng() - 0.5)
  );
}

// 淘汰赛单场（平局按胜负条件概率重分配）
function knockout(aName, bName, T, rng) {
  const pred = predictMatch(T.get(aName), T.get(bName), { scores: false });
  const pa = pred.pHome / (pred.pHome + pred.pAway);
  return rng() < pa ? aName : bName;
}

// 模拟一届赛事，返回每队到达的最远轮次
function simulateTournament(groups, T, rng, known, bestThirdPlaced) {
  const reach = {};
  const thirds = [];
  const qualifiers = [];

  for (const [g, teams] of Object.entries(groups)) {
    const ranked = simulateGroup(teams, T, rng, known);
    for (const t of teams) reach[t] = 'group';
    qualifiers.push({ ...ranked[0], group: g });
    qualifiers.push({ ...ranked[1], group: g });
    thirds.push({ ...ranked[2], group: g });
  }

  // 8 个最佳第三名
  const bestThirds = thirds
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.elo - x.elo || (rng() - 0.5))
    .slice(0, bestThirdPlaced);

  const r32teams = [...qualifiers, ...bestThirds];
  for (const q of r32teams) reach[q.team] = 'r32';

  // 按扰动后 Elo 做种子，强弱交叉配对，32→16→8→4→2→1
  let alive = r32teams.map((q) => q.team).sort((a, b) => T.get(b).elo - T.get(a).elo);
  const roundNames = ['r16', 'qf', 'sf', 'final', 'champion'];
  let ri = 0;
  while (alive.length > 1) {
    const next = [];
    const half = alive.length / 2;
    for (let i = 0; i < half; i++) {
      next.push(knockout(alive[i], alive[alive.length - 1 - i], T, rng));
    }
    next.sort((a, b) => T.get(b).elo - T.get(a).elo);
    for (const w of next) reach[w] = roundNames[ri];
    alive = next;
    ri++;
  }
  return reach;
}

const ROUND_ORDER = ['group', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'];
const ROUND_LABEL = {
  r32: 'reach_r32', r16: 'reach_r16', qf: 'reach_qf',
  sf: 'reach_sf', final: 'reach_final', champion: 'champion',
};

/**
 * 蒙特卡洛主入口。
 * @param {number} iterations 迭代次数（默认 config mc.iterations = 10,000）
 * @param {number} seed 随机种子（可复现，默认 20260612）
 * @param {number} sigma Elo 高斯扰动标准差（默认 50；敏感性分析可传 100）
 * @param {object} opts { knownResults: Map<`${a}|${b}`, {gh,ga}> 已完赛固定（两种朝向都存） }
 */
export function runMonteCarlo(iterations, seed = 20260612, sigma, opts = {}) {
  const CFG = getCfg();
  if (iterations == null) iterations = CFG.mc.iterations;
  if (sigma == null) sigma = CFG.mc.eloSigma;

  const GROUPS_DATA = groupsData();
  const groups = GROUPS_DATA.groups;
  const bestThirdPlaced = GROUPS_DATA.format.bestThirdPlaced;
  const allTeams = Object.values(groups).flat();
  const known = opts.knownResults || null; // Map: `${a}|${b}` → {gh,ga}，已完赛固定
  const tally = {};
  for (const t of allTeams) {
    tally[t] = { reach_r32: 0, reach_r16: 0, reach_qf: 0, reach_sf: 0, reach_final: 0, champion: 0 };
  }

  const rng = makeRng(seed);
  for (let it = 0; it < iterations; it++) {
    const T = perturbTeams(allTeams, sigma, rng); // 每次迭代独立扰动 Elo
    const reach = simulateTournament(groups, T, rng, known, bestThirdPlaced);
    for (const [team, round] of Object.entries(reach)) {
      const idx = ROUND_ORDER.indexOf(round);
      for (let k = 1; k <= idx; k++) {
        const label = ROUND_LABEL[ROUND_ORDER[k]];
        if (label) tally[team][label] += 1;
      }
    }
  }

  const results = allTeams.map((t) => ({
    team: t,
    elo: getTeam(t).elo,
    r32: tally[t].reach_r32 / iterations,
    r16: tally[t].reach_r16 / iterations,
    qf: tally[t].reach_qf / iterations,
    sf: tally[t].reach_sf / iterations,
    final: tally[t].reach_final / iterations,
    champion: tally[t].champion / iterations,
  }));
  results.sort((a, b) => b.champion - a.champion || b.final - a.final);
  return { iterations, seed, sigma, results };
}
