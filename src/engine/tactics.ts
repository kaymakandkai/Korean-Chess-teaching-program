// 전술 분석 도우미: 교환 계산(SEE), 공격받는 기물, 장군 기물
import { KING, NSQ, PASS, Side } from './constants';
import { Position } from './position';
import { SEE_VALUE } from './pst';

/** 차례인 쪽이 t 칸을 잡을 수 있는 합법수 */
export function legalCapturesTo(pos: Position, t: number): number[] {
  const res: number[] = [];
  if (!pos.board[t]) return res;
  const buf: number[] = [];
  const n = pos.genMoves(buf, true);
  const us = pos.side;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    if ((m & 127) !== t) continue;
    pos.makeMove(m);
    if (!pos.inCheck(us)) res.push(m);
    pos.unmakeMove();
  }
  return res;
}

function leastValuable(pos: Position, moves: number[]): number {
  let best = 0;
  let bv = Infinity;
  for (const m of moves) {
    const v = SEE_VALUE[pos.board[m >> 7] & 7];
    if (v < bv) {
      bv = v;
      best = m;
    }
  }
  return best;
}

/** t 칸에서 차례인 쪽이 교환을 시작했을 때 얻는 최대 이득 (시작하지 않을 수도 있으므로 ≥ 0) */
function seeRec(pos: Position, t: number, depth: number): number {
  if (depth > 12) return 0;
  const victim = pos.board[t];
  if (!victim || (victim & 7) === KING) return 0;
  const caps = legalCapturesTo(pos, t);
  if (!caps.length) return 0;
  const m = leastValuable(pos, caps);
  pos.makeMove(m);
  const v = SEE_VALUE[victim & 7] - seeRec(pos, t, depth + 1);
  pos.unmakeMove();
  return v > 0 ? v : 0;
}

/** 잡는 수 m 의 교환 손익 (음수 가능) */
export function seeMove(pos: Position, m: number): number {
  if (m === PASS) return 0;
  const t = m & 127;
  const victim = pos.board[t];
  if (!victim) {
    // 조용한 수: 옮긴 기물이 잡히는지
    pos.makeMove(m);
    const loss = seeRec(pos, t, 0);
    pos.unmakeMove();
    return -loss;
  }
  pos.makeMove(m);
  const v = SEE_VALUE[victim & 7] - seeRec(pos, t, 1);
  pos.unmakeMove();
  return v;
}

export interface Hanging {
  sq: number;
  piece: number;
  /** 상대가 얻을 수 있는 이득 (엔진 점수) */
  gain: number;
  /** 공격하는 상대 기물 위치 */
  attackers: number[];
  /** 지켜주는 기물이 있는지 */
  defended: boolean;
  /** 상대가 둘 최선의 잡는 수 */
  bestCapture: number;
}

/**
 * victimSide 의 기물 중, 상대가 (자기 차례라면) 이득을 보고 잡을 수 있는 것들.
 * 현재 차례가 victimSide 이면 한수 쉼을 가정한다.
 */
export function winnablePieces(pos: Position, victimSide: Side, minGain = 60): Hanging[] {
  const passed = pos.side === victimSide;
  if (passed) pos.makeMove(PASS);
  const res: Hanging[] = [];
  const b = pos.board;
  for (let s = 0; s < NSQ; s++) {
    const p = b[s];
    if (!p || p >> 3 !== victimSide || (p & 7) === KING) continue;
    const caps = legalCapturesTo(pos, s);
    if (!caps.length) continue;
    let best = -Infinity;
    let bestM = 0;
    for (const m of caps) {
      const g = seeMove(pos, m);
      if (g > best) {
        best = g;
        bestM = m;
      }
    }
    if (best >= minGain) {
      res.push({
        sq: s,
        piece: p,
        gain: best,
        attackers: caps.map((m) => m >> 7),
        defended: best < SEE_VALUE[p & 7] - 5,
        bestCapture: bestM,
      });
    }
  }
  if (passed) pos.unmakeMove();
  res.sort((a, b2) => b2.gain - a.gain);
  return res;
}

/** side 의 궁을 공격(장군)하고 있는 상대 기물 위치 */
export function checkers(pos: Position, side: Side): number[] {
  const k = pos.kingSq[side];
  if (k < 0) return [];
  const passed = pos.side === side;
  if (passed) pos.makeMove(PASS);
  const buf: number[] = [];
  const n = pos.genMoves(buf, true);
  const res: number[] = [];
  for (let i = 0; i < n; i++) if ((buf[i] & 127) === k) res.push(buf[i] >> 7);
  if (passed) pos.unmakeMove();
  return res;
}

/** side 기물이 공격하는 칸들 (의사 합법 기준) */
export function attackedSquares(pos: Position, side: Side): Set<number> {
  const set = new Set<number>();
  for (let s = 0; s < NSQ; s++) if (pos.isAttacked(s, side)) set.add(s);
  return set;
}
