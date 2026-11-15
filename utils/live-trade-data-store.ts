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

/**
 * 市集漢化啟用時的目標服官方資料（ADR-0012 的執行期更新快取，由 market-live-labels 同步進來）。
 * 形狀與頁面即時資料相同，`pageLocale` 在這裡是資料所屬的目標服語系（zh-TW / zh-CN）。
 * 市集漢化未啟用時一律是空的。
 */
const marketSnapshots = shallowRef<SnapshotsByVersion>({});

/** 傳入 null 清除（市集漢化停用、沒有快取或快取格式不符） */
export function setMarketLiveTradeData(
  version: PoeVersion,
  snapshot: LiveTradeDataSnapshot | null,
): void {
  const { [version]: _removed, ...rest } = marketSnapshots.value;
  marketSnapshots.value = snapshot ? { ...rest, [version]: Object.freeze({ ...snapshot }) } : rest;
}

const currentHostname = (): string =>
  typeof window !== 'undefined' && window.location ? window.location.hostname : '';

/**
 * 可用的即時資料（ADR-0014 的語系閘門）：只回傳語系等於顯示語系的資料，不混用語系。
 * - 一般情況：頁面自己載入的資料，顯示語系等於收到資料時的頁面語系才用。
 * - 國際服顯示中文：頁面資料是英文，且可能已被市集漢化改寫成中英並列，一律不用；
 *   改用市集漢化從目標服官方 API 更新的快取（只在市集漢化啟用時存在）。
 * 會讀取 reactive 狀態，在 computed / render 中呼叫時資料到達會重新計算。
 */
export function getUsableLiveTradeData(
  version: PoeVersion,
  displayLocale: SupportedLocale | string,
  hostname: string = currentHostname(),
): LiveTradeDataSnapshot | undefined {
  if (isMarketTranslationHost(hostname) && displayLocale !== 'en') {
    const market = marketSnapshots.value[version];
    return market && market.pageLocale === displayLocale ? market : undefined;
  }
  const snapshot = snapshots.value[version];
  if (!snapshot || snapshot.pageLocale !== displayLocale) return undefined;
  return snapshot;
}

/** 讀取者在 computed / render 中讀這個 ref，資料到達時會重新計算 */
export function getLiveTradeDataRef(): ShallowRef<SnapshotsByVersion> {
  return snapshots;
}

/** 測試用：清除所有即時資料 */
export function resetLiveTradeDataForTests(): void {
  snapshots.value = {};
  marketSnapshots.value = {};
}
