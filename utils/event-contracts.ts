import type { PoeEventMap } from './event-protocol-types';

export * from './event-protocol-types';

// -------------------------------------------------------------
// Content World Mutable Runtime State & Dispatch / Listen Facade
// -------------------------------------------------------------

let activeNonce: string | null = null;

export function initPoeEventNonce(nonce: string) {
  activeNonce = nonce;
}

export function dispatchPoeEvent<K extends keyof PoeEventMap>(
  type: K,
  ...args: PoeEventMap[K] extends void ? [] : [detail: PoeEventMap[K]]
) {
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
