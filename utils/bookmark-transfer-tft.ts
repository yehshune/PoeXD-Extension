/**
 * TFT Trade Extension（The Forbidden Trove）書籤分享格式轉接層。
 *
 * 分享碼格式：`Base64(UTF-8(JSON.stringify({ folders })))`，標準 Base64、保留 `=` 補位、無任何前綴。
 * 資料夾為扁平陣列並以 `parentId` 表示階層；書籤不含網域，聯盟為 `"Auto"` 或固定聯盟名稱。
 */
import type { PoeVersion } from './trade-context';
import { decodeRepeatedly, parseTradePath } from './trade-context';
import { DEFAULT_TRADE_ORIGIN } from './trade-realms';
import { BOOKMARK_AUTO_LEAGUE, readTradeUrlLeague } from './bookmark-target';
import { BOOKMARK_NAME_MAX_LENGTH } from './bookmark-collection';
import { BookmarkTransferInputError } from './bookmark-transfer-errors';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import type {
  BookmarkTransferFolder,
  BookmarkTransferItem,
  BookmarkTransferPayload,
  BookmarkTransferPayloadV2,
} from './bookmark-transfer';

export type TftPoeVersion = 'Poe1' | 'Poe2';
export type TftBookmarkType = 'search' | 'exchange';

export interface TftBookmark {
  id: string;
  name: string;
  league: string;
  poeVersion: TftPoeVersion;
  endpoint: string;
  type: TftBookmarkType;
  idx: number;
  isDone: boolean;
  /** PoeXD 擴充欄位：TFT 匯入時會原樣保留，往返後不遺失封面。 */
  coverImageUrl?: string;
}

export interface TftFolder {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  childIds: string[];
  index: number;
  isOpen: boolean;
  icon: string;
  bookmarks: TftBookmark[];
}

export interface TftBookmarkExport {
  folders: TftFolder[];
  /**
   * PoeXD 擴充提示：TFT 匯入只讀取 `folders`，會忽略此欄位；
   * PoeXD 用它在往返時保留匯出範圍與遊戲版本（例如空集合或單一根資料夾的全部匯出）。
   */
  poexd?: { scope: 'collection' | 'folder'; gameVersion: PoeVersion };
}

export interface TftImportOptions {
  gameVersion: PoeVersion;
  /** 自動聯盟書籤在 PoeXD 內部記錄所需的聯盟（通常為目前頁面聯盟）。 */
  fallbackLeague?: string;
}

const TFT_DEFAULT_ICON = 'TFT';
const FALLBACK_LEAGUE = 'Standard';
const MAX_ENDPOINT_LENGTH = 4096;

const toTftVersion = (version: PoeVersion): TftPoeVersion => (version === 'poe2' ? 'Poe2' : 'Poe1');
const fromTftVersion = (version: unknown): PoeVersion | undefined =>
  version === 'Poe2' ? 'poe2' : version === 'Poe1' ? 'poe1' : undefined;

// ── 編碼 ───────────────────────────────────────────────

export function encodeTftBase64(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function decodeTftBase64(code: string): string {
  const compact = code.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    throw new Error('Bookmark share code is malformed');
  }
  const base64 = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ── PoeXD → TFT ────────────────────────────────────────

export function toTftBookmarkExport(
  payload: BookmarkTransferPayload,
  createId: () => string = () => crypto.randomUUID(),
): TftBookmarkExport {
  const folders: TftFolder[] = [];

  const visit = (folder: BookmarkTransferFolder, parentId: string | null, depth: number) => {
    const id = createId();
    const entry: TftFolder = {
      id,
      name: folder.name,
      parentId,
      depth,
      childIds: [],
      index: folders.length,
      isOpen: true,
      icon: TFT_DEFAULT_ICON,
      bookmarks: folder.bookmarks.map((item, idx) =>
        toTftBookmark(item, payload.gameVersion, idx, createId),
      ),
    };
    folders.push(entry);
    const children = 'folders' in folder && folder.folders ? folder.folders : [];
    entry.childIds = children.map((child) => visit(child, id, depth + 1));
    return id;
  };

  payload.folders.forEach((folder) => visit(folder, null, 0));
  return { folders, poexd: { scope: payload.scope, gameVersion: payload.gameVersion } };
}

function toTftBookmark(
  item: BookmarkTransferItem,
  gameVersion: PoeVersion,
  idx: number,
  createId: () => string,
): TftBookmark {
  const target = readTradeTarget(item.url);
  if (!target) throw new Error('Bookmark Transfer requires a valid Path of Exile Trade URL');
  return {
    id: createId(),
    name: item.name,
    league: item.leaguePinned ? target.league : BOOKMARK_AUTO_LEAGUE,
    poeVersion: toTftVersion(gameVersion),
    endpoint: target.endpoint,
    type: target.type,
    idx,
    isDone: false,
    ...(item.coverImageUrl ? { coverImageUrl: item.coverImageUrl } : {}),
  };
}

function readTradeTarget(
  urlValue: string,
): { league: string; endpoint: string; type: TftBookmarkType } | undefined {
  try {
    const path = parseTradePath(new URL(urlValue).pathname);
    if (path?.leagueIndex === undefined) return undefined;
    const type = path.parts[1] === 'exchange' ? 'exchange' : 'search';
    const league = readTradeUrlLeague(urlValue);
    const endpoint = decodeRepeatedly(path.parts[path.leagueIndex + 1] || '').trim();
    if (!league || !endpoint || endpoint === 'live') return undefined;
    return { league, endpoint, type };
  } catch {
    return undefined;
  }
}

// ── TFT → PoeXD ────────────────────────────────────────

export function isTftBookmarkExport(value: unknown): value is TftBookmarkExport {
  return (
    isObject(value) &&
    Array.isArray(value.folders) &&
    !('kind' in value) &&
    value.folders.every((folder) => isObject(folder) && Array.isArray(folder.bookmarks))
  );
}

export function fromTftBookmarkExport(
  value: unknown,
  options: TftImportOptions,
): BookmarkTransferPayloadV2 {
  if (!isTftBookmarkExport(value)) throw new Error('Bookmark share code is malformed');
  const rawFolders = value.folders as unknown as Array<Record<string, unknown>>;
  const fallbackLeague = options.fallbackLeague?.trim() || FALLBACK_LEAGUE;

  const byId = new Map<string, Record<string, unknown>>();
  rawFolders.forEach((folder) => {
    if (typeof folder.id === 'string' && folder.id && !byId.has(folder.id)) {
      byId.set(folder.id, folder);
    }
  });
  const order = (folder: Record<string, unknown>) =>
    typeof folder.index === 'number' && Number.isFinite(folder.index) ? folder.index : 0;
  const childrenOf = (parentId: string) =>
    rawFolders
      .filter((folder) => folder.parentId === parentId && folder.id !== parentId)
      .toSorted((left, right) => order(left) - order(right));
  const roots = rawFolders
    .filter(
      (folder) =>
        typeof folder.parentId !== 'string' ||
        !byId.has(folder.parentId) ||
        folder.parentId === folder.id,
    )
    .toSorted((left, right) => order(left) - order(right));

  const visited = new Set<Record<string, unknown>>();
  const convert = (folder: Record<string, unknown>): BookmarkTransferFolder | undefined => {
    if (visited.has(folder)) return undefined;
    visited.add(folder);
    const allBookmarks = folder.bookmarks as unknown[];
    const bookmarks = allBookmarks
      .filter(isObject)
      .toSorted((left, right) => numberOr(left.idx, 0) - numberOr(right.idx, 0))
      .flatMap((bookmark) => {
        const item = toTransferItem(bookmark, options.gameVersion, fallbackLeague);
        return item ? [item] : [];
      });
    const children = typeof folder.id === 'string' ? childrenOf(folder.id) : [];
    const subfolders = children.flatMap((child) => {
      const converted = convert(child);
      return converted ? [converted] : [];
    });
    // 只保留含本版本書籤的資料夾；原本就是空的資料夾也保留，僅含其他版本書籤者略過
    const isOriginallyEmpty = allBookmarks.length === 0 && children.length === 0;
    if (bookmarks.length === 0 && subfolders.length === 0 && !isOriginallyEmpty) return undefined;
    return {
      name: sanitizeName(folder.name, '未命名資料夾'),
      bookmarks,
      ...(subfolders.length > 0 ? { folders: subfolders } : {}),
    };
  };

  const folders = roots.flatMap((root) => {
    const converted = convert(root);
    return converted ? [converted] : [];
  });
  if (folders.length === 0 && rawFolders.length > 0) {
    throw new BookmarkTransferInputError('bookmarkTransfer.error.noBookmarksForVersion', {
      params: { version: options.gameVersion.toUpperCase() },
    });
  }

  const hint = readPoexdHint(value);
  const scope =
    hint?.gameVersion === options.gameVersion &&
    (hint.scope === 'collection' || folders.length === 1)
      ? hint.scope
      : folders.length === 1
        ? 'folder'
        : 'collection';
  return {
    kind: 'poexd-bookmarks',
    schemaVersion: 2,
    gameVersion: options.gameVersion,
    scope,
    folders,
  };
}

function toTransferItem(
  bookmark: Record<string, unknown>,
  gameVersion: PoeVersion,
  fallbackLeague: string,
): BookmarkTransferItem | undefined {
  if (fromTftVersion(bookmark.poeVersion) !== gameVersion) return undefined;
  const endpoint = typeof bookmark.endpoint === 'string' ? bookmark.endpoint.trim() : '';
  if (!endpoint || endpoint.length > MAX_ENDPOINT_LENGTH || /[/?#\s]/.test(endpoint)) {
    return undefined;
  }
  const type: TftBookmarkType = bookmark.type === 'exchange' ? 'exchange' : 'search';
  const rawLeague = typeof bookmark.league === 'string' ? bookmark.league.trim() : '';
  const pinned = rawLeague !== '' && rawLeague.toLowerCase() !== BOOKMARK_AUTO_LEAGUE.toLowerCase();
  const league = pinned ? rawLeague : fallbackLeague;
  const route = gameVersion === 'poe2' ? `trade2/${type}/poe2` : `trade/${type}`;
  const url = `${DEFAULT_TRADE_ORIGIN}/${route}/${encodeURIComponent(league)}/${encodeURIComponent(endpoint)}`;
  const coverImageUrl = isValidPoeCdnImageUrl(bookmark.coverImageUrl)
    ? (bookmark.coverImageUrl as string)
    : undefined;
  return {
    name: sanitizeName(bookmark.name, '未命名書籤'),
    url,
    ...(coverImageUrl ? { coverImageUrl } : {}),
    ...(pinned ? { leaguePinned: true as const } : {}),
  };
}

export function readPoexdHint(value: unknown): TftBookmarkExport['poexd'] | undefined {
  if (!isObject(value) || !isObject(value.poexd)) return undefined;
  const { scope, gameVersion } = value.poexd;
  if (scope !== 'collection' && scope !== 'folder') return undefined;
  if (gameVersion !== 'poe1' && gameVersion !== 'poe2') return undefined;
  return { scope, gameVersion };
}

function sanitizeName(value: unknown, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return (trimmed || fallback).slice(0, BOOKMARK_NAME_MAX_LENGTH);
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
