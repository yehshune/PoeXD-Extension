import { bootstrapBridge, type MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import { initPoeEventNonce } from '@/utils/event-contracts';

let testBridgeNonceSeq = 0;

/**
 * 在測試環境中重新安裝真實的 MainWorldBridge 並完成 nonce 握手。
 * 每次呼叫使用唯一 nonce，確保前一個測試殘留的 window listener 不會干擾目前測試。
 */
export function setupTestMainWorldBridge(prefix = 'poexd-test-rpc'): MainWorldBridge {
  delete window.__poexdInterceptorInstalled;
  delete window.__poexdUpdateNonce;
  if (window.history) {
    delete window.history.__poexdHistoryPatched;
  }

  const nonce = `${prefix}-${++testBridgeNonceSeq}`;
  initPoeEventNonce(nonce);

  const script = document.createElement('script');
  script.setAttribute('data-nonce', nonce);
  Object.defineProperty(document, 'currentScript', {
    value: script,
    configurable: true,
  });

  const bridge = bootstrapBridge({ windowObj: window, documentObj: document });
  if (!bridge) {
    throw new Error('Failed to bootstrap test MainWorldBridge');
  }
  return bridge;
}
