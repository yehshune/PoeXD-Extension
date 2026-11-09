import type {
  TradeRateLimitStateSnapshot,
  TradeRateLimitWindow,
} from '@/utils/live-search-contract';

export type { TradeRateLimitStateSnapshot, TradeRateLimitWindow };

export interface TradeRateLimitRuleSnapshot {
  rule: string;
  windows: TradeRateLimitWindow[];
}

export interface ParsedTradeRateLimitHeaders {
  policy: string | null;
  ruleNames: string[];
  rules: TradeRateLimitRuleSnapshot[];
  retryAfterMs: number | null;
}

export type HeaderSource =
  | Headers
  | { get(name: string): string | null | undefined }
  | Record<string, string | null | undefined>
  | null
  | undefined;

export interface LiveSearchFetchRateGateTimer {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  now: () => number;
}

export interface LiveSearchFetchRequestOptions {
  shouldAbort?: () => boolean;
  onRegisterCancel?: (cancelWait: () => void) => void;
}

export interface LiveSearchFetchRateGateOptions {
  fetchClient?: (url: string, init?: RequestInit) => Promise<Response>;
  timer?: Partial<LiveSearchFetchRateGateTimer>;
  maxRateLimitRetries?: number;
  fallback429CooldownMs?: number;
}

export interface ILiveSearchFetchRateGate {
  fetch(
    url: string,
    init?: RequestInit,
    options?: LiveSearchFetchRequestOptions,
  ): Promise<Response | null>;
  getStateSnapshot(): Readonly<TradeRateLimitStateSnapshot>;
  read?(): Readonly<TradeRateLimitStateSnapshot>;
  subscribe?(listener: (snapshot: Readonly<TradeRateLimitStateSnapshot>) => void): () => void;
  dispose(): void;
}

const STRICT_NON_NEGATIVE_NUMBER_RE = /^\d+(?:\.\d+)?$/;
const FALLBACK_RULE_CANDIDATES = ['account', 'ip', 'client'] as const;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 1;
const DEFAULT_FALLBACK_429_COOLDOWN_MS = 1000;

function parseStrictNonNegativeNumber(raw: string | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!STRICT_NON_NEGATIVE_NUMBER_RE.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function toTitleCaseHeader(name: string): string {
  return name
    .split('-')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join('-');
}

function createHeaderLookup(headers: HeaderSource): {
  get: (name: string) => string | null;
  keys: () => string[];
} {
  if (!headers || typeof headers !== 'object') {
    return {
      get: () => null,
      keys: () => [],
    };
  }

  const normalizedMap = new Map<string, string>();
  let hasEnumeratedEntries = false;

  if (typeof (headers as Headers).forEach === 'function') {
    try {
      (headers as Headers).forEach((value, key) => {
        if (typeof key === 'string' && typeof value === 'string') {
          normalizedMap.set(key.trim().toLowerCase(), value);
          hasEnumeratedEntries = true;
        }
      });
    } catch {
      // Fall back to .get()
    }
  } else if (typeof (headers as { get?: unknown }).get !== 'function') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        normalizedMap.set(key.trim().toLowerCase(), value);
        hasEnumeratedEntries = true;
      }
    }
  }

  const getter =
    typeof (headers as { get?: unknown }).get === 'function'
      ? (headers as { get(name: string): string | null | undefined }).get.bind(headers)
      : null;

  return {
    get: (name: string): string | null => {
      const lower = name.trim().toLowerCase();
      if (normalizedMap.has(lower)) {
        return normalizedMap.get(lower) ?? null;
      }
      if (!getter) return null;

      const direct = getter(lower) ?? getter(name) ?? getter(toTitleCaseHeader(lower));
      return typeof direct === 'string' ? direct : null;
    },
    keys: (): string[] => (hasEnumeratedEntries ? Array.from(normalizedMap.keys()) : []),
  };
}

/**
 * 解析單一 rule 的 limit 與 state 標頭配對。
 *
 * 沿用 PoeXD 既有的 GGG 標頭語意：
 * - x-rate-limit-{rule}: limit:window:cooldown[,limit:window:cooldown...]
 * - x-rate-limit-{rule}-state: used:windowLeft:cooldownLeft[,used:windowLeft:cooldownLeft...]
 *
 * 若缺少任一標頭、window 數量不一致或單一 window 數字格式損毀，安全忽略無效項目且絕不拋出例外。
 */
export function parseRateLimitWindowPair(
  limitStr: string | null | undefined,
  stateStr: string | null | undefined,
): TradeRateLimitWindow[] {
  if (typeof limitStr !== 'string' || typeof stateStr !== 'string') return [];
  const trimmedLimit = limitStr.trim();
  const trimmedState = stateStr.trim();
  if (!trimmedLimit || !trimmedState) return [];

  const limitEntries = trimmedLimit.split(',');
  const stateEntries = trimmedState.split(',');
  const pairCount = Math.min(limitEntries.length, stateEntries.length);
  const windows: TradeRateLimitWindow[] = [];

  for (let i = 0; i < pairCount; i++) {
    const limitParts = limitEntries[i]!.trim().split(':');
    const stateParts = stateEntries[i]!.trim().split(':');
    if (limitParts.length !== 3 || stateParts.length !== 3) {
      continue;
    }

    const limit = parseStrictNonNegativeNumber(limitParts[0]);
    const windowSec = parseStrictNonNegativeNumber(limitParts[1]);
    const cooldown = parseStrictNonNegativeNumber(limitParts[2]);
    const used = parseStrictNonNegativeNumber(stateParts[0]);
    const windowLeft = parseStrictNonNegativeNumber(stateParts[1]);
    const cooldownLeft = parseStrictNonNegativeNumber(stateParts[2]);

    if (
      limit === null ||
      windowSec === null ||
      cooldown === null ||
      used === null ||
      windowLeft === null ||
      cooldownLeft === null ||
      limit <= 0 ||
      windowSec <= 0
    ) {
      continue;
    }

    windows.push({
      limit,
      window: windowSec,
      cooldown,
      used,
      windowLeft,
      cooldownLeft,
    });
  }

  return windows;
}

/**
 * 解析 HTTP Retry-After 標頭（支援秒數或 HTTP-date），回傳需等待之毫秒數。
 */
export function parseRetryAfterMs(
  retryAfterHeader: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (typeof retryAfterHeader !== 'string') return null;
  const trimmed = retryAfterHeader.trim();
  if (!trimmed) return null;

  const seconds = parseStrictNonNegativeNumber(trimmed);
  if (seconds !== null) {
    return seconds > 0 ? Math.ceil(seconds * 1000) : null;
  }

  const parsedDateMs = Date.parse(trimmed);
  if (Number.isFinite(parsedDateMs)) {
    const deltaMs = parsedDateMs - nowMs;
    return deltaMs > 0 ? Math.ceil(deltaMs) : null;
  }

  return null;
}

/**
 * 純函式：解析 GGG Trade 回應之速率限制標頭。
 * 支援動態 X-Rate-Limit-Rules（如 Account, Ip, Client 或未知新 rule）、多區間與 Retry-After。
 */
export function parseTradeRateLimitHeaders(
  headers: HeaderSource,
  nowMs: number = Date.now(),
): ParsedTradeRateLimitHeaders {
  const lookup = createHeaderLookup(headers);
  const rawPolicy = lookup.get('x-rate-limit-policy')?.trim() || null;
  const rawRulesHeader = lookup.get('x-rate-limit-rules')?.trim() || '';
  const retryAfterMs = parseRetryAfterMs(lookup.get('retry-after'), nowMs);

  const ruleNames: string[] = [];
  const seenRules = new Set<string>();
  const addRuleName = (candidate: string) => {
    const normalized = candidate.trim().toLowerCase();
    if (!normalized || seenRules.has(normalized)) return;
    seenRules.add(normalized);
    ruleNames.push(normalized);
  };

  if (rawRulesHeader) {
    for (const token of rawRulesHeader.split(',')) {
      addRuleName(token);
    }
  } else {
    for (const key of lookup.keys()) {
      const match = /^x-rate-limit-([a-z0-9_-]+)-state$/i.exec(key);
      if (match && match[1]) {
        const candidate = match[1].toLowerCase();
        if (candidate !== 'policy' && candidate !== 'rules') {
          addRuleName(candidate);
        }
      }
    }
    for (const fallbackRule of FALLBACK_RULE_CANDIDATES) {
      if (
        lookup.get(`x-rate-limit-${fallbackRule}`) !== null ||
        lookup.get(`x-rate-limit-${fallbackRule}-state`) !== null
      ) {
        addRuleName(fallbackRule);
      }
    }
  }

  const rules: TradeRateLimitRuleSnapshot[] = [];
  for (const ruleName of ruleNames) {
    const limitStr = lookup.get(`x-rate-limit-${ruleName}`);
    const stateStr = lookup.get(`x-rate-limit-${ruleName}-state`);
    const windows = parseRateLimitWindowPair(limitStr, stateStr);
    if (windows.length > 0) {
      rules.push({
        rule: ruleName,
        windows,
      });
    }
  }

  return {
    policy: rawPolicy,
    ruleNames,
    rules,
    retryAfterMs,
  };
}

/**
 * 依據伺服器回傳之速率限制狀態與 Retry-After 推導下次請求前必須等待的毫秒數。
 *
 * 准入規則：
 * 1. Active restriction: 任一 window 之 cooldownLeft > 0 時，等待最大有效 cooldown。
 * 2. Window exhausted: 任一 window 之 used >= limit 時，等待該 window 重置（windowLeft 或 window），429 時並納入 cooldown。
 * 3. Retry-After: 若存在合法 Retry-After，與 window 推導出的等待時間取較大（較保守）值。
 */
export function computeRateLimitWaitMs(
  parsed: ParsedTradeRateLimitHeaders,
  status?: number,
  fallback429CooldownMs: number = DEFAULT_FALLBACK_429_COOLDOWN_MS,
): number {
  let maxWaitMs = 0;

  if (parsed.retryAfterMs !== null && parsed.retryAfterMs > 0) {
    maxWaitMs = Math.max(maxWaitMs, parsed.retryAfterMs);
  }

  for (const rule of parsed.rules) {
    for (const win of rule.windows) {
      if (win.cooldownLeft > 0) {
        maxWaitMs = Math.max(maxWaitMs, Math.ceil(win.cooldownLeft * 1000));
      } else if (win.used >= win.limit) {
        let exhaustedWaitSec = 0;
        if (status === 429 && parsed.retryAfterMs === null) {
          exhaustedWaitSec =
            win.windowLeft > 0 ? win.windowLeft : win.cooldown > 0 ? win.cooldown : win.window;
        } else {
          exhaustedWaitSec = win.windowLeft > 0 ? win.windowLeft : win.window;
        }
        if (exhaustedWaitSec > 0) {
          maxWaitMs = Math.max(maxWaitMs, Math.ceil(exhaustedWaitSec * 1000));
        }
      }
    }
  }

  if (status === 429 && maxWaitMs <= 0 && fallback429CooldownMs > 0) {
    maxWaitMs = fallback429CooldownMs;
  }

  return maxWaitMs;
}

/**
 * LiveSearch `/fetch` Rate Gate (Deep Module)
 *
 * 職責（HTTP admission / cooldown / rate-state owner；pipeline FIFO ordering 由 LiveSearchPrimaryRuntime 唯一負責）：
 * - HTTP `/fetch` 准入控制 (HTTP admission)
 * - 解析並保存目前 Runtime session 之 GGG rate-limit rule/window state
 * - 於下次請求發送前等待必要之伺服器 cooldown / window reset / Retry-After
 * - 處理 HTTP 429：在同一 request lifecycle 內 ingest 標頭後等待解禁，並執行有限次數（預設 1 次）重試
 * - dispose() 或單筆任務取消時立即中斷等待計時器，保證零後續請求
 */
export class LiveSearchFetchRateGate implements ILiveSearchFetchRateGate {
  private readonly fetchClient: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly timer: LiveSearchFetchRateGateTimer;
  private readonly maxRateLimitRetries: number;
  private readonly fallback429CooldownMs: number;

  private policy: string | null = null;
  private rulesState = new Map<string, TradeRateLimitWindow[]>();
  private nextAllowedAtMs = 0;
  private observedAtMs: number | undefined = undefined;
  private activeWaitCancels = new Set<() => void>();
  private stateListeners = new Set<(snapshot: Readonly<TradeRateLimitStateSnapshot>) => void>();
  private disposed = false;

  constructor(options?: LiveSearchFetchRateGateOptions) {
    this.fetchClient =
      options?.fetchClient ??
      ((url: string, init?: RequestInit) => {
        if (typeof fetch === 'undefined') {
          throw new Error('fetch is not supported in this environment');
        }
        return fetch(url, init);
      });
    this.timer = {
      setTimeout: options?.timer?.setTimeout ?? ((handler, ms) => setTimeout(handler, ms)),
      clearTimeout: options?.timer?.clearTimeout ?? ((id) => clearTimeout(id as any)),
      now: options?.timer?.now ?? (() => Date.now()),
    };
    this.maxRateLimitRetries = options?.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES;
    this.fallback429CooldownMs = options?.fallback429CooldownMs ?? DEFAULT_FALLBACK_429_COOLDOWN_MS;
  }

  public getStateSnapshot(): Readonly<TradeRateLimitStateSnapshot> {
    const rulesObj: Record<string, TradeRateLimitWindow[]> = {};
    for (const [ruleName, windows] of this.rulesState.entries()) {
      rulesObj[ruleName] = windows.map((w) => ({ ...w }));
    }
    return {
      policy: this.policy,
      rules: rulesObj,
      nextAllowedAtMs: this.nextAllowedAtMs,
      ...(this.observedAtMs !== undefined ? { observedAtMs: this.observedAtMs } : {}),
    };
  }

  public read(): Readonly<TradeRateLimitStateSnapshot> {
    return this.getStateSnapshot();
  }

  public subscribe(
    listener: (snapshot: Readonly<TradeRateLimitStateSnapshot>) => void,
  ): () => void {
    if (this.disposed) {
      return () => {};
    }
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private notifyStateListeners(): void {
    if (this.disposed) return;
    const snapshot = this.getStateSnapshot();
    for (const listener of Array.from(this.stateListeners)) {
      if (this.disposed) return;
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[PoeXD LiveSearch] Error in rate gate state listener:', err);
      }
    }
  }

  public async fetch(
    url: string,
    init?: RequestInit,
    options?: LiveSearchFetchRequestOptions,
  ): Promise<Response | null> {
    if (this.disposed || options?.shouldAbort?.()) {
      return null;
    }

    for (let attempt = 0; attempt <= this.maxRateLimitRetries; attempt++) {
      const admitted = await this.waitForAdmission(options);
      if (!admitted) {
        return null;
      }

      const response = await this.fetchClient(url, init);
      if (this.disposed) {
        return null;
      }
      this.ingestResponseHeaders(response.status, response.headers);

      if (this.disposed || options?.shouldAbort?.()) {
        return null;
      }

      if (response.status === 429 && attempt < this.maxRateLimitRetries) {
        continue;
      }

      return response;
    }

    return null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stateListeners.clear();
    for (const cancel of Array.from(this.activeWaitCancels)) {
      cancel();
    }
    this.activeWaitCancels.clear();
  }

  private ingestResponseHeaders(status: number, headers: HeaderSource): void {
    if (this.disposed) return;
    const now = this.timer.now();
    const parsed = parseTradeRateLimitHeaders(headers, now);

    let changed = false;
    if (parsed.policy && parsed.policy !== this.policy) {
      this.policy = parsed.policy;
      changed = true;
    }
    for (const ruleSnapshot of parsed.rules) {
      this.rulesState.set(
        ruleSnapshot.rule,
        ruleSnapshot.windows.map((w) => ({ ...w })),
      );
      changed = true;
    }

    const waitMs = computeRateLimitWaitMs(parsed, status, this.fallback429CooldownMs);
    if (waitMs > 0) {
      const nextAllowed = Math.max(this.nextAllowedAtMs, now + waitMs);
      if (nextAllowed !== this.nextAllowedAtMs) {
        this.nextAllowedAtMs = nextAllowed;
        changed = true;
      }
    } else if (this.nextAllowedAtMs > 0 && now >= this.nextAllowedAtMs) {
      this.nextAllowedAtMs = 0;
      changed = true;
    }

    if (parsed.policy || parsed.rules.length > 0 || waitMs > 0) {
      this.observedAtMs = now;
      changed = true;
    }

    if (changed) {
      this.notifyStateListeners();
    }
  }

  private waitForAdmission(options?: LiveSearchFetchRequestOptions): Promise<boolean> {
    if (this.disposed || options?.shouldAbort?.()) {
      return Promise.resolve(false);
    }

    const now = this.timer.now();
    const waitMs = Math.max(0, this.nextAllowedAtMs - now);
    if (waitMs <= 0) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timerId: unknown = null;

      const finish = (admitted: boolean) => {
        if (settled) return;
        settled = true;
        if (timerId !== null) {
          this.timer.clearTimeout(timerId);
          timerId = null;
        }
        this.activeWaitCancels.delete(cancelWait);
        resolve(admitted);
      };

      const cancelWait = () => {
        finish(false);
      };

      this.activeWaitCancels.add(cancelWait);
      options?.onRegisterCancel?.(cancelWait);

      if (this.disposed || options?.shouldAbort?.()) {
        finish(false);
        return;
      }

      timerId = this.timer.setTimeout(() => {
        timerId = null;
        if (this.disposed || options?.shouldAbort?.()) {
          finish(false);
          return;
        }
        finish(true);
      }, waitMs);
    });
  }
}
