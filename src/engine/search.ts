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

// 늦은 수 줄이기(LMR) 표
const LMR = new Int8Array(64 * 64);
for (let d = 1; d < 64; d++) for (let m = 1; m < 64; m++) LMR[d * 64 + m] = Math.floor(0.7 + (Math.log(d) * Math.log(m)) / 2.0);
// 늦은 수 가지치기(LMP) 한도
const LMP = [0, 5, 8, 13, 20, 29];

/** 2칸 버킷 치환표 */
class TransTable {
  mask: number;
  keys: Int32Array;
  moves: Int32Array;
  scores: Int16Array;
  depths: Int8Array;
  flags: Uint8Array;
  ages: Uint8Array;
  age = 0;
  constructor(bits: number) {
    const size = 1 << bits;
    this.mask = size - 1;
    this.keys = new Int32Array(size);
    this.moves = new Int32Array(size);
    this.scores = new Int16Array(size);
    this.depths = new Int8Array(size);
    this.flags = new Uint8Array(size);
    this.ages = new Uint8Array(size);
  }
  clear() {
    this.flags.fill(0);
  }
  /** 같은 키의 칸 위치, 없으면 -1 */
  probe(lo: number, hi: number): number {
    const i = lo & this.mask & ~1;
    if (this.flags[i] && this.keys[i] === hi) return i;
    if (this.flags[i + 1] && this.keys[i + 1] === hi) return i + 1;
    return -1;
  }
  store(lo: number, hi: number, move: number, score: number, depth: number, flag: number) {
    const i0 = lo & this.mask & ~1;
    let i: number;
    if (this.keys[i0] === hi || !this.flags[i0]) i = i0;
    else if (this.keys[i0 + 1] === hi || !this.flags[i0 + 1]) i = i0 + 1;
    else {
      // 오래되었거나 얕은 쪽을 교체
      const v0 = this.depths[i0] - (this.ages[i0] !== this.age ? 16 : 0);
      const v1 = this.depths[i0 + 1] - (this.ages[i0 + 1] !== this.age ? 16 : 0);
      i = v0 <= v1 ? i0 : i0 + 1;
    }
    // 같은 국면의 더 깊은 결과는 얕은 상한/하한으로 덮지 않는다
    if (this.keys[i] === hi && this.flags[i] && this.ages[i] === this.age && this.depths[i] > depth + 2 && flag !== EXACT) return;
    if (move === NO_MOVE && this.keys[i] === hi) move = this.moves[i];
    this.keys[i] = hi;
    this.moves[i] = move;
    this.scores[i] = score;
    this.depths[i] = depth;
    this.flags[i] = flag;
    this.ages[i] = this.age;
  }
}

export interface SearchLimits {
  maxDepth?: number;
  /** 목표 생각 시간(ms). 형세가 불안정하면 maxTimeMs 까지 늘린다 */
  timeMs?: number;
  /** 절대 넘지 않는 생각 시간(ms). 기본값 = timeMs */
  maxTimeMs?: number;
  maxNodes?: number;
  /** 빅장 규칙 사용 */
  bikjang?: boolean;
  /** 루트에서 제외할 수 (다중 후보 분석용) */
  excludeRoot?: number[];
  /** 루트에서 한수 쉼 고려 */
  allowPass?: boolean;
  /** 무승부를 피하려는 정도 (졸=100). 탐색하는 쪽 기준으로 무승부를 이만큼 나쁘게 본다 */
  contempt?: number;
  /** 선읽기 조각: 치환표 세대·히스토리를 유지한다 */
  ponder?: boolean;
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
  private quietBuf: Int32Array[] = [];
  private killers = new Int32Array(MAX_PLY * 2);
  private hist = new Int32Array(NSQ * 128);
  private counter = new Int32Array(1 << 14);
  private evalStack = new Int32Array(MAX_PLY + 2);
  private pvTable = new Int32Array(MAX_PLY * MAX_PLY);
  private pvLen = new Int32Array(MAX_PLY + 1);
  nodes = 0;
  private stopAt = 0;
  private maxNodes = Infinity;
  private stopped = false;
  private canStop = false;
  private bikjang = true;
  private contempt = 0;
  private rootSide = 0;
  private rootBest = NO_MOVE;

  constructor(ttBits = 20) {
    this.tt = new TransTable(ttBits);
    for (let i = 0; i < MAX_PLY + 2; i++) {
      this.moveBuf.push(new Int32Array(MAX_MOVES));
      this.scoreBuf.push(new Int32Array(MAX_MOVES));
      this.quietBuf.push(new Int32Array(MAX_MOVES));
    }
  }

  clear() {
    this.tt.clear();
    this.hist.fill(0);
    this.killers.fill(0);
    this.counter.fill(0);
  }

  private prepare(pos: Position, limits: SearchLimits) {
    this.pos = pos;
    this.nodes = 0;
    this.stopped = false;
    this.canStop = false;
    this.bikjang = limits.bikjang ?? true;
    this.contempt = limits.contempt ?? 0;
    this.rootSide = pos.side;
    const hard = limits.maxTimeMs ?? limits.timeMs;
    this.stopAt = now() + (hard ?? 1e9);
    this.maxNodes = limits.maxNodes ?? Infinity;
    this.killers.fill(0);
    if (!limits.ponder) {
      this.tt.age = (this.tt.age + 1) & 255;
      for (let i = 0; i < this.hist.length; i++) this.hist[i] >>= 2;
    }
  }

  /** side 관점의 무승부 점수 (contempt 반영) */
  private drawFor(side: number) {
    return side === this.rootSide ? -this.contempt : this.contempt;
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
    const soft = limits.timeMs;
    const hard = limits.maxTimeMs ?? soft;
    const rootInCheck = pos.inCheck();
    const rootScores = new Map<number, number>();
    let bestMove = moves[0];
    let bestScore = -INF;
    let bestPv: number[] = [bestMove];
    let completed = 0;
    let stable = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      let delta = 30;
      let alpha = -INF;
      let beta = INF;
      if (depth >= 5 && !isMateScore(bestScore)) {
        alpha = bestScore - delta;
        beta = bestScore + delta;
      }
      let score = 0;
      for (;;) {
        score = this.rootSearch(depth, alpha, beta, moves, rootScores, bestMove, rootInCheck);
        if (this.stopped) break;
        if (score <= alpha) {
          beta = (alpha + beta) >> 1;
          alpha = Math.max(-INF, score - delta);
        } else if (score >= beta) {
          beta = Math.min(INF, score + delta);
        } else break;
        delta += delta;
        if (delta > 1000) {
          alpha = -INF;
          beta = INF;
        }
      }
      if (this.stopped) {
        // 이번 반복에서 이미 더 좋은 수를 끝까지 확인했다면 그것을 쓴다
        if (completed > 0 && this.rootBest !== bestMove && (rootScores.get(this.rootBest) ?? -INF) > bestScore + 20 && this.pvLen[0] > 0) {
          bestMove = this.rootBest;
          bestPv = Array.from(this.pvTable.subarray(0, this.pvLen[0]));
        }
        break;
      }
      const prevScore = bestScore;
      const changed = this.rootBest !== bestMove;
      stable = changed ? 0 : stable + 1;
      bestMove = this.rootBest;
      bestScore = score;
      bestPv = Array.from(this.pvTable.subarray(0, this.pvLen[0]));
      if (!bestPv.length || bestPv[0] !== bestMove) bestPv = [bestMove];
      completed = depth;
      this.canStop = true;
      const elapsed = now() - start;
      if (isMateScore(score) && depth >= MATE - Math.abs(score) + 1) break;
      if (this.nodes >= this.maxNodes) break;
      if (moves.length === 1 && depth >= 4) break;
      if (soft !== undefined) {
        // 시간 관리: 최선수가 흔들리거나 점수가 떨어지면 더 생각한다
        let scale = 1;
        if (changed && depth > 6) scale *= 1.6;
        if (depth > 6 && score < prevScore - 35) scale *= 1.5;
        if (stable >= 5 && depth > 10) scale *= 0.75;
        const target = Math.min(soft * scale, hard ?? soft);
        if (elapsed > target * 0.55) break;
      }
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
    const us = pos.side;
    for (const m of moves) {
      let s: number;
      if (m === base.move) s = base.score;
      else {
        pos.makeMove(m);
        if (facing && pos.kingsFacing()) s = this.drawFor(us);
        else s = -this.negamax(depth - 1, -INF, -floor, 1, true, pos.givesCheck(m), m);
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
    inCheck: boolean,
  ): number {
    const pos = this.pos;
    const us = pos.side;
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
      const isCap = m !== PASS && pos.board[m & 127] !== 0;
      pos.makeMove(m);
      this.nodes++;
      let score: number;
      this.pvLen[1] = 1;
      const gives = pos.givesCheck(m);
      if (facing && pos.kingsFacing()) score = this.drawFor(us);
      else if (i === 0) score = -this.negamax(depth - 1, -beta, -alpha, 1, true, gives, m);
      else {
        const r = depth >= 6 && i >= 6 && !isCap && !gives && !inCheck ? 1 : 0;
        score = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, 1, true, gives, m);
        if (r && score > alpha && !this.stopped) score = -this.negamax(depth - 1, -alpha - 1, -alpha, 1, true, gives, m);
        if (score > alpha && score < beta && !this.stopped) score = -this.negamax(depth - 1, -beta, -alpha, 1, true, gives, m);
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

  private scoreMoves(moves: Int32Array, scores: Int32Array, n: number, ply: number, prevMove: number) {
    const b = this.pos.board;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const cm = prevMove ? this.counter[prevMove] : 0;
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (m === PASS) scores[i] = -(1 << 30);
      else {
        const cap = b[m & 127];
        if (cap) scores[i] = (1 << 24) + SEE_VALUE[cap & 7] * 8 - VALUE[b[m >> 7] & 7];
        else if (m === k1) scores[i] = (1 << 23) + 2;
        else if (m === k2) scores[i] = (1 << 23) + 1;
        else if (m === cm) scores[i] = 1 << 23;
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

  private histUpdate(m: number, bonus: number) {
    const i = (m >> 7) * 128 + (m & 127);
    const h = this.hist[i];
    this.hist[i] = h + bonus - ((h * Math.abs(bonus)) >> 14);
  }

  private negamax(
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    nullOk: boolean,
    inCheck: boolean,
    prevMove: number,
  ): number {
    this.pvLen[ply] = ply;
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0) this.checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate(pos);
    const us = pos.side;
    if (pos.isRepetition()) return this.drawFor(us);

    if (inCheck && ply < MAX_PLY / 2) depth++;
    if (depth <= 0) return this.qsearch(alpha, beta, ply, 0, inCheck);

    // 외통 거리 가지치기
    const ma = -MATE + ply;
    if (alpha < ma) alpha = ma;
    const mb = MATE - ply - 1;
    if (beta > mb) beta = mb;
    if (alpha >= beta) return alpha;

    const pvNode = beta - alpha > 1;
    const tt = this.tt;
    const ti = tt.probe(pos.hashLo, pos.hashHi);
    let ttMove = NO_MOVE;
    if (ti >= 0) {
      ttMove = tt.moves[ti];
      if (!pvNode && tt.depths[ti] >= depth) {
        let s = tt.scores[ti];
        if (s > MATE_BOUND) s -= ply;
        else if (s < -MATE_BOUND) s += ply;
        const f = tt.flags[ti];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }

    const facing = this.bikjang && pos.kingsFacing();
    const staticEval = inCheck ? -INF : evaluate(pos);
    this.evalStack[ply] = staticEval;
    const improving = !inCheck && ply >= 2 && staticEval > this.evalStack[ply - 2];

    if (!pvNode && !inCheck && Math.abs(beta) < MATE_BOUND) {
      // 정적 널무브 (역 퓨틸리티)
      if (depth <= 6 && staticEval - (85 * depth - (improving ? 35 : 0)) >= beta) return staticEval;
      // 레이저링
      if (depth <= 2 && staticEval + 260 * depth < alpha) {
        const q = this.qsearch(alpha, beta, ply, 0, false);
        if (q < alpha) return q;
      }
      // 널무브 = 한수 쉼 (장기에서는 합법수이므로 안전)
      if (nullOk && depth >= 3 && !facing && staticEval >= beta && pos.hasPieces(us)) {
        const R = 3 + ((depth / 5) | 0) + Math.min(2, ((staticEval - beta) / 200) | 0);
        pos.makeMove(PASS);
        const s = -this.negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false, false, PASS);
        pos.unmakeMove();
        if (this.stopped) return 0;
        if (s >= beta) return s >= MATE_BOUND ? beta : s;
      }
    }

    // 치환표 수가 없으면 한 수 덜 읽는다 (IIR)
    if (depth >= 4 && ttMove === NO_MOVE) depth--;

    const b = pos.board;
    const origAlpha = alpha;
    let best = -INF;
    let bestMove = NO_MOVE;
    let legal = 0;
    let quiets = 0; // 탐색한 조용한 수 (히스토리 감점용)
    let quietSeen = 0; // 가지치기한 것까지 센 조용한 수 (LMP용)
    const quietList = this.quietBuf[ply];
    const futile = !pvNode && !inCheck && depth <= 4 && staticEval + 110 + 115 * depth <= alpha;
    const lmpLimit = !pvNode && !inCheck && depth <= 5 ? (improving ? LMP[depth] + 3 : LMP[depth]) : 999;

    let moves = this.moveBuf[ply];
    let scores = this.scoreBuf[ply];
    let n = 0;
    let i = 0;
    let stage = ttMove !== NO_MOVE && ttMove !== PASS && pos.isPseudoLegal(ttMove) ? 0 : 1;
    const ttTried = stage === 0;

    for (;;) {
      let m: number;
      if (stage === 0) {
        m = ttMove;
        stage = 1;
      } else {
        if (stage === 1) {
          n = pos.genMoves(moves, false);
          if (!inCheck && nullOk) moves[n++] = PASS;
          this.scoreMoves(moves, scores, n, ply, prevMove);
          stage = 2;
          i = 0;
        }
        if (i >= n) break;
        m = this.pick(moves, scores, i, n);
        i++;
        if (ttTried && m === ttMove) continue;
      }
      const isPass = m === PASS;
      const isCap = !isPass && b[m & 127] !== 0;
      const isKiller = m === this.killers[ply * 2] || m === this.killers[ply * 2 + 1];
      pos.makeMove(m);
      if (!isPass && !pos.leavesKingSafe(m, us, inCheck)) {
        pos.unmakeMove();
        continue;
      }
      legal++;
      let score: number;
      this.pvLen[ply + 1] = ply + 1;
      if (facing && pos.kingsFacing()) {
        score = this.drawFor(us); // 빅장을 피하지 않으면 무승부
      } else {
        const gives = !isPass && pos.givesCheck(m);
        const quiet = !isCap && !gives;
        if (quiet && legal > 1 && best > -MATE_BOUND) {
          if (futile || quietSeen >= lmpLimit) {
            pos.unmakeMove();
            if (!isPass) quietSeen++;
            continue;
          }
        }
        if (legal === 1) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true, gives, m);
        } else {
          let r = 0;
          if (depth >= 3 && quiet && !inCheck) {
            r = LMR[(depth < 63 ? depth : 63) * 64 + (legal < 63 ? legal : 63)];
            if (pvNode) r--;
            if (!improving) r++;
            if (isKiller) r--;
            if (!isPass) {
              const h = this.hist[(m >> 7) * 128 + (m & 127)];
              if (h > 6000) r--;
              else if (h < -3000) r++;
            }
            if (r < 0) r = 0;
            if (r > depth - 2) r = depth - 2;
          }
          if (isPass && r < 1) r = 1;
          score = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true, gives, m);
          if (r > 0 && score > alpha && !this.stopped) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true, gives, m);
          if (score > alpha && score < beta && !this.stopped) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true, gives, m);
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
              if (prevMove) this.counter[prevMove] = m;
              const bonus = Math.min(depth * depth * 8, 1600);
              this.histUpdate(m, bonus);
              for (let q = 0; q < quiets; q++) this.histUpdate(quietList[q], -bonus);
            }
            break;
          }
        }
      }
      if (!isCap && !isPass) {
        quietList[quiets++] = m;
        quietSeen++;
      }
    }
    if (legal === 0) return inCheck ? -MATE + ply : this.drawFor(us);
    if (best === -INF) return alpha;

    let s = best;
    if (s > MATE_BOUND) s += ply;
    else if (s < -MATE_BOUND) s -= ply;
    tt.store(pos.hashLo, pos.hashHi, bestMove, s, depth, best >= beta ? LOWER : best > origAlpha ? EXACT : UPPER);
    return best;
  }

  private qsearch(alpha: number, beta: number, ply: number, qd: number, inCheck: boolean): number {
    this.pvLen[ply] = ply;
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0) this.checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate(pos);
    const us = pos.side;
    let best = -INF;
    let stand = 0;
    if (!inCheck) {
      stand = evaluate(pos);
      if (stand >= beta) return stand;
      if (stand + 900 < alpha) return stand; // 차를 잡아도 모자람
      if (stand > alpha) alpha = stand;
      best = stand;
    }
    const moves = this.moveBuf[ply];
    const scores = this.scoreBuf[ply];
    const n = pos.genMoves(moves, !inCheck);
    this.scoreMoves(moves, scores, n, ply, 0);
    const b = pos.board;
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = this.pick(moves, scores, i, n);
      const cap = b[m & 127];
      const att = b[m >> 7];
      if (!inCheck) {
        // 델타 가지치기
        if ((cap & 7) !== KING && stand + VALUE[cap & 7] + 160 < alpha) continue;
      }
      pos.makeMove(m);
      if (!pos.leavesKingSafe(m, us, inCheck)) {
        pos.unmakeMove();
        continue;
      }
      legal++;
      // 손해 보는 잡기 생략: 더 비싼 기물로 지켜진 기물을 잡는 경우
      if (!inCheck && VALUE[att & 7] > VALUE[cap & 7] + 40 && pos.isAttacked(m & 127, pos.side)) {
        pos.unmakeMove();
        continue;
      }
      this.pvLen[ply + 1] = ply + 1;
      const gives = qd < 2 && pos.givesCheck(m);
      const score = -this.qsearch(-beta, -alpha, ply + 1, qd + 1, gives);
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
