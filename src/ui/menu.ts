// 첫 화면: 모드 선택
import { CHARIOT, CHO, HAN, HORSE, KING, SOLDIER, makePiece } from '../engine/constants';
import type { App } from './app';
import { pieceSvg } from './board';
import { h, s } from './dom';
import { onlineScreen } from './online';
import { scenarioListScreen } from './scenarioScreen';
import { setupScreen } from './setup';
import { SCENARIOS } from '../scenarios';
import type { Screen } from './types';

function icon(piece: number) {
  const svg = s('svg', { viewBox: '-55 -55 110 110', class: 'mode-icon', 'aria-hidden': 'true' });
  svg.append(pieceSvg(piece, { scale: 1.1 }));
  return svg;
}

export function menuScreen(app: App): Screen {
  const card = (opts: { piece: number; title: string; sub: string; desc: string; badge?: string; featured?: boolean; onClick: () => void }) =>
    h(
      'button',
      { class: `mode-card ${opts.featured ? 'featured' : ''}`, onclick: opts.onClick },
      icon(opts.piece),
      h(
        'div',
        { class: 'mode-text' },
        h('div', { class: 'mode-title' }, opts.title, opts.badge ? h('span', { class: 'badge' }, opts.badge) : null),
        h('div', { class: 'mode-sub' }, opts.sub),
        h('div', { class: 'mode-desc' }, opts.desc),
      ),
    );

  const el = h(
    'div',
    { class: 'menu' },
    h(
      'section',
      { class: 'hero' },
      h('div', { class: 'hero-mark', 'aria-hidden': 'true' }, '臥龍'),
      h('h1', null, '와룡장기'),
      h('p', { class: 'hero-sub' }, '두고, 배우고, 이기는 장기 — 초보부터 9단 수준의 AI까지'),
    ),
    h(
      'section',
      { class: 'mode-grid' },
      card({
        piece: makePiece(HAN, CHARIOT),
        title: 'AI 대국',
        sub: '초보 17급 ~ 전설 9단',
        desc: '6단계 난이도의 AI와 대국합니다. 진영·마상 차림·떼기·선수를 고를 수 있습니다.',
        onClick: () => app.go(() => setupScreen(app, 'ai')),
      }),
      card({
        piece: makePiece(CHO, HORSE),
        title: '상황별 대국',
        sub: `연습 지형 ${SCENARIOS.length}가지 + 직접 배치`,
        desc: '외통·전술·수비·종반 등 중요한 장면을 연습하거나, 직접 말을 놓고 그 자리부터 둡니다.',
        onClick: () => app.go(() => scenarioListScreen(app)),
      }),
      card({
        piece: makePiece(CHO, SOLDIER),
        title: '2인 대국',
        sub: '온라인 매칭 준비 중',
        desc: '서버가 추가되면 온라인 매칭을 지원합니다. 지금은 한 기기에서 둘이 둘 수 있습니다.',
        badge: '준비 중',
        onClick: () => app.go(() => onlineScreen(app)),
      }),
      card({
        piece: makePiece(CHO, KING),
        title: '교습',
        sub: '매 수마다 AI 코치의 조언',
        desc: '지금 상황, 좋은 수와 그 이유, 지금 위험한 것, 몇 수 뒤의 위험까지 수마다 알려 줍니다.',
        badge: '추천',
        featured: true,
        onClick: () => app.go(() => setupScreen(app, 'teach')),
      }),
    ),
    h(
      'footer',
      { class: 'menu-foot' },
      h('span', null, '기물 점수: 차 13 · 포 7 · 마 5 · 상 3 · 사 3 · 졸 2'),
      h('span', { class: 'dot' }, '·'),
      h('span', null, '후수 덤 1.5'),
    ),
  );
  return { el, title: '' };
}
