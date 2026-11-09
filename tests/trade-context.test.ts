import { describe, expect, it } from 'vitest';
import { isSupportedTradeHost } from '@/utils/trade-realms';
import {
  detectTradeContextFromUrl,
  getLocaleStatsAssetPath,
  getModsTiersAssetPath,
  getPoeVersion,
  getTradeLeague,
  getTradeVersionProfile,
  parseTradePath,
  queryActiveTabTradeContext,
  tradeVersionProfiles,
} from '@/utils/trade-context';
import {
  parseTradeSearchUrl,
  stripLiveSuffix,
  toLiveUrl,
  withTradeLeague,
} from '@/utils/trade-search-identity';

describe('Trade version context', () => {
  it.each([
    ['poe1', '/trade/search/Settlers%20HC/abc', 'Settlers HC'],
    ['poe2', '/trade2/search/poe2/Standard/def', 'Standard'],
    ['poe1', '/trade/exchange/Settlers%20HC/abc', 'Settlers HC'],
    ['poe2', '/trade2/exchange/poe2/Standard/def', 'Standard'],
  ] as const)('parses %s routes through one context', (version, pathname, league) => {
    expect(getPoeVersion(pathname)).toBe(version);
    expect(getTradeLeague(pathname)).toBe(league);
    expect(parseTradePath(pathname)).toMatchObject({ version });
  });

  it('rejects mismatched route shapes', () => {
    expect(parseTradePath('/trade/search/poe2/Standard/id')).toBeUndefined();
    expect(parseTradePath('/trade2/search/Standard/id')).toBeUndefined();
  });

  it.each(['poe1', 'poe2'] as const)('%s profile owns all version-specific paths', (version) => {
    const profile = getTradeVersionProfile(version);
    expect(profile).toBe(tradeVersionProfiles[version]);
    expect(profile.dataDirectory).toBe(version);
    expect(profile.modsTiersFile).toBe('mods-tiers.json');
    expect(getModsTiersAssetPath(version)).toBe(`json/${version}/mods-tiers.json`);
    expect(getLocaleStatsAssetPath(version, 'zh-TW')).toBe(
      `json/${version}/locales/zh-TW/stats.json`,
    );
  });

  it('keeps canonical Search Record parsing aligned with the context', () => {
    expect(
      parseTradeSearchUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/id'),
    ).toEqual({
      gameVersion: 'poe2',
      league: 'standard',
      searchId: 'id',
    });
    expect(
      parseTradeSearchUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/id/live'),
    ).toEqual({
      gameVersion: 'poe2',
      league: 'standard',
      searchId: 'id',
    });
    expect(
      parseTradeSearchUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/live'),
    ).toBeUndefined();
  });

  it('replaces only the league segment in a Trade Search URL', () => {
    expect(
      withTradeLeague(
        'https://www.pathofexile.com/trade2/search/poe2/Standard/search-id?status=online',
        'HC Runes of Aldur',
      ),
    ).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/HC%20Runes%20of%20Aldur/search-id?status=online',
    );
  });

  it('strips trailing /live while preserving query params and hashes', () => {
    expect(
      stripLiveSuffix('https://www.pathofexile.com/trade2/search/poe2/Standard/abc/live'),
    ).toBe('https://www.pathofexile.com/trade2/search/poe2/Standard/abc');
    expect(
      stripLiveSuffix(
        'https://www.pathofexile.com/trade2/search/poe2/Standard/abc/live?status=online#top',
      ),
    ).toBe('https://www.pathofexile.com/trade2/search/poe2/Standard/abc?status=online#top');
    expect(stripLiveSuffix('https://www.pathofexile.com/trade2/search/poe2/Standard/abc')).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/abc',
    );
    expect(stripLiveSuffix('not a url')).toBe('not a url');
  });

  it('adds /live safely to trade URLs without duplicating', () => {
    expect(toLiveUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/abc')).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/abc/live',
    );
    expect(toLiveUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/abc/live')).toBe(
      'https://www.pathofexile.com/trade2/search/poe2/Standard/abc/live',
    );
    expect(
      toLiveUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/abc?status=online'),
    ).toBe('https://www.pathofexile.com/trade2/search/poe2/Standard/abc/live?status=online');
    expect(toLiveUrl('invalid-url')).toBe('invalid-url/live');
  });

  it('validates supported trade hosts correctly', () => {
    expect(isSupportedTradeHost('www.pathofexile.com')).toBe(true);
    expect(isSupportedTradeHost('pathofexile.com')).toBe(true);
    expect(isSupportedTradeHost('pathofexile.tw')).toBe(true);
    expect(isSupportedTradeHost('web.poe.game.qq.com')).toBe(false);
    expect(isSupportedTradeHost('poe.game.qq.com')).toBe(true);
    expect(isSupportedTradeHost('google.com')).toBe(false);
  });

  it('detects trade context and version from URL', () => {
    expect(detectTradeContextFromUrl('https://www.pathofexile.com/trade/search/Standard')).toEqual({
      isTradePage: true,
      version: 'poe1',
    });

    expect(
      detectTradeContextFromUrl('https://www.pathofexile.com/trade2/search/poe2/Standard'),
    ).toEqual({ isTradePage: true, version: 'poe2' });

    expect(detectTradeContextFromUrl('https://pathofexile.tw/trade')).toEqual({
      isTradePage: true,
      version: 'poe1',
    });

    expect(detectTradeContextFromUrl('https://pathofexile.tw/trade2')).toEqual({
      isTradePage: true,
      version: 'poe2',
    });

    expect(detectTradeContextFromUrl('https://poe.game.qq.com/api/trade2/search')).toEqual({
      isTradePage: true,
      version: 'poe2',
    });

    expect(detectTradeContextFromUrl('https://www.pathofexile.com/forum')).toEqual({
      isTradePage: false,
      version: 'poe1',
    });

    expect(detectTradeContextFromUrl('https://google.com')).toEqual({
      isTradePage: false,
      version: 'poe1',
    });

    expect(detectTradeContextFromUrl(undefined)).toEqual({
      isTradePage: false,
      version: 'poe1',
    });
  });

  it('queries active tab trade context gracefully with or without chrome API', async () => {
    // When chrome is undefined or empty
    (globalThis as any).chrome = undefined;
    expect(await queryActiveTabTradeContext()).toEqual({
      isTradePage: false,
      version: 'poe1',
    });

    // When chrome.tabs.query returns a trade url
    (globalThis as any).chrome = {
      tabs: {
        query: async () => [{ url: 'https://www.pathofexile.com/trade2' }],
      },
    };
    expect(await queryActiveTabTradeContext()).toEqual({
      isTradePage: true,
      version: 'poe2',
    });
  });
});
