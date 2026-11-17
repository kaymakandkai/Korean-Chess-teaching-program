// 장기 국면: 보드, 수 생성, 공격 판정, 수 두기/무르기
import {
  CANNON,
  CHARIOT,
  CHO,
  COLS,
  ELEPHANT,
  GUARD,
  HAN,
  HORSE,
  KING,
  NSQ,
  PASS,
  ROWS,
  SOLDIER,
  Side,
} from './constants';
import { PSQ } from './pst';
import {
  DIAG_RAYS,
  ELEPHANT_ATTACKERS,
  ELEPHANT_MOVES,
  HORSE_ATTACKERS,
  HORSE_MOVES,
  KING_GIVES,
  KING_REL,
  ORTHO_RAYS,
  PALACE,
  PALACE_MOVES,
  SOLDIER_ATTACKERS,
  SOLDIER_MOVES,
} from './tables';
import { Z_HI, Z_LO, Z_SIDE_HI, Z_SIDE_LO } from './zobrist';

const MAX_STACK = 2048;

const FEN_CHARS = ' KAEHRCP';

type MoveBuf = Int32Array | number[];

export class Position {
  board = new Int8Array(NSQ);
  side: Side = CHO;
  kingSq = new Int32Array([-1, -1]);
  hashLo = 0;
  hashHi = 0;
  /** 진영별 기물가치+위치점수 합 */
  psq = new Int32Array(2);
  /** 기물 코드별 개수 */
  counts = new Int8Array(16);
  /** 진영별 기물 위치 목록 (순서는 의미 없음) */
  plist = [new Int8Array(16), new Int8Array(16)];
  pcnt = new Int8Array(2);
  private pidx = new Int8Array(NSQ);

  // 무르기용 스택
  sp = 0;
  private stMove = new Int32Array(MAX_STACK);
  private stCap = new Int8Array(MAX_STACK);
  private stHashLo = new Int32Array(MAX_STACK);
  private stHashHi = new Int32Array(MAX_STACK);
  /** 마지막으로 기물을 잡은 시점 (그 이전 국면은 반복될 수 없음) */
  private stRevStart = new Int32Array(MAX_STACK);
  private revStart = 0;

  static fromFen(fen: string): Position {
    const p = new Position();
    p.setFen(fen);
    return p;
  }

  setFen(fen: string) {
    this.board.fill(0);
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== ROWS) throw new Error('잘못된 국면 문자열: 줄 수가 10이 아닙니다');
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (ch >= '1' && ch <= '9') {
          c += ch.charCodeAt(0) - 48;
          continue;
        }
        const upper = ch.toUpperCase();
        const type = FEN_CHARS.indexOf(upper);
        if (type <= 0) throw new Error(`잘못된 기물 문자: ${ch}`);
        const side = ch === upper ? CHO : HAN;
        if (c >= COLS) throw new Error('잘못된 국면 문자열: 칸 수 초과');
        this.board[r * COLS + c] = type | (side << 3);
        c++;
      }
      if (c !== COLS) throw new Error(`잘못된 국면 문자열: ${r + 1}번째 줄의 칸 수가 9가 아닙니다`);
    }
    const s = (parts[1] || 'w').toLowerCase();
    this.side = s === 'b' || s === 'h' ? HAN : CHO;
    this.sp = 0;
    this.revStart = 0;
    this.recompute();
  }

  toFen(): string {
    const rows: string[] = [];
    for (let r = 0; r < ROWS; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < COLS; c++) {
        const p = this.board[r * COLS + c];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        const ch = FEN_CHARS[p & 7];
        row += p >> 3 === CHO ? ch : ch.toLowerCase();
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/') + ' ' + (this.side === CHO ? 'w' : 'b');
  }

  clone(): Position {
    return Position.fromFen(this.toFen());
  }

  /** 보드로부터 해시·점수·개수·기물 목록을 다시 계산 (보드를 직접 고친 뒤 호출) */
  recompute() {
    this.hashLo = 0;
    this.hashHi = 0;
    this.psq[0] = this.psq[1] = 0;
    this.counts.fill(0);
    this.kingSq[0] = this.kingSq[1] = -1;
    this.pcnt[0] = this.pcnt[1] = 0;
    for (let s = 0; s < NSQ; s++) {
      const p = this.board[s];
      if (!p) continue;
      const side = p >> 3;
      this.hashLo ^= Z_LO[p * NSQ + s];
      this.hashHi ^= Z_HI[p * NSQ + s];
      this.psq[side] += PSQ[p][s];
      this.counts[p]++;
      if ((p & 7) === KING) this.kingSq[side] = s;
      if (this.pcnt[side] < 16) {
        this.pidx[s] = this.pcnt[side];
        this.plist[side][this.pcnt[side]++] = s;
      }
    }
    if (this.side === HAN) {
      this.hashLo ^= Z_SIDE_LO;
      this.hashHi ^= Z_SIDE_HI;
    }
  }

  /** 수 두기 (합법성 검사 안 함) */
  makeMove(m: number) {
    const sp = this.sp;
    this.stMove[sp] = m;
    this.stHashLo[sp] = this.hashLo;
    this.stHashHi[sp] = this.hashHi;
    this.stRevStart[sp] = this.revStart;
    if (m === PASS) {
      this.stCap[sp] = 0;
    } else {
      const from = m >> 7;
      const to = m & 127;
      const b = this.board;
      const p = b[from];
      const cap = b[to];
      const us = p >> 3;
      this.stCap[sp] = cap;
      if (cap) {
        const them = cap >> 3;
        const vi = this.pidx[to];
        const last = this.plist[them][--this.pcnt[them]];
        this.plist[them][vi] = last;
        this.pidx[last] = vi;
        this.hashLo ^= Z_LO[cap * NSQ + to];
        this.hashHi ^= Z_HI[cap * NSQ + to];
        this.psq[them] -= PSQ[cap][to];
        this.counts[cap]--;
        if ((cap & 7) === KING) this.kingSq[them] = -1;
        this.revStart = sp + 1;
      }
      const pi = this.pidx[from];
      this.plist[us][pi] = to;
      this.pidx[to] = pi;
      b[to] = p;
      b[from] = 0;
      this.hashLo ^= Z_LO[p * NSQ + from] ^ Z_LO[p * NSQ + to];
      this.hashHi ^= Z_HI[p * NSQ + from] ^ Z_HI[p * NSQ + to];
      this.psq[us] += PSQ[p][to] - PSQ[p][from];
      if ((p & 7) === KING) this.kingSq[us] = to;
    }
    this.side = (this.side ^ 1) as Side;
    this.hashLo ^= Z_SIDE_LO;
    this.hashHi ^= Z_SIDE_HI;
    this.sp = sp + 1;
  }

  unmakeMove() {
    const sp = --this.sp;
    const m = this.stMove[sp];
    this.side = (this.side ^ 1) as Side;
    this.hashLo = this.stHashLo[sp];
    this.hashHi = this.stHashHi[sp];
    this.revStart = this.stRevStart[sp];
    if (m === PASS) return;
    const from = m >> 7;
    const to = m & 127;
    const b = this.board;
    const p = b[to];
    const cap = this.stCap[sp];
    const us = p >> 3;
    const pi = this.pidx[to];
    this.plist[us][pi] = from;
    this.pidx[from] = pi;
    b[from] = p;
    b[to] = cap;
    this.psq[us] -= PSQ[p][to] - PSQ[p][from];
    if ((p & 7) === KING) this.kingSq[us] = from;
    if (cap) {
      const them = cap >> 3;
      this.pidx[to] = this.pcnt[them];
      this.plist[them][this.pcnt[them]++] = to;
      this.psq[them] += PSQ[cap][to];
      this.counts[cap]++;
      if ((cap & 7) === KING) this.kingSq[them] = to;
    }
  }

  lastMove(): number {
    return this.sp > 0 ? this.stMove[this.sp - 1] : 0;
  }
  lastCaptured(): number {
    return this.sp > 0 ? this.stCap[this.sp - 1] : 0;
  }
  moveAt(i: number): number {
    return this.stMove[i];
  }

  /** 현재 국면이 앞서 나온 적이 있는지 (같은 차례 기준) */
  isRepetition(): boolean {
    const lo = this.hashLo;
    const hi = this.hashHi;
    for (let i = this.sp - 2; i >= this.revStart; i -= 2) {
      if (this.stHashLo[i] === lo && this.stHashHi[i] === hi) return true;
    }
    return false;
  }

  /** 현재 국면이 이전에 몇 번 나왔는지 */
  repetitionCount(): number {
    let n = 0;
    const lo = this.hashLo;
    const hi = this.hashHi;
    for (let i = this.sp - 2; i >= this.revStart; i -= 2) {
      if (this.stHashLo[i] === lo && this.stHashHi[i] === hi) n++;
    }
    return n;
  }

  /**
   * 의사 합법수 생성 (자기 궁이 공격받는지는 확인하지 않음).
   * @returns 생성된 수의 개수
   */
  genMoves(out: MoveBuf, capsOnly: boolean): number {
    const us = this.side;
    const list = this.plist[us];
    const cnt = this.pcnt[us];
    let n = 0;
    for (let i = 0; i < cnt; i++) n = this.genFrom(list[i], out, n, capsOnly);
    return n;
  }

  /** 한 기물의 의사 합법수 */
  genFrom(s: number, out: MoveBuf, n: number, capsOnly: boolean): number {
    const b = this.board;
    const p = b[s];
    const us = p >> 3;
    const base = s << 7;
    switch (p & 7) {
      case KING:
      case GUARD: {
        const mv = PALACE_MOVES[s];
        for (let i = 0; i < mv.length; i++) {
          const to = mv[i];
          const q = b[to];
          if (q === 0) {
            if (!capsOnly) out[n++] = base | to;
          } else if (q >> 3 !== us) out[n++] = base | to;
        }
        break;
      }
      case HORSE: {
        const mv = HORSE_MOVES[s];
        for (let i = 0; i < mv.length; i += 2) {
          if (b[mv[i + 1]] !== 0) continue;
          const to = mv[i];
          const q = b[to];
          if (q === 0) {
            if (!capsOnly) out[n++] = base | to;
          } else if (q >> 3 !== us) out[n++] = base | to;
        }
        break;
      }
      case ELEPHANT: {
        const mv = ELEPHANT_MOVES[s];
        for (let i = 0; i < mv.length; i += 3) {
          if (b[mv[i + 1]] !== 0 || b[mv[i + 2]] !== 0) continue;
          const to = mv[i];
          const q = b[to];
          if (q === 0) {
            if (!capsOnly) out[n++] = base | to;
          } else if (q >> 3 !== us) out[n++] = base | to;
        }
        break;
      }
      case CHARIOT:
        n = this.slide(ORTHO_RAYS[s], base, us, out, n, capsOnly);
        n = this.slide(DIAG_RAYS[s], base, us, out, n, capsOnly);
        break;
      case CANNON:
        n = this.jump(ORTHO_RAYS[s], base, us, out, n, capsOnly);
        n = this.jump(DIAG_RAYS[s], base, us, out, n, capsOnly);
        break;
      case SOLDIER: {
        const mv = SOLDIER_MOVES[us][s];
        for (let i = 0; i < mv.length; i++) {
          const to = mv[i];
          const q = b[to];
          if (q === 0) {
            if (!capsOnly) out[n++] = base | to;
          } else if (q >> 3 !== us) out[n++] = base | to;
        }
        break;
      }
    }
    return n;
  }

  private slide(rays: number[][], base: number, us: number, out: MoveBuf, n: number, capsOnly: boolean) {
    const b = this.board;
    for (let d = 0; d < rays.length; d++) {
      const ray = rays[d];
      for (let i = 0; i < ray.length; i++) {
        const to = ray[i];
        const q = b[to];
        if (q === 0) {
          if (!capsOnly) out[n++] = base | to;
        } else {
          if (q >> 3 !== us) out[n++] = base | to;
          break;
        }
      }
    }
    return n;
  }

  private jump(rays: number[][], base: number, us: number, out: MoveBuf, n: number, capsOnly: boolean) {
    const b = this.board;
    for (let d = 0; d < rays.length; d++) {
      const ray = rays[d];
      const len = ray.length;
      let i = 0;
      while (i < len && b[ray[i]] === 0) i++;
      if (i >= len) continue;
      // 포는 포를 넘을 수 없다
      if ((b[ray[i]] & 7) === CANNON) continue;
      for (i++; i < len; i++) {
        const to = ray[i];
        const q = b[to];
        if (q === 0) {
          if (!capsOnly) out[n++] = base | to;
        } else {
          // 포는 포를 잡을 수 없다
          if (q >> 3 !== us && (q & 7) !== CANNON) out[n++] = base | to;
          break;
        }
      }
    }
    return n;
  }

  private pseudoBuf: number[] = [];
  /** m 이 현재 차례에서 의사 합법수인지 (치환표 수 검증용) */
  isPseudoLegal(m: number): boolean {
    if (m === PASS || m <= 0) return false;
    const from = m >> 7;
    if (from >= NSQ) return false;
    const p = this.board[from];
    if (!p || p >> 3 !== this.side) return false;
    const buf = this.pseudoBuf;
    const n = this.genFrom(from, buf, 0, false);
    for (let i = 0; i < n; i++) if (buf[i] === m) return true;
    return false;
  }

  /**
   * 방금 둔 수(mover 쪽)가 자기 궁을 위험하게 하지 않았는지.
   * 궁과 무관한 칸의 수는 공격 판정을 생략한다. (makeMove 직후, wasInCheck = 두기 전 장군 여부)
   */
  leavesKingSafe(m: number, mover: number, wasInCheck: boolean): boolean {
    const k = this.kingSq[mover];
    if (k < 0) return true;
    if (!wasInCheck && m !== PASS && k !== (m & 127)) {
      const rel = KING_REL[k];
      if (!rel[m >> 7] && !rel[m & 127]) return true;
    }
    return !this.isAttacked(k, mover ^ 1);
  }

  /** 방금 둔 수가 상대 궁에게 장군인지 (makeMove 직후 호출) */
  givesCheck(m: number): boolean {
    const them = this.side;
    const k = this.kingSq[them];
    if (k < 0 || m === PASS) return false;
    const gv = KING_GIVES[k];
    if (!gv[m >> 7] && !gv[m & 127]) return false;
    return this.isAttacked(k, them ^ 1);
  }

  /** by 진영이 t 칸을 공격하고 있는지 */
  isAttacked(t: number, by: number): boolean {
    const b = this.board;
    const hi = by << 3;
    const R = hi | CHARIOT;
    const C = hi | CANNON;
    const targetIsCannon = (b[t] & 7) === CANNON;
    const rays = ORTHO_RAYS[t];
    for (let d = 0; d < rays.length; d++) if (this.rayAttack(rays[d], R, C, targetIsCannon)) return true;
    const drays = DIAG_RAYS[t];
    for (let d = 0; d < drays.length; d++) if (this.rayAttack(drays[d], R, C, targetIsCannon)) return true;
    const H = hi | HORSE;
    const ha = HORSE_ATTACKERS[t];
    for (let i = 0; i < ha.length; i += 2) if (b[ha[i]] === H && b[ha[i + 1]] === 0) return true;
    const E = hi | ELEPHANT;
    const ea = ELEPHANT_ATTACKERS[t];
    for (let i = 0; i < ea.length; i += 3) if (b[ea[i]] === E && b[ea[i + 1]] === 0 && b[ea[i + 2]] === 0) return true;
    const P = hi | SOLDIER;
    const sa = SOLDIER_ATTACKERS[by][t];
    for (let i = 0; i < sa.length; i++) if (b[sa[i]] === P) return true;
    if (PALACE[t] >= 0) {
      const K = hi | KING;
      const A = hi | GUARD;
      const pm = PALACE_MOVES[t];
      for (let i = 0; i < pm.length; i++) {
        const q = b[pm[i]];
        if (q === K || q === A) return true;
      }
    }
    return false;
  }

  private rayAttack(ray: number[], R: number, C: number, targetIsCannon: boolean): boolean {
    const b = this.board;
    const len = ray.length;
    let i = 0;
    while (i < len && b[ray[i]] === 0) i++;
    if (i >= len) return false;
    const p = b[ray[i]];
    if (p === R) return true;
    if ((p & 7) === CANNON || targetIsCannon) return false;
    for (i++; i < len; i++) {
      const q = b[ray[i]];
      if (q !== 0) return q === C;
    }
    return false;
  }

  inCheck(side: number = this.side): boolean {
    const k = this.kingSq[side];
    if (k < 0) return false;
    return this.isAttacked(k, side ^ 1);
  }

  /** 두 궁이 같은 세로줄에서 사이에 아무것도 없이 마주보는지 (빅장) */
  kingsFacing(): boolean {
    const k0 = this.kingSq[0];
    const k1 = this.kingSq[1];
    if (k0 < 0 || k1 < 0) return false;
    if (k0 % COLS !== k1 % COLS) return false;
    const lo = k0 < k1 ? k0 : k1;
    const hi = k0 < k1 ? k1 : k0;
    for (let s = lo + COLS; s < hi; s += COLS) if (this.board[s] !== 0) return false;
    return true;
  }

  /** 합법수 목록 (한수 쉼 제외) */
  legalMoves(): number[] {
    const buf: number[] = [];
    const n = this.genMoves(buf, false);
    const res: number[] = [];
    const us = this.side;
    const chk = this.inCheck(us);
    for (let i = 0; i < n; i++) {
      this.makeMove(buf[i]);
      if (this.leavesKingSafe(buf[i], us, chk)) res.push(buf[i]);
      this.unmakeMove();
    }
    return res;
  }

  /** 잡는 합법수 */
  legalCaptures(): number[] {
    const buf: number[] = [];
    const n = this.genMoves(buf, true);
    const res: number[] = [];
    const us = this.side;
    const chk = this.inCheck(us);
    for (let i = 0; i < n; i++) {
      this.makeMove(buf[i]);
      if (this.leavesKingSafe(buf[i], us, chk)) res.push(buf[i]);
      this.unmakeMove();
    }
    return res;
  }

  isLegal(m: number): boolean {
    if (m === PASS) return !this.inCheck();
    if (!this.isPseudoLegal(m)) return false;
    const us = this.side;
    const chk = this.inCheck(us);
    this.makeMove(m);
    const ok = this.leavesKingSafe(m, us, chk);
    this.unmakeMove();
    return ok;
  }

  /** 차·포·마·상 등 졸·사가 아닌 기물을 가지고 있는지 */
  hasPieces(side: number): boolean {
    const hi = side << 3;
    return (
      this.counts[hi | CHARIOT] + this.counts[hi | CANNON] + this.counts[hi | HORSE] + this.counts[hi | ELEPHANT] > 0
    );
  }
}
