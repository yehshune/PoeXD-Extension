import { describe, expect, it } from 'vitest';
import { readTradeUrlLeague, resolveBookmarkUrl } from '@/utils/bookmark-target';
import {
  TRADE_PAGE_MATCH_PATTERNS,
  findTradeRealm,
  getSupportedTradeOrigin,
  isPriceConversionSupported,
  isSupportedTradeHost,
} from '@/utils/trade-realms';
import { getTradeRealmLabel } from '@/utils/trade-realm-labels';
import { detectTradeContextFromUrl } from '@/utils/trade-context';
import { isEligibleTradeUrl } from '@/utils/live-search-coordinator';

describe('Trade realm registry', () => {
  it('supports international, language subdomains, Taiwan and Tencent hosts', () => {
    expect(findTradeRealm('www.pathofexile.com')?.id).toBe('international');
    expect(findTradeRealm('ru.pathofexile.com')?.id).toBe('international');
    expect(findTradeRealm('pathofexile.tw')?.id).toBe('garena-tw');
    expect(findTradeRealm('poe.game.qq.com')?.id).toBe('tencent');
  });

  it('does not support Korean realms or look-alike hosts', () => {
    expect(isSupportedTradeHost('poe.kakaogames.com')).toBe(false);
    expect(isSupportedTradeHost('pathofexile2.kakaogames.com')).toBe(false);
    expect(isSupportedTradeHost('poe.game.daum.net')).toBe(false);
    expect(isSupportedTradeHost('evilpathofexile.com')).toBe(false);
    expect(isSupportedTradeHost('game.qq.com')).toBe(false);
  });

  it('injects the content script on Tencent trade pages', () => {
    expect(TRADE_PAGE_MATCH_PATTERNS).toContain('*://poe.game.qq.com/trade*');
    expect(detectTradeContextFromUrl('https://poe.game.qq.com/trade2/search/poe2/S1/abc')).toEqual({
      isTradePage: true,
      version: 'poe2',
    });
    expect(isEligibleTradeUrl('https://poe.game.qq.com/trade/search/S29/abc')).toBe(true);
  });

  it('labels each realm for display', () => {
    expect(getTradeRealmLabel('https://www.pathofexile.com/trade/search/Standard/a')).toBe(
      '國際服',
    );
    expect(getTradeRealmLabel('https://jp.pathofexile.com/trade2/search/poe2/Standard/a')).toBe(
      '國際服',
    );
    expect(getTradeRealmLabel('https://pathofexile.tw/trade/search/a/b')).toBe('台服');
    expect(getTradeRealmLabel('https://poe.game.qq.com/trade/search/a/b')).toBe('QQ');
    expect(getTradeRealmLabel('https://example.com/trade')).toBeUndefined();
    expect(getTradeRealmLabel('not a url')).toBeUndefined();
  });

  it('supports price conversion only on the international realm (poe.ninja data)', () => {
    expect(isPriceConversionSupported('www.pathofexile.com')).toBe(true);
    expect(isPriceConversionSupported('jp.pathofexile.com')).toBe(true);
    expect(isPriceConversionSupported('pathofexile.tw')).toBe(false);
    expect(isPriceConversionSupported('poe.game.qq.com')).toBe(false);
    expect(isPriceConversionSupported('example.com')).toBe(false);
    expect(isPriceConversionSupported(undefined)).toBe(false);
  });

  it('returns supported origins only', () => {
    expect(getSupportedTradeOrigin('https://poe.game.qq.com/trade')).toBe(
      'https://poe.game.qq.com',
    );
    expect(getSupportedTradeOrigin('https://example.com/trade')).toBeUndefined();
    expect(getSupportedTradeOrigin('javascript:alert(1)')).toBeUndefined();
  });
});

describe('Bookmark target resolution', () => {
  const stored = 'https://www.pathofexile.com/trade/search/Standard/abc';

  it('follows the current origin and league for Auto bookmarks', () => {
    expect(
      resolveBookmarkUrl(stored, {}, { origin: 'https://poe.game.qq.com', league: 'S29赛季' }),
    ).toBe(`https://poe.game.qq.com/trade/search/${encodeURI('S29赛季')}/abc`);
  });

  it('keeps the recorded league for pinned bookmarks but still follows the origin', () => {
    expect(
      resolveBookmarkUrl(
        stored,
        { leaguePinned: true },
        { origin: 'https://pathofexile.tw', league: 'Hardcore' },
      ),
    ).toBe('https://pathofexile.tw/trade/search/Standard/abc');
  });

  it('leaves the URL unchanged without a supported context', () => {
    expect(resolveBookmarkUrl(stored, {}, { origin: 'http://localhost:3000' })).toBe(stored);
    expect(resolveBookmarkUrl(stored, {}, {})).toBe(stored);
  });

  it('reads the league with its original casing', () => {
    expect(
      readTradeUrlLeague(
        'https://www.pathofexile.com/trade2/search/poe2/Rise%20of%20the%20Abyssal/x',
      ),
    ).toBe('Rise of the Abyssal');
  });
});
