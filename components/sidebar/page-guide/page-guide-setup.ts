import type { I18nKey } from '@/utils/i18n';
import type { DisplayLocalePreference } from '@/utils/preferences-contract';
import type { PageGuideDemoFocus } from './page-guide-tour';

/** 結果列示意裡可以直接開關的功能（偏好設定 key） */
export type ResultFeatureKey =
  | 'sidebarModulePinnedItems'
  | 'enableResultPobCopy'
  | 'enableResultExternalLinks'
  | 'enableResultModHighlight'
  | 'enableResultModQuickFilter'
  | 'enablePriceComparison';

export type ResultFeatureFlags = Readonly<Record<ResultFeatureKey, boolean>>;

export const RESULT_FEATURE_KEYS: readonly ResultFeatureKey[] = Object.freeze([
  'sidebarModulePinnedItems',
  'enableResultPobCopy',
  'enableResultExternalLinks',
  'enableResultModHighlight',
  'enableResultModQuickFilter',
  'enablePriceComparison',
]);

/** 從偏好設定讀出結果列功能開關；只有明確關閉（false）才算關閉，與側欄模組的規則一致 */
export function readResultFeatures(
  preferences: Readonly<Partial<Record<ResultFeatureKey, unknown>>>,
): ResultFeatureFlags {
  return Object.freeze(
    Object.fromEntries(RESULT_FEATURE_KEYS.map((key) => [key, preferences[key] !== false])),
  ) as ResultFeatureFlags;
}

/** 收合／詞綴／階級示範中的模擬滑鼠游標（視窗座標） */
export interface PageGuideDemoCursor {
  readonly x: number;
  readonly y: number;
  readonly pressed: boolean;
}

/**
 * 導覽裡的語言選項：介面只有這幾種語言，其他詞綴語系到設定頁調整。
 * 語言名稱用各自的寫法，看不懂目前介面語言的人也認得出來。
 */
export const PAGE_GUIDE_LOCALE_CHOICES: readonly {
  value: DisplayLocalePreference;
  /** 不指定時用 i18n 的「自動」 */
  nativeLabel?: string;
}[] = Object.freeze([
  { value: 'auto' },
  { value: 'zh-TW', nativeLabel: '繁體中文' },
  { value: 'zh-CN', nativeLabel: '简体中文' },
  { value: 'en', nativeLabel: 'English' },
]);

/** 各結果步驟說明框裡的功能開關 */
export const RESULT_FEATURE_TOGGLES: Readonly<
  Record<PageGuideDemoFocus, readonly { key: ResultFeatureKey; labelKey: I18nKey }[]>
> = Object.freeze({
  actions: [
    { key: 'sidebarModulePinnedItems', labelKey: 'sidebar.nav.pinnedItems' },
    { key: 'enableResultPobCopy', labelKey: 'settings.resultPobCopy.label' },
    { key: 'enableResultExternalLinks', labelKey: 'settings.resultExternalLinks.label' },
  ],
  mods: [
    { key: 'enableResultModHighlight', labelKey: 'settings.resultModHighlight.label' },
    { key: 'enableResultModQuickFilter', labelKey: 'settings.resultModQuickFilter.label' },
  ],
  price: [{ key: 'enablePriceComparison', labelKey: 'settings.priceComparison.label' }],
});
