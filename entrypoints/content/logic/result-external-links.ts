/**
 * 結果卡片的外部連結按鈕內部 adapter：PoEDB 物品頁。
 *
 * 直接讀取共用的 `TradeResultCache` 與 `PobItemExporter`，不再透過 `ResultItemSource` 依賴 `ResultPobCopy`。
 */
import { getActiveUiLocale, t } from '@/utils/i18n';
import type { PobItemExporter } from '@/utils/pob-item-export';
import { isPobExportableItem } from '@/utils/pob-item-text';
import { buildPoedbUrl } from '@/utils/result-external-links';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import type { ResultEnhancementHostPort } from './result-enhancement-host-port';
import {
  RESULT_EXTERNAL_LINK_BUTTON_CLASS,
  RESULT_EXTERNAL_LINKS_CLASS,
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import {
  collectResultRows,
  mountLeftAction,
  removeLeftActionsByClass,
  resolveRowId,
} from './result-left-actions';

export { RESULT_EXTERNAL_LINKS_CLASS };

export class ResultExternalLinksAdapter {
  private enabled = false;

  constructor(
    private readonly version: PoeVersion,
    private readonly port: ResultEnhancementHostPort,
    private readonly cache: TradeResultCache,
    private readonly exporter: PobItemExporter,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.refresh();
    else this.removeInjected();
  }

  refresh(): void {
    if (!this.enabled) return;
    const root = this.port.doc.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.enabled) return;
    let injected = false;
    for (const row of collectResultRows(container)) {
      const id = resolveRowId(row);
      if (!id || !isPobExportableItem(this.cache.get(id)?.item)) continue;
      if (row.querySelector(`.${RESULT_EXTERNAL_LINKS_CLASS}`)) continue;
      mountLeftAction(row, this.createStrip(id), this.port.doc);
      injected = true;
    }
    if (injected) ensureResultEnhancementStyle('external-links', this.port.doc);
  }

  refreshLocale(): void {
    this.port.doc.querySelectorAll(`.${RESULT_EXTERNAL_LINK_BUTTON_CLASS}`).forEach((button) => {
      button.textContent = t('resultLinks.poedb.button');
      button.setAttribute('title', t('resultLinks.poedb.title'));
    });
  }

  cleanup(): void {
    this.enabled = false;
    this.removeInjected();
  }

  private async openPoedb(resultId: string): Promise<void> {
    const item = this.cache.get(resultId)?.item;
    const englishName = await this.exporter.resolveEnglishName(
      item,
      this.port.getPageContext().pageLocale,
    );
    if (!englishName) {
      this.port.notify(t('resultLinks.toast.poedbNameMissing'), 'error');
      return;
    }
    this.port.openUrl(
      buildPoedbUrl(englishName, { version: this.version, uiLocale: getActiveUiLocale() }),
    );
  }

  private createStrip(resultId: string): HTMLElement {
    const strip = this.port.doc.createElement('div');
    strip.className = RESULT_EXTERNAL_LINKS_CLASS;
    const button = this.port.doc.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${RESULT_EXTERNAL_LINK_BUTTON_CLASS}`;
    button.textContent = t('resultLinks.poedb.button');
    button.setAttribute('title', t('resultLinks.poedb.title'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openPoedb(resultId).catch((error: unknown) =>
        console.error('[PoeXD] 開啟外部連結失敗:', error),
      );
    });
    strip.appendChild(button);
    return strip;
  }

  private removeInjected(): void {
    removeLeftActionsByClass(RESULT_EXTERNAL_LINKS_CLASS, this.port.doc);
    removeResultEnhancementStyle('external-links', this.port.doc);
  }
}
