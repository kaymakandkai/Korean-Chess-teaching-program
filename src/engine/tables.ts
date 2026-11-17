// 미리 계산해 두는 이동 테이블
import { CHO, COLS, HAN, NSQ, ROWS, colOf, rowOf, sqOf } from './constants';

const onBoard = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

/** 각 칸이 어느 진영의 궁성인지 (-1: 궁성 아님) */
export const PALACE = new Int8Array(NSQ).fill(-1);
for (let r = 0; r < 3; r++) for (let c = 3; c <= 5; c++) PALACE[sqOf(r, c)] = HAN;
for (let r = 7; r < 10; r++) for (let c = 3; c <= 5; c++) PALACE[sqOf(r, c)] = CHO;

/** 궁성 중심 (진영 인덱스) */
export const PALACE_CENTER = [sqOf(8, 4), sqOf(1, 4)];

/** 궁성 대각선으로 연결된 이웃 */
export const PALACE_DIAG: number[][] = Array.from({ length: NSQ }, () => []);
for (const center of PALACE_CENTER) {
  const cr = rowOf(center);
  const cc = colOf(center);
  for (const [dr, dc] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    const corner = sqOf(cr + dr, cc + dc);
    PALACE_DIAG[center].push(corner);
    PALACE_DIAG[corner].push(center);
  }
}

const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** 궁/사 이동 (궁성 안, 선을 따라 한 칸) */
export const PALACE_MOVES: number[][] = Array.from({ length: NSQ }, () => []);
for (let s = 0; s < NSQ; s++) {
  if (PALACE[s] < 0) continue;
  const r = rowOf(s);
  const c = colOf(s);
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (onBoard(nr, nc) && PALACE[sqOf(nr, nc)] === PALACE[s]) PALACE_MOVES[s].push(sqOf(nr, nc));
  }
  for (const d of PALACE_DIAG[s]) PALACE_MOVES[s].push(d);
}

/** 직선 방향 광선 [sq][dir] */
export const ORTHO_RAYS: number[][][] = [];
for (let s = 0; s < NSQ; s++) {
  const r = rowOf(s);
  const c = colOf(s);
  const rays: number[][] = [];
  for (const [dr, dc] of DIRS) {
    const ray: number[] = [];
    let nr = r + dr;
    let nc = c + dc;
    while (onBoard(nr, nc)) {
      ray.push(sqOf(nr, nc));
      nr += dr;
      nc += dc;
    }
    if (ray.length) rays.push(ray);
  }
  ORTHO_RAYS.push(rays);
}

/** 궁성 대각선 광선 (차, 포용) */
export const DIAG_RAYS: number[][][] = [];
for (let s = 0; s < NSQ; s++) {
  const rays: number[][] = [];
  if (PALACE[s] >= 0) {
    const center = PALACE_CENTER[PALACE[s]];
    if (s === center) {
      for (const corner of PALACE_DIAG[s]) rays.push([corner]);
    } else if (PALACE_DIAG[s].length) {
      rays.push([center, 2 * center - s]);
    }
  }
  DIAG_RAYS.push(rays);
}

/** 마 이동: [to, 멱(leg), to, leg, ...] */
export const HORSE_MOVES: number[][] = [];
/** 상 이동: [to, 멱1, 멱2, ...] */
export const ELEPHANT_MOVES: number[][] = [];
for (let s = 0; s < NSQ; s++) {
  const r = rowOf(s);
  const c = colOf(s);
  const hm: number[] = [];
  const em: number[] = [];
  for (const [dr, dc] of DIRS) {
    const lr = r + dr;
    const lc = c + dc;
    if (!onBoard(lr, lc)) continue;
    const leg = sqOf(lr, lc);
    if (dr !== 0) {
      for (const sc of [-1, 1]) {
        if (onBoard(r + 2 * dr, c + sc)) hm.push(sqOf(r + 2 * dr, c + sc), leg);
        if (onBoard(r + 3 * dr, c + 2 * sc)) em.push(sqOf(r + 3 * dr, c + 2 * sc), leg, sqOf(r + 2 * dr, c + sc));
      }
    } else {
      for (const sr of [-1, 1]) {
        if (onBoard(r + sr, c + 2 * dc)) hm.push(sqOf(r + sr, c + 2 * dc), leg);
        if (onBoard(r + 2 * sr, c + 3 * dc)) em.push(sqOf(r + 2 * sr, c + 3 * dc), leg, sqOf(r + sr, c + 2 * dc));
      }
    }
  }
  HORSE_MOVES.push(hm);
  ELEPHANT_MOVES.push(em);
}

/** 졸(병) 이동 [side][sq] */
export const SOLDIER_MOVES: number[][][] = [[], []];
for (const side of [CHO, HAN]) {
  const fwd = side === CHO ? -1 : 1;
  for (let s = 0; s < NSQ; s++) {
    const r = rowOf(s);
    const c = colOf(s);
    const mv: number[] = [];
    if (onBoard(r + fwd, c)) mv.push(sqOf(r + fwd, c));
    if (c > 0) mv.push(sqOf(r, c - 1));
    if (c < COLS - 1) mv.push(sqOf(r, c + 1));
    // 상대 궁성 안에서는 선을 따라 앞쪽 대각선으로도 이동
    if (PALACE[s] === (side ^ 1)) {
      for (const d of PALACE_DIAG[s]) if (rowOf(d) === r + fwd) mv.push(d);
    }
    SOLDIER_MOVES[side].push(mv);
  }
}

// ---- 역방향 공격 테이블 (공격 판정용) ----
/** 이 칸을 공격할 수 있는 마의 위치: [from, leg, ...] */
export const HORSE_ATTACKERS: number[][] = Array.from({ length: NSQ }, () => []);
/** 이 칸을 공격할 수 있는 상의 위치: [from, b1, b2, ...] */
export const ELEPHANT_ATTACKERS: number[][] = Array.from({ length: NSQ }, () => []);
/** [side][sq] 이 칸을 공격할 수 있는 side 졸의 위치 */
export const SOLDIER_ATTACKERS: number[][][] = [
  Array.from({ length: NSQ }, () => []),
  Array.from({ length: NSQ }, () => []),
];
for (let s = 0; s < NSQ; s++) {
  const hm = HORSE_MOVES[s];
  for (let i = 0; i < hm.length; i += 2) HORSE_ATTACKERS[hm[i]].push(s, hm[i + 1]);
  const em = ELEPHANT_MOVES[s];
  for (let i = 0; i < em.length; i += 3) ELEPHANT_ATTACKERS[em[i]].push(s, em[i + 1], em[i + 2]);
  for (const side of [CHO, HAN]) {
    for (const t of SOLDIER_MOVES[side][s]) SOLDIER_ATTACKERS[side][t].push(s);
  }
}

// ---- 궁과 관계있는 칸 (합법성·장군 판정 생략용) ----
/**
 * KING_REL[k][s] = 1 이면, s 칸에서 기물이 떠나거나 들어올 때 k 칸의 궁에 대한 공격이 바뀔 수 있다.
 * (같은 가로·세로줄, 궁성 대각선, 마의 멱, 상의 길목)
 */
export const KING_REL: Uint8Array[] = Array.from({ length: NSQ }, () => new Uint8Array(NSQ));
/** KING_GIVES[k][s] = 1 이면, s 칸으로 오거나 떠나는 수가 k 칸 궁에게 장군이 될 수 있다 */
export const KING_GIVES: Uint8Array[] = Array.from({ length: NSQ }, () => new Uint8Array(NSQ));
for (let k = 0; k < NSQ; k++) {
  if (PALACE[k] < 0) continue;
  const rel = KING_REL[k];
  for (let s = 0; s < NSQ; s++) if (rowOf(s) === rowOf(k) || colOf(s) === colOf(k)) rel[s] = 1;
  for (const ray of DIAG_RAYS[k]) for (const s of ray) rel[s] = 1;
  const ha = HORSE_ATTACKERS[k];
  for (let i = 0; i < ha.length; i += 2) rel[ha[i + 1]] = 1;
  const ea = ELEPHANT_ATTACKERS[k];
  for (let i = 0; i < ea.length; i += 3) {
    rel[ea[i + 1]] = 1;
    rel[ea[i + 2]] = 1;
  }
  const gv = KING_GIVES[k];
  gv.set(rel);
  for (let i = 0; i < ha.length; i += 2) gv[ha[i]] = 1;
  for (let i = 0; i < ea.length; i += 3) gv[ea[i]] = 1;
  for (const d of PALACE_MOVES[k]) gv[d] = 1;
  for (const side of [CHO, HAN]) for (const s of SOLDIER_ATTACKERS[side][k]) gv[s] = 1;
}
