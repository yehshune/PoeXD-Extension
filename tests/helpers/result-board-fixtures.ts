import type { TradeResultEntry } from '@/utils/trade-result-cache';

export interface RawResultOptions {
  id: string;
  account?: string;
  character?: string;
  online?: 'online' | 'afk' | 'offline';
  instantBuyout?: boolean;
  amount?: number;
  currency?: string;
  indexed?: string;
  name?: string;
  typeLine?: string;
  frameType?: number;
  searchId?: string;
  note?: string;
  priceType?: string;
  baseType?: string;
}

/** 組出一筆形狀比照官方 `/fetch` 的快取結果 */
export function rawResult(options: RawResultOptions): TradeResultEntry {
  const {
    id,
    account = 'Seller#0001',
    character = 'SellerChar',
    online = 'online',
    instantBuyout = true,
    amount = 1,
    currency = 'chaos',
    indexed = '2026-11-19T10:00:00Z',
    name = '',
    typeLine = 'Vaal Regalia',
    frameType = 2,
    searchId = 'search-1',
    note,
    priceType = '~price',
    baseType = options.typeLine ?? 'Vaal Regalia',
  } = options;
  const onlineValue =
    online === 'offline'
      ? null
      : online === 'afk'
        ? { league: 'Std', status: 'afk' }
        : { league: 'Std' };
  return {
    id,
    sourceSearchId: searchId,
    receivedAt: 0,
    item: {
      name,
      typeLine,
      baseType,
      frameType,
      icon: 'https://web.poecdn.com/x.png',
      ...(note !== undefined ? { note } : {}),
    },
    listing: {
      indexed,
      account: { name: account, lastCharacterName: character, online: onlineValue },
      price: { type: priceType, amount, currency },
      ...(instantBuyout ? { hideout_token: 'token' } : { whisper: '@x hi' }),
    },
  };
}
