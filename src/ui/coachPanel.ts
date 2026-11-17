// 교습 패널: 코치의 조언을 화면에 그린다
import { PASS, Side } from '../engine/constants';
import type { Advice, Danger, Review } from '../engine/coach';
import { isMateScore, mateIn } from '../engine/search';
import { h } from './dom';

export interface ReviewEntry extends Review {
  moveNo: number;
}

export interface CoachUIState {
  advice: Advice | null;
  adviceLoading: boolean;
  review: ReviewEntry | null;
  reviewLoading: boolean;
  history: ReviewEntry[];
  showArrows: boolean;
  /** 조언 대상 진영 */
  forSide: Side;
  /** 지금 조언을 받을 차례인지 (상대 차례면 대기 표시) */
  waiting: boolean;
}

export interface CoachHandlers {
  onPreview: (move: number | null) => void;
  onPlay: (move: number) => void;
  onToggleArrows: (v: boolean) => void;
}

const LEVEL_ICON: Record<Danger['level'], string> = { high: '●', mid: '●', low: '●' };

function evalBar(cp: number) {
  let x: number;
  if (isMateScore(cp)) x = cp > 0 ? 1 : -1;
  else x = Math.tanh(cp / 700);
  const pct = 50 + 50 * x;
  return h(
    'div',
    { class: 'evalbar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': pct.toFixed(0), 'aria-label': '형세' },
    h('div', { class: 'evalbar-fill', style: { width: `${pct}%` } }),
    h('div', { class: 'evalbar-mid' }),
    h('span', { class: 'evalbar-l' }, '나'),
    h('span', { class: 'evalbar-r' }, '상대'),
  );
}

function section(icon: string, title: string, cls: string, ...children: (HTMLElement | null)[]) {
  return h('section', { class: `coach-sec ${cls}` }, h('h4', null, h('span', { class: 'sec-icon', 'aria-hidden': 'true' }, icon), title), ...children);
}

function list(items: string[], cls = '') {
  return h('ul', { class: `coach-list ${cls}` }, ...items.map((t) => h('li', null, t)));
}

function spinner(text: string) {
  return h('div', { class: 'thinking' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), text);
}

function reviewCard(r: ReviewEntry) {
  return h(
    'div',
    { class: `review q-${r.quality}` },
    h(
      'div',
      { class: 'review-head' },
      h('span', { class: 'q-badge' }, r.qualityText),
      h('span', { class: 'review-move' }, `${r.moveNo}수 · 내 수: ${r.label}`),
      r.loss > 12 ? h('span', { class: 'review-loss' }, `최선 대비 -${r.lossPoints.toFixed(1)}점`) : null,
    ),
    list(r.comments),
    r.better
      ? h(
          'div',
          { class: 'review-better' },
          h('b', null, `더 좋은 수: ${r.better.label}`),
          r.better.reasons.length ? list(r.better.reasons.slice(0, 3), 'sub') : null,
        )
      : null,
    r.refutation ? h('div', { class: 'review-ref' }, r.refutation) : null,
  );
}

export function renderCoach(st: CoachUIState, hd: CoachHandlers): HTMLElement {
  const arrowsToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
  arrowsToggle.checked = st.showArrows;
  arrowsToggle.addEventListener('change', () => hd.onToggleArrows(arrowsToggle.checked));

  const a = st.advice;
  const head = h(
    'div',
    { class: 'coach-head' },
    h('div', { class: 'coach-title' }, h('span', { class: 'coach-mark' }, '師'), '와룡 코치'),
    a && !st.adviceLoading ? h('span', { class: 'coach-meta' }, `깊이 ${a.depth} · ${formatNodes(a.nodes)} 국면 계산`) : null,
    h('label', { class: 'mini-toggle' }, arrowsToggle, '판에 화살표'),
  );

  const body: (HTMLElement | null)[] = [];

  // 방금 둔 내 수 평가
  if (st.reviewLoading) body.push(h('div', { class: 'review pending' }, spinner('방금 둔 수를 평가하는 중…')));
  else if (st.review) body.push(reviewCard(st.review));

  if (st.waiting) {
    body.push(spinner('상대가 생각 중입니다. 상대가 두면 바로 지금 상황을 분석합니다.'));
  } else if (st.adviceLoading || !a) {
    body.push(spinner('지금 국면을 분석하는 중…'));
  } else {
    body.push(evalBar(a.evalCp));
    if (a.opponentMove) {
      body.push(section('↩', `상대 수 해설 · ${a.opponentMove.label}`, 'opp', list(a.opponentMove.notes)));
    }
    body.push(section('■', '지금 상황', 'situation', list(a.situation)));
    body.push(
      section(
        '!',
        '지금 위험한 것',
        'danger',
        h(
          'ul',
          { class: 'coach-list dangers' },
          ...a.dangers.map((d) => h('li', { class: `lv-${d.level}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }, LEVEL_ICON[d.level]), d.text)),
        ),
      ),
    );
    const recs = h(
      'ol',
      { class: 'recs' },
      ...a.recommendations.map((r, i) =>
        h(
          'li',
          {
            class: `rec ${i === 0 ? 'top' : ''}`,
            onmouseenter: () => hd.onPreview(r.move),
            onmouseleave: () => hd.onPreview(null),
          },
          h(
            'div',
            { class: 'rec-head' },
            h('span', { class: 'rec-rank' }, i === 0 ? '최선' : `후보 ${i + 1}`),
            h('span', { class: 'rec-move' }, r.label),
            h('span', { class: `rec-score ${r.score >= 0 ? 'pos' : 'neg'}` }, r.scoreText),
          ),
          list(r.reasons, 'sub'),
          r.line ? h('div', { class: 'rec-line' }, h('span', { class: 'muted' }, '예상 수순: '), r.line) : null,
          h(
            'div',
            { class: 'rec-actions' },
            r.move !== PASS
              ? h('button', { class: 'btn tiny ghost', onclick: () => hd.onPreview(r.move) }, '판에서 보기')
              : null,
            h('button', { class: 'btn tiny', onclick: () => hd.onPlay(r.move) }, '이 수 두기'),
          ),
        ),
      ),
    );
    body.push(section('★', '추천 수와 이유', 'recs-sec', recs));
    body.push(section('…', '몇 수 뒤의 위험', 'future', list(a.future)));
    body.push(section('✎', '배움 한마디', 'tips', list(a.tips)));
  }

  // 기록
  if (st.history.length) {
    const counts: Record<string, number> = {};
    for (const r of st.history) counts[r.qualityText] = (counts[r.qualityText] ?? 0) + 1;
    body.push(
      h(
        'details',
        { class: 'coach-history' },
        h('summary', null, `지금까지의 내 수 평가 (${st.history.length}수) — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`),
        h(
          'ol',
          { class: 'history-list' },
          ...st.history
            .slice()
            .reverse()
            .map((r) => h('li', { class: `q-${r.quality}` }, h('span', { class: 'q-badge' }, r.qualityText), ` ${r.moveNo}수 ${r.label}`)),
        ),
      ),
    );
  }
  return h('div', { class: 'coach' }, head, ...body);
}

function formatNodes(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}백만`;
  if (n >= 1e4) return `${Math.round(n / 1e4)}만`;
  return String(n);
}

export function mateLabel(score: number) {
  return isMateScore(score) ? `${Math.abs(mateIn(score))}수 외통` : '';
}
