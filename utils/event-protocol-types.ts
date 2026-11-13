import { parseCriteriaOverlayOps, type CriteriaOverlayOp } from './criteria-overlay';

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

export interface PoeLiveSearchEnsureContainerPayload {
  requestId?: string;
  localId: string;
  league: string;
  realm: 'pc' | 'poe2';
  resetResults?: boolean;
}

export interface PoeLiveSearchRenderResultPayload {
  requestId?: string;
  localId: string;
  batchId: string;
  sourceSearchId: string;
  token: string;
  itemData: unknown;
  total: number;
  /** 結果展示區最多保留筆數；超過時由 Host Adapter 淘汰最舊的批次。省略表示不限制。 */
  maxResults?: number;
}

export interface PoeLiveSearchResetUnreadPayload {
  requestId?: string;
  localId: string;
}

/** 同步展示容器的結果總數（官方上方顯示的筆數），例如依連線篩選切換時。 */
export interface PoeLiveSearchSyncTotalPayload {
  requestId?: string;
  localId: string;
  total: number;
}

export interface PoeLiveSearchConsoleGuardPayload {
  active: boolean;
}

export interface PoeCriteriaOverlayReadPayload {
  requestId: string;
}

export interface PoeCriteriaOverlayReadResultPayload {
  requestId: string;
  /** 官方 `state.persistent` 中與條件相關欄位的 JSON 快照；讀取失敗時為 null。 */
  snapshot: Record<string, unknown> | null;
  /** 官方已知的 stat id；無法取得時為 null。 */
  knownStatIds: string[] | null;
  error?: string;
}

export interface PoeCriteriaOverlayCommitPayload {
  requestId: string;
  ops: CriteriaOverlayOp[];
}

export interface PoeCriteriaOverlayCommitResultPayload {
  requestId: string;
  success: boolean;
  error?: string;
}

export interface PoeLiveSearchCommandResultPayload {
  requestId?: string;
  command: 'ensure-container' | 'render-result' | 'reset-unread' | 'sync-total';
  success: boolean;
  error?: string;
}

// -------------------------------------------------------------
// Cross-World Event Maps (Boundary-separated in Type System)
// -------------------------------------------------------------

/**
 * Main World -> Content World (9 個事件)
 * 帶有 JSON 結構之事件在 CustomEvent 傳輸時採用 serialized JSON string 以維持 wire 相容。
 */
export interface PoeMainToContentEventMap {
  'poexd-history-changed': void;
  'poexd-fetch-response': string; // Wire format: serialized JSON of PoeFetchResponsePayload
  'poexd-search-query-observed': string; // Wire format: serialized JSON of PoeSearchQueryObservedPayload
  'poexd-search-triggered': void;
  'poexd-known-stats': string; // Wire format: serialized JSON of PoeKnownStatsPayload
  'poexd-equipment-type-changed': { type: string | null };
  'poexd-livesearch-command-result': string; // Wire format: serialized JSON of PoeLiveSearchCommandResultPayload
  'poexd-criteria-overlay-read-result': string; // Wire format: serialized JSON of PoeCriteriaOverlayReadResultPayload
  'poexd-criteria-overlay-commit-result': string; // Wire format: serialized JSON of PoeCriteriaOverlayCommitResultPayload
}

/**
 * Content World -> Main World (12 個事件)
 */
export interface PoeContentToMainEventMap {
  'poexd-request-known-stats': void;
  'poexd-request-official-category': void;
  'poexd-add-stat-filter': PoeAddStatFilterPayload;
  'poexd-update-stat-category': PoeUpdateStatCategoryPayload;
  'poexd-move-stat-filter': string; // Wire format: serialized JSON of PoeMoveStatFilterPayload
  'poexd-livesearch-ensure-container': PoeLiveSearchEnsureContainerPayload;
  'poexd-livesearch-render-result': string; // Wire format: serialized JSON of PoeLiveSearchRenderResultPayload
  'poexd-livesearch-reset-unread': PoeLiveSearchResetUnreadPayload;
  'poexd-livesearch-sync-total': PoeLiveSearchSyncTotalPayload;
  'poexd-livesearch-console-guard': PoeLiveSearchConsoleGuardPayload;
  'poexd-criteria-overlay-read': string; // Wire format: serialized JSON of PoeCriteriaOverlayReadPayload
  'poexd-criteria-overlay-commit': string; // Wire format: serialized JSON of PoeCriteriaOverlayCommitPayload
}

/**
 * 21 個跨世界通訊事件合約（Main World <-> Content World）
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
  'poexd-known-stats': PoeKnownStatsPayload;
  'poexd-equipment-type-changed': { type: string | null };
  'poexd-livesearch-command-result': PoeLiveSearchCommandResultPayload;
  'poexd-request-known-stats': void;
  'poexd-request-official-category': void;
  'poexd-add-stat-filter': PoeAddStatFilterPayload;
  'poexd-update-stat-category': PoeUpdateStatCategoryPayload;
  'poexd-move-stat-filter': PoeMoveStatFilterPayload;
  'poexd-livesearch-ensure-container': PoeLiveSearchEnsureContainerPayload;
  'poexd-livesearch-render-result': PoeLiveSearchRenderResultPayload;
  'poexd-livesearch-reset-unread': PoeLiveSearchResetUnreadPayload;
  'poexd-livesearch-sync-total': PoeLiveSearchSyncTotalPayload;
  'poexd-livesearch-console-guard': PoeLiveSearchConsoleGuardPayload;
  'poexd-criteria-overlay-read': PoeCriteriaOverlayReadPayload;
  'poexd-criteria-overlay-read-result': PoeCriteriaOverlayReadResultPayload;
  'poexd-criteria-overlay-commit': PoeCriteriaOverlayCommitPayload;
  'poexd-criteria-overlay-commit-result': PoeCriteriaOverlayCommitResultPayload;
}

// -------------------------------------------------------------
// Content World Internal Event Map (12 個事件)
// -------------------------------------------------------------

/**
 * 12 個 Content World 內部解耦事件（Content Script <-> Injected Controls / Vue）
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
  'poexd-sidebar-resizing-changed': boolean;
  'poexd-sidebar-width-preview': number;
  'poexd-toast': PoeToastDetail;
  'poexd-trigger-dialog': DialogEventDetail;
  'poexd-trigger-select-type-modal': void;
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
  'poexd-sidebar-resizing-changed',
  'poexd-sidebar-width-preview',
  'poexd-toast',
  'poexd-trigger-dialog',
  'poexd-trigger-select-type-modal',
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

export function serializePoeKnownStats(payload: PoeKnownStatsPayload): string {
  return JSON.stringify(payload);
}

export function parsePoeKnownStats(detail: unknown): PoeKnownStatsPayload | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const entries = Object.entries(parsed);
    const result: PoeKnownStatsPayload = {};
    for (const [key, val] of entries) {
      if (
        !val ||
        typeof val !== 'object' ||
        typeof (val as any).id !== 'string' ||
        typeof (val as any).text !== 'string' ||
        typeof (val as any).type !== 'string'
      ) {
        return undefined;
      }
      result[key] = {
        id: (val as any).id,
        text: (val as any).text,
        type: (val as any).type,
      };
    }
    return result;
  } catch {
    return undefined;
  }
}

export function serializePoeLiveSearchRenderResult(
  payload: PoeLiveSearchRenderResultPayload,
): string {
  return JSON.stringify(payload);
}

export function parsePoeLiveSearchRenderResult(
  detail: unknown,
): PoeLiveSearchRenderResultPayload | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const { requestId, localId, batchId, sourceSearchId, token, itemData, total, maxResults } =
      parsed as Record<string, unknown>;

    if (
      typeof localId !== 'string' ||
      !localId.trim() ||
      typeof batchId !== 'string' ||
      !batchId.trim() ||
      typeof sourceSearchId !== 'string' ||
      !sourceSearchId.trim() ||
      typeof token !== 'string' ||
      !token.trim() ||
      typeof total !== 'number' ||
      !Number.isFinite(total) ||
      total < 0 ||
      itemData === null ||
      itemData === undefined
    ) {
      return undefined;
    }

    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      localId: localId.trim(),
      batchId: batchId.trim(),
      sourceSearchId: sourceSearchId.trim(),
      token: token.trim(),
      itemData,
      total,
      ...(typeof maxResults === 'number' && Number.isInteger(maxResults) && maxResults > 0
        ? { maxResults }
        : {}),
    };
  } catch {
    return undefined;
  }
}

export function serializePoeLiveSearchCommandResult(
  payload: PoeLiveSearchCommandResultPayload,
): string {
  return JSON.stringify(payload);
}

export function parsePoeLiveSearchCommandResult(
  detail: unknown,
): PoeLiveSearchCommandResultPayload | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const { requestId, command, success, error } = parsed as Record<string, unknown>;
    const validCommands = ['ensure-container', 'render-result', 'reset-unread', 'sync-total'];
    if (
      typeof command !== 'string' ||
      !validCommands.includes(command) ||
      typeof success !== 'boolean'
    ) {
      return undefined;
    }
    return {
      requestId: typeof requestId === 'string' ? requestId : undefined,
      command: command as 'ensure-container' | 'render-result' | 'reset-unread' | 'sync-total',
      success,
      error: typeof error === 'string' ? error : undefined,
    };
  } catch {
    return undefined;
  }
}

// -------------------------------------------------------------
// Criteria Overlay codecs（見 ADR-0009、ADR-0010）
// -------------------------------------------------------------

function parseJsonRecord(detail: unknown): Record<string, unknown> | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed = JSON.parse(detail);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readRequestId(record: Record<string, unknown>): string | undefined {
  return typeof record.requestId === 'string' && record.requestId !== ''
    ? record.requestId
    : undefined;
}

export function serializePoeCriteriaOverlayRead(payload: PoeCriteriaOverlayReadPayload): string {
  return JSON.stringify(payload);
}

export function parsePoeCriteriaOverlayRead(
  detail: unknown,
): PoeCriteriaOverlayReadPayload | undefined {
  const record = parseJsonRecord(detail);
  const requestId = record && readRequestId(record);
  return requestId ? { requestId } : undefined;
}

export function serializePoeCriteriaOverlayReadResult(
  payload: PoeCriteriaOverlayReadResultPayload,
): string {
  return JSON.stringify(payload);
}

export function parsePoeCriteriaOverlayReadResult(
  detail: unknown,
): PoeCriteriaOverlayReadResultPayload | undefined {
  const record = parseJsonRecord(detail);
  const requestId = record && readRequestId(record);
  if (!record || !requestId) return undefined;
  const { snapshot, knownStatIds, error } = record;
  const validSnapshot =
    snapshot === null || (typeof snapshot === 'object' && !Array.isArray(snapshot));
  const validKnown =
    knownStatIds === null ||
    (Array.isArray(knownStatIds) && knownStatIds.every((id) => typeof id === 'string'));
  if (!validSnapshot || !validKnown) return undefined;
  return {
    requestId,
    snapshot: snapshot as Record<string, unknown> | null,
    knownStatIds: knownStatIds as string[] | null,
    ...(typeof error === 'string' ? { error } : {}),
  };
}

export function serializePoeCriteriaOverlayCommit(
  payload: PoeCriteriaOverlayCommitPayload,
): string {
  return JSON.stringify(payload);
}

export function parsePoeCriteriaOverlayCommit(
  detail: unknown,
): PoeCriteriaOverlayCommitPayload | undefined {
  const record = parseJsonRecord(detail);
  const requestId = record && readRequestId(record);
  const ops = record && parseCriteriaOverlayOps(record.ops);
  return requestId && ops ? { requestId, ops } : undefined;
}

export function serializePoeCriteriaOverlayCommitResult(
  payload: PoeCriteriaOverlayCommitResultPayload,
): string {
  return JSON.stringify(payload);
}

export function parsePoeCriteriaOverlayCommitResult(
  detail: unknown,
): PoeCriteriaOverlayCommitResultPayload | undefined {
  const record = parseJsonRecord(detail);
  const requestId = record && readRequestId(record);
  if (!record || !requestId || typeof record.success !== 'boolean') return undefined;
  return {
    requestId,
    success: record.success,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}
