/**
 * 釘選物品 pane 的狀態與動作。清單來自 `chrome.storage.local`（background 寫入），
 * 每件物品的暫時狀態（已售出、被搶先）只存在這個 pane 的記憶體。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { useCurrencyRates } from '@/components/sidebar/composables/useCurrencyRates';
import { ResultPobCopy } from '@/entrypoints/content/logic/result-pob-copy';
import { LiveSearchFetchRateGate } from '@/entrypoints/content/logic/live-search-fetch-rate-gate';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { getActiveUiLocale, t, type I18nKey } from '@/utils/i18n';
import { translateTradeApiMessage } from '@/utils/trade-toast-translation';
import {
  buildPinnedItemSourceUrl,
  isSameRealm,
  travelToHideout,
  type HideoutTravelOutcome,
} from '@/utils/pinned-item-actions';
import { createPinnedItemClient } from '@/utils/pinned-item-client';
import {
  applyPinnedOrder,
  isSameLeague,
  PINNED_ITEM_LIMIT,
  type PinnedItemSnapshot,
} from '@/utils/pinned-items';
import { isPobExportableItem } from '@/utils/pob-item-text';
import { getPoeVersion, getTradeLeague } from '@/utils/trade-context';
import { getTradeResultCache } from '@/utils/trade-result-cache';

export type PinnedItemTransientState =
  | 'sold'
  | 'in-demand'
  | 'teleporting'
  | 'refreshing'
  | 'traveling';

let fetchGate: LiveSearchFetchRateGate | undefined;
let whisperGate: LiveSearchFetchRateGate | undefined;

const getFetchGate = () => (fetchGate ??= new LiveSearchFetchRateGate());
// whisper 會讓遊戲內角色傳送：被限速時不自動重送
const getWhisperGate = () =>
  (whisperGate ??= new LiveSearchFetchRateGate({ maxRateLimitRetries: 0 }));

const notify = (message: string, tone: 'success' | 'error') =>
  dispatchPoeEvent('poexd-toast', { message, tone });

const TRAVEL_MESSAGES: Record<HideoutTravelOutcome['status'], I18nKey> = {
  teleporting: 'pinnedItem.travel.teleporting',
  'in-demand': 'pinnedItem.travel.inDemand',
  sold: 'pinnedItem.travel.sold',
  'refresh-required': 'pinnedItem.travel.refreshRequired',
  'realm-mismatch': 'pinnedItem.realmMismatch',
  error: 'pinnedItem.travel.failed',
};

export function usePinnedItems() {
  const version = getPoeVersion();
  const client = createPinnedItemClient(version);
  const items = shallowRef<PinnedItemSnapshot[]>([]);
  const showAllLeagues = ref(false);
  const states = ref<Record<string, PinnedItemTransientState>>({});
  const currentLeague = getTradeLeague();
  const currentOrigin = window.location.origin;
  const {
    enablePriceComparison,
    rates: currencyRates,
    ensureRates: ensureCurrencyRates,
  } = useCurrencyRates({
    version,
    resolveLeague: () => currentLeague,
  });
  let pobCopy: ResultPobCopy | undefined;
  let unsubscribe: (() => void) | undefined;

  const visibleItems = computed(() =>
    showAllLeagues.value || !currentLeague
      ? items.value
      : items.value.filter((item) => isSameLeague(item.league, currentLeague)),
  );
  const hiddenCount = computed(() => items.value.length - visibleItems.value.length);
  const isSold = (item: PinnedItemSnapshot) =>
    item.sold === true || states.value[item.id] === 'sold';
  const soldVisibleCount = computed(() => visibleItems.value.filter(isSold).length);

  const setState = (id: string, state: PinnedItemTransientState | undefined) => {
    const { [id]: _removed, ...rest } = states.value;
    states.value = state ? { ...rest, [id]: state } : rest;
  };

  /** 儲存層更新後同步清除已不存在或已被重新釘選覆寫的暫態 sold 狀態 */
  const reconcileSoldStates = (next: readonly PinnedItemSnapshot[]) => {
    const persistedSoldIds = new Set(next.filter((entry) => entry.sold === true).map((e) => e.id));
    let changed = false;
    const updated: Record<string, PinnedItemTransientState> = {};
    for (const [id, state] of Object.entries(states.value)) {
      if (state === 'sold' && !persistedSoldIds.has(id)) {
        changed = true;
        continue;
      }
      updated[id] = state;
    }
    if (changed) states.value = updated;
  };

  onMounted(() => {
    unsubscribe = client.subscribe((next) => {
      items.value = next;
      reconcileSoldStates(next);
    });
    void client
      .list()
      .then((next) => {
        items.value = next;
        reconcileSoldStates(next);
      })
      .catch((error: unknown) => console.warn('[PoeXD] 讀取釘選清單失敗:', error));
  });
  onUnmounted(() => {
    unsubscribe?.();
  });

  const sameRealm = (item: PinnedItemSnapshot) => isSameRealm(item, currentOrigin);
  const canCopyPob = (item: PinnedItemSnapshot) => isPobExportableItem(item.item);
  const sourceUrl = (item: PinnedItemSnapshot) => buildPinnedItemSourceUrl(item);

  async function copyWhisper(item: PinnedItemSnapshot) {
    if (!item.listing.whisper) return;
    if (!sameRealm(item)) {
      notify(t('pinnedItem.realmMismatch'), 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(item.listing.whisper);
      notify(t('pinnedItem.toast.whisperCopied'), 'success');
    } catch {
      notify(t('pinnedItem.toast.copyFailed'), 'error');
    }
  }

  async function travel(item: PinnedItemSnapshot) {
    if (isSold(item)) return;
    const current = states.value[item.id];
    if (current === 'refreshing' || current === 'traveling') return;
    const continueInDemand = current === 'in-demand';
    const cache = getTradeResultCache();
    const outcome = await travelToHideout(
      item,
      {
        currentOrigin,
        getCachedListing: (id) => cache.get(id)?.listing,
        rememberResult: (raw, sourceSearchId) =>
          cache.ingestResult(raw, { sourceSearchId, league: item.league }),
        fetchGate: getFetchGate(),
        whisperGate: getWhisperGate(),
      },
      {
        continueInDemand,
        onPhaseChange: (phase) => setState(item.id, phase),
      },
    );
    const nextState: PinnedItemTransientState | undefined =
      outcome.status === 'sold' ||
      outcome.status === 'in-demand' ||
      outcome.status === 'teleporting'
        ? outcome.status
        : undefined;
    setState(item.id, nextState);
    if (outcome.status === 'sold') {
      items.value = items.value.map((entry) =>
        entry.id === item.id ? { ...entry, sold: true } : entry,
      );
      void client.markSold(item.id);
    }
    const message = t(TRAVEL_MESSAGES[outcome.status]);
    const uiLocale = getActiveUiLocale();
    const detail =
      outcome.status === 'error'
        ? uiLocale === 'en'
          ? outcome.message
          : translateTradeApiMessage(outcome.message, uiLocale)
        : '';
    // 錯誤訊息只帶官方回應的說明文字（並套用共用中文化），不含 token
    notify(
      outcome.status === 'error' ? `${message} ${detail}` : message,
      outcome.status === 'teleporting' ? 'success' : 'error',
    );
  }

  async function copyPob(item: PinnedItemSnapshot) {
    pobCopy ??= new ResultPobCopy(version);
    await pobCopy.copyItem(item.item, item.locale);
  }

  function openSource(item: PinnedItemSnapshot) {
    const url = sourceUrl(item);
    if (url) window.open(url, '_blank', 'noopener');
  }

  async function unpin(item: PinnedItemSnapshot) {
    const outcome = await client.unpin(item.id);
    if (!outcome.ok) notify(t('pinnedItem.toast.failed'), 'error');
  }

  /** 拖曳排序：先在畫面上套用新順序，再交給背景寫入；失敗時提示並讀回儲存的順序 */
  async function reorder(ids: readonly string[]) {
    items.value = applyPinnedOrder(items.value, ids);
    const outcome = await client.reorder(ids).catch(() => undefined);
    if (outcome?.ok) return;
    notify(t('pinnedItem.toast.failed'), 'error');
    items.value = await client.list().catch(() => items.value);
  }

  async function clearVisible() {
    const count = visibleItems.value.length;
    if (count === 0) return;
    const league = showAllLeagues.value || !currentLeague ? undefined : currentLeague;
    const message = league
      ? t('pinnedItem.dialog.clearLeagueConfirm', { count, league })
      : t('pinnedItem.dialog.clearAllConfirm', { count });
    const title = league ? t('pinnedItem.clearLeague') : t('pinnedItem.clearAll');
    const confirm = (window as { poexdConfirm?: (msg: string, title?: string) => Promise<boolean> })
      .poexdConfirm;
    const confirmed = confirm
      ? await confirm(message, title)
      : typeof window.confirm === 'function'
        ? window.confirm(message)
        : false;
    if (!confirmed) return;
    const outcome = await client.clear(league);
    if (!outcome.ok) notify(t('pinnedItem.toast.failed'), 'error');
  }

  async function clearSold() {
    const league = showAllLeagues.value || !currentLeague ? undefined : currentLeague;
    const outcome = await client.clearSold(league);
    if (!outcome.ok) notify(t('pinnedItem.toast.failed'), 'error');
  }

  return {
    version,
    items,
    visibleItems,
    hiddenCount,
    soldVisibleCount,
    showAllLeagues,
    states,
    currencyRates,
    enablePriceComparison,
    ensureCurrencyRates,
    currentLeague,
    limit: PINNED_ITEM_LIMIT,
    isSold,
    sameRealm,
    canCopyPob,
    sourceUrl,
    copyWhisper,
    travel,
    copyPob,
    openSource,
    unpin,
    reorder,
    clearVisible,
    clearSold,
  };
}
