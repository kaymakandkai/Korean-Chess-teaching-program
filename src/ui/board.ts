// SVG 장기판
import { CHO, COLS, GUARD, KING, NSQ, PASS, ROWS, SOLDIER, colOf, rowOf } from '../engine/constants';
import type { Arrow, Mark } from '../engine/coach';
import { PIECE_HANJA_CHO, PIECE_HANJA_HAN, PIECE_KO } from '../engine/notation';
import { clear, s } from './dom';
import { settings } from './settings';

const CELL = 100;
const PAD = 86;
const W = CELL * (COLS - 1) + PAD * 2;
const H = CELL * (ROWS - 1) + PAD * 2;

export interface BoardState {
  board: Int8Array;
  flipped: boolean;
  selected?: number | null;
  targets?: number[];
  lastMove?: number;
  checkSq?: number | null;
  arrows?: Arrow[];
  marks?: Mark[];
  /** 흐리게 표시할 칸 (떼기 미리보기) */
  faded?: Set<number>;
  /** 편집기 등에서 마우스 올린 칸 */
  hover?: number | null;
}

function octagon(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

export function pieceRadius(type: number) {
  if (type === KING) return 47;
  if (type === GUARD || type === SOLDIER) return 33;
  return 41;
}

export function pieceGlyph(p: number, hanja = settings.hanja): string {
  const t = p & 7;
  const side = p >> 3;
  if (hanja) return side === CHO ? PIECE_HANJA_CHO[t] : PIECE_HANJA_HAN[t];
  if (t === KING) return side === CHO ? '초' : '한';
  if (t === SOLDIER) return side === CHO ? '졸' : '병';
  return PIECE_KO[t];
}

/** 기물 하나를 그린 SVG 그룹 (보드 밖에서도 사용) */
export function pieceSvg(p: number, opts: { faded?: boolean; scale?: number } = {}): SVGGElement {
  const t = p & 7;
  const r = pieceRadius(t) * (opts.scale ?? 1);
  const side = p >> 3;
  const g = s('g', { class: `piece ${side === CHO ? 'cho' : 'han'} ${opts.faded ? 'faded' : ''}` });
  g.append(
    s('polygon', { points: octagon(r + 2), class: 'pc-shadow', transform: 'translate(2.5,4)' }),
    s('polygon', { points: octagon(r), class: 'pc-face' }),
    s('polygon', { points: octagon(r - 6), class: 'pc-inner' }),
  );
  const fs = (settings.hanja ? 1.02 : 0.86) * r;
  g.append(
    s(
      'text',
      {
        class: `pc-text ${settings.hanja ? 'hanja' : 'hangul'}`,
        'font-size': fs.toFixed(0),
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        y: settings.hanja ? 1 : 2,
      },
      pieceGlyph(p),
    ),
  );
  return g;
}

export class BoardView {
  readonly el: SVGSVGElement;
  onClick?: (sq: number) => void;
  onHover?: (sq: number | null) => void;
  private layerPieces: SVGGElement;
  private layerUnder: SVGGElement;
  private layerOver: SVGGElement;
  private layerGrid: SVGGElement;
  private gridFlipped: boolean | null = null;
  private gridCoords: boolean | null = null;
  private pieceEls = new Map<number, SVGGElement>();

  constructor(opts: { interactive?: boolean; label?: string } = {}) {
    this.el = s('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: `janggi-board ${opts.interactive ? 'interactive' : ''}`,
      role: 'img',
      'aria-label': opts.label ?? '장기판',
    });
    const defs = s('defs');
    defs.innerHTML = `
      <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--wood-1)"/><stop offset="1" stop-color="var(--wood-2)"/>
      </linearGradient>
      <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--piece-1)"/><stop offset="1" stop-color="var(--piece-2)"/>
      </linearGradient>
      ${['best', 'alt', 'threat']
        .map(
          (k) => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="arrowhead ${k}"/></marker>`,
        )
        .join('')}`;
    this.el.append(defs);
    this.layerGrid = s('g');
    this.layerUnder = s('g');
    this.layerPieces = s('g');
    this.layerOver = s('g', { class: 'over', 'pointer-events': 'none' });
    this.el.append(this.layerGrid, this.layerUnder, this.layerPieces, this.layerOver);
    if (opts.interactive) {
      this.el.addEventListener('click', (e) => {
        const sq = this.sqFromEvent(e);
        if (sq !== null) this.onClick?.(sq);
      });
      this.el.addEventListener('mousemove', (e) => this.onHover?.(this.sqFromEvent(e)));
      this.el.addEventListener('mouseleave', () => this.onHover?.(null));
    }
  }

  private flipped = false;

  private xy(sq: number): [number, number] {
    let r = rowOf(sq);
    let c = colOf(sq);
    if (this.flipped) {
      r = ROWS - 1 - r;
      c = COLS - 1 - c;
    }
    return [PAD + c * CELL, PAD + r * CELL];
  }

  private sqFromEvent(e: MouseEvent): number | null {
    const pt = this.el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = this.el.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    let c = Math.round((p.x - PAD) / CELL);
    let r = Math.round((p.y - PAD) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    const dx = p.x - (PAD + c * CELL);
    const dy = p.y - (PAD + r * CELL);
    if (dx * dx + dy * dy > 52 * 52) return null;
    if (this.flipped) {
      r = ROWS - 1 - r;
      c = COLS - 1 - c;
    }
    return r * COLS + c;
  }

  private drawGrid() {
    const g = this.layerGrid;
    clear(g);
    g.append(s('rect', { x: 6, y: 6, width: W - 12, height: H - 12, rx: 18, class: 'board-bg' }));
    g.append(
      s('rect', {
        x: PAD,
        y: PAD,
        width: CELL * (COLS - 1),
        height: CELL * (ROWS - 1),
        class: 'board-border',
      }),
    );
    for (let r = 0; r < ROWS; r++) {
      g.append(s('line', { x1: PAD, y1: PAD + r * CELL, x2: PAD + (COLS - 1) * CELL, y2: PAD + r * CELL, class: 'grid' }));
    }
    for (let c = 0; c < COLS; c++) {
      g.append(s('line', { x1: PAD + c * CELL, y1: PAD, x2: PAD + c * CELL, y2: PAD + (ROWS - 1) * CELL, class: 'grid' }));
    }
    // 궁성 대각선
    for (const top of [0, 7]) {
      const x1 = PAD + 3 * CELL;
      const x2 = PAD + 5 * CELL;
      const y1 = PAD + top * CELL;
      const y2 = PAD + (top + 2) * CELL;
      g.append(s('line', { x1, y1, x2, y2, class: 'grid palace' }), s('line', { x1: x2, y1, x2: x1, y2, class: 'grid palace' }));
    }
    // 좌표 (기보 표기 기준: 가로줄 1~9,0 / 세로줄 1~9)
    if (settings.coords) {
      for (let c = 0; c < COLS; c++) {
        const real = this.flipped ? COLS - 1 - c : c;
        g.append(s('text', { x: PAD + c * CELL, y: H - 16, class: 'coord', 'text-anchor': 'middle' }, String(real + 1)));
      }
      for (let r = 0; r < ROWS; r++) {
        const real = this.flipped ? ROWS - 1 - r : r;
        g.append(
          s('text', { x: 26, y: PAD + r * CELL, class: 'coord', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String((real + 1) % 10)),
        );
      }
    }
  }

  render(st: BoardState, animateMove?: number) {
    this.flipped = st.flipped;
    if (this.gridFlipped !== st.flipped || this.gridCoords !== settings.coords) {
      this.drawGrid();
      this.gridFlipped = st.flipped;
      this.gridCoords = settings.coords;
    }
    const under = this.layerUnder;
    const over = this.layerOver;
    clear(under);
    clear(over);

    if (st.lastMove && st.lastMove !== PASS) {
      const [fx, fy] = this.xy(st.lastMove >> 7);
      const [tx, ty] = this.xy(st.lastMove & 127);
      under.append(s('circle', { cx: fx, cy: fy, r: 20, class: 'last-from' }));
      under.append(s('circle', { cx: tx, cy: ty, r: 54, class: 'last-to' }));
    }
    if (st.checkSq !== null && st.checkSq !== undefined && st.checkSq >= 0) {
      const [x, y] = this.xy(st.checkSq);
      under.append(s('circle', { cx: x, cy: y, r: 58, class: 'check-glow' }));
    }
    if (st.selected !== null && st.selected !== undefined) {
      const [x, y] = this.xy(st.selected);
      under.append(s('circle', { cx: x, cy: y, r: 54, class: 'selected-ring' }));
    }
    if (st.hover !== null && st.hover !== undefined) {
      const [x, y] = this.xy(st.hover);
      under.append(s('circle', { cx: x, cy: y, r: 50, class: 'hover-ring' }));
    }

    // 기물
    this.pieceEls = new Map();
    clear(this.layerPieces);
    for (let sq = 0; sq < NSQ; sq++) {
      const p = st.board[sq];
      if (!p) continue;
      const [x, y] = this.xy(sq);
      const outer = s('g', { transform: `translate(${x},${y})` });
      const inner = pieceSvg(p, { faded: st.faded?.has(sq) });
      outer.append(inner);
      this.layerPieces.append(outer);
      this.pieceEls.set(sq, inner);
    }
    if (animateMove && animateMove !== PASS && settings.animate) {
      const from = animateMove >> 7;
      const to = animateMove & 127;
      const el = this.pieceEls.get(to);
      if (el && typeof el.animate === 'function') {
        const [fx, fy] = this.xy(from);
        const [tx, ty] = this.xy(to);
        const outer = el.parentNode as SVGGElement | null;
        if (outer) this.layerPieces.appendChild(outer); // 움직이는 기물을 맨 위로
        try {
          el.animate([{ transform: `translate(${fx - tx}px, ${fy - ty}px)` }, { transform: 'translate(0px, 0px)' }], {
            duration: 220,
            easing: 'cubic-bezier(.2,.8,.2,1)',
          });
        } catch {
          /* 애니메이션 미지원 */
        }
      }
    }

    // 표시 (위험/목표)
    for (const m of st.marks ?? []) {
      const [x, y] = this.xy(m.sq);
      over.append(s('circle', { cx: x, cy: y, r: 52, class: `mark ${m.kind}` }));
    }
    // 이동 가능 칸
    for (const t of st.targets ?? []) {
      const [x, y] = this.xy(t);
      if (st.board[t]) over.append(s('circle', { cx: x, cy: y, r: 52, class: 'target-cap' }));
      else over.append(s('circle', { cx: x, cy: y, r: 15, class: 'target-dot' }));
    }
    // 화살표
    for (const a of st.arrows ?? []) {
      const [x1, y1] = this.xy(a.from);
      const [x2, y2] = this.xy(a.to);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const sx = x1 + (dx / len) * 26;
      const sy = y1 + (dy / len) * 26;
      const ex = x2 - (dx / len) * 34;
      const ey = y2 - (dy / len) * 34;
      over.append(s('line', { x1: sx, y1: sy, x2: ex, y2: ey, class: `arrow ${a.kind}`, 'marker-end': `url(#ah-${a.kind})` }));
    }
  }
}
