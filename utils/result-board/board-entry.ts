/**
 * 把官方 `/fetch` 結果（不可信輸入）轉成看板用的精簡資料。
 *
 * 只取看板需要的欄位，不保留 token 或密語字串；缺少賣家帳號或物品名稱的結果無法放進看板。
 */
import { isValidPoeCdnImageUrl } from '@/utils/poe-cdn-url';
import type { TradeResultEntry } from '@/utils/trade-result-cache';

export type SellerPresence = 'online' | 'afk' | 'offline';

export interface BoardSeller {
  /** 帳號名稱：同帳號不同角色算同一位賣家 */
  account: string;
  character?: string;
  presence: SellerPresence;
}

export interface BoardPrice {
  amount: number;
  currency: string;
}

export interface BoardEntry {
  id: string;
  /** 官方結果順序（從 0 開始） */
  order: number;
  name: string;
  typeLine: string;
  frameType?: number;
  /** 官方 CDN 的物品圖示 */
  icon?: string;
  price?: BoardPrice;
  /** 刊登時間（epoch ms） */
  indexedAt?: number;
  /** 可直接前往藏身處購買；否則需要私訊 */
  instantBuyout: boolean;
  seller: BoardSeller;
}

const MAX_TEXT_LENGTH = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === 'string' && value.length <= MAX_TEXT_LENGTH ? value : '';

/** PoE 2 的 `[標籤|顯示文字]` 或 `[標籤]` 標記只顯示文字 */
const unwrapMarkup = (value: string): string => value.replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');

function readPrice(value: unknown): BoardPrice | undefined {
  if (!isRecord(value)) return undefined;
  const { amount } = value;
  const currency = text(value.currency);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !currency) {
    return undefined;
  }
  return { amount, currency };
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
  const name = unwrapMarkup(text(item.name));
  const typeLine = unwrapMarkup(text(item.typeLine) || text(item.baseType));
  if (!seller || (!name && !typeLine)) return undefined;

  const price = readPrice(listing.price);
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
    ...(frameType !== undefined ? { frameType } : {}),
    ...(isValidPoeCdnImageUrl(item.icon) ? { icon: item.icon } : {}),
    ...(price ? { price } : {}),
    ...(indexedAt !== undefined ? { indexedAt } : {}),
    instantBuyout: typeof hideoutToken === 'string' && hideoutToken.length > 0,
    seller,
  };
}
