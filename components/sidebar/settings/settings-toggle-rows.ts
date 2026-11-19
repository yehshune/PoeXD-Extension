import type { I18nKey } from '@/utils/i18n';
import type { Preferences } from '@/utils/preferences-contract';
import type { PoeVersion } from '@/utils/trade-context';

type BooleanPreferenceKey = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

export interface SettingsToggleRow {
  /** 控制項 id，沿用舊版 checkbox id 讓既有連結與測試仍可定位 */
  id: string;
  key: BooleanPreferenceKey;
  labelKey: I18nKey;
  /** 點 ⓘ 展開的完整說明 */
  detailsKey: I18nKey;
  /** 不顯示、只供搜尋比對的文字 */
  keywordsKey?: I18nKey;
  version?: PoeVersion;
}

export const SEARCH_TOGGLE_ROWS: readonly SettingsToggleRow[] = Object.freeze([
  {
    id: 'enable-search-tilde',
    key: 'enableSearchTilde',
    labelKey: 'settings.searchTilde.label',
    detailsKey: 'settings.searchTilde.tooltip',
  },
  {
    id: 'enable-filter-tilde',
    key: 'enableFilterTilde',
    labelKey: 'settings.filterTilde.label',
    detailsKey: 'settings.filterTilde.tooltip',
  },
  {
    id: 'enable-tier-helper',
    key: 'enableTierHelper',
    labelKey: 'settings.tierHelper.label',
    detailsKey: 'settings.tierHelper.tooltip',
    keywordsKey: 'popup.module.enableTierHelper.description',
  },
  {
    id: 'enable-affix-selector',
    key: 'enableAffixSelector',
    labelKey: 'settings.affixSelector.label',
    detailsKey: 'settings.affixSelector.tooltip',
    keywordsKey: 'popup.module.enableAffixSelector.description',
  },
]);

export const RESULT_TOGGLE_ROWS: readonly SettingsToggleRow[] = Object.freeze([
  {
    id: 'enable-price-comparison',
    key: 'enablePriceComparison',
    labelKey: 'settings.priceComparison.label',
    detailsKey: 'settings.priceComparison.tooltip',
    keywordsKey: 'popup.module.enablePriceComparison.description',
  },
  {
    id: 'enable-result-mod-highlight',
    key: 'enableResultModHighlight',
    labelKey: 'settings.resultModHighlight.label',
    detailsKey: 'settings.resultModHighlight.tooltip',
    keywordsKey: 'popup.module.enableResultModHighlight.description',
  },
  {
    id: 'enable-result-mod-quick-filter',
    key: 'enableResultModQuickFilter',
    labelKey: 'settings.resultModQuickFilter.label',
    detailsKey: 'settings.resultModQuickFilter.tooltip',
    keywordsKey: 'popup.module.enableResultModQuickFilter.description',
  },
  {
    id: 'enable-result-pob-copy',
    key: 'enableResultPobCopy',
    labelKey: 'settings.resultPobCopy.label',
    detailsKey: 'settings.resultPobCopy.tooltip',
    keywordsKey: 'popup.module.enableResultPobCopy.description',
  },
  {
    id: 'enable-result-external-links',
    key: 'enableResultExternalLinks',
    labelKey: 'settings.resultExternalLinks.label',
    detailsKey: 'settings.resultExternalLinks.tooltip',
    keywordsKey: 'popup.module.enableResultExternalLinks.description',
  },
  {
    id: 'enable-item-normalizer',
    key: 'enableItemNormalizer',
    labelKey: 'settings.itemNormalizer.label',
    detailsKey: 'settings.itemNormalizer.tooltip',
    keywordsKey: 'popup.module.enableItemNormalizer.description',
    version: 'poe2',
  },
]);

export function filterRowsForVersion(
  rows: readonly SettingsToggleRow[],
  version: PoeVersion,
): readonly SettingsToggleRow[] {
  return rows.filter((row) => !row.version || row.version === version);
}
