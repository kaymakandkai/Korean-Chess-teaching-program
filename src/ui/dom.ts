// 작은 DOM 도우미
type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> | null | undefined;

function applyProps(el: Element, props: Props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (k === 'style' && typeof v === 'object') Object.assign((el as HTMLElement).style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'dataset' && typeof v === 'object') Object.assign((el as HTMLElement).dataset, v);
    else if (k === 'html') (el as HTMLElement).innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

function append(el: Element, children: Child[]) {
  for (const c of children.flat() as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 토글 버튼 그룹 */
export function segmented<T extends string | number>(
  options: { value: T; label: string; sub?: string }[],
  value: T,
  onChange: (v: T) => void,
  cls = '',
): HTMLElement {
  const wrap = h('div', { class: `segmented ${cls}`, role: 'radiogroup' });
  const render = (cur: T) => {
    clear(wrap);
    for (const o of options) {
      const b = h(
        'button',
        {
          type: 'button',
          class: `seg ${o.value === cur ? 'on' : ''}`,
          role: 'radio',
          'aria-checked': o.value === cur ? 'true' : 'false',
          onclick: () => {
            render(o.value);
            onChange(o.value);
          },
        },
        h('span', { class: 'seg-label' }, o.label),
        o.sub ? h('span', { class: 'seg-sub' }, o.sub) : null,
      );
      wrap.append(b);
    }
  };
  render(value);
  return wrap;
}

let toastTimer = 0;
export function toast(text: string, kind: 'info' | 'check' | 'warn' = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el && (el.className = `toast ${kind}`), 1600);
}
