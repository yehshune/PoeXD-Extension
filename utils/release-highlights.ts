import type { I18nKey } from './i18n';
import type { SettingsSectionId } from './sidebar-modules';

/**
 * 改版提示上的新功能跳轉：點擊後切到系統設定分頁並捲到對應區塊高亮。
 * 每次發版依當版重點更新此清單；清空則改版提示只顯示版本號與改版資訊連結。
 */
export interface ReleaseHighlight {
  readonly id: string;
  readonly section: SettingsSectionId;
  readonly labelKey: I18nKey;
}

export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlight[] = Object.freeze([
  { id: 'theme', section: 'appearance', labelKey: 'onboarding.update.highlight.theme' },
  { id: 'modules', section: 'modules', labelKey: 'onboarding.update.highlight.modules' },
]);

/** Sidebar 傳給 SettingsPane 的跳轉請求；seq 讓重複點同一區塊也能再次觸發 */
export interface SettingsFocusRequest {
  readonly section: SettingsSectionId;
  readonly seq: number;
}
