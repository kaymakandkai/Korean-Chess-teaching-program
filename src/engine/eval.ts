// 형세 평가 함수 (차례인 쪽 관점의 점수, 졸 = 100)
import { CANNON, CHARIOT, CHO, ELEPHANT, GUARD, HAN, HORSE, KING, NSQ, SOLDIER } from './constants';
import { Position } from './position';
import { DIAG_RAYS, ELEPHANT_MOVES, HORSE_MOVES, ORTHO_RAYS, PALACE } from './tables';

const TEMPO = 12;

/** 진영 side 궁 주변 위험 구역 여부 (궁성 + 앞 한 줄, 세로줄 2~6) */
const KING_ZONE: Uint8Array[] = [new Uint8Array(NSQ), new Uint8Array(NSQ)];
for (let s = 0; s < NSQ; s++) {
  const r = (s / 9) | 0;
  const c = s % 9;
  if (c >= 2 && c <= 6) {
    if (r >= 6) KING_ZONE[CHO][s] = 1;
    if (r <= 3) KING_ZONE[HAN][s] = 1;
  }
}

export interface EvalBreakdown {
  psq: [number, number];
  mobility: [number, number];
  kingSafety: [number, number];
  structure: [number, number];
  total: number; // 초 관점
}

/** 빠른 평가 — 탐색용 */
export function evaluate(pos: Position): number {
  const s = evalCho(pos, null);
  return pos.side === CHO ? s + TEMPO : -s + TEMPO;
}

/** 초 관점 점수 (bd가 주어지면 항목별 내역 기록) */
export function evalCho(pos: Position, bd: EvalBreakdown | null): number {
  const b = pos.board;
  const counts = pos.counts;
  let nPieces = 0;
  for (let code = 1; code < 16; code++) {
    const t = code & 7;
    if (t !== KING && t !== 0) nPieces += counts[code];
  }

  const mob = [0, 0];
  const safety = [0, 0];
  const struct = [0, 0];
  const attackers = [0, 0]; // side가 상대 궁 구역에 보낸 공격 점수

  for (let s = 0; s < NSQ; s++) {
    const p = b[s];
    if (!p) continue;
    const side = p >> 3;
    const t = p & 7;
    const enemy = side ^ 1;
    switch (t) {
      case HORSE: {
        const mv = HORSE_MOVES[s];
        let cnt = 0;
        for (let i = 0; i < mv.length; i += 2) {
          if (b[mv[i + 1]] !== 0) continue;
          const q = b[mv[i]];
          if (q === 0 || q >> 3 !== side) cnt++;
        }
        mob[side] += cnt * 4 - 8;
        // 기물 수가 줄어들수록 마의 가치 상승
        struct[side] += (22 - nPieces) * 2;
        if (KING_ZONE[enemy][s]) attackers[side] += 14;
        break;
      }
      case ELEPHANT: {
        const mv = ELEPHANT_MOVES[s];
        let cnt = 0;
        for (let i = 0; i < mv.length; i += 3) {
          if (b[mv[i + 1]] !== 0 || b[mv[i + 2]] !== 0) continue;
          const q = b[mv[i]];
          if (q === 0 || q >> 3 !== side) cnt++;
        }
        mob[side] += cnt * 2 - 4;
        if (KING_ZONE[enemy][s]) attackers[side] += 8;
        break;
      }
      case CHARIOT: {
        let cnt = 0;
        const rays = ORTHO_RAYS[s];
        for (let d = 0; d < rays.length; d++) {
          const ray = rays[d];
          for (let i = 0; i < ray.length; i++) {
            const q = b[ray[i]];
            if (q === 0) cnt++;
            else {
              if (q >> 3 !== side) cnt++;
              break;
            }
          }
        }
        const dr = DIAG_RAYS[s];
        for (let d = 0; d < dr.length; d++) {
          const ray = dr[d];
          for (let i = 0; i < ray.length; i++) {
            const q = b[ray[i]];
            if (q === 0) cnt++;
            else {
              if (q >> 3 !== side) cnt++;
              break;
            }
          }
        }
        mob[side] += cnt * 2 - 12;
        if (KING_ZONE[enemy][s]) attackers[side] += 24;
        break;
      }
      case CANNON: {
        // 다리가 없는 포는 약하다
        let cnt = 0;
        const rays = ORTHO_RAYS[s];
        for (let d = 0; d < rays.length; d++) {
          const ray = rays[d];
          let i = 0;
          while (i < ray.length && b[ray[i]] === 0) i++;
          if (i >= ray.length || (b[ray[i]] & 7) === CANNON) continue;
          for (i++; i < ray.length; i++) {
            const q = b[ray[i]];
            if (q === 0) cnt++;
            else {
              if (q >> 3 !== side && (q & 7) !== CANNON) cnt += 2;
              break;
            }
          }
        }
        mob[side] += cnt * 2 - 6;
        // 기물이 줄어들수록 포의 가치 하락
        struct[side] += (nPieces - 20) * 4;
        if (KING_ZONE[enemy][s]) attackers[side] += 12;
        break;
      }
      case SOLDIER: {
        // 옆으로 이어진 졸은 서로를 지킨다
        const c = s % 9;
        if (c < 8 && b[s + 1] === p) struct[side] += 10;
        if (KING_ZONE[enemy][s] || PALACE[s] === enemy) attackers[side] += 14;
        break;
      }
      default:
        break;
    }
  }

  // 궁 안전도
  for (const side of [CHO, HAN]) {
    const enemy = side ^ 1;
    const guards = counts[(side << 3) | GUARD];
    const eHi = enemy << 3;
    const enemyPower = counts[eHi | CHARIOT] * 3 + counts[eHi | CANNON] * 2 + counts[eHi | HORSE] * 2 + counts[eHi | SOLDIER] * 0.5;
    safety[side] -= (2 - guards) * (8 + enemyPower * 4);
    // 상대 기물이 궁 구역에 몰려 있으면 위험
    const att = attackers[enemy];
    safety[side] -= att + (att > 30 ? (att - 30) * 0.8 : 0);
    // 궁의 세로줄 위의 상대 포 (사이 기물 2개 → 한 번에 장군 가능)
    const k = pos.kingSq[side];
    if (k >= 0) {
      const kr = (k / 9) | 0;
      const step = side === CHO ? -9 : 9;
      let between = 0;
      for (let q = k + step, r = kr + (side === CHO ? -1 : 1); r >= 0 && r <= 9; q += step, r += side === CHO ? -1 : 1) {
        const pc = b[q];
        if (!pc) continue;
        if (pc === (eHi | CANNON) && between === 2) safety[side] -= 18;
        if (pc === (eHi | CHARIOT) && between === 1) safety[side] -= 14;
        between++;
        if (between > 2) break;
      }
    }
  }

  const score =
    pos.psq[CHO] - pos.psq[HAN] + (mob[CHO] - mob[HAN]) + (safety[CHO] - safety[HAN]) + Math.round(struct[CHO] - struct[HAN]);

  if (bd) {
    bd.psq = [pos.psq[CHO], pos.psq[HAN]];
    bd.mobility = [mob[CHO], mob[HAN]];
    bd.kingSafety = [Math.round(safety[CHO]), Math.round(safety[HAN])];
    bd.structure = [Math.round(struct[CHO]), Math.round(struct[HAN])];
    bd.total = Math.round(score);
  }
  return Math.round(score);
}

/** 상대 궁 구역 공격 점수 계산 (교습용) */
export function kingZoneOf(side: number): Uint8Array {
  return KING_ZONE[side];
}
