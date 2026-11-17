// 앱 뼈대: 상단 바, 화면 전환, 설정 창
import { h, clear } from './dom';
import { settings, updateSettings } from './settings';
import type { Screen } from './types';

export class App {
  readonly root: HTMLElement;
  private view: HTMLElement;
  private titleEl: HTMLElement;
  private backBtn: HTMLButtonElement;
  private current: Screen | null = null;
  private stack: (() => Screen)[] = [];
  private homeFactory: () => Screen;

  constructor(root: HTMLElement, home: () => Screen) {
    this.root = root;
    this.homeFactory = home;
    this.backBtn = h('button', { class: 'icon-btn back', 'aria-label': '뒤로', onclick: () => this.back() }, '‹');
    this.titleEl = h('div', { class: 'top-title' });
    const brand = h(
      'button',
      { class: 'brand', onclick: () => this.home(), 'aria-label': '처음 화면으로' },
      h('span', { class: 'brand-mark' }, '臥龍'),
      h('span', { class: 'brand-name' }, '와룡장기'),
    );
    const top = h(
      'header',
      { class: 'topbar' },
      this.backBtn,
      brand,
      this.titleEl,
      h('div', { class: 'spacer' }),
      h('button', { class: 'icon-btn', 'aria-label': '장기 규칙', title: '장기 규칙', onclick: () => showRules() }, '?'),
      h('button', { class: 'icon-btn', 'aria-label': '설정', title: '설정', onclick: () => showSettings() }, '⚙'),
    );
    this.view = h('main', { class: 'view' });
    root.append(top, this.view);
  }

  private mount(factory: () => Screen) {
    this.current?.destroy?.();
    clear(this.view);
    const sc = factory();
    this.current = sc;
    this.view.append(sc.el);
    this.titleEl.textContent = sc.title;
    this.backBtn.style.visibility = this.stack.length > 1 ? 'visible' : 'hidden';
    window.scrollTo({ top: 0 });
  }

  go(factory: () => Screen) {
    this.stack.push(factory);
    this.mount(factory);
  }

  /** 현재 화면을 다른 화면으로 교체 (뒤로 가기 기록 없이) */
  replace(factory: () => Screen) {
    this.stack.pop();
    this.stack.push(factory);
    this.mount(factory);
  }

  back() {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    this.mount(this.stack[this.stack.length - 1]);
  }

  home() {
    this.stack = [this.homeFactory];
    this.mount(this.homeFactory);
  }

  setTitle(t: string) {
    this.titleEl.textContent = t;
  }
}

export function modal(title: string, body: HTMLElement, actions: { label: string; primary?: boolean; onClick?: () => void }[] = []) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const overlay = h(
    'div',
    { class: 'modal-overlay', onclick: (e: Event) => e.target === overlay && close() },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: close }, '×')),
      h('div', { class: 'modal-body' }, body),
      actions.length
        ? h(
            'div',
            { class: 'modal-actions' },
            ...actions.map((a) =>
              h(
                'button',
                {
                  class: `btn ${a.primary ? 'primary' : ''}`,
                  onclick: () => {
                    close();
                    a.onClick?.();
                  },
                },
                a.label,
              ),
            ),
          )
        : null,
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return close;
}

function toggleRow(label: string, desc: string, get: () => boolean, set: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return h('label', { class: 'toggle-row' }, h('div', null, h('div', { class: 'tr-label' }, label), h('div', { class: 'tr-desc' }, desc)), input);
}

export function showSettings() {
  const body = h(
    'div',
    { class: 'settings' },
    toggleRow('기물을 한자로 표시', '끄면 차·포·마처럼 한글로 표시합니다.', () => settings.hanja, (v) => updateSettings({ hanja: v })),
    toggleRow('좌표 표시', '판 가장자리에 기보 좌표(1~9, 0)를 표시합니다.', () => settings.coords, (v) => updateSettings({ coords: v })),
    toggleRow('착수 소리', '기물을 놓을 때 소리를 냅니다.', () => settings.sound, (v) => updateSettings({ sound: v })),
    toggleRow('움직임 효과', '기물이 미끄러지듯 움직입니다.', () => settings.animate, (v) => updateSettings({ animate: v })),
  );
  modal('설정', body, [{ label: '닫기', primary: true }]);
}

export function showRules() {
  const rows: [string, string, string][] = [
    ['궁 (楚/漢)', '궁성 안에서 선을 따라 한 칸씩 움직입니다. 궁성의 대각선도 사용할 수 있습니다.', '상대에게 잡힐 수밖에 없게 되면(외통) 집니다.'],
    ['사 (士)', '궁과 똑같이 궁성 안에서만 한 칸씩 움직입니다.', '궁을 지키는 가장 가까운 수비수입니다. (3점)'],
    ['차 (車)', '가로·세로로 거리 제한 없이 움직입니다. 궁성 안에서는 대각선으로도 움직입니다.', '가장 강한 기물입니다. (13점)'],
    ['포 (包)', '반드시 기물 하나(다리)를 넘어서 움직이고 잡습니다. 포는 포를 넘을 수 없고 포를 잡을 수도 없습니다.', '다리가 있어야 힘을 씁니다. (7점)'],
    ['마 (馬)', '한 칸 곧게 간 뒤 한 칸 대각선으로 갑니다. 처음 곧게 가는 칸(멱)이 막히면 못 갑니다.', '(5점)'],
    ['상 (象)', '한 칸 곧게 간 뒤 두 칸 대각선으로 갑니다. 지나가는 칸이 막히면 못 갑니다.', '(3점)'],
    ['졸·병 (卒/兵)', '앞이나 옆으로 한 칸씩 움직이며 뒤로는 못 갑니다. 상대 궁성 안에서는 대각선 앞으로도 갑니다.', '(2점)'],
  ];
  const body = h(
    'div',
    { class: 'rules' },
    h('p', null, '장기판은 가로 9줄, 세로 10줄이며 기물은 선이 만나는 점 위에 놓습니다. 보통 초(파랑)가 먼저 둡니다.'),
    h('table', { class: 'rules-table' }, ...rows.map(([a, b, c]) => h('tr', null, h('th', null, a), h('td', null, b, h('div', { class: 'muted' }, c))))),
    h('h3', null, '특별한 규칙'),
    h(
      'ul',
      null,
      h('li', null, h('b', null, '장군 / 멍군: '), '상대 궁을 공격하는 것을 장군, 장군을 받으면서 동시에 상대에게 장군을 거는 것을 멍군이라 합니다.'),
      h('li', null, h('b', null, '한수 쉼: '), '장군을 받고 있지 않을 때는 차례를 넘길 수 있습니다. 양쪽이 연속으로 쉬면 점수로 판정합니다.'),
      h('li', null, h('b', null, '빅장: '), '두 궁이 같은 세로줄에서 사이에 아무것도 없이 마주보는 것. 상대가 피하지 않으면 무승부가 됩니다(설정에서 끌 수 있음).'),
      h('li', null, h('b', null, '덤: '), '나중에 두는 쪽은 1.5점의 덤을 받습니다. 점수 판정 때 더해집니다.'),
      h('li', null, h('b', null, '기보 좌표: '), '가로줄은 위에서부터 1~9, 맨 아래가 0이고, 세로줄은 왼쪽부터 1~9입니다. 예: 82포85 = 82의 포가 85로.'),
    ),
  );
  modal('장기 규칙 한눈에 보기', body, [{ label: '확인', primary: true }]);
}
