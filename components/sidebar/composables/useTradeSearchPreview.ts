import { computed, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type { PoeVersion } from '@/utils/trade-context';
import {
  decodeTradeSearchUrl,
  extractQueryMetadata,
  type ExtractedQueryMetadata,
} from '@/utils/trade-url-codec';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { getTradeRealmLabel } from '@/utils/trade-realm-labels';
import {
  criteriaFromTradeQuery,
  sliceOverlayCriteria,
  type OverlayCriteria,
  type OverlayTarget,
} from '@/utils/criteria-overlay';
import {
  areTradeQueriesEqual,
  cloneTradeQuery,
  setTradeQueryStatus,
  setTradeStatFilterBound,
  setTradeStatFilterDisabled,
  setTradeStatFilterDomain,
  setTradeStatGroupBound,
  setTradeStatGroupDisabled,
  setTradeStatGroupType,
  type StatGroupType,
} from '@/utils/trade-query-tuning';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';
import type { CriteriaOverlayManager } from '@/entrypoints/content/logic/criteria-overlay-manager';
import { t } from '@/utils/i18n';

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

export interface UsePinnedPreviewOptions<T> {
  /** 為 true 時不能開啟，已開啟的也會關閉（例如拖曳或編輯中）。 */
  disabled?: Ref<boolean>;
  onOpen?: (item: T) => void;
  onClose?: (item: T) => void;
}

/**
 * 側邊欄清單共用的單例 Search Preview 狀態：點擊切換、同一時間只開一個（見 GLOSSARY.md「Search Preview」）。
 * 點同一筆再點一次關閉；點另一筆則直接切換到該筆。
 */
export function usePinnedPreview<T extends { id: string }>(
  options: UsePinnedPreviewOptions<T> = {},
) {
  const activeItem = shallowRef<T | null>(null);
  const anchorEl = ref<HTMLElement | null>(null);
  const isOpen = computed(() => activeItem.value !== null);

  const close = () => {
    const previous = activeItem.value;
    activeItem.value = null;
    anchorEl.value = null;
    if (previous) options.onClose?.(previous);
  };

  const toggle = (item: T, anchor: HTMLElement | null) => {
    if (options.disabled?.value || !anchor) return;
    if (activeItem.value?.id === item.id) {
      close();
      return;
    }
    activeItem.value = item;
    anchorEl.value = anchor;
    options.onOpen?.(item);
  };

  if (options.disabled) {
    watch(options.disabled, (isDisabled) => {
      if (isDisabled) close();
    });
  }

  return { activeItem, anchorEl, isOpen, toggle, close };
}

/** 以點擊目標所在的整列作為預覽錨點，讓 Popover 對齊整列而不是按鈕。 */
export function rowAnchorFromEvent(event: Event, rowSelector: string): HTMLElement | null {
  const target = event.currentTarget as HTMLElement | null;
  return target?.closest<HTMLElement>(rowSelector) ?? target;
}

export interface UseTradeSearchPreviewOptions {
  version?: PoeVersion | Ref<PoeVersion>;
  disabled?: Ref<boolean>;
}

/**
 * 統一的 Search Preview module：負責網址按需解碼、快取、競態保護，並內建單例點擊切換狀態。
 * - LiveSearchPrimaryPane（懸停預覽）使用 `loadPreview` / `clearActivePreview` / `activePreviewData`。
 * - BookmarkPane 與 HistoryPane（單例釘選預覽）使用 `toggle` / `close` / `activeItem` / `anchorEl` / `isOpen`。
 */
export function useTradeSearchPreview<
  T extends { id: string; url: string } = { id: string; url: string },
>(options?: UseTradeSearchPreviewOptions) {
  const disabled = options?.disabled;
  const version = options?.version;
  const previewCache = new Map<string, TradeSearchPreviewData>();
  const rawQueryCache = new Map<string, Record<string, unknown> | null>();

  const activeEntityKey = ref<string | null>(null);
  const activePreviewData = ref<TradeSearchPreviewData | null>(null);
  const activeRawQuery = ref<Record<string, unknown> | null>(null);
  let currentRequestId = 0;

  const loadPreview = async (entityKey: string, url: string) => {
    if (disabled?.value) return;

    const requestId = ++currentRequestId;
    activeEntityKey.value = entityKey;

    if (previewCache.has(url)) {
      activePreviewData.value = previewCache.get(url)!;
      activeRawQuery.value = rawQueryCache.get(url) ?? null;
      return;
    }

    const realmLabel = getTradeRealmLabel(url);
    const realm = realmLabel ? { realmLabel } : {};
    activePreviewData.value = { loading: true, ...realm };
    activeRawQuery.value = null;

    try {
      const decoded = await decodeTradeSearchUrl(url);
      let item: TradeSearchPreviewData;
      let rawQuery: Record<string, unknown> | null = null;
      if (decoded?.query) {
        const gameVersion = decoded.gameVersion || (version ? toValue(version) : 'poe1');
        await loadTradeDictionaries(gameVersion);
        const meta = extractQueryMetadata(decoded.query, gameVersion);
        rawQuery =
          typeof decoded.query === 'object' &&
          decoded.query !== null &&
          !Array.isArray(decoded.query)
            ? (decoded.query as Record<string, unknown>)
            : null;
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
      rawQueryCache.set(url, rawQuery);

      if (requestId === currentRequestId && activeEntityKey.value === entityKey) {
        activePreviewData.value = item;
        activeRawQuery.value = rawQuery;
      }
    } catch {
      const errItem: TradeSearchPreviewData = { loading: false, isLegacy: true, ...realm };
      previewCache.set(url, errItem);
      rawQueryCache.set(url, null);
      if (requestId === currentRequestId && activeEntityKey.value === entityKey) {
        activePreviewData.value = errItem;
        activeRawQuery.value = null;
      }
    }
  };

  const clearActivePreview = (entityKey?: string) => {
    if (!entityKey || activeEntityKey.value === entityKey) {
      currentRequestId++;
      activeEntityKey.value = null;
      activePreviewData.value = null;
      activeRawQuery.value = null;
    }
  };

  const pinned = usePinnedPreview<T>({
    disabled,
    onOpen: (entry) => void loadPreview(entry.id, entry.url),
    onClose: (entry) => clearActivePreview(entry.id),
  });

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
    activeRawQuery,
    loadPreview,
    clearActivePreview,
    previewCache,
    activeItem: pinned.activeItem,
    anchorEl: pinned.anchorEl,
    isOpen: pinned.isOpen,
    toggle: pinned.toggle,
    close: pinned.close,
  };
}

export interface UseSearchPreviewDraftOptions {
  open: MaybeRefOrGetter<boolean>;
  previewData: MaybeRefOrGetter<TradeSearchPreviewData | null>;
  rawQuery: MaybeRefOrGetter<Record<string, unknown> | null>;
  reference?: MaybeRefOrGetter<HTMLElement | null>;
  sourceName: MaybeRefOrGetter<string>;
  canOpenSearch: MaybeRefOrGetter<boolean>;
  tunable: MaybeRefOrGetter<boolean>;
  manager: CriteriaOverlayManager;
  readUrl: () => string;
}

/**
 * Search Preview 內的暫存微調草稿與 Criteria Overlay 資格狀態機。
 * 依目標暫存於工作階段，避免誤點外部關閉視窗遺失調整。
 */
export function useSearchPreviewDraft(options: UseSearchPreviewDraftOptions) {
  const draftsByKey = new Map<string, Record<string, unknown>>();
  const draftQuery = ref<Record<string, unknown> | null>(null);

  const currentDraftKey = () => {
    const raw = toValue(options.rawQuery);
    return raw ? `${toValue(options.sourceName)}\u0000${JSON.stringify(raw)}` : '';
  };

  const resetTune = () => {
    const key = currentDraftKey();
    if (key) draftsByKey.delete(key);
    draftQuery.value = cloneTradeQuery(toValue(options.rawQuery));
  };

  watch(
    [
      () => toValue(options.open),
      () => toValue(options.rawQuery),
      () => (options.reference ? toValue(options.reference) : null),
    ],
    ([open]) => {
      if (!open) {
        draftQuery.value = null;
        return;
      }
      const raw = toValue(options.rawQuery);
      const key = currentDraftKey();
      const saved = key ? draftsByKey.get(key) : undefined;
      draftQuery.value = saved ? cloneTradeQuery(saved) : cloneTradeQuery(raw);
    },
    { immediate: true },
  );

  const isModified = computed(() => {
    const raw = toValue(options.rawQuery);
    return Boolean(draftQuery.value && raw && !areTradeQueriesEqual(draftQuery.value, raw));
  });

  const canTune = computed(() => {
    const data = toValue(options.previewData);
    return Boolean(
      (toValue(options.canOpenSearch) || toValue(options.tunable)) &&
      draftQuery.value &&
      !data?.loading &&
      !data?.isLegacy,
    );
  });

  const effectivePreviewData = computed<TradeSearchPreviewData | null>(() => {
    const base = toValue(options.previewData);
    if (!base || !isModified.value || !draftQuery.value) return base;
    return {
      ...base,
      criteria: criteriaFromTradeQuery(draftQuery.value),
    };
  });

  function applyTune(mutator: (current: Record<string, unknown>) => Record<string, unknown>): void {
    if (!draftQuery.value) return;
    const next = mutator(draftQuery.value);
    draftQuery.value = next;
    const key = currentDraftKey();
    if (!key) return;
    const raw = toValue(options.rawQuery);
    if (raw && areTradeQueriesEqual(next, raw)) {
      draftsByKey.delete(key);
    } else {
      const cloned = cloneTradeQuery(next);
      if (cloned) draftsByKey.set(key, cloned);
    }
  }

  function getModifiedQuery(): Record<string, unknown> | null {
    return isModified.value && draftQuery.value ? cloneTradeQuery(draftQuery.value) : null;
  }

  function consumeDraftForOverwrite(): Record<string, unknown> | null {
    if (!isModified.value || !draftQuery.value) return null;
    const cloned = cloneTradeQuery(draftQuery.value);
    const key = currentDraftKey();
    if (key) draftsByKey.delete(key);
    return cloned;
  }

  /** 每次開啟時重新判斷目前頁面是否有可寫入的官方搜尋表單。 */
  const pageHasForm = ref(false);
  watch(
    () => toValue(options.open),
    (open) => {
      if (open) pageHasForm.value = isTradeSearchFormUrl(options.readUrl());
    },
    { immediate: true },
  );

  const canOverlay = computed(() => {
    const data = effectivePreviewData.value;
    if (!pageHasForm.value || !data?.criteria || data.loading) return false;
    return !data.gameVersion || data.gameVersion === options.manager.version;
  });

  const overlayHint = computed(() => {
    const data = effectivePreviewData.value;
    if (canOverlay.value || !data?.criteria || data.loading) return '';
    if (!pageHasForm.value) return t('searchPreview.hint.notOnSearchPage');
    return t('searchPreview.hint.versionMismatch');
  });

  function overlay(target: OverlayTarget): void {
    const criteria = effectivePreviewData.value?.criteria;
    if (!criteria) return;
    void options.manager.overlay(
      sliceOverlayCriteria(criteria, target),
      toValue(options.sourceName) || t('common.searchPreview'),
    );
  }

  return {
    draftQuery,
    isModified,
    canTune,
    effectivePreviewData,
    canOverlay,
    overlayHint,
    resetTune,
    getModifiedQuery,
    consumeDraftForOverwrite,
    overlay,
    setStatus: (status: string) => applyTune((q) => setTradeQueryStatus(q, status)),
    setStatGroupDisabled: (idx: number, disabled: boolean) =>
      applyTune((q) => setTradeStatGroupDisabled(q, idx, disabled)),
    setStatGroupBound: (idx: number, bound: 'min' | 'max', val: number | null) =>
      applyTune((q) => setTradeStatGroupBound(q, idx, bound, val)),
    setStatGroupType: (idx: number, type: StatGroupType) =>
      applyTune((q) => setTradeStatGroupType(q, idx, type)),
    setStatFilterDisabled: (gIdx: number, fIdx: number, disabled: boolean) =>
      applyTune((q) => setTradeStatFilterDisabled(q, gIdx, fIdx, disabled)),
    setStatFilterBound: (gIdx: number, fIdx: number, bound: 'min' | 'max', val: number | null) =>
      applyTune((q) => setTradeStatFilterBound(q, gIdx, fIdx, bound, val)),
    setStatFilterDomain: (gIdx: number, fIdx: number, domain: string, allowed: readonly string[]) =>
      applyTune((q) => setTradeStatFilterDomain(q, gIdx, fIdx, domain, allowed)),
  };
}
