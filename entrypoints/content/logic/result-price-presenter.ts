/**
 * 結果列價格換算內部 adapter。
 *
 * 價格原始資料直接讀取共用 `TradeResultCache`，不再私自保存 `rawItemsMap` 或重複解析 `/fetch`。
 */
import { getActiveDisplayLocale, t } from '@/utils/i18n';
import {
  PRICE_COMPARISON_CURRENCIES,
  createResultPriceComparisons,
  formatConvertedAmount,
  type CurrencyRateSnapshot,
  type PriceComparison,
} from '@/utils/price-comparison';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import type { ResultEnhancementHostPort, ResultFetchBatch } from './result-enhancement-host-port';
import {
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import { collectResultRows, resolveMappedRowId } from './result-left-actions';

type RawListingPrice = {
  price?: {
    amount?: number;
    currency?: string;
  };
};

export class ResultPricePresenterAdapter {
  private enabled = true;
  private scopeActive = true;
  private activeSearchId?: string;
  private activeLeague?: string;
  private comparisons: Record<string, PriceComparison> = {};
  private latestRates?: CurrencyRateSnapshot;
  private ratesLeague?: string;

  constructor(
    private readonly version: PoeVersion,
    private readonly port: ResultEnhancementHostPort,
    private readonly cache: TradeResultCache,
    private readonly onRatesUpdated: () => void,
  ) {}

  private isSupported(): boolean {
    return this.port.getPageContext().isPriceConversionSupported;
  }

  /** 使用者開啟價格換算，且目前網域支援（僅國際服）。 */
  isEnabled(): boolean {
    return this.enabled && this.isSupported();
  }

  private resetSessionState(): void {
    this.activeSearchId = undefined;
    this.activeLeague = undefined;
    this.comparisons = {};
    this.latestRates = undefined;
    this.ratesLeague = undefined;
    this.removePriceComparisons();
  }

  async onFetchBatch(batch: ResultFetchBatch): Promise<void> {
    if (!this.isSupported() || !batch.league || !this.scopeActive) return;

    const isSameSearch = !batch.isNewSearch && batch.searchId === this.activeSearchId;
    if (!isSameSearch) {
      this.activeSearchId = batch.searchId;
      this.comparisons = {};
      this.removePriceComparisons();
    }

    this.activeLeague = batch.league;
    if (this.enabled) {
      if (isSameSearch && this.latestRates && this.ratesLeague === batch.league) {
        this.applyComparisonsForResults(batch.results, this.latestRates);
      } else {
        await this.loadAndApply(batch.results, batch.searchId, batch.league);
      }
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!this.isEnabled() || !this.scopeActive) {
      this.removePriceComparisons();
      return;
    }
    if (this.activeSearchId && this.activeLeague) {
      const cached = this.cache.entriesForSearch(this.activeSearchId);
      if (cached.length > 0) {
        await this.loadAndApply(cached, this.activeSearchId, this.activeLeague);
      }
    }
  }

  onScopeActiveChange(active: boolean): void {
    if (active === this.scopeActive) return;
    this.scopeActive = active;
    if (!active) {
      this.resetSessionState();
    }
  }

  apply(container: Element): void {
    if (!this.isEnabled() || !this.scopeActive) return;
    let rendered = false;
    collectResultRows(container).forEach((row) => {
      const resultId = resolveMappedRowId(row, this.comparisons);
      if (!resultId) return;
      const price = row.querySelector('.price');
      if (!price) return;
      const priceField = price.querySelector('[data-field="price"]');
      if (!priceField) return;
      const comparison = this.comparisons[resultId];
      let annotation = price.querySelector('.poexd-price-comparison');
      if (!annotation) {
        annotation = this.port.doc.createElement('span');
        annotation.className = 'poexd-price-comparison';
        priceField.insertAdjacentElement('afterend', annotation);
      }
      renderPriceComparison(this.port.doc, annotation, comparison);
      rendered = true;
    });
    if (rendered || Object.keys(this.comparisons).length > 0) {
      ensureResultEnhancementStyle('price-comparison', this.port.doc);
    }
  }

  refreshLocale(): void {
    if (!this.isEnabled() || !this.scopeActive) return;
    const root = this.port.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  cleanup(): void {
    this.enabled = false;
    this.resetSessionState();
    removeResultEnhancementStyle('price-comparison', this.port.doc);
  }

  /**
   * 取得換算為統一主基準幣（Primary Currency）的金額數值，供價格／性價比排序使用。
   * 若價格換算未開啟、非一般搜尋、尚未取得匯率或該物品無標價則回傳 undefined。
   */
  getPrimaryPrice(resultId: string): number | undefined {
    if (!this.isEnabled() || !this.scopeActive || !this.latestRates) return undefined;
    const listing = this.cache.get(resultId)?.listing as RawListingPrice | undefined;
    const price = listing?.price;
    if (
      !price ||
      typeof price.amount !== 'number' ||
      !Number.isFinite(price.amount) ||
      price.amount <= 0 ||
      typeof price.currency !== 'string'
    ) {
      return undefined;
    }

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

  private applyComparisonsForResults(results: readonly unknown[], snapshot: CurrencyRateSnapshot) {
    Object.assign(
      this.comparisons,
      createResultPriceComparisons(this.version, snapshot, [...results]),
    );
    const root = this.port.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
    this.onRatesUpdated();
  }

  private async loadAndApply(results: readonly unknown[], searchId: string, league: string) {
    const snapshot = await this.port.loadRates(league);
    if (!snapshot || !this.enabled || !this.scopeActive || searchId !== this.activeSearchId) return;
    this.latestRates = snapshot;
    this.ratesLeague = league;
    this.applyComparisonsForResults(results, snapshot);
  }

  private removePriceComparisons(): void {
    this.port.doc
      .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .poexd-price-comparison`)
      .forEach((element) => element.remove());
  }
}

function renderPriceComparison(doc: Document, annotation: Element, comparison: PriceComparison) {
  const currencyMeta = PRICE_COMPARISON_CURRENCIES[comparison.currency];
  const currencyName = t(currencyMeta.labelKey);
  const amount = formatConvertedAmount(comparison.amount, getActiveDisplayLocale());
  const icon = doc.createElement('img');
  icon.className = 'poexd-price-comparison-icon';
  icon.src = currencyMeta.icon;
  icon.alt = currencyName;
  icon.title = currencyName;
  annotation.setAttribute('title', t('pricePresenter.tooltip', { amount, currency: currencyName }));
  annotation.replaceChildren(doc.createTextNode(`≈ ${amount}`), icon);
}
