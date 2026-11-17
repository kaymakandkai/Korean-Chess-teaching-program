// 탐색: 반복 심화 + 알파베타(PVS) + 치환표 + 정지탐색
import { INF, KING, MATE, MATE_BOUND, NO_MOVE, NSQ, PASS } from './constants';
import { evaluate } from './eval';
import { Position } from './position';
import { SEE_VALUE, VALUE } from './pst';

const MAX_PLY = 64;
const MAX_MOVES = 220;

const EXACT = 1;
const LOWER = 2;
const UPPER = 3;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class TransTable {
  mask: number;
  keys: Int32Array;
  moves: Int32Array;
  scores: Int16Array;
  depths: Int8Array;
  flags: Uint8Array;
  constructor(bits: number) {
    const size = 1 << bits;
    this.mask = size - 1;
    this.keys = new Int32Array(size);
    this.moves = new Int32Array(size);
    this.scores = new Int16Array(size);
    this.depths = new Int8Array(size);
    this.flags = new Uint8Array(size);
  }
  clear() {
    this.flags.fill(0);
  }
}

export interface SearchLimits {
  maxDepth?: number;
  timeMs?: number;
  maxNodes?: number;
  /** 빅장 규칙 사용 */
  bikjang?: boolean;
  /** 루트에서 제외할 수 (다중 후보 분석용) */
  excludeRoot?: number[];
  /** 루트에서 한수 쉼 고려 */
  allowPass?: boolean;
}

export interface SearchResult {
  move: number;
  /** 차례인 쪽 관점 점수 */
  score: number;
  depth: number;
  pv: number[];
  nodes: number;
  timeMs: number;
}

export function isMateScore(s: number) {
  return Math.abs(s) >= MATE_BOUND;
}
/** 외통까지 남은 수(자기 수 기준). 양수: 이기는 쪽 */
export function mateIn(score: number): number {
  if (score > 0) return Math.ceil((MATE - score) / 2);
  return -Math.ceil((MATE + score) / 2);
}

export class Searcher {
  private tt: TransTable;
  private pos!: Position;
  private moveBuf: Int32Array[] = [];
  private scoreBuf: Int32Array[] = [];
  private killers = new Int32Array(MAX_PLY * 2);
  private hist = new Int32Array(NSQ * 128);
  private pvTable = new Int32Array(MAX_PLY * MAX_PLY);
  private pvLen = new Int32Array(MAX_PLY + 1);
  nodes = 0;
  private stopAt = 0;
  private maxNodes = Infinity;
  private stopped = false;
  private canStop = false;
  private bikjang = true;
  private rootBest = NO_MOVE;

  constructor(ttBits = 20) {
    this.tt = new TransTable(ttBits);
    for (let i = 0; i < MAX_PLY + 2; i++) {
      this.moveBuf.push(new Int32Array(MAX_MOVES));
      this.scoreBuf.push(new Int32Array(MAX_MOVES));
    }
  }

  clear() {
    this.tt.clear();
    this.hist.fill(0);
    this.killers.fill(0);
  }

  private prepare(pos: Position, limits: SearchLimits) {
    this.pos = pos;
    this.nodes = 0;
    this.stopped = false;
    this.canStop = false;
    this.bikjang = limits.bikjang ?? true;
    this.stopAt = now() + (limits.timeMs ?? 1e9);
    this.maxNodes = limits.maxNodes ?? Infinity;
    this.killers.fill(0);
    for (let i = 0; i < this.hist.length; i++) this.hist[i] >>= 2;
  }

  /** 루트 합법수 목록 */
  rootMoves(pos: Position, limits: SearchLimits): number[] {
    const moves = pos.legalMoves();
    const ex = limits.excludeRoot;
    const res = ex && ex.length ? moves.filter((m) => !ex.includes(m)) : moves;
    if (limits.allowPass && !pos.inCheck() && !(ex && ex.includes(PASS))) res.push(PASS);
    return res;
  }

  search(pos: Position, limits: SearchLimits = {}): SearchResult {
    const start = now();
    this.prepare(pos, limits);
    const maxDepth = Math.min(limits.maxDepth ?? 64, MAX_PLY - 4);
    const moves = this.rootMoves(pos, limits);
    if (moves.length === 0) {
      const inCheck = pos.inCheck();
      return {
        move: inCheck || limits.excludeRoot?.length ? NO_MOVE : PASS,
        score: inCheck ? -MATE : 0,
        depth: 0,
        pv: [],
        nodes: 0,
        timeMs: 0,
      };
    }
    const rootScores = new Map<number, number>();
    let bestMove = moves[0];
    let bestScore = -INF;
    let bestPv: number[] = [bestMove];
    let completed = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      let delta = 45;
      let alpha = -INF;
      let beta = INF;
      if (depth >= 4 && !isMateScore(bestScore)) {
        alpha = bestScore - delta;
        beta = bestScore + delta;
      }
      let score = 0;
      for (;;) {
        score = this.rootSearch(depth, alpha, beta, moves, rootScores, bestMove);
        if (this.stopped) break;
        if (score <= alpha) {
          alpha = Math.max(-INF, alpha - delta);
          delta *= 3;
        } else if (score >= beta) {
          beta = Math.min(INF, beta + delta);
          delta *= 3;
        } else break;
        if (delta > 1500) {
          alpha = -INF;
          beta = INF;
        }
      }
      if (this.stopped) break;
      bestMove = this.rootBest;
      bestScore = score;
      bestPv = Array.from(this.pvTable.subarray(0, this.pvLen[0]));
      if (!bestPv.length || bestPv[0] !== bestMove) bestPv = [bestMove];
      completed = depth;
      this.canStop = true;
      const elapsed = now() - start;
      if (isMateScore(score) && depth >= MATE - Math.abs(score) + 1) break;
      if (limits.timeMs !== undefined && elapsed > limits.timeMs * 0.5) break;
      if (this.nodes >= this.maxNodes) break;
      if (moves.length === 1 && depth >= 4) break;
    }
    return {
      move: bestMove,
      score: bestScore,
      depth: completed,
      pv: bestPv,
      nodes: this.nodes,
      timeMs: Math.round(now() - start),
    };
  }

  /**
   * 루트의 모든 수를 고정 깊이로 평가 (난이도별 실수 흉내용).
   * 최선보다 margin 이상 나쁜 수는 상한값만 구해진다.
   */
  scoreRootMoves(pos: Position, depth: number, margin: number, limits: SearchLimits = {}) {
    const base = this.search(pos, { ...limits, maxDepth: depth });
    const moves = this.rootMoves(pos, limits);
    this.prepare(pos, limits);
    this.canStop = true;
    const floor = base.score - margin;
    const out: { move: number; score: number }[] = [];
    const facing = this.bikjang && pos.kingsFacing();
    for (const m of moves) {
      let s: number;
      if (m === base.move) s = base.score;
      else {
        pos.makeMove(m);
        if (facing && pos.kingsFacing()) s = 0;
        else s = -this.negamax(depth - 1, -INF, -floor, 1, true);
        pos.unmakeMove();
        if (this.stopped) s = Math.min(s, floor);
      }
      out.push({ move: m, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    return { base, scored: out };
  }

  private rootSearch(
    depth: number,
    alpha: number,
    beta: number,
    moves: number[],
    rootScores: Map<number, number>,
    prevBest: number,
  ): number {
    const pos = this.pos;
    this.pvLen[0] = 0;
    // 정렬: 이전 최선수 → 이전 점수 순
    moves.sort((a, b) => {
      if (a === prevBest) return -1;
      if (b === prevBest) return 1;
      return (rootScores.get(b) ?? -INF) - (rootScores.get(a) ?? -INF);
    });
    const facing = this.bikjang && pos.kingsFacing();
    let best = -INF;
    this.rootBest = moves[0];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      pos.makeMove(m);
      this.nodes++;
      let score: number;
      this.pvLen[1] = 1;
      if (facing && pos.kingsFacing()) score = 0;
      else if (i === 0) score = -this.negamax(depth - 1, -beta, -alpha, 1, true);
      else {
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, true);
        if (score > alpha && score < beta && !this.stopped) score = -this.negamax(depth - 1, -beta, -alpha, 1, true);
      }
      pos.unmakeMove();
      if (this.stopped) return best;
      rootScores.set(m, score);
      if (score > best) {
        best = score;
        this.rootBest = m;
        if (score > alpha) {
          alpha = score;
          this.updatePv(0, m);
          if (alpha >= beta) break;
        }
      }
    }
    return best;
  }

  private updatePv(ply: number, m: number) {
    const base = ply * MAX_PLY;
    this.pvTable[base + ply] = m;
    const cbase = (ply + 1) * MAX_PLY;
    const clen = this.pvLen[ply + 1];
    for (let i = ply + 1; i < clen; i++) this.pvTable[base + i] = this.pvTable[cbase + i];
    this.pvLen[ply] = clen > ply + 1 ? clen : ply + 1;
  }

  private checkTime() {
    if (!this.canStop) return;
    if (now() >= this.stopAt || this.nodes >= this.maxNodes) this.stopped = true;
  }

  private scoreMoves(moves: Int32Array, scores: Int32Array, n: number, ttMove: number, ply: number) {
    const b = this.pos.board;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (m === ttMove) scores[i] = 1 << 30;
      else if (m === PASS) scores[i] = -(1 << 30);
      else {
        const cap = b[m & 127];
        if (cap) scores[i] = (1 << 24) + SEE_VALUE[cap & 7] * 8 - VALUE[b[m >> 7] & 7];
        else if (m === k1) scores[i] = 1 << 23;
        else if (m === k2) scores[i] = (1 << 23) - 1;
        else scores[i] = this.hist[(m >> 7) * 128 + (m & 127)];
      }
    }
  }

  private pick(moves: Int32Array, scores: Int32Array, i: number, n: number) {
    let bi = i;
    let bs = scores[i];
    for (let j = i + 1; j < n; j++) {
      if (scores[j] > bs) {
        bs = scores[j];
        bi = j;
      }
    }
    if (bi !== i) {
      const tm = moves[i];
      moves[i] = moves[bi];
      moves[bi] = tm;
      const ts = scores[i];
      scores[i] = scores[bi];
      scores[bi] = ts;
    }
    return moves[i];
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, nullOk: boolean): number {
    this.pvLen[ply] = ply;
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0) this.checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate(pos);
    if (pos.isRepetition()) return 0;

    const us = pos.side;
    const inCheck = pos.inCheck(us);
    if (inCheck && ply < MAX_PLY / 2) depth++;
    if (depth <= 0) return this.qsearch(alpha, beta, ply, 0);

    // 외통 거리 가지치기
    const ma = -MATE + ply;
    if (alpha < ma) alpha = ma;
    const mb = MATE - ply - 1;
    if (beta > mb) beta = mb;
    if (alpha >= beta) return alpha;

    const pvNode = beta - alpha > 1;
    const tt = this.tt;
    const idx = pos.hashLo & tt.mask;
    let ttMove = NO_MOVE;
    if (tt.flags[idx] && tt.keys[idx] === pos.hashHi) {
      ttMove = tt.moves[idx];
      if (!pvNode && tt.depths[idx] >= depth) {
        let s = tt.scores[idx];
        if (s > MATE_BOUND) s -= ply;
        else if (s < -MATE_BOUND) s += ply;
        const f = tt.flags[idx];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }

    const facing = this.bikjang && pos.kingsFacing();
    const staticEval = inCheck ? -INF : evaluate(pos);

    if (!pvNode && !inCheck) {
      // 정적 널무브 (역 퓨틸리티)
      if (depth <= 3 && Math.abs(beta) < MATE_BOUND && staticEval - 110 * depth >= beta) return staticEval;
      // 널무브 = 한수 쉼 (장기에서는 합법수이므로 안전)
      if (nullOk && depth >= 3 && !facing && staticEval >= beta && pos.hasPieces(us)) {
        const R = depth >= 7 ? 3 : 2;
        pos.makeMove(PASS);
        const s = -this.negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        pos.unmakeMove();
        if (this.stopped) return 0;
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    let n = pos.genMoves(moves, false);
    if (!inCheck && nullOk) moves[n++] = PASS;
    this.scoreMoves(moves, scores, n, ttMove, ply);

    const futile = !pvNode && !inCheck && depth <= 2 && staticEval + (depth === 1 ? 160 : 380) <= alpha;
    const b = pos.board;
    const origAlpha = alpha;
    let best = -INF;
    let bestMove = NO_MOVE;
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = this.pick(moves, scores, i, n);
      const isPass = m === PASS;
      const isCap = !isPass && b[m & 127] !== 0;
      pos.makeMove(m);
      if (!isPass && pos.inCheck(us)) {
        pos.unmakeMove();
        continue;
      }
      legal++;
      let score: number;
      this.pvLen[ply + 1] = ply + 1;
      if (facing && pos.kingsFacing()) {
        score = 0; // 빅장을 피하지 않으면 무승부
      } else {
        const givesCheck = pos.inCheck(pos.side);
        if (futile && legal > 1 && !isCap && !givesCheck) {
          pos.unmakeMove();
          continue;
        }
        if (legal === 1) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
        } else {
          let red = 0;
          if (depth >= 3 && legal > 3 && !inCheck && !givesCheck && !isCap && m !== this.killers[ply * 2]) {
            red = legal > 10 ? 2 : 1;
            if (pvNode && red > 1) red = 1;
            if (isPass) red = 1;
          }
          score = -this.negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
          if (red > 0 && score > alpha && !this.stopped) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
          if (score > alpha && score < beta && !this.stopped) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
      }
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          this.updatePv(ply, m);
          if (score >= beta) {
            if (!isCap && !isPass) {
              if (this.killers[ply * 2] !== m) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = m;
              }
              const hi = (m >> 7) * 128 + (m & 127);
              this.hist[hi] += depth * depth;
              if (this.hist[hi] > 1 << 20) for (let j = 0; j < this.hist.length; j++) this.hist[j] >>= 1;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    if (best === -INF) return alpha; // 모두 퓨틸리티로 제외됨

    // 치환표 저장
    if (tt.flags[idx] === 0 || tt.depths[idx] <= depth || tt.keys[idx] !== pos.hashHi) {
      let s = best;
      if (s > MATE_BOUND) s += ply;
      else if (s < -MATE_BOUND) s -= ply;
      tt.keys[idx] = pos.hashHi;
      tt.moves[idx] = bestMove;
      tt.scores[idx] = s;
      tt.depths[idx] = depth;
      tt.flags[idx] = best >= beta ? LOWER : best > origAlpha ? EXACT : UPPER;
    }
    return best;
  }

  private qsearch(alpha: number, beta: number, ply: number, qd: number): number {
    this.pvLen[ply] = ply;
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0) this.checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate(pos);
    const us = pos.side;
    const inCheck = qd < 3 && pos.inCheck(us);
    let best = -INF;
    let stand = 0;
    if (!inCheck) {
      stand = evaluate(pos);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      best = stand;
    }
    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    const n = pos.genMoves(moves, !inCheck);
    this.scoreMoves(moves, scores, n, NO_MOVE, ply);
    const b = pos.board;
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = this.pick(moves, scores, i, n);
      const cap = b[m & 127];
      if (!inCheck) {
        // 델타 가지치기
        if (stand + VALUE[cap & 7] + 200 < alpha && (cap & 7) !== KING) continue;
      }
      pos.makeMove(m);
      if (pos.inCheck(us)) {
        pos.unmakeMove();
        continue;
      }
      legal++;
      this.pvLen[ply + 1] = ply + 1;
      const score = -this.qsearch(-beta, -alpha, ply + 1, qd + 1);
      pos.unmakeMove();
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          this.updatePv(ply, m);
          if (score >= beta) break;
        }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }
}
