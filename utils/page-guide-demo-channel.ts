import {
  dispatchPoeEvent,
  listenPoeEvent,
  parsePoePageGuideDemoResult,
  serializePoePageGuideDemo,
  type PoePageGuideDemoPayload,
} from './event-contracts';

const DEFAULT_TIMEOUT_MS = 3000;

export type PageGuideDemoAction = PoePageGuideDemoPayload['action'];

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/**
 * 請官方頁面（Main World）加入或還原導覽用的示範條件。
 * 成功回傳 true；頁面拒絕或逾時回傳 false，呼叫端照常繼續導覽即可。
 */
export function requestPageGuideDemo(
  action: PageGuideDemoAction,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  const requestId = createRequestId();
  return new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      stop();
      resolve(ok);
    };
    const stop = listenPoeEvent('poexd-page-guide-demo-result', (detail) => {
      const result = parsePoePageGuideDemoResult(detail);
      if (result?.requestId === requestId) finish(result.success);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    dispatchPoeEvent('poexd-page-guide-demo', serializePoePageGuideDemo({ requestId, action }));
  });
}
