/**
 * 結果卡片的釘選按鈕（左上 hover 工具列，圖示為 Lucide `pin`）。已釘選的結果列顯示常駐標記，再按一次取消。
 *
 * 一般搜尋頁、即時搜尋與線上搜尋主控台都會掛載；物品資料來自共用的 `TradeResultCache`。
 */
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { capturePinnedCardDom } from '@/utils/pinned-card-dom';
import type { PinnedItemClient } from '@/utils/pinned-item-client';
import { createPinnedItemSnapshot, PINNED_ITEM_LIMIT } from '@/utils/pinned-items';
import { createSvgIcon, type SvgIconSpec } from '@/utils/safe-dom';
import { getTradeLeague, type PoeVersion } from '@/utils/trade-context';
import type { TradeResultCache } from '@/utils/trade-result-cache';

import {
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  mountLeftAction,
  removeLeftActionsByClass,
} from './result-left-actions';
import { removeTradeResultStyle, TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

const STYLE_ID = 'poexd-result-pin-style';
const ITEM_ROW_SELECTOR = '.row[data-id], .row[id]';

const resolveRowId = (row: Element): string =>
  row.getAttribute('data-id') || row.getAttribute('id') || '';

export const RESULT_PIN_BUTTON_CLASS = 'poexd-pin-btn';
export const RESULT_PINNED_ROW_CLASS = 'poexd-row-pinned';

/** Lucide `pin` 的 path（與 Sidebar 導覽列的 `Pin` 圖示相同；注入頁面的 DOM 不能用 Vue 元件） */
const PIN_ICON_PATHS = [
  'M12 17v5',
  'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
] as const;

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

/** 常駐標記用 CSS mask 畫同一個圖示，不另外產生 DOM 節點 */
const PIN_ICON_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${PIN_ICON_PATHS.map((d) => `<path d='${d}'/>`).join('')}</svg>`,
)}")`;

// 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）
const STYLE_CONTENT = `
  .${RESULT_PIN_BUTTON_CLASS} {
    order: 0 !important;
    color: oklch(0.858 0.068 82.8) !important;
  }

  .${RESULT_PIN_BUTTON_CLASS}:hover,
  .${RESULT_PIN_BUTTON_CLASS}[aria-pressed='true'] {
    border-color: oklch(0.58 0.08 82.8) !important;
  }

  /* 已釘選時圖示填滿 */
  .${RESULT_PIN_BUTTON_CLASS}[aria-pressed='true'] svg {
    fill: currentColor;
  }

  /*
   * 標記掛在物品圖示容器上：官方已經使用 \`.left::after\`，覆寫它會讓官方 hover 按鈕位移；
   * \`.iconContainer\` 本身是 relative，官方也沒有使用它的偽元素
   */
  .row.${RESULT_PINNED_ROW_CLASS} > .left .iconContainer::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 1;
    width: 14px;
    height: 14px;
    background-color: oklch(0.858 0.068 82.8);
    -webkit-mask: ${PIN_ICON_MASK} center / contain no-repeat;
    mask: ${PIN_ICON_MASK} center / contain no-repeat;
    pointer-events: none;
  }
`;

export interface ResultPinButtonDeps {
  getOrigin: () => string;
  getPageLeague: () => string | undefined;
  getPageLocale: () => string;
  now: () => number;
  notify: (message: string, tone: 'success' | 'error') => void;
  /** 結果列價格旁的通貨圖示與名稱（官方 fetch 回應沒有圖示網址） */
  readCurrency: (resultId: string) => { icon?: string; name?: string } | undefined;
  /** 結果列上的官方卡片快照（建立快照時再驗證） */
  readCard: (resultId: string) => unknown;
}

function findRow(resultId: string, doc: Document): Element | undefined {
  return Array.from(doc.querySelectorAll(ITEM_ROW_SELECTOR)).find(
    (candidate) => resolveRowId(candidate) === resultId,
  );
}

/** 從畫面上的結果列讀取通貨圖示；內容會在建立快照時再驗證 */
export function readRowCurrency(
  resultId: string,
  doc: Document = document,
): { icon?: string; name?: string } | undefined {
  const img = findRow(resultId, doc)?.querySelector<HTMLImageElement>('.price .currency-image img');
  if (!img) return undefined;
  const name =
    img.closest('.currency-image')?.querySelector(':scope > span')?.textContent?.trim() ||
    img.getAttribute('title') ||
    undefined;
  return { icon: img.src, ...(name ? { name } : {}) };
}

const defaultDeps: ResultPinButtonDeps = {
  getOrigin: () => window.location.origin,
  getPageLeague: () => getTradeLeague(),
  getPageLocale: () => resolvePageLocale(),
  now: () => Date.now(),
  notify: (message, tone) => dispatchPoeEvent('poexd-toast', { message, tone }),
  readCurrency: (resultId) => readRowCurrency(resultId),
  readCard: (resultId) => {
    const row = findRow(resultId, document);
    return row ? capturePinnedCardDom(row) : undefined;
  },
};

export class ResultPinButton {
  private enabled = false;
  private pinnedIds = new Set<string>();
  private readonly pending = new Set<string>();
  private unsubscribe?: () => void;
  private readonly deps: ResultPinButtonDeps;

  constructor(
    private readonly version: PoeVersion,
    private readonly cache: TradeResultCache,
    private readonly client: PinnedItemClient,
    deps: Partial<ResultPinButtonDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.removeInjected();
      return;
    }
    this.unsubscribe = this.client.subscribe((items) => this.setPinnedIds(items.map((i) => i.id)));
    void this.client
      .list()
      .then((items) => {
        if (this.enabled) this.setPinnedIds(items.map((i) => i.id));
      })
      .catch((error: unknown) => console.warn('[PoeXD] 讀取釘選清單失敗:', error));
    this.refresh();
  }

  /** 快取有新結果後，替已在畫面上的結果補上按鈕 */
  refresh(): void {
    if (!this.enabled || typeof document === 'undefined') return;
    const root = document.querySelector(TRADE_RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.enabled) return;
    const rows = Array.from(container.querySelectorAll(ITEM_ROW_SELECTOR));
    if (container.matches?.(ITEM_ROW_SELECTOR)) rows.unshift(container);

    let injected = false;
    for (const row of rows) {
      const id = resolveRowId(row);
      if (!id || !this.cache.get(id)?.listing) continue;
      let button = row.querySelector<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`);
      if (!button) {
        button = this.createButton(id);
        mountLeftAction(row, button);
        injected = true;
      }
      this.syncRow(row, button, id);
    }
    if (injected) this.ensureStyle();
  }

  refreshLocale(): void {
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll<HTMLButtonElement>(`.${RESULT_PIN_BUTTON_CLASS}`)
      .forEach((button) => {
        button.setAttribute('title', this.titleFor(button.getAttribute('aria-pressed') === 'true'));
      });
  }

  cleanup(): void {
    this.setEnabled(false);
    this.pinnedIds.clear();
  }

  /**
   * 釘選或取消釘選；按鈕點擊與測試共用。
   * 背景通訊失敗（例如擴充功能重新載入後舊 content script 的 context 失效）時要提示，不可靜默。
   */
  async toggle(resultId: string): Promise<void> {
    if (this.pending.has(resultId)) return;
    this.pending.add(resultId);
    try {
      await this.performToggle(resultId);
    } catch (error: unknown) {
      console.warn('[PoeXD] 釘選失敗:', error instanceof Error ? error.message : error);
      this.deps.notify(t('pinnedItem.toast.failed'), 'error');
    } finally {
      this.pending.delete(resultId);
    }
  }

  private async performToggle(resultId: string): Promise<void> {
    if (this.pinnedIds.has(resultId)) {
      const outcome = await this.client.unpin(resultId);
      if (!outcome.ok) this.deps.notify(t('pinnedItem.toast.failed'), 'error');
      return;
    }
    const entry = this.cache.get(resultId);
    const league = entry?.league ?? this.deps.getPageLeague();
    const snapshot =
      entry && league
        ? createPinnedItemSnapshot(
            entry,
            {
              gameVersion: this.version,
              origin: this.deps.getOrigin(),
              league,
              sourceSearchId: entry.sourceSearchId,
              locale: this.deps.getPageLocale(),
              currency: this.deps.readCurrency(resultId),
              card: this.deps.readCard(resultId),
            },
            this.deps.now(),
          )
        : undefined;
    if (!snapshot) {
      this.deps.notify(t('pinnedItem.toast.unavailable'), 'error');
      return;
    }
    const outcome = await this.client.pin(snapshot);
    if (outcome.ok) {
      this.deps.notify(t('pinnedItem.toast.pinned'), 'success');
    } else if (outcome.error.code === 'limit') {
      this.deps.notify(t('pinnedItem.toast.limit', { limit: PINNED_ITEM_LIMIT }), 'error');
    } else {
      this.deps.notify(t('pinnedItem.toast.failed'), 'error');
    }
  }

  private setPinnedIds(ids: readonly string[]): void {
    this.pinnedIds = new Set(ids);
    if (typeof document === 'undefined') return;
    document.querySelectorAll(ITEM_ROW_SELECTOR).forEach((row) => {
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
    return pinned ? t('pinnedItem.button.unpinTitle') : t('pinnedItem.button.pinTitle');
  }

  private createButton(resultId: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${RESULT_PIN_BUTTON_CLASS}`;
    button.appendChild(createSvgIcon(PIN_ICON));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.toggle(resultId);
    });
    return button;
  }

  private ensureStyle(): void {
    ensureResultPinStyle();
  }

  private removeInjected(): void {
    if (typeof document === 'undefined') return;
    removeLeftActionsByClass(RESULT_PIN_BUTTON_CLASS);
    document
      .querySelectorAll(`${TRADE_RESULTS_SELECTOR} .${RESULT_PINNED_ROW_CLASS}`)
      .forEach((row) => row.classList.remove(RESULT_PINNED_ROW_CLASS));
    removeTradeResultStyle(STYLE_ID);
  }
}

/** 注入按鈕樣式；導覽的示意結果列也會呼叫，確保頁面還沒有結果時樣式已存在 */
export function ensureResultPinStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_CONTENT;
  (document.head ?? document.documentElement).appendChild(style);
}
