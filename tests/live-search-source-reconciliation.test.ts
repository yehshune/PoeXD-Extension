// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import {
  createLiveSearchSourceController,
  CUSTOM_SOURCE_GROUP_ID,
  CUSTOM_SOURCE_GROUP_NAME,
  TEMPORARY_SOURCE_GROUP_ID,
  TEMPORARY_SOURCE_GROUP_NAME,
  type LiveSearchBookmarkSourcePort,
  type LiveSearchSourceController,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import type {
  EnsureContainerOptions,
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
  ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';

class FakeWebSocket {
  public url: string;
  public onopen: ((ev: Event) => void) | null = null;
  public onerror: ((ev: Event) => void) | null = null;
  public onclose: ((ev: CloseEvent) => void) | null = null;
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public readyState = 0;
  public closed = false;

  constructor(url: string) {
    this.url = url;
  }

  public triggerOpen(): void {
    if (this.onopen && !this.closed) {
      this.readyState = 1;
      this.onopen(new Event('open'));
    }
  }

  public triggerClose(): void {
    if (this.onclose && !this.closed) {
      this.readyState = 3;
      this.closed = true;
      this.onclose(new CloseEvent('close'));
    }
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

class FakeHostClient implements ILiveSearchHostClient {
  public ensureCalls: EnsureContainerOptions[] = [];
  public disposed = false;

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    this.ensureCalls.push(options);
    return { success: true };
  }

  public async renderResult(_options: RenderResultOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }

  public async resetUnread(_options: ResetUnreadOptions): Promise<HostCommandOutcome> {
    return { success: true };
  }

  public dispose(): void {
    this.disposed = true;
  }
}

class FakeBookmarkSource implements LiveSearchBookmarkSourcePort {
  public collection: BookmarkCollectionView = {
    groups: [{ id: 'group_1', name: '常用星團', order: 0 } as any],
    bookmarks: [
      {
        id: 'bmk_1',
        name: '巨型星團 A',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcluster_shared',
        groupId: 'group_1',
        searchRecordId: 'rec_1',
        gameVersion: 'poe1',
        order: 0,
      },
      {
        id: 'bmk_hh',
        name: '獵首皮帶',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh',
        groupId: 'group_1',
        searchRecordId: 'rec_2',
        gameVersion: 'poe1',
        order: 1,
      },
    ],
  };

  private listeners = new Set<() => void>();

  public async readCollection(): Promise<BookmarkReadOutcome<BookmarkCollectionView>> {
    return { ok: true, value: JSON.parse(JSON.stringify(this.collection)) };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public triggerChange(): void {
    this.listeners.forEach((l) => l());
  }
}

describe('LiveSearch Temporary Search + Bookmark Reconciliation Phase Tests', () => {
  let createdSockets: FakeWebSocket[];
  let hostClient: FakeHostClient;
  let scheduler: LiveSearchOpenScheduler;
  let runtime: LiveSearchPrimaryRuntime;
  let liveController: ReturnType<typeof createLiveSearchPrimaryController>;
  let bookmarkSource: FakeBookmarkSource;
  let sourceCtrl: LiveSearchSourceController;

  beforeEach(async () => {
    createdSockets = [];
    hostClient = new FakeHostClient();
    scheduler = new LiveSearchOpenScheduler({
      cooldownMs: 0,
    });
    runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      openScheduler: scheduler,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        createdSockets.push(ws);
        return ws as unknown as WebSocket;
      },
      reconnectPolicy: {
        baseDelayMs: 10,
        maxDelayMs: 50,
        maxFailedAttempts: 2,
      },
    });
    liveController = createLiveSearchPrimaryController(runtime);
    bookmarkSource = new FakeBookmarkSource();
    sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
    await new Promise((r) => setTimeout(r, 20));
  });

  // 1. Active Bookmark Delete
  it('1. Active Bookmark Delete: falls back to Temporary Search without stopping, recreating, or reconnecting Runtime subscription', async () => {
    // 啟用 bmk_1
    const enableRes = await sourceCtrl.enable('bmk_1');
    expect(enableRes.success).toBe(true);
    createdSockets[0].triggerOpen();

    const initialSubs = runtime.getSubscriptions();
    expect(initialSubs).toHaveLength(1);
    const originSubId = initialSubs[0].id;
    expect(createdSockets).toHaveLength(1);

    // Spy on runtime methods
    const removeSpy = vi.spyOn(runtime, 'removeSubscription');
    const addSpy = vi.spyOn(runtime, 'addSubscription');

    // 一般 Trade 分頁刪除 Bookmark bmk_1
    bookmarkSource.collection.bookmarks = bookmarkSource.collection.bookmarks.filter(
      (b) => b.id !== 'bmk_1',
    );
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    const snap = sourceCtrl.read();

    // 驗證：Bookmark bmk_1 已從書籤群組消失
    const bmkGroup = snap.groups.find((g) => g.id === 'group_1');
    expect(bmkGroup?.items.find((i) => i.id === 'bmk_1')).toBeUndefined();

    // 驗證：出現在「暫時搜尋」群組，狀態仍為 active
    const tempGroup = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID);
    expect(tempGroup).toBeDefined();
    expect(tempGroup?.name).toBe('暫時搜尋');
    expect(tempGroup?.items).toHaveLength(1);

    const fallbackItem = tempGroup!.items[0];
    expect(fallbackItem.kind).toBe('custom');
    expect(fallbackItem.name).toBe('巨型星團 A');
    expect(fallbackItem.status).toBe('active');
    expect(fallbackItem.subscriptionId).toBe(originSubId);
    expect(fallbackItem.removable).toBe(true);
    expect(fallbackItem.provenance).toBe('origin-bookmark-removed');
    expect(fallbackItem.provenanceMessage).toBe('來源書籤已移除');

    // 核心驗證：Runtime subscription 保持不變，零 remove, 零 add, 零額外 WebSocket
    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(runtime.getSubscriptions()[0].id).toBe(originSubId);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
    expect(createdSockets).toHaveLength(1);

    sourceCtrl.dispose();
  });

  // 2. Active Bookmark URL Change
  it('2. Active Bookmark URL Change: old canonical stays active in Temporary Search, new canonical in Bookmark is inactive', async () => {
    // 啟用 bmk_hh (Standard/search_hh)
    const enableRes = await sourceCtrl.enable('bmk_hh');
    expect(enableRes.success).toBe(true);
    createdSockets[0].triggerOpen();

    const originSubId = runtime.getSubscriptions()[0].id;

    // 一般頁將 bmk_hh 修改為全新 canonical (Standard/search_mageblood)
    const bmkHh = bookmarkSource.collection.bookmarks.find((b) => b.id === 'bmk_hh')!;
    bmkHh.url = 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_mageblood';
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    const snap = sourceCtrl.read();

    // 驗證：Bookmark 群組中的 bmk_hh 已更新為 new canonical，且未啟用
    const bmkGroup = snap.groups.find((g) => g.id === 'group_1')!;
    const updatedBmk = bmkGroup.items.find((i) => i.id === 'bmk_hh')!;
    expect(updatedBmk.canonicalIdentity?.searchId).toBe('H4sIsearch_mageblood');
    expect(updatedBmk.status).toBeUndefined();

    // 驗證：舊的 old canonical active connection 轉由「暫時搜尋」承接
    const tempGroup = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!;
    expect(tempGroup.items).toHaveLength(1);
    const oldTempItem = tempGroup.items[0];
    expect(oldTempItem.canonicalIdentity?.searchId).toBe('H4sIsearch_hh');
    expect(oldTempItem.status).toBe('active');
    expect(oldTempItem.subscriptionId).toBe(originSubId);
    expect(oldTempItem.provenance).toBe('origin-bookmark-removed');

    // 舊 subscription entity 與 WebSocket 不變
    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(runtime.getSubscriptions()[0].id).toBe(originSubId);
    expect(runtime.getSubscriptions()[0].searchId).toBe('H4sIsearch_hh');
    expect(createdSockets).toHaveLength(1);

    sourceCtrl.dispose();
  });

  // 3. Rename / Move
  it('3. Rename / Move: active Bookmark canonical unchanged only updates name and group, does NOT create Temporary Search', async () => {
    // 啟用 bmk_1
    await sourceCtrl.enable('bmk_1');
    createdSockets[0].triggerOpen();

    // 改名並移動到新群組 group_new
    bookmarkSource.collection.groups.push({ id: 'group_new', name: '頂級星團', order: 1 } as any);
    const bmk1 = bookmarkSource.collection.bookmarks.find((b) => b.id === 'bmk_1')!;
    bmk1.name = '完美巨型星團';
    bmk1.groupId = 'group_new';
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    const snap = sourceCtrl.read();

    // 驗證：仍為 Bookmark Source，無 Temporary Search 群組
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();

    const newGroup = snap.groups.find((g) => g.id === 'group_new')!;
    expect(newGroup).toBeDefined();
    const item = newGroup.items.find((i) => i.id === 'bmk_1')!;
    expect(item).toBeDefined();
    expect(item.name).toBe('完美巨型星團');
    expect(item.status).toBe('active');

    // Runtime subscription 保持同一連線
    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(createdSockets).toHaveLength(1);

    sourceCtrl.dispose();
  });

  // 4. Temporary -> Bookmark Promotion
  it('4. Temporary -> Bookmark Promotion: promotes active Temporary Search to Bookmark without reconnecting', async () => {
    // 手動新增一筆非書籤的暫時搜尋
    const addRes = await sourceCtrl.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_mageblood',
      { name: '暫時魔血' },
    );
    expect(addRes.success).toBe(true);
    createdSockets[0].triggerOpen();

    let snap = sourceCtrl.read();
    const tempGroup = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!;
    expect(tempGroup.items).toHaveLength(1);
    const tempSubId = tempGroup.items[0].subscriptionId;

    // 一般頁隨後新增一個相同 canonical identity 的 Bookmark
    bookmarkSource.collection.bookmarks.push({
      id: 'bmk_mb',
      name: '持久魔血書籤',
      url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_mageblood',
      groupId: 'group_1',
      searchRecordId: 'rec_mb',
      gameVersion: 'poe1',
      order: 3,
    });
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    snap = sourceCtrl.read();

    // 驗證：Temporary row 消失
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();

    // 驗證：Bookmark Group 呈現 active 狀態，subscriptionId 相同
    const bmkGroup = snap.groups.find((g) => g.id === 'group_1')!;
    const promotedBmk = bmkGroup.items.find((i) => i.id === 'bmk_mb')!;
    expect(promotedBmk).toBeDefined();
    expect(promotedBmk.status).toBe('active');
    expect(promotedBmk.subscriptionId).toBe(tempSubId);

    // 核心驗證：零 reconnect, 零額外 WebSocket
    expect(createdSockets).toHaveLength(1);
    expect(runtime.getSubscriptions()).toHaveLength(1);

    // 亦驗證 inactive Temporary 遇到相同 canonical Bookmark 時亦被收斂
    sourceCtrl.dispose();
  });

  it('4b. Temporary -> Bookmark Promotion: inactive Temporary Search is reconciled into Bookmark without leaving duplicate', async () => {
    // 新增一筆自訂搜尋並停止它使其進入 inactive
    await sourceCtrl.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_inactive_promo',
      { name: '未啟用暫時項目' },
    );
    let snap = sourceCtrl.read();
    const tempItem = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!.items[0];
    sourceCtrl.stop(tempItem.id);

    snap = sourceCtrl.read();
    expect(
      snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!.items[0].status,
    ).toBeUndefined();

    // 隨後新增同 canonical Bookmark
    bookmarkSource.collection.bookmarks.push({
      id: 'bmk_inactive_promo',
      name: '新收錄書籤',
      url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_inactive_promo',
      groupId: 'group_1',
      searchRecordId: 'rec_inact',
      gameVersion: 'poe1',
      order: 4,
    });
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    snap = sourceCtrl.read();
    // Temporary row 消失，收斂至 Bookmark
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();
    const bmk = snap.groups
      .find((g) => g.id === 'group_1')!
      .items.find((i) => i.id === 'bmk_inactive_promo');
    expect(bmk).toBeDefined();
    expect(bmk?.status).toBeUndefined();

    sourceCtrl.dispose();
  });

  // 5. Add Temporary Duplicate Bookmark
  it('5. Add Temporary Duplicate Bookmark: converges to existing Bookmark and does not create duplicate Temporary or subscription', async () => {
    // 既有 Bookmark bmk_hh 尚未啟用
    const snapBefore = sourceCtrl.read();
    const bmkBefore = snapBefore.groups[0].items.find((i) => i.id === 'bmk_hh')!;
    expect(bmkBefore.status).toBeUndefined();

    // 使用者以相同的 canonical URL 呼叫 addCustom
    const addRes = await sourceCtrl.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh/live',
      { name: '想重複新增的暫時搜尋' },
    );
    expect(addRes.success).toBe(true);

    const snapAfter = sourceCtrl.read();

    // 驗證：不產生 Temporary Search 群組
    expect(snapAfter.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();

    // 驗證：收斂至既有 Bookmark Source 並啟用
    const bmkAfter = snapAfter.groups[0].items.find((i) => i.id === 'bmk_hh')!;
    expect(bmkAfter.status).toBe('connecting');
    expect(runtime.getSubscriptions()).toHaveLength(1);

    // 若已 active 時再次呼叫 addCustom，保持既有連線並拒絕重複
    createdSockets[0].triggerOpen();
    const addDupRes = await sourceCtrl.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh',
    );
    expect(addDupRes.success).toBe(false);
    expect(addDupRes.error).toContain('已在即時監聽中');
    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(createdSockets).toHaveLength(1);

    sourceCtrl.dispose();
  });

  // 6. Bookmark Read Failure
  it('6. Bookmark Read Failure: does NOT treat active Bookmark sources as deleted or turn them into Temporary searches', async () => {
    // 啟用 bmk_1
    await sourceCtrl.enable('bmk_1');
    createdSockets[0].triggerOpen();

    expect(runtime.getSubscriptions()).toHaveLength(1);

    // 模擬下一次 readCollection() 失敗（例如 messaging 或 storage 臨時異常）
    const originalRead = bookmarkSource.readCollection.bind(bookmarkSource);
    bookmarkSource.readCollection = async () => {
      return {
        ok: false,
        error: { code: 'storage-failure', message: 'Storage temporary failure' },
      };
    };
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    const snap = sourceCtrl.read();

    // 驗證：不得將 bmk_1 轉入「暫時搜尋」，仍保留最後已知 Bookmark ownership
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();
    const bmkGroup = snap.groups.find((g) => g.id === 'group_1');
    expect(bmkGroup).toBeDefined();
    const bmk1 = bmkGroup?.items.find((i) => i.id === 'bmk_1');
    expect(bmk1).toBeDefined();
    expect(bmk1?.status).toBe('active');

    // 驗證：Runtime 保持連線，零 stop, 零 reconnect
    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(createdSockets).toHaveLength(1);

    // 下一次成功 authoritative 讀取回復
    bookmarkSource.readCollection = originalRead;
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    const restoredSnap = sourceCtrl.read();
    expect(restoredSnap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();
    expect(restoredSnap.error).toBeUndefined();

    sourceCtrl.dispose();
  });

  // 7. Rapid Reconciliation
  it('7. Rapid Reconciliation: coalesces intermediate dirty signals and only lets latest authoritative collection decide ownership', async () => {
    // 啟用 bmk_1
    await sourceCtrl.enable('bmk_1');
    createdSockets[0].triggerOpen();

    let resolveStale!: (val: BookmarkReadOutcome<BookmarkCollectionView>) => void;
    let intercepted = false;

    const originalRead = bookmarkSource.readCollection.bind(bookmarkSource);
    bookmarkSource.readCollection = async () => {
      if (!intercepted) {
        intercepted = true;
        return new Promise<BookmarkReadOutcome<BookmarkCollectionView>>((resolve) => {
          resolveStale = resolve;
        });
      }
      return originalRead();
    };

    // 1. 觸發刪除（發起 stale read）
    bookmarkSource.triggerChange();

    // 2. 在 stale read 尚未 resolve 期間，又觸發快速更新（加回 bmk_1 並更名）
    bookmarkSource.collection.bookmarks.find((b) => b.id === 'bmk_1')!.name = '最新命名';
    bookmarkSource.triggerChange();

    // 3. Resolve stale read（此時 stale read 認為 bmk_1 已被刪除）
    resolveStale({
      ok: true,
      value: {
        groups: [{ id: 'group_1', name: '常用星團', order: 0 } as any],
        bookmarks: [], // stale 假裝全刪
      },
    });

    await new Promise((r) => setTimeout(r, 30));

    // 驗證：由於在 stale 讀取期間收到 newer dirty signal，stale 不被 commit，
    // 最終快照呈現最新 collection，bmk_1 仍為 Bookmark，沒有被短暫洗牌為 Temporary Search
    const snap = sourceCtrl.read();
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();
    const bmk = snap.groups.find((g) => g.id === 'group_1')!.items.find((i) => i.id === 'bmk_1')!;
    expect(bmk.name).toBe('最新命名');
    expect(bmk.status).toBe('active');

    sourceCtrl.dispose();
  });

  // 8. Stop Fallback Temporary
  it('8. Stop Fallback Temporary: stops active subscription, stays in Temporary group as inactive, and can be re-enabled', async () => {
    // 啟用 bmk_1
    await sourceCtrl.enable('bmk_1');
    createdSockets[0].triggerOpen();

    // 刪除 bmk_1 使其 fallback 為 Temporary Search
    bookmarkSource.collection.bookmarks = [];
    bookmarkSource.triggerChange();
    await new Promise((r) => setTimeout(r, 30));

    let snap = sourceCtrl.read();
    let tempGroup = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!;
    expect(tempGroup.items).toHaveLength(1);
    const fallbackItem = tempGroup.items[0];
    expect(fallbackItem.status).toBe('active');

    // 使用者在主控台點擊 [停止]
    sourceCtrl.stop(fallbackItem.id);
    await new Promise((r) => setTimeout(r, 10));

    // 驗證：Runtime subscription 停止
    expect(runtime.getSubscriptions()).toHaveLength(0);

    // 驗證：Temporary 仍存在於主控台，狀態轉為未啟用 (inactive)
    snap = sourceCtrl.read();
    tempGroup = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!;
    expect(tempGroup.items).toHaveLength(1);
    expect(tempGroup.items[0].status).toBeUndefined();
    expect(tempGroup.items[0].removable).toBe(true);

    // 驗證：再次點擊 [啟用] 可建立新 Runtime subscription
    const reEnableRes = await sourceCtrl.enable(tempGroup.items[0].id);
    expect(reEnableRes.success).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(runtime.getSubscriptions()).toHaveLength(1);
    expect(createdSockets).toHaveLength(2); // 第二個 connection

    createdSockets[1].triggerOpen();
    snap = sourceCtrl.read();
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!.items[0].status).toBe(
      'active',
    );

    sourceCtrl.dispose();
  });

  // 9. Remove Temporary
  it('9. Remove Temporary: safely stops active Runtime subscription exactly once and removes Temporary source', async () => {
    // 新增一筆 Temporary Search 並使其 active
    await sourceCtrl.addCustom(
      'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_to_remove',
      { name: '待移除暫時搜尋' },
    );
    createdSockets[0].triggerOpen();

    let snap = sourceCtrl.read();
    const tempItem = snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)!.items[0];
    expect(tempItem.status).toBe('active');
    expect(runtime.getSubscriptions()).toHaveLength(1);

    const removeSpy = vi.spyOn(runtime, 'removeSubscription');

    // 點擊 [移除]
    const removeSuccess = sourceCtrl.removeCustom(tempItem.id);
    expect(removeSuccess).toBe(true);

    // 驗證：Runtime stop 被恰好呼叫一次
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(runtime.getSubscriptions()).toHaveLength(0);

    // 驗證：Temporary Search 完全消失
    snap = sourceCtrl.read();
    expect(snap.groups.find((g) => g.id === TEMPORARY_SOURCE_GROUP_ID)).toBeUndefined();

    sourceCtrl.dispose();
  });
});
