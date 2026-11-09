import {
  getLiveSearchPrimaryStorageKey,
  LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE1,
  LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2,
  type LiveSearchArrivalSignal,
  type LiveSearchConsumePendingEnqueueResponse,
  type LiveSearchEnqueueItem,
  type LiveSearchEnqueueRequest,
  type LiveSearchEnqueueResponse,
  type LiveSearchGetPageRoleResponse,
  type LiveSearchOpenPrimaryRequest,
  type LiveSearchOpenPrimaryResponse,
  type LiveSearchPrimaryStorageRecord,
} from './live-search-contract';
import { getPoeVersion, type PoeVersion } from './trade-context';
import {
  DEFAULT_TRADE_ORIGIN,
  getSupportedTradeOrigin,
  isSupportedTradeHost,
} from './trade-realms';

export const LIVE_SEARCH_PRIMARY_STORAGE_KEY = LIVE_SEARCH_PRIMARY_STORAGE_KEY_POE2;

const ALL_POE_VERSIONS: readonly PoeVersion[] = ['poe2', 'poe1'];

export interface LiveSearchSessionStorage {
  get<T = any>(keys: string | string[]): Promise<Record<string, T>>;
  set(items: Record<string, any>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface LiveSearchTab {
  id?: number;
  url?: string;
  pendingUrl?: string;
  status?: string;
  windowId?: number;
  active?: boolean;
}

export interface LiveSearchTabsApi {
  get(tabId: number): Promise<LiveSearchTab | undefined>;
  create(props: { url?: string; active?: boolean }): Promise<LiveSearchTab>;
  update(
    tabId: number,
    props: { active?: boolean; url?: string },
  ): Promise<LiveSearchTab | undefined>;
}

export interface LiveSearchWindowsApi {
  update(windowId: number, updateInfo: { focused?: boolean }): Promise<any>;
}

export type LiveSearchArrivalNotifier = (
  tabId: number,
  signal: LiveSearchArrivalSignal,
) => Promise<void> | void;

export type LiveSearchEnqueueForwarder = (
  tabId: number,
  items: LiveSearchEnqueueItem[],
) => Promise<LiveSearchEnqueueResponse>;

export interface LiveSearchCoordinatorOptions {
  storage?: LiveSearchSessionStorage;
  tabs?: LiveSearchTabsApi;
  windows?: LiveSearchWindowsApi;
  notifyArrival?: LiveSearchArrivalNotifier;
  forwardEnqueue?: LiveSearchEnqueueForwarder;
}

export function isEligibleTradeUrl(url?: string, expectedVersion?: PoeVersion): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!isSupportedTradeHost(parsed.hostname)) return false;
    const pathname = parsed.pathname.toLowerCase();
    const isTradePath =
      pathname === '/trade' ||
      pathname.startsWith('/trade/') ||
      pathname === '/trade2' ||
      pathname.startsWith('/trade2/');
    if (!isTradePath) return false;
    if (expectedVersion) {
      return getPoeVersion(parsed.pathname) === expectedVersion;
    }
    return true;
  } catch {
    return false;
  }
}

export function inferTradeUrlVersion(url?: string): PoeVersion | undefined {
  if (!url || !isEligibleTradeUrl(url)) return undefined;
  try {
    return getPoeVersion(new URL(url).pathname);
  } catch {
    return undefined;
  }
}

/**
 * 驗證分頁是否符合指定版本之線上搜尋主控台資格。
 * 特別處理新分頁加載初期（loading 階段、about:blank 或未授予 tabs 權限時 url 為 undefined）避免誤殺。
 */
export function isTabEligibleAsPrimary(tab?: LiveSearchTab, expectedVersion?: PoeVersion): boolean {
  if (!tab) return false;
  const effectiveUrl = tab.url || tab.pendingUrl;
  if (!effectiveUrl) {
    return true;
  }
  if (effectiveUrl === 'about:blank') {
    return tab.status === 'loading';
  }
  return isEligibleTradeUrl(effectiveUrl, expectedVersion);
}

export function buildDefaultTradeUrl(version: PoeVersion = 'poe2', origin?: string): string {
  const base = getSupportedTradeOrigin(origin) ?? DEFAULT_TRADE_ORIGIN;
  const root = version === 'poe2' ? 'trade2' : 'trade';
  return `${base}/${root}`;
}

export function createInMemoryLiveSearchStorage(): LiveSearchSessionStorage {
  const memory: Record<string, any> = {};
  return {
    async get<T = any>(keys: string | string[]) {
      if (typeof keys === 'string') {
        return { [keys]: memory[keys] } as Record<string, T>;
      }
      const res: Record<string, any> = {};
      for (const k of keys) {
        res[k] = memory[k];
      }
      return res as Record<string, T>;
    },
    async set(items: Record<string, any>) {
      Object.assign(memory, items);
    },
    async remove(keys: string | string[]) {
      const arr = typeof keys === 'string' ? [keys] : keys;
      for (const k of arr) {
        delete memory[k];
      }
    },
  };
}

function getDefaultSessionStorage(): LiveSearchSessionStorage {
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    return {
      get: (keys) => chrome.storage.session.get(keys as any),
      set: (items) => chrome.storage.session.set(items),
      remove: (keys) => chrome.storage.session.remove(keys as any),
    };
  }
  return createInMemoryLiveSearchStorage();
}

function getDefaultTabsApi(): LiveSearchTabsApi {
  return {
    get: (tabId) => chrome.tabs.get(tabId),
    create: (props) => chrome.tabs.create(props),
    update: (tabId, props) => chrome.tabs.update(tabId, props),
  };
}

function getDefaultWindowsApi(): LiveSearchWindowsApi {
  return {
    update: (windowId, updateInfo) => chrome.windows.update(windowId, updateInfo),
  };
}

export class LiveSearchCoordinator {
  private readonly storage: LiveSearchSessionStorage;
  private readonly tabs: LiveSearchTabsApi;
  private readonly windows: LiveSearchWindowsApi;
  private notifyArrivalCallback?: LiveSearchArrivalNotifier;
  private forwardEnqueueCallback?: LiveSearchEnqueueForwarder;
  private pendingArrivalTabIds = new Set<number>();
  private pendingEnqueueByVersion = new Map<PoeVersion, LiveSearchEnqueueItem[]>();
  private openMutexByVersion = new Map<PoeVersion, Promise<LiveSearchOpenPrimaryResponse>>();
  private ownershipMutationChain: Promise<any> = Promise.resolve();

  private runOwnershipMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const next = this.ownershipMutationChain.then(mutation, mutation);
    this.ownershipMutationChain = next.catch(() => {});
    return next;
  }

  constructor(options: LiveSearchCoordinatorOptions = {}) {
    this.storage = options.storage ?? getDefaultSessionStorage();
    this.tabs = options.tabs ?? getDefaultTabsApi();
    this.windows = options.windows ?? getDefaultWindowsApi();
    this.notifyArrivalCallback = options.notifyArrival;
    this.forwardEnqueueCallback = options.forwardEnqueue;
  }

  public setArrivalNotifier(notifier?: LiveSearchArrivalNotifier): void {
    this.notifyArrivalCallback = notifier;
  }

  public setEnqueueForwarder(forwarder?: LiveSearchEnqueueForwarder): void {
    this.forwardEnqueueCallback = forwarder;
  }

  private async emitArrivalSignal(tabId: number, signal: LiveSearchArrivalSignal): Promise<void> {
    if (this.notifyArrivalCallback) {
      try {
        await this.notifyArrivalCallback(tabId, signal);
      } catch {
        // Presentation feedback failure is non-fatal
      }
    }
  }

  private resolveEffectiveVersion(explicitVersion?: PoeVersion, sender?: any): PoeVersion {
    if (explicitVersion === 'poe1' || explicitVersion === 'poe2') {
      return explicitVersion;
    }
    const fromSender = inferTradeUrlVersion(sender?.tab?.url);
    if (fromSender) return fromSender;
    return 'poe2';
  }

  private async getStoredRecordForVersion(
    version: PoeVersion,
  ): Promise<LiveSearchPrimaryStorageRecord | undefined> {
    const storageKey = getLiveSearchPrimaryStorageKey(version);
    const data = await this.storage.get<LiveSearchPrimaryStorageRecord>(storageKey);
    return data[storageKey];
  }

  private async findVersionForTabId(
    tabId: number,
  ): Promise<{ version: PoeVersion; record: LiveSearchPrimaryStorageRecord } | null> {
    const keys = ALL_POE_VERSIONS.map((v) => getLiveSearchPrimaryStorageKey(v));
    const data = await this.storage.get<LiveSearchPrimaryStorageRecord>(keys);
    for (const version of ALL_POE_VERSIONS) {
      const record = data[getLiveSearchPrimaryStorageKey(version)];
      if (record && record.tabId === tabId) {
        return { version, record };
      }
    }
    return null;
  }

  /**
   * 取得並校驗指定版本（預設 poe2，若未指定則依序檢查）當前儲存的主控台分頁。
   * 若分頁已關閉、不存在或導向非該版本 Trade 網址，自動修復並清除 Session 記錄。
   */
  public async resolveValidPrimaryTab(version?: PoeVersion): Promise<LiveSearchTab | null> {
    if (version) {
      return this.resolveValidPrimaryTabForVersion(version);
    }
    for (const v of ALL_POE_VERSIONS) {
      const tab = await this.resolveValidPrimaryTabForVersion(v);
      if (tab) return tab;
    }
    return null;
  }

  private async resolveValidPrimaryTabForVersion(
    version: PoeVersion,
  ): Promise<LiveSearchTab | null> {
    const record = await this.getStoredRecordForVersion(version);
    if (!record || typeof record.tabId !== 'number') {
      return null;
    }

    const expectedVersion = record.gameVersion || version;
    try {
      const tab = await this.tabs.get(record.tabId);
      if (!tab || !isTabEligibleAsPrimary(tab, expectedVersion)) {
        await this.invalidatePrimarySession(
          record.tabId,
          '線上搜尋主控台分頁不存在或已失去資格',
          version,
        );
        return null;
      }
      return tab;
    } catch {
      await this.invalidatePrimarySession(
        record.tabId,
        '線上搜尋主控台分頁不存在或已失去資格',
        version,
      );
      return null;
    }
  }

  /**
   * 查詢指定 tabId 的頁面角色 (權威角色由 Background 依遊戲版本判定)
   */
  public async getPageRole(
    tabId?: number,
    version?: PoeVersion,
    sender?: any,
  ): Promise<LiveSearchGetPageRoleResponse> {
    if (tabId === undefined) {
      return { role: 'normal' };
    }

    const explicitOrSenderVersion = version ?? inferTradeUrlVersion(sender?.tab?.url);

    // 若當前有正在進行的 openPrimary 交易，等待其完成以確保 ownership 已落盤，消除 document_start race
    if (explicitOrSenderVersion) {
      const pendingOpen = this.openMutexByVersion.get(explicitOrSenderVersion);
      if (pendingOpen) {
        try {
          await pendingOpen;
        } catch {
          // 忽略 open 失敗，由下方權威狀態裁決
        }
      }
      const primaryTab = await this.resolveValidPrimaryTabForVersion(explicitOrSenderVersion);
      if (primaryTab && primaryTab.id === tabId) {
        const shouldSignalArrival =
          tabId !== undefined ? this.pendingArrivalTabIds.delete(tabId) : false;
        return {
          role: 'live-search-primary',
          primaryTabId: primaryTab.id,
          arrivalSignal: shouldSignalArrival || undefined,
        };
      }
      return {
        role: 'normal',
        primaryTabId: primaryTab?.id,
      };
    }

    // 未提供版本與 sender 時（向下相容測試），等待所有進行中的 openMutex 並檢查各版本
    if (this.openMutexByVersion.size > 0) {
      try {
        await Promise.allSettled(Array.from(this.openMutexByVersion.values()));
      } catch {}
    }

    for (const v of ALL_POE_VERSIONS) {
      const primaryTab = await this.resolveValidPrimaryTabForVersion(v);
      if (primaryTab && primaryTab.id === tabId) {
        const shouldSignalArrival =
          tabId !== undefined ? this.pendingArrivalTabIds.delete(tabId) : false;
        return {
          role: 'live-search-primary',
          primaryTabId: primaryTab.id,
          arrivalSignal: shouldSignalArrival || undefined,
        };
      }
    }

    const defaultPrimary = await this.resolveValidPrimaryTab();
    return {
      role: 'normal',
      primaryTabId: defaultPrimary?.id,
    };
  }

  /**
   * 請求開啟或聚焦指定遊戲版本之線上搜尋主控台分頁。
   * 透過 Per-Version Promise 互斥鎖保證並發安全，同版本絕不重複建立多個主控台分頁。
   */
  public async openPrimary(
    request?: LiveSearchOpenPrimaryRequest,
    sender?: any,
  ): Promise<LiveSearchOpenPrimaryResponse> {
    const effectiveVersion = this.resolveEffectiveVersion(request?.gameVersion, sender);
    const shouldActivate = request?.active !== false;

    const existingMutex = this.openMutexByVersion.get(effectiveVersion);
    if (existingMutex) {
      return existingMutex;
    }

    const execution = this.executeOpenPrimary(effectiveVersion, sender, shouldActivate);
    this.openMutexByVersion.set(effectiveVersion, execution);
    try {
      return await execution;
    } finally {
      if (this.openMutexByVersion.get(effectiveVersion) === execution) {
        this.openMutexByVersion.delete(effectiveVersion);
      }
    }
  }

  private async executeOpenPrimary(
    effectiveVersion: PoeVersion,
    sender?: any,
    shouldActivate: boolean = true,
  ): Promise<LiveSearchOpenPrimaryResponse> {
    const existingTab = await this.resolveValidPrimaryTabForVersion(effectiveVersion);
    if (existingTab && existingTab.id !== undefined) {
      if (!shouldActivate) {
        return {
          success: true,
          tabId: existingTab.id,
          created: false,
        };
      }
      // 該版本主控台已存在，直接 focus / activate。注意：此處若 focus 失敗不得清除 ownership！
      try {
        await this.tabs.update(existingTab.id, { active: true });
        if (existingTab.windowId !== undefined) {
          try {
            await this.windows.update(existingTab.windowId, { focused: true });
          } catch {
            // window 可能已關閉或無權限，忽略
          }
        }
        const signal: LiveSearchArrivalSignal = { timestamp: Date.now() };
        await this.emitArrivalSignal(existingTab.id, signal);
        return {
          success: true,
          tabId: existingTab.id,
          created: false,
        };
      } catch (focusError: any) {
        return {
          success: false,
          error: focusError?.message || String(focusError),
        };
      }
    }

    // 建立新主控台的交易流程：一律載入該遊戲版本官方 Trade root，不繼承來源頁面 searchId/league/live/query
    try {
      const senderUrl = sender?.tab?.url;
      const targetUrl = buildDefaultTradeUrl(effectiveVersion, senderUrl);

      const newTab = await this.tabs.create({
        url: targetUrl,
        active: shouldActivate,
      });

      if (!newTab || newTab.id === undefined) {
        throw new Error('無法建立線上搜尋主控台分頁');
      }

      const storageKey = getLiveSearchPrimaryStorageKey(effectiveVersion);
      const record: LiveSearchPrimaryStorageRecord = {
        tabId: newTab.id,
        gameVersion: effectiveVersion,
        createdAt: Date.now(),
      };
      await this.runOwnershipMutation(async () => {
        await this.storage.set({
          [storageKey]: record,
        });
      });

      if (shouldActivate) {
        this.pendingArrivalTabIds.add(newTab.id);
        const signal: LiveSearchArrivalSignal = { timestamp: Date.now() };
        await this.emitArrivalSignal(newTab.id, signal);
      }

      return {
        success: true,
        tabId: newTab.id,
        created: true,
      };
    } catch (createError: any) {
      // 僅在「建立新主控台」失敗時進行 rollback 清理，確保不留下無效 canonical ownership
      await this.clearPrimaryOwnership(undefined, effectiveVersion).catch(() => {});
      return {
        success: false,
        error: createError?.message || String(createError),
      };
    }
  }

  private bufferPendingEnqueue(version: PoeVersion, items: readonly LiveSearchEnqueueItem[]): void {
    const current = this.pendingEnqueueByVersion.get(version) ?? [];
    for (const item of items) {
      if (item && typeof item.url === 'string' && item.url.trim()) {
        current.push({
          url: item.url.trim(),
          ...(item.name ? { name: item.name.trim() } : {}),
          ...(item.coverImageUrl ? { coverImageUrl: item.coverImageUrl.trim() } : {}),
          ...(item.sourceBookmarkId ? { sourceBookmarkId: item.sourceBookmarkId.trim() } : {}),
        });
      }
    }
    this.pendingEnqueueByVersion.set(version, current);
  }

  /**
   * 由一般頁面背景將一或多筆搜尋連線送入線上搜尋主控台（不搶奪分頁焦點）。
   * 若該版本主控台尚未開啟，自動於背景建立主控台分頁並暫存待加入項目。
   */
  public async enqueueConnections(
    request?: LiveSearchEnqueueRequest,
    sender?: any,
  ): Promise<LiveSearchEnqueueResponse> {
    const rawItems = Array.isArray(request?.items) ? request!.items : [];
    const validItems = rawItems.filter(
      (item) => item && typeof item.url === 'string' && item.url.trim().length > 0,
    );
    if (validItems.length === 0) {
      return {
        success: false,
        error: '未提供有效的搜尋網址',
        rejectReason: 'invalid-url',
      };
    }

    const effectiveVersion = this.resolveEffectiveVersion(request?.gameVersion, sender);
    const existingTab = await this.resolveValidPrimaryTabForVersion(effectiveVersion);

    if (existingTab && existingTab.id !== undefined) {
      if (this.forwardEnqueueCallback) {
        try {
          const forwarded = await this.forwardEnqueueCallback(existingTab.id, validItems);
          return {
            ...forwarded,
            tabId: existingTab.id,
            created: false,
          };
        } catch {
          // Content script may still be loading; fall back to pending buffer
        }
      }
      this.bufferPendingEnqueue(effectiveVersion, validItems);
      return {
        success: true,
        tabId: existingTab.id,
        created: false,
        addedCount: validItems.length,
        skippedCount: 0,
      };
    }

    this.bufferPendingEnqueue(effectiveVersion, validItems);
    const openOutcome = await this.openPrimary(
      {
        gameVersion: effectiveVersion,
        active: false,
      },
      sender,
    );

    if (!openOutcome.success) {
      this.pendingEnqueueByVersion.delete(effectiveVersion);
      return {
        success: false,
        error: openOutcome.error || '無法於背景啟動線上搜尋主控台',
        rejectReason: 'failed',
      };
    }

    return {
      success: true,
      tabId: openOutcome.tabId,
      created: Boolean(openOutcome.created),
      addedCount: validItems.length,
      skippedCount: 0,
    };
  }

  /**
   * 由主控台分頁在初始化完成時領取暫存的待加入連線清單
   */
  public async consumePendingEnqueue(
    tabId?: number,
    version?: PoeVersion,
    sender?: any,
  ): Promise<LiveSearchConsumePendingEnqueueResponse> {
    const effectiveVersion = this.resolveEffectiveVersion(version, sender);
    if (tabId !== undefined) {
      const primaryTab = await this.resolveValidPrimaryTabForVersion(effectiveVersion);
      if (!primaryTab || primaryTab.id !== tabId) {
        return { items: [] };
      }
    }
    const items = this.pendingEnqueueByVersion.get(effectiveVersion) ?? [];
    this.pendingEnqueueByVersion.delete(effectiveVersion);
    return { items: [...items] };
  }

  /**
   * 統一清理失效的主控台 session
   */
  public async invalidatePrimarySession(
    tabId?: number,
    _reason: string = '線上搜尋主控台分頁已失效',
    version?: PoeVersion,
  ): Promise<void> {
    if (version) {
      this.pendingEnqueueByVersion.delete(version);
      await this.clearPrimaryOwnership(tabId, version);
      return;
    }

    for (const v of ALL_POE_VERSIONS) {
      this.pendingEnqueueByVersion.delete(v);
      await this.clearPrimaryOwnership(tabId, v);
    }
  }

  /**
   * 監聽分頁關閉
   */
  public async handleTabRemoved(tabId: number): Promise<void> {
    this.pendingArrivalTabIds.delete(tabId);
    const matched = await this.findVersionForTabId(tabId);
    if (matched) {
      await this.invalidatePrimarySession(tabId, '線上搜尋主控台分頁已關閉', matched.version);
    }
  }

  /**
   * 監聽分頁更新（導航至非該版本 Trade 網址即失去主控台資格）
   */
  public async handleTabUpdated(
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab?: LiveSearchTab,
  ): Promise<void> {
    const matched = await this.findVersionForTabId(tabId);
    if (!matched) return;

    const { version, record } = matched;
    const expectedVersion = record.gameVersion || version;
    let isNonTrade = false;
    if (changeInfo.url) {
      if (!isEligibleTradeUrl(changeInfo.url, expectedVersion)) {
        isNonTrade = true;
      }
    } else if (tab && tab.status === 'complete') {
      const effectiveUrl = tab.url || tab.pendingUrl;
      if (
        effectiveUrl &&
        effectiveUrl !== 'about:blank' &&
        !isEligibleTradeUrl(effectiveUrl, expectedVersion)
      ) {
        isNonTrade = true;
      }
    }

    if (isNonTrade) {
      await this.invalidatePrimarySession(tabId, '線上搜尋主控台分頁已離開交易頁面', version);
    }
  }

  /**
   * 清除指定版本之主控台 Ownership（支援 compare-and-clear 與 mutation 序列化）
   */
  public async clearPrimaryOwnership(
    expectedTabId?: number,
    version: PoeVersion = 'poe2',
  ): Promise<boolean> {
    const storageKey = getLiveSearchPrimaryStorageKey(version);
    return this.runOwnershipMutation(async () => {
      const data = await this.storage.get<LiveSearchPrimaryStorageRecord>(storageKey);
      const record = data[storageKey];
      if (!record) {
        return false;
      }
      if (expectedTabId !== undefined && record.tabId !== expectedTabId) {
        return false;
      }

      if (expectedTabId !== undefined) {
        const latestData = await this.storage.get<LiveSearchPrimaryStorageRecord>(storageKey);
        const latestRecord = latestData[storageKey];
        if (latestRecord?.tabId !== expectedTabId) {
          return false;
        }
      }

      await this.storage.remove(storageKey);
      this.pendingArrivalTabIds.delete(record.tabId);
      return true;
    });
  }
}
