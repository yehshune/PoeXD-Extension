/**
 * 市集頁（content script / Sidebar）使用的釘選清單客戶端：
 * 讀取直接走 `chrome.storage.local`，寫入一律交給 background 依序執行。
 */
import { extensionMessaging } from './extension-protocol';
import {
  parseStoredPinnedList,
  pinnedItemStorageKey,
  type PinnedItemCommand,
  type PinnedItemOutcome,
  type PinnedItemSnapshot,
} from './pinned-items';
import type { PoeVersion } from './trade-context';

export interface PinnedItemClientDeps {
  read(key: string): Promise<unknown>;
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  send(command: PinnedItemCommand): Promise<PinnedItemOutcome | undefined>;
}

export interface PinnedItemClient {
  list(): Promise<PinnedItemSnapshot[]>;
  subscribe(listener: (items: PinnedItemSnapshot[]) => void): () => void;
  pin(snapshot: PinnedItemSnapshot): Promise<PinnedItemOutcome>;
  unpin(id: string): Promise<PinnedItemOutcome>;
  /** 不帶 league 時清除此遊戲版本的全部釘選 */
  clear(league?: string): Promise<PinnedItemOutcome>;
  /** 依 ids 的順序重排（沒列出的物品維持原位） */
  reorder(ids: readonly string[]): Promise<PinnedItemOutcome>;
}

const chromeDeps: PinnedItemClientDeps = {
  read: async (key) => (await chrome.storage.local.get([key]))[key],
  subscribe(key, listener) {
    const handle = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName === 'local' && key in changes) listener(changes[key]?.newValue);
    };
    chrome.storage.onChanged.addListener(handle);
    return () => chrome.storage.onChanged.removeListener(handle);
  },
  send: (command) => extensionMessaging.sendMessage('pinnedItem:execute', command),
};

export function createPinnedItemClient(
  version: PoeVersion,
  deps: PinnedItemClientDeps = chromeDeps,
): PinnedItemClient {
  const key = pinnedItemStorageKey(version);
  const send = async (command: PinnedItemCommand): Promise<PinnedItemOutcome> => {
    try {
      const outcome = await deps.send(command);
      return outcome ?? unavailable('Pinned item background did not respond');
    } catch (error) {
      return unavailable(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    list: async () => parseStoredPinnedList(await deps.read(key), version).items,
    subscribe: (listener) =>
      deps.subscribe(key, (value) => listener(parseStoredPinnedList(value, version).items)),
    pin: (snapshot) => send({ type: 'pin', gameVersion: version, snapshot }),
    unpin: (id) => send({ type: 'unpin', gameVersion: version, id }),
    reorder: (ids) => send({ type: 'reorder', gameVersion: version, ids: [...ids] }),
    clear: (league) =>
      send({ type: 'clear', gameVersion: version, ...(league !== undefined ? { league } : {}) }),
  };
}

function unavailable(message: string): PinnedItemOutcome {
  return { ok: false, error: { code: 'unavailable', message } };
}
