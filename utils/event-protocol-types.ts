import {
  parseLiveStatLabels,
  parseLiveTradeFilters,
  type LiveStatLabels,
  type LiveTradeFilters,
} from './live-trade-data';
import type {
  FetchFailure,
  SearchResultSummary,
  WhisperOutcome,
} from './result-board/board-events';

export type DialogButtonVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link';

export interface DialogButtonSpec {
  label: string;
  value: any;
  variant?: DialogButtonVariant;
}

export interface DialogEventDetail {
  type: 'confirm' | 'alert' | 'prompt' | 'custom';
  title: string;
  message: string;
  defaultValue?: string;
  buttons?: DialogButtonSpec[];
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: any) => void;
}

export interface PoeToastDetail {
  message: string;
  tone?: 'default' | 'success' | 'error';
  durationMs?: number;
}

export { type TierDropdownItemSpec } from './tier-slot-registry';

// -------------------------------------------------------------
// Cross-World Structured Domain Types (Payloads)
// -------------------------------------------------------------

export interface PoeFetchResponsePayload {
  url: string;
  data: unknown;
}

export type PoeSearchQueryObservedSource = 'current-query' | 'search-response';

export interface PoeSearchQueryObservedPayload {
  searchId?: string;
  queryJson: string;
  source?: PoeSearchQueryObservedSource;
}

export interface PoeMoveStatFilterPayload {
  fromGroup: number;
  fromFilter: number;
  toGroup: number;
  toFilter: number;
}

export interface PoeKnownStat {
  id: string;
  text: string;
  type: string;
}

export type PoeKnownStatsPayload = Record<string, PoeKnownStat>;

/**
 * 即時市集資料的 wire 內容（ADR-0014）：官方頁面 `static_.propertyFilters` 與 `static_.knownStats` 原樣送出，
 * 驗證與轉換在 isolated world 以 `parsePoeLiveTradeData` 進行。
 */
export interface PoeLiveTradeDataWire {
  propertyFilters: unknown;
  knownStats: unknown;
}

/** 解碼後的即時市集資料；任一部分驗證失敗為 null（呼叫端退回打包資料） */
export interface PoeLiveTradeDataPayload {
  filters: LiveTradeFilters | null;
  statLabels: LiveStatLabels | null;
  /**
   * 由同一份分組 knownStats 推導的 id → stat 對照（等同官方 `static_.knownStatsFlat`）。
   * 不另外序列化 knownStatsFlat：兩者內容相同，各約 2.5～3 MB，每次載入多序列化一份很貴。
   */
  knownStats: PoeKnownStatsPayload | null;
}

export interface PoeAddStatFilterPayload {
  statId: string | null;
  groupIndex: number;
  min?: string;
  max?: string;
  fallbackQuery?: string;
  category: string;
  modGroup?: string;
}

export interface PoeUpdateStatCategoryPayload {
  bindingId: string;
  category?: string;
  modGroup?: string | null;
  groupIndex?: number;
  filterIndex?: number;
}

export interface PoeLiveSearchConsoleGuardPayload {
  active: boolean;
}

// -------------------------------------------------------------
// Cross-World Event Maps (Boundary-separated in Type System)
// -------------------------------------------------------------

/**
 * Main World -> Content World (10 個事件)
 * 帶有 JSON 結構之事件在 CustomEvent 傳輸時採用 serialized JSON string 以維持 wire 相容。
 */
export interface PoeMainToContentEventMap {
  'poexd-history-changed': void;
  'poexd-fetch-response': string; // Wire format: serialized JSON of PoeFetchResponsePayload
  'poexd-search-query-observed': string; // Wire format: serialized JSON of PoeSearchQueryObservedPayload
  'poexd-search-triggered': void;
  'poexd-live-trade-data': string; // Wire format: serialized JSON of PoeLiveTradeDataWire
  'poexd-equipment-type-changed': { type: string | null };
  'poexd-search-result-summary': string; // Wire format: serialized JSON of SearchResultSummary
  'poexd-fetch-failed': string; // Wire format: serialized JSON of FetchFailure
  'poexd-whisper-outcome': string; // Wire format: serialized JSON of WhisperOutcome
  'poexd-rpc-response': string; // Wire format: serialized JSON of Cross-World RPC response envelope
}

/**
 * Content World -> Main World (9 個事件)
 */
export interface PoeContentToMainEventMap {
  'poexd-request-known-stats': void;
  'poexd-request-live-trade-data': void;
  'poexd-request-official-category': void;
  'poexd-set-official-category': { option: string };
  'poexd-add-stat-filter': PoeAddStatFilterPayload;
  'poexd-update-stat-category': PoeUpdateStatCategoryPayload;
  'poexd-move-stat-filter': string; // Wire format: serialized JSON of PoeMoveStatFilterPayload
  'poexd-livesearch-console-guard': PoeLiveSearchConsoleGuardPayload;
  'poexd-rpc-request': string; // Wire format: serialized JSON of Cross-World RPC request envelope
}

/**
 * 19 個跨世界通訊事件合約（Main World <-> Content World）
 */
export type PoeCrossWorldEventMap = PoeMainToContentEventMap & PoeContentToMainEventMap;

/**
 * 跨世界事件解碼後之結構化 Domain Payload 表（供型別引用與合約斷言）
 */
export interface PoeCrossWorldPayloadMap {
  'poexd-history-changed': void;
  'poexd-fetch-response': PoeFetchResponsePayload;
  'poexd-search-query-observed': PoeSearchQueryObservedPayload;
  'poexd-search-triggered': void;
  'poexd-live-trade-data': PoeLiveTradeDataPayload;
  'poexd-equipment-type-changed': { type: string | null };
  'poexd-request-known-stats': void;
  'poexd-request-live-trade-data': void;
  'poexd-request-official-category': void;
  'poexd-set-official-category': { option: string };
  'poexd-add-stat-filter': PoeAddStatFilterPayload;
  'poexd-update-stat-category': PoeUpdateStatCategoryPayload;
  'poexd-move-stat-filter': PoeMoveStatFilterPayload;
  'poexd-livesearch-console-guard': PoeLiveSearchConsoleGuardPayload;
  'poexd-search-result-summary': SearchResultSummary;
  'poexd-fetch-failed': FetchFailure;
  'poexd-whisper-outcome': WhisperOutcome;
  'poexd-rpc-request': string;
  'poexd-rpc-response': string;
}

// -------------------------------------------------------------
// Content World Internal Event Map (14 個事件)
// -------------------------------------------------------------

/**
 * 14 個 Content World 內部解耦事件（Content Script <-> Injected Controls / Vue）
 */
export interface PoeContentInternalEventMap {
  'poexd-close-affix-modal': void;
  'poexd-modal-active-changed': boolean;
  'poexd-open-affix-modal': { groupIndex: number };
  /** condition 為 true 時把傭兵技能加入一般條件群組（and / not / count / if），而非改寫傭兵技能群組。 */
  'poexd-open-mercenary-picker': { groupIndex: number; condition?: boolean };
  'poexd-request-result-images': void;
  'poexd-result-images': { url: string; images: string[] };
  'poexd-sidebar-collapsed-changed': boolean;
  /** 拖曳收合標籤時即時預覽的 top（px），放開後才寫入 collapsedTabTop 偏好 */
  'poexd-sidebar-collapsed-top-preview': number;
  'poexd-sidebar-resizing-changed': boolean;
  'poexd-sidebar-width-preview': number;
  'poexd-toast': PoeToastDetail;
  'poexd-trigger-dialog': DialogEventDetail;
  'poexd-trigger-select-type-modal': void;
  /** 官方結果數旁的捷徑按鈕：展開側邊欄並切到搜尋結果看板 */
  'poexd-open-result-board': void;
}

/**
 * Content World 內部事件名稱清單。
 * 這些事件只在擴充的隔離世界（Isolated World）內流動，走私有 EventTarget 而非 `window`，
 * 網頁腳本既看不到也無法偽造（例如假 toast、假對話框或注入書籤封面網址）。
 */
export const POE_CONTENT_INTERNAL_EVENT_TYPES = [
  'poexd-close-affix-modal',
  'poexd-modal-active-changed',
  'poexd-open-affix-modal',
  'poexd-open-mercenary-picker',
  'poexd-request-result-images',
  'poexd-result-images',
  'poexd-sidebar-collapsed-changed',
  'poexd-sidebar-collapsed-top-preview',
  'poexd-sidebar-resizing-changed',
  'poexd-sidebar-width-preview',
  'poexd-toast',
  'poexd-trigger-dialog',
  'poexd-trigger-select-type-modal',
  'poexd-open-result-board',
] as const satisfies readonly (keyof PoeContentInternalEventMap)[];

type MissingInternalEventType = Exclude<
  keyof PoeContentInternalEventMap,
  (typeof POE_CONTENT_INTERNAL_EVENT_TYPES)[number]
>;
// 編譯期保證清單涵蓋所有內部事件
const _internalEventTypesExhaustive: [MissingInternalEventType] extends [never] ? true : never =
  true;
void _internalEventTypesExhaustive;

export function isPoeContentInternalEventType(
  type: string,
): type is keyof PoeContentInternalEventMap {
  return (POE_CONTENT_INTERNAL_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * 聚合事件表（供唯一 CustomEvent 基礎設施 dispatchPoeEvent / listenPoeEvent 使用）
 */
export type PoeEventMap = PoeCrossWorldEventMap & PoeContentInternalEventMap;

// -------------------------------------------------------------
// Active Codecs for Cross-World JSON Boundaries
// -------------------------------------------------------------

export function serializePoeFetchResponse(payload: PoeFetchResponsePayload): string {
  return JSON.stringify(payload);
}

export function parsePoeFetchResponse(detail: unknown): PoeFetchResponsePayload | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.url !== 'string') {
      return undefined;
    }
    return {
      url: parsed.url,
      data: parsed.data,
    };
  } catch {
    return undefined;
  }
}

export function getFetchSearchId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const baseOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://www.pathofexile.com';
    return new URL(value, baseOrigin).searchParams.get('query') || undefined;
  } catch {
    return undefined;
  }
}

export function parsePoeFetchResultBatch(
  detail: unknown,
): { searchId?: string; results: unknown[] } | undefined {
  const payload = parsePoeFetchResponse(detail);
  if (!payload) return undefined;
  const rawResults = (payload.data as { result?: unknown } | undefined)?.result;
  if (!Array.isArray(rawResults)) return undefined;
  return {
    searchId: getFetchSearchId(payload.url),
    results: rawResults,
  };
}

export function serializePoeSearchQueryObserved(payload: PoeSearchQueryObservedPayload): string {
  return JSON.stringify(payload);
}

export function parsePoeSearchQueryObserved(
  detail: unknown,
): PoeSearchQueryObservedPayload | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.queryJson !== 'string') {
      return undefined;
    }
    const source: PoeSearchQueryObservedSource | undefined =
      parsed.source === 'current-query' || parsed.source === 'search-response'
        ? parsed.source
        : undefined;
    const searchId =
      typeof parsed.searchId === 'string' && parsed.searchId.trim()
        ? parsed.searchId.trim()
        : undefined;
    return {
      searchId,
      queryJson: parsed.queryJson,
      source,
    };
  } catch {
    return undefined;
  }
}

export function serializePoeMoveStatFilter(payload: PoeMoveStatFilterPayload): string {
  return JSON.stringify(payload);
}

export function parsePoeMoveStatFilter(detail: unknown): PoeMoveStatFilterPayload | null {
  if (typeof detail !== 'string') return null;
  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const { fromGroup, fromFilter, toGroup, toFilter } = parsed as Record<string, unknown>;
    const isValidIndex = (val: unknown): val is number =>
      typeof val === 'number' && Number.isInteger(val) && Number.isFinite(val) && val >= 0;

    if (
      !isValidIndex(fromGroup) ||
      !isValidIndex(fromFilter) ||
      !isValidIndex(toGroup) ||
      !isValidIndex(toFilter)
    ) {
      return null;
    }

    return {
      fromGroup,
      fromFilter,
      toGroup,
      toFilter,
    };
  } catch {
    return null;
  }
}

export function serializePoeLiveTradeData(payload: PoeLiveTradeDataWire): string {
  return JSON.stringify({
    propertyFilters: payload.propertyFilters,
    knownStats: payload.knownStats,
  });
}

/**
 * 解碼即時市集資料。資料來自 MAIN world、視為不可信：兩部分各自走 `live-trade-data` 的完整驗證，
 * 不符的部分為 null；不是 JSON 物件或兩部分都不可用時回傳 undefined。
 */
export function parsePoeLiveTradeData(detail: unknown): PoeLiveTradeDataPayload | undefined {
  if (typeof detail !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const wire = parsed as Partial<PoeLiveTradeDataWire>;
  const filters = parseLiveTradeFilters(wire.propertyFilters);
  const statLabels = parseLiveStatLabels(wire.knownStats);
  const knownStats = flattenKnownStats(wire.knownStats);
  return filters || statLabels || knownStats ? { filters, statLabels, knownStats } : undefined;
}

/**
 * 分組的 knownStats（`[{ id, entries: [{ id, text, type }] }]`）→ id → stat 對照。
 * 重複 id 以後出現的為準，與官方 `knownStatsFlat` 相同；任何條目形狀不符回傳 null。
 */
function flattenKnownStats(raw: unknown): PoeKnownStatsPayload | null {
  if (!Array.isArray(raw)) return null;
  const result: PoeKnownStatsPayload = {};
  for (const group of raw) {
    const entries = (group as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      const { id, text, type } = (entry ?? {}) as Record<string, unknown>;
      if (typeof id !== 'string' || typeof text !== 'string' || typeof type !== 'string') {
        return null;
      }
      result[id] = { id, text, type };
    }
  }
  return result;
}
