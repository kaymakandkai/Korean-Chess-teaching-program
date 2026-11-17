// 초기 배치: 마상 차림, 기물 떼기, 선수 선택
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
  SOLDIER,
  Side,
  makePiece,
  sqOf,
} from './constants';
import { Position } from './position';

/** 마상 차림 (자기 진영에서 바라본 왼쪽→오른쪽 순서) */
export type Formation = '마상마상' | '상마상마' | '마상상마' | '상마마상';

export const FORMATIONS: { id: Formation; name: string; desc: string }[] = [
  { id: '마상마상', name: '마상마상', desc: '오른상 차림 — 양쪽 모두 상이 마의 오른쪽에 위치' },
  { id: '상마상마', name: '상마상마', desc: '왼상 차림 — 양쪽 모두 상이 마의 왼쪽에 위치' },
  { id: '마상상마', name: '마상상마', desc: '안상 차림 — 두 상이 모두 안쪽(사 옆)에 위치' },
  { id: '상마마상', name: '상마마상', desc: '바깥상 차림 — 두 상이 모두 바깥쪽(차 옆)에 위치' },
];

export interface SetupOptions {
  formations: [Formation, Formation]; // [초, 한]
  /** 떼고 시작할 기물 슬롯 키 [초, 한] */
  removed: [string[], string[]];
  first: Side;
}

export interface Slot {
  key: string; // 'R0' 'H1' 'P3' ...
  type: number;
  sq: number;
  label: string;
}

const LR = ['왼쪽', '오른쪽'];

/**
 * 진영별 기물 슬롯 목록.
 * 인덱스 0 = 그 진영 플레이어 입장에서 왼쪽.
 */
export function pieceSlots(side: Side, formation: Formation): Slot[] {
  const back = side === CHO ? 9 : 0;
  const kingRow = side === CHO ? 8 : 1;
  const cannonRow = side === CHO ? 7 : 2;
  const soldierRow = side === CHO ? 6 : 3;
  // 플레이어 입장 왼쪽→오른쪽 순서의 세로줄 (초: 0..8, 한: 8..0)
  const file = (i: number) => (side === CHO ? i : 8 - i);
  const slots: Slot[] = [];
  slots.push({ key: 'K', type: KING, sq: sqOf(kingRow, 4), label: '궁' });
  slots.push({ key: 'R0', type: CHARIOT, sq: sqOf(back, file(0)), label: `${LR[0]} 차` });
  slots.push({ key: 'R1', type: CHARIOT, sq: sqOf(back, file(8)), label: `${LR[1]} 차` });
  slots.push({ key: 'A0', type: GUARD, sq: sqOf(back, file(3)), label: `${LR[0]} 사` });
  slots.push({ key: 'A1', type: GUARD, sq: sqOf(back, file(5)), label: `${LR[1]} 사` });
  // 마상 차림: formation[0..3] -> 파일 1,2,6,7 (플레이어 기준)
  const fFiles = [1, 2, 6, 7];
  for (let i = 0; i < 4; i++) {
    const ch = formation[i];
    const half = i < 2 ? 0 : 1;
    if (ch === '마') {
      slots.push({ key: `H${half}`, type: HORSE, sq: sqOf(back, file(fFiles[i])), label: `${LR[half]} 마` });
    } else {
      slots.push({ key: `E${half}`, type: ELEPHANT, sq: sqOf(back, file(fFiles[i])), label: `${LR[half]} 상` });
    }
  }
  slots.push({ key: 'C0', type: CANNON, sq: sqOf(cannonRow, file(1)), label: `${LR[0]} 포` });
  slots.push({ key: 'C1', type: CANNON, sq: sqOf(cannonRow, file(7)), label: `${LR[1]} 포` });
  const pNames = ['1', '2', '3(중앙)', '4', '5'];
  for (let i = 0; i < 5; i++) {
    slots.push({
      key: `P${i}`,
      type: SOLDIER,
      sq: sqOf(soldierRow, file(i * 2)),
      label: `${side === CHO ? '졸' : '병'} ${pNames[i]}`,
    });
  }
  return slots;
}

/** 설정으로부터 시작 국면 생성 */
export function buildInitialPosition(opts: SetupOptions): Position {
  const pos = new Position();
  pos.board.fill(0);
  for (const side of [CHO, HAN] as Side[]) {
    const removed = new Set(opts.removed[side]);
    for (const slot of pieceSlots(side, opts.formations[side])) {
      if (slot.key !== 'K' && removed.has(slot.key)) continue;
      pos.board[slot.sq] = makePiece(side, slot.type);
    }
  }
  pos.side = opts.first;
  pos.sp = 0;
  pos.recompute();
  return pos;
}

export function initialFen(opts: SetupOptions): string {
  return buildInitialPosition(opts).toFen();
}

export const DEFAULT_SETUP: SetupOptions = {
  formations: ['마상마상', '마상마상'],
  removed: [[], []],
  first: CHO,
};

/** 떼기 프리셋 */
export const HANDICAP_PRESETS: { id: string; name: string; keys: string[] }[] = [
  { id: 'none', name: '없음', keys: [] },
  { id: 'R', name: '차 하나', keys: ['R0'] },
  { id: 'C', name: '포 하나', keys: ['C0'] },
  { id: 'H', name: '마 하나', keys: ['H0'] },
  { id: 'E', name: '상 하나', keys: ['E0'] },
  { id: 'RC', name: '차·포', keys: ['R0', 'C0'] },
  { id: 'RR', name: '양차', keys: ['R0', 'R1'] },
  { id: 'CC', name: '양포', keys: ['C0', 'C1'] },
  { id: 'HH', name: '양마', keys: ['H0', 'H1'] },
  { id: 'EE', name: '양상', keys: ['E0', 'E1'] },
];

/** 편집기·검증용: 국면이 규칙상 둘 수 있는 상태인지 */
export function validatePosition(pos: Position): string[] {
  const errors: string[] = [];
  const limits: Record<number, [number, string]> = {
    [KING]: [1, '궁'],
    [GUARD]: [2, '사'],
    [ELEPHANT]: [2, '상'],
    [HORSE]: [2, '마'],
    [CHARIOT]: [2, '차'],
    [CANNON]: [2, '포'],
    [SOLDIER]: [5, '졸(병)'],
  };
  for (const side of [CHO, HAN] as Side[]) {
    const sname = side === CHO ? '초' : '한';
    for (const t of [KING, GUARD, ELEPHANT, HORSE, CHARIOT, CANNON, SOLDIER]) {
      const n = pos.counts[makePiece(side, t)];
      if (n > limits[t][0]) errors.push(`${sname}의 ${limits[t][1]}이(가) ${limits[t][0]}개를 넘습니다.`);
    }
    if (pos.counts[makePiece(side, KING)] !== 1) errors.push(`${sname} 궁이 정확히 1개 있어야 합니다.`);
  }
  for (let s = 0; s < NSQ; s++) {
    const p = pos.board[s];
    if (!p) continue;
    const t = p & 7;
    const side = p >> 3;
    if (t === KING || t === GUARD) {
      const r = (s / 9) | 0;
      const c = s % 9;
      const inOwn = c >= 3 && c <= 5 && (side === CHO ? r >= 7 : r <= 2);
      if (!inOwn) errors.push(`${side === CHO ? '초' : '한'}의 ${t === KING ? '궁' : '사'}은(는) 자기 궁성 안에 있어야 합니다.`);
    }
  }
  if (!errors.length) {
    // 차례가 아닌 쪽이 장군을 받고 있으면 안 됨
    const notToMove = pos.side ^ 1;
    if (pos.inCheck(notToMove)) {
      errors.push(`${notToMove === CHO ? '초' : '한'}이(가) 차례가 아닌데 장군을 받고 있습니다. 차례를 바꾸거나 배치를 수정하세요.`);
    }
  }
  return errors;
}
