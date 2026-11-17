/**
 * 結果卡片的「複製 PoB 物品文字」按鈕。
 *
 * 物品資料來自攔截到的官方 fetch 回應（頁面送來的內容，視為不可信輸入，只取字串與數值組字）。
 * 頁面不是英文時才載入英文反查字典；字典載不到（該語系沒有資料）就不複製並告知原因。
 */
import { dispatchPoeEvent, parsePoeFetchResponse } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import {
  buildPobItemText,
  isPobExportableItem,
  type PobItemText,
  type PobTextLexicon,
} from '@/utils/pob-item-text';
import { loadPobTextLexicon } from '@/utils/pob-text-lexicon';
import type { PoeVersion } from '@/utils/trade-context';

import {
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  mountLeftAction,
  removeLeftActionsByClass,
} from './result-left-actions';
import { loadExtensionJson } from '@/utils/extension-json-cache';

const STYLE_ID = 'poexd-result-pob-copy-style';
const ITEM_ROW_SELECTOR = '.row[data-id], .row[id]';
/** 即時搜尋會不斷收到新物品，只保留最近的這麼多筆 */
const MAX_RETAINED_ITEMS = 500;

export const RESULT_POB_COPY_BUTTON_CLASS = 'poexd-pob-copy-btn';

export interface ResultPobCopyDeps {
  getPageLocale: () => string;
  loadLexicon: (version: PoeVersion, locale: string) => Promise<PobTextLexicon>;
  writeClipboard: (text: string) => Promise<void>;
  notify: (message: string, tone: 'success' | 'error') => void;
}

const defaultDeps: ResultPobCopyDeps = {
  getPageLocale: () => resolvePageLocale(),
  loadLexicon: (version, locale) => loadPobTextLexicon(loadExtensionJson, { version, locale }),
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  notify: (message, tone) => dispatchPoeEvent('poexd-toast', { message, tone }),
};

// 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）
const STYLE_CONTENT = `
  .${RESULT_POB_COPY_BUTTON_CLASS} {
    order: 1 !important;
    color: oklch(0.858 0.068 82.8) !important;
  }

  .${RESULT_POB_COPY_BUTTON_CLASS}:hover {
    border-color: oklch(0.58 0.08 82.8) !important;
  }
`;

const resolveRowId = (row: Element): string =>
  row.getAttribute('data-id') || row.getAttribute('id') || '';

function describeResult(result: PobItemText): string {
  const notes = [
    result.untranslatedLines > 0
      ? t('resultPobCopy.toast.noteUntranslated', { count: result.untranslatedLines })
      : '',
    result.baseTypeUncertain ? t('resultPobCopy.toast.noteBaseUncertain') : '',
  ].filter(Boolean);
  return [t('resultPobCopy.toast.copied'), ...notes].join(t('resultPobCopy.toast.noteSeparator'));
}

export class ResultPobCopy {
  private enabled = false;
  private items = new Map<string, unknown>();
  private lexicon?: { locale: string; promise: Promise<PobTextLexicon | undefined> };
  private readonly deps: ResultPobCopyDeps;

  constructor(
    private readonly version: PoeVersion,
    deps: Partial<ResultPobCopyDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  handleFetchResponse(detail: string): void {
    const data = parsePoeFetchResponse(detail)?.data;
    const results =
      data && typeof data === 'object' ? (data as { result?: unknown }).result : undefined;
    if (!Array.isArray(results)) return;

    for (const entry of results) {
      if (!entry || typeof entry !== 'object') continue;
      const { id, item } = entry as { id?: unknown; item?: unknown };
      if (typeof id !== 'string' || !isPobExportableItem(item)) continue;
      this.items.delete(id);
      this.items.set(id, item);
    }
    while (this.items.size > MAX_RETAINED_ITEMS) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }

    if (this.enabled && typeof document !== 'undefined') {
      const root = document.querySelector('.results');
      if (root) this.apply(root);
    }
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (typeof document === 'undefined') return;
    if (!enabled) {
      this.removeInjected();
      return;
    }
    const root = document.querySelector('.results');
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.enabled) return;
    const rows = Array.from(container.querySelectorAll(ITEM_ROW_SELECTOR));
    if (container.matches?.(ITEM_ROW_SELECTOR)) rows.unshift(container);

    let injected = false;
    for (const row of rows) {
      const id = resolveRowId(row);
      if (!id || !this.items.has(id)) continue;
      if (row.querySelector(`.${RESULT_POB_COPY_BUTTON_CLASS}`)) continue;
      mountLeftAction(row, this.createButton(id));
      injected = true;
    }
    if (injected) this.ensureStyle();
  }

  refreshLocale(): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll(`.${RESULT_POB_COPY_BUTTON_CLASS}`).forEach((button) => {
      button.textContent = t('resultPobCopy.button');
      button.setAttribute('title', t('resultPobCopy.title'));
    });
  }

  cleanup(): void {
    this.enabled = false;
    this.items.clear();
    this.lexicon = undefined;
    if (typeof document === 'undefined') return;
    this.removeInjected();
  }

  /** 把指定結果的 PoB 文字寫入剪貼簿並回報結果；按鈕點擊與測試共用 */
  async copy(resultId: string): Promise<void> {
    try {
      const item = this.items.get(resultId);
      if (!item) throw new Error(t('resultPobCopy.error.itemMissing'));

      const locale = this.deps.getPageLocale();
      const lexicon = locale === 'en' ? undefined : await this.getEnglishLexicon(locale);
      if (locale !== 'en' && !lexicon) {
        this.deps.notify(t('resultPobCopy.toast.unsupportedLocale'), 'error');
        return;
      }

      const result = buildPobItemText(item, { version: this.version, lexicon });
      if (!result) throw new Error(t('resultPobCopy.error.itemMissing'));
      await this.deps.writeClipboard(result.text);
      this.deps.notify(describeResult(result), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.notify(t('resultPobCopy.toast.failed', { message }), 'error');
    }
  }

  getItem(resultId: string): unknown {
    return this.items.get(resultId);
  }

  /** 頁面語系的英文反查字典（載入一次後快取）；該語系沒有資料時為 undefined */
  getEnglishLexicon(locale: string): Promise<PobTextLexicon | undefined> {
    if (this.lexicon?.locale === locale) return this.lexicon.promise;
    const promise = this.deps.loadLexicon(this.version, locale).catch((error: unknown) => {
      console.warn('[PoeXD] PoB 英文反查字典載入失敗:', error);
      return undefined;
    });
    this.lexicon = { locale, promise };
    return promise;
  }

  private createButton(resultId: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${RESULT_POB_COPY_BUTTON_CLASS}`;
    button.textContent = t('resultPobCopy.button');
    button.setAttribute('title', t('resultPobCopy.title'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.copy(resultId);
    });
    return button;
  }

  private ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_CONTENT;
    (document.head ?? document.documentElement).appendChild(style);
  }

  private removeInjected(): void {
    removeLeftActionsByClass(RESULT_POB_COPY_BUTTON_CLASS);
    document.getElementById(STYLE_ID)?.remove();
  }
}
