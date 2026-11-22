/**
 * 搜尋結果看板 pane 的狀態與動作。看板資料來自 `ResultBoardRuntime`（頁面接線），
 * 篩選、排序、勾選等檢視狀態只存在這個 pane 的記憶體，換搜尋時重設勾選。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import {
  getResultBoardRuntime,
  OFFICIAL_RESULT_CAP,
  type ResultBoardRuntime,
  type TravelOutcome,
} from '@/entrypoints/content/logic/result-board-runtime';
import { useCurrencyRates } from '@/components/sidebar/composables/useCurrencyRates';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t, type I18nKey } from '@/utils/i18n';
import { createPinnedItemClient } from '@/utils/pinned-item-client';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import { sumPrices, summarizePrices, type PriceTotal } from '@/utils/result-board/board-price';
import {
  availableSortModes,
  filterEntries,
  sortEntries,
  type BoardSortMode,
} from '@/utils/result-board/board-query';
import {
  aggregateSellers,
  filterSellers,
  sortSellers,
  type SellerSummary,
} from '@/utils/result-board/board-sellers';
import {
  buildStashRegex,
  STASH_SEARCH_MAX_LENGTH,
  type StashRegexResult,
} from '@/utils/result-board/stash-regex';
import { getPoeVersion, getTradeLeague } from '@/utils/trade-context';
import { getTradePageMode } from '@/utils/trade-page-mode';
import { getTradeResultCache } from '@/utils/trade-result-cache';

export type BoardView = 'items' | 'sellers';

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

export function useResultBoard(runtime: ResultBoardRuntime = getResultBoardRuntime()) {
  const version = getPoeVersion();
  const state = shallowRef(runtime.session.getState());
  const loaderState = shallowRef(runtime.loader.getState());
  const isLiveMode = ref(getTradePageMode() === 'live');

  const view = ref<BoardView>('items');
  const sortMode = ref<BoardSortMode>('official');
  const instantOnly = ref(false);
  const hideSold = ref(false);
  const keyword = ref('');
  const priceMinText = ref('');
  const priceMaxText = ref('');
  const minSellerCount = ref(DEFAULT_MIN_SELLER_COUNT);
  /** 使用者取消勾選的結果 id（預設勾選每位賣家的可直購結果） */
  const unpicked = ref<ReadonlySet<string>>(new Set());
  const expandedIds = ref<ReadonlySet<string>>(new Set());
  const expandedSellers = ref<ReadonlySet<string>>(new Set());
  /** 釘選清單同步來的已釘選 id，用來在看板上高亮 Pin 按鈕 */
  const pinnedIds = ref<ReadonlySet<string>>(new Set());
  /** 正在重新整理或前往藏身處中的結果 id */
  const travelStates = ref<Readonly<Record<string, 'refreshing' | 'traveling'>>>({});
  const travelTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  const hasMixedInstantBuyout = computed(() => {
    let hasInstant = false;
    let hasWhisperOnly = false;
    for (const entry of entries.value) {
      if (entry.instantBuyout) hasInstant = true;
      else hasWhisperOnly = true;
      if (hasInstant && hasWhisperOnly) return true;
    }
    return false;
  });
  const conversionAvailable = computed(() => rates.value !== undefined);
  const sortModes = computed(() => availableSortModes(conversionAvailable.value));
  const listedCount = computed(() => {
    const summary = state.value.summary;
    return summary ? Math.min(summary.resultCount, OFFICIAL_RESULT_CAP) : undefined;
  });

  const soldIds = computed(() => {
    const ids = new Set<string>();
    for (const [id, mark] of Object.entries(state.value.marks)) {
      if (mark === 'sold') ids.add(id);
    }
    return ids;
  });
  const hasSoldEntries = computed(() => soldIds.value.size > 0);

  const filteredEntries = computed(() => {
    const base =
      hasSoldEntries.value && hideSold.value
        ? entries.value.filter((entry) => !soldIds.value.has(entry.id))
        : entries.value;
    return sortEntries(
      filterEntries(
        base,
        {
          instantBuyoutOnly: hasMixedInstantBuyout.value && instantOnly.value,
          keyword: keyword.value,
          hiddenAccounts: state.value.hiddenAccounts,
          priceMin: parseBound(priceMinText.value),
          priceMax: parseBound(priceMaxText.value),
        },
        rates.value,
      ),
      sortMode.value,
      rates.value,
    );
  });

  const sellers = computed(() => {
    const term = keyword.value.trim().toLowerCase();
    const matched = filterSellers(
      sortSellers(aggregateSellers(entries.value, rates.value, soldIds.value)),
      {
        minInstantBuyout: minSellerCount.value,
        hiddenAccounts: state.value.hiddenAccounts,
      },
    );
    if (!term) return matched;
    return matched.filter((seller) =>
      [seller.account, seller.character ?? ''].some((field) => field.toLowerCase().includes(term)),
    );
  });

  const priceSummary = computed(() => summarizePrices(entries.value, rates.value));

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
  const TRAVEL_FAILURE: Readonly<Record<Exclude<TravelOutcome, 'travelled'>, I18nKey>> = {
    unavailable: 'resultBoard.travelUnavailable',
    busy: 'resultBoard.travelBusy',
    'refresh-failed': 'resultBoard.travelRefreshFailed',
  };
  const setTravelState = (id: string, next: 'refreshing' | 'traveling' | undefined) => {
    clearTimeout(travelTimers.get(id));
    travelTimers.delete(id);
    const { [id]: _removed, ...rest } = travelStates.value;
    travelStates.value = next ? { ...rest, [id]: next } : rest;
  };

  const travel = async (id: string) => {
    if (travelStates.value[id]) return;
    setTravelState(id, 'traveling');
    const outcome = await runtime.travel(id, () => {
      setTravelState(id, 'refreshing');
      notify('resultBoard.travelRefreshing', 'default');
    });
    if (outcome !== 'travelled') {
      setTravelState(id, undefined);
      notify(TRAVEL_FAILURE[outcome]);
      return;
    }
    setTravelState(id, 'traveling');
    travelTimers.set(
      id,
      setTimeout(() => setTravelState(id, undefined), 1_200),
    );
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
    () => state.value.marks,
    (marks) => {
      for (const id of Object.keys(travelStates.value)) {
        if (marks[id]) setTravelState(id, undefined);
      }
    },
  );

  watch(
    () => `${state.value.searchId}:${state.value.startedAt}`,
    () => {
      unpicked.value = new Set();
      expandedIds.value = new Set();
      expandedSellers.value = new Set();
      snapshotCache.clear();
      travelTimers.forEach((timer) => clearTimeout(timer));
      travelTimers.clear();
      travelStates.value = {};
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
    );
    state.value = runtime.session.getState();
    loaderState.value = runtime.loader.getState();
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
    snapshotCache.clear();
    travelTimers.forEach((timer) => clearTimeout(timer));
    travelTimers.clear();
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
    priceMinText,
    priceMaxText,
    minSellerCount,
    entries,
    hasMixedInstantBuyout,
    listedCount,
    conversionAvailable,
    filteredEntries,
    sellers,
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
