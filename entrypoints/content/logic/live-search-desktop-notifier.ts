import { t } from '@/utils/i18n';
import type { PoeVersion } from '@/utils/trade-context';

/**
 * 主控台桌面通知（Web Notification API）
 *
 * 沿用官方市集同源的瀏覽器原生 `Notification` API，不需額外擴充權限。
 * 僅於主控台在背景或未聚焦時發送；以「每個監聽物品（ownerKey）」各自維護一張通知卡：
 * - 同一個監聽物品短時間內連續命中會合併成一則；再次命中時先關閉舊卡並用遞增 tag 重彈橫幅
 *   （避免 Windows 通知中心對同 tag 靜默更新而不彈出橫幅）。
 * - 不同監聽物品各自保留通知卡，互不覆蓋。
 */

export type DesktopNotificationPermission = NotificationPermission | 'unsupported';

export type LiveSearchDesktopNotifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'default' | 'error' };

export interface DesktopNotificationInstance {
  onclick: ((ev: Event) => unknown) | null;
  close(): void;
}

export interface DesktopNotificationConstructor {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  new (title: string, options?: NotificationOptions): DesktopNotificationInstance;
}

export interface LiveSearchDesktopNotifier {
  /** 有新結果時呼叫；關閉、前景聚焦、未授權時忽略；依監聽物品合併並各自維護一張通知卡 */
  notify(event?: { ownerKey?: string; sourceName?: string }): void;
  /** 設定頁測試通知：略過開關與前景檢查，驗證系統通知可正常彈出 */
  test(): LiveSearchDesktopNotifyOutcome;
  getPermission(): DesktopNotificationPermission;
  requestPermission(): Promise<DesktopNotificationPermission>;
  dispose(): void;
}

export interface LiveSearchDesktopNotifierOptions {
  version: PoeVersion;
  isEnabled: () => boolean;
  /** 判斷主控台是否在背景／未聚焦；省略時使用 `document.hidden || !document.hasFocus()` */
  isBackground?: () => boolean;
  /** 點擊通知時聚焦主控台分頁 */
  onFocusConsole?: () => void;
  /** 可注入的通知建構子（測試用），預設讀取 `globalThis.Notification` */
  getNotificationCtor?: () => DesktopNotificationConstructor | null;
  coalesceMs?: number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (id: ReturnType<typeof setTimeout>) => void;
}

export const LIVE_SEARCH_DESKTOP_NOTIFY_COALESCE_MS = 500;

interface PendingEntry {
  count: number;
  sourceName?: string;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_NOTIFY_KEY = '__default__';
const TEST_NOTIFY_KEY = '__test__';

function defaultGetNotificationCtor(): DesktopNotificationConstructor | null {
  if (typeof globalThis === 'undefined' || !('Notification' in globalThis)) return null;
  const ctor = (globalThis as { Notification?: unknown }).Notification;
  return typeof ctor === 'function' ? (ctor as DesktopNotificationConstructor) : null;
}

function defaultIsBackground(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.hidden) return true;
  return typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
}

function defaultFocusConsole(): void {
  if (typeof window !== 'undefined' && typeof window.focus === 'function') {
    window.focus();
  }
}

function formatBody(count: number, sourceName?: string): string {
  if (sourceName) {
    return t('liveSearch.desktopNotify.bodySingleSource', { name: sourceName, count });
  }
  return t('liveSearch.desktopNotify.bodyGeneric', { count });
}

export function createLiveSearchDesktopNotifier(
  options: LiveSearchDesktopNotifierOptions,
): LiveSearchDesktopNotifier {
  const getCtor = options.getNotificationCtor ?? defaultGetNotificationCtor;
  const isBackground = options.isBackground ?? defaultIsBackground;
  const onFocusConsole = options.onFocusConsole ?? defaultFocusConsole;
  const coalesceMs = options.coalesceMs ?? LIVE_SEARCH_DESKTOP_NOTIFY_COALESCE_MS;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelSchedule = options.cancelSchedule ?? ((id) => clearTimeout(id));

  let disposed = false;
  let notifySeq = 0;
  const pendingByKey = new Map<string, PendingEntry>();
  const activeByKey = new Map<string, DesktopNotificationInstance>();

  const getPermission = (): DesktopNotificationPermission => {
    const ctor = getCtor();
    if (!ctor) return 'unsupported';
    return ctor.permission;
  };

  const safeIsEnabled = (): boolean => {
    try {
      return options.isEnabled();
    } catch {
      return false;
    }
  };

  const closeActiveForKey = (key: string) => {
    const prev = activeByKey.get(key);
    if (!prev) return;
    activeByKey.delete(key);
    try {
      prev.close();
    } catch {
      // ignore
    }
  };

  const showNotificationForKey = (
    key: string,
    title: string,
    body: string,
  ): LiveSearchDesktopNotifyOutcome => {
    const ctor = getCtor();
    if (!ctor) return { ok: false, reason: 'unsupported' };
    const perm = ctor.permission;
    if (perm === 'denied') return { ok: false, reason: 'denied' };
    if (perm !== 'granted') return { ok: false, reason: 'default' };

    // 先關閉同一個監聽物品先前的通知卡，再以新的 tag 發送，確保 Windows 重新彈出橫幅且不洗版
    closeActiveForKey(key);
    notifySeq += 1;
    const tag = `poexd-live-search-${options.version}-${notifySeq}`;

    try {
      const notification = new ctor(title, { body, tag });
      activeByKey.set(key, notification);
      notification.onclick = () => {
        if (activeByKey.get(key) === notification) {
          activeByKey.delete(key);
        }
        try {
          notification.close();
        } catch {
          // ignore
        }
        try {
          onFocusConsole();
        } catch {
          // ignore
        }
      };
      return { ok: true };
    } catch {
      return { ok: false, reason: 'error' };
    }
  };

  const flushKey = (key: string) => {
    const entry = pendingByKey.get(key);
    if (!entry) return;
    pendingByKey.delete(key);

    if (disposed || entry.count <= 0) return;
    if (!safeIsEnabled() || getPermission() !== 'granted' || !isBackground()) return;
    showNotificationForKey(
      key,
      t('liveSearch.desktopNotify.title'),
      formatBody(entry.count, entry.sourceName),
    );
  };

  return {
    notify(event) {
      if (disposed) return;
      if (!safeIsEnabled() || getPermission() !== 'granted' || !isBackground()) return;

      const sourceName = event?.sourceName?.trim() || undefined;
      const key = event?.ownerKey?.trim() || sourceName || DEFAULT_NOTIFY_KEY;
      const existing = pendingByKey.get(key);
      if (existing) {
        existing.count += 1;
        if (sourceName) existing.sourceName = sourceName;
        return;
      }

      const timer = schedule(() => flushKey(key), coalesceMs);
      pendingByKey.set(key, { count: 1, sourceName, timer });
    },

    test(): LiveSearchDesktopNotifyOutcome {
      if (disposed) return { ok: false, reason: 'error' };
      return showNotificationForKey(
        TEST_NOTIFY_KEY,
        t('liveSearch.desktopNotify.title'),
        t('liveSearch.desktopNotify.testBody'),
      );
    },

    getPermission,

    async requestPermission(): Promise<DesktopNotificationPermission> {
      const ctor = getCtor();
      if (!ctor) return 'unsupported';
      if (ctor.permission === 'granted' || ctor.permission === 'denied') {
        return ctor.permission;
      }
      try {
        return await ctor.requestPermission();
      } catch {
        return ctor.permission;
      }
    },

    dispose() {
      disposed = true;
      for (const entry of pendingByKey.values()) {
        cancelSchedule(entry.timer);
      }
      pendingByKey.clear();
      for (const key of Array.from(activeByKey.keys())) {
        closeActiveForKey(key);
      }
    },
  };
}
