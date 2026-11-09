/**
 * Better Trading（exile-center/better-trading）書籤分享格式轉接層。
 *
 * 單一資料夾分享碼：
 * - v3：`3:` + Base64(UTF-8(JSON))，JSON 為 `{ icn, tit, ver, trs: [{ tit, loc: "版本:類型:slug" }] }`
 * - v2：`2:` + Base64(UTF-8(JSON))，`loc` 為 `類型:slug`，一律為 PoE1
 * - v1：無前綴 `btoa(JSON)`（Latin-1），格式同 v2
 *
 * 備份檔：每行一個資料夾分享碼，「啟用中」與「已封存」兩區以 `--------------------` 分隔。
 *
 * Better Trading 書籤不記錄聯盟，因此一律轉為 TFT 的自動聯盟（`Auto`），
 * 再交由 TFT 轉接層處理遊戲版本過濾與網址組裝。
 */
import type { PoeVersion } from './trade-context';
import { BookmarkTransferInputError } from './bookmark-transfer-errors';
import { BOOKMARK_AUTO_LEAGUE } from './bookmark-target';
import { decodeTftBase64 } from './bookmark-transfer-tft';
import type { TftBookmark, TftBookmarkExport, TftFolder } from './bookmark-transfer-tft';

const SECTION_DELIMITER_PATTERN = /^-{3,}$/;
const VERSIONED_PREFIX_PATTERN = /^[23]:/;
const MAX_FOLDERS = 500;

export interface BetterTradingImport {
  value: TftBookmarkExport;
  /** 匯入目標遊戲版本：呼叫端指定，否則取第一個資料夾的版本。 */
  gameVersion: PoeVersion;
}

interface DecodedFolder {
  folder: TftFolder;
  gameVersion: PoeVersion;
}

interface BetterTradingFolderJson {
  tit: string;
  ver?: unknown;
  trs: Array<{ tit?: unknown; loc?: unknown }>;
}

/**
 * 嘗試將輸入解析為 Better Trading 分享碼或備份檔。
 * 不是 Better Trading 格式時回傳 `undefined`，讓呼叫端改走其他格式；
 * 看起來是 Better Trading 但內容損毀時拋出錯誤。
 */
export function parseBetterTradingExport(
  input: string,
  options: { gameVersion?: PoeVersion } = {},
): BetterTradingImport | undefined {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !SECTION_DELIMITER_PATTERN.test(line));
  if (lines.length === 0) return undefined;

  const looksVersioned = lines.some((line) => VERSIONED_PREFIX_PATTERN.test(line));
  const decoded = lines.map(decodeBetterTradingLine);
  // 無版本前綴的單行輸入可能是 TFT 分享碼：只有內容確實是 Better Trading v1 JSON 才接手
  if (!looksVersioned && decoded.every((folder) => folder === undefined)) return undefined;

  const valid = decoded.filter((entry): entry is DecodedFolder => entry !== undefined);
  if (valid.length === 0) {
    throw new BookmarkTransferInputError('bookmarkTransfer.error.betterTradingCorrupted');
  }
  if (valid.length > MAX_FOLDERS) {
    throw new Error(`Bookmark Transfer supports at most ${MAX_FOLDERS} folders`);
  }
  const gameVersion = options.gameVersion ?? valid[0].gameVersion;
  // 空資料夾沒有書籤可判斷版本，改以資料夾本身的版本過濾，避免 PoE2 空資料夾匯入 PoE1
  const folders = valid
    .filter((entry) => entry.folder.bookmarks.length > 0 || entry.gameVersion === gameVersion)
    .map((entry, index) => ({ ...entry.folder, id: `bt-folder-${index}`, index }));
  if (folders.length === 0) {
    throw new BookmarkTransferInputError('bookmarkTransfer.error.noBookmarksForVersion', {
      params: { version: gameVersion.toUpperCase() },
    });
  }
  return { value: { folders }, gameVersion };
}

function decodeBetterTradingLine(line: string): DecodedFolder | undefined {
  const versioned = VERSIONED_PREFIX_PATTERN.test(line);
  const exportVersion = versioned ? Number(line[0]) : 1;
  const json = versioned
    ? safeDecode(() => decodeTftBase64(line.slice(2)))
    : safeDecode(() => atob(line));
  if (json === undefined) return undefined;
  const parsed = safeDecode(() => JSON.parse(json) as unknown);
  if (!isBetterTradingFolderJson(parsed)) return undefined;
  const folderVersion = exportVersion >= 3 && parsed.ver === '2' ? '2' : '1';
  return {
    folder: toTftFolder(parsed, exportVersion, folderVersion),
    gameVersion: folderVersion === '2' ? 'poe2' : 'poe1',
  };
}

function toTftFolder(
  folder: BetterTradingFolderJson,
  exportVersion: number,
  folderVersion: '1' | '2',
): TftFolder {
  const bookmarks = folder.trs.flatMap((trade, idx): TftBookmark[] => {
    if (typeof trade?.loc !== 'string') return [];
    const parts = trade.loc.split(':');
    const [version, type, slug] = exportVersion >= 3 ? parts : [folderVersion, ...parts];
    if ((type !== 'search' && type !== 'exchange') || !slug) return [];
    return [
      {
        id: `bt-${idx}`,
        name: typeof trade.tit === 'string' ? trade.tit : '',
        league: BOOKMARK_AUTO_LEAGUE,
        poeVersion: version === '2' ? 'Poe2' : 'Poe1',
        endpoint: slug,
        type,
        idx,
        isDone: false,
      },
    ];
  });
  return {
    id: '',
    name: folder.tit,
    parentId: null,
    depth: 0,
    childIds: [],
    index: 0,
    isOpen: true,
    icon: 'TFT',
    bookmarks,
  };
}

function isBetterTradingFolderJson(value: unknown): value is BetterTradingFolderJson {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).tit === 'string' &&
    Array.isArray((value as Record<string, unknown>).trs)
  );
}

function safeDecode<T>(decode: () => T): T | undefined {
  try {
    return decode();
  } catch {
    return undefined;
  }
}
