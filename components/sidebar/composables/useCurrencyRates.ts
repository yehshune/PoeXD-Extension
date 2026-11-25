import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { fetchCurrencyRates } from '@/entrypoints/content/logic/result-enhancement-host-port';
import { getPreferences } from '@/utils/preferences';
import type { CurrencyRateSnapshot } from '@/utils/price-comparison';
import type { PoeVersion } from '@/utils/trade-context';
import { isPriceConversionSupported } from '@/utils/trade-realms';

export interface UseCurrencyRatesOptions {
  version: PoeVersion;
  resolveLeague: () => string | undefined;
}

/**
 * 依 Preference (`enablePriceComparison`) 與目前聯盟載入通貨匯率快照，
 * 具備聯盟切換失效與請求世代 (requestId) 防競態保護，供 Result Board 與 Pinned Item 共用。
 */
export function useCurrencyRates({ version, resolveLeague }: UseCurrencyRatesOptions) {
  const enablePriceComparison = ref(true);
  const loadedRates = shallowRef<CurrencyRateSnapshot | undefined>(undefined);
  const rates = computed(() => (enablePriceComparison.value ? loadedRates.value : undefined));

  let loadedRatesLeague: string | undefined;
  let loadingRatesLeague: string | undefined;
  let ratesLoading = false;
  let ratesRequestId = 0;
  let disposed = false;
  let unsubscribePrefs: (() => void) | undefined;

  async function ensureRates(): Promise<void> {
    const currentLeague = resolveLeague();
    if (!enablePriceComparison.value || !currentLeague || !isPriceConversionSupported()) {
      return;
    }
    if (loadedRates.value && loadedRatesLeague === currentLeague) return;
    if (ratesLoading && loadingRatesLeague === currentLeague) return;
    if (loadedRatesLeague && loadedRatesLeague !== currentLeague) {
      loadedRates.value = undefined;
      loadedRatesLeague = undefined;
    }
    const requestId = ++ratesRequestId;
    ratesLoading = true;
    loadingRatesLeague = currentLeague;
    try {
      const loaded = await fetchCurrencyRates(version, currentLeague);
      if (
        !disposed &&
        requestId === ratesRequestId &&
        loaded &&
        resolveLeague() === currentLeague
      ) {
        loadedRates.value = loaded;
        loadedRatesLeague = currentLeague;
      }
    } finally {
      if (requestId === ratesRequestId) {
        ratesLoading = false;
        loadingRatesLeague = undefined;
      }
    }
  }

  onMounted(() => {
    void getPreferences(version).then((outcome) => {
      if (disposed) return;
      if (!outcome.ok) {
        void ensureRates();
        return;
      }
      unsubscribePrefs = outcome.value.subscribe((snapshot) => {
        enablePriceComparison.value = snapshot.enablePriceComparison;
        if (snapshot.enablePriceComparison) {
          void ensureRates();
        }
      });
    });
  });

  onUnmounted(() => {
    disposed = true;
    unsubscribePrefs?.();
  });

  return {
    enablePriceComparison,
    rates,
    ensureRates,
  };
}
