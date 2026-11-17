// 무작위 국면에서 빠른 판정(합법성·장군)이 정밀 판정과 같은지 검사
import { describe, expect, it } from 'vitest';
import { CHO, HAN, PASS } from '../src/engine/constants';
import { Position } from '../src/engine/position';
import { Searcher } from '../src/engine/search';
import { buildInitialPosition } from '../src/engine/setup';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const forms = ['마상마상', '상마상마', '마상상마', '상마마상'] as const;

/** 무작위 대국에서 국면들을 모은다 (잡는 수를 자주 두어 다양한 형태를 만든다) */
function randomPositions(seed: number, games: number): string[] {
  const r = rng(seed);
  const out: string[] = [];
  for (let g = 0; g < games; g++) {
    const pos = buildInitialPosition({ formations: [forms[g % 4], forms[(g >> 2) % 4]], removed: [[], []], first: g % 2 ? HAN : CHO });
    for (let ply = 0; ply < 120; ply++) {
      const legal = pos.legalMoves();
      if (!legal.length) break;
      const caps = legal.filter((m) => pos.board[m & 127]);
      const m = caps.length && r() < 0.5 ? caps[Math.floor(r() * caps.length)] : legal[Math.floor(r() * legal.length)];
      pos.makeMove(m);
      out.push(pos.toFen());
    }
  }
  return out;
}

describe('빠른 판정 검증 (무작위 국면)', () => {
  const fens = randomPositions(42, 40);

  it('합법성 빠른 판정 = 정밀 판정, 장군 빠른 판정 = 정밀 판정', () => {
    let checked = 0;
    for (const fen of fens) {
      const pos = Position.fromFen(fen);
      const us = pos.side;
      const wasInCheck = pos.inCheck(us);
      const buf: number[] = [];
      const n = pos.genMoves(buf, false);
      for (let i = 0; i < n; i++) {
        const m = buf[i];
        expect(pos.isPseudoLegal(m)).toBe(true);
        pos.makeMove(m);
        const fast = pos.leavesKingSafe(m, us, wasInCheck);
        const full = !pos.inCheck(us);
        if (fast !== full) throw new Error(`합법성 불일치: ${fen} 수 ${m}`);
        const gFast = pos.givesCheck(m);
        const gFull = pos.inCheck(pos.side);
        if (gFast !== gFull) throw new Error(`장군 판정 불일치: ${fen} 수 ${m}`);
        pos.unmakeMove();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50000);
  });

  it('기물 목록이 보드와 항상 일치한다', () => {
    for (const fen of fens.slice(0, 600)) {
      const pos = Position.fromFen(fen);
      for (const m of pos.legalMoves()) {
        pos.makeMove(m);
        pos.unmakeMove();
      }
      for (const side of [CHO, HAN]) {
        const fromList = Array.from(pos.plist[side].subarray(0, pos.pcnt[side])).sort((a, b) => a - b);
        const fromBoard: number[] = [];
        for (let s = 0; s < 90; s++) if (pos.board[s] && pos.board[s] >> 3 === side) fromBoard.push(s);
        expect(fromList).toEqual(fromBoard);
      }
    }
  });

  it('탐색은 항상 합법수를 돌려준다', () => {
    const S = new Searcher(16);
    for (const fen of fens.filter((_, i) => i % 25 === 0)) {
      const pos = Position.fromFen(fen);
      const legal = pos.legalMoves();
      const r = S.search(pos, { maxDepth: 4, bikjang: true, allowPass: true, contempt: 30 });
      if (!legal.length && pos.inCheck()) continue;
      if (r.move === PASS) expect(pos.inCheck()).toBe(false);
      else expect(legal).toContain(r.move);
    }
  });
});
