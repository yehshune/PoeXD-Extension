/**
 * 結果卡片的「複製 PoB 物品文字」內部 adapter。
 *
 * 物品資料來自共用的 `TradeResultCache`，實際複製與英文反查委派給無 DOM 的 `PobItemExporter`。
 */
import { t } from '@/utils/i18n';
import { isPobExportableItem } from '@/utils/pob-item-text';
import type { PobItemExporter } from '@/utils/pob-item-export';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import {
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  RESULT_POB_COPY_BUTTON_CLASS,
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import {
  collectResultRows,
  mountLeftAction,
  removeLeftActionsByClass,
  resolveRowId,
} from './result-left-actions';

export { RESULT_POB_COPY_BUTTON_CLASS };

export class ResultPobCopyAdapter {
  private enabled = false;

  constructor(
    private readonly doc: Document,
    private readonly cache: TradeResultCache,
    private readonly exporter: PobItemExporter,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.removeInjected();
      return;
    }
    this.refresh();
  }

  refresh(): void {
    if (!this.enabled) return;
    const root = this.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.enabled) return;
    let injected = false;
    for (const row of collectResultRows(container)) {
      const id = resolveRowId(row);
      if (!id || !isPobExportableItem(this.cache.get(id)?.item)) continue;
      if (row.querySelector(`.${RESULT_POB_COPY_BUTTON_CLASS}`)) continue;
      mountLeftAction(row, this.createButton(id), this.doc);
      injected = true;
    }
    if (injected) ensureResultEnhancementStyle('pob-copy', this.doc);
  }

  refreshLocale(): void {
    this.doc.querySelectorAll(`.${RESULT_POB_COPY_BUTTON_CLASS}`).forEach((button) => {
      button.textContent = t('resultPobCopy.button');
      button.setAttribute('title', t('resultPobCopy.title'));
    });
  }

  cleanup(): void {
    this.enabled = false;
    this.exporter.clearCache();
    this.removeInjected();
  }

  private createButton(resultId: string): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${RESULT_POB_COPY_BUTTON_CLASS}`;
    button.textContent = t('resultPobCopy.button');
    button.setAttribute('title', t('resultPobCopy.title'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.exporter.copyItem(this.cache.get(resultId)?.item);
    });
    return button;
  }

  private removeInjected(): void {
    removeLeftActionsByClass(RESULT_POB_COPY_BUTTON_CLASS, this.doc);
    removeResultEnhancementStyle('pob-copy', this.doc);
  }
}
