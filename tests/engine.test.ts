import { describe, expect, it } from 'vitest';
import { CHO, makeMove } from '../src/engine/constants';
import { analyzePosition, reviewMove } from '../src/engine/coach';
import { chooseAiMove } from '../src/engine/levels';
import { Position } from '../src/engine/position';
import { Searcher, isMateScore, mateIn } from '../src/engine/search';
import { DEFAULT_SETUP, buildInitialPosition } from '../src/engine/setup';
import { EngineService } from '../src/engine/service';
import { fenFromPieces } from '../src/scenarios';

const sq = (name: string) => ((Number(name[0]) + 9) % 10) * 9 + (Number(name[1]) - 1);
const mv = (a: string, b: string) => makeMove(sq(a), sq(b));

describe('탐색', () => {
  const S = new Searcher(18);
  it('1수 외통을 찾는다', () => {
    const pos = Position.fromFen(fenFromPieces(['K94', 'A04', 'P34', 'H44', 'R81'], ['K15', 'E17', 'H12', 'R01', 'P47'], CHO));
    const r = S.search(pos, { maxDepth: 4 });
    expect(r.move).toBe(mv('34', '25'));
    expect(mateIn(r.score)).toBe(1);
  });

  it('공짜 기물을 잡는다', () => {
    const pos = Position.fromFen(fenFromPieces(['K94', 'R51'], ['K15', 'A25', 'H58'], CHO));
    const r = S.search(pos, { maxDepth: 4 });
    expect(r.move).toBe(mv('51', '58'));
  });

  it('시간 제한을 지킨다', () => {
    const pos = buildInitialPosition(DEFAULT_SETUP);
    const t = Date.now();
    const r = S.search(pos, { timeMs: 400 });
    expect(Date.now() - t).toBeLessThan(1200);
    expect(r.depth).toBeGreaterThanOrEqual(3);
  });
});

describe('난이도', () => {
  it('모든 난이도가 합법수를 둔다', () => {
    const S = new Searcher(16);
    const pos = buildInitialPosition(DEFAULT_SETUP);
    for (const lv of ['beginner', 'novice', 'intermediate', 'advanced'] as const) {
      const r = chooseAiMove(S, pos, lv, true);
      expect(pos.isLegal(r.move)).toBe(true);
    }
  });

  it('고수 이상은 외통을 놓치지 않는다', () => {
    const S = new Searcher(16);
    const pos = Position.fromFen(fenFromPieces(['K94', 'A06', 'R55', 'H44'], ['K14', 'R81', 'C79', 'P73', 'P49'], CHO));
    for (const lv of ['intermediate', 'advanced'] as const) {
      expect(chooseAiMove(S, pos, lv, true).move).toBe(mv('55', '25'));
    }
  });
});

describe('교습 코치', () => {
  const S = new Searcher(18);
  const opts = { bikjang: true, timeMs: 800, deomSide: 1 as const };

  it('국면 분석: 추천수·이유·위험·몇 수 뒤', () => {
    const pos = buildInitialPosition(DEFAULT_SETUP);
    const a = analyzePosition(S, pos, opts);
    expect(a.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(a.recommendations[0].reasons.length).toBeGreaterThan(0);
    expect(a.situation.length).toBeGreaterThan(2);
    expect(a.dangers.length).toBeGreaterThan(0);
    expect(a.future.length).toBeGreaterThan(0);
    expect(a.tips.length).toBeGreaterThan(0);
    expect(pos.legalMoves()).toContain(a.bestMove);
  });

  it('공격받는 기물과 상대 노림수를 알려 준다', () => {
    // 초 차(55)가 한 마(34)에게 공격받음
    const pos = Position.fromFen(fenFromPieces(['K95', 'A04', 'R55'], ['K15', 'A14', 'H34'], CHO));
    const a = analyzePosition(S, pos, opts);
    expect(a.dangers.some((d) => d.text.includes('차(55)') && d.level === 'high')).toBe(true);
  });

  it('외통 위협을 경고한다', () => {
    const pos = Position.fromFen('4aa3/4k2c1/4r4/p1EC4p/2PP2p2/9/4R4/1C5h1/4AA3/5KE2 w');
    const a = analyzePosition(S, pos, opts);
    expect(a.dangers.some((d) => d.text.includes('외통'))).toBe(true);
  });

  it('외통을 놓친 수는 큰 실수로 평가한다', () => {
    const pos = Position.fromFen(fenFromPieces(['K94', 'A06', 'R55', 'H44'], ['K14', 'R81', 'C79', 'P73', 'P49'], CHO));
    const a = analyzePosition(S, pos, opts);
    expect(isMateScore(a.bestScore)).toBe(true);
    const bad = mv('94', '95');
    const rv = reviewMove(S, pos, bad, { bestMove: a.bestMove, bestScore: a.bestScore, top: a.top, depth: a.depth }, opts);
    expect(['mistake', 'blunder']).toContain(rv.quality);
    expect(rv.comments.join(' ')).toContain('외통');
    const good = reviewMove(S, pos, a.bestMove, { bestMove: a.bestMove, bestScore: a.bestScore, top: a.top, depth: a.depth }, opts);
    expect(good.quality).toBe('best');
  });

  it('엔진 서비스: 기보를 재생해 요청을 처리한다', () => {
    const svc = new EngineService(16);
    const fen = buildInitialPosition(DEFAULT_SETUP).toFen();
    const r = svc.handle({ kind: 'aiMove', startFen: fen, moves: [mv('79', '78')], level: 'novice', bikjang: true }) as { move: number };
    const pos = Position.fromFen(fen);
    pos.makeMove(mv('79', '78'));
    expect(pos.isLegal(r.move)).toBe(true);
  });
});
