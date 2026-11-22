import type { I18nKey } from './i18n';
import type { SettingsSectionId } from './sidebar-modules';

/**
 * 改版提示上的新功能跳轉：點擊後切到系統設定分頁並捲到對應區塊高亮。
 * 每個項目只在 `release`（major.minor）系列顯示，例如 '1.12' 只出現在 1.12.x；
 * 進到下一個 minor 版後自動不再顯示，發版時只需新增該版的項目。
 */
export interface ReleaseHighlight {
  readonly id: string;
  /** 顯示此項目的版本系列，格式為 `major.minor` */
  readonly release: string;
  readonly section: SettingsSectionId;
  readonly labelKey: I18nKey;
}

export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlight[] = Object.freeze([
  {
    id: 'theme',
    release: '1.12',
    section: 'appearance',
    labelKey: 'onboarding.update.highlight.theme',
  },
  {
    id: 'modules',
    release: '1.12',
    section: 'modules',
    labelKey: 'onboarding.update.highlight.modules',
  },
]);

/** 取出 `major.minor`；接受 `1.12.0`、`v1.12.3` 等格式，無法解析時回傳 null */
export function toReleaseSeries(version: string | undefined): string | null {
  const match = /^v?(\d+)\.(\d+)(?:\.\d+)*$/.exec(version?.trim() ?? '');
  return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

/** 回傳指定版本所屬系列的新功能項目；版本無法解析時不顯示任何項目 */
export function getReleaseHighlights(
  version: string | undefined,
  highlights: readonly ReleaseHighlight[] = RELEASE_HIGHLIGHTS,
): readonly ReleaseHighlight[] {
  const series = toReleaseSeries(version);
  if (!series) return [];
  return highlights.filter((highlight) => highlight.release === series);
}

/** Sidebar 傳給 SettingsPane 的跳轉請求；seq 讓重複點同一區塊也能再次觸發 */
export interface SettingsFocusRequest {
  readonly section: SettingsSectionId;
  readonly seq: number;
}
