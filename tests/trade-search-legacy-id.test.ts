import { describe, expect, it } from 'vitest';
import {
  isLegacySearchId,
  isLegacyTradeSearchUrl,
  isSameTradeSearchPageUrl,
} from '../utils/trade-search-identity';

const GZIP_ID = 'H4sIAAAAAAAACoVQ0WrDMAz8l3s2JXWcZfWvjFI0Ww0Gx8lsp10J';

describe('isLegacySearchId', () => {
  it('treats gzip query hashes as current search IDs', () => {
    expect(isLegacySearchId(GZIP_ID)).toBe(false);
  });

  it('treats short server-issued IDs as legacy', () => {
    expect(isLegacySearchId('Ab3dEfGhi')).toBe(true);
  });

  it('does not flag empty input', () => {
    expect(isLegacySearchId('')).toBe(false);
    expect(isLegacySearchId('   ')).toBe(false);
  });
});

describe('isLegacyTradeSearchUrl', () => {
  it('flags PoE 1 and PoE 2 item searches with short IDs', () => {
    expect(isLegacyTradeSearchUrl('https://www.pathofexile.com/trade/search/Standard/Ab3dEf')).toBe(
      true,
    );
    expect(
      isLegacyTradeSearchUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/Ab3dEf/live'),
    ).toBe(true);
  });

  it('accepts gzip item searches', () => {
    expect(
      isLegacyTradeSearchUrl(`https://www.pathofexile.com/trade2/search/poe2/Standard/${GZIP_ID}`),
    ).toBe(false);
  });

  it('never flags currency exchange URLs', () => {
    expect(
      isLegacyTradeSearchUrl('https://www.pathofexile.com/trade/exchange/Standard/Ab3dEf'),
    ).toBe(false);
  });

  it('never flags URLs without a search identity', () => {
    expect(isLegacyTradeSearchUrl('https://www.pathofexile.com/trade/search/Standard')).toBe(false);
    expect(isLegacyTradeSearchUrl('not a url')).toBe(false);
  });
});

describe('evaluateLiveSearchSourceCompatibility legacy check', () => {
  const context = { gameVersion: 'poe1' as const, runtimeLeague: 'Standard' };
  const identity = { gameVersion: 'poe1' as const, league: 'Standard', searchId: 'Ab3dEf' };

  it('marks short-ID item searches as invalid', async () => {
    const { evaluateLiveSearchSourceCompatibility } =
      await import('../entrypoints/content/logic/live-search-bookmark-controller');
    const url = 'https://www.pathofexile.com/trade/search/Standard/Ab3dEf';
    expect(evaluateLiveSearchSourceCompatibility(identity, context, url).compatibility).toBe(
      'invalid-url',
    );
    expect(evaluateLiveSearchSourceCompatibility(identity, context).compatibility).toBe(
      'invalid-url',
    );
  });

  it('does not flag currency exchange bookmarks as legacy', async () => {
    const { evaluateLiveSearchSourceCompatibility } =
      await import('../entrypoints/content/logic/live-search-bookmark-controller');
    const url = 'https://www.pathofexile.com/trade/exchange/Standard/Ab3dEf';
    expect(evaluateLiveSearchSourceCompatibility(identity, context, url).compatibility).toBe(
      'compatible',
    );
  });
});

describe('isSameTradeSearchPageUrl', () => {
  it('matches identical search URLs regardless of /live suffix, query, hash, trailing slash, or realm host', () => {
    expect(
      isSameTradeSearchPageUrl(
        `https://www.pathofexile.com/trade/search/Standard/${GZIP_ID}/live?foo=1#top`,
        `https://pathofexile.tw/trade/search/Standard/${GZIP_ID}/`,
      ),
    ).toBe(true);
    expect(
      isSameTradeSearchPageUrl(
        `https://www.pathofexile.com/trade2/search/poe2/Dawn%20of%20the%20Hunt/${GZIP_ID}/live`,
        `https://www.pathofexile.com/trade2/search/poe2/dawn%20of%20the%20hunt/${GZIP_ID}`,
      ),
    ).toBe(true);
  });

  it('distinguishes /search/ from /exchange/ and different leagues or IDs', () => {
    expect(
      isSameTradeSearchPageUrl(
        `https://www.pathofexile.com/trade/search/Standard/${GZIP_ID}`,
        `https://www.pathofexile.com/trade/exchange/Standard/${GZIP_ID}`,
      ),
    ).toBe(false);
    expect(
      isSameTradeSearchPageUrl(
        `https://www.pathofexile.com/trade/search/Standard/${GZIP_ID}`,
        `https://www.pathofexile.com/trade/search/Settlers/${GZIP_ID}`,
      ),
    ).toBe(false);
  });

  it('never matches non-search URLs even when strings are equal', () => {
    expect(
      isSameTradeSearchPageUrl(
        'https://www.pathofexile.com/trade/search/Standard',
        'https://www.pathofexile.com/trade/search/Standard',
      ),
    ).toBe(false);
    expect(
      isSameTradeSearchPageUrl(
        'https://www.pathofexile.com/trade',
        'https://www.pathofexile.com/trade',
      ),
    ).toBe(false);
  });
});
