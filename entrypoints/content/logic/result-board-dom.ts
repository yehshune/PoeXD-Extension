/**
 * 搜尋結果看板的官方頁面 DOM 操作（`ResultBoardRuntime` 內部實作檔）：
 * 負責樣式注入、結果數旁捷徑按鈕、官方結果列定位高亮、`.gone` 觀察與純 CSS 官方過濾橫條。
 */
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import type { CurrencyDisplay } from '@/utils/result-board/board-session';
import { readOfficialRowCurrency } from '@/utils/trade-results-root';

/** 看板同步過濾左側官方結果列的狀態（顯式 opt-in，純 CSS 隱藏不改動官方排序） */
export interface OfficialFilterSync {
  matchedIds: ReadonlySet<string>;
  totalCount: number;
  onReset: () => void;
}

const LOCATE_HIGHLIGHT_MS = 2_000;
const STYLE_ID = 'poexd-result-board-style';
const SHORTCUT_CLASS = 'poexd-board-shortcut';
const LOCATE_CLASS = 'poexd-board-locate';
const SYNC_HIDDEN_CLASS = 'poexd-board-sync-hidden';
const SYNC_BANNER_CLASS = 'poexd-board-sync-banner';
export const ROW_SELECTOR = '.resultset .row[data-id]';
const GONE_ROW_SELECTOR = '.row[data-id].gone';
/** 官方結果列上可納入看板搜尋的文字節點（品名、基底、詞綴、階級，排除按鈕與 UI 雜訊） */
const ENTRY_SEARCH_TEXT_SELECTOR =
  '.itemHeader .lc, .item-popup__header-line, .s.lc, [data-field^="stat."], .lc.l.pr, .lc.l.su';
const NATIVE_LAYOUT_BTN_SELECTOR = '.layout-btn';
const NATIVE_LAYOUT_GAP_PX = 8;
const NATIVE_LAYOUT_PITCH_PX = 38;

// 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）
const STYLE_CONTENT = `
  .row.row-total > .${SHORTCUT_CLASS} {
    position: absolute;
    top: var(--poexd-native-btn-top, 0px);
    right: var(--poexd-board-shortcut-right, 8px);
    box-sizing: border-box;
    height: var(--poexd-native-btn-size, 30px);
    padding: 0 12px;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid oklch(0.387 0 0);
    border-radius: 0;
    background: oklch(0.245 0.006 250 / 0.96);
    color: oklch(0.858 0.068 82.8);
    box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.05);
    font-family: FontinSmallcaps, Verdana, Arial, Helvetica, sans-serif;
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .row.row-total > .${SHORTCUT_CLASS}:hover {
    background: oklch(0.295 0.006 250);
    border-color: oklch(0.52 0.04 76);
    color: oklch(0.95 0.025 82);
  }
  .row.row-total > .${SHORTCUT_CLASS}:active {
    background: oklch(0.19 0.005 250);
  }
  .row.row-total > .${SHORTCUT_CLASS}:focus-visible {
    outline: 1px solid oklch(0.858 0.068 82.8);
    outline-offset: 1px;
  }
  @media (max-width: 639px) {
    .row.row-total:has(> .${SHORTCUT_CLASS}) {
      padding-top: 38px;
    }
  }
  .resultset .row.${LOCATE_CLASS} {
    outline: 2px solid oklch(0.858 0.068 82.8);
    outline-offset: -2px;
    transition: outline-color 0.3s;
  }
  .resultset .row.${SYNC_HIDDEN_CLASS} {
    display: none !important;
  }
  .${SYNC_BANNER_CLASS} {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 6px 0;
    padding: 8px 12px;
    border: 1px solid oklch(0.52 0.04 76);
    background: oklch(0.245 0.006 250 / 0.96);
    color: oklch(0.92 0.03 82);
    font-family: Verdana, Arial, Helvetica, sans-serif;
    font-size: 13px;
    line-height: 1.4;
  }
  .${SYNC_BANNER_CLASS} > button {
    padding: 3px 10px;
    border: 1px solid oklch(0.52 0.04 76);
    background: oklch(0.295 0.006 250);
    color: oklch(0.95 0.025 82);
    font-size: 12px;
    line-height: 1.3;
    cursor: pointer;
    white-space: nowrap;
  }
  .${SYNC_BANNER_CLASS} > button:hover {
    background: oklch(0.35 0.01 250);
  }
`;

/** 依官方 `.layout-btn` 尺寸與位置避開右排切換鈕；未排版或測試環境則依按鈕數推算右距 */
function syncShortcutLayout(button: HTMLButtonElement, rowTotal: Element): void {
  const layoutButtons = Array.from(
    rowTotal.querySelectorAll<HTMLElement>(NATIVE_LAYOUT_BTN_SELECTOR),
  );
  const measuredButtons = layoutButtons.filter(
    (btn) => Number.isFinite(btn.offsetHeight) && btn.offsetHeight >= 16 && btn.offsetHeight <= 64,
  );
  const rowWidth = (rowTotal as HTMLElement).clientWidth;
  if (measuredButtons.length > 0 && Number.isFinite(rowWidth) && rowWidth > 0) {
    const first = measuredButtons[0];
    const top = Number.isFinite(first.offsetTop) ? first.offsetTop : 0;
    const minLeft = Math.min(...measuredButtons.map((btn) => btn.offsetLeft));
    const right = Math.max(NATIVE_LAYOUT_GAP_PX, rowWidth - minLeft + NATIVE_LAYOUT_GAP_PX);
    button.style.setProperty('--poexd-native-btn-size', `${first.offsetHeight}px`);
    button.style.setProperty('--poexd-native-btn-top', `${top}px`);
    button.style.setProperty('--poexd-board-shortcut-right', `${right}px`);
    return;
  }
  const fallbackRight =
    layoutButtons.length > 0
      ? NATIVE_LAYOUT_GAP_PX + layoutButtons.length * NATIVE_LAYOUT_PITCH_PX
      : NATIVE_LAYOUT_GAP_PX;
  button.style.setProperty('--poexd-board-shortcut-right', `${fallbackRight}px`);
}

export function findOfficialRow(id: string, doc: Document = document): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-id="${CSS.escape(id)}"]`);
}

/** 官方結果列上的通貨圖示與名稱；網址不是 PoE CDN 時不採用 */
export function readRowCurrency(row: Element): CurrencyDisplay | undefined {
  const raw = readOfficialRowCurrency(row);
  if (!raw?.icon || !isValidPoeCdnImageUrl(raw.icon)) return undefined;
  return { icon: raw.icon, ...(raw.name ? { name: raw.name.slice(0, 64) } : {}) };
}

export const isUsableButton = (button: HTMLElement | null | undefined): button is HTMLElement =>
  !!button && !button.hasAttribute('disabled') && !button.classList.contains('disabled');

export const findTravelButton = (row: Element | null): HTMLElement | null =>
  row?.querySelector<HTMLElement>('.direct-btn') ?? null;

/** 官方在連結過期時把按鈕標成 `expired disabled`（提示 "Item must be refreshed"） */
export const isExpiredButton = (button: HTMLElement | null): boolean =>
  !!button && button.classList.contains('expired');

export function findLoadMoreButton(doc: Document): HTMLElement | null {
  const button = doc.querySelector<HTMLElement>('.results .load-more-btn, .load-more-btn');
  if (!button || button.hasAttribute('disabled') || button.classList.contains('disabled')) {
    return null;
  }
  return button;
}

export class ResultBoardDom {
  private readonly highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private goneObserver: MutationObserver | undefined;
  private observedResultset: Element | null = null;
  private officialFilter: OfficialFilterSync | null = null;

  constructor(private readonly doc: Document) {}

  ensureStyle(): void {
    if (this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_CONTENT;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
  }

  /** 捲到官方結果列並短暫高亮；找不到時回傳 false */
  locate(id: string): boolean {
    const row = findOfficialRow(id, this.doc);
    if (!row) return false;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add(LOCATE_CLASS);
    clearTimeout(this.highlightTimers.get(id));
    this.highlightTimers.set(
      id,
      setTimeout(() => {
        row.classList.remove(LOCATE_CLASS);
        this.highlightTimers.delete(id);
      }, LOCATE_HIGHLIGHT_MS),
    );
    return true;
  }

  /** 讀取官方結果列上的顯示文字（含市集漢化後的品名、基底、詞綴與階級）供看板搜尋 */
  readEntrySearchLines(id: string): readonly string[] {
    const row = findOfficialRow(id, this.doc);
    if (!row) return [];
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const el of row.querySelectorAll(ENTRY_SEARCH_TEXT_SELECTOR)) {
      const text = el.textContent?.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      lines.push(text);
    }
    return lines;
  }

  /** 按下官方結果列上 PoeXD 的釘選按鈕；沒有按鈕時回傳 false */
  clickPin(id: string): boolean {
    const button = findOfficialRow(id, this.doc)?.querySelector<HTMLElement>('.poexd-pin-btn');
    if (!button) return false;
    button.click();
    return true;
  }

  /** 官方結果數列的捷徑按鈕；結果列重繪後重新放回去並避開官方 layout-btn */
  ensureShortcut(): void {
    const rowTotal = this.doc.querySelector('.row.row-total');
    if (!rowTotal) return;
    const existing = rowTotal.querySelector<HTMLButtonElement>(`.${SHORTCUT_CLASS}`);
    const label = t('resultBoard.shortcut');
    if (existing) {
      if (existing.textContent !== label) existing.textContent = label;
      syncShortcutLayout(existing, rowTotal);
      return;
    }
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = SHORTCUT_CLASS;
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      dispatchPoeEvent('poexd-open-result-board');
    });
    rowTotal.appendChild(button);
    syncShortcutLayout(button, rowTotal);
  }

  /** 同步暫時過濾左側官方結果列（純 CSS 隱藏未命中列＋頂部還原橫條） */
  syncOfficialFilter(
    filter: OfficialFilterSync | null,
    enabled: boolean,
    onSold: (id: string) => void,
  ): void {
    this.officialFilter = filter;
    if (!filter) {
      this.clearOfficialFilterDom();
      return;
    }
    this.ensureStyle();
    if (enabled) this.ensureGoneObserver(onSold);
    this.applyOfficialFilterDom(filter);
  }

  /** 只觀察 `.resultset` 的 `.row` 新增與 `class` 變更，同步官方「Item no longer available」(.gone) */
  ensureGoneObserver(onSold: (id: string) => void): void {
    const resultset = this.doc.querySelector('.resultset');
    if (!resultset) {
      this.disconnectGoneObserver();
      return;
    }
    if (resultset === this.observedResultset) return;
    this.disconnectGoneObserver();
    this.observedResultset = resultset;
    const Observer = this.doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (typeof Observer === 'function') {
      this.goneObserver = new Observer((mutations) =>
        this.handleResultsetMutations(mutations, onSold),
      );
      this.goneObserver.observe(resultset, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });
    }
    this.scanGoneRows(resultset, onSold);
  }

  disconnectGoneObserver(): void {
    this.goneObserver?.disconnect();
    this.goneObserver = undefined;
    this.observedResultset = null;
  }

  cleanup(): void {
    this.officialFilter = null;
    this.clearOfficialFilterDom();
    this.disconnectGoneObserver();
    this.highlightTimers.forEach((timer) => clearTimeout(timer));
    this.highlightTimers.clear();
    this.doc.querySelectorAll(`.${SHORTCUT_CLASS}`).forEach((element) => element.remove());
    this.doc.querySelectorAll(`.${LOCATE_CLASS}`).forEach((element) => {
      element.classList.remove(LOCATE_CLASS);
    });
    this.doc.getElementById(STYLE_ID)?.remove();
  }

  private applyOfficialFilterDom(filter: OfficialFilterSync): void {
    const resultset = this.doc.querySelector('.resultset');
    if (resultset) {
      for (const row of resultset.querySelectorAll('.row[data-id]')) {
        const id = row.getAttribute('data-id');
        row.classList.toggle(SYNC_HIDDEN_CLASS, !id || !filter.matchedIds.has(id));
      }
    }
    this.upsertSyncBanner(filter);
  }

  private upsertSyncBanner(filter: OfficialFilterSync): void {
    const resultset = this.doc.querySelector('.resultset');
    const rowTotal = this.doc.querySelector('.row.row-total');
    const anchor = rowTotal ?? resultset;
    if (!anchor?.parentNode) return;

    let banner = this.doc.querySelector<HTMLElement>(`.${SYNC_BANNER_CLASS}`);
    if (!banner) {
      banner = this.doc.createElement('div');
      banner.className = SYNC_BANNER_CLASS;
      banner.setAttribute('role', 'status');
      const label = this.doc.createElement('span');
      const resetBtn = this.doc.createElement('button');
      resetBtn.type = 'button';
      resetBtn.addEventListener('click', () => {
        this.officialFilter?.onReset();
      });
      banner.append(label, resetBtn);
      if (rowTotal) rowTotal.after(banner);
      else resultset?.before(banner);
    }

    const label = banner.querySelector('span');
    const resetBtn = banner.querySelector('button');
    if (label) {
      label.textContent = t('resultBoard.syncOfficial.banner', {
        matched: filter.matchedIds.size,
        total: filter.totalCount,
      });
    }
    if (resetBtn) {
      resetBtn.textContent = t('resultBoard.syncOfficial.showAll');
    }
  }

  private clearOfficialFilterDom(): void {
    this.doc.querySelectorAll(`.${SYNC_HIDDEN_CLASS}`).forEach((element) => {
      element.classList.remove(SYNC_HIDDEN_CLASS);
    });
    this.doc.querySelectorAll(`.${SYNC_BANNER_CLASS}`).forEach((element) => element.remove());
  }

  private handleResultsetMutations(
    mutations: readonly MutationRecord[],
    onSold: (id: string) => void,
  ): void {
    let addedRow = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target.nodeType === 1) {
          const el = target as Element;
          if (el.classList.contains('row') && el.classList.contains('gone')) {
            const id = el.getAttribute('data-id');
            if (id) onSold(id);
          }
        }
        continue;
      }
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          const el = node as Element;
          if (el.classList.contains('row')) addedRow = true;
          if (el.classList.contains('row') && el.classList.contains('gone')) {
            const id = el.getAttribute('data-id');
            if (id) onSold(id);
          } else {
            this.scanGoneRows(el, onSold);
          }
        }
      }
    }
    if (addedRow && this.officialFilter) {
      this.applyOfficialFilterDom(this.officialFilter);
    }
  }

  private scanGoneRows(root: Element, onSold: (id: string) => void): void {
    for (const row of root.querySelectorAll(GONE_ROW_SELECTOR)) {
      const id = row.getAttribute('data-id');
      if (id) onSold(id);
    }
  }
}
