/**
 * 購物清單項目的圖片是從搜尋結果擷取的（和書籤封面相同的來源）。開啟某個項目的搜尋時先記下
 * 「接下來這個頁面的結果圖片屬於哪個項目」，頁面載入後再領取。
 *
 * - 在目前分頁開啟：記在 sessionStorage，只有這個分頁領得到。
 * - 在新分頁開啟：新分頁拿不到原分頁的 sessionStorage，改記在 chrome.storage，並以網址的
 *   `q` 參數確認領取的是那個新分頁，不會被其他分頁誤領。
 */
import type { PoeVersion } from './trade-context';

export type PobSearchOpenMode = 'current' | 'new-tab';

export interface PendingIcon {
  buildId: string;
  entryKey: string;
}

export interface PendingIconStore {
  /** 同步完成「目前分頁」的記錄，之後馬上換頁也不會遺失 */
  save(pending: PendingIcon, mode: PobSearchOpenMode, searchUrl: string): void;
  take(): Promise<PendingIcon | undefined>;
}

interface StoredPending extends PendingIcon {
  at: number;
  /** 新分頁模式：搜尋網址的 q 參數 */
  q?: string;
}

const MAX_AGE_MS = 2 * 60 * 1000;
const storageKey = (version: PoeVersion) => `poexdPobIconPending_${version}`;

const readQuery = (url: string): string | undefined => {
  try {
    return new URL(url).searchParams.get('q') ?? undefined;
  } catch {
    return undefined;
  }
};

function parse(value: unknown, now: number): StoredPending | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { buildId, entryKey, at, q } = value as Record<string, unknown>;
  if (typeof buildId !== 'string' || typeof entryKey !== 'string' || typeof at !== 'number') {
    return undefined;
  }
  if (now - at > MAX_AGE_MS || now < at) return undefined;
  return { buildId, entryKey, at, ...(typeof q === 'string' ? { q } : {}) };
}

export function createPendingIconStore(
  version: PoeVersion,
  deps: {
    session?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    local?: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
    now?: () => number;
    getPageUrl?: () => string;
  } = {},
): PendingIconStore {
  const key = storageKey(version);
  // 用到時才取用，建立時不碰瀏覽器 API
  const getSession = () => deps.session ?? window.sessionStorage;
  const getLocal = () => deps.local ?? chrome.storage.local;
  const now = deps.now ?? Date.now;
  const getPageUrl = deps.getPageUrl ?? (() => window.location.href);

  return {
    save(pending, mode, searchUrl) {
      const stored: StoredPending = { ...pending, at: now() };
      try {
        if (mode === 'current') getSession().setItem(key, JSON.stringify(stored));
        else
          void getLocal()
            .set({ [key]: { ...stored, q: readQuery(searchUrl) } })
            .catch(() => undefined);
      } catch {
        // 存不進去只是少一張圖片，不影響開啟搜尋
      }
    },
    async take() {
      try {
        const session = getSession();
        const local = getLocal();
        const raw = session.getItem(key);
        if (raw) {
          session.removeItem(key);
          const pending = parse(JSON.parse(raw), now());
          if (pending) return { buildId: pending.buildId, entryKey: pending.entryKey };
        }
        const pending = parse((await local.get([key]))[key], now());
        if (!pending?.q || pending.q !== readQuery(getPageUrl())) return undefined;
        await local.remove([key]);
        return { buildId: pending.buildId, entryKey: pending.entryKey };
      } catch {
        return undefined;
      }
    },
  };
}
