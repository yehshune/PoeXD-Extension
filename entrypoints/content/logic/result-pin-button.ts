/**
 * 結果卡片的釘選按鈕內部 adapter（左上 hover 工具列，圖示為 Lucide `pin`）。
 *
 * 一般搜尋頁、即時搜尋與線上搜尋主控台都會掛載；物品資料來自共用的 `TradeResultCache`。
 */
import { t } from '@/utils/i18n';
import { capturePinnedCardDom } from '@/utils/pinned-card-dom';
import { createPinnedItemSnapshot, PINNED_ITEM_LIMIT } from '@/utils/pinned-items';
import { createSvgIcon, type SvgIconSpec } from '@/utils/safe-dom';
import type { PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';
import { readOfficialRowCurrency, TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';
import type { ResultEnhancementHostPort } from './result-enhancement-host-port';
import {
  PIN_ICON_PATHS,
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  RESULT_PIN_BUTTON_CLASS,
  RESULT_PINNED_ROW_CLASS,
  ensureResultEnhancementStyle,
  removeResultEnhancementStyle,
} from './result-enhancement-styles';
import {
  RESULT_ITEM_ROW_SELECTOR,
  collectResultRows,
  mountLeftAction,
  removeLeftActionsByClass,
  resolveRowId,
} from './result-left-actions';

export { RESULT_PIN_BUTTON_CLASS, RESULT_PINNED_ROW_CLASS };

const PIN_ICON: SvgIconSpec = {
  attrs: {
    viewBox: '0 0 24 24',
    width: '12',
    height: '12',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  },
  paths: PIN_ICON_PATHS,
};

function findRow(resultId: string, doc: Document): Element | undefined {
  return Array.from(doc.querySelectorAll(RESULT_ITEM_ROW_SELECTOR)).find(
    (candidate) => resolveRowId(candidate) === resultId,
  );
}

export class ResultPinButtonAdapter {
  private enabled = false;
  private pinnedIds = new Set<string>();
  private readonly pending = new Set<string>();
  private unsubscribe?: () => void;

  constructor(
    private readonly version: PoeVersion,
    private readonly port: ResultEnhancementHostPort,
    private readonly cache: TradeResultCache,
  ) {}

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.removeInjected();
      return;
    }
    this.unsubscribe = this.port.pinnedItems.subscribe((items) =>
      this.setPinnedIds(items.map((i) => i.id)),
    );
    void this.port.pinnedItems
      .list()
      .then((items) => {
        if (this.enabled) this.setPinnedIds(items.map((i) => i.id));
      })
      .catch((error: unknown) => console.warn('[PoeXD] 讀取釘選清單失敗:', error));
    this.refresh();
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
      if (!id || !this.cache.get(id)?.listing) continue;
      let button = row.querySelector<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`);
      if (!button) {
        button = this.createButton(id);
        mountLeftAction(row, button, this.port.doc);
        injected = true;
      }
      this.syncRow(row, button, id);
    }
    if (injected) ensureResultEnhancementStyle('pin', this.port.doc);
  }

  refreshLocale(): void {
    this.port.doc
      .querySelectorAll<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`)
      .forEach((button) => {
        button.setAttribute('title', this.titleFor(button.getAttribute('aria-pressed') === 'true'));
      });
  }

  cleanup(): void {
    this.setEnabled(false);
    this.pinnedIds.clear();
  }

  private async toggle(resultId: string): Promise<void> {
    if (this.pending.has(resultId)) return;
    this.pending.add(resultId);
    try {
      await this.performToggle(resultId);
    } catch (error: unknown) {
      console.warn('[PoeXD] 釘選失敗:', error instanceof Error ? error.message : error);
      this.port.notify(t('pinnedItem.toast.failed'), 'error');
    } finally {
      this.pending.delete(resultId);
    }
  }

  private async performToggle(resultId: string): Promise<void> {
    if (this.pinnedIds.has(resultId)) {
      const outcome = await this.port.pinnedItems.unpin(resultId);
      if (!outcome.ok) this.port.notify(t('pinnedItem.toast.failed'), 'error');
      return;
    }
    const entry = this.cache.get(resultId);
    const pageCtx = this.port.getPageContext();
    const league = entry?.league ?? pageCtx.league;
    const row = findRow(resultId, this.port.doc);
    const now = this.port.now ? this.port.now() : Date.now();
    const snapshot =
      entry && league
        ? createPinnedItemSnapshot(
            entry,
            {
              gameVersion: this.version,
              origin: pageCtx.origin,
              league,
              sourceSearchId: entry.sourceSearchId,
              locale: pageCtx.pageLocale,
              currency: row ? readOfficialRowCurrency(row) : undefined,
              card: row ? capturePinnedCardDom(row) : undefined,
            },
            now,
          )
        : undefined;
    if (!snapshot) {
      this.port.notify(t('pinnedItem.toast.unavailable'), 'error');
      return;
    }
    const outcome = await this.port.pinnedItems.pin(snapshot);
    if (outcome.ok) {
      this.port.notify(t('pinnedItem.toast.pinned'), 'success');
    } else if (outcome.error.code === 'limit') {
      this.port.notify(t('pinnedItem.toast.limit', { limit: PINNED_ITEM_LIMIT }), 'error');
    } else {
      this.port.notify(t('pinnedItem.toast.failed'), 'error');
    }
  }

  private setPinnedIds(ids: readonly string[]): void {
    this.pinnedIds = new Set(ids);
    this.port.doc.querySelectorAll(RESULT_ITEM_ROW_SELECTOR).forEach((row) => {
      const button = row.querySelector<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`);
      if (button) this.syncRow(row, button, resolveRowId(row));
    });
  }

  private syncRow(row: Element, button: HTMLButtonElement, id: string): void {
    const pinned = this.pinnedIds.has(id);
    row.classList.toggle(RESULT_PINNED_ROW_CLASS, pinned);
    button.setAttribute('aria-pressed', String(pinned));
    button.setAttribute('title', this.titleFor(pinned));
  }

  private titleFor(pinned: boolean): string {
    return pinned ? t('common.unpin') : t('pinnedItem.button.pinTitle');
  }

  private createButton(resultId: string): HTMLButtonElement {
    const button = this.port.doc.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${RESULT_PIN_BUTTON_CLASS}`;
    button.appendChild(createSvgIcon(PIN_ICON, this.port.doc));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.toggle(resultId);
    });
    return button;
  }

  private removeInjected(): void {
    removeLeftActionsByClass(RESULT_PIN_BUTTON_CLASS, this.port.doc);
    this.port.doc
      .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .${RESULT_PINNED_ROW_CLASS}`)
      .forEach((row) => row.classList.remove(RESULT_PINNED_ROW_CLASS));
    removeResultEnhancementStyle('pin', this.port.doc);
  }
}
