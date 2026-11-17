// 엔진 서비스: 워커(또는 메인 스레드)에서 요청을 처리한다
import { PASS, Side } from './constants';
import { Advice, PriorAnalysis, Review, analyzePosition, reviewMove } from './coach';
import { AiMoveResult, LevelId, chooseAiMove } from './levels';
import { Position } from './position';
import { Searcher } from './search';

interface Base {
  startFen: string;
  moves: number[];
  bikjang: boolean;
}

export type EngineRequest =
  | (Base & { kind: 'aiMove'; level: LevelId })
  | (Base & { kind: 'analyze'; timeMs: number; deomSide: Side })
  | (Base & { kind: 'review'; move: number; prior: PriorAnalysis | null; timeMs: number; deomSide: Side })
  | (Base & { kind: 'hint'; timeMs: number });

export type EngineResponse = AiMoveResult | Advice | Review | { move: number; score: number; pv: number[] };

function rebuild(startFen: string, moves: number[]): Position {
  const pos = Position.fromFen(startFen);
  for (const m of moves) {
    if (m !== PASS && !pos.isLegal(m)) throw new Error('기보 재생 실패: 잘못된 수');
    pos.makeMove(m);
  }
  return pos;
}

export class EngineService {
  private searcher: Searcher;
  constructor(ttBits = 20) {
    this.searcher = new Searcher(ttBits);
  }

  handle(req: EngineRequest): EngineResponse {
    const pos = rebuild(req.startFen, req.moves);
    switch (req.kind) {
      case 'aiMove':
        return chooseAiMove(this.searcher, pos, req.level, req.bikjang);
      case 'analyze':
        return analyzePosition(this.searcher, pos, { bikjang: req.bikjang, timeMs: req.timeMs, deomSide: req.deomSide });
      case 'review': {
        let prior = req.prior;
        if (!prior) {
          // 분석이 끝나기 전에 수를 둔 경우: 빠르게 최선수를 구한다
          const r = this.searcher.search(pos, { timeMs: req.timeMs * 0.5, bikjang: req.bikjang });
          prior = { bestMove: r.move, bestScore: r.score, top: [], depth: r.depth };
        }
        return reviewMove(this.searcher, pos, req.move, prior, {
          bikjang: req.bikjang,
          timeMs: req.timeMs,
          deomSide: req.deomSide,
        });
      }
      case 'hint': {
        const r = this.searcher.search(pos, { timeMs: req.timeMs, bikjang: req.bikjang });
        return { move: r.move, score: r.score, pv: r.pv };
      }
    }
  }
}
