/**
 * 看板用的 Main World → Content World 事件內容（wire format 為 JSON 字串）。
 *
 * 都是頁面送來的不可信輸入：parse 時完整驗證，不符就丟棄。
 */

/** 官方 search 回應的摘要：結果 id 數（官方上限 100）與符合總數 */
export interface SearchResultSummary {
  searchId: string;
  total: number;
  resultCount: number;
  /** 官方回報的總數不精確（例如「10000+」） */
  inexact: boolean;
}

/** 官方 `/fetch` 回應不成功（例如 429 rate limit） */
export interface FetchFailure {
  url: string;
  status: number;
}

/** 官方「前往藏身處」（`POST /api/trade/whisper`）的回應；code 1 = 物品已不存在 */
export interface WhisperOutcome {
  status: number;
  code?: number;
  /** 官方回應 `success === true` 才代表實際觸發傳送（`false` 為有人搶先等尚未傳送） */
  success?: boolean;
}

const MAX_URL_LENGTH = 4096;
const MAX_SEARCH_ID_LENGTH = 2048;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isStatus = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1000;

function parseJsonRecord(detail: unknown): Record<string, unknown> | undefined {
  if (typeof detail !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(detail);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 從官方 search 回應（`{ id, result, total, inexact }`）擷取摘要 */
export function summarizeSearchResponse(data: unknown): SearchResultSummary | undefined {
  if (!isRecord(data)) return undefined;
  const { id, result, total } = data;
  if (typeof id !== 'string' || !id || id.length > MAX_SEARCH_ID_LENGTH) return undefined;
  if (!Array.isArray(result) || !isCount(total)) return undefined;
  return { searchId: id, total, resultCount: result.length, inexact: data.inexact === true };
}

export function serializeSearchResultSummary(summary: SearchResultSummary): string {
  return JSON.stringify(summary);
}

export function parseSearchResultSummary(detail: unknown): SearchResultSummary | undefined {
  const raw = parseJsonRecord(detail);
  if (!raw) return undefined;
  const { searchId, total, resultCount, inexact } = raw;
  if (typeof searchId !== 'string' || !searchId || searchId.length > MAX_SEARCH_ID_LENGTH) {
    return undefined;
  }
  if (!isCount(total) || !isCount(resultCount)) return undefined;
  return { searchId, total, resultCount, inexact: inexact === true };
}

export function serializeFetchFailure(failure: FetchFailure): string {
  return JSON.stringify(failure);
}

export function parseFetchFailure(detail: unknown): FetchFailure | undefined {
  const raw = parseJsonRecord(detail);
  if (!raw) return undefined;
  const { url, status } = raw;
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH || !isStatus(status)) {
    return undefined;
  }
  return { url, status };
}

export function serializeWhisperOutcome(outcome: WhisperOutcome): string {
  return JSON.stringify(outcome);
}

export function parseWhisperOutcome(detail: unknown): WhisperOutcome | undefined {
  const raw = parseJsonRecord(detail);
  if (!raw || !isStatus(raw.status)) return undefined;
  return {
    status: raw.status,
    ...(isStatus(raw.code) ? { code: raw.code } : {}),
    ...(typeof raw.success === 'boolean' ? { success: raw.success } : {}),
  };
}

/** 從官方 whisper 回應 body（`{ error: { code } }` 或 `{ success }`）取出錯誤代碼 */
export function readWhisperErrorCode(body: unknown): number | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  return isStatus(body.error.code) ? body.error.code : undefined;
}

/** 從官方 whisper 回應 body 取出 `success` 旗標 */
export function readWhisperSuccess(body: unknown): boolean | undefined {
  if (!isRecord(body)) return undefined;
  return typeof body.success === 'boolean' ? body.success : undefined;
}

/**
 * 官方 `/fetch/<id,id,...>` 要了卻沒回傳的結果 id（已下架時官方回 `null`）。
 * 網址或回應格式不明時回傳空陣列，寧可漏記也不誤記。
 */
export function readMissingFetchIds(url: string, data: unknown): string[] {
  let requested: string[];
  try {
    const path = new URL(url, 'https://www.pathofexile.com').pathname;
    const match = /\/fetch\/([^/]+)$/.exec(path);
    if (!match) return [];
    requested = decodeURIComponent(match[1]).split(',').filter(Boolean);
  } catch {
    return [];
  }
  if (!isRecord(data) || !Array.isArray(data.result)) return [];
  const present = new Set(
    data.result.flatMap((raw) => (isRecord(raw) && typeof raw.id === 'string' ? [raw.id] : [])),
  );
  return requested.filter((id) => !present.has(id));
}

/** 官方 `/fetch` 回應中帶有 `gone: true` 的已下架結果 id */
export function readGoneFetchIds(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.result)) return [];
  return data.result.flatMap((raw) =>
    isRecord(raw) && raw.gone === true && typeof raw.id === 'string' && raw.id ? [raw.id] : [],
  );
}
