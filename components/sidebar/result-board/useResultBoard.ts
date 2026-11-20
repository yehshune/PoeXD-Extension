/**
 * 搜尋結果看板 pane 的狀態與動作。看板資料來自 `ResultBoardRuntime`（頁面接線），
 * 篩選、排序、勾選等檢視狀態只存在這個 pane 的記憶體，換搜尋時重設勾選。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import {
  findOfficialRow,
  getResultBoardRuntime,
  OFFICIAL_RESULT_CAP,
  type ResultBoardRuntime,
  type TravelOutcome,
} from '@/entrypoints/content/logic/result-board-runtime';
import { fetchCurrencyRates } from '@/entrypoints/content/logic/result-price-presenter';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t, type I18nKey } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { capturePinnedCardDom } from '@/utils/pinned-card-dom';
import { createPinnedItemSnapshot, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { getPreferences } from '@/utils/preferences';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { BoardEntry } from '@/utils/result-board/board-entry';
import { sumPrices, type PriceTotal } from '@/utils/result-board/board-price';
import { summarizePrices } from '@/utils/result-board/board-price-summary';
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
import { isPriceConversionSupported } from '@/utils/trade-realms';
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
  const league = getTradeLeague();
  const state = shallowRef(runtime.session.getState());
  const loaderState = shallowRef(runtime.loader.getState());
  const loadedRates = shallowRef<CurrencyRateSnapshot | undefined>(undefined);
  const enablePriceComparison = ref(true);
  const rates = computed(() => (enablePriceComparison.value ? loadedRates.value : undefined));
  const isLiveMode = ref(getTradePageMode() === 'live');

  const view = ref<BoardView>('items');
  const sortMode = ref<BoardSortMode>('official');
  const instantOnly = ref(false);
  const keyword = ref('');
  const priceMinText = ref('');
  const priceMaxText = ref('');
  const minSellerCount = ref(DEFAULT_MIN_SELLER_COUNT);
  /** 使用者取消勾選的結果 id（預設勾選每位賣家的可直購結果） */
  const unpicked = ref<ReadonlySet<string>>(new Set());
  const expandedIds = ref<ReadonlySet<string>>(new Set());
  const expandedSellers = ref<ReadonlySet<string>>(new Set());

  let disposed = false;
  let ratesLoading = false;
  const cleanups: (() => void)[] = [];

  async function ensureRates() {
    if (
      !enablePriceComparison.value ||
      loadedRates.value ||
      ratesLoading ||
      !league ||
      !isPriceConversionSupported()
    ) {
      return;
    }
    ratesLoading = true;
    try {
      const loaded = await fetchCurrencyRates(version, league);
      if (!disposed && loaded) loadedRates.value = loaded;
    } finally {
      ratesLoading = false;
    }
  }

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

  const filteredEntries = computed(() =>
    sortEntries(
      filterEntries(
        entries.value,
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
    ),
  );

  const sellers = computed(() => {
    const term = keyword.value.trim().toLowerCase();
    const matched = filterSellers(sortSellers(aggregateSellers(entries.value, rates.value)), {
      minInstantBuyout: minSellerCount.value,
      hiddenAccounts: state.value.hiddenAccounts,
    });
    if (!term) return matched;
    return matched.filter((seller) =>
      [seller.account, seller.character ?? ''].some((field) => field.toLowerCase().includes(term)),
    );
  });

  const priceSummary = computed(() => summarizePrices(entries.value, rates.value));

  const isPicked = (entry: BoardEntry): boolean =>
    entry.instantBuyout && !unpicked.value.has(entry.id);

  function togglePicked(entry: BoardEntry): void {
    if (!entry.instantBuyout) return;
    const next = new Set(unpicked.value);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
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

  /** 勾選物品的倉庫搜尋 regex；只和同賣家其他已載入的結果區分 */
  function stashRegexOf(seller: SellerSummary): StashRegexResult {
    const picked = pickedOf(seller);
    const pickedIds = new Set(picked.map((entry) => entry.id));
    return buildStashRegex({
      picked,
      others: seller.entries.filter((entry) => !pickedIds.has(entry.id)),
      maxLength: STASH_SEARCH_MAX_LENGTH[version],
    });
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

  /** 展開時的卡片：用官方結果列擷取的卡片與快取裡的物品資料（與釘選相同的渲染） */
  function cardSnapshot(id: string): PinnedItemSnapshot | undefined {
    const entry = getTradeResultCache().get(id);
    if (!entry || !league) return undefined;
    const row = findOfficialRow(id);
    return createPinnedItemSnapshot(
      entry,
      {
        gameVersion: version,
        origin: window.location.origin,
        league,
        sourceSearchId: entry.sourceSearchId,
        locale: resolvePageLocale(),
        card: row ? capturePinnedCardDom(row) : undefined,
      },
      Date.now(),
    );
  }

  const locate = (id: string) => {
    if (!runtime.locate(id)) notify('resultBoard.locateFailed');
  };
  const TRAVEL_FAILURE: Readonly<Record<Exclude<TravelOutcome, 'travelled'>, I18nKey>> = {
    unavailable: 'resultBoard.travelUnavailable',
    busy: 'resultBoard.travelBusy',
    'refresh-failed': 'resultBoard.travelRefreshFailed',
  };
  const travel = async (id: string) => {
    const outcome = await runtime.travel(id, () =>
      notify('resultBoard.travelRefreshing', 'default'),
    );
    if (outcome !== 'travelled') notify(TRAVEL_FAILURE[outcome]);
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
      isLiveMode.value = getTradePageMode() === 'live';
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
    void getPreferences(version).then((outcome) => {
      if (disposed) return;
      if (!outcome.ok) {
        void ensureRates();
        return;
      }
      cleanups.push(
        outcome.value.subscribe((snapshot) => {
          enablePriceComparison.value = snapshot.enablePriceComparison;
          if (snapshot.enablePriceComparison) {
            void ensureRates();
          }
        }),
      );
    });
  });

  onUnmounted(() => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
  });

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
    togglePicked,
    pickedOf,
    pickedTotal,
    stashRegexOf,
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
    pin,
    hideSeller: (account: string) => runtime.session.hideSeller(account),
    showAllSellers: () => runtime.session.showAllSellers(),
    loadNext: () => void runtime.loader.loadNext(),
    loadAll: () => void runtime.loader.loadAll(),
    stopLoading: () => runtime.loader.stop(),
    // 不知道官方總數時一律可以按，由載入流程回報「找不到按鈕」；
    // 依賴看板與載入狀態，讓結果或載入改變時重新判斷
    canLoadMore: computed(() => {
      void loaderState.value;
      return state.value.summary === undefined || !runtime.isComplete();
    }),
  };
}
