// 2인 대국: 온라인 매칭은 서버 추가 후 제공 예정. 지금은 한 기기에서 둘이 두기.
import type { App } from './app';
import { h } from './dom';
import { setupScreen } from './setup';
import type { Screen } from './types';

export function onlineScreen(app: App): Screen {
  const el = h(
    'div',
    { class: 'online' },
    h(
      'section',
      { class: 'card online-soon' },
      h('div', { class: 'soon-badge' }, '준비 중'),
      h('h2', null, '온라인 매칭'),
      h(
        'p',
        null,
        '다른 사람과 실시간으로 대국하는 온라인 매칭은 서버를 추가하면서 제공될 예정입니다. 매칭, 급수별 상대 찾기, 친구 초대, 기보 저장을 계획하고 있습니다.',
      ),
      h('button', { class: 'btn', disabled: true }, '매칭 시작 (준비 중)'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', null, '한 기기에서 2인 대국'),
      h('p', null, '한 화면을 번갈아 보며 두 사람이 둡니다. 원하면 차례인 쪽에게 코치 조언을 켤 수 있습니다.'),
      h('button', { class: 'btn primary', onclick: () => app.go(() => setupScreen(app, 'local')) }, '같은 기기에서 두기'),
    ),
  );
  return { el, title: '2인 대국' };
}
