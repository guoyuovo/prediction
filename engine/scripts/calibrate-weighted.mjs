#!/usr/bin/env node
// 加权模型（第一篇文章）校准：以原文 12 场概率为目标，网格搜索 scale/diffScale/赔率融合/平局参数
// 用法：node scripts/calibrate-weighted.mjs [--apply]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const load = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf-8'));
const TEAMS = load('data/teams.json').teams;
const ODDS = load('data/match-odds.json').odds;
const ART = load('data/article-predictions.json').matches;
const ZH = load('data/team-names-zh.json').names;
const REV = Object.fromEntries(Object.entries(ZH).map(([k, v]) => [v, k]));
const HOSTS = new Set(['墨西哥', '加拿大', '美国']);
const W = load('config/model.json').weights;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const feat = (d, s) => 2 * (sigmoid(d / s) - 0.5);
const squad = (elo) => clamp(66 + (elo - 1500) / 700 * 20, 60, 90);

function predict(hk, ak, homeAdv, P) {
  const H = TEAMS[hk], A = TEAMS[ak];
  let eloDiff = H.elo - A.elo + (homeAdv ? 60 : 0); eloDiff *= P.diffScale;
  const fElo = feat(eloDiff, 420), fFifa = feat((H.fifa || 0) - (A.fifa || 0), 280);
  const fValue = 2 * (sigmoid(Math.log((H.value || 1) / (A.value || 1))) - 0.5);
  const fForm = feat(((H.form || 0) - (A.form || 0)) * 2.2, 1);
  const fSquad = feat(squad(H.elo) - squad(A.elo), 8);
  const lin = W.elo * fElo + W.fifa * fFifa + W.value * fValue + W.form * fForm + W.squad * fSquad + W.home * (homeAdv ? 1 : 0);
  const mu = P.scale * lin;
  const pD0 = clamp(P.drawBase * Math.exp((-P.drawDecay * Math.abs(mu)) / 1.413) * Math.exp(-0.15), 0.04, 0.5);
  let h = (1 - pD0) * sigmoid(mu), d = pD0, a = (1 - pD0) * (1 - sigmoid(mu));
  const o = ODDS[`${hk} vs ${ak}`];
  if (o) { const ph = 1 / o[0], pd = 1 / o[1], pa = 1 / o[2], m = ph + pd + pa; const f = P.fusion; h = (1 - f) * h + f * ph / m; d = (1 - f) * d + f * pd / m; a = (1 - f) * a + f * pa / m; }
  return [h * 100, d * 100, a * 100];
}
function mae(P) {
  let s = 0, n = 0;
  for (const m of ART) { const H = REV[m.home], A = REV[m.away]; if (!TEAMS[H] || !TEAMS[A]) continue; const pr = predict(H, A, HOSTS.has(m.home), P); for (let i = 0; i < 3; i++) { s += Math.abs(pr[i] - m.probs[i]); n++; } }
  return s / n;
}

let best = null;
for (const scale of [2.0, 2.5, 3.0, 3.5, 4.0])
  for (const diffScale of [0.5, 0.7, 0.85, 1.0])
    for (const fusion of [0.35, 0.5, 0.65])
      for (const drawBase of [0.24, 0.28, 0.32])
        for (const drawDecay of [0.7, 0.9, 1.1]) {
          const P = { scale, diffScale, fusion, drawBase, drawDecay };
          const e = mae(P); if (!best || e < best.e) best = { e, P };
        }
const base = mae({ scale: 5, diffScale: 1, fusion: 0.35, drawBase: 0.30, drawDecay: 0.9 });
console.log(`基线 MAE ${base.toFixed(2)}pp → 校准后 ${best.e.toFixed(2)}pp`);
console.log(`最优：scale=${best.P.scale} diffScale=${best.P.diffScale} 赔率融合=${best.P.fusion} draw=${best.P.drawBase}/${best.P.drawDecay}\n`);
for (const m of ART) { const pr = predict(REV[m.home], REV[m.away], HOSTS.has(m.home), best.P); console.log('  ' + (m.home + ' vs ' + m.away).padEnd(16) + pr.map((x) => x.toFixed(0)).join('/').padEnd(11) + m.probs.join('/')); }

if (process.argv.includes('--apply')) {
  const cfg = load('config/model.json');
  cfg.scale = best.P.scale; cfg.elo.diffScale = best.P.diffScale; cfg.oddsFusion = best.P.fusion;
  cfg.draw.base = best.P.drawBase; cfg.draw.decay = best.P.drawDecay;
  cfg._calibration = `以原文12场校准，MAE ${base.toFixed(2)}→${best.e.toFixed(2)}pp`;
  writeFileSync(join(ROOT, 'config', 'model.json'), JSON.stringify(cfg, null, 2), 'utf-8');
  console.log('\n✓ 已写入 config/model.json');
}
