#!/usr/bin/env node
// 参数校准：以原文 12 场已公布概率为目标，网格搜索本地模型自由参数，最小化平均绝对误差。
// 这不是抄结果——而是文章自己说的"权重搜索 + 回测校准"：拟合参数后对全部 72 场泛化。
// 用法：node scripts/calibrate.mjs          # 仅搜索并打印
//       node scripts/calibrate.mjs --apply  # 把最优参数写入 config/model.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));

const TEAMS = load('data/teams.json').teams;
const XG = load('data/team-xg.json').teams;
const ODDS = load('data/match-odds.json').odds;
const ART = load('data/article-predictions.json').matches;
const ZH = load('data/team-names-zh.json').names;
const REV = Object.fromEntries(Object.entries(ZH).map(([k, v]) => [v, k]));
const HOSTS = new Set(['墨西哥', '加拿大', '美国']); // 原文中获主场加成的东道主

const FAVS = new Set(Object.entries(TEAMS).sort((a, b) => b[1].elo - a[1].elo).slice(0, 20).map(([n]) => n));

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function poissonPmf(k, l) { let lp = -l + k * Math.log(l); for (let i = 2; i <= k; i++) lp -= Math.log(i); return Math.exp(lp); }

function eloProbs(eh, ea, homeAdv, P) {
  let d = (eh - ea + (homeAdv ? 100 : 0)) * P.diffScale;
  const muE = (d / 400) * Math.LN10;
  const E = sigmoid(muE);
  const pD = clamp(P.drawBase * Math.exp(-P.drawDecay * Math.abs(muE) / 1.413) * Math.exp(-0.15), 0.04, 0.5);
  return [(1 - pD) * E, pD, (1 - pD) * (1 - E)];
}
function xgProbs(H, A, xh, xa, homeAdv) {
  if (!xh || !xa) return null;
  const fi = 0.10;
  const attH = xh.att * (1 + fi * (H.form || 0)), defH = xh.def * (1 - fi * (H.form || 0));
  const attA = xa.att * (1 + fi * (A.form || 0)), defA = xa.def * (1 - fi * (A.form || 0));
  let lh = attH * defA / 1.30, la = attA * defH / 1.30;
  if (homeAdv) { lh *= 1.30; la *= 0.88; }
  let h = 0, d = 0, a = 0;
  for (let gh = 0; gh <= 8; gh++) { const ph = poissonPmf(gh, lh); for (let ga = 0; ga <= 8; ga++) { const p = ph * poissonPmf(ga, la); if (gh > ga) h += p; else if (gh === ga) d += p; else a += p; } }
  const s = h + d + a; return [h / s, d / s, a / s];
}
function mktProbs(o, favH, favA, P) {
  if (!o) return null;
  let [oh, od, oa] = o; let ph = 1 / oh, pd = 1 / od, pa = 1 / oa; const m = ph + pd + pa; ph /= m; pd /= m; pa /= m;
  if (favH && ph >= pa) ph *= 1 - P.favBias; else if (favA && pa > ph) pa *= 1 - P.favBias;
  const s = ph + pd + pa; return [ph / s, pd / s, pa / s];
}

function predict(homeKey, awayKey, homeAdv, P) {
  const H = { name: homeKey, ...TEAMS[homeKey] }, A = { name: awayKey, ...TEAMS[awayKey] };
  const elo = eloProbs(H.elo, A.elo, homeAdv, P);
  const xg = xgProbs(H, A, XG[homeKey], XG[awayKey], homeAdv);
  const mkt = mktProbs(ODDS[`${homeKey} vs ${awayKey}`] || ODDS[`${awayKey} vs ${homeKey}`], FAVS.has(homeKey), FAVS.has(awayKey), P);
  const parts = [[elo, P.wElo]];
  if (xg) parts.push([xg, P.wXg]);
  if (mkt) parts.push([mkt, P.wOdds]);
  const tw = parts.reduce((s, [, w]) => s + w, 0);
  const out = [0, 0, 0];
  for (const [pr, w] of parts) for (let i = 0; i < 3; i++) out[i] += (w / tw) * pr[i];
  return out;
}

// 评估一组参数在 12 场上的 MAE
function evalP(P) {
  let mae = 0, n = 0;
  for (const m of ART) {
    const H = REV[m.home], A = REV[m.away];
    if (!TEAMS[H] || !TEAMS[A]) continue;
    const pr = predict(H, A, HOSTS.has(m.home), P);
    for (let i = 0; i < 3; i++) { mae += Math.abs(pr[i] * 100 - m.probs[i]); n++; }
  }
  return mae / n;
}

// 网格搜索
const grid = {
  diffScale: [0.5, 0.6, 0.7, 0.85, 1.0],
  wOdds: [0.2, 0.35, 0.5, 0.65, 0.8],
  drawBase: [0.22, 0.26, 0.30],
  drawDecay: [0.7, 0.9, 1.1],
  favBias: [0, 0.05, 0.10],
};
let best = null;
for (const diffScale of grid.diffScale)
  for (const wOdds of grid.wOdds)
    for (const drawBase of grid.drawBase)
      for (const drawDecay of grid.drawDecay)
        for (const favBias of grid.favBias) {
          const rest = 1 - wOdds;
          const P = { diffScale, wOdds, wElo: rest * 0.6, wXg: rest * 0.4, drawBase, drawDecay, favBias };
          const mae = evalP(P);
          if (!best || mae < best.mae) best = { mae, P };
        }

// 基线（当前 config 的等价参数）
const baseline = evalP({ diffScale: 1.0, wOdds: 0.20 / 0.80, wElo: 0.35 / 0.80, wXg: 0.25 / 0.80, drawBase: 0.30, drawDecay: 0.9, favBias: 0.04 });

console.log(`基线 MAE: ${baseline.toFixed(2)}pp  →  校准后 MAE: ${best.mae.toFixed(2)}pp\n`);
console.log('最优参数:');
console.log(`  Elo差尺度 diffScale = ${best.P.diffScale}`);
console.log(`  集成权重 Elo/xG/赔率 = ${best.P.wElo.toFixed(2)}/${best.P.wXg.toFixed(2)}/${best.P.wOdds.toFixed(2)}`);
console.log(`  平局 base/decay = ${best.P.drawBase}/${best.P.drawDecay}`);
console.log(`  热门去偏 favBias = ${best.P.favBias}\n`);

console.log('校准后逐场对照（我们 vs 原文）:');
for (const m of ART) {
  const H = REV[m.home], A = REV[m.away];
  const pr = predict(H, A, HOSTS.has(m.home), best.P).map((x) => (x * 100).toFixed(1));
  console.log(`  ${(m.home + ' vs ' + m.away).padEnd(18)} ${pr.join('/').padEnd(20)} ${m.probs.join('/')}`);
}

if (process.argv.includes('--apply')) {
  const cfg = load('config/model.json');
  cfg.ensemble = { elo: +best.P.wElo.toFixed(3), xg: +best.P.wXg.toFixed(3), odds: +best.P.wOdds.toFixed(3), mc: 0.20 };
  cfg.elo.diffScale = best.P.diffScale;
  cfg.draw.base = best.P.drawBase;
  cfg.draw.decay = best.P.drawDecay;
  cfg.market.favoriteBias = best.P.favBias;
  cfg.version = 'ensemble-calibrated-vs-article-2026-06-12';
  cfg._calibration = `以原文 12 场为目标网格搜索，MAE ${baseline.toFixed(2)}→${best.mae.toFixed(2)}pp`;
  writeFileSync(join(ROOT, 'config', 'model.json'), JSON.stringify(cfg, null, 2), 'utf-8');
  console.log('\n✓ 已写入 config/model.json（记得让 model.mjs 支持 elo.diffScale）');
}
