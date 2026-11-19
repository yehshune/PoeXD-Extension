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
  /** 一行簡短說明 */
  descriptionKey: I18nKey;
  /** 點 ⓘ 展開的完整說明 */
  detailsKey: I18nKey;
  version?: PoeVersion;
}

export const SEARCH_TOGGLE_ROWS: readonly SettingsToggleRow[] = Object.freeze([
  {
    id: 'enable-search-tilde',
    key: 'enableSearchTilde',
    labelKey: 'settings.searchTilde.label',
    descriptionKey: 'settings.searchTilde.hint',
    detailsKey: 'settings.searchTilde.tooltip',
  },
  {
    id: 'enable-filter-tilde',
    key: 'enableFilterTilde',
    labelKey: 'settings.filterTilde.label',
    descriptionKey: 'settings.filterTilde.hint',
    detailsKey: 'settings.filterTilde.tooltip',
  },
  {
    id: 'enable-tier-helper',
    key: 'enableTierHelper',
    labelKey: 'settings.tierHelper.label',
    descriptionKey: 'popup.module.enableTierHelper.description',
    detailsKey: 'settings.tierHelper.tooltip',
  },
  {
    id: 'enable-affix-selector',
    key: 'enableAffixSelector',
    labelKey: 'settings.affixSelector.label',
    descriptionKey: 'popup.module.enableAffixSelector.description',
    detailsKey: 'settings.affixSelector.tooltip',
  },
]);

export const RESULT_TOGGLE_ROWS: readonly SettingsToggleRow[] = Object.freeze([
  {
    id: 'enable-price-comparison',
    key: 'enablePriceComparison',
    labelKey: 'settings.priceComparison.label',
    descriptionKey: 'popup.module.enablePriceComparison.description',
    detailsKey: 'settings.priceComparison.tooltip',
  },
  {
    id: 'enable-result-mod-highlight',
    key: 'enableResultModHighlight',
    labelKey: 'settings.resultModHighlight.label',
    descriptionKey: 'popup.module.enableResultModHighlight.description',
    detailsKey: 'settings.resultModHighlight.tooltip',
  },
  {
    id: 'enable-result-mod-quick-filter',
    key: 'enableResultModQuickFilter',
    labelKey: 'settings.resultModQuickFilter.label',
    descriptionKey: 'popup.module.enableResultModQuickFilter.description',
    detailsKey: 'settings.resultModQuickFilter.tooltip',
  },
  {
    id: 'enable-result-pob-copy',
    key: 'enableResultPobCopy',
    labelKey: 'settings.resultPobCopy.label',
    descriptionKey: 'popup.module.enableResultPobCopy.description',
    detailsKey: 'settings.resultPobCopy.tooltip',
  },
  {
    id: 'enable-result-external-links',
    key: 'enableResultExternalLinks',
    labelKey: 'settings.resultExternalLinks.label',
    descriptionKey: 'popup.module.enableResultExternalLinks.description',
    detailsKey: 'settings.resultExternalLinks.tooltip',
  },
  {
    id: 'enable-item-normalizer',
    key: 'enableItemNormalizer',
    labelKey: 'settings.itemNormalizer.label',
    descriptionKey: 'popup.module.enableItemNormalizer.description',
    detailsKey: 'settings.itemNormalizer.tooltip',
    version: 'poe2',
  },
]);

export function filterRowsForVersion(
  rows: readonly SettingsToggleRow[],
  version: PoeVersion,
): readonly SettingsToggleRow[] {
  return rows.filter((row) => !row.version || row.version === version);
}
