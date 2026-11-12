import { shallowRef, type ShallowRef } from 'vue';

export type KnownStats = Record<string, { id: string; text: string; type: string }>;

/**
 * 官網 known stats（數千筆）的記憶體 store。側欄與內容腳本在同一個 isolated world，
 * 直接共用這份參考；不寫進 chrome.storage（每次寫入都要序列化數 MB 並廣播給所有擴充頁面），
 * 也不轉成深層 reactive。
 */
const knownStats = shallowRef<KnownStats>({});

export function setKnownStats(stats: KnownStats): void {
  knownStats.value = stats;
}

export function getKnownStatsRef(): ShallowRef<KnownStats> {
  return knownStats;
}
