/**
 * Result Enhancement Host 唯一對外副作用 seam（`ResultEnhancementHostPort`）。
 *
 * 正式環境由瀏覽器 adapter 接上匯率、釘選、Criteria Overlay、字典、剪貼簿、開新分頁與 Toast；
 * 測試環境注入 in-memory fake adapter 與 `happy-dom` 的 `Document`，無需 mock 內部類別或全域變數。
 */
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { loadExtensionJson } from '@/utils/extension-json-cache';
import { extensionMessaging } from '@/utils/extension-protocol';
import { getKnownStatsRef } from '@/utils/known-stats-store';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { createPinnedItemClient, type PinnedItemClient } from '@/utils/pinned-item-client';
import type { PobTextLexicon } from '@/utils/pob-item-text';
import { loadPobTextLexicon } from '@/utils/pob-text-lexicon';
import { parseCurrencyRateSnapshot, type CurrencyRateSnapshot } from '@/utils/price-comparison';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import { isPriceConversionSupported } from '@/utils/trade-realms';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';
import {
  createPoeEventCriteriaOverlayChannel,
  type CriteriaOverlayPageChannel,
} from './criteria-overlay-manager';

export type ResultEnhancementToastTone = 'default' | 'success' | 'error';

export interface ResultEnhancementPageContext {
  origin: string;
  href: string;
  league: string | undefined;
  pageLocale: string;
  isPriceConversionSupported: boolean;
}

export interface ResultEnhancementOverlayChannel extends CriteriaOverlayPageChannel {
  resolveStatText(statId: string): string | undefined;
  isSearchFormUrl(url: string): boolean;
}

export interface ResultFetchBatch {
  searchId: string;
  league: string | undefined;
  results: readonly unknown[];
  isNewSearch: boolean;
}

export interface ResultEnhancementHostPort {
  doc: Document;
  loadRates(league: string): Promise<CurrencyRateSnapshot | undefined>;
  pinnedItems: PinnedItemClient;
  overlayChannel: ResultEnhancementOverlayChannel;
  loadLexicon(version: PoeVersion, locale: string): Promise<PobTextLexicon>;
  writeClipboard(text: string): Promise<void>;
  openUrl(url: string): void;
  notify(message: string, tone: ResultEnhancementToastTone): void;
  getPageContext(): ResultEnhancementPageContext;
  now?: () => number;
}

export async function fetchCurrencyRates(
  version: PoeVersion,
  league: string,
  messenger = extensionMessaging,
): Promise<CurrencyRateSnapshot | undefined> {
  try {
    const response = await messenger.sendMessage('economy:fetchCurrencyRates', {
      version,
      league,
    });
    return response?.success ? parseCurrencyRateSnapshot(response.data) : undefined;
  } catch {
    return undefined;
  }
}

export function createBrowserResultEnhancementHostPort(
  version: PoeVersion,
  overrides: Partial<ResultEnhancementHostPort> = {},
): ResultEnhancementHostPort {
  const baseChannel = createPoeEventCriteriaOverlayChannel();
  return {
    doc: document,
    loadRates: (league) => fetchCurrencyRates(version, league),
    pinnedItems: createPinnedItemClient(version),
    overlayChannel: {
      read: () => baseChannel.read(),
      commit: (ops) => baseChannel.commit(ops),
      resolveStatText: (statId) => getKnownStatsRef().value[statId]?.text,
      isSearchFormUrl: isTradeSearchFormUrl,
    },
    loadLexicon: (v, locale) => loadPobTextLexicon(loadExtensionJson, { version: v, locale }),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
    openUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    notify: (message, tone) => dispatchPoeEvent('poexd-toast', { message, tone }),
    getPageContext: () => ({
      origin: window.location.origin,
      href: window.location.href,
      league: getTradeLeague(),
      pageLocale: resolvePageLocale(),
      isPriceConversionSupported: isPriceConversionSupported(),
    }),
    now: () => Date.now(),
    ...overrides,
  };
}
