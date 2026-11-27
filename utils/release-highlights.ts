import type { I18nKey } from './i18n';
import type { SettingsSectionId } from './sidebar-modules';

/**
 * 改版提示上的新功能跳轉：點擊後切到系統設定分頁並捲到對應區塊高亮。
 * 每個項目標記它所屬的 `release`（major.minor）系列；改版提示會列出
 * 「升級前版本之後、到目前版本為止」的所有系列，跳過中間版本的使用者也看得到。
 * 發版時只需新增該版的項目。
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
  {
    id: 'two-column-layout',
    release: '1.15',
    section: 'pageLayout',
    labelKey: 'onboarding.update.highlight.twoColumnLayout',
  },
  {
    id: 'highlight-style',
    release: '1.15',
    section: 'resultDisplay',
    labelKey: 'onboarding.update.highlight.highlightStyle',
  },
]);

/** 取出 `major.minor`；接受 `1.12.0`、`v1.12.3` 等格式，無法解析時回傳 null */
export function toReleaseSeries(version: string | undefined): string | null {
  const match = /^v?(\d+)\.(\d+)(?:\.\d+)*$/.exec(version?.trim() ?? '');
  return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

function parseSeries(series: string): readonly [number, number] {
  const [major, minor] = series.split('.').map(Number);
  return [major, minor];
}

/** 比較兩個 `major.minor` 系列；a 較舊時為負數 */
function compareSeries(a: string, b: string): number {
  const [aMajor, aMinor] = parseSeries(a);
  const [bMajor, bMinor] = parseSeries(b);
  return aMajor !== bMajor ? aMajor - bMajor : aMinor - bMinor;
}

/**
 * 回傳改版提示要顯示的新功能項目：系列晚於 `sinceVersion`（升級前的版本）且不晚於目前版本。
 * 目前版本的系列一律顯示（同系列的小版更新仍可看到）；`sinceVersion` 未知或無法解析時，
 * 列出目前版本以前的所有系列。目前版本無法解析時不顯示任何項目。
 */
export function getReleaseHighlights(
  version: string | undefined,
  highlights: readonly ReleaseHighlight[] = RELEASE_HIGHLIGHTS,
  sinceVersion?: string,
): readonly ReleaseHighlight[] {
  const series = toReleaseSeries(version);
  if (!series) return [];
  const since = toReleaseSeries(sinceVersion);
  return highlights.filter((highlight) => {
    if (compareSeries(highlight.release, series) > 0) return false;
    if (highlight.release === series) return true;
    return since === null || compareSeries(highlight.release, since) > 0;
  });
}

/** Sidebar 傳給 SettingsPane 的跳轉請求；seq 讓重複點同一區塊也能再次觸發 */
export interface SettingsFocusRequest {
  readonly section: SettingsSectionId;
  readonly seq: number;
}
