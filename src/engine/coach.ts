// 교습(코치) 모듈: 매 수마다 형세·추천수·위험·몇 수 뒤의 위험을 한국어로 설명한다
import {
  CANNON,
  CHARIOT,
  CHO,
  ELEPHANT,
  GUARD,
  HAN,
  HORSE,
  KING,

  NSQ,
  PASS,
  POINTS,
  SOLDIER,
  Side,
  colOf,
  rowOf,
} from './constants';
import { evaluate } from './eval';
import { josa, moveLabel, moveNotation, pieceAt, pieceName, sqName, cpToPoints } from './notation';
import { Position } from './position';
import { SEE_VALUE } from './pst';
import { Searcher, SearchResult, isMateScore, mateIn } from './search';
import { Hanging, checkers, seeMove, winnablePieces } from './tactics';
import { HORSE_MOVES, ORTHO_RAYS, PALACE } from './tables';

export type Quality = 'best' | 'good' | 'ok' | 'inaccuracy' | 'mistake' | 'blunder';
export const QUALITY_TEXT: Record<Quality, string> = {
  best: '최선수',
  good: '좋은 수',
  ok: '무난한 수',
  inaccuracy: '아쉬운 수',
  mistake: '실수',
  blunder: '큰 실수',
};

export interface Danger {
  level: 'high' | 'mid' | 'low';
  text: string;
  squares: number[];
}
export interface Recommendation {
  move: number;
  label: string;
  notation: string;
  score: number;
  scoreText: string;
  reasons: string[];
  line: string;
}
export interface Arrow {
  from: number;
  to: number;
  kind: 'best' | 'alt' | 'threat';
}
export interface Mark {
  sq: number;
  kind: 'danger' | 'target';
}

export interface Advice {
  side: Side;
  moveNumber: number;
  phase: '초반' | '중반' | '종반';
  evalCp: number;
  evalText: string;
  situation: string[];
  opponentMove?: { label: string; notes: string[] };
  dangers: Danger[];
  recommendations: Recommendation[];
  future: string[];
  tips: string[];
  arrows: Arrow[];
  marks: Mark[];
  depth: number;
  nodes: number;
  bestMove: number;
  bestScore: number;
  top: { move: number; score: number; reasons: string[]; label: string }[];
}

export interface Review {
  move: number;
  label: string;
  quality: Quality;
  qualityText: string;
  loss: number;
  lossPoints: number;
  comments: string[];
  better?: { label: string; reasons: string[] };
  refutation?: string;
}

export interface CoachOptions {
  bikjang: boolean;
  timeMs: number;
  /** 덤을 받는 쪽 (후수) */
  deomSide: Side;
}

// ------------------------------------------------------------------
// 기본 정보
// ------------------------------------------------------------------

export function materialPoints(pos: Position, side: Side): number {
  let sum = 0;
  for (let t = 2; t <= 7; t++) sum += POINTS[t] * pos.counts[(side << 3) | t];
  return sum;
}

export function phaseOf(pos: Position): '초반' | '중반' | '종반' {
  let major = 0;
  for (const side of [CHO, HAN]) for (const t of [ELEPHANT, HORSE, CHARIOT, CANNON]) major += pos.counts[(side << 3) | t];
  if (major <= 6) return '종반';
  // 마·상이 아직 자기 끝줄에 많이 남아 있으면 초반
  let home = 0;
  for (let c = 0; c < 9; c++) {
    for (const [row, side] of [
      [9, CHO],
      [0, HAN],
    ] as const) {
      const p = pos.board[row * 9 + c];
      if (p && p >> 3 === side && ((p & 7) === HORSE || (p & 7) === ELEPHANT)) home++;
    }
  }
  if (major >= 13 && home >= 4) return '초반';
  return '중반';
}

const who = (mine: boolean) => (mine ? '내가' : '상대가');

export function evalSentence(cp: number): string {
  if (isMateScore(cp)) {
    const n = Math.abs(mateIn(cp));
    return cp > 0 ? `${n}수 안에 외통으로 이길 수 있는 국면입니다!` : `상대에게 ${n}수 외통 수순이 있는 매우 위험한 국면입니다.`;
  }
  const a = Math.abs(cp);
  const pts = cpToPoints(a).toFixed(1);
  if (a < 40) return `형세는 팽팽합니다 (거의 균형).`;
  const w = who(cp > 0);
  if (a < 150) return `${w} 조금 유리합니다 (약 ${pts}점).`;
  if (a < 400) return `${w} 유리합니다 (약 ${pts}점).`;
  if (a < 900) return `${w} 크게 유리합니다 (약 ${pts}점).`;
  return `${w} 승리에 가까운 우세입니다 (약 ${pts}점).`;
}

export function scoreText(cp: number): string {
  if (isMateScore(cp)) {
    const n = mateIn(cp);
    return n > 0 ? `${n}수 외통` : `${-n}수 뒤 외통당함`;
  }
  const p = cpToPoints(cp);
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}`;
}

/** PV를 사람이 읽을 수 있는 문자열로 */
export function lineText(pos: Position, pv: number[], max = 6): string {
  const parts: string[] = [];
  let made = 0;
  for (let i = 0; i < pv.length && i < max; i++) {
    const m = pv[i];
    if (m !== PASS && !pos.isLegal(m)) break;
    const side = pos.side === CHO ? '초' : '한';
    parts.push(`[${side}] ${moveLabel(pos.board, m)}`);
    pos.makeMove(m);
    made++;
  }
  for (let i = 0; i < made; i++) pos.unmakeMove();
  return parts.join(' → ');
}

// ------------------------------------------------------------------
// 수의 의미 분석
// ------------------------------------------------------------------

interface MoveFacts {
  pass: boolean;
  piece: number;
  from: number;
  to: number;
  mateN?: number;
  capture?: { victim: number; sq: number; gain: number };
  check?: { replies: number };
  escaped: Hanging[];
  protectedPieces: Hanging[];
  leftHanging: Hanging[];
  movedHangs?: Hanging;
  newTargets: Hanging[];
  palacePressure: boolean;
  develop?: number;
  centerCannon: boolean;
  soldierAdvance: boolean;
  soldierConnect: boolean;
  kingMove: boolean;
  guardMove: boolean;
  blocksMate: boolean;
  blocksThreat: boolean;
  createsBikjang: boolean;
  /** 장군을 어떻게 받았는지 */
  escapeCheck?: 'king' | 'capture' | 'block' | 'screen';
}

function isBetween(a: number, b: number, x: number): boolean {
  const ra = rowOf(a);
  const ca = colOf(a);
  const rb = rowOf(b);
  const cb = colOf(b);
  const rx = rowOf(x);
  const cx = colOf(x);
  if (ra === rb && rx === ra) return cx > Math.min(ca, cb) && cx < Math.max(ca, cb);
  if (ca === cb && cx === ca) return rx > Math.min(ra, rb) && rx < Math.max(ra, rb);
  return false;
}

function palaceAttackCount(pos: Position, attacker: Side): number {
  const enemy = attacker ^ 1;
  let n = 0;
  for (let s = 0; s < NSQ; s++) if (PALACE[s] === enemy && pos.isAttacked(s, attacker)) n++;
  return n;
}

function backRow(side: Side) {
  return side === CHO ? 9 : 0;
}

function analyzeMoveFacts(
  pos: Position,
  m: number,
  opts: CoachOptions,
  searchScore: number | undefined,
  threat: OppThreat | null,
  searcher: Searcher | null,
): MoveFacts {
  const us = pos.side;
  const them = (us ^ 1) as Side;
  const facts: MoveFacts = {
    pass: m === PASS,
    piece: 0,
    from: -1,
    to: -1,
    escaped: [],
    protectedPieces: [],
    leftHanging: [],
    newTargets: [],
    palacePressure: false,
    centerCannon: false,
    soldierAdvance: false,
    soldierConnect: false,
    kingMove: false,
    guardMove: false,
    blocksMate: false,
    blocksThreat: false,
    createsBikjang: false,
  };
  if (searchScore !== undefined && isMateScore(searchScore) && searchScore > 0) facts.mateN = mateIn(searchScore);

  const checkersBefore = pos.inCheck(us) ? checkers(pos, us) : [];
  const myBefore = winnablePieces(pos, us);
  const targetsBefore = winnablePieces(pos, them);
  const palBefore = palaceAttackCount(pos, us);

  if (m !== PASS) {
    const from = m >> 7;
    const to = m & 127;
    facts.from = from;
    facts.to = to;
    facts.piece = pos.board[from];
    const victim = pos.board[to];
    if (victim) facts.capture = { victim, sq: to, gain: seeMove(pos, m) };
    const t = facts.piece & 7;
    if (t === KING) facts.kingMove = true;
    if (t === GUARD) facts.guardMove = true;
    if ((t === HORSE || t === ELEPHANT) && rowOf(from) === backRow(us)) facts.develop = t;
    if (t === CHARIOT && rowOf(from) === backRow(us) && (colOf(from) === 0 || colOf(from) === 8)) facts.develop = t;
    if (t === CANNON && colOf(to) === 4 && colOf(from) !== 4) facts.centerCannon = true;
    if (t === SOLDIER) {
      if (colOf(from) === colOf(to)) facts.soldierAdvance = true;
      const b = pos.board;
      const sideBy = (s: number) => colOf(s) > 0 && b[s - 1] === facts.piece;
      const sideBy2 = (s: number) => colOf(s) < 8 && b[s + 1] === facts.piece;
      const beforeConn = sideBy(from) || sideBy2(from);
      pos.makeMove(m);
      const afterConn = sideBy(to) || sideBy2(to);
      pos.unmakeMove();
      if (afterConn && !beforeConn) facts.soldierConnect = true;
    }
  }

  if (checkersBefore.length && m !== PASS) {
    const k = pos.kingSq[us];
    if ((facts.piece & 7) === KING) facts.escapeCheck = 'king';
    else if (checkersBefore.includes(facts.to)) facts.escapeCheck = 'capture';
    else if (checkersBefore.some((c) => (pos.board[c] & 7) === CANNON && isBetween(c, k, facts.from))) facts.escapeCheck = 'screen';
    else facts.escapeCheck = 'block';
  }
  pos.makeMove(m);
  if (pos.inCheck(them)) facts.check = { replies: pos.legalMoves().length };
  if (opts.bikjang && pos.kingsFacing()) facts.createsBikjang = true;
  const myAfter = winnablePieces(pos, us);
  const targetsAfter = winnablePieces(pos, them);
  const palAfter = palaceAttackCount(pos, us);
  if (palAfter >= palBefore + 2 && palAfter >= 3) facts.palacePressure = true;

  // 위협 차단 여부
  if (threat && searcher) {
    if (threat.kind === 'mate') {
      const r = searcher.search(pos, { maxDepth: Math.min(2 * (threat.mateN ?? 2), 8), timeMs: 250, bikjang: opts.bikjang });
      if (!(isMateScore(r.score) && r.score > 0)) facts.blocksMate = true;
    }
  }
  pos.unmakeMove();

  const afterSet = new Map(myAfter.map((h) => [h.sq, h]));
  for (const h of myBefore) {
    if (h.sq === facts.from) {
      if (!afterSet.has(facts.to)) facts.escaped.push(h);
    } else if (!afterSet.has(h.sq)) facts.protectedPieces.push(h);
    else facts.leftHanging.push(afterSet.get(h.sq)!);
  }
  if (facts.to >= 0 && afterSet.has(facts.to)) facts.movedHangs = afterSet.get(facts.to);
  const beforeTargets = new Set(targetsBefore.map((h) => h.sq));
  for (const h of targetsAfter) {
    if (!beforeTargets.has(h.sq) && h.sq !== facts.to) facts.newTargets.push(h);
  }
  if (threat && threat.kind === 'material' && threat.targetSq !== undefined) {
    const tsq = threat.targetSq;
    const stillThreatened = tsq === facts.from ? afterSet.has(facts.to) : afterSet.has(tsq);
    if (!stillThreatened) facts.blocksThreat = true;
  }
  return facts;
}

function pName(p: number) {
  return pieceName(p);
}

/** 자기 입장에서 수의 이유를 설명 */
function factsToReasons(pos: Position, f: MoveFacts, threat: OppThreat | null, mode: 'recommend' | 'review' = 'recommend'): string[] {
  const r: string[] = [];
  if (f.pass) {
    r.push('한수 쉼: 지금은 어떤 기물을 움직여도 형세가 나빠지므로 차례를 넘기는 것이 낫습니다.');
    return r;
  }
  const name = pName(f.piece);
  if (f.mateN !== undefined) {
    if (f.mateN <= 1) r.push('외통! 이 수로 바로 이깁니다.');
    else r.push(`${f.mateN}수 외통 수순의 첫 수입니다. 상대가 어떻게 받아도 ${f.mateN}수 안에 외통이 됩니다.`);
  }
  if (f.capture) {
    const vn = pName(f.capture.victim);
    const val = SEE_VALUE[f.capture.victim & 7];
    const g = f.capture.gain;
    const vp = POINTS[f.capture.victim & 7];
    if (g >= val - 10) r.push(`상대 ${vn}(${sqName(f.capture.sq)})${josa(vn, '을').slice(vn.length)} 공짜로 잡습니다 (+${vp}점).`);
    else if (g > 40) r.push(`상대 ${josa(vn, '을')} 잡습니다. 되잡혀도 교환에서 약 ${cpToPoints(g).toFixed(1)}점 이득입니다.`);
    else if (g >= -40) r.push(`상대 ${josa(vn, '을')} 잡아 비슷한 가치로 맞교환합니다.`);
    else r.push(`상대 ${josa(vn, '을')} 잡지만 되잡혀 기물로는 손해입니다. 대신 공격의 흐름을 얻는 수입니다.`);
  }
  if (f.escapeCheck) {
    const t: Record<string, string> = {
      king: '궁을 안전한 칸으로 옮겨 장군을 피합니다.',
      capture: '장군을 부른 상대 기물을 잡아 장군을 풉니다.',
      screen: '포의 다리 역할을 하던 기물을 치워 포 장군을 풉니다.',
      block: '사이에 기물을 놓아 장군을 막습니다.',
    };
    r.push(t[f.escapeCheck] + (f.check ? ' 동시에 상대에게 장군을 거는 멍군입니다!' : ''));
  }
  if (f.check && f.mateN === undefined && !f.escapeCheck) {
    let s = '장군! 상대 궁을 직접 공격합니다.';
    if (f.check.replies <= 3) s += ` 상대가 받을 수 있는 수가 ${f.check.replies}가지뿐입니다.`;
    r.push(s);
  }
  if (f.blocksMate) r.push('상대의 외통 위협을 막는 꼭 필요한 수입니다.');
  for (const h of f.escaped) r.push(`공격받던 ${josa(pName(h.piece), '을')} 안전한 곳으로 피신시킵니다.`);
  for (const h of f.protectedPieces) r.push(`공격받던 ${pieceAt(pos.board, h.sq, '을')} 지키거나 위협을 없앱니다.`);
  if (f.blocksThreat && threat && !f.escaped.length && !f.protectedPieces.length)
    r.push(`상대가 노리던 수(${threat.label})를 미리 막습니다.`);
  if (f.newTargets.length >= 2) {
    const a = f.newTargets[0];
    const b = f.newTargets[1];
    r.push(`상대 ${pieceAt(pos.board, a.sq, '와')} ${pieceAt(pos.board, b.sq, '을')} 동시에 노리는 양걸이입니다.`);
  } else if (f.newTargets.length === 1) {
    const a = f.newTargets[0];
    r.push(`다음 수에 상대 ${pieceAt(pos.board, a.sq, '을')} 노립니다.`);
  }
  if (f.palacePressure) r.push('상대 궁성을 향한 압박이 커집니다.');
  if (f.develop === HORSE || f.develop === ELEPHANT) r.push(`${josa(name, '을')} 전개해 활동 범위를 넓힙니다.`);
  if (f.develop === CHARIOT) r.push('구석의 차를 길이 열린 곳으로 끌어내 활용합니다.');
  if (f.centerCannon) r.push('포를 중앙 세로줄에 놓아 상대 궁성을 겨눕니다.');
  if (f.soldierConnect) r.push(`${josa(name, '을')} 옆 ${josa(name, '와')} 나란히 놓아 서로 지키게 합니다.`);
  else if (f.soldierAdvance) r.push(`${josa(name, '을')} 전진시켜 상대 진영을 압박합니다.`);
  if (f.kingMove && !f.capture) r.push('궁을 더 안전하거나 활동적인 자리로 옮깁니다.');
  if (f.guardMove && !f.capture) r.push('사를 움직여 궁 수비를 보강합니다.');
  if (f.createsBikjang) r.push('궁과 궁이 마주보는 빅장을 부릅니다. 상대가 피하지 않으면 무승부입니다.');
  if (f.movedHangs && !f.capture && f.mateN === undefined && !f.check) {
    if (mode === 'recommend') r.push(`옮긴 ${josa(name, '이')} 잡힐 수 있는 자리지만, 그 대가로 얻는 것이 더 큰 수입니다 (희생·교환).`);
    else r.push(`옮긴 ${josa(name, '은')} 상대에게 잡힐 수 있는 자리입니다. 잡히면 되잡거나 다른 이득을 얻을 수 있는지 꼭 확인하세요.`);
  }
  if (!r.length) r.push('큰 변화 없이 진형을 다지는 수입니다.');
  return r;
}

/** 상대 수 해설 (상대 입장 사실을 내 입장으로 서술) */
function factsToOpponentNotes(pos: Position, f: MoveFacts): string[] {
  const r: string[] = [];
  if (f.pass) return ['상대가 한수 쉼을 했습니다.'];
  const name = pName(f.piece);
  if (f.capture) r.push(`상대가 내 ${pName(f.capture.victim)}(${sqName(f.capture.sq)})${josa(pName(f.capture.victim), '을').slice(pName(f.capture.victim).length)} 잡았습니다 (-${POINTS[f.capture.victim & 7]}점).`);
  if (f.escapeCheck) {
    const t: Record<string, string> = {
      king: '상대가 궁을 옮겨 내 장군을 피했습니다.',
      capture: '상대가 장군을 부른 내 기물을 잡았습니다.',
      screen: '상대가 내 포의 다리를 치워 장군을 풀었습니다.',
      block: '상대가 사이를 막아 내 장군을 받았습니다.',
    };
    r.push(t[f.escapeCheck]);
  }
  if (f.check) r.push(f.escapeCheck ? '게다가 멍군! 이번에는 내가 장군을 받고 있습니다.' : `상대가 ${josa(name, '으로')} 장군을 불렀습니다! 반드시 받아야 합니다.`);
  for (const h of f.escaped) r.push(`상대가 공격받던 ${josa(pName(h.piece), '을')} 피신시켰습니다.`);
  for (const h of f.protectedPieces) r.push(`상대가 위협받던 ${josa(pName(h.piece), '을')} 지켰습니다.`);
  if (f.newTargets.length >= 2)
    r.push(`상대가 내 ${pieceAt(pos.board, f.newTargets[0].sq, '와')} ${pieceAt(pos.board, f.newTargets[1].sq, '을')} 동시에 노리고 있습니다.`);
  else if (f.newTargets.length === 1) r.push(`상대가 다음 수에 내 ${pieceAt(pos.board, f.newTargets[0].sq, '을')} 노리고 있습니다.`);
  if (f.palacePressure) r.push('상대가 내 궁성 쪽 압박을 강화했습니다.');
  if (f.develop === HORSE || f.develop === ELEPHANT) r.push(`상대가 ${josa(name, '을')} 전개했습니다.`);
  if (f.develop === CHARIOT) r.push('상대가 차를 끌어내 활동을 시작했습니다.');
  if (f.centerCannon) r.push('상대 포가 중앙줄로 와서 내 궁성을 겨누고 있습니다.');
  if (f.soldierAdvance && !f.capture) r.push(`상대 ${josa(name, '이')} 전진했습니다.`);
  if (f.kingMove && !f.capture && !f.check) r.push('상대가 궁을 움직였습니다.');
  if (f.createsBikjang) r.push('상대가 빅장을 불렀습니다. 피하지 않으면 무승부가 됩니다.');
  if (f.movedHangs && !f.capture) r.push(`상대 ${name}(${sqName(f.to)})${josa(name, '이').slice(name.length)} 잡힐 수 있는 자리에 왔습니다. 함정인지 확인해 보세요.`);
  if (!r.length) r.push(`상대가 ${josa(name, '을')} 움직여 진형을 정비했습니다.`);
  return r;
}

// ------------------------------------------------------------------
// 상대의 노림수 (내가 한수 쉰다고 가정)
// ------------------------------------------------------------------

interface OppThreat {
  kind: 'mate' | 'material';
  move: number;
  label: string;
  gain: number;
  mateN?: number;
  pv: number[];
  pvText: string;
  targetSq?: number;
  /** 위협이 몇 번째 상대 수에서 실현되는지 (1 = 바로 다음 수) */
  realizeAt: number;
}

function findThreat(searcher: Searcher, pos: Position, opts: CoachOptions, timeMs: number): OppThreat | null {
  if (pos.inCheck()) return null;
  pos.makeMove(PASS);
  const base = evaluate(pos);
  const r = searcher.search(pos, { timeMs, maxDepth: 7, bikjang: opts.bikjang });
  let res: OppThreat | null = null;
  if (r.move && r.move !== PASS) {
    const label = moveLabel(pos.board, r.move);
    const pvText = lineText(pos, r.pv, 5);
    if (isMateScore(r.score) && r.score > 0) {
      res = { kind: 'mate', move: r.move, label, gain: r.score, mateN: mateIn(r.score), pv: r.pv, pvText, realizeAt: mateIn(r.score) };
    } else {
      const gain = r.score - base;
      if (gain >= 130) {
        // 실제로 잡히는 기물 찾기 (PV에서 상대의 잡는 수)
        let targetSq: number | undefined;
        let realizeAt = 1;
        let made = 0;
        for (let i = 0; i < r.pv.length && i < 6; i++) {
          const m = r.pv[i];
          if (m !== PASS && !pos.isLegal(m)) break;
          if (i % 2 === 0 && m !== PASS && pos.board[m & 127] && targetSq === undefined) {
            targetSq = m & 127;
            realizeAt = i / 2 + 1;
          }
          pos.makeMove(m);
          made++;
        }
        for (let i = 0; i < made; i++) pos.unmakeMove();
        res = { kind: 'material', move: r.move, label, gain, pv: r.pv, pvText, targetSq, realizeAt };
      }
    }
  }
  pos.unmakeMove();
  return res;
}

// ------------------------------------------------------------------
// 정적인 위험 / 조언
// ------------------------------------------------------------------

function staticWarnings(pos: Position, side: Side, phase: string): { dangers: Danger[]; future: string[]; tips: string[] } {
  const b = pos.board;
  const enemy = (side ^ 1) as Side;
  const eHi = enemy << 3;
  const dangers: Danger[] = [];
  const future: string[] = [];
  const tips: string[] = [];
  const k = pos.kingSq[side];
  if (k >= 0) {
    // 궁과 같은 세로줄의 상대 포/차
    const step = side === CHO ? -9 : 9;
    let between = 0;
    const betweenSqs: number[] = [];
    for (let q = k + step; q >= 0 && q < NSQ; q += step) {
      const pc = b[q];
      if (!pc) continue;
      if (pc === (eHi | CANNON) && between === 2) {
        future.push(
          `상대 포(${sqName(q)})${josa('포', '이').slice(1)} 내 궁과 같은 세로줄에 있습니다. 사이의 기물(${betweenSqs.map(sqName).join(', ')}) 중 하나가 비키면 곧바로 장군이 됩니다.`,
        );
      }
      if (pc === (eHi | CHARIOT) && between === 1) {
        future.push(`상대 차(${sqName(q)})가 내 궁을 겨누고 있습니다. 사이 기물(${sqName(betweenSqs[0])})이 움직이면 장군이 됩니다 — 그 기물은 함부로 움직이지 마세요.`);
      }
      betweenSqs.push(q);
      between++;
      if (between > 2) break;
    }
  }
  // 사 개수
  const guards = pos.counts[(side << 3) | GUARD];
  const enemyChariots = pos.counts[eHi | CHARIOT];
  if (guards < 2 && enemyChariots + pos.counts[eHi | CANNON] > 0) {
    future.push(`사가 ${guards}개뿐이라 궁성 수비가 얇습니다. 상대 차·포가 궁성으로 들어오는 길을 미리 막아 두세요.`);
  }
  // 궁성을 향해 열린 줄의 상대 차
  for (let s = 0; s < NSQ; s++) {
    if (b[s] !== (eHi | CHARIOT) || PALACE[s] === side) continue;
    const c = colOf(s);
    if (c < 3 || c > 5) continue;
    const dir = side === CHO ? 9 : -9;
    let open = true;
    let q = s + dir;
    while (q >= 0 && q < NSQ && PALACE[q] !== side) {
      if (b[q]) {
        open = false;
        break;
      }
      q += dir;
    }
    if (open && q >= 0 && q < NSQ) {
      future.push(`상대 차(${sqName(s)})가 ${c + 1}번 세로줄을 따라 내 궁성으로 바로 들어올 수 있는 길이 열려 있습니다.`);
    }
  }
  // 궁성 근처 상대 졸
  for (let s = 0; s < NSQ; s++) {
    if (b[s] !== (eHi | SOLDIER)) continue;
    const r = rowOf(s);
    const near = side === CHO ? r >= 6 : r <= 3;
    const c = colOf(s);
    if (near && c >= 2 && c <= 6) {
      future.push(`상대 ${pieceName(b[s])}(${sqName(s)})이 궁성 가까이 와 있습니다. 궁성 안으로 들어오면 대각선으로도 움직여 위험해집니다.`);
      break;
    }
  }
  // 내 기물 상태: 다리 없는 포, 멱이 막힌 마
  for (let s = 0; s < NSQ; s++) {
    const p = b[s];
    if (!p || p >> 3 !== side) continue;
    const t = p & 7;
    if (t === CANNON) {
      let canMove = false;
      for (const ray of ORTHO_RAYS[s]) {
        let i = 0;
        while (i < ray.length && !b[ray[i]]) i++;
        if (i < ray.length && (b[ray[i]] & 7) !== CANNON && i + 1 < ray.length) {
          const nq = b[ray[i + 1]];
          if (!nq || (nq >> 3 !== side && (nq & 7) !== CANNON)) canMove = true;
        }
      }
      if (!canMove && phase !== '초반') tips.push(`포(${sqName(s)})는 넘을 다리가 없어 지금은 움직일 수 없습니다. 포 앞에 졸이나 마를 다리로 놓으면 다시 쓸 수 있습니다.`);
    }
    if (t === HORSE) {
      const mv = HORSE_MOVES[s];
      let free = 0;
      for (let i = 0; i < mv.length; i += 2) if (!b[mv[i + 1]]) free++;
      if (free === 0) tips.push(`마(${sqName(s)})의 멱(다리 자리)이 모두 막혀 꼼짝 못 합니다. 앞을 열어 주세요.`);
    }
  }
  return { dangers, future, tips };
}

const TIPS: Record<'초반' | '중반' | '종반', string[]> = {
  초반: [
    '초반에는 마와 상을 먼저 전개하고, 차는 길이 열린 뒤에 움직이는 것이 좋습니다.',
    '포는 반드시 다른 기물을 하나 넘어야 움직일 수 있습니다. 졸이나 마를 다리로 활용하세요.',
    '궁성 가운데의 궁은 사 두 개로 지키는 것이 기본입니다. 사를 너무 일찍 움직이지 마세요.',
    '졸은 뒤로 물러날 수 없습니다. 함부로 전진시키면 수비가 약해집니다.',
    '상대 포가 넘어올 수 있는 길(다리)을 주지 않도록 기물 배치에 신경 쓰세요.',
  ],
  중반: [
    '기물을 교환할 때는 점수를 따져 보세요: 차 13, 포 7, 마 5, 상 3, 사 3, 졸 2.',
    '상대 궁성의 빈 곳(사가 없는 쪽)을 노리면 공격이 잘 통합니다.',
    '차와 포를 같은 줄에 겹치면(차포) 강력한 공격이 됩니다.',
    '공격하기 전에 내 궁성에 빈틈이 없는지 먼저 확인하세요.',
    '상대가 둔 수의 노림이 무엇인지 항상 먼저 생각하는 습관을 들이세요.',
  ],
  종반: [
    '종반에는 포의 다리가 부족해져 힘이 약해지고, 마와 졸의 가치가 커집니다.',
    '졸(병)은 상대 궁성 안에 들어가면 대각선 앞으로도 움직일 수 있어 위력이 커집니다.',
    '종반에는 궁도 적극적으로 움직여 수비와 공격에 활용하세요.',
    '기물 점수에서 앞서고 있다면 무리하지 말고 교환으로 단순화하는 것이 좋습니다.',
  ],
};

function undevelopedTip(pos: Position, side: Side): string | null {
  const row = backRow(side);
  const names: string[] = [];
  for (let c = 0; c < 9; c++) {
    const p = pos.board[row * 9 + c];
    if (!p || p >> 3 !== side) continue;
    const t = p & 7;
    if (t === HORSE || t === ELEPHANT) names.push(`${pieceName(p)}(${sqName(row * 9 + c)})`);
  }
  if (names.length >= 3) return `아직 ${names.join(', ')}이(가) 처음 자리에 있습니다. 초반에는 마·상을 전개해 기물이 서로 돕게 하세요.`;
  return null;
}

// ------------------------------------------------------------------
// 메인: 국면 분석
// ------------------------------------------------------------------

export function analyzePosition(searcher: Searcher, pos: Position, opts: CoachOptions): Advice {
  const side = pos.side;
  const enemy = (side ^ 1) as Side;
  const T = opts.timeMs;
  const phase = phaseOf(pos);
  const legal = pos.legalMoves();
  const inCheck = pos.inCheck();

  // 1) 상대 직전 수 해설에 필요한 정보 (직전 국면 기준)
  let opponentMove: Advice['opponentMove'];
  if (pos.sp > 0) {
    const last = pos.lastMove();
    pos.unmakeMove();
    if (pos.side === enemy) {
      const f = analyzeMoveFacts(pos, last, opts, undefined, null, null);
      opponentMove = { label: moveLabel(pos.board, last), notes: factsToOpponentNotes(pos, f) };
    }
    pos.makeMove(last);
  }

  // 2) 다중 후보 탐색
  const results: SearchResult[] = [];
  const r1 = searcher.search(pos, { timeMs: T * 0.5, maxDepth: 30, bikjang: opts.bikjang });
  results.push(r1);
  if (legal.length > 1 && r1.move) {
    const r2 = searcher.search(pos, { timeMs: T * 0.15, maxDepth: 30, bikjang: opts.bikjang, excludeRoot: [r1.move] });
    if (r2.move) results.push(r2);
    if (legal.length > 2 && r2.move) {
      const r3 = searcher.search(pos, { timeMs: T * 0.12, maxDepth: 30, bikjang: opts.bikjang, excludeRoot: [r1.move, r2.move] });
      if (r3.move) results.push(r3);
    }
  }
  results.sort((a, b) => b.score - a.score);
  const best = results[0];

  // 3) 상대 노림수
  const threat = inCheck ? null : findThreat(searcher, pos, opts, T * 0.18);

  // 4) 추천수 설명
  const recommendations: Recommendation[] = [];
  for (const r of results) {
    if (!r.move) continue;
    // 1등과 너무 차이 나는 후보는 제외
    if (recommendations.length && !isMateScore(best.score) && best.score - r.score > 250) continue;
    const f = analyzeMoveFacts(pos, r.move, opts, r.score, threat, searcher);
    recommendations.push({
      move: r.move,
      label: moveLabel(pos.board, r.move),
      notation: moveNotation(pos.board, r.move),
      score: r.score,
      scoreText: scoreText(r.score),
      reasons: factsToReasons(pos, f, threat),
      line: lineText(pos, r.pv, 6),
    });
  }

  // 5) 현재 위험
  const dangers: Danger[] = [];
  const marks: Mark[] = [];
  if (inCheck) {
    const ch = checkers(pos, side);
    const lastName = ch.length ? pieceName(pos.board[ch[ch.length - 1]]) : '기물';
    const list = ch.map((s) => `상대 ${pieceAt(pos.board, s)}`).join(', ');
    dangers.push({
      level: 'high',
      text: `장군! ${list}${josa(lastName, '이').slice(lastName.length)} 내 궁을 공격하고 있습니다. 궁을 피하거나, 사이를 막거나, 공격하는 기물을 잡아야 합니다 (받을 수 있는 수 ${legal.length}가지).`,
      squares: [pos.kingSq[side], ...ch],
    });
  }
  if (isMateScore(best.score) && best.score < 0) {
    const n = -mateIn(best.score);
    dangers.push({
      level: 'high',
      text: `상대에게 ${n}수 외통 수순이 있습니다. 가장 오래 버티는 수는 ${recommendations[0]?.label ?? '-'}입니다.`,
      squares: [pos.kingSq[side]],
    });
  } else if (threat && threat.kind === 'mate') {
    dangers.push({
      level: 'high',
      text: `상대가 ${threat.mateN}수 외통을 노리고 있습니다! 대비하지 않으면: ${threat.pvText}`,
      squares: [pos.kingSq[side], threat.move >> 7],
    });
  }
  const hanging = winnablePieces(pos, side, 80);
  for (const h of hanging) {
    const att = h.attackers.map((s) => `${pieceAt(pos.board, s)}`).join(', ');
    const pn = pieceName(h.piece);
    const v = h.piece & 7;
    const level: Danger['level'] = v === CHARIOT || h.gain >= 500 ? 'high' : v === CANNON || v === HORSE || h.gain >= 250 ? 'mid' : 'low';
    const detail = h.defended
      ? `지켜주는 기물이 있지만 교환하면 약 ${cpToPoints(h.gain).toFixed(1)}점 손해입니다`
      : `지켜주는 기물이 없습니다 (잃으면 -${POINTS[v]}점)`;
    dangers.push({
      level,
      text: `내 ${pn}(${sqName(h.sq)})${josa(pn, '이').slice(pn.length)} 상대 ${att}에게 공격받고 있습니다 — ${detail}.`,
      squares: [h.sq, ...h.attackers],
    });
    marks.push({ sq: h.sq, kind: 'danger' });
  }
  if (threat && threat.kind === 'material' && !hanging.some((h) => h.sq === threat.targetSq)) {
    dangers.push({
      level: threat.gain >= 400 ? 'high' : 'mid',
      text: `상대의 노림수: ${threat.label}. 그대로 두면 ${threat.pvText} — 약 ${cpToPoints(threat.gain).toFixed(1)}점 손해를 볼 수 있습니다.`,
      squares: [threat.move >> 7, threat.move & 127],
    });
  }
  const sw = staticWarnings(pos, side, phase);
  dangers.push(...sw.dangers);
  if (!dangers.length) dangers.push({ level: 'low', text: '지금 당장 잡힐 기물이나 직접적인 위협은 없습니다.', squares: [] });

  // 6) 몇 수 뒤의 위험
  const future: string[] = [];
  if (best.move && best.pv.length > 1 && !isMateScore(best.score)) {
    const reply = predictedReply(pos, best.pv[0], best.pv[1], opts);
    if (reply) future.push(reply);
  }
  if (best.move && best.pv.length > 1) {
    let made = 0;
    let warnedCheck = false;
    let warnedCap = false;
    for (let i = 0; i < best.pv.length && i < 8; i++) {
      const m = best.pv[i];
      if (m !== PASS && !pos.isLegal(m)) break;
      const isOpp = i % 2 === 1;
      if (isOpp && m !== PASS) {
        const victim = pos.board[m & 127];
        const mover = pos.board[m >> 7];
        pos.makeMove(m);
        made++;
        if (!warnedCheck && pos.inCheck(side)) {
          future.push(`추천 수순대로 가도 ${i}수 뒤 상대 ${josa(pieceName(mover), '이')} 장군을 부를 수 있습니다. 궁의 피난처를 미리 생각해 두세요.`);
          warnedCheck = true;
        }
        if (!warnedCap && victim && (victim & 7) !== SOLDIER) {
          future.push(`${i}수 뒤 상대가 내 ${josa(pieceName(victim), '을')} 잡는 교환이 예상됩니다 (예상 수순 참고).`);
          warnedCap = true;
        }
        continue;
      }
      pos.makeMove(m);
      made++;
    }
    for (let i = 0; i < made; i++) pos.unmakeMove();
  }
  if (threat && threat.realizeAt >= 2) {
    future.push(
      threat.kind === 'mate'
        ? `지금 바로는 아니지만, 대비하지 않으면 상대가 ${threat.realizeAt}수 안에 외통을 만들 수 있습니다.`
        : `지금 대비하지 않으면 상대가 ${threat.realizeAt}번째 수에 기물을 얻는 수순이 있습니다: ${threat.pvText}`,
    );
  }
  future.push(...sw.future);
  if (!future.length) future.push('앞으로 몇 수 안에 큰 위험은 보이지 않습니다. 상대의 다음 수에서 노림을 꼭 확인하세요.');

  // 7) 형세와 상황
  const evalCp = best.score;
  const matMe = materialPoints(pos, side) + (opts.deomSide === side ? 1.5 : 0);
  const matOpp = materialPoints(pos, enemy) + (opts.deomSide === enemy ? 1.5 : 0);
  const situation: string[] = [];
  situation.push(`${pos.sp + 1}번째 수 · ${phase}${inCheck ? ' · 장군을 받는 중' : ''}`);
  situation.push(`형세 판단: ${evalSentence(evalCp)}`);
  const diff = matMe - matOpp;
  situation.push(
    `기물 점수: 나 ${matMe} / 상대 ${matOpp}${opts.deomSide === side ? ' (내 덤 1.5 포함)' : ' (상대 덤 1.5 포함)'} — ${
      Math.abs(diff) < 0.01 ? '동점' : diff > 0 ? `내가 ${diff}점 앞섬` : `상대가 ${-diff}점 앞섬`
    }`,
  );
  const imbalance: string[] = [];
  for (const t of [CHARIOT, CANNON, HORSE, ELEPHANT, GUARD, SOLDIER]) {
    const a = pos.counts[(side << 3) | t];
    const bb = pos.counts[(enemy << 3) | t];
    if (a !== bb) imbalance.push(`${t === SOLDIER ? '졸' : pieceName(t)} ${a}:${bb}`);
  }
  if (imbalance.length) situation.push(`기물 차이(나:상대): ${imbalance.join(', ')}`);
  const myZone = countZoneAttackers(pos, enemy, side);
  const oppZone = countZoneAttackers(pos, side, enemy);
  situation.push(
    `궁 안전: 내 궁성 근처 상대 공격 기물 ${myZone}개, 상대 궁성 근처 내 공격 기물 ${oppZone}개 · 사 ${pos.counts[(side << 3) | GUARD]}개 / 상대 사 ${pos.counts[(enemy << 3) | GUARD]}개`,
  );

  // 8) 팁
  const tips: string[] = [];
  if (phase === '초반') {
    const t = undevelopedTip(pos, side);
    if (t) tips.push(t);
  }
  tips.push(...sw.tips.slice(0, 2));
  const pool = TIPS[phase];
  tips.push(pool[pos.sp % pool.length]);

  // 9) 화살표·표시
  const arrows: Arrow[] = [];
  recommendations.forEach((rec, i) => {
    if (rec.move !== PASS && i < 2) arrows.push({ from: rec.move >> 7, to: rec.move & 127, kind: i === 0 ? 'best' : 'alt' });
  });
  if (threat) arrows.push({ from: threat.move >> 7, to: threat.move & 127, kind: 'threat' });
  else if (hanging.length) arrows.push({ from: hanging[0].bestCapture >> 7, to: hanging[0].sq, kind: 'threat' });
  for (const h of winnablePieces(pos, enemy, 80)) marks.push({ sq: h.sq, kind: 'target' });

  return {
    side,
    moveNumber: pos.sp + 1,
    phase,
    evalCp,
    evalText: evalSentence(evalCp),
    situation,
    opponentMove,
    dangers,
    recommendations,
    future,
    tips,
    arrows,
    marks,
    depth: best.depth,
    nodes: results.reduce((a, r) => a + r.nodes, 0),
    bestMove: best.move,
    bestScore: best.score,
    top: recommendations.map((r) => ({ move: r.move, score: r.score, reasons: r.reasons, label: r.label })),
  };
}

/** 추천 수 뒤 상대의 예상 응수와 그 의도 */
function predictedReply(pos: Position, mine: number, reply: number, opts: CoachOptions): string | null {
  if (mine !== PASS && !pos.isLegal(mine)) return null;
  const myLabel = moveLabel(pos.board, mine);
  pos.makeMove(mine);
  let text: string | null = null;
  if (reply === PASS || pos.isLegal(reply)) {
    const label = moveLabel(pos.board, reply);
    let purpose = '';
    if (reply !== PASS) {
      const f = analyzeMoveFacts(pos, reply, opts, undefined, null, null);
      if (f.capture) purpose = `내 ${josa(pieceName(f.capture.victim), '을')} 잡는 수`;
      else if (f.check) purpose = '장군을 부르는 수';
      else if (f.newTargets.length) purpose = `내 ${pieceAt(pos.board, f.newTargets[0].sq, '을')} 노리는 수`;
      else if (f.escaped.length) purpose = `공격받는 ${josa(pieceName(f.escaped[0].piece), '을')} 피하는 수`;
      else if (f.develop) purpose = '기물을 전개하는 수';
      else if (f.palacePressure) purpose = '내 궁성을 압박하는 수';
    }
    text = `추천 수(${myLabel}) 뒤 상대의 예상 응수는 ${label}입니다${purpose ? ` — ${purpose}입니다` : ''}. 미리 대비책을 생각해 두세요.`;
  }
  pos.unmakeMove();
  return text;
}

function countZoneAttackers(pos: Position, attacker: Side, defender: Side): number {
  let n = 0;
  for (let s = 0; s < NSQ; s++) {
    const p = pos.board[s];
    if (!p || p >> 3 !== attacker) continue;
    const t = p & 7;
    if (t === KING || t === GUARD) continue;
    const r = rowOf(s);
    const c = colOf(s);
    const inZone = c >= 2 && c <= 6 && (defender === CHO ? r >= 6 : r <= 3);
    if (inZone && t !== ELEPHANT) n++;
  }
  return n;
}

// ------------------------------------------------------------------
// 방금 둔 수 평가
// ------------------------------------------------------------------

export interface PriorAnalysis {
  bestMove: number;
  bestScore: number;
  top: { move: number; score: number; reasons: string[]; label: string }[];
  depth: number;
}

export function classify(loss: number, bestScore: number, moveScore: number): Quality {
  // 이기는 외통을 놓친 경우
  if (isMateScore(bestScore) && bestScore > 0 && !(isMateScore(moveScore) && moveScore > 0)) {
    return moveScore > 600 ? 'inaccuracy' : moveScore > 200 ? 'mistake' : 'blunder';
  }
  if (loss <= 12) return 'best';
  if (loss <= 40) return 'good';
  if (loss <= 90) return 'ok';
  if (loss <= 200) return 'inaccuracy';
  if (loss <= 450) return 'mistake';
  return 'blunder';
}

export function reviewMove(searcher: Searcher, pos: Position, move: number, prior: PriorAnalysis, opts: CoachOptions): Review {
  const label = moveLabel(pos.board, move);
  const threat = pos.inCheck() ? null : findThreat(searcher, pos, opts, Math.min(400, opts.timeMs * 0.2));
  // 수의 점수 구하기
  let moveScore: number;
  const known = prior.top.find((t) => t.move === move);
  let reply: SearchResult | null = null;
  const facingBefore = opts.bikjang && pos.kingsFacing();
  pos.makeMove(move);
  if (facingBefore && pos.kingsFacing()) {
    moveScore = 0; // 빅장을 피하지 않음 → 무승부
  } else {
    reply = searcher.search(pos, { timeMs: opts.timeMs * 0.45, maxDepth: Math.max(2, prior.depth - 1), bikjang: opts.bikjang });
    moveScore = -reply.score;
  }
  const refLine = reply && reply.move ? lineText(pos, reply.pv, 4) : '';
  pos.unmakeMove();
  if (known) moveScore = known.score;
  if (move === prior.bestMove) moveScore = Math.max(moveScore, prior.bestScore);
  const bestScore = Math.max(prior.bestScore, moveScore);
  const loss = Math.max(0, bestScore - moveScore);
  const quality = move === prior.bestMove ? 'best' : classify(loss, bestScore, moveScore);

  const f = analyzeMoveFacts(pos, move, opts, moveScore, threat, searcher);
  const comments = factsToReasons(pos, f, threat, 'review').filter(
    (c) => !(quality !== 'best' && quality !== 'good' && quality !== 'ok' && c.startsWith('옮긴 ')),
  );
  // 실수 설명
  if (quality === 'mistake' || quality === 'blunder' || quality === 'inaccuracy') {
    if (f.movedHangs && !f.capture) {
      const n = pieceName(f.piece);
      comments.unshift(`옮긴 ${n}(${sqName(f.to)})${josa(n, '이').slice(n.length)} 상대에게 잡힐 수 있는 자리입니다.`);
    }
    for (const h of f.leftHanging) {
      const n = pieceName(h.piece);
      comments.unshift(`공격받던 ${n}(${sqName(h.sq)})${josa(n, '을').slice(n.length)} 그대로 두었습니다.`);
    }
    if (threat && threat.kind === 'mate' && !f.blocksMate && !(isMateScore(moveScore) && moveScore > 0)) {
      comments.unshift('상대의 외통 위협을 막지 못했습니다!');
    }
    if (isMateScore(moveScore) && moveScore < 0) {
      comments.unshift(`이 수 뒤에 상대에게 ${-mateIn(moveScore)}수 외통 수순이 생깁니다.`);
    }
    if (isMateScore(bestScore) && bestScore > 0 && !(isMateScore(moveScore) && moveScore > 0)) {
      comments.unshift(`외통으로 이길 수 있는 수(${mateIn(bestScore)}수 외통)를 놓쳤습니다.`);
    }
  }
  let better: Review['better'];
  if (quality !== 'best' && quality !== 'good' && prior.bestMove && prior.bestMove !== move) {
    const top = prior.top.find((t) => t.move === prior.bestMove);
    better = { label: top?.label ?? moveLabel(pos.board, prior.bestMove), reasons: top?.reasons ?? [] };
  }
  const refutation = quality === 'mistake' || quality === 'blunder' ? (refLine ? `예상되는 상대의 응수: ${refLine}` : undefined) : undefined;
  return {
    move,
    label,
    quality,
    qualityText: QUALITY_TEXT[quality],
    loss,
    lossPoints: cpToPoints(loss),
    comments: comments.slice(0, 5),
    better,
    refutation,
  };
}

