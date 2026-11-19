import {
  createResultPriceComparisons,
  parseCurrencyRateSnapshot,
  type CurrencyRateSnapshot,
  type PriceComparison,
} from '@/utils/price-comparison';
import type { PoeVersion } from '@/utils/trade-context';
import {
  getTradePageMode,
  isLiveOrConsoleTradePage,
  type TradePageMode,
} from '@/utils/trade-page-mode';
import type { TradePageRole } from '@/utils/live-search-contract';
import { extensionMessaging } from '@/utils/extension-protocol';
import { parsePoeFetchResponse } from '@/utils/event-contracts';
import { isPriceConversionSupported } from '@/utils/trade-realms';
import { t, getActiveDisplayLocale } from '@/utils/i18n';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

type CurrencyRateLoader = (league: string) => Promise<CurrencyRateSnapshot | undefined>;

type RawListingPrice = {
  price?: {
    amount?: number;
    currency?: string;
  };
};

export class ResultPricePresenter {
  private enabled = true;
  private pageMode: TradePageMode = typeof window !== 'undefined' ? getTradePageMode() : 'search';
  private pageRole: TradePageRole = 'normal';
  private activeSearchId?: string;
  private activeLeague?: string;
  private observedResults: unknown[] = [];
  private comparisons: Record<string, PriceComparison> = {};
  private rawItemsMap: Record<string, { listing?: RawListingPrice }> = {};
  private latestRates?: CurrencyRateSnapshot;
  private ratesLeague?: string;
  private rateListeners = new Set<() => void>();

  constructor(
    private readonly version: PoeVersion,
    private readonly loadRates: CurrencyRateLoader = (league) =>
      fetchCurrencyRates(version, league),
    /** poe.ninja 只有國際服匯率：台服、QQ 等網域不取匯率也不顯示換算 */
    private readonly supported: boolean = isPriceConversionSupported(),
  ) {}

  private isLiveOrConsole(): boolean {
    return isLiveOrConsoleTradePage(this.pageMode, this.pageRole);
  }

  private resetSessionState() {
    this.activeSearchId = undefined;
    this.activeLeague = undefined;
    this.observedResults = [];
    this.comparisons = {};
    this.rawItemsMap = {};
    this.latestRates = undefined;
    this.ratesLeague = undefined;
    removePriceComparisons();
  }

  onRatesUpdated(listener: () => void): () => void {
    this.rateListeners.add(listener);
    return () => {
      this.rateListeners.delete(listener);
    };
  }

  private notifyRatesUpdated() {
    for (const listener of this.rateListeners) {
      try {
        listener();
      } catch {
        // Individual listener error does not abort other listeners
      }
    }
  }

  async handleFetchResponse(detail: string, league: string | undefined) {
    if (!this.supported || !league || this.isLiveOrConsole()) return;
    const eventData = parsePoeFetchResponse(detail);
    if (!eventData) return;
    const data = eventData.data;
    const results =
      data && typeof data === 'object' && Array.isArray((data as { result?: unknown[] }).result)
        ? (data as { result: unknown[] }).result
        : undefined;
    const searchId = getFetchSearchId(eventData.url);
    if (!Array.isArray(results) || !searchId) return;

    const isSameSearch = searchId === this.activeSearchId;
    if (!isSameSearch) {
      this.activeSearchId = searchId;
      this.observedResults = [];
      this.comparisons = {};
      this.rawItemsMap = {};
      removePriceComparisons();
    }

    this.activeLeague = league;
    this.observedResults.push(...results);
    results.forEach((res) => {
      if (!res || typeof res !== 'object') return;
      const { id, listing } = res as {
        id?: unknown;
        listing?: RawListingPrice;
      };
      if (typeof id === 'string') {
        this.rawItemsMap[id] = { listing };
      }
    });
    if (this.enabled) {
      if (isSameSearch && this.latestRates && this.ratesLeague === league) {
        this.applyComparisonsForResults(results, this.latestRates);
      } else {
        await this.loadAndApply(results, searchId, league);
      }
    }
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!this.isEnabled() || this.isLiveOrConsole()) {
      removePriceComparisons();
      return;
    }
    if (this.activeSearchId && this.activeLeague && this.observedResults.length > 0) {
      await this.loadAndApply(this.observedResults, this.activeSearchId, this.activeLeague);
    }
  }

  setPageRole(role: TradePageRole) {
    if (role === this.pageRole) return;
    this.pageRole = role;
    if (this.isLiveOrConsole()) {
      this.resetSessionState();
    }
  }

  setPageMode(mode: TradePageMode) {
    if (mode === this.pageMode) return;
    this.pageMode = mode;
    if (this.isLiveOrConsole()) {
      this.resetSessionState();
    }
  }

  apply(container: Element) {
    if (!this.isEnabled() || this.isLiveOrConsole()) return;
    resultRows(container).forEach((row) => {
      const resultId = resolveResultId(row, this.comparisons);
      if (!resultId) return;
      const price = row.querySelector('.price');
      if (!price) return;
      const priceField = price.querySelector('[data-field="price"]');
      if (!priceField) return;
      const comparison = this.comparisons[resultId];
      let annotation = price.querySelector('.poexd-price-comparison');
      if (!annotation) {
        annotation = document.createElement('span');
        annotation.className = 'poexd-price-comparison';
        priceField.insertAdjacentElement('afterend', annotation);
      }
      renderPriceComparison(annotation, comparison);
    });
    ensurePriceComparisonStyle();
  }

  refreshLocale() {
    if (!this.isEnabled() || this.isLiveOrConsole()) return;
    const root =
      typeof document !== 'undefined' ? document.querySelector(TRADE_RESULTS_SELECTOR) : null;
    if (root) this.apply(root);
  }

  cleanup() {
    this.enabled = false;
    this.resetSessionState();
    this.latestRates = undefined;
    this.ratesLeague = undefined;
    this.rateListeners.clear();
    document.getElementById('poexd-price-comparison-style')?.remove();
  }

  /** 使用者開啟價格換算，且目前網域支援（僅國際服）。 */
  isEnabled(): boolean {
    return this.enabled && this.supported;
  }

  /**
   * 取得換算為統一主基準幣（Primary Currency）的金額數值，供價格／性價比排序使用。
   * 若價格換算未開啟、處於即時搜尋/主控台、尚未取得匯率或該物品無標價則回傳 undefined。
   */
  getPrimaryPrice(resultId: string): number | undefined {
    if (!this.isEnabled() || this.isLiveOrConsole() || !this.latestRates) return undefined;
    const item = this.rawItemsMap[resultId];
    const price = item?.listing?.price;
    if (
      !price ||
      typeof price.amount !== 'number' ||
      !Number.isFinite(price.amount) ||
      price.amount <= 0 ||
      typeof price.currency !== 'string'
    ) {
      return undefined;
    }

    // 若標價貨幣即為主基準幣（例如 PoE 1 的 chaos、PoE 2 的 exalted），比率為 1
    if (
      this.latestRates.primary &&
      price.currency.toLowerCase() === this.latestRates.primary.toLowerCase()
    ) {
      return price.amount;
    }

    const rate =
      this.latestRates.rates[price.currency] ??
      this.latestRates.rates[price.currency.toLowerCase()];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return undefined;
    return price.amount * rate;
  }

  private applyComparisonsForResults(results: unknown[], snapshot: CurrencyRateSnapshot) {
    Object.assign(this.comparisons, createResultPriceComparisons(this.version, snapshot, results));
    const root =
      typeof document !== 'undefined' ? document.querySelector(TRADE_RESULTS_SELECTOR) : null;
    if (root) this.apply(root);
    this.notifyRatesUpdated();
  }

  private async loadAndApply(results: unknown[], searchId: string, league: string) {
    const snapshot = await this.loadRates(league);
    if (!snapshot || !this.enabled || this.isLiveOrConsole() || searchId !== this.activeSearchId)
      return;
    this.latestRates = snapshot;
    this.ratesLeague = league;
    this.applyComparisonsForResults(results, snapshot);
  }
}

function resultRows(container: Element) {
  const rows = Array.from(container.querySelectorAll('.row[data-id], .row[id]'));
  if (container.matches('.row[data-id], .row[id]')) rows.unshift(container);
  return rows;
}

export async function fetchCurrencyRates(
  version: PoeVersion,
  league: string,
  messenger = extensionMessaging,
) {
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

function getFetchSearchId(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value, window.location.origin).searchParams.get('query') || undefined;
  } catch {
    return undefined;
  }
}

function resolveResultId(row: Element, comparisons: Record<string, PriceComparison>) {
  const candidates = [row.getAttribute('data-id'), row.getAttribute('id')];
  return candidates.find((candidate) => candidate && comparisons[candidate]) || undefined;
}

function removePriceComparisons() {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .poexd-price-comparison`)
    .forEach((element) => element.remove());
}

export function ensurePriceComparisonStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('poexd-price-comparison-style')) return;
  const style = document.createElement('style');
  style.id = 'poexd-price-comparison-style';
  style.textContent = `
    .poexd-price-comparison {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      padding: 5px 10px !important;
      margin: 4px 0 !important;
      background-color: var(--muted);
      border: 1px solid var(--border);
      font-size: 14px !important;
      line-height: 1.25 !important;
      white-space: nowrap;
    }
    .poexd-price-comparison-icon {
      display: block !important;
      width: 24px !important;
      height: 24px !important;
      flex-shrink: 0 !important;
      object-fit: contain !important;
    }
    .results.compact .poexd-price-comparison {
      display: inline-flex !important;
      gap: 4px !important;
      height: 20px !important;
      padding: 0 6px !important;
      margin: 0 6px 0 0 !important;
      font-size: 11px !important;
      line-height: 1 !important;
    }
    .results.compact .poexd-price-comparison-icon {
      width: 16px !important;
      height: 16px !important;
    }
  `;
  document.head.appendChild(style);
}

function renderPriceComparison(annotation: Element, comparison: PriceComparison) {
  const units: Record<PriceComparison['currency'], { name: string; icon: string }> = {
    chaos: {
      name: t('pricePresenter.currency.chaos'),
      icon: 'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lSZXJvbGxSYXJlIiwic2NhbGUiOjF9XQ/46a2347805/CurrencyRerollRare.png',
    },
    divine: {
      name: t('pricePresenter.currency.divine'),
      icon: 'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lNb2RWYWx1ZXMiLCJzY2FsZSI6MX1d/ec48896769/CurrencyModValues.png',
    },
    exalted: {
      name: t('pricePresenter.currency.exalted'),
      icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQ3VycmVuY3kvQ3VycmVuY3lBZGRNb2RUb1JhcmUiLCJzY2FsZSI6MSwicmVhbG0iOiJwb2UyIn1d/ad7c366789/CurrencyAddModToRare.png',
    },
  };
  const unit = units[comparison.currency];
  const amount = new Intl.NumberFormat(getActiveDisplayLocale(), {
    maximumSignificantDigits: 4,
  }).format(comparison.amount);
  const icon = document.createElement('img');
  icon.className = 'poexd-price-comparison-icon';
  icon.src = unit.icon;
  icon.alt = unit.name;
  icon.title = unit.name;
  annotation.setAttribute('title', t('pricePresenter.tooltip', { amount, currency: unit.name }));
  annotation.replaceChildren(document.createTextNode(`≈ ${amount}`), icon);
}
