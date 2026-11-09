// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BookmarkCollectionView, BookmarkReadOutcome } from '@/utils/bookmark-coordinator';
import {
  createLiveSearchBookmarkController,
  createLiveSearchSourceController,
  CUSTOM_SOURCE_GROUP_ID,
  CUSTOM_SOURCE_GROUP_NAME,
  filterLiveSearchSourceGroups,
  getLiveSearchGroupSubtreeItems,
  getLiveSearchGroupSubtreeSourceIds,
  type LiveSearchBookmarkController,
  type LiveSearchBookmarkSnapshot,
  type LiveSearchBookmarkSourcePort,
} from '@/entrypoints/content/logic/live-search-bookmark-controller';
import { createLiveSearchPrimaryController } from '@/entrypoints/content/logic/live-search-primary-controller';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import { LiveSearchOpenScheduler } from '@/entrypoints/content/logic/live-search-open-scheduler';
import { createTradeSearchCriteriaKeyResolver } from '@/utils/trade-search-criteria-key';
import type {
  EnsureContainerOptions,
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
  ResetUnreadOptions,
} from '@/entrypoints/content/logic/live-search-host-client';
import { createLiveSearchResumeController } from '@/entrypoints/content/logic/live-search-resume-controller';
import {
  createLiveSearchResumeStore,
  type LiveSearchResumeStorage,
} from '@/utils/live-search-resume-store';
import {
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  getPreferenceStorageKey,
  type PreferencesStorage,
} from '@/utils/preferences';

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

  public simulateMessage(data: string): void {
    if (this.onmessage && !this.closed) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  public close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

class FakeHostClient implements ILiveSearchHostClient {
  public ensureCalls: EnsureContainerOptions[] = [];
  public ensureDelayMs = 0;
  public committedHostLeague = 'Standard';
  public ensureHandler?: (
    options: EnsureContainerOptions,
  ) => Promise<HostCommandOutcome> | HostCommandOutcome;
  public disposed = false;

  public async ensureContainer(options: EnsureContainerOptions): Promise<HostCommandOutcome> {
    this.ensureCalls.push(options);
    if (this.ensureDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.ensureDelayMs));
    }
    if (this.ensureHandler) {
      const outcome = await this.ensureHandler(options);
      if (outcome.success && options.league) {
        this.committedHostLeague = options.league;
      }
      return outcome;
    }
    if (options.league) {
      this.committedHostLeague = options.league;
    }
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
        leaguePinned: true,
        groupId: 'group_1',
        searchRecordId: 'rec_1',
        gameVersion: 'poe1',
        order: 0,
      },
      {
        id: 'bmk_2',
        name: '巨型星團 B (同搜尋不同網址 live)',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcluster_shared/live',
        leaguePinned: true,
        groupId: 'group_1',
        searchRecordId: 'rec_1',
        gameVersion: 'poe1',
        order: 1,
      },
      {
        id: 'bmk_3',
        name: '獵首皮帶',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh',
        leaguePinned: true,
        groupId: 'group_1',
        searchRecordId: 'rec_2',
        gameVersion: 'poe1',
        order: 2,
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
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  public get listenerCount(): number {
    return this.listeners.size;
  }
}

describe('Bookmark -> LiveSearch Integration Tests', () => {
  let bookmarkSource: FakeBookmarkSource;
  let hostClient: FakeHostClient;
  let createdSockets: FakeWebSocket[];
  let runtime: LiveSearchPrimaryRuntime;
  let liveController: ReturnType<typeof createLiveSearchPrimaryController>;

  beforeEach(() => {
    bookmarkSource = new FakeBookmarkSource();
    hostClient = new FakeHostClient();
    createdSockets = [];
    runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      fetchClient: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ result: [{ id: 'mock_item' }] }),
        }) as any,
      webSocketFactory: (url) => {
        const ws = new FakeWebSocket(url);
        createdSockets.push(ws);
        return ws as unknown as WebSocket;
      },
      openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
    });
    liveController = createLiveSearchPrimaryController(runtime);
  });

  describe('1. Deep Module & Architecture Boundary Inspection', () => {
    it('ensures bookmark-coordinator, bookmark-messaging, and bookmark-model NEVER import livesearch', () => {
      const filesToCheck = [
        'utils/bookmark-coordinator.ts',
        'utils/bookmark-messaging.ts',
        'components/sidebar/bookmark-model.ts',
      ];
      for (const relPath of filesToCheck) {
        const content = readFileSync(resolve(process.cwd(), relPath), 'utf-8');
        expect(content.toLowerCase()).not.toContain('livesearch');
        expect(content.toLowerCase()).not.toContain('live-search');
      }
    });

    it('ensures live-search-primary-runtime and live-search-primary-controller NEVER import bookmark modules', () => {
      const filesToCheck = [
        'entrypoints/content/logic/live-search-primary-runtime.ts',
        'entrypoints/content/logic/live-search-primary-controller.ts',
      ];
      for (const relPath of filesToCheck) {
        const content = readFileSync(resolve(process.cwd(), relPath), 'utf-8');
        expect(content).not.toContain('bookmark-coordinator');
        expect(content).not.toContain('bookmark-messaging');
        expect(content).not.toContain('bookmark-model');
      }
    });
  });

  describe('2. Bookmark Source Lifecycle & Refresh', () => {
    it('initial read yields loaded bookmark snapshot and subscribes to changes', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];

      const unsub = integration.subscribe((s) => snapshots.push(s));

      // Wait for initial async reload
      await new Promise((r) => setTimeout(r, 20));

      const latest = snapshots[snapshots.length - 1];
      expect(latest.loading).toBe(false);
      expect(latest.groups).toHaveLength(1);
      expect(latest.groups[0].bookmarks).toHaveLength(3);
      expect(bookmarkSource.listenerCount).toBe(1);

      // Bookmark change triggers refresh
      bookmarkSource.collection.bookmarks.push({
        id: 'bmk_4',
        name: '法師之血',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_mb',
        leaguePinned: true,
        groupId: 'group_1',
        searchRecordId: 'rec_3',
        gameVersion: 'poe1',
        order: 3,
      });
      bookmarkSource.triggerChange();
      await new Promise((r) => setTimeout(r, 20));

      const afterAdd = snapshots[snapshots.length - 1];
      expect(afterAdd.groups[0].bookmarks).toHaveLength(4);

      // Dispose removes listeners
      integration.dispose();
      expect(bookmarkSource.listenerCount).toBe(0);
      unsub();
    });
  });

  describe('3. Add from Bookmark & Canonical Provenance', () => {
    it('adds subscription with canonical url, name, and sourceBookmarkId', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      const outcome = await integration.add('bmk_1');
      expect(outcome.success).toBe(true);

      const liveSnapshot = liveController.read();
      expect(liveSnapshot.subscriptions).toHaveLength(1);
      const sub = liveSnapshot.subscriptions[0];
      expect(sub.name).toBe('巨型星團 A');
      expect(sub.sourceBookmarkId).toBe('bmk_1');
      expect(sub.searchId).toBe('H4sIcluster_shared');
      expect(createdSockets).toHaveLength(1);

      integration.dispose();
    });
  });

  describe('4. Active Mark & Canonical Identity Join', () => {
    it('marks both Bookmark A and Bookmark B active when they share the same canonical search', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      integration.subscribe((s) => snapshots.push(s));
      await new Promise((r) => setTimeout(r, 20));

      // Add Bookmark A
      await integration.add('bmk_1');
      await new Promise((r) => setTimeout(r, 10));

      let latest = snapshots[snapshots.length - 1];
      let bmk1 = latest.groups[0].bookmarks.find((b) => b.id === 'bmk_1');
      let bmk2 = latest.groups[0].bookmarks.find((b) => b.id === 'bmk_2');
      let bmk3 = latest.groups[0].bookmarks.find((b) => b.id === 'bmk_3');

      // Both bmk_1 and bmk_2 share 'Standard/H4sIcluster_shared', so both must be connecting!
      expect(bmk1?.liveSearchStatus).toBe('connecting');
      expect(bmk2?.liveSearchStatus).toBe('connecting');
      expect(bmk3?.liveSearchStatus).toBeUndefined();

      // Trigger WS open -> both become active
      createdSockets[0].triggerOpen();
      await new Promise((r) => setTimeout(r, 10));

      latest = snapshots[snapshots.length - 1];
      bmk1 = latest.groups[0].bookmarks.find((b) => b.id === 'bmk_1');
      bmk2 = latest.groups[0].bookmarks.find((b) => b.id === 'bmk_2');
      expect(bmk1?.liveSearchStatus).toBe('active');
      expect(bmk2?.liveSearchStatus).toBe('active');

      integration.dispose();
    });

    it('marks bookmark active even if subscription was added manually via URL without bookmarkId', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      integration.subscribe((s) => snapshots.push(s));
      await new Promise((r) => setTimeout(r, 20));

      // Manually add via controller
      await liveController.addFromUrl(
        'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh',
      );
      await new Promise((r) => setTimeout(r, 10));

      const latest = snapshots[snapshots.length - 1];
      const bmk3 = latest.groups[0].bookmarks.find((b) => b.id === 'bmk_3');
      expect(bmk3?.liveSearchStatus).toBe('connecting');

      integration.dispose();
    });
  });

  describe('5. Duplicate Protection & Canonical SSOT', () => {
    it('rejects adding second bookmark pointing to already active canonical search', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // Add bmk_1
      const outcome1 = await integration.add('bmk_1');
      expect(outcome1.success).toBe(true);
      expect(createdSockets).toHaveLength(1);

      // Try adding bmk_2 (same search identity)
      const outcome2 = await integration.add('bmk_2');
      expect(outcome2.success).toBe(false);
      expect(outcome2.error).toContain('已在即時監聽中');
      expect(createdSockets).toHaveLength(1); // Zero additional WebSocket!

      integration.dispose();
    });

    it('runtime enforces duplicate validation in mutex even if requested directly', async () => {
      // Add first subscription directly to runtime
      const res1 = await runtime.addSubscription({
        id: 'sub_alpha',
        gameVersion: 'poe1',
        league: 'Standard',
        searchId: 'H4sIdirect_search',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdirect_search',
        status: 'idle',
        createdAt: Date.now(),
      });
      expect(res1.success).toBe(true);
      expect(createdSockets).toHaveLength(1);

      // Add second subscription with different subscription id and different name
      const res2 = await runtime.addSubscription({
        id: 'sub_beta',
        gameVersion: 'poe1',
        league: 'standard', // Case-insensitive normalized match
        searchId: 'H4sIdirect_search',
        url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdirect_search',
        status: 'idle',
        createdAt: Date.now(),
      });
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Duplicate subscription');
      expect(createdSockets).toHaveLength(1); // No second WS created!
    });
  });

  describe('6. Concurrent Click & Pending Coalescing', () => {
    it('sets pending true for all bookmarks sharing the same search identity during add()', async () => {
      let resolveAdd: (value: any) => void = () => {};
      const slowPromise = new Promise((resolve) => {
        resolveAdd = resolve;
      });

      // Spy on addFromUrl to hang
      vi.spyOn(liveController, 'addFromUrl').mockImplementationOnce(() => slowPromise as any);

      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      integration.subscribe((s) => snapshots.push(s));
      await new Promise((r) => setTimeout(r, 20));

      const addPromise = integration.add('bmk_1');

      // Immediate check after triggering add: both bmk_1 and bmk_2 must be pending!
      const pendingSnapshot = snapshots[snapshots.length - 1];
      const bmk1Pending = pendingSnapshot.groups[0].bookmarks.find((b) => b.id === 'bmk_1');
      const bmk2Pending = pendingSnapshot.groups[0].bookmarks.find((b) => b.id === 'bmk_2');
      const bmk3Pending = pendingSnapshot.groups[0].bookmarks.find((b) => b.id === 'bmk_3');

      expect(bmk1Pending?.pending).toBe(true);
      expect(bmk2Pending?.pending).toBe(true);
      expect(bmk3Pending?.pending).toBe(false);

      // Concurrent click on bmk_2 is rejected
      const concurrentOutcome = await integration.add('bmk_2');
      expect(concurrentOutcome.success).toBe(false);
      expect(concurrentOutcome.error).toContain('正在啟動中');

      // Resolve slow promise
      resolveAdd({ success: true });
      await addPromise;

      // Pending flags are cleared
      const finalSnapshot = snapshots[snapshots.length - 1];
      expect(finalSnapshot.groups[0].bookmarks.every((b) => !b.pending)).toBe(true);

      integration.dispose();
    });
  });

  describe('7. Bookmark Mutation & Deletion Independence', () => {
    it('keeps subscription and WebSocket alive when origin bookmark is renamed, moved, or deleted', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // Add subscription from bmk_1
      await integration.add('bmk_1');
      const ws = createdSockets[0];
      ws.triggerOpen();

      expect(runtime.getSubscriptions()).toHaveLength(1);
      expect(ws.closed).toBe(false);

      // Bookmark A is renamed and moved
      bookmarkSource.collection.bookmarks[0].name = '全新名稱';
      bookmarkSource.collection.bookmarks[0].groupId = 'new_group';
      bookmarkSource.triggerChange();
      await new Promise((r) => setTimeout(r, 20));

      // Subscription remains unchanged
      expect(runtime.getSubscriptions()).toHaveLength(1);
      expect(runtime.getSubscriptions()[0].searchId).toBe('H4sIcluster_shared');
      expect(ws.closed).toBe(false);

      // Bookmark A is deleted
      bookmarkSource.collection.bookmarks.splice(0, 1);
      bookmarkSource.triggerChange();
      await new Promise((r) => setTimeout(r, 20));

      // Subscription and WebSocket MUST still remain alive and active!
      expect(runtime.getSubscriptions()).toHaveLength(1);
      expect(runtime.getSubscriptions()[0].status).toBe('active');
      expect(ws.closed).toBe(false);

      integration.dispose();
    });
  });

  describe('8. Stop Subscription Clears Active Mark', () => {
    it('clears active mark on bookmarks after subscription is removed from live controller', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      integration.subscribe((s) => snapshots.push(s));
      await new Promise((r) => setTimeout(r, 20));

      await integration.add('bmk_1');
      await new Promise((r) => setTimeout(r, 10));

      let latest = snapshots[snapshots.length - 1];
      expect(latest.groups[0].bookmarks[0].liveSearchStatus).toBe('connecting');

      // Stop the subscription
      const subId = liveController.read().subscriptions[0].id;
      liveController.remove(subId);
      await new Promise((r) => setTimeout(r, 10));

      latest = snapshots[snapshots.length - 1];
      expect(latest.groups[0].bookmarks[0].liveSearchStatus).toBeUndefined();
      expect(latest.groups[0].bookmarks[1].liveSearchStatus).toBeUndefined();

      // Can add again now
      const readdOutcome = await integration.add('bmk_1');
      expect(readdOutcome.success).toBe(true);

      integration.dispose();
    });
  });

  describe('9. Reconciliation, Dirty Coalescing, and Out-of-Order Safety', () => {
    it('serializes read transactions and coalesces multiple concurrent dirty triggers into a single follow-up read', async () => {
      let inFlightReads = 0;
      let maxInFlightReads = 0;
      let totalReads = 0;

      const deferredQueue: Array<() => void> = [];
      const customListeners = new Set<() => void>();

      const customSource: LiveSearchBookmarkSourcePort = {
        readCollection: async () => {
          totalReads++;
          inFlightReads++;
          maxInFlightReads = Math.max(maxInFlightReads, inFlightReads);
          await new Promise<void>((resolve) => deferredQueue.push(resolve));
          inFlightReads--;
          return {
            ok: true,
            value: {
              groups: [{ id: 'g1', name: `Group Ver ${totalReads}`, order: 0 } as any],
              bookmarks: [
                {
                  id: 'b1',
                  name: 'Item 1',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIreconcile_1',
                  leaguePinned: true,
                  groupId: 'g1',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec_1',
                },
              ],
            },
          };
        },
        subscribe: (listener) => {
          customListeners.add(listener);
          return () => customListeners.delete(listener);
        },
      };

      const integration = createLiveSearchBookmarkController(customSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      integration.subscribe((s) => snapshots.push(s));

      // 初始讀取正在 in-flight
      expect(totalReads).toBe(1);
      expect(inFlightReads).toBe(1);
      expect(maxInFlightReads).toBe(1);

      // 在 read #1 進行中，觸發多次變更 (例如 bookmark:change 與 searchRecord:change 連發)
      customListeners.forEach((l) => l());
      customListeners.forEach((l) => l());
      customListeners.forEach((l) => l());

      // 即使觸發了 3 次，因為 read #1 尚未 resolve，不得發起新的 read
      expect(totalReads).toBe(1);
      expect(inFlightReads).toBe(1);
      expect(maxInFlightReads).toBe(1);

      // Resolve read #1
      const resolve1 = deferredQueue.shift()!;
      resolve1();
      await new Promise((r) => setTimeout(r, 10));

      // 由於在 read #1 期間標記了 dirty (hasPendingReload)，read #1 完成後立即發起 read #2
      expect(totalReads).toBe(2);
      expect(inFlightReads).toBe(1);
      expect(maxInFlightReads).toBe(1);

      // Resolve read #2
      const resolve2 = deferredQueue.shift()!;
      resolve2();
      await new Promise((r) => setTimeout(r, 10));

      // 所有的 pending 已經收斂，沒有額外的 read
      expect(totalReads).toBe(2);
      expect(inFlightReads).toBe(0);
      expect(maxInFlightReads).toBe(1);

      // 最終快照呈現最新 read #2 的資料
      const latest = snapshots[snapshots.length - 1];
      expect(latest.groups[0].name).toBe('Group Ver 2');

      integration.dispose();
    });

    it('rejects stale responses if earlier read resolves late (generation / latest-wins check)', async () => {
      let resolveFirstRead!: (val: BookmarkReadOutcome<BookmarkCollectionView>) => void;
      let readCount = 0;

      const customListeners = new Set<() => void>();
      const customSource: LiveSearchBookmarkSourcePort = {
        readCollection: vi.fn().mockImplementation(() => {
          readCount++;
          if (readCount === 1) {
            return new Promise<BookmarkReadOutcome<BookmarkCollectionView>>((resolve) => {
              resolveFirstRead = resolve;
            });
          }
          return Promise.resolve({
            ok: true,
            value: {
              groups: [{ id: 'g_latest', name: 'Latest Group', order: 0 } as any],
              bookmarks: [
                {
                  id: 'b_latest',
                  name: 'Latest Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIlatest_1',
                  leaguePinned: true,
                  groupId: 'g_latest',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec_latest',
                },
              ],
            },
          });
        }),
        subscribe: (listener) => {
          customListeners.add(listener);
          return () => customListeners.delete(listener);
        },
      };

      const integration = createLiveSearchBookmarkController(customSource, liveController);
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      integration.subscribe((s) => snapshots.push(s));

      expect(readCount).toBe(1);

      // 在 read 1 進行中觸發 change
      customListeners.forEach((l) => l());

      // 現在 resolveFirstRead 被呼叫，提供舊資料
      resolveFirstRead({
        ok: true,
        value: {
          groups: [{ id: 'g_stale', name: 'Stale Group', order: 0 } as any],
          bookmarks: [
            {
              id: 'b_stale',
              name: 'Stale Item',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstale_1',
              leaguePinned: true,
              groupId: 'g_stale',
              order: 0,
              gameVersion: 'poe1',
              searchRecordId: 'rec_stale',
            },
          ],
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      expect(readCount).toBe(2);
      const latest = snapshots[snapshots.length - 1];
      expect(latest.groups[0].id).toBe('g_latest');
      expect(latest.groups[0].name).toBe('Latest Group');

      integration.dispose();
    });

    it('discards in-flight read and does not notify after dispose is called', async () => {
      let resolveInFlight!: (val: BookmarkReadOutcome<BookmarkCollectionView>) => void;
      const customListeners = new Set<() => void>();
      const customSource: LiveSearchBookmarkSourcePort = {
        readCollection: vi.fn().mockImplementation(() => {
          return new Promise<BookmarkReadOutcome<BookmarkCollectionView>>((resolve) => {
            resolveInFlight = resolve;
          });
        }),
        subscribe: (listener) => {
          customListeners.add(listener);
          return () => customListeners.delete(listener);
        },
      };

      const integration = createLiveSearchBookmarkController(customSource, liveController);
      const listenerSpy = vi.fn();
      integration.subscribe(listenerSpy);

      expect(listenerSpy).toHaveBeenCalledTimes(1);
      expect(listenerSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ loading: true, groups: [] }),
      );

      // Dispose while read is in-flight
      integration.dispose();
      listenerSpy.mockClear();

      // Resolve in-flight read
      resolveInFlight({
        ok: true,
        value: {
          groups: [{ id: 'g1', name: 'Never Applied', order: 0 } as any],
          bookmarks: [],
        },
      });

      await new Promise((r) => setTimeout(r, 20));

      // Listener MUST NOT be called after dispose
      expect(listenerSpy).not.toHaveBeenCalled();

      // Trigger change after dispose does nothing
      customListeners.forEach((l) => l());
      expect(customSource.readCollection).toHaveBeenCalledTimes(1);
    });
  });

  describe('10. Action Freshness & Reconciliation Drain Contracts', () => {
    it('waits for pending reconciliation drain and rejects when target bookmark is deleted during reload', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      let resolvePendingRead!: (val: BookmarkReadOutcome<BookmarkCollectionView>) => void;
      const originalRead = bookmarkSource.readCollection.bind(bookmarkSource);

      let intercepted = false;
      bookmarkSource.readCollection = async () => {
        if (!intercepted) {
          intercepted = true;
          return new Promise<BookmarkReadOutcome<BookmarkCollectionView>>((resolve) => {
            resolvePendingRead = resolve;
          });
        }
        return originalRead();
      };

      // 外部刪除 bmk_1
      bookmarkSource.collection.bookmarks = bookmarkSource.collection.bookmarks.filter(
        (b) => b.id !== 'bmk_1',
      );
      bookmarkSource.triggerChange();

      // 在 refresh pending 期間呼叫 add('bmk_1')
      const addPromise = integration.add('bmk_1');

      // 驗證等待期間零副作用
      expect(createdSockets).toHaveLength(0);
      expect(runtime.getSubscriptions()).toHaveLength(0);

      // Resolve pending read，提供最新已刪除的資料
      resolvePendingRead({
        ok: true,
        value: JSON.parse(JSON.stringify(bookmarkSource.collection)),
      });

      const outcome = await addPromise;

      // 驗證：add 重新 lookup 找不到 bmk_1，失敗且 zero WebSocket、zero subscription
      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('找不到指定書籤');
      expect(createdSockets).toHaveLength(0);
      expect(runtime.getSubscriptions()).toHaveLength(0);

      integration.dispose();
    });

    it('waits for pending reconciliation drain and uses updated search identity when bookmark url changed during reload', async () => {
      const integration = createLiveSearchBookmarkController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      let resolvePendingRead!: (val: BookmarkReadOutcome<BookmarkCollectionView>) => void;
      const originalRead = bookmarkSource.readCollection.bind(bookmarkSource);

      let intercepted = false;
      bookmarkSource.readCollection = async () => {
        if (!intercepted) {
          intercepted = true;
          return new Promise<BookmarkReadOutcome<BookmarkCollectionView>>((resolve) => {
            resolvePendingRead = resolve;
          });
        }
        return originalRead();
      };

      // 修改 bmk_3 的 URL 為全新的 search_mageblood
      const targetBookmark = bookmarkSource.collection.bookmarks.find((b) => b.id === 'bmk_3')!;
      targetBookmark.url = 'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_mageblood';
      bookmarkSource.triggerChange();

      // 在 refresh pending 期間呼叫 add('bmk_3')
      const addPromise = integration.add('bmk_3');

      // 驗證等待期間零副作用
      expect(createdSockets).toHaveLength(0);
      expect(runtime.getSubscriptions()).toHaveLength(0);

      // Resolve pending read
      resolvePendingRead({
        ok: true,
        value: JSON.parse(JSON.stringify(bookmarkSource.collection)),
      });

      const outcome = await addPromise;

      // 驗證：add 成功，且使用的 identity 為 search_mageblood 而非 search_hh
      expect(outcome.success).toBe(true);
      expect(runtime.getSubscriptions()).toHaveLength(1);
      expect(runtime.getSubscriptions()[0].searchId).toBe('H4sIsearch_mageblood');
      expect(createdSockets).toHaveLength(1);
      expect(createdSockets[0].url).toContain('H4sIsearch_mageblood');
      expect(createdSockets[0].url).not.toContain('H4sIsearch_hh');

      integration.dispose();
    });
  });

  describe('11. Unified Source Projection: Bookmark & Custom URL Lifecycle', () => {
    it('Bookmark source lifecycle: 未啟用 -> 啟用 -> active -> 停止 -> source 仍存在但未啟用 (non-removable)', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      let snap = sourceCtrl.read();
      const bmkBefore = snap.groups[0].items.find((i) => i.id === 'bmk_3')!;
      expect(bmkBefore.kind).toBe('bookmark');
      expect(bmkBefore.removable).toBe(false);
      expect(bmkBefore.status).toBeUndefined();
      expect(bmkBefore.subscriptionId).toBeUndefined();

      // 啟用
      const enableRes = await sourceCtrl.enable('bmk_3');
      expect(enableRes.success).toBe(true);

      snap = sourceCtrl.read();
      const bmkConnecting = snap.groups[0].items.find((i) => i.id === 'bmk_3')!;
      expect(bmkConnecting.status).toBe('connecting');
      expect(bmkConnecting.subscriptionId).toBeDefined();

      // WS open -> active
      createdSockets[0].triggerOpen();
      snap = sourceCtrl.read();
      const bmkActive = snap.groups[0].items.find((i) => i.id === 'bmk_3')!;
      expect(bmkActive.status).toBe('active');

      // 停止 -> source 仍存在但未啟用
      sourceCtrl.stop('bmk_3');
      snap = sourceCtrl.read();
      const bmkStopped = snap.groups[0].items.find((i) => i.id === 'bmk_3')!;
      expect(bmkStopped).toBeDefined();
      expect(bmkStopped.status).toBeUndefined();
      expect(bmkStopped.subscriptionId).toBeUndefined();
      expect(runtime.getSubscriptions()).toHaveLength(0);

      // Bookmark 不可透過 removeCustom 移除
      expect(sourceCtrl.removeCustom('bmk_3')).toBe(false);
      expect(sourceCtrl.read().groups[0].items.find((i) => i.id === 'bmk_3')).toBeDefined();

      sourceCtrl.dispose();
    });

    it('Custom URL lifecycle: 新增 URL -> 自動啟用 -> 停止保留 -> 再次啟用建立新 subscription -> 移除安全停止並刪除，且絕不寫入 storage', async () => {
      const storageSetSpy = vi.fn();
      const prevChrome = (globalThis as any).chrome;
      (globalThis as any).chrome = {
        storage: {
          local: { set: storageSetSpy },
          session: { set: storageSetSpy },
          sync: { set: storageSetSpy },
        },
      };

      try {
        const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
        await new Promise((r) => setTimeout(r, 20));

        // 尚未新增 custom source 時，不應出現空的「自訂網址」群組
        expect(
          sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID),
        ).toBeUndefined();

        // 1. 新增自訂 URL -> 建立 Custom Source 並立即啟用
        const addRes = await sourceCtrl.addCustom(
          'https://www.pathofexile.com/trade/search/Standard/H4sIcustom_jewel_1/live',
          { name: '自訂珠寶搜尋' },
        );
        expect(addRes.success).toBe(true);

        let customGroup = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
        expect(customGroup).toBeDefined();
        expect(customGroup?.name).toBe(CUSTOM_SOURCE_GROUP_NAME);
        expect(customGroup?.items).toHaveLength(1);

        let customItem = customGroup!.items[0]!;
        const customId = customItem.id;
        const firstSubId = customItem.subscriptionId;
        expect(customItem.kind).toBe('custom');
        expect(customItem.name).toBe('自訂珠寶搜尋');
        expect(customItem.url).toBe(
          'https://www.pathofexile.com/trade/search/Standard/H4sIcustom_jewel_1',
        );
        expect(customItem.removable).toBe(true);
        expect(customItem.status).toBe('connecting');
        expect(firstSubId).toBeDefined();

        createdSockets[0].triggerOpen();
        customItem = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID)!
          .items[0]!;
        expect(customItem.status).toBe('active');

        // 2. 停止 -> 移除 Runtime subscription，但 Custom Source 保留且顯示未啟用
        sourceCtrl.stop(customId);
        expect(runtime.getSubscriptions()).toHaveLength(0);
        expect(createdSockets[0].closed).toBe(true);

        customGroup = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
        expect(customGroup).toBeDefined();
        customItem = customGroup!.items[0]!;
        expect(customItem.id).toBe(customId);
        expect(customItem.status).toBeUndefined();
        expect(customItem.subscriptionId).toBeUndefined();

        // 3. 再次啟用 -> 以同一 URL / name 建立新的 Runtime subscription
        const reEnableRes = await sourceCtrl.enable(customId);
        expect(reEnableRes.success).toBe(true);
        expect(runtime.getSubscriptions()).toHaveLength(1);

        customItem = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID)!
          .items[0]!;
        expect(customItem.status).toBe('connecting');
        expect(customItem.subscriptionId).toBeDefined();
        expect(customItem.subscriptionId).not.toBe(firstSubId);
        expect(runtime.getSubscriptions()[0].name).toBe('自訂珠寶搜尋');

        createdSockets[1].triggerOpen();
        expect(
          sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID)!.items[0]!.status,
        ).toBe('active');

        // 4. 移除（當仍處於 active 時）-> 先安全停止該 Runtime subscription，再移除 Custom Source
        const removed = sourceCtrl.removeCustom(customId);
        expect(removed).toBe(true);
        expect(createdSockets[1].closed).toBe(true);
        expect(runtime.getSubscriptions()).toHaveLength(0);
        expect(
          sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID),
        ).toBeUndefined();

        // 驗證全程未寫入任何 storage
        expect(storageSetSpy).not.toHaveBeenCalled();

        sourceCtrl.dispose();
      } finally {
        (globalThis as any).chrome = prevChrome;
      }
    });

    it('Custom Source 空白名稱：未提供名稱或為空字串時，以 search ID 作為名稱', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      const addRes = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIno_name_search_id/live',
        { name: '   ' },
      );
      expect(addRes.success).toBe(true);

      const customGroup = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(customGroup).toBeDefined();
      const customItem = customGroup!.items[0]!;
      expect(customItem.name).toBe('H4sIno_name_search_id');

      const sub = runtime.getSubscriptions()[0]!;
      expect(sub.name).toBe('H4sIno_name_search_id');

      sourceCtrl.dispose();
    });

    it('Custom Source 新增後啟用失敗時必須保留：回傳失敗但仍留存於自訂網址（未啟用、pending = false），且後續可再次 enable', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // 模擬 Runtime add 首次失敗（例如 Host container 暫時未就緒）
      vi.spyOn(hostClient, 'ensureContainer').mockResolvedValueOnce({
        success: false,
        error: 'Host container temporarily unavailable',
      });

      const addCustomRes = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sItransient_fail_custom_1/live',
        { name: '暫時失敗自訂搜尋' },
      );
      expect(addCustomRes.success).toBe(false);

      // 驗證 Custom Source 仍存在於「自訂網址」群組中，狀態為未啟用且 pending = false
      let customGroup = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(customGroup).toBeDefined();
      expect(customGroup!.items).toHaveLength(1);
      let customItem = customGroup!.items[0]!;
      expect(customItem.name).toBe('暫時失敗自訂搜尋');
      expect(customItem.status).toBeUndefined();
      expect(customItem.pending).toBe(false);
      expect(customItem.subscriptionId).toBeUndefined();

      // 再次對該保留的 Custom Source 點選 enable 成功啟用
      const reEnableRes = await sourceCtrl.enable(customItem.id);
      expect(reEnableRes.success).toBe(true);

      customGroup = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      customItem = customGroup!.items[0]!;
      expect(customItem.status).toBe('connecting');
      expect(customItem.pending).toBe(false);
      expect(customItem.subscriptionId).toBeDefined();

      sourceCtrl.dispose();
    });
  });

  describe('12. Canonical Reconciliation across Bookmark and Temporary Sources', () => {
    it('converges to Bookmark source when adding Temporary search sharing canonical identity with Bookmark', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // 手動新增與 bmk_3 (Standard/search_hh) 相同 canonical identity 的搜尋
      const addCustomRes = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh/live',
        { name: '自訂獵首' },
      );
      expect(addCustomRes.success).toBe(true);

      createdSockets[0].triggerOpen();
      let snap = sourceCtrl.read();
      const bmk3 = snap.groups[0].items.find((i) => i.id === 'bmk_3')!;
      // Bookmark 是 presentation owner，不產生第二筆 Temporary Search
      const customGroup = snap.groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(customGroup).toBeUndefined();

      expect(bmk3.status).toBe('active');
      expect(bmk3.subscriptionId).toBeDefined();

      // 嘗試重複啟用 bmk_3 被擋下
      const dupRes = await sourceCtrl.enable('bmk_3');
      expect(dupRes.success).toBe(false);
      expect(dupRes.error).toContain('已在即時監聽中');
      expect(createdSockets).toHaveLength(1);

      // 再次呼叫 addCustom 也收斂並拒絕重複監聽
      const dupCustomRes = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh/live',
        { name: '自訂獵首 2' },
      );
      expect(dupCustomRes.success).toBe(false);
      expect(dupCustomRes.error).toContain('已在即時監聽中');

      sourceCtrl.dispose();
    });
  });

  describe('12b. Same Criteria Dedup (different search ID, same decoded query)', () => {
    const sameCriteriaResolver = () =>
      createTradeSearchCriteriaKeyResolver(async (searchId) =>
        searchId.startsWith('H4sIsearch_hh') ? { query: { type: 'Heavy Belt' } } : { searchId },
      );

    it('rejects a temporary search whose criteria equal an active bookmark subscription', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        criteriaKeyResolver: sameCriteriaResolver(),
      });
      await new Promise((r) => setTimeout(r, 20));

      expect((await sourceCtrl.enable('bmk_3')).success).toBe(true);
      createdSockets[0].triggerOpen();

      const dup = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIsearch_hh_reordered',
        { name: '同條件不同網址' },
      );
      expect(dup.success).toBe(false);
      expect(dup.error).toContain('相同搜尋條件已在即時監聽中');
      expect(createdSockets).toHaveLength(1);
      expect(sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID)).toBeUndefined();

      sourceCtrl.dispose();
    });
  });

  describe('13. Unified Search & Status Filtering (filterLiveSearchSourceGroups)', () => {
    it('filters by source name, folder name, status (all/enabled/disabled/error), and combined query + status', async () => {
      const failRuntime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory: (url) => {
          const ws = new FakeWebSocket(url);
          createdSockets.push(ws);
          return ws as unknown as WebSocket;
        },
        openScheduler: new LiveSearchOpenScheduler({ cooldownMs: 0 }),
        reconnectPolicy: { maxFailedAttempts: 0 },
      });
      const failLiveCtrl = createLiveSearchPrimaryController(failRuntime);
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, failLiveCtrl);
      await new Promise((r) => setTimeout(r, 20));

      // bmk_1 & bmk_2: active
      await sourceCtrl.enable('bmk_1');
      createdSockets[0].triggerOpen();

      // custom_1: terminal error
      await sourceCtrl.addCustom('https://www.pathofexile.com/trade/search/Standard/H4sIerr_ring', {
        name: '裂界戒指',
      });
      createdSockets[1].triggerClose();

      // bmk_3 ('獵首皮帶'): disabled (未啟用)
      const groups = sourceCtrl.read().groups;

      // 1. statusFilter = 'all'
      const allGroups = filterLiveSearchSourceGroups(groups, { statusFilter: 'all' });
      expect(allGroups).toHaveLength(2); // 常用星團 + 自訂網址

      // 2. statusFilter = 'enabled' -> 只有 bmk_1, bmk_2
      const enabledGroups = filterLiveSearchSourceGroups(groups, { statusFilter: 'enabled' });
      expect(enabledGroups).toHaveLength(1);
      expect(enabledGroups[0].items.map((i) => i.id)).toEqual(['bmk_1', 'bmk_2']);

      // 3. statusFilter = 'disabled' -> 只有 bmk_3
      const disabledGroups = filterLiveSearchSourceGroups(groups, { statusFilter: 'disabled' });
      expect(disabledGroups).toHaveLength(1);
      expect(disabledGroups[0].items.map((i) => i.id)).toEqual(['bmk_3']);

      // 4. statusFilter = 'error' -> 只有 custom '裂界戒指'
      const errorGroups = filterLiveSearchSourceGroups(groups, { statusFilter: 'error' });
      expect(errorGroups).toHaveLength(1);
      expect(errorGroups[0].id).toBe(CUSTOM_SOURCE_GROUP_ID);
      expect(errorGroups[0].items[0].name).toBe('裂界戒指');

      // 5. Name search: '獵首'
      const nameSearch = filterLiveSearchSourceGroups(groups, { query: '獵首' });
      expect(nameSearch).toHaveLength(1);
      expect(nameSearch[0].items.map((i) => i.id)).toEqual(['bmk_3']);

      // 6. Folder search: '常用星團' (matches folder name even for '獵首皮帶')
      const folderSearch = filterLiveSearchSourceGroups(groups, { query: '常用星團' });
      expect(folderSearch).toHaveLength(1);
      expect(folderSearch[0].items).toHaveLength(3);

      // 7. Combination: query = '常用星團' + statusFilter = 'disabled' -> 僅回傳該資料夾中未啟用的 bmk_3
      const comboSearch = filterLiveSearchSourceGroups(groups, {
        query: '常用星團',
        statusFilter: 'disabled',
      });
      expect(comboSearch).toHaveLength(1);
      expect(comboSearch[0].items.map((i) => i.id)).toEqual(['bmk_3']);

      // 8. Combination with no match -> empty array
      const emptyCombo = filterLiveSearchSourceGroups(groups, {
        query: '裂界戒指',
        statusFilter: 'enabled',
      });
      expect(emptyCombo).toEqual([]);

      sourceCtrl.dispose();
    });
  });

  describe('14. Source Compatibility Projection & Reactive League Lock Update', () => {
    it('projects compatible, wrong-version, wrong-league, and invalid-url, and reactively updates when runtimeLeague locks without re-reading Bookmark storage', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'grp_mixed', name: '綜合書籤', order: 0 } as any],
        bookmarks: [
          {
            id: 'bmk_std',
            name: 'Standard 魔血',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd_mb',
            leaguePinned: true,
            groupId: 'grp_mixed',
            searchRecordId: 'r1',
            gameVersion: 'poe1',
            order: 0,
          },
          {
            id: 'bmk_hc',
            name: 'Hardcore 胸甲',
            url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_chest',
            leaguePinned: true,
            groupId: 'grp_mixed',
            searchRecordId: 'r2',
            gameVersion: 'poe1',
            order: 1,
          },
          {
            id: 'bmk_poe2',
            name: 'PoE2 地圖搜尋',
            url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIpoe2_map',
            leaguePinned: true,
            groupId: 'grp_mixed',
            searchRecordId: 'r3',
            gameVersion: 'poe2',
            order: 2,
          },
          {
            id: 'bmk_broken',
            name: '損壞書籤',
            url: 'https://example.com/not-a-trade-url',
            groupId: 'grp_mixed',
            searchRecordId: 'r4',
            gameVersion: 'poe1',
            order: 3,
          },
        ],
      };

      const readSpy = vi.spyOn(bookmarkSource, 'readCollection');
      const snapshots: LiveSearchBookmarkSnapshot[] = [];
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      sourceCtrl.subscribe((s) => snapshots.push(s));
      await new Promise((r) => setTimeout(r, 20));

      expect(readSpy).toHaveBeenCalledTimes(1);

      // 1. 初始 selectedLeague = 'Standard'：Standard 項目為 compatible；PoE2 為 wrong-version；損壞網址為 invalid-url；非當前聯盟之 Hardcore 項目直接過濾
      const initialItems = snapshots[snapshots.length - 1]!.groups[0]!.items;
      const stdBefore = initialItems.find((i) => i.id === 'bmk_std')!;
      const hcBefore = initialItems.find((i) => i.id === 'bmk_hc');
      const poe2Item = initialItems.find((i) => i.id === 'bmk_poe2')!;
      const brokenItem = initialItems.find((i) => i.id === 'bmk_broken')!;

      expect(stdBefore.compatibility).toBe('compatible');
      expect(stdBefore.compatibilityMessage).toBeUndefined();

      // Hardcore 項目被過濾不出現於 Standard 工作區
      expect(hcBefore).toBeUndefined();

      expect(poe2Item.compatibility).toBe('wrong-version');
      expect(poe2Item.compatibilityMessage).toBe('此搜尋屬於 PoE 2，目前主控台為 PoE 1');

      expect(brokenItem.compatibility).toBe('invalid-url');
      expect(brokenItem.compatibilityMessage).toContain('無法解析為合法的 Trade 搜尋');

      // 2. 切換聯盟至 Hardcore
      const switchSuccess = await sourceCtrl.switchLeague('Hardcore');
      expect(switchSuccess).toBe(true);
      expect(sourceCtrl.getSelectedLeague()).toBe('Hardcore');

      const hcSnapshotItems = snapshots[snapshots.length - 1]!.groups[0]!.items;
      const hcAfterSwitch = hcSnapshotItems.find((i) => i.id === 'bmk_hc')!;
      const stdAfterSwitch = hcSnapshotItems.find((i) => i.id === 'bmk_std');

      expect(hcAfterSwitch.compatibility).toBe('compatible');
      expect(stdAfterSwitch).toBeUndefined();

      // 3. 啟用 Hardcore 項目，Runtime 鎖定 hardcore
      const enableOutcome = await sourceCtrl.enable('bmk_hc');
      expect(enableOutcome.success).toBe(true);
      expect(runtime.getRuntimeLeague()).toBe('hardcore');

      // 4. 切回 Standard：安全 teardown 連線，runtimeLeague 解鎖重置為 null
      await sourceCtrl.switchLeague('Standard');
      expect(runtime.getRuntimeLeague()).toBeNull();
      expect(runtime.getSubscriptions()).toHaveLength(0);

      const finalItems = snapshots[snapshots.length - 1]!.groups[0]!.items;
      const stdFinal = finalItems.find((i) => i.id === 'bmk_std')!;
      expect(stdFinal.compatibility).toBe('compatible');

      sourceCtrl.dispose();
    });
  });

  describe('15. Single Enable Compatibility Preflight', () => {
    it('rejects wrong-version, wrong-league, and invalid-url before calling liveController.addFromUrl (zero Host ensure, zero WebSocket)', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'grp_1', name: '測試群組', order: 0 } as any],
        bookmarks: [
          {
            id: 'bmk_std',
            name: 'Standard 魔血',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd_mb',
            leaguePinned: true,
            groupId: 'grp_1',
            searchRecordId: 'r1',
            gameVersion: 'poe1',
            order: 0,
          },
          {
            id: 'bmk_hc',
            name: 'Hardcore 胸甲',
            url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_chest',
            leaguePinned: true,
            groupId: 'grp_1',
            searchRecordId: 'r2',
            gameVersion: 'poe1',
            order: 1,
          },
          {
            id: 'bmk_poe2',
            name: 'PoE2 地圖搜尋',
            url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIpoe2_map',
            leaguePinned: true,
            groupId: 'grp_1',
            searchRecordId: 'r3',
            gameVersion: 'poe2',
            order: 2,
          },
          {
            id: 'bmk_invalid',
            name: '損壞書籤',
            url: 'not-a-valid-url',
            groupId: 'grp_1',
            searchRecordId: 'r4',
            gameVersion: 'poe1',
            order: 3,
          },
        ],
      };

      const addFromUrlSpy = vi.spyOn(liveController, 'addFromUrl');
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // 1. wrong-version
      const resPoe2 = await sourceCtrl.enable('bmk_poe2');
      expect(resPoe2.success).toBe(false);
      expect(resPoe2.error).toBe('此搜尋屬於 PoE 2，目前主控台為 PoE 1');
      expect(addFromUrlSpy).not.toHaveBeenCalled();
      expect(hostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);

      // 2. invalid-url
      const resInvalid = await sourceCtrl.enable('bmk_invalid');
      expect(resInvalid.success).toBe(false);
      expect(resInvalid.error).toContain('無法解析為合法的 Trade 搜尋');
      expect(addFromUrlSpy).not.toHaveBeenCalled();
      expect(hostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);

      // 3. 鎖定 Standard 後測試 wrong-league
      const resStd = await sourceCtrl.enable('bmk_std');
      expect(resStd.success).toBe(true);
      expect(addFromUrlSpy).toHaveBeenCalledTimes(1);
      addFromUrlSpy.mockClear();

      const resHc = await sourceCtrl.enable('bmk_hc');
      expect(resHc.success).toBe(false);
      expect(resHc.error).toBe('主控台已鎖定 Standard，此搜尋屬於 Hardcore');
      expect(addFromUrlSpy).not.toHaveBeenCalled();
      expect(createdSockets).toHaveLength(1);

      sourceCtrl.dispose();
    });
  });

  describe('16. Batch Enable & Stop Orchestration (enableMany / stopMany)', () => {
    it('Batch Same League (unlocked runtime): enables 3 Standard sources sequentially, locks runtimeLeague to standard, and enqueues all 3 into shared OpenScheduler', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'grp_std', name: 'Standard 群組', order: 0 } as any],
        bookmarks: [
          {
            id: 's1',
            name: 'Standard A',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd_a',
            leaguePinned: true,
            groupId: 'grp_std',
            searchRecordId: 'r1',
            gameVersion: 'poe1',
            order: 0,
          },
          {
            id: 's2',
            name: 'Standard B',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd_b',
            leaguePinned: true,
            groupId: 'grp_std',
            searchRecordId: 'r2',
            gameVersion: 'poe1',
            order: 1,
          },
          {
            id: 's3',
            name: 'Standard C',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd_c',
            leaguePinned: true,
            groupId: 'grp_std',
            searchRecordId: 'r3',
            gameVersion: 'poe1',
            order: 2,
          },
        ],
      };

      const enqueuedTasks: Array<() => Promise<void> | void> = [];
      const mockScheduler = {
        enqueue: vi.fn((task: () => Promise<void> | void) => {
          enqueuedTasks.push(task);
        }),
        dispose: vi.fn(),
      };

      const batchRuntime = new LiveSearchPrimaryRuntime('poe1', {
        hostClient,
        webSocketFactory: (url) => {
          const ws = new FakeWebSocket(url);
          createdSockets.push(ws);
          return ws as unknown as WebSocket;
        },
        openScheduler: mockScheduler,
      });
      const batchLiveCtrl = createLiveSearchPrimaryController(batchRuntime);
      const addFromUrlSpy = vi.spyOn(batchLiveCtrl, 'addFromUrl');
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, batchLiveCtrl);
      await new Promise((r) => setTimeout(r, 20));

      expect(batchRuntime.getRuntimeLeague()).toBeNull();

      const outcome = await sourceCtrl.enableMany(['s1', 's2', 's3']);

      expect(outcome.success).toBe(true);
      expect(outcome.requested).toBe(3);
      expect(outcome.succeeded).toBe(3);
      expect(outcome.skipped).toBe(0);
      expect(outcome.failed).toBe(0);

      expect(addFromUrlSpy).toHaveBeenCalledTimes(3);
      expect(batchRuntime.getRuntimeLeague()).toBe('standard');
      expect(batchRuntime.getSubscriptions()).toHaveLength(3);
      expect(mockScheduler.enqueue).toHaveBeenCalledTimes(3);

      sourceCtrl.dispose();
      batchRuntime.dispose();
    });

    it('Mixed League Atomic Preflight (unlocked runtime): rejects entire batch BEFORE any addFromUrl, Host ensure, or WebSocket creation', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'grp_mix', name: '混合聯盟群組', order: 0 } as any],
        bookmarks: [
          {
            id: 'm1',
            name: 'Standard A',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sImix_a',
            leaguePinned: true,
            groupId: 'grp_mix',
            searchRecordId: 'r1',
            gameVersion: 'poe1',
            order: 0,
          },
          {
            id: 'm2',
            name: 'Hardcore B',
            url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sImix_b',
            leaguePinned: true,
            groupId: 'grp_mix',
            searchRecordId: 'r2',
            gameVersion: 'poe1',
            order: 1,
          },
          {
            id: 'm3',
            name: 'Standard C',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sImix_c',
            leaguePinned: true,
            groupId: 'grp_mix',
            searchRecordId: 'r3',
            gameVersion: 'poe1',
            order: 2,
          },
        ],
      };

      const addFromUrlSpy = vi.spyOn(liveController, 'addFromUrl');
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      expect(runtime.getRuntimeLeague()).toBeNull();

      const outcome = await sourceCtrl.enableMany(['m1', 'm2', 'm3']);

      expect(outcome.success).toBe(false);
      expect(outcome.rejectReason).toBe('mixed-league');
      expect(outcome.involvedLeagues).toEqual(['standard', 'hardcore']);
      expect(outcome.requested).toBe(3);
      expect(outcome.succeeded).toBe(0);
      expect(outcome.failed).toBe(3);
      expect(outcome.error).toContain('選取項目包含多個聯盟');

      // 關鍵架構保證：Zero side effects!
      expect(addFromUrlSpy).not.toHaveBeenCalled();
      expect(runtime.getRuntimeLeague()).toBeNull();
      expect(runtime.getSubscriptions()).toHaveLength(0);
      expect(hostClient.ensureCalls).toHaveLength(0);
      expect(createdSockets).toHaveLength(0);

      sourceCtrl.dispose();
    });

    it('Locked League Batch Preflight & Canonical Duplicate Dedup: skips already active, wrong-version, wrong-league, invalid-url, and duplicate canonical identity in batch', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'grp_locked', name: '測試群組', order: 0 } as any],
        bookmarks: [
          {
            id: 'b_active',
            name: '已啟用 Standard',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIalready_on',
            leaguePinned: true,
            groupId: 'grp_locked',
            searchRecordId: 'r1',
            gameVersion: 'poe1',
            order: 0,
          },
          {
            id: 'b_dup_1',
            name: '重複搜尋書籤',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdup_target',
            leaguePinned: true,
            groupId: 'grp_locked',
            searchRecordId: 'r2',
            gameVersion: 'poe1',
            order: 1,
          },
          {
            id: 'b_dup_2',
            name: '重複搜尋書籤 (/live)',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdup_target/live',
            leaguePinned: true,
            groupId: 'grp_locked',
            searchRecordId: 'r2',
            gameVersion: 'poe1',
            order: 2,
          },
          {
            id: 'b_hc',
            name: 'Hardcore 書籤',
            url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_item',
            leaguePinned: true,
            groupId: 'grp_locked',
            searchRecordId: 'r3',
            gameVersion: 'poe1',
            order: 3,
          },
          {
            id: 'b_poe2',
            name: 'PoE2 書籤',
            url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIpoe2_item',
            leaguePinned: true,
            groupId: 'grp_locked',
            searchRecordId: 'r4',
            gameVersion: 'poe2',
            order: 4,
          },
          {
            id: 'b_invalid',
            name: '無效書籤',
            url: 'invalid-url',
            groupId: 'grp_locked',
            searchRecordId: 'r5',
            gameVersion: 'poe1',
            order: 5,
          },
        ],
      };

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // 先單筆啟用 b_active，使 runtimeLeague 鎖定為 standard
      await sourceCtrl.enable('b_active');
      expect(runtime.getRuntimeLeague()).toBe('standard');

      const addFromUrlSpy = vi.spyOn(liveController, 'addFromUrl');

      const outcome = await sourceCtrl.enableMany([
        'b_active',
        'b_dup_1',
        'b_dup_2',
        'b_hc',
        'b_poe2',
        'b_invalid',
      ]);

      expect(outcome.success).toBe(true);
      expect(outcome.requested).toBe(6);
      expect(outcome.succeeded).toBe(1); // 只有 b_dup_1 實際執行新增
      expect(outcome.skipped).toBe(5);
      expect(outcome.failed).toBe(0);
      expect(outcome.skipReasons).toEqual({
        alreadyActive: 1,
        pending: 0,
        incompatible: 3,
        duplicateInBatch: 1,
        notFound: 0,
        inactive: 0,
      });
      expect(outcome.incompatibleBreakdown).toEqual({
        invalidUrl: 1,
        wrongVersion: 1,
        wrongLeague: 1,
      });

      // 只呼叫過 1 次 addFromUrl (針對 dup_target)
      expect(addFromUrlSpy).toHaveBeenCalledTimes(1);
      expect(runtime.getSubscriptions()).toHaveLength(2);

      // b_dup_1 與 b_dup_2 皆反映同一個 active/connecting subscription
      const items = sourceCtrl.read().groups[0]!.items;
      expect(items.find((i) => i.id === 'b_dup_1')?.status).toBe('connecting');
      expect(items.find((i) => i.id === 'b_dup_2')?.status).toBe('connecting');

      sourceCtrl.dispose();
    });

    it('Batch Stop (stopMany): stops active subscriptions, skips disabled ones, preserves all Bookmark and Custom sources, and keeps runtimeLeague locked', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController);
      await new Promise((r) => setTimeout(r, 20));

      // bmk_1 (active), bmk_3 (disabled), custom_1 (active)
      await sourceCtrl.enable('bmk_1');
      await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIcustom_stop_test',
        {
          name: '自訂停止測試',
        },
      );
      const customId = sourceCtrl.read().groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID)!
        .items[0]!.id;

      expect(runtime.getSubscriptions()).toHaveLength(2);
      expect(runtime.getRuntimeLeague()).toBe('standard');

      const removeSpy = vi.spyOn(liveController, 'remove');

      const stopOutcome = sourceCtrl.stopMany(['bmk_1', 'bmk_3', customId]);

      expect(stopOutcome.success).toBe(true);
      expect(stopOutcome.requested).toBe(3);
      expect(stopOutcome.succeeded).toBe(2);
      expect(stopOutcome.skipped).toBe(1);
      expect(stopOutcome.skipReasons.inactive).toBe(1);
      expect(removeSpy).toHaveBeenCalledTimes(2);
      expect(runtime.getSubscriptions()).toHaveLength(0);

      // Runtime league lock 仍維持不變
      expect(runtime.getRuntimeLeague()).toBe('standard');

      // 所有 Bookmark 與 Custom Source 皆保留在列表且狀態為未啟用
      const snapAfter = sourceCtrl.read();
      expect(snapAfter.groups[0]!.items).toHaveLength(3);
      const customGroupAfter = snapAfter.groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(customGroupAfter).toBeDefined();
      expect(customGroupAfter!.items).toHaveLength(1);
      expect(customGroupAfter!.items[0]!.status).toBeUndefined();

      sourceCtrl.dispose();
    });
  });

  describe('Bookmark Folder Hierarchy Projection, Subtree Resolution, and Hierarchy Filter', () => {
    it('projects true multi-level folder hierarchy (root -> child -> grandchild) with real folder names, depth, parentId, and retains parent folders with 0 direct items when descendants have items', async () => {
      const fakeSource: LiveSearchBookmarkSourcePort = {
        async readCollection() {
          return {
            ok: true,
            value: {
              groups: [
                { id: 'f-equip', name: '裝備', order: 0, gameVersion: 'poe1' } as any,
                {
                  id: 'f-weapon',
                  name: '武器',
                  order: 0,
                  parentId: 'f-equip',
                  gameVersion: 'poe1',
                } as any,
                {
                  id: 'f-bow',
                  name: '弓',
                  order: 0,
                  parentId: 'f-weapon',
                  gameVersion: 'poe1',
                } as any,
                { id: 'f-other', name: '追蹤', order: 1, gameVersion: 'poe1' } as any,
                {
                  id: 'f-other-bow',
                  name: '弓',
                  order: 0,
                  parentId: 'f-other',
                  gameVersion: 'poe1',
                } as any,
                { id: 'f-empty-root', name: '空根目錄', order: 2, gameVersion: 'poe1' } as any,
                {
                  id: 'f-empty-child',
                  name: '空子目錄',
                  order: 0,
                  parentId: 'f-empty-root',
                  gameVersion: 'poe1',
                } as any,
              ],
              bookmarks: [
                {
                  id: 'bmk-bow',
                  name: '神弓',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIbow_search',
                  leaguePinned: true,
                  groupId: 'f-bow',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec-1',
                },
                {
                  id: 'bmk-other-bow',
                  name: '追蹤弓',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIother_bow',
                  leaguePinned: true,
                  groupId: 'f-other-bow',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec-2',
                },
              ],
            },
          };
        },
        subscribe: () => () => {},
      };

      const sourceCtrl = createLiveSearchSourceController(fakeSource, liveController);
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      const snapshot = sourceCtrl.read();
      // Retains ancestor chain for non-empty subtrees ('f-equip' -> 'f-weapon' -> 'f-bow', 'f-other' -> 'f-other-bow')
      // Omits 'f-empty-root' and 'f-empty-child' whose entire subtree has 0 projected sources
      expect(
        snapshot.groups.map((g) => ({
          id: g.id,
          name: g.name,
          parentId: g.parentId,
          depth: g.depth,
          directItemCount: g.items.length,
        })),
      ).toEqual([
        { id: 'f-equip', name: '裝備', parentId: undefined, depth: 0, directItemCount: 0 },
        { id: 'f-weapon', name: '武器', parentId: 'f-equip', depth: 1, directItemCount: 0 },
        { id: 'f-bow', name: '弓', parentId: 'f-weapon', depth: 2, directItemCount: 1 },
        { id: 'f-other', name: '追蹤', parentId: undefined, depth: 0, directItemCount: 0 },
        { id: 'f-other-bow', name: '弓', parentId: 'f-other', depth: 1, directItemCount: 1 },
      ]);

      const bowGroup = snapshot.groups.find((g) => g.id === 'f-bow')!;
      expect(bowGroup.name).toBe('弓');
      expect(bowGroup.items[0]!.name).toBe('神弓');
      expect(bowGroup.items[0]!.groupName).toBe('弓');
      expect(bowGroup.items[0]!.groupId).toBe('f-bow');

      // Subtree helper resolves all descendant items in canonical pre-order
      expect(getLiveSearchGroupSubtreeSourceIds(snapshot.groups, 'f-equip')).toEqual(['bmk-bow']);
      expect(getLiveSearchGroupSubtreeSourceIds(snapshot.groups, 'f-other')).toEqual([
        'bmk-other-bow',
      ]);

      sourceCtrl.dispose();
    });

    it('evaluates League-Scoped Source Projection before Folder Visibility while keeping wrong-version and invalid-url diagnostic items', async () => {
      const fakeSource: LiveSearchBookmarkSourcePort = {
        async readCollection() {
          return {
            ok: true,
            value: {
              groups: [
                { id: 'f-std-parent', name: '標準父層', order: 0, gameVersion: 'poe1' } as any,
                {
                  id: 'f-std-child',
                  name: '標準子層',
                  order: 0,
                  parentId: 'f-std-parent',
                  gameVersion: 'poe1',
                } as any,
                { id: 'f-hc-parent', name: '專家父層', order: 1, gameVersion: 'poe1' } as any,
                {
                  id: 'f-hc-child',
                  name: '專家子層',
                  order: 0,
                  parentId: 'f-hc-parent',
                  gameVersion: 'poe1',
                } as any,
                { id: 'f-diag-parent', name: '診斷父層', order: 2, gameVersion: 'poe1' } as any,
                {
                  id: 'f-diag-child',
                  name: '診斷子層',
                  order: 0,
                  parentId: 'f-diag-parent',
                  gameVersion: 'poe1',
                } as any,
              ],
              bookmarks: [
                {
                  id: 'bmk-std',
                  name: 'Standard Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIstd_1',
                  leaguePinned: true,
                  groupId: 'f-std-child',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec-std',
                },
                {
                  id: 'bmk-hc',
                  name: 'Hardcore Item',
                  url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_1',
                  leaguePinned: true,
                  groupId: 'f-hc-child',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec-hc',
                },
                {
                  id: 'bmk-poe2',
                  name: 'PoE2 Wrong Version Item',
                  url: 'https://www.pathofexile.com/trade2/search/poe2/Standard/H4sIpoe2_1',
                  leaguePinned: true,
                  groupId: 'f-diag-child',
                  order: 0,
                  gameVersion: 'poe2',
                  searchRecordId: 'rec-poe2',
                },
                {
                  id: 'bmk-invalid',
                  name: 'Invalid URL Item',
                  url: 'https://example.com/not-a-trade-url',
                  groupId: 'f-diag-child',
                  order: 1,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec-invalid',
                },
              ],
            },
          };
        },
        subscribe: () => () => {},
      };

      const sourceCtrl = createLiveSearchSourceController(fakeSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // In Standard workspace: f-hc-parent / f-hc-child have 0 projected items and are omitted;
      // f-std-* and f-diag-* (with wrong-version & invalid-url) are retained.
      expect(sourceCtrl.read().groups.map((g) => g.id)).toEqual([
        'f-std-parent',
        'f-std-child',
        'f-diag-parent',
        'f-diag-child',
      ]);

      // Switch to Hardcore workspace: f-std-* is omitted, f-hc-parent -> f-hc-child appears
      const switched = await sourceCtrl.switchLeague('Hardcore');
      expect(switched).toBe(true);
      expect(sourceCtrl.read().groups.map((g) => g.id)).toEqual([
        'f-hc-parent',
        'f-hc-child',
        'f-diag-parent',
        'f-diag-child',
      ]);

      sourceCtrl.dispose();
    });

    it('preserves canonical ordering for folders (by order & pre-order DFS), direct bookmarks (by order), ungrouped fallback, and Temporary Search', async () => {
      const fakeSource: LiveSearchBookmarkSourcePort = {
        async readCollection() {
          return {
            ok: true,
            value: {
              groups: [
                { id: 'f-root-b', name: 'Root B', order: 2, gameVersion: 'poe1' } as any,
                {
                  id: 'f-child-a2',
                  name: 'Child A2',
                  order: 2,
                  parentId: 'f-root-a',
                  gameVersion: 'poe1',
                } as any,
                { id: 'f-root-a', name: 'Root A', order: 1, gameVersion: 'poe1' } as any,
                {
                  id: 'f-child-a1',
                  name: 'Child A1',
                  order: 1,
                  parentId: 'f-root-a',
                  gameVersion: 'poe1',
                } as any,
              ],
              bookmarks: [
                {
                  id: 'b-a1-second',
                  name: 'A1 Second',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIa1_2',
                  leaguePinned: true,
                  groupId: 'f-child-a1',
                  order: 5,
                  gameVersion: 'poe1',
                  searchRecordId: 'r1',
                },
                {
                  id: 'b-a1-first',
                  name: 'A1 First',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIa1_1',
                  leaguePinned: true,
                  groupId: 'f-child-a1',
                  order: 1,
                  gameVersion: 'poe1',
                  searchRecordId: 'r2',
                },
                {
                  id: 'b-a2',
                  name: 'A2 Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIa2_1',
                  leaguePinned: true,
                  groupId: 'f-child-a2',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'r3',
                },
                {
                  id: 'b-root-b',
                  name: 'Root B Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIrb_1',
                  leaguePinned: true,
                  groupId: 'f-root-b',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'r4',
                },
                {
                  id: 'b-orphan',
                  name: 'Orphan Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIorphan_1',
                  leaguePinned: true,
                  groupId: 'non-existent-folder',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'r5',
                },
              ],
            },
          };
        },
        subscribe: () => () => {},
      };

      const sourceCtrl = createLiveSearchSourceController(fakeSource, liveController);
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      await sourceCtrl.addCustom('https://www.pathofexile.com/trade/search/Standard/H4sIcustom_1', {
        name: 'Temp Search 1',
      });

      const snapshot = sourceCtrl.read();
      expect(snapshot.groups.map((g) => ({ id: g.id, depth: g.depth, kind: g.kind }))).toEqual([
        { id: 'f-root-a', depth: 0, kind: 'bookmark' },
        { id: 'f-child-a1', depth: 1, kind: 'bookmark' },
        { id: 'f-child-a2', depth: 1, kind: 'bookmark' },
        { id: 'f-root-b', depth: 0, kind: 'bookmark' },
        { id: 'default_ungrouped', depth: 0, kind: 'bookmark' },
        { id: CUSTOM_SOURCE_GROUP_ID, depth: 0, kind: 'custom' },
      ]);

      // Direct bookmarks inside f-child-a1 are sorted by Bookmark order
      const childA1 = snapshot.groups.find((g) => g.id === 'f-child-a1')!;
      expect(childA1.items.map((i) => i.id)).toEqual(['b-a1-first', 'b-a1-second']);

      // Subtree of f-root-a collects f-child-a1 items then f-child-a2 items in canonical pre-order
      expect(getLiveSearchGroupSubtreeSourceIds(snapshot.groups, 'f-root-a')).toEqual([
        'b-a1-first',
        'b-a1-second',
        'b-a2',
      ]);

      sourceCtrl.dispose();
    });

    it('filters hierarchy-aware: retains ancestor chain on descendant item match, includes entire subtree on folder name match, and supports statusFilter', () => {
      const groups = [
        {
          id: 'f-equip',
          name: '裝備',
          kind: 'bookmark' as const,
          order: 0,
          depth: 0,
          items: [
            {
              kind: 'bookmark' as const,
              id: 'b-equip-direct',
              name: '基礎胸甲',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIeq_1',
              leaguePinned: true,
              canonicalIdentity: null,
              canonicalKey: null,
              compatibility: 'compatible' as const,
              groupId: 'f-equip',
              groupName: '裝備',
              status: 'idle' as const,
              pending: false,
              removable: false,
            },
          ],
          bookmarks: [],
        },
        {
          id: 'f-helmet',
          name: '頭盔',
          kind: 'bookmark' as const,
          parentId: 'f-equip',
          order: 0,
          depth: 1,
          items: [
            {
              kind: 'bookmark' as const,
              id: 'b-helmet-direct',
              name: '皇家頭盔',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhelm_1',
              leaguePinned: true,
              canonicalIdentity: null,
              canonicalKey: null,
              compatibility: 'compatible' as const,
              groupId: 'f-helmet',
              groupName: '頭盔',
              status: 'idle' as const,
              pending: false,
              removable: false,
            },
          ],
          bookmarks: [],
        },
        {
          id: 'f-high',
          name: '高價',
          kind: 'bookmark' as const,
          parentId: 'f-helmet',
          order: 0,
          depth: 2,
          items: [
            {
              kind: 'bookmark' as const,
              id: 'b-hh',
              name: 'Headhunter',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhh_1',
              leaguePinned: true,
              canonicalIdentity: null,
              canonicalKey: null,
              compatibility: 'compatible' as const,
              groupId: 'f-high',
              groupName: '高價',
              status: 'active' as const,
              pending: false,
              removable: false,
            },
          ],
          bookmarks: [],
        },
        {
          id: 'f-gloves',
          name: '手套',
          kind: 'bookmark' as const,
          parentId: 'f-equip',
          order: 1,
          depth: 1,
          items: [
            {
              kind: 'bookmark' as const,
              id: 'b-gloves',
              name: '扣釘手套',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIgloves_1',
              leaguePinned: true,
              canonicalIdentity: null,
              canonicalKey: null,
              compatibility: 'compatible' as const,
              groupId: 'f-gloves',
              groupName: '手套',
              status: 'idle' as const,
              pending: false,
              removable: false,
            },
          ],
          bookmarks: [],
        },
      ];

      // 1. Descendant item match ('Headhunter'): retains f-equip -> f-helmet -> f-high, hides f-gloves,
      // and ancestor folders have items: [] so only the matched item is in filtered items!
      const byDescendantItem = filterLiveSearchSourceGroups(groups, { query: 'headhunter' });
      expect(
        byDescendantItem.map((g) => ({
          id: g.id,
          depth: g.depth,
          itemIds: g.items.map((i) => i.id),
        })),
      ).toEqual([
        { id: 'f-equip', depth: 0, itemIds: [] },
        { id: 'f-helmet', depth: 1, itemIds: [] },
        { id: 'f-high', depth: 2, itemIds: ['b-hh'] },
      ]);

      // 2. Folder name match ('頭盔'): retains ancestor f-equip (with items: []), f-helmet, and child f-high (with all its items)
      const byFolderName = filterLiveSearchSourceGroups(groups, { query: '頭盔' });
      expect(
        byFolderName.map((g) => ({
          id: g.id,
          depth: g.depth,
          itemIds: g.items.map((i) => i.id),
        })),
      ).toEqual([
        { id: 'f-equip', depth: 0, itemIds: [] },
        { id: 'f-helmet', depth: 1, itemIds: ['b-helmet-direct'] },
        { id: 'f-high', depth: 2, itemIds: ['b-hh'] },
      ]);

      // 3. Folder name match + statusFilter ('頭盔' + 'enabled'): only b-hh is enabled, so f-helmet has items: [] and f-high has ['b-hh']
      const byFolderAndStatus = filterLiveSearchSourceGroups(groups, {
        query: '頭盔',
        statusFilter: 'enabled',
      });
      expect(
        byFolderAndStatus.map((g) => ({
          id: g.id,
          depth: g.depth,
          itemIds: g.items.map((i) => i.id),
        })),
      ).toEqual([
        { id: 'f-equip', depth: 0, itemIds: [] },
        { id: 'f-helmet', depth: 1, itemIds: [] },
        { id: 'f-high', depth: 2, itemIds: ['b-hh'] },
      ]);
    });

    it('handles corrupt / orphan hierarchy metadata (missing parentId, self-parent, and 2-node cycle) without recursion loops, dropped sources, or duplicate nodes', async () => {
      const fakeSource: LiveSearchBookmarkSourcePort = {
        async readCollection() {
          return {
            ok: true,
            value: {
              groups: [
                {
                  id: 'f-missing-parent',
                  name: '孤兒資料夾',
                  order: 0,
                  parentId: 'does-not-exist',
                  gameVersion: 'poe1',
                } as any,
                {
                  id: 'f-self',
                  name: '自指資料夾',
                  order: 1,
                  parentId: 'f-self',
                  gameVersion: 'poe1',
                } as any,
                {
                  id: 'f-cycle-a',
                  name: '循環 A',
                  order: 2,
                  parentId: 'f-cycle-b',
                  gameVersion: 'poe1',
                } as any,
                {
                  id: 'f-cycle-b',
                  name: '循環 B',
                  order: 3,
                  parentId: 'f-cycle-a',
                  gameVersion: 'poe1',
                } as any,
              ],
              bookmarks: [
                {
                  id: 'b-missing-parent',
                  name: 'Orphan Folder Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sImp_1',
                  leaguePinned: true,
                  groupId: 'f-missing-parent',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'r-mp',
                },
                {
                  id: 'b-self',
                  name: 'Self Folder Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIself_1',
                  leaguePinned: true,
                  groupId: 'f-self',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'r-self',
                },
                {
                  id: 'b-cycle-b',
                  name: 'Cycle B Item',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcycb_1',
                  leaguePinned: true,
                  groupId: 'f-cycle-b',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'r-cycb',
                },
              ],
            },
          };
        },
        subscribe: () => () => {},
      };

      const sourceCtrl = createLiveSearchSourceController(fakeSource, liveController);
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      const snapshot = sourceCtrl.read();
      expect(
        snapshot.groups.map((g) => ({
          id: g.id,
          parentId: g.parentId,
          depth: g.depth,
          itemIds: g.items.map((i) => i.id),
        })),
      ).toEqual([
        { id: 'f-missing-parent', parentId: undefined, depth: 0, itemIds: ['b-missing-parent'] },
        { id: 'f-self', parentId: undefined, depth: 0, itemIds: ['b-self'] },
        { id: 'f-cycle-a', parentId: undefined, depth: 0, itemIds: [] },
        { id: 'f-cycle-b', parentId: 'f-cycle-a', depth: 1, itemIds: ['b-cycle-b'] },
      ]);

      expect(getLiveSearchGroupSubtreeItems(snapshot.groups, 'f-cycle-a').map((i) => i.id)).toEqual(
        ['b-cycle-b'],
      );

      sourceCtrl.dispose();
    });
  });

  describe('League Context & Switch Correctness Regressions', () => {
    it('[Regression 1] Interleaving: delayed first add in batch -> switch league -> unblock add -> remaining batch aborted and runtime not locked to old league', async () => {
      const customSource: LiveSearchBookmarkSourcePort = {
        async readCollection() {
          return {
            ok: true,
            value: {
              groups: [{ id: 'g1', name: 'G1', order: 0 } as any],
              bookmarks: [
                {
                  id: 'bmk_std_1',
                  name: 'Std Item 1',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_std_1',
                  leaguePinned: true,
                  groupId: 'g1',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec_std_1',
                },
                {
                  id: 'bmk_std_2',
                  name: 'Std Item 2',
                  url: 'https://www.pathofexile.com/trade/search/Standard/H4sIitem_std_2',
                  leaguePinned: true,
                  groupId: 'g1',
                  order: 1,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec_std_2',
                },
                {
                  id: 'bmk_hc_1',
                  name: 'HC Item 1',
                  url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIitem_hc_1',
                  leaguePinned: true,
                  groupId: 'g1',
                  order: 2,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec_hc_1',
                },
              ],
            },
          };
        },
        subscribe: () => () => {},
      };

      let unblockFirstAdd!: () => void;
      const firstAddGate = new Promise<void>((resolve) => {
        unblockFirstAdd = resolve;
      });
      const originalAddFromUrl = liveController.addFromUrl.bind(liveController);
      const addCalls: string[] = [];

      liveController.addFromUrl = vi.fn().mockImplementation(async (url: string, options?: any) => {
        addCalls.push(url);
        if (url.includes('H4sIitem_std_1')) {
          await firstAddGate;
        }
        return originalAddFromUrl(url, options);
      });

      const sourceCtrl = createLiveSearchSourceController(customSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 啟動 Standard 批次啟用 (包含 bmk_std_1 與 bmk_std_2)
      const batchPromise = sourceCtrl.enableMany(['bmk_std_1', 'bmk_std_2']);

      // 等待 bmk_std_1 進入 addFromUrl 並被閘門阻擋
      await vi.waitFor(() => expect(addCalls.length).toBe(1));

      // 在 bmk_std_1 in-flight 期間，發起切換聯盟到 Hardcore
      const switchPromise = sourceCtrl.switchLeague('Hardcore');

      // 放行 bmk_std_1 的 addFromUrl
      unblockFirstAdd();

      const [batchOutcome, switchSuccess] = await Promise.all([batchPromise, switchPromise]);

      expect(switchSuccess).toBe(true);
      expect(sourceCtrl.read().selectedLeague).toBe('Hardcore');

      // bmk_std_2 絕不得被執行（被 generation / league mismatch 中斷）
      expect(addCalls).not.toContain(expect.stringContaining('H4sIitem_std_2'));

      // batchOutcome 失敗
      expect(batchOutcome.success).toBe(false);

      // Runtime 不得被 Standard 鎖定，且無連線中訂閱
      const runtimeSnap = liveController.read();
      expect(runtimeSnap.subscriptions.filter((s) => s.status !== 'closed')).toHaveLength(0);
      expect(runtimeSnap.runtimeLeague).toBeNull();

      // 最終 selectedLeague 與 Host container context 必須一致為 Hardcore
      expect(hostClient.committedHostLeague).toBe('Hardcore');
      const lastEnsure = hostClient.ensureCalls[hostClient.ensureCalls.length - 1];
      expect(lastEnsure?.league).toBe('Hardcore');

      sourceCtrl.dispose();
    });

    it('[Regression 2] Rapid consecutive league switches: deterministic serialization and switching guard maintained', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 連續快速呼叫 switchLeague('LeagueA') -> switchLeague('LeagueB')
      const p1 = sourceCtrl.switchLeague('LeagueA');
      const p2 = sourceCtrl.switchLeague('LeagueB');

      expect(sourceCtrl.read().isSwitchingLeague).toBe(true);

      const enableAttempt = await sourceCtrl.enable('bmk_1');
      expect(enableAttempt.success).toBe(false);
      expect(enableAttempt.error).toContain('正在切換聯盟中');

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res2).toBe(true);

      const finalSnap = sourceCtrl.read();
      expect(finalSnap.selectedLeague).toBe('LeagueB');
      expect(finalSnap.isSwitchingLeague).toBe(false);

      sourceCtrl.dispose();
    });

    it('[Regression 3] Temporary Search metadata preserved across league switches and reappears inactive on return', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      const addRes = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sItemp_preserve_123',
        { name: '暫存項目' },
      );
      expect(addRes.success).toBe(true);

      const stdSnap1 = sourceCtrl.read();
      const customGroup1 = stdSnap1.groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(customGroup1).toBeDefined();
      expect(customGroup1!.items).toHaveLength(1);
      expect(customGroup1!.items[0].name).toBe('暫存項目');

      await sourceCtrl.switchLeague('Hardcore');
      const hcSnap = sourceCtrl.read();
      const hcCustomGroup = hcSnap.groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(hcCustomGroup).toBeUndefined();

      await sourceCtrl.switchLeague('Standard');
      const stdSnap2 = sourceCtrl.read();
      const customGroup2 = stdSnap2.groups.find((g) => g.id === CUSTOM_SOURCE_GROUP_ID);
      expect(customGroup2).toBeDefined();
      expect(customGroup2!.items).toHaveLength(1);
      expect(customGroup2!.items[0].name).toBe('暫存項目');
      expect(customGroup2!.items[0].canonicalIdentity?.searchId).toBe('H4sItemp_preserve_123');
      expect(customGroup2!.items[0].status).toBeUndefined();

      sourceCtrl.dispose();
    });

    it('[Regression 4] Startup readiness: no preference, no resume, official fetch fails, bookmark only Hardcore -> resolves to Hardcore without provisional Standard decision', async () => {
      const fakeSource: LiveSearchBookmarkSourcePort = {
        async readCollection() {
          return {
            ok: true,
            value: {
              groups: [{ id: 'g_hc', name: 'HC Folder', order: 0 } as any],
              bookmarks: [
                {
                  id: 'bmk_hc_only',
                  name: 'HC 項目',
                  url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_startup_item',
                  leaguePinned: true,
                  groupId: 'g_hc',
                  order: 0,
                  gameVersion: 'poe1',
                  searchRecordId: 'rec_hc_only',
                },
              ],
            },
          };
        },
        subscribe: () => () => {},
      };

      const resumeStorage: LiveSearchResumeStorage = {
        async get() {
          return {};
        },
        async set() {},
        async remove() {},
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

      const prefStorage = createInMemoryPreferencesStorage();
      const prefOutcome = await createPreferencesModule('poe1', prefStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
      const prefModule = prefOutcome.value;

      const failingFetchLeagues = vi.fn().mockRejectedValue(new Error('Network error'));

      const sourceCtrl = createLiveSearchSourceController(fakeSource, liveController, {
        preferences: prefModule,
        resumeStore,
        fetchLeagues: failingFetchLeagues,
      });

      const resumeCtrl = createLiveSearchResumeController({
        version: 'poe1',
        preferences: prefModule,
        sourceController: sourceCtrl,
        resumeStore,
      });

      const resumeSnapshots: any[] = [];
      resumeCtrl.subscribe((s) => resumeSnapshots.push(s));

      await vi.waitFor(() => {
        expect(sourceCtrl.read().loading).toBe(false);
        expect(sourceCtrl.read().leagueResolved).toBe(true);
      });

      expect(sourceCtrl.read().selectedLeague.toLowerCase()).toBe('hardcore');

      for (const snap of resumeSnapshots) {
        if (snap.state === 'prompted' || snap.state === 'restored') {
          expect(snap.resumableSourceIds).not.toContain('Standard');
        }
      }

      sourceCtrl.dispose();
      resumeCtrl.dispose?.();
    });

    it('[Regression 5] League switch immediately clears and rebinds Host container context without enabling new source', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 1. 在 Standard 下啟用一個搜尋並模擬收到資料
      await sourceCtrl.enable('bmk_1');
      const ws = createdSockets[0];
      ws.simulateMessage(JSON.stringify({ result: 'std_token_res', count: 1 }));
      await vi.waitFor(() => expect(runtime.getSnapshot().cumulativeRenderedTotal).toBe(1));

      // 2. 切換聯盟至 Hardcore，且不啟用任何 Hardcore 來源
      const switchSuccess = await sourceCtrl.switchLeague('Hardcore');
      expect(switchSuccess).toBe(true);
      expect(sourceCtrl.read().selectedLeague).toBe('Hardcore');

      // 3. 驗證 hostClient 收到包含 Hardcore、resetResults: true 的 ensureContainer 呼叫
      const lastEnsure = hostClient.ensureCalls[hostClient.ensureCalls.length - 1];
      expect(lastEnsure).toBeDefined();
      expect(lastEnsure.league).toBe('Hardcore');
      expect(lastEnsure.realm).toBe('pc');
      expect(lastEnsure.resetResults).toBe(true);

      // 4. 驗證 cumulativeRenderedTotal 已歸零且 subscriptions 已清空
      expect(runtime.getSnapshot().cumulativeRenderedTotal).toBe(0);
      expect(runtime.getSubscriptions()).toHaveLength(0);

      sourceCtrl.dispose();
    });

    it('[Regression 6] Rapid switch back to original league before first switch completes resolves to original league and cleans up guard', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 設定延遲以模擬真實非同步切換
      hostClient.ensureDelayMs = 20;

      // 目前為 Standard：連續快速切換 Hardcore -> Standard
      const p1 = sourceCtrl.switchLeague('Hardcore');
      const p2 = sourceCtrl.switchLeague('Standard');

      expect(sourceCtrl.read().isSwitchingLeague).toBe(true);

      const [res1, res2] = await Promise.all([p1, p2]);

      // latest requested switch wins
      expect(res2).toBe(true);
      const snap = sourceCtrl.read();
      expect(snap.selectedLeague).toBe('Standard');
      expect(snap.isSwitchingLeague).toBe(false);

      // 最終 Host container 的 rebind 目標聯盟為 Standard
      const lastEnsure = hostClient.ensureCalls[hostClient.ensureCalls.length - 1];
      expect(lastEnsure).toBeDefined();
      expect(lastEnsure.league).toBe('Standard');
      expect(lastEnsure.resetResults).toBe(true);
      expect(hostClient.committedHostLeague).toBe('Standard');

      hostClient.ensureDelayMs = 0;
      sourceCtrl.dispose();
    });

    it('[Regression 7] Standard -> Hardcore first Host rebind failure: never produces selectedLeague=Standard / Host=Hardcore split state and returns false', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 先在 Standard 下啟用一筆搜尋，確保 Host container 為 Standard
      const enableRes = await sourceCtrl.enable('bmk_1');
      expect(enableRes.success).toBe(true);
      expect(hostClient.committedHostLeague.toLowerCase()).toBe('standard');

      // 模擬第一次 Hardcore rebind 失敗，但若後續再呼叫則會成功
      let hardcoreEnsureCount = 0;
      hostClient.ensureHandler = (options) => {
        if (options.league.toLowerCase() === 'hardcore') {
          hardcoreEnsureCount += 1;
          if (hardcoreEnsureCount === 1) {
            return { success: false, error: 'First Hardcore rebind failed' };
          }
        }
        return { success: true };
      };

      const switchResult = await sourceCtrl.switchLeague('Hardcore');

      expect(switchResult).toBe(false);
      expect(sourceCtrl.read().selectedLeague).toBe('Standard');
      expect(sourceCtrl.read().isSwitchingLeague).toBe(false);

      // finally 不得再次嘗試將 Host rebind 成 Hardcore，杜絕 Source=Standard / Host=Hardcore split state
      expect(hardcoreEnsureCount).toBe(1);
      expect(hostClient.committedHostLeague.toLowerCase()).toBe('standard');

      sourceCtrl.dispose();
    });

    it('[Regression 8] Persistent Host rebind failure: switchLeague resolves false without rejecting, clears switching guard, and preserves Resume Intent', async () => {
      let persistedState: Record<string, unknown> = {};
      const resumeStorage: LiveSearchResumeStorage = {
        async get(keys) {
          const res: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in persistedState) res[k] = persistedState[k];
          }
          return res;
        },
        async set(items) {
          persistedState = { ...persistedState, ...items };
        },
        async remove(keys) {
          for (const k of keys) {
            delete persistedState[k];
          }
        },
      };
      const resumeStore = createLiveSearchResumeStore('poe1', resumeStorage);

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
        resumeStore,
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 在 Standard 啟用一筆書籤，建立 Resume Intent
      const enableRes = await sourceCtrl.enable('bmk_1');
      expect(enableRes.success).toBe(true);
      const initialRead = await resumeStore.read();
      expect(initialRead.ok).toBe(true);
      if (initialRead.ok) {
        expect(initialRead.value.identities).toHaveLength(1);
      }

      // 設定 Host rebind 持續失敗
      hostClient.ensureHandler = () => ({
        success: false,
        error: 'Persistent Host rebind failure',
      });

      await expect(sourceCtrl.switchLeague('Hardcore')).resolves.toBe(false);

      const snapAfterFail = sourceCtrl.read();
      expect(snapAfterFail.selectedLeague).toBe('Standard');
      expect(snapAfterFail.isSwitchingLeague).toBe(false);
      expect(hostClient.committedHostLeague.toLowerCase()).toBe('standard');

      // Resume Intent 不受影響
      const afterFailRead = await resumeStore.read();
      expect(afterFailRead.ok).toBe(true);
      if (afterFailRead.ok) {
        expect(afterFailRead.value.identities).toHaveLength(1);
        expect(afterFailRead.value.identities[0].league.toLowerCase()).toBe('standard');
      }

      // 當 Host 恢復正常後，pendingTargetLeague 已清除，重新切換至 Hardcore 可正常成功
      hostClient.ensureHandler = undefined;
      const retrySwitch = await sourceCtrl.switchLeague('Hardcore');
      expect(retrySwitch).toBe(true);
      expect(sourceCtrl.read().selectedLeague).toBe('Hardcore');
      expect(hostClient.committedHostLeague).toBe('Hardcore');

      sourceCtrl.dispose();
    });

    it('[Regression 9] Rapid superseded switch + latest Host failure: superseded Hardcore switch does not leave Host committed to Hardcore when latest Standard switch fails, and workspace remains operable', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      // 先在 Standard 啟用一筆搜尋，確立 Host=Standard
      const initialEnable = await sourceCtrl.enable('bmk_1');
      expect(initialEnable.success).toBe(true);
      expect(hostClient.committedHostLeague.toLowerCase()).toBe('standard');

      // 設定：Hardcore Host rebind 會成功，但 Standard Host rebind 失敗
      hostClient.ensureHandler = (options) => {
        if (options.league.toLowerCase() === 'hardcore') {
          return { success: true };
        }
        if (options.league.toLowerCase() === 'standard') {
          return { success: false, error: 'Standard Host rebind failed' };
        }
        return { success: true };
      };

      const p1 = sourceCtrl.switchLeague('Hardcore');
      const p2 = sourceCtrl.switchLeague('Standard');

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(false);
      expect(res2).toBe(false);

      // 最終 Source / Runtime target / Host 不得 split，一致維持 Standard
      const finalSnap = sourceCtrl.read();
      expect(finalSnap.isSwitchingLeague).toBe(false);
      expect(finalSnap.selectedLeague.toLowerCase()).toBe(
        hostClient.committedHostLeague.toLowerCase(),
      );
      expect(finalSnap.selectedLeague).toBe('Standard');

      // 當 Host 恢復可操作後，workspace 對最終一致的 Standard league 仍可正常執行 enable（不被錯誤的 activeTargetLeague=hardcore 拒絕）
      hostClient.ensureHandler = undefined;
      const reEnable = await sourceCtrl.enable('bmk_1');
      expect(reEnable.success).toBe(true);

      sourceCtrl.dispose();
    });

    it('[Regression 10] Rapid in-flight superseded switch + latest Host failure: when p1 Hardcore Host rebind already succeeded in-flight before p2 Standard Host rebind fails, Source / Runtime target / Host converge consistently and workspace remains operable', async () => {
      bookmarkSource.collection.bookmarks.push({
        id: 'bmk_hc_test',
        name: 'HC 測試書籤',
        url: 'https://www.pathofexile.com/trade/search/Hardcore/H4sIhc_search_1',
        leaguePinned: true,
        groupId: 'group_1',
        searchRecordId: 'rec_hc_1',
        gameVersion: 'poe1',
        order: 3,
      });
      bookmarkSource.triggerChange();

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      let p2Promise!: Promise<boolean>;
      hostClient.ensureHandler = (options) => {
        if (options.league.toLowerCase() === 'hardcore') {
          // 在 p1 正在執行 Hardcore Host rebind 期間發起 p2('Standard')，使 p1 在 Host rebind 完成當下已被 supersede
          p2Promise = sourceCtrl.switchLeague('Standard');
          return { success: true };
        }
        if (options.league.toLowerCase() === 'standard') {
          return { success: false, error: 'Standard Host rebind failed' };
        }
        return { success: true };
      };

      const p1Promise = sourceCtrl.switchLeague('Hardcore');
      const res1 = await p1Promise;
      const res2 = await p2Promise;

      expect(res1).toBe(false);
      expect(res2).toBe(false);

      // 最終 Source / Runtime target / Host 不得 split，一致收斂於 Hardcore
      const finalSnap = sourceCtrl.read();
      expect(finalSnap.isSwitchingLeague).toBe(false);
      expect(finalSnap.selectedLeague.toLowerCase()).toBe(
        hostClient.committedHostLeague.toLowerCase(),
      );
      expect(finalSnap.selectedLeague).toBe('Hardcore');

      // workspace 仍可對最終一致的 Hardcore league 正常執行 enable
      hostClient.ensureHandler = undefined;
      const hcEnable = await sourceCtrl.enable('bmk_hc_test');
      expect(hcEnable.success).toBe(true);

      sourceCtrl.dispose();
    });

    it('[Regression 11 / Case A] Rapid Standard -> Hardcore -> Standard with slower Hardcore storage write: serialized persistence guarantees final persisted liveSearchSelectedLeague is Standard', async () => {
      const storageKey = getPreferenceStorageKey('liveSearchSelectedLeague', 'poe1');
      const persistedData: Record<string, unknown> = {
        [storageKey]: 'Standard',
      };
      const storageListeners = new Set<
        (changes: Record<string, unknown>) => void | Promise<void>
      >();
      const delayedStorage: PreferencesStorage = {
        async get(keys) {
          return Object.fromEntries(
            keys.filter((k) => k in persistedData).map((k) => [k, persistedData[k]]),
          );
        },
        async set(values) {
          const targetLeague = values[storageKey];
          // 刻意讓 Standard 寫入延遲極短 (5ms)、Hardcore 寫入延遲較長 (40ms)
          // 若未序列化，Standard persistence 會先完成、Hardcore persistence 後完成並錯誤覆寫
          if (targetLeague === 'Hardcore') {
            await new Promise((r) => setTimeout(r, 40));
          } else if (targetLeague === 'Standard') {
            await new Promise((r) => setTimeout(r, 5));
          }
          Object.assign(persistedData, values);
          for (const listener of storageListeners) {
            await listener(values);
          }
        },
        subscribe(listener) {
          storageListeners.add(listener);
          return () => storageListeners.delete(listener);
        },
      };

      const prefOutcome = await createPreferencesModule('poe1', delayedStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
      const prefModule = prefOutcome.value;

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
        preferences: prefModule,
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      let p2Promise!: Promise<boolean>;
      hostClient.ensureHandler = (options) => {
        if (options.league.toLowerCase() === 'hardcore') {
          // 確保第一次 Hardcore Host switch 實際執行成功，並緊接著發起第二次 Standard switch
          p2Promise = sourceCtrl.switchLeague('Standard');
          return { success: true };
        }
        return { success: true };
      };

      const p1Promise = sourceCtrl.switchLeague('Hardcore');
      const res1 = await p1Promise;
      const res2 = await p2Promise;

      expect(res1).toBe(false);
      expect(res2).toBe(true);

      // 等待超過 Hardcore 寫入延遲，確認不會有任何殘留背景寫入翻轉結果
      await new Promise((r) => setTimeout(r, 50));

      expect(sourceCtrl.read().selectedLeague).toBe('Standard');
      expect(hostClient.committedHostLeague).toBe('Standard');
      expect(prefModule.read().liveSearchSelectedLeague).toBe('Standard');
      expect(persistedData[storageKey]).toBe('Standard');

      sourceCtrl.dispose();
    });

    it('[Regression 12 / Case B] Superseded Hardcore Host rebind succeeds then latest Standard Host rebind fails: fallback Hardcore workspace is persisted to Preferences SSOT', async () => {
      const storageKey = getPreferenceStorageKey('liveSearchSelectedLeague', 'poe1');
      const prefStorage = createInMemoryPreferencesStorage({
        [storageKey]: 'Standard',
      });
      const prefOutcome = await createPreferencesModule('poe1', prefStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
      const prefModule = prefOutcome.value;

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
        preferences: prefModule,
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      let p2Promise!: Promise<boolean>;
      hostClient.ensureHandler = (options) => {
        if (options.league.toLowerCase() === 'hardcore') {
          p2Promise = sourceCtrl.switchLeague('Standard');
          return { success: true };
        }
        if (options.league.toLowerCase() === 'standard') {
          return { success: false, error: 'Standard Host rebind failed' };
        }
        return { success: true };
      };

      const p1Promise = sourceCtrl.switchLeague('Hardcore');
      const res1 = await p1Promise;
      const res2 = await p2Promise;

      expect(res1).toBe(false);
      expect(res2).toBe(false);

      expect(sourceCtrl.read().selectedLeague).toBe('Hardcore');
      expect(hostClient.committedHostLeague).toBe('Hardcore');
      expect(prefModule.read().liveSearchSelectedLeague).toBe('Hardcore');
      expect(prefStorage.inspect()[storageKey]).toBe('Hardcore');

      sourceCtrl.dispose();
    });

    it('[Regression 13 / Case C] Preferences storage update failure is non-blocking: does not rollback succeeded Runtime/Host switch, avoids Source/Host split, and produces no unhandled rejection', async () => {
      const storageKey = getPreferenceStorageKey('liveSearchSelectedLeague', 'poe1');
      const failingPrefStorage = createInMemoryPreferencesStorage(
        { [storageKey]: 'Standard' },
        { setError: 'Preferences storage write unavailable' },
      );
      const prefOutcome = await createPreferencesModule('poe1', failingPrefStorage);
      if (!prefOutcome.ok) throw new Error(prefOutcome.error.message);
      const prefModule = prefOutcome.value;

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
        preferences: prefModule,
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      await expect(sourceCtrl.switchLeague('Hardcore')).resolves.toBe(true);

      const snap = sourceCtrl.read();
      expect(snap.selectedLeague).toBe('Hardcore');
      expect(snap.isSwitchingLeague).toBe(false);
      expect(hostClient.committedHostLeague).toBe('Hardcore');

      sourceCtrl.dispose();
    });
  });

  describe('Bookmark Cover Thumbnail Projection & PoE CDN Validation', () => {
    it('projects valid PoE CDN coverImageUrl (web.poecdn.com / webtw.poecdn.com) to LiveSearchSourceItem', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'group_cdn', name: '裝備', order: 0 } as any],
        bookmarks: [
          {
            id: 'bmk_cdn_global',
            name: '全球 CDN 封面',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcdn_global',
            leaguePinned: true,
            groupId: 'group_cdn',
            searchRecordId: 'rec_cdn_1',
            gameVersion: 'poe1',
            order: 0,
            coverImageUrl: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjExMSJ9XQ/test.png',
          },
          {
            id: 'bmk_cdn_tw',
            name: '台服 CDN 封面',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIcdn_tw',
            leaguePinned: true,
            groupId: 'group_cdn',
            searchRecordId: 'rec_cdn_2',
            gameVersion: 'poe1',
            order: 1,
            coverImageUrl:
              'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjIyMiJ9XQ/test_tw.png',
          },
        ],
      };

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      const snap = sourceCtrl.read();
      const group = snap.groups.find((g) => g.id === 'group_cdn');
      expect(group).toBeDefined();

      const itemGlobal = group?.items.find((i) => i.id === 'bmk_cdn_global');
      expect(itemGlobal?.coverImageUrl).toBe(
        'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjExMSJ9XQ/test.png',
      );

      const itemTw = group?.items.find((i) => i.id === 'bmk_cdn_tw');
      expect(itemTw?.coverImageUrl).toBe(
        'https://webtw.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjIyMiJ9XQ/test_tw.png',
      );

      sourceCtrl.dispose();
    });

    it('defensively rejects non-PoE-CDN or malformed URLs and projects undefined coverImageUrl', async () => {
      bookmarkSource.collection = {
        groups: [{ id: 'group_invalid_cdn', name: '惡意或非 CDN', order: 0 } as any],
        bookmarks: [
          {
            id: 'bmk_http',
            name: 'Insecure HTTP',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhttp_test',
            leaguePinned: true,
            groupId: 'group_invalid_cdn',
            searchRecordId: 'rec_http',
            gameVersion: 'poe1',
            order: 0,
            coverImageUrl: 'http://web.poecdn.com/image.png',
          },
          {
            id: 'bmk_evil_domain',
            name: 'External Domain',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdomain_test',
            leaguePinned: true,
            groupId: 'group_invalid_cdn',
            searchRecordId: 'rec_evil',
            gameVersion: 'poe1',
            order: 1,
            coverImageUrl: 'https://evil-site.com/image.png',
          },
          {
            id: 'bmk_js',
            name: 'Javascript Protocol',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIjs_test',
            leaguePinned: true,
            groupId: 'group_invalid_cdn',
            searchRecordId: 'rec_js',
            gameVersion: 'poe1',
            order: 2,
            coverImageUrl: 'javascript:alert(1)',
          },
          {
            id: 'bmk_data_uri',
            name: 'Data URI',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIdata_test',
            leaguePinned: true,
            groupId: 'group_invalid_cdn',
            searchRecordId: 'rec_data',
            gameVersion: 'poe1',
            order: 3,
            coverImageUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
          {
            id: 'bmk_no_cover',
            name: '未帶封面',
            url: 'https://www.pathofexile.com/trade/search/Standard/H4sIno_cover_test',
            leaguePinned: true,
            groupId: 'group_invalid_cdn',
            searchRecordId: 'rec_none',
            gameVersion: 'poe1',
            order: 4,
          },
        ],
      };

      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      const snap = sourceCtrl.read();
      const group = snap.groups.find((g) => g.id === 'group_invalid_cdn');
      expect(group).toBeDefined();

      for (const item of group?.items ?? []) {
        expect(item.coverImageUrl).toBeUndefined();
      }

      sourceCtrl.dispose();
    });

    it('ensures Temporary Search (custom) never synthesizes or receives coverImageUrl', async () => {
      const sourceCtrl = createLiveSearchSourceController(bookmarkSource, liveController, {
        initialLeague: 'Standard',
      });
      await vi.waitFor(() => expect(sourceCtrl.read().loading).toBe(false));

      const addRes = await sourceCtrl.addCustom(
        'https://www.pathofexile.com/trade/search/Standard/H4sIcustom_cover_test',
        { name: '暫時搜尋測試' },
      );
      expect(addRes.success).toBe(true);

      const snap = sourceCtrl.read();
      const customGroup = snap.groups.find((g) => g.kind === 'custom');
      expect(customGroup).toBeDefined();
      expect(customGroup?.items[0].coverImageUrl).toBeUndefined();

      sourceCtrl.dispose();
    });

    it('retains projected coverImageUrl during filterLiveSearchSourceGroups keyword and status filtering', async () => {
      const sampleGroups = [
        {
          id: 'f_armor',
          name: '防具',
          kind: 'bookmark' as const,
          depth: 0,
          items: [
            {
              kind: 'bookmark' as const,
              id: 'item_helm',
              name: '極品頭盔',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIhelm',
              leaguePinned: true,
              canonicalIdentity: null,
              canonicalKey: 'poe1/Standard/H4sIhelm',
              compatibility: 'compatible' as const,
              groupId: 'f_armor',
              groupName: '防具',
              pending: false,
              removable: false,
              coverImageUrl: 'https://web.poecdn.com/gen/image/helm.png',
            },
            {
              kind: 'bookmark' as const,
              id: 'item_boots',
              name: '極品鞋子',
              url: 'https://www.pathofexile.com/trade/search/Standard/H4sIboots',
              leaguePinned: true,
              canonicalIdentity: null,
              canonicalKey: 'poe1/Standard/H4sIboots',
              compatibility: 'compatible' as const,
              groupId: 'f_armor',
              groupName: '防具',
              pending: false,
              removable: false,
            },
          ],
          bookmarks: [],
        },
      ];

      // 1. Keyword search '頭盔' -> matches item_helm
      const filtered = filterLiveSearchSourceGroups(sampleGroups, { query: '頭盔' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].items.length).toBe(1);
      expect(filtered[0].items[0].id).toBe('item_helm');
      expect(filtered[0].items[0].coverImageUrl).toBe('https://web.poecdn.com/gen/image/helm.png');

      // 2. Status search 'all' -> both retained with coverImageUrl integrity
      const allFiltered = filterLiveSearchSourceGroups(sampleGroups, { statusFilter: 'all' });
      expect(allFiltered[0].items[0].coverImageUrl).toBe(
        'https://web.poecdn.com/gen/image/helm.png',
      );
      expect(allFiltered[0].items[1].coverImageUrl).toBeUndefined();
    });
  });
});
