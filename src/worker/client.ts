// 엔진 클라이언트: 워커에 요청을 보내고 Promise로 결과를 받는다.
// 워커를 쓸 수 없는 환경에서는 메인 스레드에서 직접 계산한다.
import type { EngineRequest } from '../engine/service';
import EngineWorker from './engine.worker?worker&inline';

interface Pending {
  req: EngineRequest;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

export class EngineClient {
  private worker: Worker | null = null;
  private ready = false;
  private failed = false;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private queue: number[] = [];
  private fallback: import('../engine/service').EngineService | null = null;
  private busy = false;

  constructor() {
    this.spawn();
  }

  private spawn() {
    this.ready = false;
    try {
      const w = new EngineWorker();
      this.worker = w;
      const timer = setTimeout(() => {
        if (!this.ready) this.useFallback();
      }, 4000);
      w.onmessage = (e) => {
        const d = e.data;
        if (d && d.ready) {
          clearTimeout(timer);
          this.ready = true;
          this.flush();
          return;
        }
        const p = this.pending.get(d.id);
        if (!p) return;
        this.pending.delete(d.id);
        if (d.ok) p.resolve(d.result);
        else p.reject(new Error(d.error));
      };
      w.onerror = () => {
        clearTimeout(timer);
        if (!this.ready) this.useFallback();
      };
    } catch {
      this.useFallback();
    }
  }

  private useFallback() {
    if (this.failed) return;
    this.failed = true;
    try {
      this.worker?.terminate();
    } catch {
      /* 무시 */
    }
    this.worker = null;
    console.warn('[와룡장기] 웹 워커를 사용할 수 없어 메인 스레드에서 계산합니다.');
    for (const id of this.pending.keys()) this.queue.push(id);
    this.runFallbackQueue();
  }

  private async runFallbackQueue() {
    if (this.busy) return;
    this.busy = true;
    if (!this.fallback) {
      const mod = await import('../engine/service');
      this.fallback = new mod.EngineService(18);
    }
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const p = this.pending.get(id);
      if (!p) continue;
      // 화면이 먼저 그려지도록 잠깐 양보
      await new Promise((r) => setTimeout(r, 30));
      if (!this.pending.has(id)) continue;
      try {
        const res = this.fallback.handle(p.req);
        this.pending.delete(id);
        p.resolve(res);
      } catch (err) {
        this.pending.delete(id);
        p.reject(err);
      }
    }
    this.busy = false;
  }

  private flush() {
    if (!this.worker || !this.ready) return;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const p = this.pending.get(id);
      if (p) this.worker.postMessage({ id, req: p.req });
    }
  }

  request<T>(req: EngineRequest): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { req, resolve: resolve as (v: unknown) => void, reject });
      this.queue.push(id);
      if (this.failed) this.runFallbackQueue();
      else this.flush();
    });
  }

  /** 상대(사람)가 생각하는 동안 미리 계산 — 다음 요청이 오면 워커가 스스로 멈춘다 */
  ponder(req: EngineRequest & { kind: 'ponder' }) {
    if (this.failed || !this.worker || !this.ready) return;
    this.worker.postMessage({ ponder: req });
  }

  stopPonder() {
    if (this.worker && this.ready) this.worker.postMessage({ stopPonder: true });
  }

  /** 진행 중인 모든 계산을 취소 (워커를 새로 띄움) */
  cancelAll() {
    for (const p of this.pending.values()) p.reject(new CancelledError());
    this.pending.clear();
    this.queue = [];
    if (!this.failed && this.worker) {
      this.worker.terminate();
      this.spawn();
    }
  }

  get usingFallback() {
    return this.failed;
  }
}

let aiClient: EngineClient | null = null;
let coachClient: EngineClient | null = null;
export function getAiClient() {
  return (aiClient ??= new EngineClient());
}
export function getCoachClient() {
  return (coachClient ??= new EngineClient());
}
