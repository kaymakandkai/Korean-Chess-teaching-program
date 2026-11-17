import { describe, expect, it } from 'vitest';
import { CHO, HAN, PASS, makeMove } from '../src/engine/constants';
import { Game } from '../src/engine/game';
import { moveNotation, sqName } from '../src/engine/notation';
import { Position } from '../src/engine/position';
import { DEFAULT_SETUP, buildInitialPosition, pieceSlots, validatePosition } from '../src/engine/setup';
import { fenFromPieces } from '../src/scenarios';

/** 기보 좌표 → 칸 번호 ('95' → 초 궁 자리) */
const sq = (name: string) => ((Number(name[0]) + 9) % 10) * 9 + (Number(name[1]) - 1);
const mv = (a: string, b: string) => makeMove(sq(a), sq(b));
const targets = (pos: Position, from: string) =>
  pos
    .legalMoves()
    .filter((m) => m >> 7 === sq(from))
    .map((m) => sqName(m & 127))
    .sort();

function perft(pos: Position, d: number): number {
  if (d === 0) return 1;
  const ms = pos.legalMoves();
  if (d === 1) return ms.length;
  let n = 0;
  for (const m of ms) {
    pos.makeMove(m);
    n += perft(pos, d - 1);
    pos.unmakeMove();
  }
  return n;
}

describe('초기 배치', () => {
  it('기본 배치(마상마상)와 수 생성 개수', () => {
    const pos = buildInitialPosition(DEFAULT_SETUP);
    expect(pos.toFen()).toBe('reha1aehr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RHEA1AHER w');
    expect(perft(pos, 1)).toBe(31);
    expect(perft(pos, 2)).toBe(961);
    expect(perft(pos, 3)).toBe(30506);
  });

  it('수를 두고 무르면 해시와 국면이 복원된다', () => {
    const pos = buildInitialPosition(DEFAULT_SETUP);
    const fen = pos.toFen();
    const h = [pos.hashLo, pos.hashHi];
    perft(pos, 3);
    expect(pos.toFen()).toBe(fen);
    expect([pos.hashLo, pos.hashHi]).toEqual(h);
  });

  it('마상 차림은 각 진영의 플레이어 기준 왼쪽→오른쪽', () => {
    const pos = buildInitialPosition({ formations: ['상마상마', '마상상마'], removed: [[], []], first: CHO });
    // 초: 01~09 → 차 상 마 사 _ 사 상 마 차
    expect(pos.toFen().split(' ')[0].split('/')[9]).toBe('REHA1AEHR');
    // 한(위쪽)은 자기 왼쪽이 판의 오른쪽: 마상상마 → 판 왼쪽부터 차 마 상 사 _ 사 상 마 차
    expect(pos.toFen().split(' ')[0].split('/')[0]).toBe('rhea1aehr');
  });

  it('기물 떼기와 선수 선택', () => {
    const pos = buildInitialPosition({ formations: ['마상마상', '마상마상'], removed: [['R0', 'C1'], ['H0']], first: HAN });
    expect(pos.side).toBe(HAN);
    expect(pos.board[sq('01')]).toBe(0); // 초 왼쪽 차
    expect(pos.board[sq('88')]).toBe(0); // 초 오른쪽 포
    // 한의 왼쪽 마 = 판 오른쪽 (마상마상 → 18)
    expect(pos.board[sq('18')]).toBe(0);
    const slots = pieceSlots(HAN, '마상마상');
    expect(slots.find((s) => s.key === 'H0')!.sq).toBe(sq('18'));
  });
});

describe('기물 이동 규칙', () => {
  it('포는 다리를 하나 넘어야 하고, 포를 넘거나 잡을 수 없다', () => {
    // 초 포 85, 다리 졸 65 → 45 칸 이동 가능 / 한 포가 다리면 넘지 못함
    let pos = Position.fromFen(fenFromPieces(['K94', 'C85', 'P65'], ['K16', 'P25'], CHO));
    expect(targets(pos, '85')).toEqual(['25', '35', '45', '55']);
    pos = Position.fromFen(fenFromPieces(['K94', 'C85', 'C65'], ['K16', 'P25'], CHO));
    expect(targets(pos, '85')).toEqual([]); // 포는 포를 넘지 못함
    pos = Position.fromFen(fenFromPieces(['K94', 'C85', 'P65'], ['K16', 'C45'], CHO));
    expect(targets(pos, '85')).toEqual(['55']); // 포는 포를 잡지 못함 (45로는 못 감)
  });

  it('마는 멱이 막히면 그 방향으로 못 간다', () => {
    let pos = Position.fromFen(fenFromPieces(['K94', 'H55'], ['K16'], CHO));
    expect(targets(pos, '55').length).toBe(8);
    pos = Position.fromFen(fenFromPieces(['K94', 'H55', 'P45'], ['K16'], CHO));
    expect(targets(pos, '55')).not.toContain('34');
    expect(targets(pos, '55')).not.toContain('36');
    expect(targets(pos, '55').length).toBe(6);
  });

  it('상은 지나가는 두 칸이 모두 비어야 한다', () => {
    let pos = Position.fromFen(fenFromPieces(['K94', 'E55'], ['K16'], CHO));
    expect(targets(pos, '55')).toContain('23');
    pos = Position.fromFen(fenFromPieces(['K94', 'E55', 'P34'], ['K16'], CHO));
    expect(targets(pos, '55')).not.toContain('23');
  });

  it('졸은 뒤로 못 가고, 상대 궁성 안에서는 대각선 앞으로 간다', () => {
    let pos = Position.fromFen(fenFromPieces(['K94', 'P55'], ['K16'], CHO));
    expect(targets(pos, '55')).toEqual(['45', '54', '56']);
    pos = Position.fromFen(fenFromPieces(['K94', 'P34'], ['K16'], CHO));
    expect(targets(pos, '34')).toEqual(['24', '25', '33', '35']);
    // 한 병은 아래로
    pos = Position.fromFen(fenFromPieces(['K94'], ['K16', 'P55'], HAN));
    expect(targets(pos, '55')).toEqual(['54', '56', '65']);
  });

  it('궁·사는 궁성 안에서 선을 따라 움직인다', () => {
    const pos = Position.fromFen(fenFromPieces(['K95', 'A04'], ['K16'], CHO));
    expect(targets(pos, '95')).toEqual(['84', '85', '86', '94', '96', '05', '06'].sort());
    expect(targets(pos, '04')).toEqual(['05', '94']);
    const pos2 = Position.fromFen(fenFromPieces(['K85'], ['K16'], CHO));
    expect(targets(pos2, '85')).toEqual(['84', '86', '95']); // 변의 가운데에는 대각선이 없다
  });

  it('차와 포는 궁성 대각선을 따라 움직인다', () => {
    let pos = Position.fromFen(fenFromPieces(['K94', 'R34'], ['K15'], CHO));
    expect(targets(pos, '34')).toContain('25');
    expect(targets(pos, '34')).toContain('16');
    pos = Position.fromFen(fenFromPieces(['K94', 'R34', 'P25'], ['K15'], CHO));
    expect(targets(pos, '34')).not.toContain('16'); // 중앙이 막히면 대각선 끝까지 못 감
    pos = Position.fromFen(fenFromPieces(['K94', 'C34', 'P25'], ['K15'], CHO));
    expect(targets(pos, '34')).toContain('16'); // 포는 궁성 중앙을 다리로 대각선을 넘는다
  });
});

describe('장군·외통·빅장', () => {
  it('장군을 받으면 장군을 피하는 수만 둘 수 있다', () => {
    const pos = Position.fromFen(fenFromPieces(['K95', 'R01'], ['K15', 'R91'], CHO));
    expect(pos.inCheck()).toBe(true);
    for (const m of pos.legalMoves()) {
      pos.makeMove(m);
      expect(pos.inCheck(CHO)).toBe(false);
      pos.unmakeMove();
    }
  });

  it('외통이면 대국이 끝난다', () => {
    const fen = fenFromPieces(['K94', 'A06', 'R55', 'H44'], ['K14', 'R81', 'C79', 'P73', 'P49'], CHO);
    const g = new Game(fen, { bikjang: true, moveLimit: 0 });
    g.play(mv('55', '25'));
    expect(g.result?.reason).toBe('외통');
    expect(g.result?.winner).toBe(CHO);
  });

  it('빅장: 피하지 않으면 무승부', () => {
    const fen = fenFromPieces(['K94', 'A04'], ['K15', 'A14'], CHO);
    const g = new Game(fen, { bikjang: true, moveLimit: 0 });
    const rec = g.play(mv('94', '95')); // 궁이 마주봄
    expect(rec.bikjangCall).toBe(true);
    g.play(mv('14', '24')); // 피하지 않음
    expect(g.result?.reason).toBe('빅장');
    expect(g.result?.winner).toBeNull();
  });

  it('빅장 규칙을 끄면 계속 둔다', () => {
    const fen = fenFromPieces(['K94', 'A04'], ['K15', 'A14'], CHO);
    const g = new Game(fen, { bikjang: false, moveLimit: 0 });
    g.play(mv('94', '95'));
    g.play(mv('14', '24'));
    expect(g.result).toBeNull();
  });

  it('장군 중에는 한수 쉼을 할 수 없고, 양쪽이 연속으로 쉬면 점수 판정', () => {
    const g = new Game(buildInitialPosition(DEFAULT_SETUP).toFen(), { bikjang: true, moveLimit: 0 });
    expect(g.canPass()).toBe(true);
    g.play(PASS);
    g.play(PASS);
    expect(g.result?.reason).toBe('점수 판정');
    expect(g.result?.winner).toBe(HAN); // 덤 1.5
  });

  it('같은 국면이 세 번 나오면 무승부', () => {
    const g = new Game(buildInitialPosition(DEFAULT_SETUP).toFen(), { bikjang: true, moveLimit: 0 });
    for (let i = 0; i < 2; i++) {
      g.play(mv('02', '83'));
      g.play(mv('13', '34'));
      g.play(mv('83', '02'));
      g.play(mv('34', '13'));
    }
    expect(g.result?.reason).toBe('동형 반복');
  });

  it('무르기', () => {
    const g = new Game(buildInitialPosition(DEFAULT_SETUP).toFen(), { bikjang: true, moveLimit: 0 });
    const fen = g.pos.toFen();
    g.play(mv('02', '83'));
    g.play(mv('13', '34'));
    g.undo(2);
    expect(g.pos.toFen()).toBe(fen);
    expect(g.records.length).toBe(0);
  });
});

describe('표기와 검증', () => {
  it('기보 표기', () => {
    const pos = buildInitialPosition(DEFAULT_SETUP);
    expect(moveNotation(pos.board, mv('79', '78'))).toBe('79졸78');
    expect(moveNotation(pos.board, mv('02', '83'))).toBe('02마83');
  });

  it('배치 검증', () => {
    expect(validatePosition(Position.fromFen(fenFromPieces(['K95'], ['K15'], CHO)))).toEqual([]);
    expect(validatePosition(Position.fromFen(fenFromPieces(['K55'], ['K15'], CHO))).length).toBeGreaterThan(0);
    expect(validatePosition(Position.fromFen(fenFromPieces(['K95', 'A55'], ['K15'], CHO))).length).toBeGreaterThan(0);
    // 차례가 아닌 쪽이 장군을 받고 있으면 안 됨
    expect(validatePosition(Position.fromFen(fenFromPieces(['K94', 'R25'], ['K15'], CHO))).length).toBeGreaterThan(0);
  });
});
