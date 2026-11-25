/**
 * 無 DOM 的 PoB 物品文字匯出與英文反查字典快取。
 *
 * 供搜尋結果列的 PoB 複製、PoEDB 外部連結與側邊欄釘選物品共用，
 * 避免非 DOM 模組（例如釘選清單）具現化 DOM 結果增強類別。
 */
import { dispatchPoeEvent } from './event-contracts';
import { loadExtensionJson } from './extension-json-cache';
import { t } from './i18n';
import { resolvePageLocale } from './locale-resolution';
import {
  buildPobItemText,
  isPobExportableItem,
  resolveEnglishItemName,
  type PobItemText,
  type PobTextLexicon,
} from './pob-item-text';
import { loadPobTextLexicon } from './pob-text-lexicon';
import type { PoeVersion } from './trade-context';

export interface PobItemExporterDeps {
  getPageLocale: () => string;
  loadLexicon: (version: PoeVersion, locale: string) => Promise<PobTextLexicon>;
  writeClipboard: (text: string) => Promise<void>;
  notify: (message: string, tone: 'success' | 'error') => void;
}

export interface PobItemExporter {
  /** 頁面語系的英文反查字典（依語系載入一次後快取）；該語系沒有資料時為 undefined */
  getEnglishLexicon(locale: string): Promise<PobTextLexicon | undefined>;
  /** 取得物品的英文名稱（傳奇用名稱，其餘用基底）；查不到或缺少字典時為 null */
  resolveEnglishName(item: unknown, locale?: string): Promise<string | null>;
  /** 把指定物品 JSON 的 PoB 文字寫入剪貼簿並發送通知 */
  copyItem(item: unknown, locale?: string): Promise<void>;
  /** 清除已快取的字典 Promise */
  clearCache(): void;
}

const defaultDeps: PobItemExporterDeps = {
  getPageLocale: () => resolvePageLocale(),
  loadLexicon: (version, locale) => loadPobTextLexicon(loadExtensionJson, { version, locale }),
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  notify: (message, tone) => dispatchPoeEvent('poexd-toast', { message, tone }),
};

function describeResult(result: PobItemText): string {
  const notes = [
    result.untranslatedLines > 0
      ? t('resultPobCopy.toast.noteUntranslated', { count: result.untranslatedLines })
      : '',
    result.baseTypeUncertain ? t('resultPobCopy.toast.noteBaseUncertain') : '',
  ].filter(Boolean);
  return [t('resultPobCopy.toast.copied'), ...notes].join(t('resultPobCopy.toast.noteSeparator'));
}

export function createPobItemExporter(
  version: PoeVersion,
  deps: Partial<PobItemExporterDeps> = {},
): PobItemExporter {
  const resolvedDeps: PobItemExporterDeps = { ...defaultDeps, ...deps };
  let cachedLexicon: { locale: string; promise: Promise<PobTextLexicon | undefined> } | undefined;

  const getEnglishLexicon = (locale: string): Promise<PobTextLexicon | undefined> => {
    if (cachedLexicon?.locale === locale) return cachedLexicon.promise;
    const promise = resolvedDeps.loadLexicon(version, locale).catch((error: unknown) => {
      console.warn('[PoeXD] PoB 英文反查字典載入失敗:', error);
      return undefined;
    });
    cachedLexicon = { locale, promise };
    return promise;
  };

  const resolveEnglishName = async (
    item: unknown,
    locale = resolvedDeps.getPageLocale(),
  ): Promise<string | null> => {
    const lexicon =
      locale === 'en' ? undefined : await getEnglishLexicon(locale).catch(() => undefined);
    if (locale !== 'en' && !lexicon) return null;
    return resolveEnglishItemName(item, lexicon);
  };

  const copyItem = async (item: unknown, locale = resolvedDeps.getPageLocale()): Promise<void> => {
    try {
      if (!isPobExportableItem(item)) throw new Error(t('resultPobCopy.error.itemMissing'));

      const lexicon = locale === 'en' ? undefined : await getEnglishLexicon(locale);
      if (locale !== 'en' && !lexicon) {
        resolvedDeps.notify(t('resultPobCopy.toast.unsupportedLocale'), 'error');
        return;
      }

      const result = buildPobItemText(item, { version, lexicon });
      if (!result) throw new Error(t('resultPobCopy.error.itemMissing'));
      await resolvedDeps.writeClipboard(result.text);
      resolvedDeps.notify(describeResult(result), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolvedDeps.notify(t('resultPobCopy.toast.failed', { message }), 'error');
    }
  };

  const clearCache = (): void => {
    cachedLexicon = undefined;
  };

  return {
    getEnglishLexicon,
    resolveEnglishName,
    copyItem,
    clearCache,
  };
}
