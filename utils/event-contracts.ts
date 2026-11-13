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
  const handler = ((event: CustomEvent<any>) => {
    const data = event.detail;
    if (!data || data.source !== 'poexd' || data.nonce !== activeNonce) {
      return;
    }
    listener(data.payload);
  }) as EventListener;
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}
