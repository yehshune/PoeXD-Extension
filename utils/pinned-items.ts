/**
 * Pinned Item（釘選物品）：使用者從市集結果釘選下來的快照。見 GLOSSARY.md、ADR-0017。
 *
 * 快照是「結果」而不是搜尋條件：只保存渲染卡片、複製文字與跳回來源搜尋需要的欄位。
 * 官方 fetch 回應是頁面送來的不可信輸入，這裡只挑白名單欄位，並且一律不保存
 * `hideout_token` / `whisper_token` 等有時效、綁定搜尋的 token。
 */
import { sanitizePinnedCardDom, type PinnedCardDom } from './pinned-card-dom';
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import type { PoeVersion } from './trade-context';
import { findTradeRealm, type TradeRealmId } from './trade-realms';

export const PINNED_ITEM_LIMIT = 50;

/**
 * 聯盟名稱比對不分大小寫：一般搜尋頁的 URL 是 `Covens`，線上搜尋主控台的訂閱聯盟是小寫 `covens`，
 * 兩者是同一個聯盟。快照保留原始寫法，只有比對時正規化。
 */
export const isSameLeague = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** 單筆物品 JSON 的大小上限（一般物品約 3 KB） */
export const PINNED_ITEM_MAX_JSON_LENGTH = 64 * 1024;
const MAX_TEXT_LENGTH = 512;
const MAX_WHISPER_LENGTH = 1024;

export function pinnedItemStorageKey(version: PoeVersion): string {
  return `poexdPinnedItemsV1_${version}`;
}

/** 物品 JSON 可保留的頂層欄位：renderer、PoB 文字與之後的比較（`extended.hashes`）會用到 */
const ITEM_KEYS = [
  'name',
  'typeLine',
  'baseType',
  'rarity',
  'frameType',
  'ilvl',
  'identified',
  'corrupted',
  'duplicated',
  'split',
  'mirrored',
  'unmodifiable',
  'fractured',
  'synthesised',
  'searing',
  'tangled',
  'influences',
  'w',
  'h',
  'stackSize',
  'maxStackSize',
  'note',
  'sockets',
  'properties',
  'requirements',
  'additionalProperties',
  'enchantMods',
  'implicitMods',
  'explicitMods',
  'craftedMods',
  'fracturedMods',
  'scourgeMods',
  'crucibleMods',
  'utilityMods',
  'runeMods',
  'desecratedMods',
  'sanctumMods',
  'veiledMods',
  'grantedSkills',
  'extended',
] as const;

export type PinnedItemData = Record<string, unknown> & { icon?: string };

export interface PinnedItemPrice {
  type?: string;
  amount: number;
  currency: string;
  /** 官方結果列價格旁的通貨圖示（官方 CDN），釘選時從結果列取得 */
  icon?: string;
  /** 結果列顯示的通貨名稱（可能已被市集漢化翻譯），只作為提示文字 */
  currencyName?: string;
}

export interface PinnedItemListing {
  method?: string;
  /** ISO 8601 刊登時間 */
  indexed?: string;
  price?: PinnedItemPrice;
  accountName?: string;
  /** 完整密語字串（含賣家角色名稱，不可寫入 log） */
  whisper?: string;
  fee?: number;
  stash?: { name?: string; x?: number; y?: number };
  /** 刊登時帶有 `hideout_token`：直購刊登，提供「前往藏身處」而沒有密語 */
  instantBuyout: boolean;
}

export interface PinnedItemSnapshot {
  /** 官方結果 id（`.row[data-id]`），同時是 `/fetch` 用的 id */
  id: string;
  gameVersion: PoeVersion;
  realm: TradeRealmId;
  /** 釘選時的市集 origin，例如 `https://www.pathofexile.com` */
  origin: string;
  league: string;
  /** 來源搜尋 id（短 id 或 gzip query hash）；不明時省略 */
  sourceSearchId?: string;
  /** 物品 JSON 的語系（釘選當時的頁面語系），PoB 文字反查英文時使用 */
  locale?: string;
  pinnedAt: number;
  item: PinnedItemData;
  listing: PinnedItemListing;
  /** 釘選時擷取的官方卡片快照（清理過的節點樹）；沒有時 Sidebar 以物品 JSON 自繪 */
  card?: PinnedCardDom;
  /** 是否已確認售出或下架（持久化保存，直到重新釘選、清除已售出或取消釘選） */
  sold?: boolean;
}

export interface PinnedItemSource {
  gameVersion: PoeVersion;
  origin: string;
  league: string;
  sourceSearchId?: string;
  locale?: string;
  /** 結果列上的通貨顯示（官方 fetch 回應沒有圖示網址） */
  currency?: { icon?: string; name?: string };
  /** 結果列上的官方卡片快照（未驗證；建立快照時驗證） */
  card?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedText = (value: unknown, max = MAX_TEXT_LENGTH): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** 只接受 JSON 可表示的值，並複製一份（不保留頁面物件的參照） */
function cloneJsonValue(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    if (json === undefined || json.length > PINNED_ITEM_MAX_JSON_LENGTH) return undefined;
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function sanitizePinnedItemData(raw: unknown): PinnedItemData | undefined {
  if (!isRecord(raw)) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of ITEM_KEYS) {
    if (raw[key] !== undefined) picked[key] = raw[key];
  }
  if (isValidPoeCdnImageUrl(raw.icon)) picked.icon = raw.icon;
  const cloned = cloneJsonValue(picked);
  if (!isRecord(cloned)) return undefined;
  if (!boundedText(cloned.typeLine) && !boundedText(cloned.baseType)) return undefined;
  return cloned as PinnedItemData;
}

export function sanitizePinnedItemListing(raw: unknown): PinnedItemListing | undefined {
  if (!isRecord(raw)) return undefined;
  const listing: PinnedItemListing = {
    instantBuyout: typeof raw.hideout_token === 'string' && raw.hideout_token.length > 0,
  };
  const method = boundedText(raw.method, 32);
  if (method) listing.method = method;
  const indexed = boundedText(raw.indexed, 64);
  if (indexed && !Number.isNaN(Date.parse(indexed))) listing.indexed = indexed;
  const whisper = boundedText(raw.whisper, MAX_WHISPER_LENGTH);
  if (whisper) listing.whisper = whisper;
  const fee = finiteNumber(raw.fee);
  if (fee !== undefined) listing.fee = fee;
  if (isRecord(raw.account)) {
    const accountName = boundedText(raw.account.name, 128);
    if (accountName) listing.accountName = accountName;
  }
  if (isRecord(raw.price)) {
    const amount = finiteNumber(raw.price.amount);
    const currency = boundedText(raw.price.currency, 64);
    if (amount !== undefined && currency) {
      const type = boundedText(raw.price.type, 32);
      const icon = isValidPoeCdnImageUrl(raw.price.icon) ? raw.price.icon : undefined;
      const currencyName = boundedText(raw.price.currencyName, 64);
      listing.price = {
        amount,
        currency,
        ...(type ? { type } : {}),
        ...(icon ? { icon } : {}),
        ...(currencyName ? { currencyName } : {}),
      };
    }
  }
  if (isRecord(raw.stash)) {
    const stash: NonNullable<PinnedItemListing['stash']> = {};
    const name = boundedText(raw.stash.name, 128);
    const x = finiteNumber(raw.stash.x);
    const y = finiteNumber(raw.stash.y);
    if (name) stash.name = name;
    if (x !== undefined) stash.x = x;
    if (y !== undefined) stash.y = y;
    if (Object.keys(stash).length > 0) listing.stash = stash;
  }
  return listing;
}

/** 把結果列上的通貨圖示與名稱併入官方 listing.price，再交給白名單驗證 */
function withCurrencyDisplay(listing: unknown, currency: PinnedItemSource['currency']): unknown {
  if (!currency || !isRecord(listing) || !isRecord(listing.price)) return listing;
  return {
    ...listing,
    price: { ...listing.price, icon: currency.icon, currencyName: currency.name },
  };
}

/** 由官方 fetch 結果的一筆 `{ id, item, listing }` 建立快照；欄位不足時回傳 undefined */
export function createPinnedItemSnapshot(
  entry: { id: unknown; item: unknown; listing: unknown },
  source: PinnedItemSource,
  pinnedAt: number,
): PinnedItemSnapshot | undefined {
  const id = boundedText(entry.id, 128);
  const item = sanitizePinnedItemData(entry.item);
  const listing = sanitizePinnedItemListing(withCurrencyDisplay(entry.listing, source.currency));
  const realm = parseRealmFromOrigin(source.origin);
  const league = boundedText(source.league, 128);
  if (!id || !item || !listing || !realm || !league) return undefined;
  const sourceSearchId = boundedText(source.sourceSearchId, 4096);
  const locale = boundedText(source.locale, 16);
  const card = source.card === undefined ? undefined : sanitizePinnedCardDom(source.card);
  return {
    id,
    gameVersion: source.gameVersion,
    realm,
    origin: new URL(source.origin).origin,
    league,
    ...(sourceSearchId ? { sourceSearchId } : {}),
    ...(locale ? { locale } : {}),
    pinnedAt,
    item,
    listing,
    ...(card ? { card } : {}),
  };
}

function parseRealmFromOrigin(origin: unknown): TradeRealmId | undefined {
  if (typeof origin !== 'string') return undefined;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return undefined;
    return findTradeRealm(url.hostname)?.id;
  } catch {
    return undefined;
  }
}

/** 讀回儲存的快照：重新走一次白名單，較新版本寫入的未知格式回傳 undefined */
export function parseStoredPinnedItem(
  value: unknown,
  version: PoeVersion,
): PinnedItemSnapshot | undefined {
  if (!isRecord(value) || value.gameVersion !== version) return undefined;
  const pinnedAt = finiteNumber(value.pinnedAt);
  if (pinnedAt === undefined || !isRecord(value.listing)) return undefined;
  const snapshot = createPinnedItemSnapshot(
    {
      id: value.id,
      item: value.item,
      // 儲存格式的 listing 已是整理後的形狀，轉回官方欄位名稱再驗證一次
      listing: {
        method: value.listing.method,
        indexed: value.listing.indexed,
        whisper: value.listing.whisper,
        fee: value.listing.fee,
        price: value.listing.price,
        stash: value.listing.stash,
        account: { name: value.listing.accountName },
        hideout_token: value.listing.instantBuyout === true ? 'stored' : undefined,
      },
    },
    {
      gameVersion: version,
      origin: typeof value.origin === 'string' ? value.origin : '',
      league: typeof value.league === 'string' ? value.league : '',
      sourceSearchId: typeof value.sourceSearchId === 'string' ? value.sourceSearchId : undefined,
      locale: typeof value.locale === 'string' ? value.locale : undefined,
      card: value.card,
    },
    pinnedAt,
  );
  if (!snapshot || snapshot.realm !== value.realm) return undefined;
  return value.sold === true ? { ...snapshot, sold: true } : snapshot;
}

interface StoredPinnedList {
  items: PinnedItemSnapshot[];
  /** 無法解析的原始項目（例如較新版本寫入的格式），寫回時原樣保留 */
  unparsed: unknown[];
}

export function parseStoredPinnedList(value: unknown, version: PoeVersion): StoredPinnedList {
  if (!Array.isArray(value)) return { items: [], unparsed: [] };
  return value.reduce<StoredPinnedList>(
    (acc, raw) => {
      const parsed = parseStoredPinnedItem(raw, version);
      return parsed
        ? { ...acc, items: [...acc.items, parsed] }
        : { ...acc, unparsed: [...acc.unparsed, raw] };
    },
    { items: [], unparsed: [] },
  );
}

// ---------------------------------------------------------------------------
// 儲存模組（只在 background 執行寫入，避免多個分頁同時讀改寫互相覆蓋）
// ---------------------------------------------------------------------------

export interface PinnedItemStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export type PinnedItemCommand =
  | { type: 'pin'; gameVersion: PoeVersion; snapshot: unknown }
  | { type: 'unpin'; gameVersion: PoeVersion; id: string }
  | { type: 'mark-sold'; gameVersion: PoeVersion; id: string }
  | { type: 'clear'; gameVersion: PoeVersion; league?: string }
  | { type: 'clear-sold'; gameVersion: PoeVersion; league?: string }
  /**
   * 依 ids 的順序重排：列出的物品照新順序填回它們原本佔的位置，沒列出的不動。
   * 只顯示目前聯盟時拖曳排序，其他聯盟的釘選因此維持原位。
   */
  | { type: 'reorder'; gameVersion: PoeVersion; ids: string[] };

export type PinnedItemErrorCode = 'limit' | 'invalid' | 'unavailable';

export type PinnedItemOutcome =
  | { ok: true }
  | { ok: false; error: { code: PinnedItemErrorCode; message: string } };

const fail = (code: PinnedItemErrorCode, message: string): PinnedItemOutcome => ({
  ok: false,
  error: { code, message },
});

const isPoeVersion = (value: unknown): value is PoeVersion => value === 'poe1' || value === 'poe2';

/**
 * 依 ids 的順序重排（回傳新陣列，不修改輸入）：列出的物品照新順序填回它們原本佔的位置，
 * 沒列出或不存在的 id 不影響其他物品。只顯示目前聯盟時拖曳排序，其他聯盟的釘選因此維持原位。
 */
export function applyPinnedOrder<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = [...new Set(ids)].flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const listed = new Set(ordered.map((item) => item.id));
  let slot = 0;
  return items.map((item) => (listed.has(item.id) ? ordered[slot++]! : item));
}

export interface PinnedItemStore {
  execute(command: unknown): Promise<PinnedItemOutcome>;
}

/**
 * 依遊戲版本隔離、只存在本機的釘選清單。寫入依序排隊執行；
 * 同一件物品再次釘選時以新快照取代並移到最前面。
 */
export function createPinnedItemStore(storage: PinnedItemStorage): PinnedItemStore {
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (command: PinnedItemCommand): Promise<PinnedItemOutcome> => {
    const key = pinnedItemStorageKey(command.gameVersion);
    const { items, unparsed } = parseStoredPinnedList(
      (await storage.get([key]))[key],
      command.gameVersion,
    );
    let next: PinnedItemSnapshot[];
    switch (command.type) {
      case 'pin': {
        const snapshot = parseStoredPinnedItem(command.snapshot, command.gameVersion);
        if (!snapshot) return fail('invalid', 'Invalid pinned item snapshot');
        const others = items.filter((item) => item.id !== snapshot.id);
        if (others.length + unparsed.length >= PINNED_ITEM_LIMIT) {
          return fail('limit', `Pinned item limit (${PINNED_ITEM_LIMIT}) reached`);
        }
        next = [snapshot, ...others];
        break;
      }
      case 'unpin':
        next = items.filter((item) => item.id !== command.id);
        break;
      case 'mark-sold':
        next = items.map((item) => (item.id === command.id ? { ...item, sold: true } : item));
        break;
      case 'reorder':
        next = applyPinnedOrder(items, command.ids);
        break;
      case 'clear': {
        const { league } = command;
        next =
          league === undefined ? [] : items.filter((item) => !isSameLeague(item.league, league));
        break;
      }
      case 'clear-sold': {
        const { league } = command;
        next = items.filter(
          (item) =>
            !(item.sold === true && (league === undefined || isSameLeague(item.league, league))),
        );
        break;
      }
    }
    await storage.set({ [key]: [...next, ...unparsed] });
    return { ok: true };
  };

  return {
    execute(raw) {
      const command = parsePinnedItemCommand(raw);
      if (!command) return Promise.resolve(fail('invalid', 'Invalid pinned item command'));
      const result = queue.then(
        () => run(command),
        () => run(command),
      );
      queue = result.catch(() => undefined);
      return result.catch((error: unknown) =>
        fail('unavailable', error instanceof Error ? error.message : String(error)),
      );
    },
  };
}

function parseOptionalLeagueCommand(
  type: 'clear' | 'clear-sold',
  gameVersion: PoeVersion,
  league: unknown,
): PinnedItemCommand | undefined {
  if (league !== undefined && typeof league !== 'string') return undefined;
  return {
    type,
    gameVersion,
    ...(typeof league === 'string' ? { league } : {}),
  };
}

/** 訊息來自 content script，視為跨信任邊界的輸入 */
export function parsePinnedItemCommand(raw: unknown): PinnedItemCommand | undefined {
  if (!isRecord(raw) || !isPoeVersion(raw.gameVersion)) return undefined;
  const gameVersion = raw.gameVersion;
  switch (raw.type) {
    case 'pin':
      return { type: 'pin', gameVersion, snapshot: raw.snapshot };
    case 'unpin':
    case 'mark-sold':
      return typeof raw.id === 'string' && raw.id
        ? { type: raw.type, gameVersion, id: raw.id }
        : undefined;
    case 'clear':
    case 'clear-sold':
      return parseOptionalLeagueCommand(raw.type, gameVersion, raw.league);
    case 'reorder': {
      const ids = raw.ids;
      if (
        !Array.isArray(ids) ||
        ids.length > PINNED_ITEM_LIMIT * 2 ||
        !ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 128) ||
        new Set(ids).size !== ids.length
      ) {
        return undefined;
      }
      return { type: 'reorder', gameVersion, ids: [...(ids as string[])] };
    }
    default:
      return undefined;
  }
}
