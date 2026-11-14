import { shallowRef, type ShallowRef } from 'vue';
import type { LiveStatLabels, LiveTradeFilters } from './live-trade-data';
import { isMarketTranslationHost } from './market-translation';
import type { SupportedLocale } from './preferences-contract';
import type { PoeVersion } from './trade-context';

/**
 * 即時市集資料（ADR-0014）的記憶體 store：官方頁面自己載入、經 isolated world 驗證過的
 * 篩選標籤與市集寫法。只存在這次 Search Observation Session，不寫 chrome.storage，
 * 也不轉成深層 reactive（stats 有上萬筆）。
 */
export interface LiveTradeDataSnapshot {
  /** 收到資料時頁面的語系（由 isolated world 自行判斷，不採用頁面送來的值） */
  readonly pageLocale: SupportedLocale;
  readonly filters: LiveTradeFilters | null;
  readonly statLabels: LiveStatLabels | null;
}

type SnapshotsByVersion = Readonly<Partial<Record<PoeVersion, LiveTradeDataSnapshot>>>;

const snapshots = shallowRef<SnapshotsByVersion>({});

export function setLiveTradeData(version: PoeVersion, snapshot: LiveTradeDataSnapshot): void {
  snapshots.value = { ...snapshots.value, [version]: Object.freeze({ ...snapshot }) };
}

export function getLiveTradeData(version: PoeVersion): LiveTradeDataSnapshot | undefined {
  return snapshots.value[version];
}

const currentHostname = (): string =>
  typeof window !== 'undefined' && window.location ? window.location.hostname : '';

/**
 * 可用的即時資料（ADR-0014 的語系閘門）：只有顯示語系等於收到資料時的頁面語系才回傳。
 * 國際服只有英文是原始資料；顯示中文時頁面資料可能已被市集漢化改寫成中英並列，一律不用。
 * 會讀取 reactive 狀態，在 computed / render 中呼叫時資料到達會重新計算。
 */
export function getUsableLiveTradeData(
  version: PoeVersion,
  displayLocale: SupportedLocale | string,
  hostname: string = currentHostname(),
): LiveTradeDataSnapshot | undefined {
  const snapshot = snapshots.value[version];
  if (!snapshot || snapshot.pageLocale !== displayLocale) return undefined;
  if (isMarketTranslationHost(hostname) && displayLocale !== 'en') return undefined;
  return snapshot;
}

/** 讀取者在 computed / render 中讀這個 ref，資料到達時會重新計算 */
export function getLiveTradeDataRef(): ShallowRef<SnapshotsByVersion> {
  return snapshots;
}

/** 測試用：清除所有即時資料 */
export function resetLiveTradeDataForTests(): void {
  snapshots.value = {};
}
