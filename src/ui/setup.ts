// 대국 설정 화면 (AI 대국 / 교습 / 2인 대국)
import { CHO, HAN, Side } from '../engine/constants';
import { LEVELS, LevelId } from '../engine/levels';
import { FORMATIONS, Formation, HANDICAP_PRESETS, buildInitialPosition, pieceSlots } from '../engine/setup';
import type { App } from './app';
import { BoardView } from './board';
import { h, segmented } from './dom';
import { gameScreen } from './gameView';
import { loadPref, savePref } from './settings';
import type { GameConfig, Mode, Screen } from './types';

interface SetupState {
  level: LevelId;
  userSide: Side;
  formations: [Formation, Formation];
  removed: [string[], string[]];
  first: Side;
  bikjang: boolean;
  moveLimit: number;
  coachTime: number;
  coach: boolean;
}

const DEFAULT_STATE: SetupState = {
  level: 'intermediate',
  userSide: CHO,
  formations: ['마상마상', '마상마상'],
  removed: [[], []],
  first: CHO,
  bikjang: true,
  moveLimit: 200,
  coachTime: 1500,
  coach: false,
};

export function levelPicker(value: LevelId, onChange: (v: LevelId) => void): HTMLElement {
  const wrap = h('div', { class: 'level-grid', role: 'radiogroup', 'aria-label': 'AI 난이도' });
  const render = (cur: LevelId) => {
    wrap.replaceChildren(
      ...LEVELS.map((l, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `level-card ${l.id === cur ? 'on' : ''} lv${i}`,
            role: 'radio',
            'aria-checked': l.id === cur ? 'true' : 'false',
            onclick: () => {
              render(l.id);
              onChange(l.id);
            },
          },
          h('div', { class: 'lv-top' }, h('span', { class: 'lv-name' }, l.name), h('span', { class: 'lv-grade' }, l.grade)),
          h('div', { class: 'lv-bars', 'aria-hidden': 'true' }, ...LEVELS.map((_, j) => h('i', { class: j <= i ? 'on' : '' }))),
          h('div', { class: 'lv-desc' }, l.desc),
        ),
      ),
    );
  };
  render(value);
  return wrap;
}

export function field(label: string, control: HTMLElement, help?: string) {
  return h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), control, help ? h('div', { class: 'field-help' }, help) : null);
}

const MODE_TITLE: Record<string, string> = { ai: 'AI 대국 설정', teach: '교습 설정', local: '2인 대국 설정' };

export function setupScreen(app: App, mode: Mode): Screen {
  const st: SetupState = loadPref(`setup.${mode}`, { ...DEFAULT_STATE, coach: mode === 'teach' });
  st.removed = [[...st.removed[0]], [...st.removed[1]]];

  const preview = new BoardView({ interactive: true, label: '시작 배치 미리보기' });
  const removedText = h('div', { class: 'removed-text' });

  const refresh = () => {
    const pos = buildInitialPosition({ formations: st.formations, removed: [[], []], first: st.first });
    const faded = new Set<number>();
    for (const side of [CHO, HAN] as Side[]) {
      for (const slot of pieceSlots(side, st.formations[side])) if (st.removed[side].includes(slot.key)) faded.add(slot.sq);
    }
    preview.render({ board: pos.board, flipped: st.userSide === HAN, faded });
    const parts: string[] = [];
    for (const side of [CHO, HAN] as Side[]) {
      const names = pieceSlots(side, st.formations[side])
        .filter((sl) => st.removed[side].includes(sl.key))
        .map((sl) => sl.label);
      if (names.length) parts.push(`${side === CHO ? '초' : '한'}: ${names.join(', ')}`);
    }
    removedText.textContent = parts.length ? `떼는 기물 — ${parts.join(' / ')}` : '떼는 기물 없음 (판 위의 기물을 누르면 떼거나 되돌릴 수 있습니다)';
  };
  preview.onClick = (sq) => {
    for (const side of [CHO, HAN] as Side[]) {
      const slot = pieceSlots(side, st.formations[side]).find((sl) => sl.sq === sq);
      if (!slot || slot.key === 'K') continue;
      const list = st.removed[side];
      const i = list.indexOf(slot.key);
      if (i >= 0) list.splice(i, 1);
      else list.push(slot.key);
      refresh();
      syncPresets();
    }
  };

  const presetSelects: HTMLSelectElement[] = [];
  const presetFor = (side: Side) => {
    const sel = h('select', { class: 'select', 'aria-label': `${side === CHO ? '초' : '한'} 떼기` }) as HTMLSelectElement;
    for (const p of HANDICAP_PRESETS) sel.append(h('option', { value: p.id }, p.name));
    sel.append(h('option', { value: 'custom' }, '직접 선택'));
    sel.addEventListener('change', () => {
      const p = HANDICAP_PRESETS.find((x) => x.id === sel.value);
      if (p) {
        st.removed[side] = [...p.keys];
        refresh();
      }
    });
    presetSelects[side] = sel;
    return sel;
  };
  const syncPresets = () => {
    for (const side of [CHO, HAN] as Side[]) {
      const cur = [...st.removed[side]].sort().join(',');
      const p = HANDICAP_PRESETS.find((x) => [...x.keys].sort().join(',') === cur);
      if (presetSelects[side]) presetSelects[side].value = p ? p.id : 'custom';
    }
  };

  const formationPicker = (side: Side) =>
    segmented(
      FORMATIONS.map((f) => ({ value: f.id, label: f.name, sub: f.desc.split(' — ')[0] })),
      st.formations[side],
      (v) => {
        st.formations[side] = v;
        refresh();
      },
      'formation',
    );

  const sideLabel = mode === 'local' ? '아래쪽에 놓을 진영' : '내 진영';
  const form = h(
    'div',
    { class: 'setup-form' },
    mode !== 'local'
      ? h('section', { class: 'card' }, h('h3', null, 'AI 난이도'), levelPicker(st.level, (v) => (st.level = v)))
      : null,
    h(
      'section',
      { class: 'card' },
      h('h3', null, '진영과 순서'),
      field(
        sideLabel,
        segmented(
          [
            { value: CHO as Side, label: '초', sub: '파랑' },
            { value: HAN as Side, label: '한', sub: '빨강' },
          ],
          st.userSide,
          (v) => {
            st.userSide = v;
            refresh();
          },
          'side',
        ),
      ),
      field(
        '먼저 두는 쪽 (선수)',
        segmented(
          [
            { value: CHO as Side, label: '초 먼저', sub: '전통 규칙' },
            { value: HAN as Side, label: '한 먼저' },
          ],
          st.first,
          (v) => (st.first = v),
        ),
        '나중에 두는 쪽이 덤 1.5점을 받습니다.',
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', null, '마상 차림'),
      h('p', { class: 'muted small' }, '각 진영의 플레이어가 자기 쪽에서 바라본 왼쪽→오른쪽 순서입니다.'),
      field('초의 차림', formationPicker(CHO)),
      field('한의 차림', formationPicker(HAN)),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', null, '기물 떼기 (접장기)'),
      h('div', { class: 'preset-row' }, field('초에서 떼기', presetFor(CHO)), field('한에서 떼기', presetFor(HAN))),
      h('div', { class: 'preview-wrap' }, preview.el),
      removedText,
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', null, '규칙'),
      field(
        '빅장',
        segmented(
          [
            { value: 1, label: '사용', sub: '피하지 않으면 무승부' },
            { value: 0, label: '사용 안 함' },
          ],
          st.bikjang ? 1 : 0,
          (v) => (st.bikjang = v === 1),
        ),
      ),
      field(
        '수 제한 (도달 시 점수 판정)',
        segmented(
          [
            { value: 0, label: '없음' },
            { value: 100, label: '100수' },
            { value: 150, label: '150수' },
            { value: 200, label: '200수' },
          ],
          st.moveLimit,
          (v) => (st.moveLimit = v),
        ),
      ),
      mode === 'local'
        ? field(
            '코치 조언',
            segmented(
              [
                { value: 0, label: '끄기' },
                { value: 1, label: '켜기', sub: '차례인 쪽에게 조언' },
              ],
              st.coach ? 1 : 0,
              (v) => (st.coach = v === 1),
            ),
          )
        : null,
      mode === 'teach' || mode === 'local'
        ? field(
            '코치 분석 시간',
            segmented(
              [
                { value: 800, label: '빠르게', sub: '0.8초' },
                { value: 1500, label: '보통', sub: '1.5초' },
                { value: 3000, label: '깊게', sub: '3초' },
              ],
              st.coachTime,
              (v) => (st.coachTime = v),
            ),
            '길게 분석할수록 조언이 정확해집니다.',
          )
        : null,
    ),
    h(
      'div',
      { class: 'start-row' },
      h(
        'button',
        {
          class: 'btn primary big',
          onclick: () => {
            savePref(`setup.${mode}`, st);
            const fen = buildInitialPosition({ formations: st.formations, removed: st.removed, first: st.first }).toFen();
            const lv = LEVELS.find((l) => l.id === st.level)!;
            const cfg: GameConfig = {
              mode,
              startFen: fen,
              userSide: st.userSide,
              level: st.level,
              coach: mode === 'teach' || (mode === 'local' && st.coach),
              coachTimeMs: st.coachTime,
              rules: { bikjang: st.bikjang, moveLimit: st.moveLimit },
              title: mode === 'local' ? '2인 대국' : `${mode === 'teach' ? '교습' : 'AI 대국'} · ${lv.name}(${lv.grade})`,
            };
            app.go(() => gameScreen(app, cfg));
          },
        },
        mode === 'teach' ? '교습 시작' : '대국 시작',
      ),
    ),
  );
  refresh();
  syncPresets();
  return { el: h('div', { class: 'setup' }, form), title: MODE_TITLE[mode] ?? '설정' };
}
