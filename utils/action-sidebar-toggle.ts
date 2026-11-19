import { createVersionedStorageKeys, readStorageValue } from './storage-contracts';
import { detectTradeContextFromUrl, type PoeVersion, type TradeUrlContext } from './trade-context';

export const DEFAULT_ACTION_POPUP = 'popup.html';

export interface ActionTabLike {
  id?: number;
  url?: string;
  pendingUrl?: string;
}

export interface ActionApiLike {
  setPopup(details: { tabId?: number; popup: string }): Promise<void> | void;
  onClicked: {
    addListener(callback: (tab: ActionTabLike) => void): void;
    removeListener?(callback: (tab: ActionTabLike) => void): void;
  };
}

export interface ActionTabsApiLike {
  get(tabId: number): Promise<ActionTabLike | undefined>;
  query(queryInfo: Record<string, unknown>): Promise<ActionTabLike[]>;
  onCreated: {
    addListener(callback: (tab: ActionTabLike) => void): void;
    removeListener?(callback: (tab: ActionTabLike) => void): void;
  };
  onUpdated: {
    addListener(
      callback: (
        tabId: number,
        changeInfo: { url?: string; status?: string },
        tab: ActionTabLike,
      ) => void,
    ): void;
    removeListener?(
      callback: (
        tabId: number,
        changeInfo: { url?: string; status?: string },
        tab: ActionTabLike,
      ) => void,
    ): void;
  };
  onActivated: {
    addListener(callback: (activeInfo: { tabId: number }) => void): void;
    removeListener?(callback: (activeInfo: { tabId: number }) => void): void;
  };
  onReplaced?: {
    addListener(callback: (addedTabId: number, removedTabId: number) => void): void;
    removeListener?(callback: (addedTabId: number, removedTabId: number) => void): void;
  };
}

export interface ActionSidebarStorage {
  get<T = any>(keys: string | string[]): Promise<Record<string, T>>;
  set(items: Record<string, any>): Promise<void>;
}

export interface ActionRuntimeApiLike {
  onInstalled?: {
    addListener(callback: () => void): void;
    removeListener?(callback: () => void): void;
  };
  onStartup?: {
    addListener(callback: () => void): void;
    removeListener?(callback: () => void): void;
  };
}

export interface ActionSidebarToggleOptions {
  action?: ActionApiLike;
  tabs?: ActionTabsApiLike;
  storage?: ActionSidebarStorage;
  runtime?: ActionRuntimeApiLike;
}

function pickTabUrl(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return undefined;
}

function isSidebarTradeUrl(rawUrl?: string): TradeUrlContext {
  if (!rawUrl) return { isTradePage: false, version: 'poe1' };
  try {
    const firstSegment = new URL(rawUrl).pathname.split('/').filter(Boolean)[0];
    if (firstSegment !== 'trade' && firstSegment !== 'trade2') {
      return { isTradePage: false, version: 'poe1' };
    }
  } catch {
    return { isTradePage: false, version: 'poe1' };
  }
  return detectTradeContextFromUrl(rawUrl);
}

/**
 * 市集分頁移除 popup（改由 action.onClicked 直接切換側邊欄），非市集分頁保留快速入口 popup。
 */
export function resolveActionPopupForUrl(url?: string): string {
  return isSidebarTradeUrl(url).isTradePage ? '' : DEFAULT_ACTION_POPUP;
}

export async function syncTabActionPopup(
  tabId: number | undefined,
  url: string | undefined,
  action: ActionApiLike,
): Promise<void> {
  if (tabId === undefined) return;
  const popup = resolveActionPopupForUrl(url);
  try {
    await action.setPopup({ tabId, popup });
  } catch {
    // 分頁可能在非同步更新期間已關閉
  }
}

export async function toggleSidebarCollapsedForVersion(
  version: PoeVersion,
  storage: ActionSidebarStorage,
): Promise<boolean> {
  const keys = createVersionedStorageKeys(version);
  const data = await storage.get([keys.isCollapsed, 'isCollapsed']);
  const currentCollapsed = readStorageValue(data, keys.isCollapsed, 'isCollapsed', true);
  const nextCollapsed = !currentCollapsed;
  await storage.set({ [keys.isCollapsed]: nextCollapsed });
  return nextCollapsed;
}

export function registerActionSidebarToggle(options: ActionSidebarToggleOptions = {}): () => void {
  const action: ActionApiLike | undefined =
    options.action ?? (typeof chrome !== 'undefined' ? chrome?.action : undefined);
  const tabs: ActionTabsApiLike | undefined =
    options.tabs ?? (typeof chrome !== 'undefined' ? chrome?.tabs : undefined);
  const storage: ActionSidebarStorage | undefined =
    options.storage ?? (typeof chrome !== 'undefined' ? chrome?.storage?.local : undefined);
  const runtime: ActionRuntimeApiLike | undefined =
    options.runtime ?? (typeof chrome !== 'undefined' ? chrome?.runtime : undefined);

  if (!action || !tabs || !storage) {
    return () => {};
  }

  // 依遊戲版本序列化點擊切換，避免連點時讀到同一個舊值
  const toggleChains: Partial<Record<PoeVersion, Promise<boolean>>> = {};
  const queueToggle = (version: PoeVersion): Promise<boolean> => {
    const previous = toggleChains[version] ?? Promise.resolve(true);
    const next = previous
      .catch(() => true)
      .then(() => toggleSidebarCollapsedForVersion(version, storage));
    toggleChains[version] = next;
    return next;
  };

  const syncTabById = async (tabId: number) => {
    try {
      const tab = await tabs.get(tabId);
      if (!tab) return;
      await syncTabActionPopup(tab.id ?? tabId, pickTabUrl(tab.url, tab.pendingUrl), action);
    } catch {
      // 分頁可能已關閉
    }
  };

  const syncAllTabs = async () => {
    try {
      const allTabs = await tabs.query({});
      await Promise.all(
        allTabs.map((tab) =>
          syncTabActionPopup(tab.id, pickTabUrl(tab.url, tab.pendingUrl), action),
        ),
      );
    } catch {
      // 忽略啟動／關閉期間的暫時性查詢錯誤
    }
  };

  const handleActionClicked = (tab: ActionTabLike) => {
    const url = pickTabUrl(tab?.url, tab?.pendingUrl);
    const context = isSidebarTradeUrl(url);
    if (!context.isTradePage) {
      void syncTabActionPopup(tab?.id, url, action);
      return;
    }
    void queueToggle(context.version).catch((error: unknown) => {
      console.error('[Action Sidebar Toggle] 切換側邊欄顯示失敗:', error);
    });
  };

  const handleTabCreated = (tab: ActionTabLike) => {
    void syncTabActionPopup(tab.id, pickTabUrl(tab.url, tab.pendingUrl), action);
  };

  const handleTabUpdated = (
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab: ActionTabLike,
  ) => {
    if (changeInfo.url === undefined && changeInfo.status === undefined) return;
    void syncTabActionPopup(tabId, pickTabUrl(changeInfo.url, tab?.url, tab?.pendingUrl), action);
  };

  const handleTabActivated = (activeInfo: { tabId: number }) => {
    void syncTabById(activeInfo.tabId);
  };

  const handleTabReplaced = (addedTabId: number) => {
    void syncTabById(addedTabId);
  };

  const handleRuntimeEvent = () => {
    void syncAllTabs();
  };

  action.onClicked.addListener(handleActionClicked);
  tabs.onCreated.addListener(handleTabCreated);
  tabs.onUpdated.addListener(handleTabUpdated);
  tabs.onActivated.addListener(handleTabActivated);
  tabs.onReplaced?.addListener(handleTabReplaced);
  runtime?.onInstalled?.addListener(handleRuntimeEvent);
  runtime?.onStartup?.addListener(handleRuntimeEvent);

  void syncAllTabs();

  return () => {
    action.onClicked.removeListener?.(handleActionClicked);
    tabs.onCreated.removeListener?.(handleTabCreated);
    tabs.onUpdated.removeListener?.(handleTabUpdated);
    tabs.onActivated.removeListener?.(handleTabActivated);
    tabs.onReplaced?.removeListener?.(handleTabReplaced);
    runtime?.onInstalled?.removeListener?.(handleRuntimeEvent);
    runtime?.onStartup?.removeListener?.(handleRuntimeEvent);
  };
}
