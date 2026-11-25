import { parseCriteriaOverlayOps, type CriteriaOverlayOp } from './criteria-overlay';
import { dispatchPoeEvent, listenPoeEvent } from './event-contracts';

// -------------------------------------------------------------
// Cross-World RPC Public Types
// -------------------------------------------------------------

export type RpcDiagnostics = Record<string, string | number | boolean | null>;

export type RpcErrorCode =
  | 'TIMEOUT'
  | 'DISPOSED'
  | 'DISPATCH_FAILED'
  | 'INVALID_RESPONSE'
  | 'INVALID_REQUEST'
  | 'UNREGISTERED_METHOD';

export type RpcOutcome<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: RpcErrorCode | (string & {});
      error: string;
      diagnostics?: RpcDiagnostics;
    };

export type PageGuideDemoAction = 'show-filters' | 'add-stat-filter' | 'restore';

export interface LiveSearchEnsureContainerRequest {
  localId: string;
  league: string;
  realm: 'pc' | 'poe2';
  resetResults?: boolean;
}

export interface LiveSearchRenderResultRequest {
  localId: string;
  batchId: string;
  sourceSearchId: string;
  token: string;
  itemData: unknown;
  total: number;
  maxResults?: number;
}

export interface LiveSearchResetUnreadRequest {
  localId: string;
}

export interface LiveSearchSyncTotalRequest {
  localId: string;
  total: number;
}

export interface CriteriaOverlayReadResponse {
  snapshot: Record<string, unknown>;
  knownStatIds: string[] | null;
}

export interface CriteriaOverlayCommitRequest {
  ops: CriteriaOverlayOp[];
}

export interface CriteriaOverlaySyncResponse {
  url: string;
}

export interface PageGuideDemoRequest {
  action: PageGuideDemoAction;
}

export interface RpcMethodMap {
  'livesearch.ensure-container': {
    request: LiveSearchEnsureContainerRequest;
    response: { localId: string };
  };
  'livesearch.render-result': {
    request: LiveSearchRenderResultRequest;
    response: null;
  };
  'livesearch.reset-unread': {
    request: LiveSearchResetUnreadRequest;
    response: null;
  };
  'livesearch.sync-total': {
    request: LiveSearchSyncTotalRequest;
    response: null;
  };
  'criteria-overlay.read': {
    request: undefined;
    response: CriteriaOverlayReadResponse;
  };
  'criteria-overlay.commit': {
    request: CriteriaOverlayCommitRequest;
    response: null;
  };
  'criteria-overlay.sync': {
    request: undefined;
    response: CriteriaOverlaySyncResponse;
  };
  'page-guide.demo': {
    request: PageGuideDemoRequest;
    response: null;
  };
}

export type RpcMethod = keyof RpcMethodMap;

export interface RpcRequestOptions {
  timeoutMs?: number;
}

export interface CrossWorldRpcClientOptions {
  defaultTimeoutMs?: number;
}

export interface CrossWorldRpcClient {
  request<M extends RpcMethod>(
    method: M,
    payload: RpcMethodMap[M]['request'],
    options?: RpcRequestOptions,
  ): Promise<RpcOutcome<RpcMethodMap[M]['response']>>;
  dispose(): void;
}

const RPC_FAILURE_BRAND = Symbol('poexd-rpc-failure');

export interface RpcHandlerFailure {
  readonly [RPC_FAILURE_BRAND]?: true;
  readonly ok: false;
  readonly code: string;
  readonly error: string;
  readonly diagnostics?: RpcDiagnostics;
}

export type RpcHandlerReturn<M extends RpcMethod> =
  | RpcMethodMap[M]['response']
  | RpcHandlerFailure
  | Promise<RpcMethodMap[M]['response'] | RpcHandlerFailure>;

export type RpcMethodHandler<M extends RpcMethod> = (
  payload: RpcMethodMap[M]['request'],
) => RpcHandlerReturn<M>;

/** 建立結構化失敗回應，讓 Main World handler 回傳明確錯誤代碼與診斷資訊。 */
export function rpcFail(
  code: string,
  error: string,
  diagnostics?: RpcDiagnostics,
): RpcHandlerFailure {
  return {
    [RPC_FAILURE_BRAND]: true,
    ok: false,
    code,
    error,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

// -------------------------------------------------------------
// Zero-Dependency Pure-TS Boundary Validators (ADR-0014)
// -------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5000;
const PAGE_GUIDE_DEMO_ACTIONS: readonly PageGuideDemoAction[] = [
  'show-filters',
  'add-stat-filter',
  'restore',
];

type ValidationResult<T> = { ok: true; value: T } | { ok: false };

const VALID_NULL: ValidationResult<null> = { ok: true, value: null };
const VALID_UNDEFINED: ValidationResult<undefined> = { ok: true, value: undefined };
const INVALID: ValidationResult<never> = { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateVoidRequest(value: unknown): ValidationResult<undefined> {
  if (value === undefined || value === null) return VALID_UNDEFINED;
  if (isRecord(value) && Object.keys(value).length === 0) return VALID_UNDEFINED;
  return INVALID;
}

function validateNullResponse(value: unknown): ValidationResult<null> {
  return value === null || value === undefined ? VALID_NULL : INVALID;
}

function parseDiagnostics(value: unknown): RpcDiagnostics | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    ([, v]) =>
      v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
  );
  return Object.fromEntries(entries) as RpcDiagnostics;
}

interface MethodCodec<M extends RpcMethod> {
  validateRequest(raw: unknown): ValidationResult<RpcMethodMap[M]['request']>;
  validateResponse(raw: unknown): ValidationResult<RpcMethodMap[M]['response']>;
}

const RPC_METHOD_CODECS: { [M in RpcMethod]: MethodCodec<M> } = {
  'livesearch.ensure-container': {
    validateRequest(raw) {
      if (!isRecord(raw)) return INVALID;
      const localId = readTrimmedString(raw.localId);
      const league = readTrimmedString(raw.league);
      if (!localId || !league) return INVALID;
      if (raw.realm !== 'pc' && raw.realm !== 'poe2') return INVALID;
      if (raw.resetResults !== undefined && typeof raw.resetResults !== 'boolean') return INVALID;
      return {
        ok: true,
        value: {
          localId,
          league,
          realm: raw.realm,
          ...(raw.resetResults !== undefined ? { resetResults: raw.resetResults } : {}),
        },
      };
    },
    validateResponse(raw) {
      if (!isRecord(raw)) return INVALID;
      const localId = readTrimmedString(raw.localId);
      return localId ? { ok: true, value: { localId } } : INVALID;
    },
  },

  'livesearch.render-result': {
    validateRequest(raw) {
      if (!isRecord(raw)) return INVALID;
      const localId = readTrimmedString(raw.localId);
      const batchId = readTrimmedString(raw.batchId);
      const sourceSearchId = readTrimmedString(raw.sourceSearchId);
      const token = readTrimmedString(raw.token);
      if (
        !localId ||
        !batchId ||
        !sourceSearchId ||
        !token ||
        typeof raw.total !== 'number' ||
        !Number.isFinite(raw.total) ||
        raw.total < 0 ||
        raw.itemData === null ||
        raw.itemData === undefined
      ) {
        return INVALID;
      }
      if (
        raw.maxResults !== undefined &&
        (typeof raw.maxResults !== 'number' ||
          !Number.isInteger(raw.maxResults) ||
          raw.maxResults <= 0)
      ) {
        return INVALID;
      }
      return {
        ok: true,
        value: {
          localId,
          batchId,
          sourceSearchId,
          token,
          itemData: raw.itemData,
          total: raw.total,
          ...(raw.maxResults !== undefined ? { maxResults: raw.maxResults } : {}),
        },
      };
    },
    validateResponse: validateNullResponse,
  },

  'livesearch.reset-unread': {
    validateRequest(raw) {
      if (!isRecord(raw)) return INVALID;
      const localId = readTrimmedString(raw.localId);
      return localId ? { ok: true, value: { localId } } : INVALID;
    },
    validateResponse: validateNullResponse,
  },

  'livesearch.sync-total': {
    validateRequest(raw) {
      if (!isRecord(raw)) return INVALID;
      const localId = readTrimmedString(raw.localId);
      if (
        !localId ||
        typeof raw.total !== 'number' ||
        !Number.isInteger(raw.total) ||
        raw.total < 0
      ) {
        return INVALID;
      }
      return { ok: true, value: { localId, total: raw.total } };
    },
    validateResponse: validateNullResponse,
  },

  'criteria-overlay.read': {
    validateRequest: validateVoidRequest,
    validateResponse(raw) {
      if (!isRecord(raw) || !isRecord(raw.snapshot)) return INVALID;
      const { knownStatIds } = raw;
      const validKnown =
        knownStatIds === null ||
        (Array.isArray(knownStatIds) && knownStatIds.every((id) => typeof id === 'string'));
      if (!validKnown) return INVALID;
      return {
        ok: true,
        value: {
          snapshot: raw.snapshot,
          knownStatIds: knownStatIds as string[] | null,
        },
      };
    },
  },

  'criteria-overlay.commit': {
    validateRequest(raw) {
      if (!isRecord(raw)) return INVALID;
      const ops = parseCriteriaOverlayOps(raw.ops);
      return ops ? { ok: true, value: { ops } } : INVALID;
    },
    validateResponse: validateNullResponse,
  },

  'criteria-overlay.sync': {
    validateRequest: validateVoidRequest,
    validateResponse(raw) {
      if (!isRecord(raw) || typeof raw.url !== 'string' || raw.url.length === 0) return INVALID;
      return { ok: true, value: { url: raw.url } };
    },
  },

  'page-guide.demo': {
    validateRequest(raw) {
      if (!isRecord(raw)) return INVALID;
      if (!PAGE_GUIDE_DEMO_ACTIONS.includes(raw.action as PageGuideDemoAction)) return INVALID;
      return { ok: true, value: { action: raw.action as PageGuideDemoAction } };
    },
    validateResponse: validateNullResponse,
  },
};

function isKnownRpcMethod(method: string): method is RpcMethod {
  return Object.prototype.hasOwnProperty.call(RPC_METHOD_CODECS, method);
}

// -------------------------------------------------------------
// Wire Envelopes
// -------------------------------------------------------------

interface RpcRequestEnvelope {
  requestId: string;
  method: string;
  payload?: unknown;
}

type RpcResponseEnvelope =
  | { requestId: string; method: string; ok: true; data: unknown }
  | {
      requestId: string;
      method: string;
      ok: false;
      code: string;
      error: string;
      diagnostics?: RpcDiagnostics;
    };

function parseJsonRecord(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function createRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  );
}

// -------------------------------------------------------------
// Content World RPC Client
// -------------------------------------------------------------

interface PendingRpcRequest {
  method: RpcMethod;
  timer: ReturnType<typeof setTimeout>;
  settle: (outcome: RpcOutcome<any>) => void;
}

export function createCrossWorldRpcClient(
  clientOptions: CrossWorldRpcClientOptions = {},
): CrossWorldRpcClient {
  const defaultTimeoutMs = clientOptions.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, PendingRpcRequest>();
  let disposed = false;
  let stopListening: (() => void) | null = null;

  const ensureListener = () => {
    if (stopListening) return;
    stopListening = listenPoeEvent('poexd-rpc-response', (wireString) => {
      const record = parseJsonRecord(wireString);
      if (!record || typeof record.requestId !== 'string' || !record.requestId) return;
      const entry = pending.get(record.requestId);
      if (!entry) return;

      pending.delete(record.requestId);
      clearTimeout(entry.timer);

      if (record.method !== entry.method || typeof record.ok !== 'boolean') {
        entry.settle({
          ok: false,
          code: 'INVALID_RESPONSE',
          error: `Malformed RPC response envelope for '${entry.method}'`,
        });
        return;
      }

      if (record.ok) {
        const validated = RPC_METHOD_CODECS[entry.method].validateResponse(record.data);
        if (!validated.ok) {
          entry.settle({
            ok: false,
            code: 'INVALID_RESPONSE',
            error: `Invalid RPC response payload for '${entry.method}'`,
          });
          return;
        }
        entry.settle({ ok: true, data: validated.value });
        return;
      }

      if (
        typeof record.code !== 'string' ||
        record.code.length === 0 ||
        typeof record.error !== 'string'
      ) {
        entry.settle({
          ok: false,
          code: 'INVALID_RESPONSE',
          error: `Malformed RPC error envelope for '${entry.method}'`,
        });
        return;
      }

      const diagnostics = parseDiagnostics(record.diagnostics);
      entry.settle({
        ok: false,
        code: record.code,
        error: record.error,
        ...(diagnostics ? { diagnostics } : {}),
      });
    });
  };

  return {
    request<M extends RpcMethod>(
      method: M,
      payload: RpcMethodMap[M]['request'],
      options?: RpcRequestOptions,
    ): Promise<RpcOutcome<RpcMethodMap[M]['response']>> {
      if (disposed) {
        return Promise.resolve({
          ok: false,
          code: 'DISPOSED',
          error: 'Cross-world RPC client disposed',
        });
      }

      const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
      const requestId = createRequestId();
      const envelope: RpcRequestEnvelope = { requestId, method, payload };

      let wireString: string;
      try {
        wireString = JSON.stringify(envelope);
      } catch (err) {
        return Promise.resolve({
          ok: false,
          code: 'DISPATCH_FAILED',
          error: `Failed to serialize RPC request '${method}': ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      ensureListener();

      return new Promise<RpcOutcome<RpcMethodMap[M]['response']>>((resolve) => {
        const timer = setTimeout(() => {
          if (!pending.delete(requestId)) return;
          resolve({
            ok: false,
            code: 'TIMEOUT',
            error: `RPC '${method}' timed out after ${timeoutMs}ms (requestId: ${requestId})`,
          });
        }, timeoutMs);

        pending.set(requestId, {
          method,
          timer,
          settle: resolve,
        });

        try {
          dispatchPoeEvent('poexd-rpc-request', wireString);
        } catch (err) {
          if (pending.delete(requestId)) {
            clearTimeout(timer);
            resolve({
              ok: false,
              code: 'DISPATCH_FAILED',
              error: `Failed to dispatch RPC request '${method}': ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (stopListening) {
        stopListening();
        stopListening = null;
      }
      const inFlight = Array.from(pending.values());
      pending.clear();
      for (const entry of inFlight) {
        clearTimeout(entry.timer);
        entry.settle({
          ok: false,
          code: 'DISPOSED',
          error: 'Cross-world RPC client disposed',
        });
      }
    },
  };
}

/** 無狀態單次呼叫輔助函式，供不需要長生命週期管理的 Content World 呼叫端使用。 */
export async function requestMainWorld<M extends RpcMethod>(
  method: M,
  payload: RpcMethodMap[M]['request'],
  options?: RpcRequestOptions,
): Promise<RpcOutcome<RpcMethodMap[M]['response']>> {
  const client = createCrossWorldRpcClient();
  try {
    return await client.request(method, payload, options);
  } finally {
    client.dispose();
  }
}

// -------------------------------------------------------------
// Main World RPC Dispatcher (wired into MainWorldBridge)
// -------------------------------------------------------------

export interface MainWorldRpcTransport {
  dispatchEvent(type: 'poexd-rpc-response', payload: string): void;
  addListener(type: 'poexd-rpc-request', callback: (payload: string) => void): () => void;
}

export interface MainWorldRpcDispatcher {
  handle<M extends RpcMethod>(method: M, handler: RpcMethodHandler<M>): () => void;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function isRpcHandlerFailure(value: unknown): value is RpcHandlerFailure {
  if (!isRecord(value)) return false;
  if (RPC_FAILURE_BRAND in value) return true;
  return value.ok === false && typeof value.code === 'string' && typeof value.error === 'string';
}

export function createMainWorldRpcDispatcher(
  transport: MainWorldRpcTransport,
): MainWorldRpcDispatcher {
  const handlers = new Map<RpcMethod, RpcMethodHandler<any>>();

  const sendResponse = (envelope: RpcResponseEnvelope) => {
    try {
      transport.dispatchEvent('poexd-rpc-response', JSON.stringify(envelope));
    } catch (err) {
      transport.dispatchEvent(
        'poexd-rpc-response',
        JSON.stringify({
          requestId: envelope.requestId,
          method: envelope.method,
          ok: false,
          code: 'HANDLER_ERROR',
          error: `Failed to serialize RPC response: ${err instanceof Error ? err.message : String(err)}`,
        } satisfies RpcResponseEnvelope),
      );
    }
  };

  const replyResult = (requestId: string, method: RpcMethod, result: unknown) => {
    if (isRpcHandlerFailure(result)) {
      const diagnostics = parseDiagnostics(result.diagnostics);
      sendResponse({
        requestId,
        method,
        ok: false,
        code: result.code || 'HANDLER_ERROR',
        error: result.error,
        ...(diagnostics ? { diagnostics } : {}),
      });
      return;
    }
    sendResponse({
      requestId,
      method,
      ok: true,
      data: result === undefined ? null : result,
    });
  };

  const replyThrown = (requestId: string, method: RpcMethod, err: unknown) => {
    const message = err instanceof Error && err.message ? err.message : String(err);
    sendResponse({
      requestId,
      method,
      ok: false,
      code: 'HANDLER_ERROR',
      error: message,
    });
  };

  transport.addListener('poexd-rpc-request', (wireString) => {
    const record = parseJsonRecord(wireString);
    if (!record || typeof record.requestId !== 'string' || !record.requestId) {
      return;
    }
    const requestId = record.requestId;
    if (typeof record.method !== 'string' || !record.method) {
      sendResponse({
        requestId,
        method: '',
        ok: false,
        code: 'INVALID_REQUEST',
        error: 'Missing or invalid RPC method name',
      });
      return;
    }

    const method = record.method;
    if (!isKnownRpcMethod(method)) {
      sendResponse({
        requestId,
        method,
        ok: false,
        code: 'UNREGISTERED_METHOD',
        error: `Unknown RPC method: ${method}`,
      });
      return;
    }

    const handler = handlers.get(method);
    if (!handler) {
      sendResponse({
        requestId,
        method,
        ok: false,
        code: 'UNREGISTERED_METHOD',
        error: `No handler registered for RPC method: ${method}`,
      });
      return;
    }

    const validated = RPC_METHOD_CODECS[method].validateRequest(record.payload);
    if (!validated.ok) {
      sendResponse({
        requestId,
        method,
        ok: false,
        code: 'INVALID_REQUEST',
        error: `Invalid RPC request payload for '${method}'`,
      });
      return;
    }

    // 同步 handler 必須維持同一 call stack 執行與回覆（livesearch.render-result 契約）
    let rawResult: unknown;
    try {
      rawResult = handler(validated.value);
    } catch (err) {
      replyThrown(requestId, method, err);
      return;
    }

    if (isPromiseLike(rawResult)) {
      rawResult.then(
        (resolved) => replyResult(requestId, method, resolved),
        (err) => replyThrown(requestId, method, err),
      );
    } else {
      replyResult(requestId, method, rawResult);
    }
  });

  return {
    handle<M extends RpcMethod>(method: M, handler: RpcMethodHandler<M>) {
      handlers.set(method, handler);
      return () => {
        if (handlers.get(method) === handler) {
          handlers.delete(method);
        }
      };
    },
  };
}
