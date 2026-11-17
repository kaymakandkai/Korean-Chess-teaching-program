// 평가 가중치 조정(Texel 방식): npm run tool:tune -- data1.txt data2.txt ...  → 출력된 MW/EW 값을 pst.ts/eval.ts 에 반영
import { readFileSync } from 'fs';
import { Position } from '../src/engine/position';
import { EW, evalCho } from '../src/engine/eval';
import { MW, rebuildPSQ } from '../src/engine/pst';

const lines = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean));
const pos = new Position();
const boards: Int8Array[] = [];
const sides: number[] = [];
const results: number[] = [];
for (const l of lines) {
  const [fen, res] = l.split('\t');
  pos.setFen(fen);
  boards.push(pos.board.slice());
  sides.push(pos.side);
  results.push(Number(res));
}
const N = boards.length;
const isVal = (i: number) => i % 10 === 0;
console.log('positions', N);

function evals(): Float64Array {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    pos.board.set(boards[i]);
    pos.side = sides[i] as 0 | 1;
    pos.recompute();
    out[i] = evalCho(pos, null) + (sides[i] === 0 ? EW.tempo : -EW.tempo);
  }
  return out;
}
function loss(K: number, ev: Float64Array, val: boolean) {
  let s = 0, n = 0;
  for (let i = 0; i < N; i++) {
    if (isVal(i) !== val) continue;
    const p = 1 / (1 + Math.pow(10, (-K * ev[i]) / 400));
    const d = results[i] - p;
    s += d * d; n++;
  }
  return s / n;
}
// K 찾기
let ev = evals();
let K = 1, bestL = Infinity;
for (let k = 0.2; k <= 3; k += 0.05) { const l = loss(k, ev, false); if (l < bestL) { bestL = l; K = k; } }
console.log('K', K.toFixed(2), 'train', bestL.toFixed(5), 'val', loss(K, ev, true).toFixed(5));

type P = { obj: any; key: string; step: number; min: number; max: number; mw: boolean };
const params: P[] = [];
for (const k of Object.keys(MW)) params.push({ obj: MW, key: k, step: k.startsWith('v') ? 10 : 10, min: k.startsWith('v') ? 50 : 0, max: k.startsWith('v') ? 1200 : 300, mw: true });
for (const k of Object.keys(EW)) params.push({ obj: EW, key: k, step: ['attOver'].includes(k) ? 4 : 2, min: 0, max: 200, mw: false });

function trainLoss() { ev = evals(); return loss(K, ev, false); }
let cur = trainLoss();
for (let iter = 0; iter < 8; iter++) {
  let improved = 0;
  for (const p of params) {
    const orig = p.obj[p.key];
    let bestV = orig;
    for (const dir of [1, -1]) {
      let v = orig;
      for (let tries = 0; tries < 6; tries++) {
        const nv = v + dir * p.step;
        if (nv < p.min || nv > p.max) break;
        p.obj[p.key] = nv; if (p.mw) rebuildPSQ();
        const l = trainLoss();
        if (l < cur - 1e-7) { cur = l; v = nv; bestV = nv; } else break;
      }
      p.obj[p.key] = bestV; if (p.mw) rebuildPSQ();
      if (bestV !== orig) break;
    }
    if (bestV !== orig) improved++;
  }
  ev = evals();
  console.log('iter', iter, 'changed', improved, 'train', cur.toFixed(5), 'val', loss(K, ev, true).toFixed(5));
  if (!improved) { for (const p of params) p.step = Math.max(1, Math.floor(p.step / 2)); }
}
console.log('MW', JSON.stringify(MW));
console.log('EW', JSON.stringify(EW));
