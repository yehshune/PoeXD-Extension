/**
 * Similar Item Search 的 Trade transport：從市集頁（content world）送出官方 `/search` 與 `/fetch`。
 *
 * - 只送往目前頁面的 origin，帶使用者自己的登入 cookie；不經 Background、不需要新的權限。
 * - search 與 fetch 各有一個限速閘門，依官方 `x-rate-limit-*` 標頭排隊；429 不重試，交給執行流程停下。
 * - 請求由 content world 發出，MAIN world 的網路攔截看不到，所以官方頁面與 Result Board
 *   不會把它們當成新的搜尋（ADR-0018 不變）；物品另外寫進 `TradeResultCache`，帶著這次的搜尋 id。
 */
import { tradeVersionProfiles, type PoeVersion } from '@/utils/trade-context';
import type {
  FetchedResult,
  SimilarSearchResponse,
  SimilarTradeTransport,
  TransportOutcome,
} from '@/utils/similar-item-search';
import {
  LiveSearchFetchRateGate,
  type ILiveSearchFetchRateGate,
  type LiveSearchFetchRateGateTimer,
} from './live-search-fetch-rate-gate';

const JSON_HEADERS = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } as const;
const MAX_ERROR_LENGTH = 200;
/** 官方一次 `/fetch` 最多 10 個 id */
const MAX_FETCH_IDS = 10;

export interface SimilarTransportOptions {
  origin: string;
  version: PoeVersion;
  league: string;
  fetchClient?: (url: string, init?: RequestInit) => Promise<Response>;
  timer?: Partial<LiveSearchFetchRateGateTimer>;
  searchGate?: ILiveSearchFetchRateGate;
  fetchGate?: ILiveSearchFetchRateGate;
}

export interface DisposableSimilarTransport extends SimilarTradeTransport {
  dispose(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function apiBase(origin: string, version: PoeVersion): string {
  return `${origin}/api/${tradeVersionProfiles[version].routeRoot}`;
}

export function buildSimilarSearchUrl(origin: string, version: PoeVersion, league: string): string {
  const segment = tradeVersionProfiles[version].searchVersionSegment;
  return `${apiBase(origin, version)}/search/${segment ? `${segment}/` : ''}${encodeURIComponent(league)}`;
}

export function buildSimilarFetchUrl(
  origin: string,
  version: PoeVersion,
  ids: readonly string[],
  searchId: string,
): string {
  const params = new URLSearchParams({ query: searchId });
  if (version === 'poe2') params.set('realm', 'poe2');
  return `${apiBase(origin, version)}/fetch/${ids.map(encodeURIComponent).join(',')}?${params}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function failureOf(response: Response, body: unknown): TransportOutcome<never> {
  const message =
    isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string'
      ? body.error.message.slice(0, MAX_ERROR_LENGTH)
      : undefined;
  return {
    ok: false,
    rateLimited: response.status === 429,
    status: response.status,
    error: message ? `HTTP ${response.status}: ${message}` : `HTTP ${response.status}`,
  };
}

const cancelled: TransportOutcome<never> = { ok: false, rateLimited: false, error: 'cancelled' };

function parseSearch(body: unknown): SimilarSearchResponse | undefined {
  if (!isRecord(body) || typeof body.id !== 'string' || !Array.isArray(body.result))
    return undefined;
  const result = body.result.filter((id): id is string => typeof id === 'string' && id.length > 0);
  const total =
    typeof body.total === 'number' && Number.isFinite(body.total) ? body.total : result.length;
  return { id: body.id, result, total, inexact: body.inexact === true };
}

function parseFetch(body: unknown): FetchedResult[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.result)) return undefined;
  return body.result.filter(
    (entry): entry is FetchedResult =>
      isRecord(entry) && typeof entry.id === 'string' && isRecord(entry.item),
  );
}

async function send<T>(
  gate: ILiveSearchFetchRateGate,
  url: string,
  init: RequestInit,
  parse: (body: unknown) => T | undefined,
  signal?: AbortSignal,
): Promise<TransportOutcome<T>> {
  try {
    const response = await gate.fetch(url, init, {
      maxRateLimitRetries: 0,
      shouldAbort: () => Boolean(signal?.aborted),
    });
    if (!response) return cancelled;
    const body = await readJson(response);
    if (!response.ok) return failureOf(response, body);
    const data = parse(body);
    return data
      ? { ok: true, data }
      : { ok: false, rateLimited: false, error: 'Unexpected response' };
  } catch (error) {
    return {
      ok: false,
      rateLimited: false,
      error: error instanceof Error ? error.message : 'Request failed',
    };
  }
}

export function createSimilarTradeTransport(
  options: SimilarTransportOptions,
): DisposableSimilarTransport {
  const gateOptions = {
    ...(options.fetchClient ? { fetchClient: options.fetchClient } : {}),
    ...(options.timer ? { timer: options.timer } : {}),
    maxRateLimitRetries: 0,
  };
  const searchGate = options.searchGate ?? new LiveSearchFetchRateGate(gateOptions);
  const fetchGate = options.fetchGate ?? new LiveSearchFetchRateGate(gateOptions);
  const searchUrl = buildSimilarSearchUrl(options.origin, options.version, options.league);
  return {
    search(body, signal) {
      return send(
        searchGate,
        searchUrl,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { ...JSON_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        parseSearch,
        signal,
      );
    },
    fetch(ids, searchId, signal) {
      const url = buildSimilarFetchUrl(
        options.origin,
        options.version,
        ids.slice(0, MAX_FETCH_IDS),
        searchId,
      );
      return send(
        fetchGate,
        url,
        { method: 'GET', credentials: 'same-origin', headers: JSON_HEADERS },
        parseFetch,
        signal,
      );
    },
    dispose() {
      if (!options.searchGate) searchGate.dispose();
      if (!options.fetchGate) fetchGate.dispose();
    },
  };
}
