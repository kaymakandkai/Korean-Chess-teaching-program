/// <reference lib="webworker" />
// 엔진 워커: 무거운 탐색을 UI와 분리된 스레드에서 실행한다
import { EngineRequest, EngineService } from '../engine/service';

const service = new EngineService(20);

self.onmessage = (e: MessageEvent<{ id: number; req: EngineRequest }>) => {
  const { id, req } = e.data;
  try {
    const result = service.handle(req);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};

(self as unknown as Worker).postMessage({ ready: true });
