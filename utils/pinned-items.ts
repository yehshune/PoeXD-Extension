/**
 * Pinned Item（釘選物品）：使用者從市集結果釘選下來的快照。見 CONTEXT.md、ADR-0017。
 *
 * 快照是「結果」而不是搜尋條件：只保存渲染卡片、複製文字與跳回來源搜尋需要的欄位。
 * 官方 fetch 回應是頁面送來的不可信輸入，這裡只挑白名單欄位，並且一律不保存
 * `hideout_token` / `whisper_token` 等有時效、綁定搜尋的 token。
 */
import { isValidPoeCdnImageUrl } from './poe-cdn-url';
import type { PoeVersion } from './trade-context';
import { findTradeRealm, type TradeRealmId } from './trade-realms';

export const PINNED_ITEM_LIMIT = 50;
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
}

export interface PinnedItemSource {
  gameVersion: PoeVersion;
  origin: string;
  league: string;
  sourceSearchId?: string;
  locale?: string;
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
      listing.price = { amount, currency, ...(type ? { type } : {}) };
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

/** 由官方 fetch 結果的一筆 `{ id, item, listing }` 建立快照；欄位不足時回傳 undefined */
export function createPinnedItemSnapshot(
  entry: { id: unknown; item: unknown; listing: unknown },
  source: PinnedItemSource,
  pinnedAt: number,
): PinnedItemSnapshot | undefined {
  const id = boundedText(entry.id, 128);
  const item = sanitizePinnedItemData(entry.item);
  const listing = sanitizePinnedItemListing(entry.listing);
  const realm = parseRealmFromOrigin(source.origin);
  const league = boundedText(source.league, 128);
  if (!id || !item || !listing || !realm || !league) return undefined;
  const sourceSearchId = boundedText(source.sourceSearchId, 4096);
  const locale = boundedText(source.locale, 16);
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
    },
    pinnedAt,
  );
  return snapshot && snapshot.realm === value.realm ? snapshot : undefined;
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
  | { type: 'clear'; gameVersion: PoeVersion; league?: string };

export type PinnedItemErrorCode = 'limit' | 'invalid' | 'unavailable';

export type PinnedItemOutcome =
  | { ok: true }
  | { ok: false; error: { code: PinnedItemErrorCode; message: string } };

const fail = (code: PinnedItemErrorCode, message: string): PinnedItemOutcome => ({
  ok: false,
  error: { code, message },
});

const isPoeVersion = (value: unknown): value is PoeVersion => value === 'poe1' || value === 'poe2';

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
      case 'clear':
        next =
          command.league === undefined
            ? []
            : items.filter((item) => item.league !== command.league);
        break;
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

/** 訊息來自 content script，視為跨信任邊界的輸入 */
export function parsePinnedItemCommand(raw: unknown): PinnedItemCommand | undefined {
  if (!isRecord(raw) || !isPoeVersion(raw.gameVersion)) return undefined;
  const gameVersion = raw.gameVersion;
  switch (raw.type) {
    case 'pin':
      return { type: 'pin', gameVersion, snapshot: raw.snapshot };
    case 'unpin':
      return typeof raw.id === 'string' && raw.id
        ? { type: 'unpin', gameVersion, id: raw.id }
        : undefined;
    case 'clear':
      if (raw.league !== undefined && typeof raw.league !== 'string') return undefined;
      return {
        type: 'clear',
        gameVersion,
        ...(typeof raw.league === 'string' ? { league: raw.league } : {}),
      };
    default:
      return undefined;
  }
}
