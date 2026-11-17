import type { Preferences } from './preferences-contract';

/**
 * 本頁載入時的偏好快照。有些設定（例如市集漢化）只在開頁時套用，改了要重新整理；
 * 延後掛載的設定分頁要拿它當比較基準，而不是自己掛載當下的偏好。
 */
let pageLoadPreferences: Readonly<Preferences> | null = null;

/** 只記第一次（content script 啟動時讀到的偏好） */
export function rememberPageLoadPreferences(snapshot: Readonly<Preferences>): void {
  if (pageLoadPreferences === null) pageLoadPreferences = snapshot;
}

export function getPageLoadPreferences(): Readonly<Preferences> | null {
  return pageLoadPreferences;
}

export function resetPageLoadPreferencesForTests(): void {
  pageLoadPreferences = null;
}
