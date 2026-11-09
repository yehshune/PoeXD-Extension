import { describe, it, expect, vi } from 'vitest';
import {
  createLiveSearchSourceController,
  type LiveSearchBookmarkSourcePort,
  type LiveSearchSourceController,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import {
  createLiveSearchResumeController,
  type LiveSearchResumeController,
  type LiveSearchResumeSnapshot,
} from '@/entrypoints/content/logic/live-search-resume-controller';
import {
  createLiveSearchResumeStore,
  type LiveSearchResumeStorage,
} from '@/utils/live-search-resume-store';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';
import type {
  LiveSearchPrimaryController,
  LiveSearchSubscription,
} from '@/utils/live-search-contract';
import type { BookmarkCollectionView } from '@/utils/bookmark-coordinator';

function createMockResumeStorage(
  initialData: Record<string, unknown> = {},
): LiveSearchResumeStorage & {
  store: Record<string, unknown>;
} {
  const store = { ...initialData };
  return {
    store,
    async get(keys: readonly string[]) {
      const res: Record<string, unknown> = {};
      for (const k of keys) {
        if (store[k] !== undefined) {
          res[k] = JSON.parse(JSON.stringify(store[k]));
        }
      }
      return res;
    },
    async set(values: Record<string, unknown>) {
      for (const [k, v] of Object.entries(values)) {
        store[k] = JSON.parse(JSON.stringify(v));
      }
    },
    async remove(keys: readonly string[]) {
      for (const k of keys) {
        delete store[k];
      }
    },
  };
}

function createMockBookmarkSource(initialBookmarks: any[] = []): LiveSearchBookmarkSourcePort & {
  setBookmarks(bookmarks: any[]): void;
  triggerError(msg: string): void;
} {
  let bookmarks = [...initialBookmarks];
  let errorMsg: string | null = null;
  const listeners = new Set<() => void>();

  return {
    async readCollection() {
      if (errorMsg) {
        return {
          ok: false,
          error: { code: 'storage-failure', message: errorMsg },
        };
      }
      const view: BookmarkCollectionView = {
        groups: [
          {
            id: 'g1',
            gameVersion: 'poe1',
            name: '預設書籤',
            order: 0,
          },
        ],
        bookmarks,
      };
      return { ok: true, value: view };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setBookmarks(newBookmarks) {
      errorMsg = null;
      bookmarks = [...newBookmarks];
      listeners.forEach((l) => l());
    },
    triggerError(msg) {
      errorMsg = msg;
      listeners.forEach((l) => l());
    },
  };
}

function createMockPrimaryController(
  initialSubs: LiveSearchSubscription[] = [],
): LiveSearchPrimaryController & {
  subscriptions: LiveSearchSubscription[];
  addCalls: string[];
  removeCalls: string[];
  setRuntimeLeague(league: string | null): void;
} {
  const subscriptions = [...initialSubs];
  const listeners = new Set<(snap: any) => void>();
  let runtimeLeague: string | null = subscriptions.length > 0 ? subscriptions[0].league : null;
  const addCalls: string[] = [];
  const removeCalls: string[] = [];

  function getSnapshot(): Readonly<LiveSearchPrimaryViewSnapshot> {
    return {
      gameVersion: 'poe1',
      runtimeLeague,
      cumulativeRenderedTotal: 0,
      subscriptions: [...subscriptions],
      rateLimit: null as any,
    };
  }

  function notify() {
    const snap = getSnapshot();
    listeners.forEach((l) => l(snap));
  }

  return {
    subscriptions,
    addCalls,
    removeCalls,
    setRuntimeLeague(l) {
      runtimeLeague = l;
      notify();
    },
    read() {
      return getSnapshot();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async addFromUrl(url: string, options?: { name?: string; sourceBookmarkId?: string }) {
      addCalls.push(url);
      const parts = url.split('/');
      const searchId = parts[parts.length - 1];
      const league = parts[parts.length - 2] || 'standard';

      if (url.includes('H4sIfail-this-search')) {
        return { success: false, error: '模擬連線失敗' };
      }

      if (!runtimeLeague) {
        runtimeLeague = league;
      }

      const newSub: LiveSearchSubscription = {
        id: `sub_${Date.now()}_${Math.random()}`,
        name: options?.name || '搜尋',
        url,
        gameVersion: 'poe1',
        league,
        searchId,
        status: 'active',
        sourceBookmarkId: options?.sourceBookmarkId,
        createdAt: Date.now(),
      };
      subscriptions.push(newSub);
      notify();
      return { success: true, subscription: newSub };
    },
    retry(subscriptionId: string) {
      return { success: true };
    },
    remove(subscriptionId: string) {
      removeCalls.push(subscriptionId);
      const idx = subscriptions.findIndex((s) => s.id === subscriptionId);
      if (idx !== -1) {
        subscriptions.splice(idx, 1);
        if (subscriptions.length === 0) {
          runtimeLeague = null;
        }
        notify();
      }
    },
    async teardownAll() {
      subscriptions.length = 0;
      runtimeLeague = null;
      notify();
    },
  };
}

async function getStorePlan(store: LiveSearchResumeStore): Promise<LiveSearchResumePlanData> {
  const res = await store.read();
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

describe('LiveSearch Resume Controller & Integration', () => {
  it('1. Bookmark Enable 成功加入 Resume Plan，Enable 失敗不加入', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '好弓',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow123',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '失敗項目',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIfail-this-search',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 初始 resume plan 應為空
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(0);

    // 啟用 b1 成功
    const out1 = await sourceController.enable('b1');
    expect(out1.success).toBe(true);

    const plan1 = await getStorePlan(resumeStore);
    expect(plan1.identities).toHaveLength(1);
    expect(plan1.identities[0]).toEqual({
      gameVersion: 'poe1',
      league: 'standard',
      searchId: 'H4sIbow123',
    });

    // 啟用 b2 失敗（未建立 subscription）
    const out2 = await sourceController.enable('b2');
    expect(out2.success).toBe(false);

    // Resume plan 仍只應有 b1
    const plan2 = await getStorePlan(resumeStore);
    expect(plan2.identities).toHaveLength(1);
    expect(plan2.identities[0].searchId).toBe('H4sIbow123');
  });

  it('2. 本次連線暫停 (stop) 保留於 Resume Plan，僅在明確移除 (removeSessionConnection) 時才從 Resume Plan 移除', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '好弓',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow123',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    await sourceController.enable('b1');
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(1);

    // 暫停連線：仍留在「本次連線」清單內，因此保留於 Resume Plan（下次打開主控台時顯示於上次連線）
    sourceController.stop('b1');
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(1);

    // 明確從「本次連線」移除：才從 Resume Plan 刪除
    sourceController.removeSessionConnection!('b1');
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(0);
  });

  it('3. 自訂搜尋網址 (addCustom) 加入本次連線時一併持久化至 Resume Plan，暫停時保留，移除時刪除', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b_existing',
        name: '既有書籤',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIexisting-plan',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 先在 plan 存一筆既有的
    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIexisting-plan' },
    ]);

    // 新增自訂搜尋網址
    const out = await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sItemp123',
      { name: '自訂搜尋1' },
    );
    expect(out.success).toBe(true);

    // Plan 同時保留既有待恢復項目與本次新增的自訂搜尋（含 name 與 url）
    let plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(2);
    expect(plan.identities.map((i) => i.searchId)).toEqual(['H4sIexisting-plan', 'H4sItemp123']);
    expect(plan.identities[1].name).toBe('自訂搜尋1');

    // 暫停自訂搜尋：仍留在本次連線，Resume Plan 保持 2 筆
    const snap = sourceController.read();
    const tempItem = snap.sessionConnections![0];
    sourceController.stop(tempItem.id);

    plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(2);

    // 從本次連線移除自訂搜尋：從 Resume Plan 移除，只剩既有待恢復項目
    sourceController.removeSessionConnection!(tempItem.id);
    plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(1);
    expect(plan.identities[0].searchId).toBe('H4sIexisting-plan');
  });

  it('4. Bookmark 刪除 / Canonical 修改時 Authoritative Prune', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    // 初始 Plan 有 A, B
    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIsearchA' },
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIsearchB' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'bA',
        name: '搜尋A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearchA',
        groupId: 'g1',
      },
      {
        id: 'bB',
        name: '搜尋B',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearchB',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 等待初始讀取
    await new Promise((r) => setTimeout(r, 50));
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(2);

    // 外部刪除 B，剩 A
    bookmarkSource.setBookmarks([
      {
        id: 'bA',
        name: '搜尋A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearchA',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // B 應被 prune
    const plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(1);
    expect(plan.identities[0].searchId).toBe('H4sIsearchA');
  });

  it('5. Temporary -> Bookmark Promotion 時保留於 Resume Plan 且零重複連線', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 1. 新增 active 自訂搜尋（已進入 Resume Plan）
    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIpromo123',
    );
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(1);

    // 2. 外部新增匹配的書籤
    bookmarkSource.setBookmarks([
      {
        id: 'b_promo',
        name: '正式書籤',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIpromo123',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // 保留於 Resume Plan 且零 reconnect
    const plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(1);
    expect(plan.identities[0].searchId).toBe('H4sIpromo123');
    expect(liveController.addCalls).toHaveLength(1); // 零多餘 add/reconnect
  });

  it('6. Fresh Runtime 啟動時 subscriptions = [] 絕不覆蓋清空 Resume Plan', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    // 預先在 storage 存在 Plan
    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIkeepMe' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b_keep',
        name: '保留',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIkeepMe',
        groupId: 'g1',
      },
    ]);
    // 新建 console，此時 runtime subscriptions 為空
    const liveController = createMockPrimaryController([]);
    createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));

    // Plan 絕對不得被清空
    const plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(1);
    expect(plan.identities[0].searchId).toBe('H4sIkeepMe');
  });

  it('7. Prompt 模式：可恢復項目出現提示橫幅，點恢復呼叫 enableMany，點略過本次不提示且保留 Plan', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    // 存入 3 筆，其中 2 筆在書籤中存在
    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' },
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem2' },
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIdeletedItem' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '項目2',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem2',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    // 等待初始讀取與決策
    await new Promise((r) => setTimeout(r, 50));

    const snap = resumeController.read();
    expect(snap.state).toBe('prompted');
    expect(snap.bannerVisible).toBe(true);
    expect(snap.resumableCount).toBe(2);
    expect(snap.resumableSourceIds).toEqual(['b1', 'b2']);

    // 點擊恢復
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');
    const outcome = await resumeController.restore();
    expect(outcome?.success).toBe(true);
    expect(enableManySpy).toHaveBeenCalledTimes(1);
    expect(enableManySpy).toHaveBeenCalledWith(['b1', 'b2']);

    expect(resumeController.read().state).toBe('restored');
    expect(resumeController.read().bannerVisible).toBe(false);
    expect(resumeController.read().resumableCount).toBe(0);
    expect(resumeController.read().resumableSourceIds).toEqual([]);
  });

  it('8. Prompt 模式略過：點擊略過後不再提示，但 Plan 保持不變', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeController.read().bannerVisible).toBe(true);

    // 點擊略過
    resumeController.skip();
    expect(resumeController.read().bannerVisible).toBe(false);
    expect(resumeController.read().state).toBe('skipped');

    // Plan 不變
    const plan = await getStorePlan(resumeStore);
    expect(plan.identities).toHaveLength(1);
    expect(plan.identities[0].searchId).toBe('H4sIitem1');
  });

  it('9. Auto 模式：資料就緒後自動恢復一次，後續 source snapshot 更新不重複觸發', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIauto1' },
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIauto2' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIauto1',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '項目2',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIauto2',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'auto',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(enableManySpy).toHaveBeenCalledTimes(1);
    expect(enableManySpy).toHaveBeenCalledWith(['b1', 'b2']);
    expect(resumeController.read().state).toBe('restored');
    expect(resumeController.read().resumableCount).toBe(0);
    expect(resumeController.read().resumableSourceIds).toEqual([]);

    // 再次觸發 snapshot 更新
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIauto1',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '項目2',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIauto2',
        groupId: 'g1',
      },
      {
        id: 'b3',
        name: '新項目',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sInew3',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // 絕不重複 auto restore
    expect(enableManySpy).toHaveBeenCalledTimes(1);
  });

  it('10. Off (清理) 模式：重新開啟主控台時自動清空上次連線紀錄與 previousConnections，不自動恢復', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIoff1' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIoff1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'off',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(enableManySpy).not.toHaveBeenCalled();
    expect(resumeController.read().bannerVisible).toBe(false);
    expect(resumeController.read().state).toBe('off');
    expect(resumeController.read().resumableCount).toBe(0);
    expect(resumeController.read().hasPersistedPlan).toBe(false);
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(0);
    expect(sourceController.read().previousConnections ?? []).toHaveLength(0);
  });

  it('11. Initial Bookmark Read Failure 絕不 prune、不 restore，後續成功取得後正常決策', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIdefendMe' },
    ]);

    const bookmarkSource = createMockBookmarkSource([]);
    // 初始模擬書籤讀取失敗
    bookmarkSource.triggerError('網絡異常');

    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));

    // 不得 prune，不得提示「0項可恢復」
    expect((await getStorePlan(resumeStore)).identities).toHaveLength(1);
    expect(resumeController.read().bannerVisible).toBe(false);
    expect(resumeController.read().state).toBe('waiting');
    expect(enableManySpy).not.toHaveBeenCalled();

    // 後續成功恢復
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '防禦測試',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdefendMe',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // 成功進入一次 startup decision
    expect(resumeController.read().bannerVisible).toBe(true);
    expect(resumeController.read().resumableCount).toBe(1);
    expect(resumeController.read().state).toBe('prompted');
  });

  it('12. Restore 遇到 enableMany 失敗時正確回傳與投影 outcome，零連線', async () => {
    // 透過 mockStorage 模擬 persisted data
    const resumeStorage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 1,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIstd1' }],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b_std',
        name: 'Standard 項目',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    const mockSourceController: LiveSearchSourceController = {
      ...sourceController,
      read: () => ({
        loading: false,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        leagueResolved: true,
        groups: [
          {
            id: 'g1',
            name: '群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 'b_std',
                name: 'Standard 項目',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd1',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'standard',
                  searchId: 'H4sIstd1',
                },
                canonicalKey: 'poe1:standard:H4sIstd1',
                compatibility: 'compatible',
                groupId: 'g1',
                groupName: '群組',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      }),
      subscribe: (listener: (s: any) => void) => {
        listener(mockSourceController.read());
        return () => {};
      },
      enableMany: vi.fn().mockResolvedValue({
        success: false,
        requested: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        error: '連線失敗或逾時',
        skipReasons: {
          alreadyActive: 0,
          pending: 0,
          incompatible: 0,
          duplicateInBatch: 0,
          notFound: 0,
          inactive: 0,
        },
        incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
        runtimeFailureCount: 1,
      }),
    };

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController: mockSourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(resumeController.read().bannerVisible).toBe(true);
    expect(resumeController.read().resumableCount).toBe(1);

    // 點擊恢復 -> 觸發 enableMany 失敗
    const outcome = await resumeController.restore();
    expect(outcome?.success).toBe(false);
    expect(outcome?.failed).toBe(1);
    expect(outcome?.error).toBe('連線失敗或逾時');
    expect(liveController.subscriptions).toHaveLength(0); // 零部分建立
  });

  it('13. Clear 操作只清除該版本 Plan，不停止連線中訂閱與暫時搜尋', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 啟用書籤連線
    await sourceController.enable('b1');
    // 新增暫時搜尋
    await sourceController.addCustom('https://www.pathofexile.com/trade/search/Standard/H4sItemp1');

    expect(liveController.subscriptions).toHaveLength(2);

    const prefStorage = createInMemoryPreferencesStorage();
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;
    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeController.read().hasPersistedPlan).toBe(true);

    // 清除 Plan
    const clearResult = await resumeController.clear();
    expect(clearResult).toBe(true);

    expect((await getStorePlan(resumeStore)).identities).toHaveLength(0);
    expect(resumeController.read().hasPersistedPlan).toBe(false);
    // 連線與暫時搜尋仍保持運作
    expect(liveController.subscriptions).toHaveLength(2);
    expect(sourceController.read().groups.some((g) => g.id === 'custom_sources')).toBe(true);
  });

  it('14. [Regression] Canonical Identity Authority: 書籤改名/改URL不使用 stale ID，NEW 絕不被 enable', async () => {
    // Plan = OLD, Bookmark b1 = OLD -> prompt 出現
    const resumeStorage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 1,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIbow_old' }],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '舊弓',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow_old',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeController.read().bannerVisible).toBe(true);
    expect(resumeController.read().resumableCount).toBe(1);

    // 使用者在點擊前將 b1 URL 改成 NEW
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '新弓',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow_new',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    // 動態比對：OLD 已無任何對應書籤，橫幅消失
    expect(resumeController.read().resumableCount).toBe(0);

    // 點擊恢復
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');
    await resumeController.restore();

    // NEW 絕不得被加入/啟用，zero add NEW
    expect(enableManySpy).not.toHaveBeenCalledWith(['b1']);
    expect(liveController.subscriptions).toHaveLength(0);
    expect(liveController.addCalls.some((c) => c.includes('H4sIbow_new'))).toBe(false);
  });

  it('15. [Regression] Auto Mode Delayed-Read Race: 延遲讀取期間多次 Snapshot 到達，最終決策以最新 Snapshot 為準且 enableMany 恰好執行一次', async () => {
    let releaseGate!: () => void;
    const delayGate = new Promise<void>((r) => {
      releaseGate = r;
    });

    const storage: LiveSearchResumeStorage = {
      async get() {
        await delayGate;
        return {
          liveSearchResumePlan_poe1: {
            version: 1,
            identities: [
              { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem_a' },
              { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem_b' },
              { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem_c' },
            ],
          },
        };
      },
      async set() {},
      async remove() {},
    };

    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    // 初始 Snapshot A (只有 item_a)
    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_a',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController);
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'auto',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    const snapshots: LiveSearchResumeSnapshot[] = [];
    resumeController.subscribe((snap) => snapshots.push(snap));

    // 等待 store.read() 發起並卡在 delayGate
    await new Promise((r) => setTimeout(r, 20));

    // 延遲讀取期間，Snapshot B 到達 (增加 item_b)
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_a',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '項目B',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_b',
        groupId: 'g1',
      },
    ]);

    // 延遲讀取仍未完成時，Snapshot C 到達 (再增加 item_c)
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_a',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '項目B',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_b',
        groupId: 'g1',
      },
      {
        id: 'b3',
        name: '項目C',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_c',
        groupId: 'g1',
      },
    ]);

    // 釋放延遲閘門，讓 store.read() 完成
    releaseGate();
    await new Promise((r) => setTimeout(r, 60));

    // 1. 最終決策必須以最新 Snapshot C 為準，同時恢復 b1, b2, b3
    expect(enableManySpy).toHaveBeenCalledWith(['b1', 'b2', 'b3']);

    // 2. 明確斷言 enableMany 只呼叫一次
    expect(enableManySpy).toHaveBeenCalledTimes(1);

    // 3. 確認沒有第二次 startup decision / restore outcome 覆蓋
    // （恢復期間的投影更新可能以相同狀態重發快照，因此以「進入該狀態的次數」判斷）
    const transitions = snapshots
      .map((s) => s.state)
      .filter((state, index, states) => index === 0 || states[index - 1] !== state);
    expect(transitions.filter((state) => state === 'restoring')).toHaveLength(1);
    expect(transitions.filter((state) => state === 'restored')).toHaveLength(1);

    const finalSnap = resumeController.read();
    expect(finalSnap.state).toBe('restored');
    expect(finalSnap.resumableCount).toBe(0);
    expect(finalSnap.resumableSourceIds).toEqual([]);
    expect(finalSnap.autoRestoreOutcome?.success).toBe(true);

    // 4. 後續書籤變動絕不再觸發第二次 startup restore
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_a',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 40));
    expect(enableManySpy).toHaveBeenCalledTimes(1);
  });

  it('16. [Regression] Auto Restore 遇到啟用失敗時正確將 outcome 投影至 snapshot，不 silent', async () => {
    const resumeStorage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 1,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIstd1' }],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b_std',
        name: 'Standard',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    const mockSourceController: LiveSearchSourceController = {
      ...sourceController,
      read: () => ({
        loading: false,
        leagueResolved: true,
        selectedLeague: 'Standard',
        availableLeagues: ['Standard'],
        isSwitchingLeague: false,
        groups: [
          {
            id: 'g1',
            name: '群組',
            kind: 'bookmark',
            items: [
              {
                kind: 'bookmark',
                id: 'b_std',
                name: 'Standard',
                url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd1',
                canonicalIdentity: {
                  gameVersion: 'poe1',
                  league: 'standard',
                  searchId: 'H4sIstd1',
                },
                canonicalKey: 'poe1:standard:H4sIstd1',
                compatibility: 'compatible',
                groupId: 'g1',
                groupName: '群組',
                pending: false,
                removable: false,
              },
            ],
            bookmarks: [],
          },
        ],
      }),
      subscribe: (listener: (s: any) => void) => {
        listener(mockSourceController.read());
        return () => {};
      },
      enableMany: vi.fn().mockResolvedValue({
        success: false,
        requested: 1,
        succeeded: 0,
        skipped: 0,
        failed: 1,
        error: '伺服器拒絕連線',
        skipReasons: {
          alreadyActive: 0,
          pending: 0,
          incompatible: 0,
          duplicateInBatch: 0,
          notFound: 0,
          inactive: 0,
        },
        incompatibleBreakdown: { invalidUrl: 0, wrongVersion: 0, wrongLeague: 0 },
        runtimeFailureCount: 1,
      }),
    };

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'auto',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController: mockSourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    const snap = resumeController.read();
    expect(snap.state).toBe('restored');
    expect(snap.autoRestoreOutcome).toBeDefined();
    expect(snap.autoRestoreOutcome?.success).toBe(false);
    expect(snap.autoRestoreOutcome?.error).toBe('伺服器拒絕連線');
  });

  it('17. [Regression] Resume Plan storage 讀取失敗時：不 prune、不 prompt、不 auto restore、不標記 startup 完成', async () => {
    let getShouldFail = true;
    const storage: LiveSearchResumeStorage = {
      async get() {
        if (getShouldFail) throw new Error('Storage error');
        return {
          liveSearchResumePlan_poe1: {
            version: 1,
            identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' }],
          },
        };
      },
      async set() {},
      async remove() {},
    };

    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'auto',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 50));

    // 儲存讀取失敗：不 auto restore，不 prompt，留在 waiting
    expect(enableManySpy).not.toHaveBeenCalled();
    expect(resumeController.read().bannerVisible).toBe(false);
    expect(resumeController.read().state).toBe('waiting');

    // 儲存恢復後，下一次 snapshot 更新能成功完成 startup decision
    getShouldFail = false;
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 60));

    expect(enableManySpy).toHaveBeenCalledWith(['b1']);
    expect(resumeController.read().state).toBe('restored');
  });

  it('18. [Regression] Storage 讀取失敗並發多個 Snapshot 時不永久卡住 in-flight guard，儲存恢復後能正常決策', async () => {
    let getShouldFail = true;
    let gateRelease!: () => void;
    let gate = new Promise<void>((r) => {
      gateRelease = r;
    });

    const storage: LiveSearchResumeStorage = {
      async get() {
        await gate;
        if (getShouldFail) throw new Error('Storage down');
        return {
          liveSearchResumePlan_poe1: {
            version: 1,
            identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' }],
          },
        };
      },
      async set() {},
      async remove() {},
    };

    const resumeStore = createLiveSearchResumeStore('poe1', storage);
    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'auto',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
    const prefModule = prefOutcome.value;

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefModule,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 20));

    // 在第一次 storage read 進行期間發出第二個 Snapshot
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
      {
        id: 'b2',
        name: '項目2',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem2',
        groupId: 'g1',
      },
    ]);

    // 釋放第一次失敗的 read
    gateRelease();
    await new Promise((r) => setTimeout(r, 60));

    // 失敗結束：留在 waiting，in-flight guard 必須重置為 false
    expect(enableManySpy).not.toHaveBeenCalled();
    expect(resumeController.read().state).toBe('waiting');

    // 儲存恢復，觸發新 snapshot
    getShouldFail = false;
    gate = Promise.resolve();
    bookmarkSource.setBookmarks([
      {
        id: 'b1',
        name: '項目1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 60));

    expect(enableManySpy).toHaveBeenCalledTimes(1);
    expect(enableManySpy).toHaveBeenCalledWith(['b1']);
    expect(resumeController.read().state).toBe('restored');
  });

  it('19. [Regression] Manual League Switch: 不 auto restore、動態更新 current-league resumable projection，切回原 league 仍保留原 intents', async () => {
    // 儲存中包含 Standard (item1) 與 Hardcore (item2) 的 persisted intents
    const storage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 2,
        identities: [
          { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' },
          { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIitem2' },
        ],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'bm_std',
        name: '標準搜尋',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
      {
        id: 'bm_hc',
        name: '專家搜尋',
        url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIitem2',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'auto',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    // 1. Startup 決策 (目前為 Standard)：僅自動恢復 Standard 項目，Hardcore 絕不自動恢復
    expect(enableManySpy).toHaveBeenCalledTimes(1);
    expect(enableManySpy).toHaveBeenCalledWith(['bm_std']);
    expect(resumeController.read().state).toBe('restored');
    // bm_std 自動恢復後已進入 active/connecting 狀態，resumableCount 必須歸零
    expect(resumeController.read().resumableCount).toBe(0);
    expect(resumeController.read().resumableSourceIds).toEqual([]);

    // 2. 手動切換聯盟至 Hardcore
    enableManySpy.mockClear();
    await sourceController.switchLeague('Hardcore');
    await new Promise((r) => setTimeout(r, 60));

    // 手動切換聯盟：絕不得觸發 auto restore，banner 保持隱藏
    expect(enableManySpy).not.toHaveBeenCalled();
    const hcSnap = resumeController.read();
    expect(hcSnap.bannerVisible).toBe(false);
    // current-league resumable projection 必須即時反映 Hardcore 的可恢復項目
    expect(hcSnap.resumableCount).toBe(1);
    expect(hcSnap.resumableSourceIds).toEqual(['bm_hc']);

    // 3. 手動恢復 Hardcore 項目
    const outcome = await resumeController.restore();
    expect(enableManySpy).toHaveBeenCalledTimes(1);
    expect(enableManySpy).toHaveBeenCalledWith(['bm_hc']);
    expect(outcome?.success).toBe(true);
    // 恢復後 bm_hc 成為 active，resumableCount 歸零
    expect(resumeController.read().resumableCount).toBe(0);
    expect(resumeController.read().resumableSourceIds).toEqual([]);

    // 4. 切回 Standard 聯盟：
    // Standard 經歷 switchLeague teardown 後，bm_std 變回 inactive，
    // Standard 的 persisted intent 再次投影為可恢復項目！
    await sourceController.switchLeague('Standard');
    await new Promise((r) => setTimeout(r, 60));
    const stdSnap = resumeController.read();
    expect(stdSnap.bannerVisible).toBe(false);
    expect(stdSnap.resumableCount).toBe(1);
    expect(stdSnap.resumableSourceIds).toEqual(['bm_std']);
  });

  it('20. [Regression] Restore 執行當下重新以最新 Plan ∩ 最新 Authoritative Bookmarks 進行 canonical join（排除 stale IDs）', async () => {
    const storage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 2,
        identities: [
          { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' },
          { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem2' },
        ],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'bm1',
        name: '搜尋1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
      {
        id: 'bm2',
        name: '搜尋2',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem2',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });
    const enableManySpy = vi.spyOn(sourceController, 'enableMany');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(resumeController.read().state).toBe('prompted');
    expect(resumeController.read().resumableSourceIds).toEqual(['bm1', 'bm2']);

    // 使用者在點擊恢復前，外部刪除了 bm2
    bookmarkSource.setBookmarks([
      {
        id: 'bm1',
        name: '搜尋1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
    ]);
    await new Promise((r) => setTimeout(r, 60));

    // 執行 restore：必須動態以最新 Plan ∩ 最新 Bookmarks 執行 canonical join，絕不傳送 stale bm2
    await resumeController.restore();
    expect(enableManySpy).toHaveBeenCalledWith(['bm1']);
  });

  it('21. [Regression] Temporary Search 永不被投影到 resumableSourceIds', async () => {
    const storage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 2,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIcustom1' }],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 加入 Temporary Search (custom1)
    await sourceController.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIcustom1',
    );

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    // 即使 Plan 恰巧有同 canonical key，Temporary Search 永遠不被視為 resumable bookmark source
    expect(resumeController.read().resumableCount).toBe(0);
    expect(resumeController.read().resumableSourceIds).toEqual([]);
    expect(resumeController.read().bannerVisible).toBe(false);
  });

  it('22. [Regression] 部分 sources 已 active、部分 inactive 時只計 inactive；pending source 不列為可恢復', async () => {
    const storage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 2,
        identities: [
          { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem1' },
          { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem2' },
          { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIitem3' },
        ],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'bm1',
        name: '搜尋1',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem1',
        groupId: 'g1',
      },
      {
        id: 'bm2',
        name: '搜尋2',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem2',
        groupId: 'g1',
      },
      {
        id: 'bm3',
        name: '搜尋3',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem3',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 啟動前，bm1 已經被手動啟用（處於 active 狀態）
    await sourceController.enable('bm1');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    // bm1 已在監聽中，因此 resumable 僅計入 bm2 與 bm3 (2項)
    const snap = resumeController.read();
    expect(snap.resumableCount).toBe(2);
    expect(snap.resumableSourceIds).toEqual(['bm2', 'bm3']);

    // 若 bm2 進入 active/pending，bm2 也立即自 resumable 排除
    await sourceController.enable('bm2');
    await new Promise((r) => setTimeout(r, 60));

    const snap2 = resumeController.read();
    expect(snap2.resumableCount).toBe(1);
    expect(snap2.resumableSourceIds).toEqual(['bm3']);
  });

  it('23. [Regression] Manual restore 不對已 active source 重複呼叫 enableMany', async () => {
    const storage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 2,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIactiveItem' }],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'bm_active',
        name: '已監聽搜尋',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIactiveItem',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    // 已經處於 active 狀態
    await sourceController.enable('bm_active');

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    const enableManySpy = vi.spyOn(sourceController, 'enableMany');
    // 使用者或 UI 即使觸發了 restore，因為所有項目都已 active，不應重複呼叫 enableMany
    const outcome = await resumeController.restore();
    expect(enableManySpy).not.toHaveBeenCalled();
    expect(outcome?.requested).toBe(0);
  });

  it('24. [Regression] 單一網址連線僅有一條：當多個資料夾存在相同 canonical URL 書籤時，可恢復連線與恢復操作絕不重複列出多條', async () => {
    const storage = createMockResumeStorage({
      liveSearchResumePlan_poe1: {
        version: 2,
        identities: [{ gameVersion: 'poe1', league: 'standard', searchId: 'H4sIdupUrl1' }],
      },
    });
    const resumeStore = createLiveSearchResumeStore('poe1', storage);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'bm_folder_a',
        name: '魔血腰帶 (資料夾 A)',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdupUrl1',
        groupId: 'g1',
      },
      {
        id: 'bm_folder_b',
        name: '魔血腰帶 (資料夾 B)',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdupUrl1',
        groupId: 'g2',
      },
      {
        id: 'bm_folder_c',
        name: '魔血腰帶 (資料夾 C)',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdupUrl1/live',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
    });

    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'prompt',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    const snap = resumeController.read();
    expect(snap.resumableCount).toBe(1);
    expect(snap.resumableSourceIds).toEqual(['bm_folder_a']);

    const outcome = await resumeController.restore();
    expect(outcome?.requested).toBe(1);
    expect(outcome?.succeeded).toBe(1);
  });

  it('25. [Regression] clearPreviousConnections 與 Off (清理) 模式僅清除目前 selectedLeague 的上次連線，完整保留其他聯盟的持久化紀錄', async () => {
    const resumeStorage = createMockResumeStorage();
    const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

    await resumeStore.addIdentities([
      { gameVersion: 'poe1', league: 'standard', searchId: 'H4sIstd1', name: '標準連線' },
      { gameVersion: 'poe1', league: 'hardcore', searchId: 'H4sIhc1', name: '專家連線' },
    ]);

    const bookmarkSource = createMockBookmarkSource([
      {
        id: 'b_std',
        name: '標準連線',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd1',
        groupId: 'g1',
      },
      {
        id: 'b_hc',
        name: '專家連線',
        url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc1',
        groupId: 'g1',
      },
    ]);
    const liveController = createMockPrimaryController();
    const prefStorage = createInMemoryPreferencesStorage({
      liveSearchResumeMode_poe1: 'off',
      liveSearchSelectedLeague_poe1: 'Standard',
    });
    const prefOutcome = await createPreferencesModule('poe1', prefStorage);
    if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);

    const sourceController = createLiveSearchSourceController(bookmarkSource, liveController, {
      resumeStore,
      preferences: prefOutcome.value,
    });

    const resumeController = createLiveSearchResumeController({
      version: 'poe1',
      preferences: prefOutcome.value,
      sourceController,
      resumeStore,
    });

    await new Promise((r) => setTimeout(r, 60));

    // Standard 的上次連線已被清理，但 Hardcore 的持久化紀錄必須完整保留
    expect(sourceController.read().previousConnections ?? []).toHaveLength(0);
    const planAfterOff = await getStorePlan(resumeStore);
    expect(planAfterOff.identities).toHaveLength(1);
    expect(planAfterOff.identities[0].league).toBe('hardcore');
    expect(planAfterOff.identities[0].searchId).toBe('H4sIhc1');
    expect(resumeController.read().hasPersistedPlan).toBe(true);
  });
});
