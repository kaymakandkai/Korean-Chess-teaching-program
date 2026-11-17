// 와룡장기 엔진 공용 상수
// 보드 좌표: row 0 = 맨 위(한 진영), row 9 = 맨 아래(초 진영), col 0..8 = 왼쪽→오른쪽 (초 기준)
// 칸 번호 sq = row * 9 + col

export const ROWS = 10;
export const COLS = 9;
export const NSQ = 90;

export const CHO = 0; // 초 (아래쪽)
export const HAN = 1; // 한 (위쪽)
export type Side = 0 | 1;

export const EMPTY = 0;
export const KING = 1; // 궁
export const GUARD = 2; // 사
export const ELEPHANT = 3; // 상
export const HORSE = 4; // 마
export const CHARIOT = 5; // 차
export const CANNON = 6; // 포
export const SOLDIER = 7; // 졸 / 병

export function makePiece(side: Side, type: number): number {
  return type | (side << 3);
}
export function pieceType(p: number): number {
  return p & 7;
}
export function pieceSide(p: number): Side {
  return (p >> 3) as Side;
}
export function sqOf(r: number, c: number): number {
  return r * COLS + c;
}
export function rowOf(s: number): number {
  return (s / COLS) | 0;
}
export function colOf(s: number): number {
  return s % COLS;
}

// 수 인코딩: (from << 7) | to.  한수 쉼 = PASS
export const PASS = 16383;
export const NO_MOVE = 0;
export function makeMove(from: number, to: number): number {
  return (from << 7) | to;
}
export function moveFrom(m: number): number {
  return m >> 7;
}
export function moveTo(m: number): number {
  return m & 127;
}

export const MATE = 30000;
export const MATE_BOUND = 29000;
export const INF = 32000;

// 전통 기물 점수 (점수 판정용): 차13 포7 마5 상3 사3 졸2
export const POINTS = [0, 0, 3, 3, 5, 13, 7, 2];
// 후수(두 번째로 두는 쪽)에게 주는 덤
export const DEOM = 1.5;

export function otherSide(s: Side): Side {
  return (s ^ 1) as Side;
}

export const SIDE_NAME = ['초', '한'] as const;
