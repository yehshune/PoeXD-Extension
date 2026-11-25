import { describe, expect, it } from 'vitest';
import { flagInt, flagString, parseCliArgs } from '../e2e/live/cli-args.ts';
import {
  buildSearchUrl,
  DEFAULT_START_URLS,
  parseTradeUrl,
  resolveOpenTarget,
} from '../e2e/live/trade-url.ts';

describe('parseTradeUrl', () => {
  it('解析 PoE2 搜尋頁的聯盟、searchId 與 live', () => {
    expect(
      parseTradeUrl('https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/abc123/live'),
    ).toEqual({
      origin: 'https://www.pathofexile.com',
      game: 'poe2',
      league: 'Forbidden Rites',
      searchId: 'abc123',
      live: true,
    });
  });

  it('解析 PoE1 與台服網址，沒有 searchId 時為 null', () => {
    expect(parseTradeUrl('https://www.pathofexile.com/trade/search/Standard')).toMatchObject({
      game: 'poe1',
      league: 'Standard',
      searchId: null,
      live: false,
    });
    expect(parseTradeUrl('https://pathofexile.tw/trade/search/Mercenaries/xyz')).toMatchObject({
      origin: 'https://pathofexile.tw',
      game: 'poe1',
      league: 'Mercenaries',
      searchId: 'xyz',
    });
  });

  it('非搜尋頁或無效網址回傳 null', () => {
    expect(parseTradeUrl('chrome://history/')).toBeNull();
    expect(parseTradeUrl('https://www.pathofexile.com/forum')).toBeNull();
    expect(parseTradeUrl('not a url')).toBeNull();
  });
});

describe('buildSearchUrl / resolveOpenTarget', () => {
  const current = parseTradeUrl(
    'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/old/live',
  );

  it('組出的網址可再解析回相同內容', () => {
    const url = buildSearchUrl({ game: 'poe1', league: 'Settlers', searchId: 'id9', live: true });
    expect(url).toBe('https://www.pathofexile.com/trade/search/Settlers/id9/live');
    expect(parseTradeUrl(url)).toMatchObject({
      game: 'poe1',
      league: 'Settlers',
      searchId: 'id9',
      live: true,
    });
  });

  it('完整網址原樣使用，poe1/poe2 前往預設起始頁', () => {
    expect(resolveOpenTarget('https://example.com/x', current)).toBe('https://example.com/x');
    expect(resolveOpenTarget('poe1', null)).toBe(DEFAULT_START_URLS.poe1);
    expect(resolveOpenTarget('poe2', current)).toBe(DEFAULT_START_URLS.poe2);
  });

  it('searchId 沿用目前分頁的遊戲與聯盟，且不帶 live', () => {
    expect(resolveOpenTarget('newId', current)).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Forbidden%20Rites/newId',
    );
  });

  it('沒有可沿用的聯盟時要求改給完整網址', () => {
    expect(() => resolveOpenTarget('newId', null)).toThrow(/完整網址/);
  });
});

describe('parseCliArgs', () => {
  it('拆出指令、位置參數與三種旗標寫法', () => {
    const args = parseCliArgs(['store', 'persistent.stats', '--depth', '2', '--items=3', '--full']);
    expect(args.command).toBe('store');
    expect(args.positionals).toEqual(['persistent.stats']);
    expect(flagInt(args, 'depth')).toBe(2);
    expect(flagInt(args, 'items')).toBe(3);
    expect(args.flags.full).toBe(true);
  });

  it('布林旗標不吃下一個參數，結尾或接著旗標的 --key 視為 true', () => {
    const args = parseCliArgs(['open', '--new', 'poe2', '--tab']);
    expect(args.positionals).toEqual(['poe2']);
    expect(args.flags).toEqual({ new: true, tab: true });
    expect(flagString(args, 'tab')).toBeUndefined();
  });

  it('沒有參數時 command 為 null；--tab 非整數時丟錯', () => {
    expect(parseCliArgs([]).command).toBeNull();
    expect(() => flagInt(parseCliArgs(['status', '--tab', 'x']), 'tab')).toThrow(/非負整數/);
  });
});
