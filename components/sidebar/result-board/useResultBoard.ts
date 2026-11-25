/**
 * 搜尋結果看板 pane 的狀態與動作。看板資料與前往狀態來自 `ResultBoardRuntime`，
 * 投影計算統一委託給 `board-projection`，篩選、排序、勾選等檢視狀態只存在這個 pane 的記憶體。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import {
  getResultBoardRuntime,
  OFFICIAL_RESULT_CAP,
  type ResultBoardRuntime,
  type TravelOutcome,
} from '@/entrypoints/content/logic/result-board-runtime';
import { useCurrencyRates } from '@/components/sidebar/composables/useCurrencyRates';
import { useDebouncedRef } from '@/components/sidebar/composables/useDebouncedSearch';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t, type I18nKey } from '@/utils/i18n';
import { createPinnedItemClient } from '@/utils/pinned-item-client';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import {
  describeMatchedMods,
  projectBoardView,
  sumPrices,
  type BoardModCondition,
  type BoardModQuickFilter,
  type BoardModTierCap,
  type BoardSortMode,
  type BoardView,
  type PriceTotal,
  type SellerSummary,
} from '@/utils/result-board/board-projection';
import {
  buildStashRegex,
  STASH_SEARCH_MAX_LENGTH,
  type StashRegexResult,
} from '@/utils/result-board/stash-regex';
import { getPoeVersion, getTradeLeague } from '@/utils/trade-context';
import { getTradePageMode } from '@/utils/trade-page-mode';
import { getTradeResultCache } from '@/utils/trade-result-cache';
import {
  loadTradeDictionaries,
  translateItemName,
  translateStatLines,
} from '@/utils/trade-stat-dictionary';

export type { BoardView };

export const DEFAULT_MIN_SELLER_COUNT = 2;

const notify = (key: I18nKey, tone: 'default' | 'success' | 'error' = 'error') =>
  dispatchPoeEvent('poexd-toast', { message: t(key), tone });

/** 輸入框的字串 → 數值；空白或不是正數時視為沒有設定 */
export function parseBound(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

const TRAVEL_FAILURE: Readonly<
  Record<Exclude<TravelOutcome, 'travelled' | 'in-progress'>, I18nKey>
> = {
  unavailable: 'resultBoard.travelUnavailable',
  busy: 'resultBoard.travelBusy',
  'refresh-failed': 'resultBoard.travelRefreshFailed',
};

export function useResultBoard(runtime: ResultBoardRuntime = getResultBoardRuntime()) {
  const version = getPoeVersion();
  const state = shallowRef(runtime.session.getState());
  const loaderState = shallowRef(runtime.loader.getState());
  const travelStates = shallowRef(runtime.getTravelStates());
  const isLiveMode = ref(getTradePageMode() === 'live');

  const view = ref<BoardView>('items');
  const sortMode = ref<BoardSortMode>('official');
  const instantOnly = ref(false);
  const hideSold = ref(false);
  const keyword = ref('');
  const debouncedKeyword = useDebouncedRef(keyword);
  const modConditions = ref<readonly BoardModCondition[]>([]);
  const modPickerQuery = ref('');
  const modQuickFilter = ref<BoardModQuickFilter>('all');
  const syncOfficialFilter = ref(false);
  const debouncedModPickerQuery = useDebouncedRef(modPickerQuery);
  const modDictTick = ref(0);
  let modDictLoading = false;
  const priceMinText = ref('');
  const priceMaxText = ref('');
  const minSellerCount = ref(DEFAULT_MIN_SELLER_COUNT);
  /** 使用者取消勾選的結果 id（預設勾選每位賣家的可直購結果） */
  const unpicked = ref<ReadonlySet<string>>(new Set());
  const expandedIds = ref<ReadonlySet<string>>(new Set());
  const expandedSellers = ref<ReadonlySet<string>>(new Set());
  /** 釘選清單同步來的已釘選 id，用來在看板上高亮 Pin 按鈕 */
  const pinnedIds = ref<ReadonlySet<string>>(new Set());

  let disposed = false;
  const cleanups: (() => void)[] = [];

  /** 新頁面（`/trade`）掛載時網址尚無聯盟，搜尋後才透過 SPA 路由補上，每次使用時動態讀取 */
  function resolveLeague(entryLeague?: string): string | undefined {
    const fromUrl = getTradeLeague();
    if (fromUrl) return fromUrl;
    if (entryLeague) return entryLeague;
    const resultCache = getTradeResultCache();
    for (const entry of state.value.ledger.entries) {
      const cached = resultCache.get(entry.id)?.league;
      if (cached) return cached;
    }
    return undefined;
  }

  const { enablePriceComparison, rates, ensureRates } = useCurrencyRates({
    version,
    resolveLeague,
  });

  const entries = computed(() => state.value.ledger.entries);
  const listedCount = computed(() => {
    const summary = state.value.summary;
    return summary ? Math.min(summary.resultCount, OFFICIAL_RESULT_CAP) : undefined;
  });

  function ensureModDictionary(): void {
    if (modDictLoading) return;
    modDictLoading = true;
    void loadTradeDictionaries(version)
      .then(() => {
        if (!disposed) modDictTick.value += 1;
      })
      .catch(() => {
        modDictLoading = false;
      });
  }

  function setModCondition(key: string, maxTier?: BoardModTierCap): void {
    const existing = modConditions.value.find((cond) => cond.key === key);
    if (existing && existing.maxTier === maxTier) {
      // 再次點選相同條件時取消選取
      modConditions.value = modConditions.value.filter((cond) => cond.key !== key);
      return;
    }
    const next: BoardModCondition = maxTier === undefined ? { key } : { key, maxTier };
    if (existing) {
      modConditions.value = modConditions.value.map((cond) => (cond.key === key ? next : cond));
    } else {
      modConditions.value = [...modConditions.value, next];
    }
  }

  /** 點選選項標題：未選時啟用（不限階級），已選時直接移除整個條件 */
  function toggleModOption(key: string): void {
    if (modConditions.value.some((cond) => cond.key === key)) {
      removeModCondition(key);
    } else {
      setModCondition(key, undefined);
    }
  }

  function removeModCondition(key: string): void {
    modConditions.value = modConditions.value.filter((cond) => cond.key !== key);
  }

  function clearModConditions(): void {
    modConditions.value = [];
  }

  watch(debouncedKeyword, (value) => {
    if (value.trim()) ensureModDictionary();
  });

  const extraSearchLines = (entry: BoardEntry): readonly string[] => {
    const lines = [...runtime.readEntrySearchLines(entry.id)];
    const translatedName = entry.name ? translateItemName(entry.name, version) : '';
    if (translatedName && translatedName !== entry.name) lines.push(translatedName);
    const translatedType = entry.typeLine ? translateItemName(entry.typeLine, version) : '';
    if (translatedType && translatedType !== entry.typeLine) lines.push(translatedType);
    const translatedBase = entry.baseType ? translateItemName(entry.baseType, version) : '';
    if (translatedBase && translatedBase !== entry.baseType) lines.push(translatedBase);
    if (entry.modRolls) {
      for (const roll of entry.modRolls) {
        for (const hash of roll.hashes) {
          for (const line of translateStatLines(hash, version)) {
            if (line && line !== hash) lines.push(line);
          }
        }
      }
    }
    return lines;
  };

  const projection = computed(() => {
    void modDictTick.value;
    return projectBoardView({
      entries: entries.value,
      marks: state.value.marks,
      hiddenAccounts: state.value.hiddenAccounts,
      view: view.value,
      sortMode: sortMode.value,
      instantOnly: instantOnly.value,
      hideSold: hideSold.value,
      keyword: debouncedKeyword.value,
      priceMin: parseBound(priceMinText.value),
      priceMax: parseBound(priceMaxText.value),
      minSellerCount: minSellerCount.value,
      modConditions: modConditions.value,
      modPickerQuery: debouncedModPickerQuery.value,
      modQuickFilter: modQuickFilter.value,
      rates: rates.value,
      extraSearchLines,
      resolveStatLabel: (hash) => translateStatLines(hash, version).join(' / '),
    });
  });

  const hasSoldEntries = computed(() => projection.value.hasSoldEntries);
  const hasMixedInstantBuyout = computed(() => projection.value.hasMixedInstantBuyout);
  const conversionAvailable = computed(() => projection.value.conversionAvailable);
  const sortModes = computed(() => projection.value.sortModes);
  const filteredEntries = computed(() => projection.value.filteredEntries);
  const sellers = computed(() => projection.value.sellers);
  const sellerInstantCounts = computed(() => projection.value.sellerInstantCounts);

  /** 字典裡的翻譯模板；查不到（回傳原 stat id）時交由呼叫端改用詞綴原文 */
  function resolveStatTemplate(statId: string): string | undefined {
    const lines = translateStatLines(statId, version);
    return lines.length === 1 && lines[0] === statId ? undefined : lines.join(' / ');
  }

  /** 物品命中目前詞綴條件的詞綴行（翻譯並填入實際數值）；沒有條件時為空 */
  function matchedModTexts(entry: BoardEntry): string[] {
    void modDictTick.value;
    return describeMatchedMods(entry, modConditions.value, resolveStatTemplate);
  }
  const modOptions = computed(() => projection.value.modOptions);
  const filteredModOptions = computed(() => projection.value.filteredModOptions);
  const modOptionByKey = computed(() => projection.value.modOptionByKey);
  const priceSummary = computed(() => projection.value.priceSummary);
  const hasActiveFilters = computed(() => projection.value.hasActiveFilters);

  function toggleSyncOfficialFilter(): void {
    if (!hasActiveFilters.value && !syncOfficialFilter.value) return;
    syncOfficialFilter.value = !syncOfficialFilter.value;
  }

  watch(
    [syncOfficialFilter, projection, entries],
    () => {
      if (!projection.value.hasActiveFilters) {
        if (syncOfficialFilter.value) syncOfficialFilter.value = false;
        runtime.syncOfficialFilter(null);
        return;
      }
      if (!syncOfficialFilter.value) {
        runtime.syncOfficialFilter(null);
        return;
      }
      runtime.syncOfficialFilter({
        matchedIds: projection.value.matchedIds,
        totalCount: entries.value.length,
        onReset: () => {
          syncOfficialFilter.value = false;
        },
      });
    },
    { flush: 'post' },
  );

  const isPicked = (entry: BoardEntry): boolean =>
    entry.instantBuyout && state.value.marks[entry.id] !== 'sold' && !unpicked.value.has(entry.id);

  function togglePicked(entry: BoardEntry): void {
    if (!entry.instantBuyout || state.value.marks[entry.id] === 'sold') return;
    const next = new Set(unpicked.value);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    unpicked.value = next;
  }

  /** 切換同一個倉庫分頁內所有可直購且未售出物品的勾選狀態 */
  function toggleGroupPicked(groupEntries: readonly BoardEntry[]): void {
    const buyable = groupEntries.filter(
      (entry) => entry.instantBuyout && state.value.marks[entry.id] !== 'sold',
    );
    if (buyable.length === 0) return;
    const allPicked = buyable.every((entry) => !unpicked.value.has(entry.id));
    const next = new Set(unpicked.value);
    for (const entry of buyable) {
      if (allPicked) next.add(entry.id);
      else next.delete(entry.id);
    }
    unpicked.value = next;
  }

  function pickedOf(seller: SellerSummary): BoardEntry[] {
    return seller.entries.filter(isPicked);
  }

  function pickedTotal(seller: SellerSummary): PriceTotal {
    return sumPrices(
      pickedOf(seller).map((entry) => entry.price),
      rates.value,
    );
  }

  /** 勾選物品的倉庫搜尋 regex；排除已售出，只和同一群組其他未售出的已載入結果區分 */
  function stashRegexForEntries(groupEntries: readonly BoardEntry[]): StashRegexResult {
    const active = groupEntries.filter((entry) => state.value.marks[entry.id] !== 'sold');
    const picked = active.filter(isPicked);
    const pickedIds = new Set(picked.map((entry) => entry.id));
    return buildStashRegex({
      picked,
      others: active.filter((entry) => !pickedIds.has(entry.id)),
      maxLength: STASH_SEARCH_MAX_LENGTH[version],
    });
  }

  function stashRegexOf(seller: SellerSummary): StashRegexResult {
    return stashRegexForEntries(seller.entries);
  }

  async function copyStashRegex(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      notify('resultBoard.regex.copied', 'success');
    } catch {
      notify('resultBoard.regex.copyFailed');
    }
  }

  const isExpanded = (id: string): boolean => expandedIds.value.has(id);
  const isSellerExpanded = (account: string): boolean => expandedSellers.value.has(account);
  const hasAnyExpanded = computed(() =>
    view.value === 'items'
      ? filteredEntries.value.some((entry) => expandedIds.value.has(entry.id))
      : sellers.value.some((seller) => expandedSellers.value.has(seller.account)) ||
        expandedIds.value.size > 0,
  );
  const canToggleExpandAll = computed(
    () =>
      hasAnyExpanded.value ||
      (view.value === 'items' ? filteredEntries.value.length > 0 : sellers.value.length > 0),
  );

  function toggleExpanded(id: string): void {
    const next = new Set(expandedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds.value = next;
  }

  function toggleSellerExpanded(account: string): void {
    const next = new Set(expandedSellers.value);
    if (next.has(account)) next.delete(account);
    else next.add(account);
    expandedSellers.value = next;
  }

  function toggleExpandAll(): void {
    if (hasAnyExpanded.value) {
      expandedIds.value = new Set();
      if (view.value === 'sellers') expandedSellers.value = new Set();
      return;
    }
    if (view.value === 'items') {
      if (filteredEntries.value.length === 0) return;
      expandedIds.value = new Set(filteredEntries.value.map((entry) => entry.id));
      return;
    }
    if (sellers.value.length === 0) return;
    expandedSellers.value = new Set(sellers.value.map((seller) => seller.account));
  }

  /**
   * 從物品清單跳到某位賣家：切到賣家清單並展開該賣家。
   * 賣家件數低於目前門檻時先降低門檻並以 toast 告知，確保切過去看得到。
   */
  function focusSeller(account: string): void {
    const count = sellerInstantCounts.value.get(account) ?? 0;
    if (count > 0 && minSellerCount.value > count) {
      minSellerCount.value = count;
      // 門檻是使用者自己設的值，改動時明確告知，避免切回來才發現被改掉
      dispatchPoeEvent('poexd-toast', {
        message: t('resultBoard.minCountLowered', { count }),
        tone: 'default',
      });
    }
    if (!expandedSellers.value.has(account)) {
      expandedSellers.value = new Set([...expandedSellers.value, account]);
    }
    view.value = 'sellers';
  }

  /** 展開時的卡片快取：同一次搜尋內每個 id 只擷取一次 DOM，避免大筆數展開時重複重建 shadow root */
  const snapshotCache = new Map<string, PinnedItemSnapshot>();

  /** 展開時的卡片：交由 runtime 擷取官方結果列卡片與快取資料（與釘選相同的渲染） */
  function cardSnapshot(id: string): PinnedItemSnapshot | undefined {
    const cached = snapshotCache.get(id);
    if (cached) return cached;
    const snapshot = runtime.captureCardSnapshot(id, version, resolveLeague);
    if (snapshot) snapshotCache.set(id, snapshot);
    return snapshot;
  }

  const locate = (id: string) => {
    if (!runtime.locate(id)) notify('resultBoard.locateFailed');
  };

  const travel = async (id: string) => {
    const outcome = await runtime.travel(id, () => {
      notify('resultBoard.travelRefreshing', 'default');
    });
    if (outcome !== 'travelled' && outcome !== 'in-progress') {
      notify(TRAVEL_FAILURE[outcome]);
    }
  };

  const travelSeller = async (seller: SellerSummary) => {
    const target =
      pickedOf(seller)[0] ??
      seller.entries.find((entry) => entry.instantBuyout && state.value.marks[entry.id] !== 'sold');
    if (!target) {
      notify('resultBoard.travelUnavailable');
      return;
    }
    await travel(target.id);
  };

  const pin = (id: string) => {
    if (!runtime.pin(id)) notify('resultBoard.pinUnavailable');
  };

  watch(
    () => `${state.value.searchId}:${state.value.startedAt}`,
    () => {
      unpicked.value = new Set();
      expandedIds.value = new Set();
      expandedSellers.value = new Set();
      modConditions.value = [];
      modPickerQuery.value = '';
      modQuickFilter.value = 'all';
      syncOfficialFilter.value = false;
      snapshotCache.clear();
      isLiveMode.value = getTradePageMode() === 'live';
      void ensureRates();
    },
  );

  watch(
    () => entries.value.length,
    () => {
      void ensureRates();
    },
  );

  watch(sortModes, (modes) => {
    if (!modes.includes(sortMode.value)) sortMode.value = 'official';
  });

  onMounted(() => {
    cleanups.push(
      runtime.session.subscribe((next) => {
        state.value = next;
      }),
      runtime.loader.subscribe((next) => {
        loaderState.value = next;
      }),
      runtime.subscribeTravelStates((next) => {
        travelStates.value = next;
      }),
    );
    state.value = runtime.session.getState();
    loaderState.value = runtime.loader.getState();
    travelStates.value = runtime.getTravelStates();
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const pinnedClient = createPinnedItemClient(version);
      if (chrome.storage.onChanged?.addListener) {
        cleanups.push(
          pinnedClient.subscribe((items) => {
            if (!disposed) pinnedIds.value = new Set(items.map((item) => item.id));
          }),
        );
      }
      void pinnedClient
        .list()
        .then((items) => {
          if (!disposed) pinnedIds.value = new Set(items.map((item) => item.id));
        })
        .catch(() => {});
    }
  });

  onUnmounted(() => {
    disposed = true;
    runtime.syncOfficialFilter(null);
    snapshotCache.clear();
    cleanups.forEach((cleanup) => cleanup());
  });

  const isPinned = (id: string): boolean => pinnedIds.value.has(id);

  return {
    state,
    loaderState,
    rates,
    enablePriceComparison,
    isLiveMode,
    view,
    sortMode,
    sortModes,
    instantOnly,
    hideSold,
    hasSoldEntries,
    keyword,
    modConditions,
    modPickerQuery,
    modQuickFilter,
    hasActiveFilters,
    syncOfficialFilter,
    toggleSyncOfficialFilter,
    modOptions,
    filteredModOptions,
    modOptionByKey,
    ensureModDictionary,
    setModCondition,
    toggleModOption,
    removeModCondition,
    clearModConditions,
    priceMinText,
    priceMaxText,
    minSellerCount,
    entries,
    hasMixedInstantBuyout,
    listedCount,
    conversionAvailable,
    filteredEntries,
    sellers,
    sellerInstantCounts,
    matchedModTexts,
    focusSeller,
    priceSummary,
    isPicked,
    isPinned,
    travelStates,
    togglePicked,
    toggleGroupPicked,
    pickedOf,
    pickedTotal,
    stashRegexOf,
    stashRegexForEntries,
    copyStashRegex,
    isExpanded,
    isSellerExpanded,
    hasAnyExpanded,
    canToggleExpandAll,
    toggleExpanded,
    toggleSellerExpanded,
    toggleExpandAll,
    cardSnapshot,
    locate,
    travel,
    travelSeller,
    pin,
    hideSeller: (account: string) => runtime.hideSeller(account),
    showAllSellers: () => runtime.showAllSellers(),
    loadNext: () => runtime.loadNext(),
    loadBatches: (batches: number) => runtime.loadBatches(batches),
    loadAll: () => runtime.loadAll(),
    stopLoading: () => runtime.stopLoading(),
    // 不知道官方總數時一律可以按，由載入流程回報「找不到按鈕」；
    // 依賴看板與載入狀態，讓結果或載入改變時重新判斷
    canLoadMore: computed(() => {
      void loaderState.value;
      return state.value.summary === undefined || !runtime.isComplete();
    }),
  };
}
