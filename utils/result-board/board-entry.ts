/**
 * 把官方 `/fetch` 結果（不可信輸入）轉成看板用的精簡資料。
 *
 * 只取看板需要的欄位，不保留 token 或密語字串；缺少賣家帳號或物品名稱的結果無法放進看板。
 */
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import {
  readTradeItemModData,
  readTradeItemModLines,
  unwrapItemMarkup,
  type TradeItemModRoll,
} from '@/utils/trade-item-mods';
import type { TradeResultEntry } from '@/utils/trade-result-cache';

export type BoardModRoll = TradeItemModRoll;

export type SellerPresence = 'online' | 'afk' | 'offline';

export interface BoardSeller {
  /** 帳號名稱：同帳號不同角色算同一位賣家 */
  account: string;
  character?: string;
  presence: SellerPresence;
}

/** 一行詞綴原文與其 stat id；用來把詞綴條件對回實際數值 */
export interface BoardModStat {
  /** 不含 `stat.` 前綴的 stat id（例如 `explicit.stat_1509134228`） */
  statId: string;
  text: string;
}

export interface BoardPrice {
  amount: number;
  currency: string;
}

/** 物品所在的倉庫分頁名稱與格位座標（官方 0-based） */
export interface BoardStash {
  name?: string;
  x?: number;
  y?: number;
}

export interface BoardEntry {
  id: string;
  /** 官方結果順序（從 0 開始） */
  order: number;
  name: string;
  typeLine: string;
  /** 基底名稱（魔法物品的 typeLine 含詞綴）；倉庫搜尋 regex 用 */
  baseType?: string;
  frameType?: number;
  /** 官方 CDN 的物品圖示 */
  icon?: string;
  price?: BoardPrice;
  /** 直購金幣手續費（官方 `listing.fee`） */
  fee?: number;
  stash?: BoardStash;
  /** 遊戲內物品的標價備註，市集寫法（例如 `~b/o 2 chaos`）；倉庫搜尋 regex 用 */
  note?: string;
  /** 物品詞綴原文（explicit / implicit / fractured / crafted / enchant 等）；看板搜尋用 */
  mods?: readonly string[];
  /** 有 stat id 的詞綴行；看板外層顯示命中條件的數值用 */
  modStats?: readonly BoardModStat[];
  /** 官方 `extended.mods` 的階級與詞綴名（例如 `P1`、`S1`、`Merciless`）；看板搜尋用 */
  modTiers?: readonly string[];
  /** 官方 `extended.mods` 拆解出的獨立詞條（含 stat hash 組合、是否複合、階級） */
  modRolls?: readonly BoardModRoll[];
  /** 刊登時間（epoch ms） */
  indexedAt?: number;
  /** 可直接前往藏身處購買；否則需要私訊 */
  instantBuyout: boolean;
  seller: BoardSeller;
}

const MAX_TEXT_LENGTH = 256;
const MAX_MOD_LINE_LENGTH = 512;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value : '';

function readMods(item: Record<string, unknown>): {
  mods?: readonly string[];
  modStats?: readonly BoardModStat[];
} {
  const lines = readTradeItemModLines(item, { maxLineLength: MAX_MOD_LINE_LENGTH });
  const mods = lines.map((line) => line.text);
  const modStats = lines.flatMap((line) =>
    line.statId ? [{ statId: line.statId, text: line.text }] : [],
  );
  return {
    ...(mods.length > 0 ? { mods } : {}),
    ...(modStats.length > 0 ? { modStats } : {}),
  };
}

function readPrice(value: unknown): BoardPrice | undefined {
  if (!isRecord(value)) return undefined;
  const { amount } = value;
  const currency = text(value.currency);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !currency) {
    return undefined;
  }
  return { amount, currency };
}

const PRICE_TYPES = new Set(['~b/o', '~price']);
const NOTE_PATTERN = /^~(?:b\/o|price) \S/;

/**
 * 物品自己的備註優先（保留賣家寫法，例如 `1/2 divine`）；整個倉庫頁標價的物品沒有備註，
 * 改用官方標價組回市集寫法
 */
function readNote(item: Record<string, unknown>, listingPrice: unknown): string | undefined {
  const note = text(item.note).replace(/\s+/g, ' ').trim();
  if (NOTE_PATTERN.test(note)) return note;
  if (!isRecord(listingPrice)) return undefined;
  const type = text(listingPrice.type);
  const price = readPrice(listingPrice);
  if (!price || !PRICE_TYPES.has(type)) return undefined;
  return `${type} ${price.amount} ${price.currency}`;
}

function readStash(value: unknown): BoardStash | undefined {
  if (!isRecord(value)) return undefined;
  const name = text(value.name).trim();
  const x =
    typeof value.x === 'number' && Number.isInteger(value.x) && value.x >= 0 ? value.x : undefined;
  const y =
    typeof value.y === 'number' && Number.isInteger(value.y) && value.y >= 0 ? value.y : undefined;
  if (!name && x === undefined && y === undefined) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
  };
}

function readIndexedAt(value: unknown): number | undefined {
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readPresence(online: unknown): SellerPresence {
  if (!isRecord(online)) return 'offline';
  return online.status === 'afk' ? 'afk' : 'online';
}

function readSeller(account: unknown): BoardSeller | undefined {
  if (!isRecord(account)) return undefined;
  const name = text(account.name);
  if (!name) return undefined;
  const character = text(account.lastCharacterName);
  return {
    account: name,
    ...(character ? { character } : {}),
    presence: readPresence(account.online),
  };
}

export function toBoardEntry(raw: TradeResultEntry, order: number): BoardEntry | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return undefined;
  const { item, listing } = raw;
  if (!isRecord(item) || !isRecord(listing)) return undefined;
  const seller = readSeller(listing.account);
  const name = unwrapItemMarkup(text(item.name));
  const baseType = unwrapItemMarkup(text(item.baseType));
  const typeLine = unwrapItemMarkup(text(item.typeLine)) || baseType;
  if (!seller || (!name && !typeLine)) return undefined;

  const price = readPrice(listing.price);
  const fee =
    typeof listing.fee === 'number' && Number.isFinite(listing.fee) && listing.fee > 0
      ? listing.fee
      : undefined;
  const stash = readStash(listing.stash);
  const note = readNote(item, listing.price);
  const { mods, modStats } = readMods(item);
  const { modTiers, modRolls } = readTradeItemModData(item);
  const indexedAt = readIndexedAt(listing.indexed);
  const frameType =
    typeof item.frameType === 'number' && Number.isFinite(item.frameType)
      ? item.frameType
      : undefined;
  const hideoutToken = listing.hideout_token;
  return {
    id: raw.id,
    order,
    name,
    typeLine,
    ...(baseType ? { baseType } : {}),
    ...(frameType !== undefined ? { frameType } : {}),
    ...(isValidPoeCdnImageUrl(item.icon) ? { icon: item.icon } : {}),
    ...(price ? { price } : {}),
    ...(fee !== undefined ? { fee } : {}),
    ...(stash ? { stash } : {}),
    ...(note ? { note } : {}),
    ...(mods ? { mods } : {}),
    ...(modStats ? { modStats } : {}),
    ...(modTiers ? { modTiers } : {}),
    ...(modRolls ? { modRolls } : {}),
    ...(indexedAt !== undefined ? { indexedAt } : {}),
    instantBuyout: typeof hideoutToken === 'string' && hideoutToken.length > 0,
    seller,
  };
}
