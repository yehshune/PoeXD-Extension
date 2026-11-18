/**
 * 釘選物品 pane 的狀態與動作。清單來自 `chrome.storage.local`（background 寫入），
 * 每件物品的暫時狀態（已售出、被搶先）只存在這個 pane 的記憶體。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { ResultPobCopy } from '@/entrypoints/content/logic/result-pob-copy';
import { LiveSearchFetchRateGate } from '@/entrypoints/content/logic/live-search-fetch-rate-gate';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t, type I18nKey } from '@/utils/i18n';
import {
  buildPinnedItemSourceUrl,
  isSameRealm,
  travelToHideout,
  type HideoutTravelOutcome,
} from '@/utils/pinned-item-actions';
import { createPinnedItemClient } from '@/utils/pinned-item-client';
import { PINNED_ITEM_LIMIT, type PinnedItemSnapshot } from '@/utils/pinned-items';
import { isPobExportableItem } from '@/utils/pob-item-text';
import { getPoeVersion, getTradeLeague } from '@/utils/trade-context';
import { getTradeResultCache } from '@/utils/trade-result-cache';

export type PinnedItemTransientState = 'sold' | 'in-demand' | 'teleporting' | 'busy';

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
  let pobCopy: ResultPobCopy | undefined;
  let unsubscribe: (() => void) | undefined;

  const visibleItems = computed(() =>
    showAllLeagues.value || !currentLeague
      ? items.value
      : items.value.filter((item) => item.league === currentLeague),
  );
  const hiddenCount = computed(() => items.value.length - visibleItems.value.length);

  const setState = (id: string, state: PinnedItemTransientState | undefined) => {
    const { [id]: _removed, ...rest } = states.value;
    states.value = state ? { ...rest, [id]: state } : rest;
  };

  onMounted(() => {
    unsubscribe = client.subscribe((next) => {
      items.value = next;
    });
    void client
      .list()
      .then((next) => {
        items.value = next;
      })
      .catch((error: unknown) => console.warn('[PoeXD] 讀取釘選清單失敗:', error));
  });
  onUnmounted(() => unsubscribe?.());

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
    if (states.value[item.id] === 'busy') return;
    const continueInDemand = states.value[item.id] === 'in-demand';
    setState(item.id, 'busy');
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
      { continueInDemand },
    );
    const nextState: PinnedItemTransientState | undefined =
      outcome.status === 'sold' ||
      outcome.status === 'in-demand' ||
      outcome.status === 'teleporting'
        ? outcome.status
        : undefined;
    setState(item.id, nextState);
    const message = t(TRAVEL_MESSAGES[outcome.status]);
    // 錯誤訊息只帶官方回應的說明文字，不含 token
    notify(
      outcome.status === 'error' ? `${message} ${outcome.message}` : message,
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

  async function clearVisible() {
    const league = showAllLeagues.value || !currentLeague ? undefined : currentLeague;
    const outcome = await client.clear(league);
    if (!outcome.ok) notify(t('pinnedItem.toast.failed'), 'error');
  }

  return {
    items,
    visibleItems,
    hiddenCount,
    showAllLeagues,
    states,
    currentLeague,
    limit: PINNED_ITEM_LIMIT,
    sameRealm,
    canCopyPob,
    sourceUrl,
    copyWhisper,
    travel,
    copyPob,
    openSource,
    unpin,
    clearVisible,
  };
}
