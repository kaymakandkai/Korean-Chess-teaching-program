// 대국 진행 모델: 수 기록, 무르기, 승패 판정 (UI 스레드에서 사용)
import { CHO, DEOM, HAN, PASS, Side, otherSide } from './constants';
import { moveLabel, moveNotation } from './notation';
import { Position } from './position';
import { materialPoints } from './coach';

export interface GameRules {
  /** 빅장 규칙: 궁이 마주본 상태를 상대가 피하지 않으면 무승부 */
  bikjang: boolean;
  /** 이 수만큼 두면 점수로 판정 (0 = 제한 없음) */
  moveLimit: number;
}

export interface MoveRecord {
  move: number;
  side: Side;
  notation: string;
  label: string;
  captured: number;
  check: boolean;
  bikjangCall: boolean;
}

export interface GameResult {
  winner: Side | null;
  reason: string;
  detail?: string;
}

export class Game {
  readonly startFen: string;
  readonly pos: Position;
  readonly rules: GameRules;
  /** 덤을 받는 쪽 (처음에 두 번째로 두는 쪽) */
  readonly deomSide: Side;
  records: MoveRecord[] = [];
  result: GameResult | null = null;
  private legalCache: number[] | null = null;

  constructor(startFen: string, rules: GameRules) {
    this.startFen = startFen;
    this.pos = Position.fromFen(startFen);
    this.rules = rules;
    this.deomSide = otherSide(this.pos.side);
  }

  get side(): Side {
    return this.pos.side;
  }

  moves(): number[] {
    return this.records.map((r) => r.move);
  }

  legalMoves(): number[] {
    if (!this.legalCache) this.legalCache = this.pos.legalMoves();
    return this.legalCache;
  }

  movesFrom(sq: number): number[] {
    return this.legalMoves().filter((m) => m >> 7 === sq);
  }

  canPass(): boolean {
    return !this.result && !this.pos.inCheck();
  }

  isLegal(m: number): boolean {
    if (m === PASS) return this.canPass();
    return this.legalMoves().includes(m);
  }

  play(m: number): MoveRecord {
    if (this.result) throw new Error('이미 끝난 대국입니다');
    if (!this.isLegal(m)) throw new Error('둘 수 없는 수입니다');
    const pos = this.pos;
    const facingBefore = pos.kingsFacing();
    const rec: MoveRecord = {
      move: m,
      side: pos.side,
      notation: moveNotation(pos.board, m),
      label: moveLabel(pos.board, m),
      captured: m === PASS ? 0 : pos.board[m & 127],
      check: false,
      bikjangCall: false,
    };
    pos.makeMove(m);
    this.legalCache = null;
    rec.check = pos.inCheck();
    rec.bikjangCall = this.rules.bikjang && !facingBefore && pos.kingsFacing();
    this.records.push(rec);
    this.result = this.evaluateEnd(facingBefore);
    return rec;
  }

  undo(n = 1) {
    for (let i = 0; i < n && this.records.length; i++) {
      this.records.pop();
      this.pos.unmakeMove();
    }
    this.legalCache = null;
    this.result = null;
  }

  resign(side: Side) {
    this.result = { winner: otherSide(side), reason: '기권', detail: `${side === CHO ? '초' : '한'}이(가) 기권했습니다.` };
  }

  points(side: Side): number {
    return materialPoints(this.pos, side) + (side === this.deomSide ? DEOM : 0);
  }

  private evaluateEnd(facingBefore: boolean): GameResult | null {
    const pos = this.pos;
    const toMove = pos.side;
    const legal = this.legalMoves();
    if (legal.length === 0 && pos.inCheck()) {
      return { winner: otherSide(toMove), reason: '외통', detail: `${toMove === CHO ? '초' : '한'}의 궁이 피할 곳이 없습니다.` };
    }
    if (this.rules.bikjang && facingBefore && pos.kingsFacing()) {
      return { winner: null, reason: '빅장', detail: '빅장을 피하지 않아 무승부가 되었습니다.' };
    }
    if (pos.repetitionCount() >= 2) {
      return { winner: null, reason: '동형 반복', detail: '같은 국면이 세 번 반복되어 무승부입니다.' };
    }
    const n = this.records.length;
    if (n >= 2 && this.records[n - 1].move === PASS && this.records[n - 2].move === PASS) {
      return this.pointsDecision('양쪽이 연속으로 한수 쉼을 했습니다.');
    }
    if (this.rules.moveLimit > 0 && n >= this.rules.moveLimit) {
      return this.pointsDecision(`${this.rules.moveLimit}수에 도달했습니다.`);
    }
    return null;
  }

  private pointsDecision(why: string): GameResult {
    const c = this.points(CHO);
    const h = this.points(HAN);
    const detail = `${why} 점수 판정 — 초 ${c}점, 한 ${h}점`;
    if (c === h) return { winner: null, reason: '점수 판정', detail };
    return { winner: c > h ? CHO : HAN, reason: '점수 판정', detail };
  }
}
