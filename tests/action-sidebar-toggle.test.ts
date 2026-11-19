import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACTION_POPUP,
  registerActionSidebarToggle,
  resolveActionPopupForUrl,
  toggleSidebarCollapsedForVersion,
  type ActionApiLike,
  type ActionRuntimeApiLike,
  type ActionSidebarStorage,
  type ActionTabLike,
  type ActionTabsApiLike,
} from '@/utils/action-sidebar-toggle';

function createListenerRegistry<T extends (...args: any[]) => void>() {
  const listeners = new Set<T>();
  return {
    addListener: vi.fn((cb: T) => {
      listeners.add(cb);
    }),
    removeListener: vi.fn((cb: T) => {
      listeners.delete(cb);
    }),
    emit(...args: Parameters<T>) {
      for (const cb of listeners) {
        cb(...args);
      }
    },
    size: () => listeners.size,
  };
}

function createHarness(
  initialTabs: ActionTabLike[] = [],
  initialStorage: Record<string, any> = {},
) {
  const store: Record<string, any> = { ...initialStorage };
  const tabMap = new Map<number, ActionTabLike>();
  for (const t of initialTabs) {
    if (t.id !== undefined) tabMap.set(t.id, t);
  }

  const onClicked = createListenerRegistry<(tab: ActionTabLike) => void>();
  const onCreated = createListenerRegistry<(tab: ActionTabLike) => void>();
  const onUpdated =
    createListenerRegistry<
      (tabId: number, changeInfo: { url?: string; status?: string }, tab: ActionTabLike) => void
    >();
  const onActivated = createListenerRegistry<(activeInfo: { tabId: number }) => void>();
  const onReplaced = createListenerRegistry<(addedTabId: number, removedTabId: number) => void>();
  const onInstalled = createListenerRegistry<() => void>();
  const onStartup = createListenerRegistry<() => void>();

  const setPopup = vi.fn(async (_details: { tabId?: number; popup: string }) => {});

  const action: ActionApiLike = {
    setPopup,
    onClicked,
  };

  const tabs: ActionTabsApiLike = {
    get: vi.fn(async (tabId: number) => tabMap.get(tabId)),
    query: vi.fn(async () => Array.from(tabMap.values())),
    onCreated,
    onUpdated,
    onActivated,
    onReplaced,
  };

  const storage: ActionSidebarStorage = {
    get: vi.fn(async (keys: string | string[]) => {
      const list = typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, any> = {};
      for (const k of list) {
        if (k in store) out[k] = store[k];
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, any>) => {
      Object.assign(store, items);
    }),
  };

  const runtime: ActionRuntimeApiLike = {
    onInstalled,
    onStartup,
  };

  const cleanup = registerActionSidebarToggle({ action, tabs, storage, runtime });

  return {
    store,
    tabMap,
    setPopup,
    onClicked,
    onCreated,
    onUpdated,
    onActivated,
    onReplaced,
    onInstalled,
    onStartup,
    storage,
    cleanup,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Action Sidebar Toggle', () => {
  it('resolves empty popup on supported PoE trade URLs and default popup otherwise', () => {
    expect(resolveActionPopupForUrl('https://www.pathofexile.com/trade/search/Standard')).toBe('');
    expect(resolveActionPopupForUrl('https://www.pathofexile.com/trade2/search/poe2/Dawn')).toBe(
      '',
    );
    expect(resolveActionPopupForUrl('https://pathofexile.tw/trade')).toBe('');
    expect(resolveActionPopupForUrl('https://poe.game.qq.com/trade2')).toBe('');

    expect(resolveActionPopupForUrl(undefined)).toBe(DEFAULT_ACTION_POPUP);
    expect(resolveActionPopupForUrl('')).toBe(DEFAULT_ACTION_POPUP);
    expect(resolveActionPopupForUrl('https://www.pathofexile.com/forum')).toBe(
      DEFAULT_ACTION_POPUP,
    );
    expect(resolveActionPopupForUrl('https://google.com')).toBe(DEFAULT_ACTION_POPUP);
  });

  it('syncs popup state for existing tabs on startup and updates on tab lifecycle events', async () => {
    const h = createHarness([
      { id: 1, url: 'https://www.pathofexile.com/trade2/search/poe2' },
      { id: 2, url: undefined },
      { id: 3, url: 'https://pathofexile.tw/forum' },
    ]);
    await flush();

    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 1, popup: '' });
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 2, popup: DEFAULT_ACTION_POPUP });
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 3, popup: DEFAULT_ACTION_POPUP });
    h.setPopup.mockClear();

    // New tab with empty url and trade pendingUrl
    h.onCreated.emit({
      id: 4,
      url: '',
      pendingUrl: 'https://pathofexile.tw/trade/search/Settlers',
    });
    await flush();
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 4, popup: '' });
    h.setPopup.mockClear();

    // Tab navigates away from trade site to non-permitted origin (url becomes undefined)
    h.onUpdated.emit(1, { status: 'complete' }, { id: 1, url: undefined });
    await flush();
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 1, popup: DEFAULT_ACTION_POPUP });
    h.setPopup.mockClear();

    // Ignores non-navigation updates like title changes
    h.onUpdated.emit(1, {}, { id: 1, url: 'https://www.pathofexile.com/trade2' });
    await flush();
    expect(h.setPopup).not.toHaveBeenCalled();

    // Tab activated syncs via tabs.get
    h.tabMap.set(5, { id: 5, url: 'https://poe.game.qq.com/trade2' });
    h.onActivated.emit({ tabId: 5 });
    await flush();
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 5, popup: '' });
    h.setPopup.mockClear();

    // Tab replaced syncs via tabs.get
    h.tabMap.set(6, { id: 6, url: 'https://www.pathofexile.com/trade' });
    h.onReplaced.emit(6, 5);
    await flush();
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 6, popup: '' });
  });

  it('toggles versioned sidebar collapsed state when clicking extension icon on trade tabs', async () => {
    const h = createHarness([], { isCollapsed: false });

    // Default collapsed=true for poe2 (no poe2 key, falls back to legacy isCollapsed=false)
    h.onClicked.emit({ id: 10, url: 'https://www.pathofexile.com/trade2/search/poe2' });
    await flush();
    expect(h.store.isCollapsed_poe2).toBe(true);

    // Click again -> expands (false)
    h.onClicked.emit({ id: 10, url: 'https://www.pathofexile.com/trade2/search/poe2' });
    await flush();
    expect(h.store.isCollapsed_poe2).toBe(false);

    // PoE 1 has its own independent key
    h.onClicked.emit({ id: 11, url: 'https://www.pathofexile.com/trade/search/Standard' });
    await flush();
    expect(h.store.isCollapsed_poe1).toBe(true);
    expect(h.store.isCollapsed_poe2).toBe(false);
  });

  it('serializes rapid consecutive clicks so no toggle is lost', async () => {
    let pendingGet: (() => void) | null = null;
    const store: Record<string, any> = { isCollapsed_poe2: true };
    const storage: ActionSidebarStorage = {
      get: vi.fn(
        () =>
          new Promise<Record<string, any>>((resolve) => {
            if (!pendingGet) {
              pendingGet = () => resolve({ ...store });
            } else {
              resolve({ ...store });
            }
          }),
      ),
      set: vi.fn(async (items: Record<string, any>) => {
        Object.assign(store, items);
      }),
    };

    const h = createHarness([], {});
    h.cleanup();

    const onClicked = createListenerRegistry<(tab: ActionTabLike) => void>();
    const onCreated = createListenerRegistry<(tab: ActionTabLike) => void>();
    const onUpdated = createListenerRegistry<any>();
    const onActivated = createListenerRegistry<any>();

    const cleanup = registerActionSidebarToggle({
      action: { setPopup: vi.fn(), onClicked },
      tabs: {
        get: vi.fn(),
        query: vi.fn(async () => []),
        onCreated,
        onUpdated,
        onActivated,
      },
      storage,
    });

    onClicked.emit({ id: 1, url: 'https://www.pathofexile.com/trade2' });
    onClicked.emit({ id: 1, url: 'https://www.pathofexile.com/trade2' });
    await flush();
    // Only first storage.get should have been called while waiting
    expect(storage.get).toHaveBeenCalledTimes(1);

    pendingGet!();
    await flush();
    await flush();

    expect(storage.get).toHaveBeenCalledTimes(2);
    expect(store.isCollapsed_poe2).toBe(true);
    cleanup();
  });

  it('does not toggle sidebar when clicked on non-trade tab and restores popup', async () => {
    const h = createHarness([], { isCollapsed_poe1: true, isCollapsed_poe2: true });
    await flush();
    h.setPopup.mockClear();

    h.onClicked.emit({ id: 99, url: 'https://www.pathofexile.com/forum' });
    await flush();

    expect(h.store.isCollapsed_poe1).toBe(true);
    expect(h.store.isCollapsed_poe2).toBe(true);
    expect(h.setPopup).toHaveBeenCalledWith({ tabId: 99, popup: DEFAULT_ACTION_POPUP });
  });

  it('toggleSidebarCollapsedForVersion defaults to collapsed=true when storage is empty', async () => {
    const store: Record<string, any> = {};
    const storage: ActionSidebarStorage = {
      get: async () => ({ ...store }),
      set: async (items) => {
        Object.assign(store, items);
      },
    };

    expect(await toggleSidebarCollapsedForVersion('poe2', storage)).toBe(false);
    expect(store.isCollapsed_poe2).toBe(false);

    expect(await toggleSidebarCollapsedForVersion('poe2', storage)).toBe(true);
    expect(store.isCollapsed_poe2).toBe(true);
  });

  it('removes all registered listeners on cleanup', () => {
    const h = createHarness();
    expect(h.onClicked.size()).toBe(1);
    expect(h.onCreated.size()).toBe(1);
    expect(h.onUpdated.size()).toBe(1);
    expect(h.onActivated.size()).toBe(1);
    expect(h.onReplaced.size()).toBe(1);
    expect(h.onInstalled.size()).toBe(1);
    expect(h.onStartup.size()).toBe(1);

    h.cleanup();
    expect(h.onClicked.size()).toBe(0);
    expect(h.onCreated.size()).toBe(0);
    expect(h.onUpdated.size()).toBe(0);
    expect(h.onActivated.size()).toBe(0);
    expect(h.onReplaced.size()).toBe(0);
    expect(h.onInstalled.size()).toBe(0);
    expect(h.onStartup.size()).toBe(0);
  });
});
