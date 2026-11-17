import type { Side } from '../engine/constants';
import type { GameRules } from '../engine/game';
import type { LevelId } from '../engine/levels';
import type { Scenario } from '../scenarios';

export type Mode = 'ai' | 'teach' | 'scenario' | 'local';

export interface GameConfig {
  mode: Mode;
  startFen: string;
  /** 사용자가 두는 진영 (2인 대국에서는 아래쪽에 놓을 진영) */
  userSide: Side;
  level: LevelId;
  /** 매 수 조언 표시 */
  coach: boolean;
  /** 코치 분석 시간(ms) */
  coachTimeMs: number;
  rules: GameRules;
  title: string;
  scenario?: Scenario;
}

export interface Screen {
  el: HTMLElement;
  title: string;
  destroy?: () => void;
}
