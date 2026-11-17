// 자가대국 기보 생성: npm run tool:selfplay -- <seed> <games> <ms> > data.txt  (출력: "국면<TAB>결과(초 기준 1/0.5/0)")
import { Searcher } from '../src/engine/search';
import { buildInitialPosition } from '../src/engine/setup';
const POINTS = [0, 0, 3, 3, 5, 13, 7, 2];
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const forms = ['마상마상', '상마상마', '마상상마', '상마마상'] as const;
const [seed, games, ms] = process.argv.slice(2).map(Number);
const r = rng(seed);
const S = new Searcher(18);
for (let g = 0; g < games; g++) {
  const pos = buildInitialPosition({ formations: [forms[Math.floor(r() * 4)], forms[Math.floor(r() * 4)]], removed: [[], []], first: 0 });
  const fens: string[] = [];
  let result = -1;
  const randomPlies = 6 + Math.floor(r() * 6);
  for (let ply = 0; ply < 200; ply++) {
    const legal = pos.legalMoves();
    if (!legal.length) { if (pos.inCheck()) { result = pos.side === 0 ? 0 : 1; break; } pos.makeMove(16383); continue; }
    const facingBefore = pos.kingsFacing();
    let m: number;
    if (ply < randomPlies) {
      const scored = legal.map((mv) => { pos.makeMove(mv); const v = -S.search(pos, { maxDepth: 1 }).score; pos.unmakeMove(); return { mv, v }; }).sort((a, b) => b.v - a.v);
      m = scored[Math.floor(r() * Math.min(6, scored.length))].mv;
    } else {
      const res = S.search(pos, { timeMs: ms, bikjang: true, contempt: 15 });
      m = res.move;
      if (!pos.inCheck() && pos.board[m & 127] === 0 && pos.lastCaptured() === 0 && ply >= 10) fens.push(pos.toFen());
    }
    pos.makeMove(m);
    if (facingBefore && pos.kingsFacing()) { result = 0.5; break; }
    if (pos.repetitionCount() >= 2) { result = 0.5; break; }
  }
  if (result < 0) {
    const pts = [0, 1.5];
    for (let s = 0; s < 90; s++) { const p = pos.board[s]; if (p) pts[p >> 3] += POINTS[p & 7]; }
    const d = pts[0] - pts[1];
    result = d > 4 ? 1 : d < -4 ? 0 : 0.5;
  }
  for (const f of fens) console.log(f + '\t' + result);
}
