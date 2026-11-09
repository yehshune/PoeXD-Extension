import '@/assets/main.css';
import { getPoeVersion } from '@/utils/trade-context';
import { TRADE_PAGE_MATCH_PATTERNS } from '@/utils/trade-realms';
import { runLogic } from './logic/runtime';
import { waitForDocumentBoundary } from '@/utils/trade-interstitial-classifier';

export default defineContentScript({
  matches: [...TRADE_PAGE_MATCH_PATTERNS],
  runAt: 'document_start', // 需提早執行以注入 API 攔截器
  cssInjectionMode: 'ui',

  async main(ctx) {
    const boundary = await waitForDocumentBoundary(document, window.location);
    if (boundary === 'challenge') {
      console.log(
        '[PoeXD] Cloudflare challenge / interstitial document detected; passing through.',
      );
      return;
    }

    await runLogic(ctx, getPoeVersion());
  },
});
