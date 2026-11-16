/**
 * PoB 購物清單轉存書籤用的入口：只提供「列出資料夾」與「新增一筆書籤」，其餘書籤操作仍屬於書籤面板。
 *
 * 書籤資料由背景統一保存並廣播變更，這裡另建一個 bookmark model 連上同一份資料；新增後書籤面板
 * 會收到變更通知自行更新，PoB 面板不直接碰書籤儲存。模型在第一次使用時才連線。
 */
import { BOOKMARK_NAME_MAX_LENGTH } from '@/utils/bookmark-collection';
import { createChromeBookmarkClient } from '@/utils/bookmark-messaging';
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import type { PoeVersion } from '@/utils/trade-context';
import { createBookmarkModel, type BookmarkModel } from '../bookmark-model';
import { getFlattenedFolderTree } from '../bookmark-tree';
import type { Bookmark } from '../bookmark-types';

export interface PobBookmarkFolder {
  id: string;
  name: string;
  /** 巢狀深度，最上層為 0 */
  depth: number;
}

export interface PobBookmarkInput {
  groupId: string;
  name: string;
  url: string;
  coverImageUrl?: string;
}

export type PobBookmarkResult = { ok: true; name: string } | { ok: false; message?: string };

export interface PobBookmarkBridge {
  listFolders(): Promise<PobBookmarkFolder[]>;
  add(input: PobBookmarkInput): Promise<PobBookmarkResult>;
  dispose(): void;
}

const toBookmarkName = (name: string): string =>
  name.replace(/\s+/g, ' ').trim().slice(0, BOOKMARK_NAME_MAX_LENGTH);

export function createPobBookmarkBridge(
  version: PoeVersion,
  createModel: () => BookmarkModel = () => createBookmarkModel(createChromeBookmarkClient(version)),
): PobBookmarkBridge {
  let model: BookmarkModel | undefined;
  let connecting: Promise<boolean> | undefined;

  const ensureConnected = async (): Promise<BookmarkModel | undefined> => {
    model ??= createModel();
    connecting ??= model.connect().then((outcome) => outcome.ok);
    if (await connecting) return model;
    // 連線失敗時下次再試，不把失敗結果留住
    connecting = undefined;
    return undefined;
  };

  return {
    async listFolders() {
      const connected = await ensureConnected();
      if (!connected) return [];
      return getFlattenedFolderTree(connected.state.value.groups).map(({ folder, depth }) => ({
        id: folder.id,
        name: folder.name,
        depth,
      }));
    },
    async add(input) {
      const connected = await ensureConnected();
      if (!connected) return { ok: false };
      const name = toBookmarkName(input.name);
      if (!name || !connected.state.value.groups.some((group) => group.id === input.groupId)) {
        return { ok: false };
      }
      const bookmark: Bookmark = {
        id: `bm_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`,
        searchRecordId: '',
        name,
        url: input.url,
        groupId: input.groupId,
        order: connected.state.value.bookmarks.length,
        createdAt: Date.now(),
        ...(input.coverImageUrl && isValidPoeCdnImageUrl(input.coverImageUrl)
          ? { coverImageUrl: input.coverImageUrl }
          : {}),
      };
      const outcome = await connected.execute({ type: 'add-bookmark', bookmark });
      return outcome.ok ? { ok: true, name } : { ok: false, message: outcome.error.message };
    },
    dispose() {
      model?.dispose();
      model = undefined;
      connecting = undefined;
    },
  };
}
