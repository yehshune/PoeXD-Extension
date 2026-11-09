import { describe, expect, it, vi } from 'vitest';
import {
  createEconomyAdapters,
  createEconomyRateService,
  getEconomyErrorCacheKey,
  getEconomySnapshotCacheKey,
  normalizeEconomyLeague,
} from '@/utils/economy';

describe('economy adapters', () => {
  it('normalizes league names for cache keys', () => {
    expect(normalizeEconomyLeague('  Settlers   HC ')).toBe('Settlers HC');
    expect(getEconomySnapshotCacheKey('poe2', '  Standard  ')).toBe(
      'economy_snapshot_cache_poe2_standard',
    );
    expect(getEconomyErrorCacheKey('poe2', '  Standard  ')).toBe('ninja_error_cache_poe2_standard');
  });

  it('keeps provider URL rules inside each adapter', async () => {
    const http = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ core: { primary: 'chaos' }, lines: [] }),
    }));
    const adapters = createEconomyAdapters(http);
    await adapters.poe1.fetch('Settlers HC');
    await adapters.poe2.fetch('Hardcore Allflame');

    expect(http.mock.calls.map((call) => call[0])).toEqual([
      'https://poe.ninja/poe1/api/economy/exchange/current/overview?league=Settlers%20HC&type=Currency',
      'https://poe.ninja/poe2/api/economy/exchange/current/overview?league=Hardcore%20Allflame&type=Currency',
    ]);
  });

  it('normalizes Exchange overview responses into currency rates', async () => {
    const http = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        core: { primary: 'chaos' },
        lines: [
          { id: 'chaos', primaryValue: 1 },
          { id: 'divine', primaryValue: 196.3 },
        ],
      }),
    }));

    await expect(createEconomyAdapters(http).poe1.fetch('Allflame')).resolves.toEqual({
      primary: 'chaos',
      rates: { chaos: 1, divine: 196.3 },
    });
  });
});

describe('EconomyRateService', () => {
  function createInMemoryStorage(initial: Record<string, any> = {}) {
    const data = new Map<string, any>(Object.entries(initial));
    return {
      data,
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, any> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          if (data.has(k)) result[k] = data.get(k);
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, any>) => {
        for (const [k, v] of Object.entries(items)) {
          data.set(k, v);
        }
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          data.delete(k);
        }
      }),
    };
  }

  const sampleSnapshot = {
    primary: 'chaos' as const,
    rates: { chaos: 1, divine: 200 },
  };

  it('serves valid snapshot from cache without fetching provider (poe1: 60m, poe2: 60m)', async () => {
    let currentTime = 1_000_000;
    const storage = createInMemoryStorage();
    const fetchPoe1 = vi.fn(async () => sampleSnapshot);
    const fetchPoe2 = vi.fn(async () => sampleSnapshot);
    const service = createEconomyRateService({
      storage,
      now: () => currentTime,
      adapters: {
        poe1: { fetch: fetchPoe1 },
        poe2: { fetch: fetchPoe2 },
      },
    });

    // 1. 首次請求，快取未命中，呼叫 provider
    const res1 = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(res1).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: {
        updatedAt: 1_000_000,
        source: 'network',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      },
    });
    expect(fetchPoe1).toHaveBeenCalledTimes(1);

    // 59 分鐘後再次請求 poe1，快取仍有效，不呼叫 provider
    currentTime += 59 * 60 * 1000;
    const res2 = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(res2).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: {
        updatedAt: 1_000_000,
        source: 'cache',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      },
    });
    expect(fetchPoe1).toHaveBeenCalledTimes(1);

    // 61 分鐘後（超過 60 分鐘 TTL），快取過期，重新 fetch
    currentTime += 2 * 60 * 1000;
    const res3 = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(res3).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: {
        updatedAt: 4_660_000,
        source: 'network',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      },
    });
    expect(fetchPoe1).toHaveBeenCalledTimes(2);

    // poe2 測試：60 分鐘 TTL
    await service.fetch({ version: 'poe2', league: 'Standard' });
    expect(fetchPoe2).toHaveBeenCalledTimes(1);

    // 59 分鐘後快取仍有效
    currentTime += 59 * 60 * 1000;
    await service.fetch({ version: 'poe2', league: 'Standard' });
    expect(fetchPoe2).toHaveBeenCalledTimes(1);

    // 61 分鐘後快取過期，重新 fetch
    currentTime += 2 * 60 * 1000;
    await service.fetch({ version: 'poe2', league: 'Standard' });
    expect(fetchPoe2).toHaveBeenCalledTimes(2);
  });

  it('enforces 5-minute error cooldown on non-force requests, and allows fetch after cooldown expires', async () => {
    let currentTime = 1_000_000;
    const storage = createInMemoryStorage();
    const fetchMock = vi.fn(async () => {
      throw new Error('Ninja 伺服器忙碌中');
    });
    const service = createEconomyRateService({
      storage,
      now: () => currentTime,
      adapters: {
        poe1: { fetch: fetchMock },
        poe2: { fetch: vi.fn() },
      },
    });

    // 首次失敗，寫入 error cache
    const res1 = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(res1).toEqual({ success: false, error: 'Ninja 伺服器忙碌中' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 4 分鐘內再次請求，受 5 分鐘冷卻保護，不呼叫 provider
    currentTime += 4 * 60 * 1000;
    const res2 = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.error).toContain('上一次請求於 5 分鐘內失敗');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 5 分鐘過後，冷卻結束，允許重新 fetch
    currentTime += 2 * 60 * 1000;
    const res3 = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(res3.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('force=true bypasses valid snapshot cache and recent error cooldown', async () => {
    let currentTime = 1_000_000;
    const storage = createInMemoryStorage();
    const fetchMock = vi.fn(async () => sampleSnapshot);
    const service = createEconomyRateService({
      storage,
      now: () => currentTime,
      adapters: {
        poe1: { fetch: fetchMock },
        poe2: { fetch: vi.fn() },
      },
    });

    // 初始取得快取
    await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // force=true 繞過快取
    await service.fetch({ version: 'poe1', league: 'Standard', force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 模擬遭遇錯誤冷卻（時間推移 61 分鐘使舊快取過期）
    currentTime += 61 * 60 * 1000;
    fetchMock.mockRejectedValueOnce(new Error('臨時錯誤'));
    await service.fetch({ version: 'poe1', league: 'Standard', force: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 一般請求無有效快取且在 5 分鐘冷卻期內，被冷卻阻擋
    const resBlocked = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(resBlocked.success).toBe(false);
    if (!resBlocked.success) {
      expect(resBlocked.error).toContain('上一次請求於 5 分鐘內失敗');
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // force=true 再次繞過冷卻
    fetchMock.mockResolvedValueOnce(sampleSnapshot);
    const resForce = await service.fetch({ version: 'poe1', league: 'Standard', force: true });
    expect(resForce).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: expect.objectContaining({
        source: 'network',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent in-flight requests for the same normalized key and cleans up on completion and rejection', async () => {
    let resolveProvider: (val: any) => void;
    let rejectProvider: (err: any) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          resolveProvider = resolve;
          rejectProvider = reject;
        }),
    );
    const service = createEconomyRateService({
      adapters: {
        poe1: { fetch: fetchMock as any },
        poe2: { fetch: vi.fn() },
      },
      storage: createInMemoryStorage(),
    });

    // 兩個相同 normalized key 的並發請求（大小寫、空白差異）
    const p1 = service.fetch({ version: 'poe1', league: '  Standard  ' });
    const p2 = service.fetch({ version: 'poe1', league: 'standard' });

    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveProvider!(sampleSnapshot);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: expect.objectContaining({
        source: 'network',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      }),
    });
    expect(r2).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: expect.objectContaining({
        source: 'network',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      }),
    });

    // 完成後 activeRequests 清理乾淨，下次請求能正常啟動
    const p3 = service.fetch({ version: 'poe1', league: 'Standard', force: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveProvider!(sampleSnapshot);
    await p3;

    // 驗證 reject 時也會清理 activeRequests
    const pFail1 = service.fetch({ version: 'poe1', league: 'Settlers', force: true });
    const pFail2 = service.fetch({ version: 'poe1', league: 'Settlers', force: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    rejectProvider!(new Error('網路中斷'));
    const [rf1, rf2] = await Promise.all([pFail1, pFail2]);
    expect(rf1).toEqual({ success: false, error: '網路中斷' });
    expect(rf2).toEqual({ success: false, error: '網路中斷' });

    // 失敗後 activeRequests 清理乾淨，下次 force 請求能再次發起 fetch
    const pRetry = service.fetch({ version: 'poe1', league: 'Settlers', force: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    resolveProvider!(sampleSnapshot);
    await pRetry;
  });

  it('manages cache lifecycle correctly on success (sets snapshot, clears error) and failure (sets error)', async () => {
    const storage = createInMemoryStorage();
    const fetchMock = vi.fn();
    const service = createEconomyRateService({
      storage,
      adapters: {
        poe1: { fetch: fetchMock },
        poe2: { fetch: vi.fn() },
      },
    });

    // 1. 失敗情境
    fetchMock.mockRejectedValueOnce(new Error('Fetch error'));
    const failRes = await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(failRes).toEqual({ success: false, error: 'Fetch error' });
    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({ ninja_error_cache_poe1_standard: expect.any(Number) }),
    );

    // 2. 成功情境：寫入 snapshot 並清除 error cache
    fetchMock.mockResolvedValueOnce(sampleSnapshot);
    const successRes = await service.fetch({ version: 'poe1', league: 'Standard', force: true });
    expect(successRes).toEqual({
      success: true,
      data: sampleSnapshot,
      metadata: expect.objectContaining({
        source: 'network',
        ttl: 60 * 60 * 1000,
        hasData: true,
        isExpired: false,
      }),
    });
    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({
        economy_snapshot_cache_poe1_standard: {
          timestamp: expect.any(Number),
          data: sampleSnapshot,
        },
      }),
    );
    expect(storage.remove).toHaveBeenCalledWith('ninja_error_cache_poe1_standard');
  });

  it('returns rate metadata reflecting cache state without triggering fetch', async () => {
    let currentTime = 1_000_000;
    const storage = createInMemoryStorage();
    const fetchMock = vi.fn(async () => sampleSnapshot);
    const service = createEconomyRateService({
      storage,
      now: () => currentTime,
      adapters: {
        poe1: { fetch: fetchMock },
        poe2: { fetch: vi.fn() },
      },
    });

    // 1. 無快取時
    const metaEmpty = await service.getMetadata({ version: 'poe1', league: 'Standard' });
    expect(metaEmpty).toEqual({
      updatedAt: null,
      source: 'none',
      ttl: 60 * 60 * 1000,
      hasData: false,
      isExpired: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // 2. 透過 fetch 取得快取後
    await service.fetch({ version: 'poe1', league: 'Standard' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const metaCached = await service.getMetadata({ version: 'poe1', league: 'Standard' });
    expect(metaCached).toEqual({
      updatedAt: 1_000_000,
      source: 'cache',
      ttl: 60 * 60 * 1000,
      hasData: true,
      isExpired: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3. 快取過期後 (超過 60 分鐘)
    currentTime += 61 * 60 * 1000;
    const metaExpired = await service.getMetadata({ version: 'poe1', league: 'Standard' });
    expect(metaExpired).toEqual({
      updatedAt: 1_000_000,
      source: 'cache',
      ttl: 60 * 60 * 1000,
      hasData: true,
      isExpired: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported game versions without calling provider', async () => {
    const fetchMock = vi.fn();
    const service = createEconomyRateService({
      adapters: {
        poe1: { fetch: fetchMock },
        poe2: { fetch: fetchMock },
      },
      storage: createInMemoryStorage(),
    });

    const res = await service.fetch({ version: 'poe3' as any, league: 'Standard' });
    expect(res).toEqual({ success: false, error: '不支援的遊戲版本' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('EconomyRateService change notifications', () => {
    it('notifies subscribers on network refresh and cache mutation, but not on cache hits', async () => {
      let currentTime = 1_000_000;
      const storage = createInMemoryStorage();
      const fetchMock = vi.fn(async () => sampleSnapshot);
      const service = createEconomyRateService({
        storage,
        now: () => currentTime,
        adapters: {
          poe1: { fetch: fetchMock },
          poe2: { fetch: vi.fn() },
        },
      });

      const listener = vi.fn();
      const unsubscribe = service.subscribe(listener);

      // 1. 首次 network fetch 成功並寫入 cache，應觸發一次通知
      await service.fetch({ version: 'poe1', league: 'Standard' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        version: 'poe1',
        league: 'Standard',
        metadata: {
          updatedAt: 1_000_000,
          source: 'cache',
          ttl: 60 * 60 * 1000,
          hasData: true,
          isExpired: false,
        },
      });

      // 2. 快取未過期時再次 fetch (cache hit)，不應觸發通知
      currentTime += 30 * 60 * 1000; // 30 分鐘後
      await service.fetch({ version: 'poe1', league: 'Standard' });
      expect(listener).toHaveBeenCalledTimes(1);

      // 3. 超過 60 分鐘後再次 fetch (auto network refresh)，應觸發第二次通知
      currentTime += 35 * 60 * 1000; // 總計 65 分鐘
      await service.fetch({ version: 'poe1', league: 'Standard' });
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          version: 'poe1',
          league: 'Standard',
          metadata: expect.objectContaining({
            updatedAt: 4_900_000,
            hasData: true,
            isExpired: false,
          }),
        }),
      );

      // 4. 解除訂閱後不應再收到通知
      unsubscribe();
      await service.fetch({ version: 'poe1', league: 'Standard', force: true });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent requests to emit only one logical change notification', async () => {
      let resolveProvider: (val: any) => void;
      const fetchMock = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveProvider = resolve;
          }),
      );
      const service = createEconomyRateService({
        adapters: {
          poe1: { fetch: fetchMock as any },
          poe2: { fetch: vi.fn() },
        },
        storage: createInMemoryStorage(),
      });

      const listener = vi.fn();
      service.subscribe(listener);

      const p1 = service.fetch({ version: 'poe1', league: 'Standard' });
      const p2 = service.fetch({ version: 'poe1', league: 'Standard' });
      const p3 = service.fetch({ version: 'poe1', league: '  Standard  ' });

      await new Promise((r) => setTimeout(r, 0));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(listener).not.toHaveBeenCalled();

      resolveProvider!(sampleSnapshot);
      await Promise.all([p1, p2, p3]);

      // 3 個並發被合併的請求，只產生一次 logical change notification
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 'poe1',
          league: 'Standard',
        }),
      );
    });

    it('does not notify subscribers when network refresh fails', async () => {
      const storage = createInMemoryStorage();
      const fetchMock = vi.fn(async () => {
        throw new Error('API Error');
      });
      const service = createEconomyRateService({
        storage,
        adapters: {
          poe1: { fetch: fetchMock },
          poe2: { fetch: vi.fn() },
        },
      });

      const listener = vi.fn();
      service.subscribe(listener);

      const result = await service.fetch({ version: 'poe1', league: 'Standard' });
      expect(result.success).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
