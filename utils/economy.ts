import { parseCurrencyRateSnapshot, type CurrencyRateSnapshot } from './price-comparison';
import type { PoeVersion } from './trade-context';
import { extensionMessaging } from './extension-protocol';

export interface EconomyAdapter {
  fetch(league: string): Promise<CurrencyRateSnapshot>;
}

export type EconomyHttpClient = (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export function normalizeEconomyLeague(league: string) {
  return league.trim().replace(/\s+/g, ' ');
}

export function getEconomySnapshotCacheKey(version: PoeVersion, league: string) {
  return `economy_snapshot_cache_${version}_${normalizeEconomyLeague(league).toLowerCase()}`;
}

export function getEconomyErrorCacheKey(version: PoeVersion, league: string) {
  return `ninja_error_cache_${version}_${normalizeEconomyLeague(league).toLowerCase()}`;
}

export function createEconomyAdapters(
  http: EconomyHttpClient = fetch,
): Record<PoeVersion, EconomyAdapter> {
  return {
    poe1: {
      async fetch(league) {
        const url = `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
        return parseExchangeOverview(await fetchJson(http, url));
      },
    },
    poe2: {
      async fetch(league) {
        const url = `https://poe.ninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=Currency`;
        return parseExchangeOverview(await fetchJson(http, url));
      },
    },
  };
}

function parseExchangeOverview(value: unknown) {
  const snapshot = parseCurrencyRateSnapshot(value);
  if (!snapshot) throw new Error('poe.ninja Exchange overview 格式無效');
  return snapshot;
}

async function fetchJson(http: EconomyHttpClient, url: string) {
  const response = await http(url);
  if (!response.ok) throw new Error(`HTTP 狀態碼異常: ${response.status}`);
  return response.json();
}

export interface EconomyStorage {
  get(keys: string | string[]): Promise<Record<string, any>>;
  set(items: Record<string, any>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export function createChromeEconomyStorage(area?: {
  get(keys?: null | string | string[]): Promise<Record<string, any>>;
  set(items: Record<string, any>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}): EconomyStorage {
  const resolvedArea = area ?? chrome.storage.local;
  return {
    get: (keys) => resolvedArea.get(keys),
    set: (items) => resolvedArea.set(items),
    remove: (keys) => resolvedArea.remove(keys),
  };
}

export interface EconomyRateRequest {
  version: PoeVersion;
  league: string;
  force?: boolean;
}

export interface EconomyRateMetadata {
  updatedAt: number | null;
  source: 'cache' | 'network' | 'none';
  ttl: number;
  hasData: boolean;
  isExpired: boolean;
}

export interface EconomyMetadataRequest {
  version: PoeVersion;
  league: string;
}

export type EconomyRateOutcome =
  | { success: true; data: CurrencyRateSnapshot; metadata?: EconomyRateMetadata }
  | { success: false; error: string };

export interface EconomyChange {
  version: PoeVersion;
  league: string;
  metadata: EconomyRateMetadata;
}

export type EconomyChangeListener = (change: EconomyChange) => void;

export interface EconomyBroadcastTransport {
  listTradeTabIds(): Promise<number[]>;
  sendChangeToTab(tabId: number, change: EconomyChange): Promise<void>;
}

export async function broadcastEconomyChange(
  change: EconomyChange,
  transport: EconomyBroadcastTransport,
): Promise<void> {
  const tabIds = await transport.listTradeTabIds();
  await Promise.allSettled(tabIds.map((tabId) => transport.sendChangeToTab(tabId, change)));
}

export interface EconomyRateService {
  fetch(request: EconomyRateRequest): Promise<EconomyRateOutcome>;
  getMetadata(request: EconomyMetadataRequest): Promise<EconomyRateMetadata>;
  subscribe(listener: EconomyChangeListener): () => void;
}

export function createEconomyRateService(
  options: {
    storage?: EconomyStorage;
    adapters?: Record<PoeVersion, EconomyAdapter>;
    now?: () => number;
  } = {},
): EconomyRateService {
  const storage = options.storage ?? createChromeEconomyStorage();
  const adapters = options.adapters ?? createEconomyAdapters();
  const now = options.now ?? Date.now;
  const activeRequests = new Map<string, Promise<CurrencyRateSnapshot>>();
  const listeners = new Set<EconomyChangeListener>();

  const RECENT_ERROR_LIMIT = 5 * 60 * 1000;
  const TTL: Record<PoeVersion, number> = {
    poe1: 60 * 60 * 1000,
    poe2: 60 * 60 * 1000,
  };

  const notifyChange = (change: EconomyChange) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        // Individual subscriber failure does not abort other subscribers
      }
    }
  };

  return {
    subscribe(listener: EconomyChangeListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async getMetadata({ version, league }) {
      const cacheLifetime = TTL[version] ?? 60 * 60 * 1000;
      if (version !== 'poe1' && version !== 'poe2') {
        return {
          updatedAt: null,
          source: 'none',
          ttl: cacheLifetime,
          hasData: false,
          isExpired: true,
        };
      }

      const cleanLeague = normalizeEconomyLeague(league || '');
      if (!cleanLeague) {
        return {
          updatedAt: null,
          source: 'none',
          ttl: cacheLifetime,
          hasData: false,
          isExpired: true,
        };
      }

      const cacheKey = getEconomySnapshotCacheKey(version, cleanLeague);
      try {
        const cached = await storage.get(cacheKey);
        const cachedEntry = cached[cacheKey];
        if (cachedEntry?.timestamp && cachedEntry?.data) {
          const snapshot = parseCurrencyRateSnapshot(cachedEntry.data);
          if (snapshot) {
            const age = now() - cachedEntry.timestamp;
            return {
              updatedAt: cachedEntry.timestamp,
              source: 'cache',
              ttl: cacheLifetime,
              hasData: true,
              isExpired: age >= cacheLifetime,
            };
          }
        }
      } catch {
        // storage get error fallback
      }

      return {
        updatedAt: null,
        source: 'none',
        ttl: cacheLifetime,
        hasData: false,
        isExpired: true,
      };
    },

    async fetch({ version, league, force }) {
      if (version !== 'poe1' && version !== 'poe2') {
        return { success: false, error: '不支援的遊戲版本' };
      }

      const cleanLeague = normalizeEconomyLeague(league || '');
      const cacheKey = getEconomySnapshotCacheKey(version, cleanLeague);
      const errKey = getEconomyErrorCacheKey(version, cleanLeague);
      const cacheLifetime = TTL[version];

      try {
        // 1. 檢查快取 (若非 force)
        if (!force) {
          const cached = await storage.get(cacheKey);
          const cachedEntry = cached[cacheKey];
          if (cachedEntry?.timestamp && cachedEntry?.data) {
            const snapshot = parseCurrencyRateSnapshot(cachedEntry.data);
            if (snapshot) {
              const age = now() - cachedEntry.timestamp;
              if (age < cacheLifetime) {
                return {
                  success: true,
                  data: snapshot,
                  metadata: {
                    updatedAt: cachedEntry.timestamp,
                    source: 'cache',
                    ttl: cacheLifetime,
                    hasData: true,
                    isExpired: false,
                  },
                };
              }
            }
          }

          // 1.2 檢查失敗冷卻 (5 分鐘)
          const errCached = await storage.get(errKey);
          const errTimestamp = errCached[errKey];
          if (typeof errTimestamp === 'number') {
            const age = now() - errTimestamp;
            if (age < RECENT_ERROR_LIMIT) {
              return {
                success: false,
                error:
                  '上一次請求於 5 分鐘內失敗，暫停自動載入。請稍後或點擊「重試/重新整理」按鈕。',
              };
            }
          }
        }

        // 2. 避免重複請求鎖 (Request coalescing)
        const reqKey = cacheKey;
        const existingRequest = activeRequests.get(reqKey);
        if (existingRequest) {
          try {
            const data = await existingRequest;
            return {
              success: true,
              data,
              metadata: {
                updatedAt: now(),
                source: 'network',
                ttl: cacheLifetime,
                hasData: true,
                isExpired: false,
              },
            };
          } catch (err: any) {
            return { success: false, error: err?.message || String(err) };
          }
        }

        const fetchPromise = (async () => {
          try {
            const snapshot = await adapters[version].fetch(cleanLeague);

            const timestamp = now();
            await storage.set({
              [cacheKey]: {
                timestamp,
                data: snapshot,
              },
            });

            await storage.remove(errKey);

            notifyChange({
              version,
              league: cleanLeague,
              metadata: {
                updatedAt: timestamp,
                source: 'cache',
                ttl: cacheLifetime,
                hasData: true,
                isExpired: false,
              },
            });

            return snapshot;
          } finally {
            activeRequests.delete(reqKey);
          }
        })();

        activeRequests.set(reqKey, fetchPromise);

        try {
          const data = await fetchPromise;
          return {
            success: true,
            data,
            metadata: {
              updatedAt: now(),
              source: 'network',
              ttl: cacheLifetime,
              hasData: true,
              isExpired: false,
            },
          };
        } catch (err: any) {
          try {
            await storage.set({ [errKey]: now() });
          } catch {
            // ignore storage write failure on error recording
          }
          return { success: false, error: err?.message || String(err) };
        }
      } catch (err: any) {
        return { success: false, error: err?.message || String(err) };
      }
    },
  };
}

export function registerEconomyBackgroundHandlers(
  options: {
    messenger?: typeof extensionMessaging;
    service?: EconomyRateService;
    broadcastTransport?: EconomyBroadcastTransport;
  } = {},
): () => void {
  const messenger = options.messenger ?? extensionMessaging;
  const service = options.service ?? createEconomyRateService();

  let unhookBroadcast: (() => void) | undefined;
  if (options.broadcastTransport) {
    unhookBroadcast = service.subscribe((change) => {
      void broadcastEconomyChange(change, options.broadcastTransport!).catch((error: unknown) => {
        console.error('[Economy] Change broadcast failed:', error);
      });
    });
  }

  const unregFetch = messenger.onMessage('economy:fetchCurrencyRates', async (message) => {
    if (message.data.version !== 'poe1' && message.data.version !== 'poe2') {
      return { success: false, error: '不支援的遊戲版本' };
    }
    return await service.fetch(message.data);
  });

  const unregMetadata = messenger.onMessage('economy:getRateMetadata', async (message) => {
    return await service.getMetadata(message.data);
  });

  return () => {
    unhookBroadcast?.();
    unregFetch();
    unregMetadata();
  };
}
