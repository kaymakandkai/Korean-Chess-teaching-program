// 상황별 대국의 모든 연습 지형이 설명대로 성립하는지 엔진으로 검증
import { describe, expect, it } from 'vitest';
import { Position } from '../src/engine/position';
import { Searcher, isMateScore, mateIn } from '../src/engine/search';
import { validatePosition } from '../src/engine/setup';
import { SCENARIOS } from '../src/scenarios';

const S = new Searcher(18);

describe('연습 지형', () => {
  it('13개 이상, id 중복 없음', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(13);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
  });

  for (const sc of SCENARIOS) {
    it(`${sc.title} (${sc.goalText})`, () => {
      const pos = Position.fromFen(sc.fen);
      expect(validatePosition(pos)).toEqual([]);
      expect(pos.side).toBe(sc.userSide);
      const r = S.search(pos, { maxDepth: 12, bikjang: true });
      const g = sc.goal;
      if (g.type === 'mate') {
        expect(isMateScore(r.score) && r.score > 0).toBe(true);
        expect(mateIn(r.score)).toBe(g.within);
      } else if (g.type === 'material') {
        // 최선 수순이면 목표만큼 기물 이득 (졸=100, 1점=50)
        expect(r.score).toBeGreaterThan(g.gain * 50 - 150);
      } else if (g.type === 'survive') {
        // 최선의 수비로는 버틸 수 있고, 대부분의 수는 크게 진다
        expect(r.score).toBeGreaterThan(-200);
        let losing = 0;
        const legal = pos.legalMoves();
        for (const m of legal) {
          pos.makeMove(m);
          const rr = S.search(pos, { maxDepth: 7, bikjang: true }); // 시간 대신 깊이로 고정 (CPU 부하와 무관)
          pos.unmakeMove();
          if (-rr.score < -250) losing++;
        }
        expect(losing).toBeGreaterThanOrEqual(Math.floor(legal.length * 0.6));
      } else if (g.type === 'win') {
        expect(r.score).toBeGreaterThan(250);
      }
    });
  }
});
