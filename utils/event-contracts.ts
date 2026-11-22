import { isPoeContentInternalEventType, type PoeEventMap } from './event-protocol-types';

export * from './event-protocol-types';

// -------------------------------------------------------------
// Content World Mutable Runtime State & Dispatch / Listen Facade
// -------------------------------------------------------------

let activeNonce: string | null = null;

/**
 * 內部事件專用的私有匯流排。只存在於本模組（擴充隔離世界），
 * 網頁的 Main World 腳本拿不到這個物件，因此無法監聽或偽造內部事件。
 */
const internalEventBus = new EventTarget();

export function initPoeEventNonce(nonce: string) {
  activeNonce = nonce;
}

export function dispatchPoeEvent<K extends keyof PoeEventMap>(
  type: K,
  ...args: PoeEventMap[K] extends void ? [] : [detail: PoeEventMap[K]]
) {
  if (isPoeContentInternalEventType(type)) {
    internalEventBus.dispatchEvent(new CustomEvent(type, { detail: args[0] }));
    return;
  }
  window.dispatchEvent(
    new CustomEvent(type, {
      detail: {
        source: 'poexd',
        nonce: activeNonce,
        payload: args[0],
      },
    }),
  );
}

export function listenPoeEvent<K extends keyof PoeEventMap>(
  type: K,
  listener: (detail: PoeEventMap[K]) => void,
) {
  if (isPoeContentInternalEventType(type)) {
    const internalHandler = ((event: CustomEvent<PoeEventMap[K]>) => {
      listener(event.detail);
    }) as EventListener;
    internalEventBus.addEventListener(type, internalHandler);
    return () => internalEventBus.removeEventListener(type, internalHandler);
  }
  let active = true;
  const handler = ((event: CustomEvent<any>) => {
    const payload = readTrustedPayload(event);
    if (payload !== NOT_TRUSTED) listener(payload as PoeEventMap[K]);
  }) as EventListener;
  window.addEventListener(type, handler);
  replayBufferedEvents(type, (payload) => {
    if (active) listener(payload as PoeEventMap[K]);
  });
  return () => {
    active = false;
    window.removeEventListener(type, handler);
  };
}

const NOT_TRUSTED = Symbol('not-trusted');

/** 只接受帶有本次 nonce 的 Main World 事件，其餘（網頁偽造或舊的 interceptor）一律忽略 */
function readTrustedPayload(event: Event): unknown {
  const data = (event as CustomEvent<any>).detail;
  if (!data || data.source !== 'poexd' || data.nonce !== activeNonce) return NOT_TRUSTED;
  return data.payload;
}

// -------------------------------------------------------------
// 初始化期間的事件緩衝
// -------------------------------------------------------------

interface BufferedPoeEvent {
  readonly type: string;
  readonly payload: unknown;
}

interface PoeEventBuffer {
  readonly types: ReadonlySet<string>;
  readonly events: BufferedPoeEvent[];
}

let eventBuffer: PoeEventBuffer | null = null;

/** 緩衝上限：初始化期間只需要首批搜尋與結果，超過就不再記錄，避免頁面長時間未就緒時累積 */
export const POE_EVENT_BUFFER_LIMIT = 50;

/**
 * 開始緩衝 Main World 事件，直到回傳的函式被呼叫為止。
 *
 * 攔截器要盡早注入才不會漏掉官方首批 search / fetch，但各功能的監聽要等偏好設定等非同步初始化完成才註冊。
 * 緩衝期間新註冊的 `listenPoeEvent` 監聽，會先收到它註冊前已發生的同類事件（各一次），之後照常即時接收。
 * 需在 `initPoeEventNonce` 之後呼叫；重複呼叫會取代先前的緩衝。
 */
export function startPoeEventBuffer(
  types: readonly (keyof PoeEventMap)[],
  limit = POE_EVENT_BUFFER_LIMIT,
): () => void {
  const buffer: PoeEventBuffer = { types: new Set(types), events: [] };
  const record = (event: Event) => {
    if (eventBuffer !== buffer || buffer.events.length >= limit) return;
    const payload = readTrustedPayload(event);
    if (payload === NOT_TRUSTED) return;
    buffer.events.push({ type: event.type, payload });
  };
  // capture 階段先記錄，確保同一事件不會在「已即時送達」之後又被補送給剛註冊的監聽
  buffer.types.forEach((type) => window.addEventListener(type, record, true));
  eventBuffer = buffer;
  return () => {
    buffer.types.forEach((type) => window.removeEventListener(type, record, true));
    buffer.events.length = 0;
    if (eventBuffer === buffer) eventBuffer = null;
  };
}

function replayBufferedEvents(type: string, deliver: (payload: unknown) => void): void {
  const buffer = eventBuffer;
  if (!buffer?.types.has(type)) return;
  const pending = buffer.events.filter((event) => event.type === type).map((e) => e.payload);
  if (pending.length === 0) return;
  // 下一個 microtask 才補送：呼叫端通常要先保存 listenPoeEvent 回傳的清理函式。
  // 註冊當下就取好快照，之後的事件只走即時路徑，所以每個事件只會送達一次。
  queueMicrotask(() => pending.forEach(deliver));
}
