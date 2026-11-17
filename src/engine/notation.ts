// 기보 표기와 한국어 문장 도우미
import { CHO, KING, PASS, SOLDIER, Side, colOf, rowOf } from './constants';

export const PIECE_KO = ['', '궁', '사', '상', '마', '차', '포', '졸'];
export const PIECE_HANJA_CHO = ['', '楚', '士', '象', '馬', '車', '包', '卒'];
export const PIECE_HANJA_HAN = ['', '漢', '士', '象', '馬', '車', '包', '兵'];

export function pieceName(p: number): string {
  const t = p & 7;
  if (t === SOLDIER) return p >> 3 === CHO ? '졸' : '병';
  return PIECE_KO[t];
}

/** 이름 + 진영. 예: "한 차" */
export function pieceFullName(p: number): string {
  return `${p >> 3 === CHO ? '초' : '한'} ${pieceName(p)}`;
}

/**
 * 좌표 표기: 가로줄(위에서부터 1~9, 맨 아래 0) + 세로줄(왼쪽부터 1~9)
 * 예: 초 궁의 시작 자리 = "95"
 */
export function sqName(s: number): string {
  return `${(rowOf(s) + 1) % 10}${colOf(s) + 1}`;
}

/** 기보 표기 예: "82포85" */
export function moveNotation(board: Int8Array, m: number): string {
  if (m === PASS) return '한수쉼';
  const from = m >> 7;
  const to = m & 127;
  const p = board[from];
  return `${sqName(from)}${pieceName(p)}${sqName(to)}`;
}

/** 쉬운 표기 예: "포 82→85" */
export function moveLabel(board: Int8Array, m: number): string {
  if (m === PASS) return '한수 쉼';
  const from = m >> 7;
  const to = m & 127;
  const p = board[from];
  const cap = board[to];
  const base = `${pieceName(p)} ${sqName(from)}→${sqName(to)}`;
  return cap ? `${base} (${pieceName(cap)} 잡음)` : base;
}

export function sideName(s: Side | number): string {
  return s === CHO ? '초' : '한';
}

// ---- 한국어 조사 ----
function hasBatchim(word: string): boolean {
  const ch = word.charCodeAt(word.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 !== 0;
  // 숫자: 0영 1일 3삼 6육 7칠 8팔 → 받침 있음
  const d = word[word.length - 1];
  if (d >= '0' && d <= '9') return '013678'.includes(d);
  return false;
}
function isRieul(word: string): boolean {
  const ch = word.charCodeAt(word.length - 1);
  if (ch >= 0xac00 && ch <= 0xd7a3) return (ch - 0xac00) % 28 === 8;
  const d = word[word.length - 1];
  return '178'.includes(d);
}

/** 조사 붙이기. kind: '을' | '이' | '은' | '와' | '으로' */
export function josa(word: string, kind: '을' | '이' | '은' | '와' | '으로'): string {
  const b = hasBatchim(word);
  switch (kind) {
    case '을':
      return word + (b ? '을' : '를');
    case '이':
      return word + (b ? '이' : '가');
    case '은':
      return word + (b ? '은' : '는');
    case '와':
      return word + (b ? '과' : '와');
    case '으로':
      return word + (b && !isRieul(word) ? '으로' : '로');
  }
}

/** "포(82)" 형태 + 조사. 조사는 기물 이름 기준 */
export function pieceAt(board: Int8Array, s: number, kind?: '을' | '이' | '은' | '와' | '으로'): string {
  const name = pieceName(board[s]);
  if (!kind) return `${name}(${sqName(s)})`;
  const withJosa = josa(name, kind);
  return `${name}(${sqName(s)})${withJosa.slice(name.length)}`;
}

export function isKing(p: number) {
  return (p & 7) === KING;
}

/** 엔진 점수(졸=100)를 전통 점수 단위(졸=2점)로 */
export function cpToPoints(cp: number): number {
  return Math.round(cp / 5) / 10;
}
