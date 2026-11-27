/**
 * 找相似（ADR-0020 Decision 6）跨 world RPC 合約：每一批結果都是官方 store 裡的一個合成 search。
 * 合成 search 的 localId 一律帶 `poexd_similar_` 前綴，Main World 只會建立、覆寫或移除這些 search。
 */

export const SIMILAR_SEARCH_LOCAL_ID_PREFIX = 'poexd_similar_';
/** 一批最多的物品數（一次放寬搜尋最多 100 個 id） */
export const SIMILAR_BATCH_MAX_ITEMS = 100;
const MAX_LOCAL_IDS = 20;
const MAX_ID_LENGTH = 200;
/** 官方 search id 可能是壓縮後的查詢字串（`H4sI…`），長度可達數千字 */
const MAX_SEARCH_ID_LENGTH = 8192;

export interface SimilarShowBatchRequest {
  localId: string;
  realm: 'pc' | 'poe2';
  league: string;
  /** 這一批來源搜尋的官方 search id（之後換新藏身處 token 用） */
  searchId: string;
  /** 依顯示順序排好的 `/fetch` 結果，每筆都有 `id` */
  items: Record<string, unknown>[];
  total: number;
  inexact?: boolean;
}

export interface SimilarShowBatchResponse {
  localId: string;
  /** 顯示這一批之前作用中的 search；第一批時就是使用者自己的搜尋 */
  previousLocalId: string | null;
}

export interface SimilarActivateRequest {
  localId: string;
}

export interface SimilarRestoreRequest {
  /** 要移除的合成 search；沒有前綴的會被略過 */
  localIds: string[];
  homeLocalId?: string;
}

export interface SimilarRestoreResponse {
  /** 使用者的搜尋是否已重新顯示 */
  restored: boolean;
}

export interface SimilarStateRequest {
  localIds: string[];
}

export interface SimilarStateResponse {
  activeLocalId: string | null;
  /** 已不在官方 store 裡的合成 search */
  missing: string[];
  /** 官方搜尋取代了顯示中的合成 search（有合成 search 消失，且顯示中的不是合成 search） */
  replaced: boolean;
}

export interface SimilarSearchRpcMethodMap {
  'similar.show-batch': { request: SimilarShowBatchRequest; response: SimilarShowBatchResponse };
  'similar.activate': { request: SimilarActivateRequest; response: null };
  'similar.restore': { request: SimilarRestoreRequest; response: SimilarRestoreResponse };
  'similar.state': { request: SimilarStateRequest; response: SimilarStateResponse };
}

type Validation<T> = { ok: true; value: T } | { ok: false };
const INVALID: Validation<never> = { ok: false };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readId(value: unknown, maxLength = MAX_ID_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

export const isSimilarLocalId = (value: unknown): value is string => {
  const id = readId(value);
  return id !== undefined && id.startsWith(SIMILAR_SEARCH_LOCAL_ID_PREFIX);
};

function readIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LOCAL_IDS) return undefined;
  const ids = value.map((id) => readId(id));
  return ids.every((id): id is string => id !== undefined) ? ids : undefined;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function readItems(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value) || value.length > SIMILAR_BATCH_MAX_ITEMS) return undefined;
  if (!value.every((entry) => isRecord(entry) && readId(entry.id) !== undefined)) return undefined;
  const ids = new Set(value.map((entry) => (entry as { id: string }).id.trim()));
  return ids.size === value.length ? (value as Record<string, unknown>[]) : undefined;
}

function validateShowBatch(raw: unknown): Validation<SimilarShowBatchRequest> {
  if (!isRecord(raw) || !isSimilarLocalId(raw.localId)) return INVALID;
  const league = readId(raw.league);
  const searchId = readId(raw.searchId, MAX_SEARCH_ID_LENGTH);
  const items = readItems(raw.items);
  if (!league || !searchId || !items || !isCount(raw.total)) return INVALID;
  if (raw.realm !== 'pc' && raw.realm !== 'poe2') return INVALID;
  if (raw.inexact !== undefined && typeof raw.inexact !== 'boolean') return INVALID;
  return {
    ok: true,
    value: {
      localId: raw.localId.trim(),
      realm: raw.realm,
      league,
      searchId,
      items,
      total: raw.total,
      ...(raw.inexact !== undefined ? { inexact: raw.inexact } : {}),
    },
  };
}

function validateRestore(raw: unknown): Validation<SimilarRestoreRequest> {
  if (!isRecord(raw)) return INVALID;
  const localIds = readIdList(raw.localIds);
  const homeLocalId = raw.homeLocalId === undefined ? undefined : readId(raw.homeLocalId);
  if (!localIds || (raw.homeLocalId !== undefined && !homeLocalId)) return INVALID;
  return { ok: true, value: { localIds, ...(homeLocalId ? { homeLocalId } : {}) } };
}

function validateStateResponse(raw: unknown): Validation<SimilarStateResponse> {
  if (!isRecord(raw) || typeof raw.replaced !== 'boolean') return INVALID;
  const missing = readIdList(raw.missing);
  const active = raw.activeLocalId === null ? null : readId(raw.activeLocalId);
  if (!missing || active === undefined) return INVALID;
  return { ok: true, value: { activeLocalId: active, missing, replaced: raw.replaced } };
}

const validateNull = (raw: unknown): Validation<null> =>
  raw === null || raw === undefined ? { ok: true, value: null } : INVALID;

export const SIMILAR_SEARCH_RPC_CODECS = {
  'similar.show-batch': {
    validateRequest: validateShowBatch,
    validateResponse(raw: unknown): Validation<SimilarShowBatchResponse> {
      if (!isRecord(raw) || !isSimilarLocalId(raw.localId)) return INVALID;
      const previous = raw.previousLocalId === null ? null : readId(raw.previousLocalId);
      if (previous === undefined) return INVALID;
      return { ok: true, value: { localId: raw.localId.trim(), previousLocalId: previous } };
    },
  },
  'similar.activate': {
    validateRequest(raw: unknown): Validation<SimilarActivateRequest> {
      const localId = isRecord(raw) ? readId(raw.localId) : undefined;
      return localId ? { ok: true, value: { localId } } : INVALID;
    },
    validateResponse: validateNull,
  },
  'similar.restore': {
    validateRequest: validateRestore,
    validateResponse(raw: unknown): Validation<SimilarRestoreResponse> {
      return isRecord(raw) && typeof raw.restored === 'boolean'
        ? { ok: true, value: { restored: raw.restored } }
        : INVALID;
    },
  },
  'similar.state': {
    validateRequest(raw: unknown): Validation<SimilarStateRequest> {
      const localIds = isRecord(raw) ? readIdList(raw.localIds) : undefined;
      return localIds ? { ok: true, value: { localIds } } : INVALID;
    },
    validateResponse: validateStateResponse,
  },
} as const;
