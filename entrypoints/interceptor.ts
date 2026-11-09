import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import {
  classifyTradeDocumentSync,
  waitForDocumentBoundary,
} from '@/utils/trade-interstitial-classifier';
import { bootstrapBridge, type MainWorldBridge } from './main-world/bridge-bootstrap';
import { initDomTagger, syncDomTaggerRoute } from './main-world/dom-tagger';
import { initCriteriaOverlayAdapter } from './main-world/criteria-overlay-adapter';
import { initNetworkObserver } from './main-world/network-observer';
import { initOfficialLiveSearchAdapter } from './main-world/official-livesearch-adapter';
import { initPoeRuntimeMutation } from './main-world/poe-runtime-mutation';
import { initPoeRuntimeReader } from './main-world/poe-runtime-reader';

export function runInterceptorBootstrap(options?: {
  documentObj?: Document;
  windowObj?: Window;
}): MainWorldBridge | null {
  const doc = options?.documentObj || (typeof document !== 'undefined' ? document : undefined);
  const win = options?.windowObj || (typeof window !== 'undefined' ? window : undefined);

  // 同步 defensive gate：若此時已判定為 challenge，立即 abort
  const initialStatus = classifyTradeDocumentSync(doc, win?.location);
  if (initialStatus === 'challenge') {
    console.warn(
      '[PoeXD] Cloudflare challenge detected in Main World. Aborting interceptor bootstrap.',
    );
    return null;
  }

  // 同步執行 bootstrapBridge，確保此時 document.currentScript 處於原始 execution context
  const bridge = bootstrapBridge({
    windowObj: win,
    documentObj: doc,
    onRouteSync: syncDomTaggerRoute,
  });

  if (!bridge) {
    return null;
  }

  initNetworkObserver(bridge);
  initPoeRuntimeReader(bridge);
  initPoeRuntimeMutation(bridge);
  initCriteriaOverlayAdapter(bridge);
  initOfficialLiveSearchAdapter(bridge);
  initDomTagger(bridge);

  return bridge;
}

export default defineUnlistedScript(() => {
  runInterceptorBootstrap();
});
