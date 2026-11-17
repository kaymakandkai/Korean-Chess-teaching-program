// 대국 화면: AI 대국 · 교습 · 상황별 대국 · 2인 대국 공용
import { CHO, HAN, PASS, Side, makeMove, otherSide } from '../engine/constants';
import type { Advice, Arrow, Review } from '../engine/coach';
import { materialPoints } from '../engine/coach';
import { Game } from '../engine/game';
import { AiMoveResult, getLevel } from '../engine/levels';
import { moveLabel, pieceName } from '../engine/notation';
import { CancelledError, getAiClient, getCoachClient } from '../worker/client';
import { App, modal } from './app';
import { BoardView, pieceSvg } from './board';
import { CoachUIState, ReviewEntry, renderCoach } from './coachPanel';
import { h, s, toast } from './dom';
import { onSettingsChange } from './settings';
import { sound } from './sound';
import type { GameConfig, Screen } from './types';

export function gameScreen(app: App, cfg: GameConfig): Screen {
  const v = new GameView(app, cfg);
  return { el: v.el, title: cfg.title, destroy: () => v.destroy() };
}

type GoalStatus = 'pending' | 'success' | 'fail';

class GameView {
  readonly el: HTMLElement;
  private game: Game;
  private board = new BoardView({ interactive: true, label: '장기판' });
  private flipped: boolean;
  private selected: number | null = null;
  private thinking = false;
  private thinkStart = 0;
  private timer = 0;
  private token = 0;
  private ai = getAiClient();
  private coach = getCoachClient();
  private cs: CoachUIState;
  private adviceFor = -1;
  private hintArrow: Arrow | null = null;
  private preview: number | null = null;
  private goal: GoalStatus = 'pending';
  private goalBase: number;
  private hintsShown = 0;
  private unsub: () => void;
  private resultShown = false;

  private topBar = h('div', { class: 'pbar top' });
  private bottomBar = h('div', { class: 'pbar bottom' });
  private thinkBadge = h('div', { class: 'think-badge' });
  private statusEl = h('div', { class: 'status-card' });
  private coachEl = h('div', { class: 'coach-wrap' });
  private movesEl = h('ol', { class: 'move-list' });
  private controlsEl = h('div', { class: 'controls' });
  private goalEl = h('div', { class: 'goal-card' });

  constructor(
    private app: App,
    private cfg: GameConfig,
  ) {
    this.game = new Game(cfg.startFen, cfg.rules);
    this.flipped = cfg.userSide === HAN;
    this.cs = {
      advice: null,
      adviceLoading: false,
      review: null,
      reviewLoading: false,
      history: [],
      showArrows: true,
      forSide: cfg.userSide,
      waiting: false,
    };
    this.goalBase = this.pointDiff();
    this.board.onClick = (sq) => this.onSquare(sq);

    const side = h(
      'aside',
      { class: 'side-col' },
      cfg.scenario ? this.goalEl : null,
      this.statusEl,
      cfg.coach ? this.coachEl : null,
      h('div', { class: 'card moves-card' }, h('h3', null, '기보'), this.movesEl),
    );
    this.el = h(
      'div',
      { class: `game ${cfg.coach ? 'with-coach' : ''}` },
      h(
        'div',
        { class: 'board-col' },
        this.topBar,
        h('div', { class: 'board-wrap' }, this.board.el, this.thinkBadge),
        this.bottomBar,
        this.controlsEl,
      ),
      side,
    );
    this.unsub = onSettingsChange(() => this.renderAll());
    // 첫 렌더 후 진행
    queueMicrotask(() => {
      this.renderAll();
      this.next();
    });
  }

  destroy() {
    this.token++;
    clearInterval(this.timer);
    this.ai.cancelAll();
    this.coach.cancelAll();
    this.unsub();
  }

  // ---------------------------------------------------------------- 상태

  private isHumanTurn() {
    return this.cfg.mode === 'local' || this.game.side === this.cfg.userSide;
  }
  private coachSide(): Side {
    return this.cfg.mode === 'local' ? this.game.side : this.cfg.userSide;
  }
  private pointDiff() {
    const u = this.cfg.userSide;
    return materialPoints(this.game.pos, u) - materialPoints(this.game.pos, otherSide(u));
  }
  private userMoveCount() {
    return this.game.records.filter((r) => r.side === this.cfg.userSide).length;
  }
  private playerName(side: Side) {
    if (this.cfg.mode === 'local') return side === CHO ? '초' : '한';
    if (side === this.cfg.userSide) return '나';
    const l = getLevel(this.cfg.level);
    return `AI ${l.name} (${l.grade})`;
  }

  // ---------------------------------------------------------------- 진행

  private next() {
    this.selected = null;
    this.hintArrow = null;
    if (this.game.result) {
      this.renderAll();
      this.showResult();
      return;
    }
    if (!this.isHumanTurn()) this.aiTurn();
    else this.humanTurn();
  }

  private humanTurn() {
    const g = this.game;
    if (g.legalMoves().length === 0 && !g.pos.inCheck()) {
      toast('움직일 수 있는 기물이 없습니다. 한수 쉼을 하세요.', 'warn');
    }
    if (this.cfg.coach) this.analyze();
    this.renderAll();
  }

  private aiTurn() {
    const tok = this.token;
    this.thinking = true;
    this.thinkStart = performance.now();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.renderThinking(), 100);
    if (this.cfg.coach) this.cs.waiting = true;
    this.renderAll();
    this.ai
      .request<AiMoveResult>({
        kind: 'aiMove',
        startFen: this.game.startFen,
        moves: this.game.moves(),
        level: this.cfg.level,
        bikjang: this.cfg.rules.bikjang,
      })
      .then((res) => {
        if (tok !== this.token) return;
        this.thinking = false;
        clearInterval(this.timer);
        if (!res.move) {
          this.game.resign(this.game.side);
          this.next();
          return;
        }
        if (res.move === PASS) toast('상대가 한수 쉼을 했습니다.');
        this.apply(res.move);
      })
      .catch((err) => {
        if (err instanceof CancelledError) return;
        console.error(err);
        this.thinking = false;
        clearInterval(this.timer);
        toast('AI 계산 중 오류가 발생했습니다.', 'warn');
        this.renderAll();
      });
  }

  private apply(m: number) {
    const g = this.game;
    const moverInCheck = g.pos.inCheck();
    const rec = g.play(m);
    if (rec.check) {
      sound.check();
      toast(moverInCheck ? '멍군!' : '장군!', 'check');
    } else if (rec.captured) sound.capture();
    else sound.move();
    if (rec.bikjangCall) toast('빅장! 피하지 않으면 무승부입니다.', 'warn');
    this.renderAll(m);
    this.checkGoal(rec.side);
    this.next();
  }

  private onUserMove(m: number) {
    if (this.cfg.coach) {
      const ply = this.game.records.length;
      const adv = this.adviceFor === ply ? this.cs.advice : null;
      if (this.cs.adviceLoading) this.coach.cancelAll();
      this.requestReview(m, adv);
    }
    this.cs.advice = null;
    this.preview = null;
    this.apply(m);
  }

  private requestReview(m: number, adv: Advice | null) {
    const tok = this.token;
    const moveNo = this.game.records.length + 1;
    this.cs.reviewLoading = true;
    this.cs.review = null;
    this.coach
      .request<Review>({
        kind: 'review',
        startFen: this.game.startFen,
        moves: this.game.moves(),
        move: m,
        prior: adv ? { bestMove: adv.bestMove, bestScore: adv.bestScore, top: adv.top, depth: adv.depth } : null,
        bikjang: this.cfg.rules.bikjang,
        timeMs: this.cfg.coachTimeMs,
        deomSide: this.game.deomSide,
      })
      .then((r) => {
        if (tok !== this.token) return;
        const entry: ReviewEntry = { ...r, moveNo };
        this.cs.review = entry;
        this.cs.history.push(entry);
        this.cs.reviewLoading = false;
        this.renderCoach();
      })
      .catch((err) => {
        if (err instanceof CancelledError) return;
        this.cs.reviewLoading = false;
        this.renderCoach();
      });
  }

  private analyze() {
    const tok = this.token;
    const ply = this.game.records.length;
    this.cs.adviceLoading = true;
    this.cs.waiting = false;
    this.cs.advice = null;
    this.cs.forSide = this.coachSide();
    this.coach
      .request<Advice>({
        kind: 'analyze',
        startFen: this.game.startFen,
        moves: this.game.moves(),
        bikjang: this.cfg.rules.bikjang,
        timeMs: this.cfg.coachTimeMs,
        deomSide: this.game.deomSide,
      })
      .then((a) => {
        if (tok !== this.token || this.game.records.length !== ply) return;
        this.cs.advice = a;
        this.cs.adviceLoading = false;
        this.adviceFor = ply;
        this.renderBoard();
        this.renderCoach();
      })
      .catch((err) => {
        if (err instanceof CancelledError) return;
        this.cs.adviceLoading = false;
        this.renderCoach();
      });
  }

  // ---------------------------------------------------------------- 입력

  private onSquare(sq: number) {
    const g = this.game;
    if (g.result || this.thinking || !this.isHumanTurn()) return;
    const p = g.pos.board[sq];
    if (this.selected !== null) {
      const m = makeMove(this.selected, sq);
      if (g.isLegal(m)) {
        this.selected = null;
        this.onUserMove(m);
        return;
      }
    }
    if (p && p >> 3 === g.side) {
      if (this.selected === sq) this.selected = null;
      else {
        this.selected = sq;
        if (!g.movesFrom(sq).length) {
          toast(g.pos.inCheck() ? '장군을 받고 있습니다! 장군을 피하는 수만 둘 수 있습니다.' : '이 기물은 지금 움직일 수 없습니다.');
        }
      }
    } else this.selected = null;
    this.renderBoard();
  }

  private undo() {
    const g = this.game;
    if (!g.records.length) return;
    this.token++;
    this.ai.cancelAll();
    this.coach.cancelAll();
    this.thinking = false;
    clearInterval(this.timer);
    if (this.cfg.mode === 'local') g.undo(1);
    else {
      if (!g.records.some((r) => r.side === this.cfg.userSide)) return;
      while (g.records.length) {
        const last = g.records[g.records.length - 1];
        g.undo(1);
        if (last.side === this.cfg.userSide) break;
      }
    }
    this.cs.history = this.cs.history.filter((r) => r.moveNo <= g.records.length);
    this.cs.review = null;
    this.cs.reviewLoading = false;
    this.cs.advice = null;
    this.adviceFor = -1;
    this.goal = 'pending';
    this.resultShown = false;
    this.renderAll();
    this.next();
  }

  private hint() {
    const g = this.game;
    if (!this.isHumanTurn() || g.result) return;
    if (this.cs.advice && this.adviceFor === g.records.length) {
      const m = this.cs.advice.bestMove;
      this.showHint(m);
      return;
    }
    const tok = this.token;
    const ply = g.records.length;
    toast('좋은 수를 찾는 중…');
    this.coach
      .request<{ move: number }>({
        kind: 'hint',
        startFen: g.startFen,
        moves: g.moves(),
        bikjang: this.cfg.rules.bikjang,
        timeMs: 1500,
      })
      .then((r) => {
        if (tok !== this.token || g.records.length !== ply) return;
        this.showHint(r.move);
      })
      .catch(() => {});
  }

  private showHint(m: number) {
    if (!m) return;
    if (m === PASS) {
      toast('힌트: 한수 쉼');
      return;
    }
    this.hintArrow = { from: m >> 7, to: m & 127, kind: 'best' };
    toast(`힌트: ${moveLabel(this.game.pos.board, m)}`);
    this.renderBoard();
  }

  private resign() {
    if (this.game.result) return;
    const side = this.cfg.mode === 'local' ? this.game.side : this.cfg.userSide;
    modal('기권', h('p', null, `${side === CHO ? '초' : '한'}이(가) 기권하시겠습니까?`), [
      { label: '취소' },
      {
        label: '기권',
        primary: true,
        onClick: () => {
          this.token++;
          this.ai.cancelAll();
          this.thinking = false;
          clearInterval(this.timer);
          this.game.resign(side);
          this.checkGoal(side);
          this.next();
        },
      },
    ]);
  }

  private restart() {
    this.app.replace(() => gameScreen(this.app, this.cfg));
  }

  // ---------------------------------------------------------------- 목표 (상황별 대국)

  private checkGoal(lastMover: Side) {
    const sc = this.cfg.scenario;
    if (!sc || this.goal !== 'pending' || this.cfg.userSide !== sc.userSide) return;
    const g = this.game;
    const user = this.cfg.userSide;
    const res = g.result;
    const userMoves = this.userMoveCount();
    const won = res && res.winner === user;
    const lost = res && res.winner !== user;
    let next: GoalStatus = 'pending';
    switch (sc.goal.type) {
      case 'mate':
        if (won && res!.reason === '외통' && userMoves <= sc.goal.within) next = 'success';
        else if (lost || (lastMover === user && userMoves >= sc.goal.within)) next = 'fail';
        break;
      case 'material': {
        const gain = this.pointDiff() - this.goalBase;
        if (won) next = 'success';
        else if (lost) next = 'fail';
        else if (lastMover !== user && gain >= sc.goal.gain) next = 'success';
        else if (lastMover !== user && userMoves >= sc.goal.within) next = 'fail';
        break;
      }
      case 'survive': {
        const loss = this.goalBase - this.pointDiff();
        if (lost || (lastMover !== user && loss > sc.goal.maxLoss)) next = 'fail';
        else if (won || (lastMover !== user && userMoves >= sc.goal.moves)) next = 'success';
        break;
      }
      case 'win':
        if (won) next = 'success';
        else if (res) next = 'fail';
        break;
      case 'play':
        break;
    }
    if (next !== 'pending') {
      this.goal = next;
      if (next === 'success') toast('목표 달성! 잘하셨습니다.', 'info');
      else toast('목표 실패 — 다시 도전해 보세요.', 'warn');
      this.renderGoal();
    }
  }

  // ---------------------------------------------------------------- 렌더링

  private renderAll(animate?: number) {
    this.renderBoard(animate);
    this.renderBars();
    this.renderStatus();
    this.renderControls();
    this.renderCoach();
    this.renderMoves();
    this.renderGoal();
    this.renderThinking();
  }

  private renderBoard(animate?: number) {
    const g = this.game;
    const pos = g.pos;
    const targets = this.selected !== null ? g.movesFrom(this.selected).map((m) => m & 127) : [];
    const arrows: Arrow[] = [];
    let marks: Advice['marks'] = [];
    const adv = this.cs.advice;
    const adviceLive = this.cfg.coach && adv && this.adviceFor === g.records.length && this.isHumanTurn() && !g.result;
    if (adviceLive && this.cs.showArrows) {
      arrows.push(...adv!.arrows);
      marks = adv!.marks;
    }
    if (this.preview && this.preview !== PASS && adviceLive) {
      arrows.push({ from: this.preview >> 7, to: this.preview & 127, kind: 'best' });
    }
    if (this.hintArrow) arrows.push(this.hintArrow);
    const last = g.records.length ? g.records[g.records.length - 1].move : 0;
    const inCheck = pos.inCheck();
    this.board.render(
      {
        board: pos.board,
        flipped: this.flipped,
        selected: this.selected,
        targets,
        lastMove: last,
        checkSq: inCheck ? pos.kingSq[pos.side] : null,
        arrows,
        marks,
      },
      animate,
    );
  }

  private captured(by: Side): number[] {
    return this.game.records.filter((r) => r.side === by && r.captured).map((r) => r.captured);
  }

  private renderBars() {
    const topSide: Side = this.flipped ? CHO : HAN;
    const botSide: Side = otherSide(topSide);
    this.fillBar(this.topBar, topSide);
    this.fillBar(this.bottomBar, botSide);
  }

  private fillBar(el: HTMLElement, side: Side) {
    const g = this.game;
    const turn = !g.result && g.side === side;
    el.className = `pbar ${el.classList.contains('top') ? 'top' : 'bottom'} ${side === CHO ? 'cho' : 'han'} ${turn ? 'turn' : ''}`;
    const caps = this.captured(side);
    const capWrap = h('div', { class: 'caps', 'aria-label': '잡은 기물' });
    for (const p of caps.sort((a, b) => (b & 7) - (a & 7))) {
      const sv = s('svg', { viewBox: '-50 -50 100 100', class: 'cap-piece' });
      sv.append(pieceSvg(p, { scale: 0.9 }));
      capWrap.append(sv);
    }
    const pts = g.points(side);
    el.replaceChildren(
      h('span', { class: `side-chip ${side === CHO ? 'cho' : 'han'}` }, side === CHO ? '楚' : '漢'),
      h(
        'div',
        { class: 'pinfo' },
        h('div', { class: 'pname' }, this.playerName(side), turn ? h('span', { class: 'turn-dot', 'aria-label': '차례' }) : null),
        h('div', { class: 'ppoints' }, `${pts}점${side === g.deomSide ? ' (덤 1.5)' : ''}`),
      ),
      capWrap,
    );
  }

  private renderThinking() {
    if (this.thinking) {
      const sec = ((performance.now() - this.thinkStart) / 1000).toFixed(1);
      this.thinkBadge.textContent = `AI가 생각 중… ${sec}초`;
      this.thinkBadge.classList.add('show');
    } else this.thinkBadge.classList.remove('show');
  }

  private renderStatus() {
    const g = this.game;
    const el = this.statusEl;
    if (g.result) {
      const r = g.result;
      const winText = r.winner === null ? '무승부' : this.cfg.mode === 'local' ? `${r.winner === CHO ? '초' : '한'} 승리` : r.winner === this.cfg.userSide ? '승리!' : '패배';
      el.className = `status-card done ${r.winner === null ? 'draw' : r.winner === this.cfg.userSide || this.cfg.mode === 'local' ? 'win' : 'lose'}`;
      el.replaceChildren(h('div', { class: 'st-main' }, `${winText} · ${r.reason}`), h('div', { class: 'st-sub' }, r.detail ?? ''));
      return;
    }
    const side = g.side;
    const inCheck = g.pos.inCheck();
    const who = this.cfg.mode === 'local' ? `${side === CHO ? '초' : '한'} 차례` : side === this.cfg.userSide ? '내 차례' : '상대 차례';
    el.className = `status-card ${inCheck ? 'check' : ''}`;
    const facing = this.cfg.rules.bikjang && g.pos.kingsFacing();
    el.replaceChildren(
      h('div', { class: 'st-main' }, `${who}${inCheck ? ' — 장군을 받고 있습니다!' : ''}`),
      h(
        'div',
        { class: 'st-sub' },
        facing ? '빅장 상태입니다. 이번 수에 피하지 않으면 무승부가 됩니다.' : `${g.records.length}수 진행${this.cfg.rules.moveLimit ? ` / ${this.cfg.rules.moveLimit}수 제한` : ''}`,
      ),
    );
  }

  private renderControls() {
    const g = this.game;
    const human = this.isHumanTurn() && !this.thinking && !g.result;
    const canUndo = g.records.length > 0 && (this.cfg.mode === 'local' || g.records.some((r) => r.side === this.cfg.userSide));
    const btn = (label: string, onClick: () => void, enabled = true, title?: string) =>
      h('button', { class: 'btn ctrl', onclick: onClick, disabled: !enabled, title: title ?? label }, label);
    const items: (HTMLElement | null)[] = [
      btn('무르기', () => this.undo(), canUndo),
      btn('한수 쉼', () => this.onUserMove(PASS), human && g.canPass(), '장군을 받지 않을 때 차례를 넘깁니다'),
      this.cfg.coach ? null : btn('힌트', () => this.hint(), human),
      btn('판 돌리기', () => {
        this.flipped = !this.flipped;
        this.renderBoard();
        this.renderBars();
      }),
      btn('기권', () => this.resign(), !g.result),
      btn('새 대국', () => this.restart()),
    ];
    this.controlsEl.replaceChildren(...items.filter((x): x is HTMLElement => !!x));
  }

  private renderCoach() {
    if (!this.cfg.coach) return;
    const st = { ...this.cs, waiting: this.cs.waiting && !this.isHumanTurn() };
    if (this.game.result) {
      st.waiting = false;
      st.advice = null;
      st.adviceLoading = false;
    }
    const el = renderCoach(st, {
      onPreview: (m) => {
        this.preview = m;
        this.renderBoard();
      },
      onPlay: (m) => {
        if (this.isHumanTurn() && !this.thinking && this.game.isLegal(m)) this.onUserMove(m);
      },
      onToggleArrows: (v) => {
        this.cs.showArrows = v;
        this.renderBoard();
      },
    });
    if (this.game.result) {
      el.querySelector('.thinking')?.remove();
      el.append(h('div', { class: 'muted small pad' }, '대국이 끝났습니다. 무르기로 되돌려 다른 수를 연구해 볼 수 있습니다.'));
    }
    this.coachEl.replaceChildren(el);
  }

  private renderMoves() {
    const recs = this.game.records;
    this.movesEl.replaceChildren(
      ...recs.map((r, i) =>
        h(
          'li',
          { class: `${r.side === CHO ? 'cho' : 'han'} ${i === recs.length - 1 ? 'last' : ''}` },
          h('span', { class: 'mv-no' }, `${i + 1}`),
          h('span', { class: 'mv-side' }, r.side === CHO ? '초' : '한'),
          h('span', { class: 'mv-not' }, r.notation),
          r.captured ? h('span', { class: 'mv-cap' }, `×${pieceName(r.captured)}`) : null,
          r.check ? h('span', { class: 'mv-check' }, '장군') : null,
        ),
      ),
    );
    if (!recs.length) this.movesEl.append(h('li', { class: 'empty muted' }, '아직 둔 수가 없습니다.'));
    this.movesEl.scrollTop = this.movesEl.scrollHeight;
  }

  private renderGoal() {
    const sc = this.cfg.scenario;
    if (!sc) return;
    const valid = this.cfg.userSide === sc.userSide;
    const statusText = !valid ? '진영을 바꿔 자유 대국 중' : this.goal === 'success' ? '달성!' : this.goal === 'fail' ? '실패' : '진행 중';
    const hints = sc.hints.slice(0, this.hintsShown);
    this.goalEl.className = `goal-card ${this.goal}`;
    const parts: (HTMLElement | null)[] = [
      h(
        'div',
        { class: 'goal-head' },
        h('span', { class: 'goal-cat' }, sc.category),
        h('b', null, sc.title),
        h('span', { class: 'goal-status' }, statusText),
      ),
      valid ? h('div', { class: 'goal-text' }, `목표: ${sc.goalText}`) : null,
      h('details', { class: 'goal-lesson' }, h('summary', null, '이 지형에서 배우는 것'), h('p', null, sc.lesson)),
      hints.length ? h('ul', { class: 'goal-hints' }, ...hints.map((t, i) => h('li', null, `힌트 ${i + 1}: ${t}`))) : null,
      h(
        'div',
        { class: 'goal-actions' },
        this.hintsShown < sc.hints.length
          ? h(
              'button',
              {
                class: 'btn tiny',
                onclick: () => {
                  this.hintsShown++;
                  this.renderGoal();
                },
              },
              '힌트 보기',
            )
          : null,
        h('button', { class: 'btn tiny ghost', onclick: () => this.restart() }, '처음부터 다시'),
      ),
    ];
    this.goalEl.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  }

  private showResult() {
    if (this.resultShown) return;
    this.resultShown = true;
    const r = this.game.result!;
    const local = this.cfg.mode === 'local';
    const title =
      r.winner === null ? '무승부' : local ? `${r.winner === CHO ? '초' : '한'} 승리` : r.winner === this.cfg.userSide ? '승리했습니다!' : '아쉽게 졌습니다';
    const body = h('div', { class: 'result' }, h('p', { class: 'result-reason' }, `${r.reason} — ${r.detail ?? ''}`));
    const pc = this.game.points(CHO);
    const ph = this.game.points(HAN);
    body.append(h('p', { class: 'muted' }, `최종 점수 — 초 ${pc}점 / 한 ${ph}점 · 총 ${this.game.records.length}수`));
    if (this.cs.history.length) {
      const counts = new Map<string, number>();
      for (const e of this.cs.history) counts.set(e.qualityText, (counts.get(e.qualityText) ?? 0) + 1);
      body.append(
        h('h3', null, '내 수 평가 요약'),
        h('div', { class: 'q-summary' }, ...[...counts.entries()].map(([k, v]) => h('span', { class: 'q-chip' }, `${k} ${v}`))),
      );
      const worst = [...this.cs.history].sort((a, b) => b.loss - a.loss)[0];
      if (worst && worst.loss > 90) {
        body.append(h('p', null, `가장 아쉬운 수: ${worst.moveNo}수 ${worst.label} (${worst.qualityText}).${worst.better ? ` 더 좋은 수는 ${worst.better.label}였습니다.` : ''}`));
      }
    }
    setTimeout(
      () =>
        modal(title, body, [
          { label: '판 보기' },
          { label: '처음 화면', onClick: () => this.app.home() },
          { label: '다시 두기', primary: true, onClick: () => this.restart() },
        ]),
      450,
    );
  }
}
