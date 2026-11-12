import { defineContentScript } from 'wxt/utils/define-content-script';
import { startMarketTranslationPage } from '@/utils/market-translation-page';
import {
  MARKET_TRANSLATION_MATCH_PATTERNS,
  MARKET_TRANSLATION_TIMEOUT_MS,
} from '@/utils/market-translation-protocol';

/**
 * 市集漢化 MAIN world 腳本（ADR-0012）。由 manifest 宣告在 document_start 執行，
 * 保證早於官網 bundle 的第一次 data API 請求（既有 interceptor.js 是非同步注入，無法保證）。
 */
export default defineContentScript({
  matches: MARKET_TRANSLATION_MATCH_PATTERNS,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startMarketTranslationPage(window, { timeoutMs: MARKET_TRANSLATION_TIMEOUT_MS });
  },
});
