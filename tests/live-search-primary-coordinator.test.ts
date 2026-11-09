import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LiveSearchCoordinator,
  createInMemoryLiveSearchStorage,
  LIVE_SEARCH_PRIMARY_STORAGE_KEY,
  type LiveSearchTabsApi,
  type LiveSearchWindowsApi,
  type LiveSearchTab,
} from '@/utils/live-search-coordinator';
import {
  LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1,
  LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2,
  type LiveSearchPrimaryStorageRecord,
} from '@/utils/live-search-contract';

describe('LiveSearch Primary Coordinator (Phase 1 Ownership & Lifecycle)', () => {
  let storage: ReturnType<typeof createInMemoryLiveSearchStorage>;
  let tabsDb: Map<number, LiveSearchTab>;
  let nextTabId: number;
  let mockTabsApi: LiveSearchTabsApi;
  let mockWindowsApi: LiveSearchWindowsApi;
  let coordinator: LiveSearchCoordinator;
  let updatedTabs: Array<{ tabId: number; props: any }>;
  let updatedWindows: Array<{ windowId: number; props: any }>;

  beforeEach(() => {
    storage = createInMemoryLiveSearchStorage();
    tabsDb = new Map();
    nextTabId = 100;
    updatedTabs = [];
    updatedWindows = [];

    mockTabsApi = {
      get: vi.fn(async (tabId: number) => {
        return tabsDb.get(tabId);
      }),
      create: vi.fn(async (props: { url?: string; active?: boolean }) => {
        const id = ++nextTabId;
        const newTab: LiveSearchTab = {
          id,
          url: props.url || 'https://www.pathofexile.com/trade2',
          active: props.active ?? true,
          windowId: 1,
        };
        tabsDb.set(id, newTab);
        return newTab;
      }),
      update: vi.fn(async (tabId: number, props: { active?: boolean; url?: string }) => {
        const tab = tabsDb.get(tabId);
        if (!tab) return undefined;
        if (props.active !== undefined) tab.active = props.active;
        if (props.url !== undefined) tab.url = props.url;
        updatedTabs.push({ tabId, props });
        return tab;
      }),
    };

    mockWindowsApi = {
      update: vi.fn(async (windowId: number, updateInfo: { focused?: boolean }) => {
        updatedWindows.push({ windowId, props: updateInfo });
        return { id: windowId } as any;
      }),
    };

    coordinator = new LiveSearchCoordinator({
      storage,
      tabs: mockTabsApi,
      windows: mockWindowsApi,
    });
  });

  it('1. 無 Primary 時 open → 建立一個新的 Primary tab 並記錄到 storage.session', async () => {
    const res = await coordinator.openPrimary({ gameVersion: 'poe2' });

    expect(res.success).toBe(true);
    expect(res.created).toBe(true);
    expect(res.tabId).toBe(101);

    const stored = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeDefined();
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]?.tabId).toBe(101);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]?.gameVersion).toBe('poe2');
    expect(mockTabsApi.create).toHaveBeenCalledTimes(1);
  });

  it('2. 已有有效 Primary 時再次 open → focus 同一 tab，不建立第二個', async () => {
    // 第一次 open
    const firstRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(firstRes.tabId).toBe(101);

    // 再次 open
    const secondRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(secondRes.success).toBe(true);
    expect(secondRes.created).toBe(false);
    expect(secondRes.tabId).toBe(101);

    // 驗證只建立了一次 tab，但調用了 update active/focus
    expect(mockTabsApi.create).toHaveBeenCalledTimes(1);
    expect(mockTabsApi.update).toHaveBeenCalledWith(101, { active: true });
    expect(mockWindowsApi.update).toHaveBeenCalledWith(1, { focused: true });
  });

  it('3. concurrent open requests → 最終仍只有一個 Primary，無 race condition', async () => {
    // 模擬並發 5 次開啟請求
    const results = await Promise.all([
      coordinator.openPrimary({ gameVersion: 'poe2' }),
      coordinator.openPrimary({ gameVersion: 'poe2' }),
      coordinator.openPrimary({ gameVersion: 'poe2' }),
      coordinator.openPrimary({ gameVersion: 'poe2' }),
      coordinator.openPrimary({ gameVersion: 'poe2' }),
    ]);

    // 所有結果必須成功且擁有相同 tabId
    const primaryTabId = results[0].tabId;
    expect(primaryTabId).toBeDefined();
    for (const res of results) {
      expect(res.success).toBe(true);
      expect(res.tabId).toBe(primaryTabId);
    }

    // 只建立了 1 個 tab
    expect(mockTabsApi.create).toHaveBeenCalledTimes(1);
  });

  it('4. stale / missing Primary tab → ownership 可恢復並建立新的 Primary', async () => {
    // 建立初次 Primary
    const firstRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(firstRes.tabId).toBe(101);

    // 模擬 tab 異常遺失（例如被外部強制關閉但沒觸發事件，或者 get 返回 undefined）
    tabsDb.delete(101);

    // 下一次 open 必須能檢測到失效並重新建立
    const secondRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(secondRes.success).toBe(true);
    expect(secondRes.created).toBe(true);
    expect(secondRes.tabId).toBe(102);

    const stored = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]?.tabId).toBe(102);
  });

  it('4b. Primary tab 被導向至非 Trade 網址時失去 eligibility → 自動清理並建立新 Primary', async () => {
    const firstRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(firstRes.tabId).toBe(101);

    // 導向非 Trade 網址
    const tab = tabsDb.get(101)!;
    tab.url = 'https://www.google.com';

    const secondRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(secondRes.success).toBe(true);
    expect(secondRes.created).toBe(true);
    expect(secondRes.tabId).toBe(102);
  });

  it('5. Primary tab 關閉 (handleTabRemoved) → ownership 清除', async () => {
    const firstRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    const tabId = firstRes.tabId!;

    await coordinator.handleTabRemoved(tabId);

    const stored = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeUndefined();

    // 關閉無關的 tab 不影響 Primary
    await coordinator.openPrimary({ gameVersion: 'poe2' });
    await coordinator.handleTabRemoved(999);
    const storedAfterOtherClosed = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(storedAfterOtherClosed[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeDefined();
  });

  it('6. Primary 自己取得的 page role 為 live-search-primary，其他 Trade tabs 為 normal', async () => {
    const primaryRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    const primaryTabId = primaryRes.tabId!;

    // 建立另一個一般 Trade tab
    const normalTab = await mockTabsApi.create({
      url: 'https://www.pathofexile.com/trade2/search/poe2/Standard',
    });

    const primaryRole = await coordinator.getPageRole(primaryTabId);
    expect(primaryRole.role).toBe('live-search-primary');
    expect(primaryRole.primaryTabId).toBe(primaryTabId);

    const normalRole = await coordinator.getPageRole(normalTab.id);
    expect(normalRole.role).toBe('normal');
    expect(normalRole.primaryTabId).toBe(primaryTabId);

    const undefinedTabRole = await coordinator.getPageRole(undefined);
    expect(undefinedTabRole.role).toBe('normal');
  });

  it('承受 MV3 Background Service Worker 重啟：從 storage.session 重建 Coordinator 保留 Primary identity', async () => {
    await coordinator.openPrimary({ gameVersion: 'poe2' });

    // 模擬 Service Worker 休眠後重新實例化
    const restoredCoordinator = new LiveSearchCoordinator({
      storage,
      tabs: mockTabsApi,
      windows: mockWindowsApi,
    });

    const role = await restoredCoordinator.getPageRole(101);
    expect(role.role).toBe('live-search-primary');
    expect(role.primaryTabId).toBe(101);

    // 再次請求開啟時不建立新 Tab
    const secondOpen = await restoredCoordinator.openPrimary({ gameVersion: 'poe2' });
    expect(secondOpen.created).toBe(false);
    expect(secondOpen.tabId).toBe(101);
    expect(mockTabsApi.create).toHaveBeenCalledTimes(1);
  });

  it('Race 消除驗證：content getPageRole 即使與 Primary 建立交錯，也不會拿到 normal', async () => {
    // 攔截 tabs.create，在 tab 實體建立後但 openPrimary 尚未完成前觸發 getPageRole
    let createdPrimaryId: number | undefined;
    let pageRolePromise: Promise<any> | undefined;

    const originalCreate = mockTabsApi.create;
    mockTabsApi.create = vi.fn(async (props) => {
      const tab = await originalCreate(props);
      createdPrimaryId = tab.id;
      // 模擬新分頁之 Content Script 在 document_start 立即發送 getPageRole 查詢自己的角色
      pageRolePromise = coordinator.getPageRole(tab.id);
      return tab;
    });

    const openResult = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(openResult.success).toBe(true);
    expect(createdPrimaryId).toBeDefined();

    // 驗證交錯發出的 pageRolePromise 最終取得的必定是 live-search-primary，絕非 normal
    const roleResult = await pageRolePromise;
    expect(roleResult).toBeDefined();
    expect(roleResult.role).toBe('live-search-primary');
    expect(roleResult.primaryTabId).toBe(openResult.tabId);
  });

  it('分頁建立初期 (status: loading, url: about:blank, 帶有 pendingUrl) 絕不被誤殺為 stale ownership', async () => {
    const originalCreate = mockTabsApi.create;
    mockTabsApi.create = vi.fn(async (props) => {
      const tab = await originalCreate(props);
      // 模擬 Chromium 新建分頁初始狀態：status 為 loading，url 為空白或 about:blank，真實 URL 在 pendingUrl
      tab.url = 'about:blank';
      tab.pendingUrl = props.url;
      tab.status = 'loading';
      return tab;
    });

    const res = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(res.success).toBe(true);

    // 立即調用 resolveValidPrimaryTab，不可誤判為非 Trade 網址而被清除
    const resolved = await coordinator.resolveValidPrimaryTab();
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(res.tabId);

    // 模擬觸發 handleTabUpdated (但 status 仍為 loading，未變更至非 Trade URL)
    await coordinator.handleTabUpdated(res.tabId!, {}, resolved!);
    const stored = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeDefined();

    // 分頁載入完成 (status: complete, url 確立)
    resolved!.status = 'complete';
    resolved!.url = 'https://www.pathofexile.com/trade2';
    await coordinator.handleTabUpdated(res.tabId!, {}, resolved!);
    const storedAfterComplete = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(storedAfterComplete[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeDefined();
  });

  it('storage.set 失敗時不得留下錯誤的 canonical Primary ownership', async () => {
    const errorStorage = createInMemoryLiveSearchStorage();
    const failingCoordinator = new LiveSearchCoordinator({
      storage: {
        get: errorStorage.get,
        set: vi.fn(async () => {
          throw new Error('Storage write failed');
        }),
        remove: errorStorage.remove,
      },
      tabs: mockTabsApi,
      windows: mockWindowsApi,
    });

    const res = await failingCoordinator.openPrimary({ gameVersion: 'poe2' });
    expect(res.success).toBe(false);

    // 驗證 storage 內絕無殘留 Primary 記錄
    const stored = await errorStorage.get(LIVE_SEARCH_PRIMARY_STORAGE_KEY);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeUndefined();
  });

  it('focus/activate existing Primary 失敗時絕不清除 ownership，恢復後仍 focus 原分頁而非建立第二個 tab', async () => {
    // 1. 建立有效 Primary
    const firstRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(firstRes.success).toBe(true);
    expect(firstRes.created).toBe(true);
    const primaryId = firstRes.tabId!;
    expect(mockTabsApi.create).toHaveBeenCalledTimes(1);

    // 2. 模擬後續 tabs.update(existingPrimaryId, { active: true }) 拋錯
    const originalUpdate = mockTabsApi.update;
    mockTabsApi.update = vi.fn(async () => {
      throw new Error('Temporary tab focus failed');
    });

    const failingFocusRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    // open request 可回報失敗
    expect(failingFocusRes.success).toBe(false);
    expect(failingFocusRes.error).toContain('Temporary tab focus failed');

    // 3. 驗證 storage.session 中原 Primary ownership 必須仍存在！
    const stored = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY,
    );
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeDefined();
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]?.tabId).toBe(primaryId);

    // 4. 下一次恢復正常後再次 open，必須 focus 原本 Primary，而不是建立第二個 tab
    mockTabsApi.update = originalUpdate;
    const secondOpen = await coordinator.openPrimary({ gameVersion: 'poe2' });
    expect(secondOpen.success).toBe(true);
    expect(secondOpen.created).toBe(false);
    expect(secondOpen.tabId).toBe(primaryId);

    // 驗證全過程只建立過 1 個 tab，沒有建立第二個 tab
    expect(mockTabsApi.create).toHaveBeenCalledTimes(1);
  });

  it('handleTabUpdated: non-Trade URL clears ownership, whereas reload / eligible Trade URL retains ownership', async () => {
    const res = await coordinator.openPrimary({ gameVersion: 'poe2' });
    const primaryId = res.tabId!;

    // 1. Reload / eligible Trade URL update -> ownership 保留
    await coordinator.handleTabUpdated(primaryId, {
      url: 'https://www.pathofexile.com/trade2/search/poe2/Standard',
    });
    let stored = await storage.get<LiveSearchPrimaryStorageRecord>(LIVE_SEARCH_PRIMARY_STORAGE_KEY);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeDefined();
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]?.tabId).toBe(primaryId);

    // 2. 導航至非 Trade URL (例如 google.com 或 poe 官網首頁) -> ownership 清除
    await coordinator.handleTabUpdated(primaryId, { url: 'https://www.google.com' });
    stored = await storage.get<LiveSearchPrimaryStorageRecord>(LIVE_SEARCH_PRIMARY_STORAGE_KEY);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY]).toBeUndefined();
  });

  it('Per-Version Console: PoE1 與 PoE2 可同時各自擁有獨立的線上搜尋主控台分頁，互不覆蓋、互不搶焦點', async () => {
    const poe1Res = await coordinator.openPrimary({
      gameVersion: 'poe1',
    });
    const poe2Res = await coordinator.openPrimary({
      gameVersion: 'poe2',
    });

    expect(poe1Res.success).toBe(true);
    expect(poe1Res.created).toBe(true);
    expect(poe2Res.success).toBe(true);
    expect(poe2Res.created).toBe(true);
    expect(poe1Res.tabId).not.toBe(poe2Res.tabId);

    const stored = await storage.get<LiveSearchPrimaryStorageRecord>([
      LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1,
      LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2,
    ]);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1]?.tabId).toBe(poe1Res.tabId);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1]?.gameVersion).toBe('poe1');
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2]?.tabId).toBe(poe2Res.tabId);
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2]?.gameVersion).toBe('poe2');

    // 再次開啟 PoE1 只 focus PoE1 主控台
    const poe1Reopen = await coordinator.openPrimary({ gameVersion: 'poe1' });
    expect(poe1Reopen.created).toBe(false);
    expect(poe1Reopen.tabId).toBe(poe1Res.tabId);

    // getPageRole 依版本判定
    const rolePoe1OnPoe1Tab = await coordinator.getPageRole(poe1Res.tabId, 'poe1');
    expect(rolePoe1OnPoe1Tab.role).toBe('live-search-primary');
    const rolePoe2OnPoe1Tab = await coordinator.getPageRole(poe1Res.tabId, 'poe2');
    expect(rolePoe2OnPoe1Tab.role).toBe('normal');

    // 關閉 PoE1 主控台不影響 PoE2 主控台
    await coordinator.handleTabRemoved(poe1Res.tabId!);
    const afterClose = await storage.get<LiveSearchPrimaryStorageRecord>([
      LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1,
      LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2,
    ]);
    expect(afterClose[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1]).toBeUndefined();
    expect(afterClose[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2]?.tabId).toBe(poe2Res.tabId);
  });

  it('Compare-and-Clear: 過期的 invalidatePrimarySession(staleTabId) 絕不誤刪新建立的 Primary ownership', async () => {
    const firstRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
    const staleTabId = firstRes.tabId!;

    // 模擬已切換至新 Primary tab 202
    tabsDb.set(202, {
      id: 202,
      url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/new',
      windowId: 1,
    });
    await storage.set({
      [LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2]: {
        tabId: 202,
        createdAt: Date.now(),
        lastKnownUrl: 'https://www.pathofexile.com/trade2/search/poe2/Standard/new',
        gameVersion: 'poe2',
      },
    });

    await coordinator.invalidatePrimarySession(staleTabId, '舊分頁失效', 'poe2');

    const stored = await storage.get<LiveSearchPrimaryStorageRecord>(
      LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2,
    );
    expect(stored[LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2]?.tabId).toBe(202);
  });

  describe('Primary Arrival Feedback Presentation Signals', () => {
    it('保護 existing-primary focus 與 newly-created-primary 都能送出一次 arrival signal', async () => {
      const arrivalSignals: Array<{ tabId: number; timestamp: number }> = [];
      coordinator.setArrivalNotifier((tabId, signal) => {
        arrivalSignals.push({ tabId, timestamp: signal.timestamp });
      });

      // 1. newly-created-primary 建立時送出一次 arrival signal
      const createRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
      expect(createRes.success).toBe(true);
      expect(createRes.created).toBe(true);
      expect(createRes.tabId).toBe(101);
      expect(arrivalSignals).toHaveLength(1);
      expect(arrivalSignals[0].tabId).toBe(101);
      expect(typeof arrivalSignals[0].timestamp).toBe('number');

      // 2. existing-primary focus 時也送出一次 arrival signal
      const focusRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
      expect(focusRes.success).toBe(true);
      expect(focusRes.created).toBe(false);
      expect(focusRes.tabId).toBe(101);
      expect(arrivalSignals).toHaveLength(2);
      expect(arrivalSignals[1].tabId).toBe(101);
    });

    it('非 action-driven reload 不會自行觸發 arrival signal', async () => {
      // 透過 action 建立主控台
      const createRes = await coordinator.openPrimary({ gameVersion: 'poe2' });
      const primaryTabId = createRes.tabId!;

      // 新建立分頁初次啟動時查詢 getPageRole，消費一次性 arrivalSignal
      const firstRoleRes = await coordinator.getPageRole(primaryTabId, 'poe2');
      expect(firstRoleRes.role).toBe('live-search-primary');
      expect(firstRoleRes.arrivalSignal).toBe(true);

      // 非 action-driven reload (例如使用者按 F5 重整)：再次查詢 getPageRole 絕不再回傳 arrivalSignal
      const reloadRoleRes = await coordinator.getPageRole(primaryTabId, 'poe2');
      expect(reloadRoleRes.role).toBe('live-search-primary');
      expect(reloadRoleRes.arrivalSignal).toBeUndefined();

      // 普通 non-primary tab 查詢 getPageRole 絕不包含 arrivalSignal
      const normalTabRole = await coordinator.getPageRole(999, 'poe2');
      expect(normalTabRole.role).toBe('normal');
      expect(normalTabRole.arrivalSignal).toBeUndefined();
    });
  });

  describe('Primary Console Bootstrap URL 契約', () => {
    it('從 /trade2/search/poe2/<league>/<searchId> 開啟 PoE2 Primary → create URL 為 /trade2', async () => {
      const res = await coordinator.openPrimary(
        { gameVersion: 'poe2' },
        { tab: { url: 'https://www.pathofexile.com/trade2/search/poe2/Settlers/abc12345' } },
      );
      expect(res.success).toBe(true);
      expect(res.created).toBe(true);
      expect(mockTabsApi.create).toHaveBeenCalledWith({
        url: 'https://www.pathofexile.com/trade2',
        active: true,
      });
    });

    it('從 /trade/search/<league>/<searchId> 開啟 PoE1 Primary → create URL 為 /trade', async () => {
      const res = await coordinator.openPrimary(
        { gameVersion: 'poe1' },
        { tab: { url: 'https://www.pathofexile.com/trade/search/Standard/def67890' } },
      );
      expect(res.success).toBe(true);
      expect(res.created).toBe(true);
      expect(mockTabsApi.create).toHaveBeenCalledWith({
        url: 'https://www.pathofexile.com/trade',
        active: true,
      });
    });

    it('.tw origin 仍維持 .tw 且載入對應 Trade root', async () => {
      const res = await coordinator.openPrimary(
        { gameVersion: 'poe2' },
        { tab: { url: 'https://pathofexile.tw/trade2/search/poe2/Standard/tw12345' } },
      );
      expect(res.success).toBe(true);
      expect(res.created).toBe(true);
      expect(mockTabsApi.create).toHaveBeenCalledWith({
        url: 'https://pathofexile.tw/trade2',
        active: true,
      });
    });

    it('existing Primary 仍只 focus，不被重新導航', async () => {
      const firstRes = await coordinator.openPrimary(
        { gameVersion: 'poe2' },
        { tab: { url: 'https://www.pathofexile.com/trade2/search/poe2/Settlers/abc12345' } },
      );
      expect(firstRes.created).toBe(true);
      expect(mockTabsApi.create).toHaveBeenCalledTimes(1);

      // 再次開啟同版本 Primary，即使 sender 帶有不同 search URL
      const secondRes = await coordinator.openPrimary(
        { gameVersion: 'poe2' },
        { tab: { url: 'https://www.pathofexile.com/trade2/search/poe2/Hardcore/xyz99999' } },
      );
      expect(secondRes.success).toBe(true);
      expect(secondRes.created).toBe(false);
      expect(secondRes.tabId).toBe(firstRes.tabId);
      // create 仍只有 1 次，update 僅更新 active，不更新 url
      expect(mockTabsApi.create).toHaveBeenCalledTimes(1);
      expect(mockTabsApi.update).toHaveBeenCalledWith(firstRes.tabId, { active: true });
    });
  });

  describe('Normal Page Background Push-to-Console (enqueueConnections & consumePendingEnqueue)', () => {
    it('when Primary tab is not open, creates Primary tab in background (active: false) and buffers items until consumePendingEnqueue', async () => {
      const enqueueRes = await coordinator.enqueueConnections(
        {
          gameVersion: 'poe1',
          items: [
            {
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpush_bg_1',
              name: '背景派送項目 1',
            },
          ],
        },
        { tab: { url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpush_bg_1' } },
      );

      expect(enqueueRes.success).toBe(true);
      expect(enqueueRes.created).toBe(true);
      expect(enqueueRes.addedCount).toBe(1);
      expect(mockTabsApi.create).toHaveBeenCalledWith({
        url: 'https://www.pathofexile.com/trade',
        active: false,
      });

      // Primary tab initializes and consumes pending queue
      const consumed = await coordinator.consumePendingEnqueue(undefined, 'poe1');
      expect(consumed.items).toEqual([
        {
          url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpush_bg_1',
          name: '背景派送項目 1',
        },
      ]);

      // Subsequent consume is empty (one-shot consumption)
      expect((await coordinator.consumePendingEnqueue(undefined, 'poe1')).items).toEqual([]);
    });

    it('when Primary tab is already open, forwards items directly via enqueueForwarder without stealing focus', async () => {
      const openRes = await coordinator.openPrimary({ gameVersion: 'poe1' });
      const primaryTabId = openRes.tabId!;
      vi.mocked(mockTabsApi.update).mockClear();

      const forwardedCalls: Array<{ tabId: number; items: any[] }> = [];
      coordinator.setEnqueueForwarder(async (tabId, items) => {
        forwardedCalls.push({ tabId, items: [...items] });
        return {
          success: true,
          addedCount: items.length,
          skippedCount: 0,
        };
      });

      const enqueueRes = await coordinator.enqueueConnections({
        gameVersion: 'poe1',
        items: [
          {
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpush_direct_1',
            name: '直接派送項目',
          },
        ],
      });

      expect(enqueueRes.success).toBe(true);
      expect(enqueueRes.created).toBe(false);
      expect(enqueueRes.addedCount).toBe(1);
      expect(forwardedCalls).toHaveLength(1);
      expect(forwardedCalls[0].tabId).toBe(primaryTabId);
      // Must NOT focus or activate the Primary tab when pushing in background
      expect(mockTabsApi.update).not.toHaveBeenCalled();
    });
  });
});
