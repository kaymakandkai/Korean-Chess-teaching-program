// 상황별 대국: 연습 지형 목록 · 상세 · 직접 배치(편집기)
import {
  CANNON,
  CHARIOT,
  CHO,
  ELEPHANT,
  GUARD,
  HAN,
  HORSE,
  KING,
  SOLDIER,
  Side,
  makePiece,
} from '../engine/constants';
import { LevelId, getLevel } from '../engine/levels';
import { pieceName } from '../engine/notation';
import { Position } from '../engine/position';
import { DEFAULT_SETUP, buildInitialPosition, validatePosition } from '../engine/setup';
import { SCENARIOS, Scenario } from '../scenarios';
import type { App } from './app';
import { BoardView, pieceSvg } from './board';
import { h, s, segmented } from './dom';
import { gameScreen } from './gameView';
import { field, levelPicker } from './setup';
import { loadPref, savePref } from './settings';
import type { GameConfig, Screen } from './types';

const CATS = ['전체', '외통 연습', '전술', '수비', '종반', '대국'] as const;

function stars(n: number) {
  return h('span', { class: 'stars', 'aria-label': `난이도 ${n}` }, '★'.repeat(n), h('span', { class: 'dim' }, '★'.repeat(3 - n)));
}

function miniBoard(fen: string, flipped: boolean) {
  const b = new BoardView({ label: '국면 미리보기' });
  b.render({ board: Position.fromFen(fen).board, flipped });
  b.el.classList.add('mini');
  return b.el;
}

export function scenarioListScreen(app: App): Screen {
  let cat: (typeof CATS)[number] = '전체';
  const grid = h('div', { class: 'scn-grid' });
  const renderGrid = () => {
    const items = SCENARIOS.filter((sc) => cat === '전체' || sc.category === cat);
    grid.replaceChildren(
      ...items.map((sc) =>
        h(
          'button',
          { class: 'scn-card', onclick: () => app.go(() => scenarioDetailScreen(app, sc)) },
          miniBoard(sc.fen, sc.userSide === HAN),
          h(
            'div',
            { class: 'scn-info' },
            h('div', { class: 'scn-top' }, h('span', { class: 'scn-cat' }, sc.category), stars(sc.stars)),
            h('div', { class: 'scn-title' }, sc.title),
            h('div', { class: 'scn-sum' }, sc.summary),
            h('div', { class: 'scn-goal' }, `목표: ${sc.goalText}`),
          ),
        ),
      ),
    );
  };
  const chips = segmented(
    CATS.map((c) => ({ value: c, label: c })),
    cat,
    (v) => {
      cat = v;
      renderGrid();
    },
    'chips',
  );
  renderGrid();
  const el = h(
    'div',
    { class: 'scenarios' },
    h(
      'button',
      { class: 'editor-cta', onclick: () => app.go(() => editorScreen(app)) },
      h('div', { class: 'cta-icon', 'aria-hidden': 'true' }, '✎'),
      h(
        'div',
        null,
        h('div', { class: 'cta-title' }, '직접 배치하기'),
        h('div', { class: 'cta-sub' }, '원하는 자리에 말을 놓고, 진영·차례·AI 난이도를 골라 그 장면부터 둡니다.'),
      ),
      h('span', { class: 'cta-arrow', 'aria-hidden': 'true' }, '›'),
    ),
    h('div', { class: 'section-head' }, h('h2', null, '연습 지형'), chips),
    grid,
  );
  return { el, title: '상황별 대국' };
}

function scenarioDetailScreen(app: App, sc: Scenario): Screen {
  let userSide: Side = sc.userSide;
  let level: LevelId = sc.level;
  let coach = true;
  const boardWrap = h('div', { class: 'preview-wrap big' });
  const sideNote = h('div', { class: 'field-help' });
  const refresh = () => {
    boardWrap.replaceChildren(miniBoard(sc.fen, userSide === HAN));
    sideNote.textContent =
      userSide === sc.userSide ? '' : '진영을 바꾸면 목표 없이 자유롭게 둡니다. 연습 목표는 기본 진영에서만 확인됩니다.';
  };
  refresh();
  const toMove = Position.fromFen(sc.fen).side;
  const el = h(
    'div',
    { class: 'scn-detail' },
    h('div', { class: 'scn-detail-board' }, boardWrap),
    h(
      'div',
      { class: 'scn-detail-info' },
      h('div', { class: 'scn-top' }, h('span', { class: 'scn-cat' }, sc.category), stars(sc.stars)),
      h('h2', null, sc.title),
      h('p', null, sc.summary),
      h('div', { class: 'goal-text big' }, `목표: ${sc.goalText}`),
      h('p', { class: 'muted' }, `${toMove === CHO ? '초' : '한'}이(가) 둘 차례로 시작합니다.`),
      h('details', { class: 'goal-lesson' }, h('summary', null, '이 지형에서 배우는 것'), h('p', null, sc.lesson)),
      h(
        'section',
        { class: 'card' },
        field(
          '내 진영',
          segmented(
            [
              { value: CHO as Side, label: '초', sub: sc.userSide === CHO ? '권장' : '' },
              { value: HAN as Side, label: '한', sub: sc.userSide === HAN ? '권장' : '' },
            ],
            userSide,
            (v) => {
              userSide = v;
              refresh();
            },
            'side',
          ),
        ),
        sideNote,
        field(
          '교습 조언',
          segmented(
            [
              { value: 1, label: '켜기', sub: '매 수 코치 조언' },
              { value: 0, label: '끄기', sub: '스스로 풀기' },
            ],
            1,
            (v) => (coach = v === 1),
          ),
        ),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, '상대 AI 난이도'), levelPicker(level, (v) => (level = v))),
      ),
      h(
        'div',
        { class: 'start-row' },
        h(
          'button',
          {
            class: 'btn primary big',
            onclick: () => {
              const lv = getLevel(level);
              const cfg: GameConfig = {
                mode: 'scenario',
                startFen: sc.fen,
                userSide,
                level,
                coach,
                coachTimeMs: 1500,
                rules: { bikjang: true, moveLimit: 0 },
                title: `${sc.title} · ${lv.name}`,
                scenario: sc,
              };
              app.go(() => gameScreen(app, cfg));
            },
          },
          '연습 시작',
        ),
      ),
    ),
  );
  return { el, title: sc.title };
}

// ------------------------------------------------------------------ 편집기

interface EditorState {
  fen: string;
  toMove: Side;
  userSide: Side;
  level: LevelId;
  coach: boolean;
  bikjang: boolean;
}

const PALETTE = [KING, GUARD, ELEPHANT, HORSE, CHARIOT, CANNON, SOLDIER];

function editorScreen(app: App): Screen {
  const initFen = buildInitialPosition(DEFAULT_SETUP).toFen();
  const st: EditorState = loadPref('editor', {
    fen: initFen,
    toMove: CHO as Side,
    userSide: CHO as Side,
    level: 'intermediate' as LevelId,
    coach: true,
    bikjang: true,
  });
  let pos: Position;
  try {
    pos = Position.fromFen(st.fen);
  } catch {
    pos = Position.fromFen(initFen);
  }
  let tool: number = makePiece(CHO, CHARIOT); // 0 = 지우개
  let hover: number | null = null;
  const board = new BoardView({ interactive: true, label: '배치 편집 판' });
  const errorsEl = h('div', { class: 'editor-errors' });
  const palette = h('div', { class: 'palette' });
  const startBtn = h('button', { class: 'btn primary big' }, '이 배치로 시작') as HTMLButtonElement;

  const commit = () => {
    pos.side = st.toMove;
    pos.recompute();
    st.fen = pos.toFen();
    savePref('editor', st);
    board.render({ board: pos.board, flipped: st.userSide === HAN, hover });
    const errs = validatePosition(pos);
    if (!errs.length && pos.legalMoves().length === 0) errs.push('차례인 쪽이 이미 외통입니다. 배치를 바꿔 주세요.');
    errorsEl.replaceChildren(
      ...(errs.length ? errs.map((e) => h('div', { class: 'err' }, '⚠ ', e)) : [h('div', { class: 'ok' }, '✓ 둘 수 있는 배치입니다.')]),
    );
    startBtn.disabled = errs.length > 0;
    renderPalette();
  };

  const renderPalette = () => {
    const btn = (code: number, label: string) => {
      const on = tool === code;
      const b = h('button', { class: `pal-btn ${on ? 'on' : ''}`, title: label, 'aria-label': label, onclick: () => ((tool = code), renderPalette()) });
      if (code) {
        const sv = s('svg', { viewBox: '-52 -52 104 104' });
        sv.append(pieceSvg(code));
        b.append(sv);
        const count = pos.counts[code];
        b.append(h('span', { class: 'pal-count' }, String(count)));
      } else b.append(h('span', { class: 'eraser' }, '지우개'));
      return b;
    };
    palette.replaceChildren(
      h('div', { class: 'pal-row' }, h('span', { class: 'pal-label cho' }, '초'), ...PALETTE.map((t) => btn(makePiece(CHO, t), `초 ${pieceName(makePiece(CHO, t))}`))),
      h('div', { class: 'pal-row' }, h('span', { class: 'pal-label han' }, '한'), ...PALETTE.map((t) => btn(makePiece(HAN, t), `한 ${pieceName(makePiece(HAN, t))}`))),
      h('div', { class: 'pal-row' }, btn(0, '지우개')),
    );
  };

  board.onClick = (sq) => {
    const cur = pos.board[sq];
    if (tool === 0 || cur === tool) pos.board[sq] = 0;
    else {
      // 궁은 하나만: 기존 궁을 옮긴다
      if ((tool & 7) === KING) {
        for (let i = 0; i < 90; i++) if (pos.board[i] === tool) pos.board[i] = 0;
      }
      pos.board[sq] = tool;
    }
    commit();
  };
  board.onHover = (sq) => {
    if (sq === hover) return;
    hover = sq;
    board.render({ board: pos.board, flipped: st.userSide === HAN, hover });
  };

  startBtn.addEventListener('click', () => {
    const lv = getLevel(st.level);
    const cfg: GameConfig = {
      mode: 'scenario',
      startFen: pos.toFen(),
      userSide: st.userSide,
      level: st.level,
      coach: st.coach,
      coachTimeMs: 1500,
      rules: { bikjang: st.bikjang, moveLimit: 0 },
      title: `직접 배치 · ${lv.name}`,
    };
    app.go(() => gameScreen(app, cfg));
  });

  const tools = h(
    'div',
    { class: 'editor-tools' },
    h('button', { class: 'btn small', onclick: () => ((pos = Position.fromFen(initFen)), commit()) }, '기본 배치'),
    h(
      'button',
      {
        class: 'btn small',
        onclick: () => {
          pos.board.fill(0);
          pos.board[8 * 9 + 4] = makePiece(CHO, KING); // 95
          pos.board[1 * 9 + 3] = makePiece(HAN, KING); // 24
          commit();
        },
      },
      '궁만 남기기',
    ),
    h('button', { class: 'btn small', onclick: () => (pos.board.fill(0), commit()) }, '모두 지우기'),
  );

  const el = h(
    'div',
    { class: 'editor' },
    h('div', { class: 'editor-board' }, h('div', { class: 'preview-wrap big' }, board.el), tools),
    h(
      'div',
      { class: 'editor-side' },
      h('section', { class: 'card' }, h('h3', null, '말 고르기'), h('p', { class: 'muted small' }, '말을 고른 뒤 판의 점을 누르세요. 같은 말을 다시 누르면 지워집니다.'), palette),
      h(
        'section',
        { class: 'card' },
        h('h3', null, '대국 조건'),
        field(
          '먼저 둘 쪽',
          segmented(
            [
              { value: CHO as Side, label: '초 차례' },
              { value: HAN as Side, label: '한 차례' },
            ],
            st.toMove,
            (v) => {
              st.toMove = v;
              commit();
            },
          ),
        ),
        field(
          '내 진영',
          segmented(
            [
              { value: CHO as Side, label: '초' },
              { value: HAN as Side, label: '한' },
            ],
            st.userSide,
            (v) => {
              st.userSide = v;
              commit();
            },
            'side',
          ),
        ),
        field(
          '교습 조언',
          segmented(
            [
              { value: 1, label: '켜기' },
              { value: 0, label: '끄기' },
            ],
            st.coach ? 1 : 0,
            (v) => {
              st.coach = v === 1;
              commit();
            },
          ),
        ),
        field(
          '빅장',
          segmented(
            [
              { value: 1, label: '사용' },
              { value: 0, label: '사용 안 함' },
            ],
            st.bikjang ? 1 : 0,
            (v) => {
              st.bikjang = v === 1;
              commit();
            },
          ),
        ),
        h(
          'div',
          { class: 'field' },
          h('div', { class: 'field-label' }, 'AI 난이도'),
          levelPicker(st.level, (v) => {
            st.level = v;
            commit();
          }),
        ),
      ),
      errorsEl,
      h('div', { class: 'start-row' }, startBtn),
    ),
  );
  commit();
  return { el, title: '직접 배치하기' };
}
