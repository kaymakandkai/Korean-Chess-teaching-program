/// <reference lib="webworker" />
// 엔진 워커: 무거운 탐색을 UI와 분리된 스레드에서 실행한다
import { EngineRequest, EngineService } from '../engine/service';

let service: EngineService | null = null;
let ponderReq: (EngineRequest & { kind: 'ponder' }) | null = null;
let ponderScheduled = false;

function getService(req: EngineRequest) {
  // AI 워커는 더 큰 치환표(약 27MB), 코치 워커는 기본 크기
  return (service ??= new EngineService(req.kind === 'aiMove' || req.kind === 'ponder' ? 21 : 20));
}

/** 선읽기: 짧은 조각으로 나눠 계산하므로 새 요청이 오면 곧바로 멈춘다 */
function ponderStep() {
  ponderScheduled = false;
  if (!ponderReq) return;
  try {
    getService(ponderReq).ponderChunk(ponderReq, 200);
  } catch {
    ponderReq = null;
    return;
  }
  schedulePonder();
}
function schedulePonder() {
  if (ponderScheduled || !ponderReq) return;
  ponderScheduled = true;
  setTimeout(ponderStep, 0);
}

self.onmessage = (e: MessageEvent<{ id?: number; req?: EngineRequest; ponder?: EngineRequest; stopPonder?: boolean }>) => {
  const d = e.data;
  if (d.stopPonder) {
    ponderReq = null;
    return;
  }
  if (d.ponder && d.ponder.kind === 'ponder') {
    ponderReq = d.ponder;
    schedulePonder();
    return;
  }
  if (!d.req) return;
  ponderReq = null; // 실제 요청이 오면 선읽기 중단
  const { id, req } = d;
  try {
    const result = getService(req).handle(req);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};

(self as unknown as Worker).postMessage({ ready: true });
