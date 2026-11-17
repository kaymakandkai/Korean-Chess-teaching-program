// 형세 평가 함수 (차례인 쪽 관점의 점수, 졸 = 100)
import { CANNON, CHARIOT, CHO, ELEPHANT, GUARD, HAN, HORSE, KING, NSQ, SOLDIER } from './constants';
import { Position } from './position';
import { DIAG_RAYS, ELEPHANT_MOVES, HORSE_MOVES, ORTHO_RAYS, PALACE } from './tables';

/** 평가 가중치 (자가대국 기보로 조정한 값) */
export const EW = {
  tempo: 5,
  hMob: 2,
  hMobBase: 0,
  hScale: 0,
  hZone: 14,
  eMob: 4,
  eMobBase: 23,
  eZone: 20,
  rMob: 6,
  rMobBase: 0,
  rZone: 18,
  cMob: 2,
  cMobBase: 16,
  cCap: 10,
  cScale: 0,
  cZone: 0,
  pConn: 13,
  pZone: 0,
  gMissBase: 5,
  gMissPow: 0,
  attOver: 10,
  attOverK: 4,
  cFile: 54,
  rFile: 20,
};

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

// 평가 캐시: 같은 국면을 다시 평가하지 않는다
const EC_BITS = 16;
const EC_MASK = (1 << EC_BITS) - 1;
const ecKeyLo = new Int32Array(1 << EC_BITS);
const ecKeyHi = new Int32Array(1 << EC_BITS);
const ecVal = new Int32Array(1 << EC_BITS);
const ecUsed = new Uint8Array(1 << EC_BITS);
/** 가중치를 바꾼 뒤 평가 캐시를 비운다 */
export function clearEvalCache() {
  ecUsed.fill(0);
}

/** 빠른 평가 — 탐색용 (차례인 쪽 관점) */
export function evaluate(pos: Position): number {
  const i = pos.hashLo & EC_MASK;
  let s: number;
  if (ecUsed[i] && ecKeyLo[i] === pos.hashLo && ecKeyHi[i] === pos.hashHi) s = ecVal[i];
  else {
    s = evalCho(pos, null);
    ecKeyLo[i] = pos.hashLo;
    ecKeyHi[i] = pos.hashHi;
    ecVal[i] = s;
    ecUsed[i] = 1;
  }
  return pos.side === CHO ? s + EW.tempo : -s + EW.tempo;
}

const mob = new Float64Array(2);
const safety = new Float64Array(2);
const struct = new Float64Array(2);
const attackers = new Float64Array(2); // side가 상대 궁 구역에 보낸 공격 점수

/** 초 관점 점수 (bd가 주어지면 항목별 내역 기록) */
export function evalCho(pos: Position, bd: EvalBreakdown | null): number {
  const b = pos.board;
  const counts = pos.counts;
  let nPieces = 0;
  for (let code = 1; code < 16; code++) {
    const t = code & 7;
    if (t !== KING && t !== 0) nPieces += counts[code];
  }

  mob.fill(0);
  safety.fill(0);
  struct.fill(0);
  attackers.fill(0);

  for (let side = 0; side < 2; side++) {
   const list = pos.plist[side];
   const cnt = pos.pcnt[side];
   for (let li = 0; li < cnt; li++) {
    const s = list[li];
    const p = b[s];
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
        mob[side] += cnt * EW.hMob - EW.hMobBase;
        // 기물 수가 줄어들수록 마의 가치 상승
        struct[side] += (22 - nPieces) * EW.hScale;
        if (KING_ZONE[enemy][s]) attackers[side] += EW.hZone;
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
        mob[side] += cnt * EW.eMob - EW.eMobBase;
        if (KING_ZONE[enemy][s]) attackers[side] += EW.eZone;
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
        mob[side] += cnt * EW.rMob - EW.rMobBase;
        if (KING_ZONE[enemy][s]) attackers[side] += EW.rZone;
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
              if (q >> 3 !== side && (q & 7) !== CANNON) cnt += EW.cCap;
              break;
            }
          }
        }
        mob[side] += cnt * EW.cMob - EW.cMobBase;
        // 기물이 줄어들수록 포의 가치 하락
        struct[side] += (nPieces - 20) * EW.cScale;
        if (KING_ZONE[enemy][s]) attackers[side] += EW.cZone;
        break;
      }
      case SOLDIER: {
        // 옆으로 이어진 졸은 서로를 지킨다
        const c = s % 9;
        if (c < 8 && b[s + 1] === p) struct[side] += EW.pConn;
        if (KING_ZONE[enemy][s] || PALACE[s] === enemy) attackers[side] += EW.pZone;
        break;
      }
      default:
        break;
    }
   }
  }

  // 궁 안전도
  for (const side of [CHO, HAN]) {
    const enemy = side ^ 1;
    const guards = counts[(side << 3) | GUARD];
    const eHi = enemy << 3;
    const enemyPower = counts[eHi | CHARIOT] * 3 + counts[eHi | CANNON] * 2 + counts[eHi | HORSE] * 2 + counts[eHi | SOLDIER] * 0.5;
    safety[side] -= (2 - guards) * (EW.gMissBase + enemyPower * EW.gMissPow);
    // 상대 기물이 궁 구역에 몰려 있으면 위험
    const att = attackers[enemy];
    safety[side] -= att + (att > EW.attOver ? ((att - EW.attOver) * EW.attOverK) / 10 : 0);
    // 궁의 세로줄 위의 상대 포 (사이 기물 2개 → 한 번에 장군 가능)
    const k = pos.kingSq[side];
    if (k >= 0) {
      const kr = (k / 9) | 0;
      const step = side === CHO ? -9 : 9;
      let between = 0;
      for (let q = k + step, r = kr + (side === CHO ? -1 : 1); r >= 0 && r <= 9; q += step, r += side === CHO ? -1 : 1) {
        const pc = b[q];
        if (!pc) continue;
        if (pc === (eHi | CANNON) && between === 2) safety[side] -= EW.cFile;
        if (pc === (eHi | CHARIOT) && between === 1) safety[side] -= EW.rFile;
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
