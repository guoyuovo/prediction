// Dixon-Coles 波胆回测：训练拟合(base,spread,rho)，测试集样本外验证精确比分命中率。
//   DC 修正：P(x,y)=τ(x,y)·Pois(x;λ)·Pois(y;μ)，τ 仅对 0/1 低比分相关性修正：
//     τ(0,0)=1-λμρ, τ(0,1)=1+λρ, τ(1,0)=1+μρ, τ(1,1)=1-ρ, 其余=1
//   ρ<0 抬升 0-0/1-1（现实低比分平局更密集），这正是泊松众数法押不出 1-1 的病根。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadJson, sigmoid } from '../src/util.mjs';

const W = loadJson('config/model.json');
const Hh = { 'User-Agent': 'Mozilla/5.0' };
const getText = async (u) => { const r = await fetch(u, { headers: Hh }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); };
const clubeloNorm = (s) => s.toLowerCase().replace(/\b(fc|cf|ac|sc|afc)\b/g, '').replace(/[^a-z]/g, '');
const FALIAS = { "Nott'm Forest": 'Forest', 'Ath Madrid': 'Atletico', 'Ath Bilbao': 'Athletic', 'Vallecano': 'Rayo Vallecano', 'Espanol': 'Espanyol', 'Bayern Munich': 'Bayern', "M'gladbach": 'Gladbach', 'Ein Frankfurt': 'Frankfurt', 'Werder Bremen': 'Werder', 'FC Koln': 'Koln' };
const fKey = (t) => clubeloNorm(FALIAS[t] || t);
const snapCache = existsSync(join(ROOT, 'data', 'clubelo-snapshots.json')) ? loadJson('data/clubelo-snapshots.json').snaps || {} : {};
function eloOn(key, ds) { let best = null; for (const d in snapCache) if (d <= ds && (!best || d > best)) best = d; if (!best) best = Object.keys(snapCache).sort()[0]; return best ? (snapCache[best]?.[key] ?? null) : null; }
function fact(k){let f=1;for(let i=2;i<=k;i++)f*=i;return f;}
const PF=[1,1,2,6,24,120,720,5040,40320];
function pois(k,l){return Math.exp(-l)*Math.pow(l,k)/PF[k];}
const HOME_FB = 65;

function muOf(eh, ea) {
  const d = (eh - ea + HOME_FB) * (W.elo.diffScale ?? 1);
  const fElo = 2 * (sigmoid(d / W.norm.eloScale) - 0.5);
  return W.scale * (W.weights.elo * fElo + W.weights.home);
}
function tau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
// DC 全局最可能比分
function dcMode(lh, la, rho) {
  let b = null;
  for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) {
    const p = tau(x, y, lh, la, rho) * pois(x, lh) * pois(y, la);
    if (!b || p > b.p) b = { x, y, p };
  }
  return b.x + '-' + b.y;
}
function dcTop3(lh, la, rho) {
  const cells = [];
  for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) cells.push({ s: x + '-' + y, p: tau(x, y, lh, la, rho) * pois(x, lh) * pois(y, la) });
  cells.sort((a, b) => b.p - a.p); return [cells[0].s, cells[1].s, cells[2].s];
}

async function collect(league, code) {
  let csv; try { csv = await getText(`https://www.football-data.co.uk/mmz4281/${code}/${league}.csv`); } catch { return []; }
  const lines = csv.split('\n').filter(Boolean); const hdr = lines[0].split(','); const ix = (n) => hdr.indexOf(n);
  const C = { d: ix('Date'), h: ix('HomeTeam'), a: ix('AwayTeam'), fh: ix('FTHG'), fa: ix('FTAG') };
  if (C.fh < 0 || C.a < 0) return [];
  const rows = [];
  for (const l of lines.slice(1)) {
    const c = l.split(','); if (!c[C.h] || c[C.fh] === '') continue;
    const [dd, mm, yy] = c[C.d].split('/'); const yr = +yy < 100 ? 2000 + +yy : +yy;
    const ds = `${yr}-${String(+mm).padStart(2, '0')}-${String(+dd).padStart(2, '0')}`;
    const eh = eloOn(fKey(c[C.h]), ds), ea = eloOn(fKey(c[C.a]), ds);
    if (eh == null || ea == null) continue;
    rows.push({ z: (eh - ea) / 400, gh: +c[C.fh], ga: +c[C.fa], real: (+c[C.fh]) + '-' + (+c[C.fa]) });
  }
  return rows;
}

const TRAIN = [['E0','2122'],['E0','2223'],['E0','2324'],['SP1','2324'],['D1','2324'],['I1','2324'],['F1','2324']];
const TEST  = [['E0','2425'],['SP1','2425'],['D1','2425'],['I1','2425'],['F1','2425']];
console.log('抓取数据...');
const train = [], test = [];
for (const [lg,c] of TRAIN) train.push(...await collect(lg,c));
for (const [lg,c] of TEST)  test.push(...await collect(lg,c));
console.log(`训练 ${train.length} 场 · 测试 ${test.length} 场\n`);

// 真实进球率参数化（与 1X2 supremacy 解耦）：
//   λ主 = exp(A + Bh + S·z)，λ客 = exp(A - S·z)   z=(eloH-eloA)/400
//   A=平均对数进球率, Bh=主场log加成, S=强弱敏感度, rho=DC低分相关
function lambdas(z, A, Bh, S) { return [Math.exp(A + Bh + S * z), Math.exp(A - S * z)]; }
function hit(rows, A, Bh, S, RHO) {
  let ex = 0, t3 = 0;
  for (const r of rows) { const [lh,la]=lambdas(r.z,A,Bh,S); if (dcMode(lh,la,RHO)===r.real) ex++; if (dcTop3(lh,la,RHO).includes(r.real)) t3++; }
  return { ex: ex/rows.length, t3: t3/rows.length };
}

// 训练集网格搜索 (A, Bh, S, rho)
let best = null;
for (let A=0.0; A<=0.45; A+=0.05) for (let Bh=0.05; Bh<=0.45; Bh+=0.05) for (let S=0.2; S<=0.9; S+=0.1) for (let R=-0.25; R<=0.06; R+=0.03) {
  const e = hit(train, A, Bh, S, R).ex; if (!best || e > best.e) best = { A, Bh, S, R, e };
}
const trBest = hit(train, best.A, best.Bh, best.S, best.R);
const teBest = hit(test, best.A, best.Bh, best.S, best.R);
const base11tr = train.filter(r=>r.real==='1-1').length/train.length;
const base11te = test.filter(r=>r.real==='1-1').length/test.length;

console.log(`训练最优参数: A=${best.A.toFixed(2)} Bh=${best.Bh.toFixed(2)} S=${best.S.toFixed(2)} rho=${best.R.toFixed(2)}  (均场λ主${Math.exp(best.A+best.Bh).toFixed(2)}/客${Math.exp(best.A).toFixed(2)})`);
console.log(`波胆单选命中:  训练 ${(trBest.ex*100).toFixed(1)}%  →  测试 ${(teBest.ex*100).toFixed(1)}%   (基线1-1: 训练${(base11tr*100).toFixed(1)}% 测试${(base11te*100).toFixed(1)}%)`);
console.log(`波胆top3命中:  训练 ${(trBest.t3*100).toFixed(1)}%  →  测试 ${(teBest.t3*100).toFixed(1)}%`);
// 预测比分分布
const dist = {};
for (const r of test) { const [lh,la]=lambdas(r.z,best.A,best.Bh,best.S); const s=dcMode(lh,la,best.R); dist[s]=(dist[s]||0)+1; }
console.log('测试集预测比分分布:', Object.entries(dist).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([s,n])=>s+' '+(n/test.length*100).toFixed(0)+'%').join(' · '));
