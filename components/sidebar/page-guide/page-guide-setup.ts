import type { I18nKey } from '@/utils/i18n';
import type { DisplayLocalePreference, SidebarPosition } from '@/utils/preferences-contract';
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

/** 收合示範中的模擬滑鼠游標（視窗座標） */
export interface PageGuideDemoCursor {
  x: number;
  y: number;
  pressed: boolean;
}

/** 側欄提供給導覽設定步驟的目前值與修改方式 */
export interface PageGuideSetupBindings {
  displayLocale: DisplayLocalePreference;
  marketTranslation: boolean;
  marketTranslationBilingual: boolean;
  marketTranslationResultBilingual: boolean;
  /** 本頁開啟後漢化設定有變動，需重新整理才生效 */
  reloadRequired: boolean;
  sidebarPosition: SidebarPosition;
  fontSizeScale: number;
  compactDensity?: boolean;
  enablePureBackground?: boolean;
  resultFeatures: ResultFeatureFlags;
  /** 步驟示範播放中（供「再看一次示範」禁用與游標顯示） */
  demoPlaying?: boolean;
  /** 收合／詞綴／階級示範播放中的游標；沒有播放時為 null */
  demoCursor: PageGuideDemoCursor | null;
  setDisplayLocale: (value: DisplayLocalePreference) => void;
  setMarketTranslation: (value: boolean) => void;
  setMarketTranslationBilingual: (value: boolean) => void;
  setMarketTranslationResultBilingual: (value: boolean) => void;
  setSidebarPosition: (value: SidebarPosition) => void;
  /** 設定縮放比例（例如 1.05） */
  setFontSizeScale: (value: number) => void;
  setCompactDensity?: (value: boolean) => void;
  setEnablePureBackground?: (value: boolean) => void;
  setResultFeature: (key: ResultFeatureKey, value: boolean) => void;
  replayCollapseDemo: () => void;
  replayStepDemo?: (stepId: string) => void;
  reload: () => void;
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
