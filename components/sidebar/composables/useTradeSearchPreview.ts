import { ref, toValue, watch, type Ref } from 'vue';
import type { PoeVersion } from '@/utils/trade-context';
import {
  decodeTradeSearchUrl,
  extractQueryMetadata,
  type ExtractedQueryMetadata,
} from '@/utils/trade-url-codec';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { getTradeRealmLabel } from '@/utils/trade-realm-labels';
import { criteriaFromTradeQuery, type OverlayCriteria } from '@/utils/criteria-overlay';

export interface TradeSearchPreviewData {
  loading: boolean;
  isLegacy?: boolean;
  gameVersion?: PoeVersion;
  /** 搜尋網址所屬網域的顯示名稱（國際服／台服／QQ） */
  realmLabel?: string;
  league?: string;
  meta?: ExtractedQueryMetadata;
  /** 依群組保留的完整條件，供 Criteria Overlay 使用。 */
  criteria?: OverlayCriteria;
}

export type HoverPreviewData = TradeSearchPreviewData;

export interface UseTradeSearchPreviewOptions {
  version?: PoeVersion | Ref<PoeVersion>;
  disabled?: Ref<boolean>;
}

export function useTradeSearchPreview(options?: UseTradeSearchPreviewOptions) {
  const disabled = options?.disabled;
  const version = options?.version;
  const previewCache = new Map<string, TradeSearchPreviewData>();

  const activeEntityKey = ref<string | null>(null);
  const activePreviewData = ref<TradeSearchPreviewData | null>(null);
  let currentRequestId = 0;

  const loadPreview = async (entityKey: string, url: string) => {
    if (disabled?.value) return;

    const requestId = ++currentRequestId;
    activeEntityKey.value = entityKey;

    if (previewCache.has(url)) {
      activePreviewData.value = previewCache.get(url)!;
      return;
    }

    const realmLabel = getTradeRealmLabel(url);
    const realm = realmLabel ? { realmLabel } : {};
    activePreviewData.value = { loading: true, ...realm };

    try {
      const decoded = await decodeTradeSearchUrl(url);
      let item: TradeSearchPreviewData;
      if (decoded?.query) {
        const gameVersion = decoded.gameVersion || (version ? toValue(version) : 'poe1');
        await loadTradeDictionaries(gameVersion);
        const meta = extractQueryMetadata(decoded.query, gameVersion);
        item = {
          loading: false,
          gameVersion: decoded.gameVersion,
          ...realm,
          league: decoded.league,
          meta,
          criteria: criteriaFromTradeQuery(decoded.query),
        };
      } else {
        item = { loading: false, isLegacy: true, ...realm };
      }

      previewCache.set(url, item);

      if (requestId === currentRequestId && activeEntityKey.value === entityKey) {
        activePreviewData.value = item;
      }
    } catch {
      const errItem: TradeSearchPreviewData = { loading: false, isLegacy: true, ...realm };
      previewCache.set(url, errItem);
      if (requestId === currentRequestId && activeEntityKey.value === entityKey) {
        activePreviewData.value = errItem;
      }
    }
  };

  const clearActivePreview = (entityKey?: string) => {
    if (!entityKey || activeEntityKey.value === entityKey) {
      currentRequestId++;
      activeEntityKey.value = null;
      activePreviewData.value = null;
    }
  };

  if (disabled) {
    watch(disabled, (val) => {
      if (val) {
        clearActivePreview();
      }
    });
  }

  return {
    activeEntityKey,
    activePreviewData,
    loadPreview,
    clearActivePreview,
    previewCache,
  };
}
