// AI 난이도: 탐색 깊이·시간·실수 확률로 급수를 흉내낸다
import { PASS } from './constants';
import { Position } from './position';
import { SearchResult, Searcher, isMateScore } from './search';

export type LevelId = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'expert' | 'legend';

export interface Level {
  id: LevelId;
  name: string;
  grade: string;
  desc: string;
  /** 고정 깊이 (noise > 0 인 단계에서 사용) */
  depth: number;
  /** 최대 생각 시간(ms) */
  timeMs: number;
  /** 수 선택 시 점수에 더하는 무작위 잡음의 크기 (졸=100) */
  noise: number;
  /** 아무 수나 둘 확률 */
  blunder: number;
  /** 실수할 때 허용하는 최대 손해 */
  blunderMax: number;
}

export const LEVELS: Level[] = [
  {
    id: 'beginner',
    name: '초보',
    grade: '17급',
    desc: '규칙을 막 익힌 수준. 한 수 앞만 보고, 자주 기물을 흘립니다.',
    depth: 1,
    timeMs: 400,
    noise: 170,
    blunder: 0.3,
    blunderMax: 100000,
  },
  {
    id: 'novice',
    name: '하수',
    grade: '13급',
    desc: '눈앞의 기물은 잡지만 상대의 노림수를 자주 놓칩니다.',
    depth: 2,
    timeMs: 600,
    noise: 85,
    blunder: 0.12,
    blunderMax: 700,
  },
  {
    id: 'intermediate',
    name: '중수',
    grade: '8급',
    desc: '두세 수 앞을 내다보며 기본 전술을 씁니다. 가끔 실수합니다.',
    depth: 3,
    timeMs: 900,
    noise: 35,
    blunder: 0.04,
    blunderMax: 350,
  },
  {
    id: 'advanced',
    name: '고수',
    grade: '2급',
    desc: '전술에 강하고 기물 교환 판단이 정확합니다.',
    depth: 5,
    timeMs: 1500,
    noise: 10,
    blunder: 0,
    blunderMax: 0,
  },
  {
    id: 'expert',
    name: '초고수',
    grade: '2단',
    desc: '깊이 읽고 실수가 거의 없습니다. 작은 우세도 놓치지 않습니다.',
    depth: 0,
    timeMs: 3000,
    noise: 0,
    blunder: 0,
    blunderMax: 0,
  },
  {
    id: 'legend',
    name: '전설',
    grade: '9단',
    desc: '수십만~수백만 가지 경우의 수를 매 수 계산합니다. 사람이 이기기 어려운 수준입니다.',
    depth: 0,
    timeMs: 8000,
    noise: 0,
    blunder: 0,
    blunderMax: 0,
  },
];

export function getLevel(id: LevelId): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[2];
}

export interface AiMoveResult extends SearchResult {
  levelId: LevelId;
  note?: string;
}

function gaussian(rng: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 난이도에 맞춰 AI의 수를 고른다 */
export function chooseAiMove(
  searcher: Searcher,
  pos: Position,
  levelId: LevelId,
  bikjang: boolean,
  rng: () => number = Math.random,
): AiMoveResult {
  const level = getLevel(levelId);
  if (level.noise <= 0) {
    const res = searcher.search(pos, { timeMs: level.timeMs, maxDepth: 40, bikjang, allowPass: true });
    // 한수 쉼은 다른 수보다 확실히 좋을 때만 (어색한 쉼 방지)
    if (res.move === PASS && pos.legalMoves().length > 0) {
      const alt = searcher.search(pos, { timeMs: level.timeMs / 3, maxDepth: 40, bikjang, excludeRoot: [PASS] });
      if (alt.move && alt.score > res.score - 30) return { ...alt, levelId };
    }
    return { ...res, levelId };
  }

  const margin = Math.max(level.noise * 4, level.blunderMax > 0 ? Math.min(level.blunderMax, 1500) : 0, 150);
  const { base, scored } = searcher.scoreRootMoves(pos, level.depth, margin, {
    timeMs: level.timeMs,
    bikjang,
  });
  if (!scored.length) return { ...base, levelId };

  // 외통이 보이면 (초보가 아니면) 놓치지 않는다
  if (isMateScore(base.score) && base.score > 0 && level.id !== 'beginner') return { ...base, levelId };

  if (rng() < level.blunder) {
    const pool = scored.filter((s) => base.score - s.score <= level.blunderMax);
    if (pool.length) {
      const pick = pool[Math.floor(rng() * pool.length)];
      return { ...base, move: pick.move, score: pick.score, pv: [pick.move], levelId, note: '실수' };
    }
  }
  let best = scored[0];
  let bestV = -Infinity;
  for (const s of scored) {
    const v = s.score + gaussian(rng) * level.noise;
    if (v > bestV) {
      bestV = v;
      best = s;
    }
  }
  return { ...base, move: best.move, score: best.score, pv: best.move === base.move ? base.pv : [best.move], levelId };
}
