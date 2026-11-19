/**
 * 結果卡片的外部連結按鈕：PoEDB 物品頁。
 *
 * 物品資料與英文反查字典向 `ResultItemSource`（ResultPobCopy）取得，不另外保存一份。
 */
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { getActiveUiLocale, t } from '@/utils/i18n';
import { resolvePageLocale } from '@/utils/locale-resolution';
import { resolveEnglishItemName, type PobTextLexicon } from '@/utils/pob-item-text';
import { buildPoedbUrl } from '@/utils/result-external-links';
import type { PoeVersion } from '@/utils/trade-context';

import {
  RESULT_LEFT_ACTION_BUTTON_CLASS,
  mountLeftAction,
  removeLeftActionsByClass,
} from './result-left-actions';
import { TRADE_RESULTS_SELECTOR } from '@/utils/trade-results-root';

const STYLE_ID = 'poexd-result-external-links-style';
const RESULTS_SELECTOR = TRADE_RESULTS_SELECTOR;
const ITEM_ROW_SELECTOR = '.row[data-id], .row[id]';
const BUTTON_CLASS = 'poexd-result-link-btn';

export const RESULT_EXTERNAL_LINKS_CLASS = 'poexd-result-links';

export interface ResultItemSource {
  getItem(resultId: string): unknown;
  /** 頁面語系的英文反查字典；該語系沒有資料時為 undefined */
  getEnglishLexicon(locale: string): Promise<PobTextLexicon | undefined>;
}

export interface ResultExternalLinksDeps {
  getPageLocale: () => string;
  openUrl: (url: string) => void;
  notify: (message: string, tone: 'success' | 'error') => void;
}

const defaultDeps: ResultExternalLinksDeps = {
  getPageLocale: () => resolvePageLocale(),
  openUrl: (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  notify: (message, tone) => dispatchPoeEvent('poexd-toast', { message, tone }),
};

// 顏色一律用 oklch()（主題契約不允許原始 hex 色碼）
const STYLE_CONTENT = `
  .${RESULT_EXTERNAL_LINKS_CLASS} {
    order: 2 !important;
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
    margin: 0 !important;
  }

  .${BUTTON_CLASS} {
    color: oklch(0.82 0.03 240) !important;
  }

  .${BUTTON_CLASS}:hover {
    border-color: oklch(0.58 0.06 240) !important;
  }
`;

const resolveRowId = (row: Element): string =>
  row.getAttribute('data-id') || row.getAttribute('id') || '';

export class ResultExternalLinks {
  private enabled = false;
  private readonly deps: ResultExternalLinksDeps;

  constructor(
    private readonly version: PoeVersion,
    private readonly source: ResultItemSource,
    deps: Partial<ResultExternalLinksDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.refresh();
    else this.removeInjected();
  }

  /** 物品資料更新後重新套用到目前的結果列 */
  refresh(): void {
    if (!this.enabled || typeof document === 'undefined') return;
    const root = document.querySelector(RESULTS_SELECTOR);
    if (root) this.apply(root);
  }

  apply(container: Element): void {
    if (!this.enabled) return;
    const rows = Array.from(container.querySelectorAll(ITEM_ROW_SELECTOR));
    if (container.matches?.(ITEM_ROW_SELECTOR)) rows.unshift(container);

    let injected = false;
    for (const row of rows) {
      const id = resolveRowId(row);
      if (!id || !this.source.getItem(id)) continue;
      if (row.querySelector(`.${RESULT_EXTERNAL_LINKS_CLASS}`)) continue;
      mountLeftAction(row, this.createStrip(id));
      injected = true;
    }
    if (injected) this.ensureStyle();
  }

  refreshLocale(): void {
    if (typeof document === 'undefined') return;
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => {
      button.textContent = t('resultLinks.poedb.button');
      button.setAttribute('title', t('resultLinks.poedb.title'));
    });
  }

  cleanup(): void {
    this.enabled = false;
    this.removeInjected();
  }

  async openPoedb(resultId: string): Promise<void> {
    const locale = this.deps.getPageLocale();
    const lexicon =
      locale === 'en'
        ? undefined
        : await this.source.getEnglishLexicon(locale).catch(() => undefined);
    const englishName =
      locale !== 'en' && !lexicon
        ? null
        : resolveEnglishItemName(this.source.getItem(resultId), lexicon);
    if (!englishName) {
      this.deps.notify(t('resultLinks.toast.poedbNameMissing'), 'error');
      return;
    }
    this.deps.openUrl(
      buildPoedbUrl(englishName, { version: this.version, uiLocale: getActiveUiLocale() }),
    );
  }

  private createStrip(resultId: string): HTMLElement {
    const strip = document.createElement('div');
    strip.className = RESULT_EXTERNAL_LINKS_CLASS;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${RESULT_LEFT_ACTION_BUTTON_CLASS} ${BUTTON_CLASS}`;
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

  private ensureStyle(): void {
    ensureResultExternalLinksStyle();
  }

  private removeInjected(): void {
    removeLeftActionsByClass(RESULT_EXTERNAL_LINKS_CLASS);
    document.getElementById(STYLE_ID)?.remove();
  }
}

/** 注入按鈕樣式；導覽的示意結果列也會呼叫，確保頁面還沒有結果時樣式已存在 */
export function ensureResultExternalLinksStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_CONTENT;
  (document.head ?? document.documentElement).appendChild(style);
}
