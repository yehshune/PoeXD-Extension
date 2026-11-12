import { describe, expect, it } from 'vitest';
import {
  markMarketTranslationActive,
  readMarketDropdownLocale,
  getMarketUiAssetPath,
  isMarketTranslationHost,
  resolveMarketTranslationLocale,
} from '@/utils/market-translation';

describe('isMarketTranslationHost', () => {
  it('只接受國際服英文市集', () => {
    expect(isMarketTranslationHost('www.pathofexile.com')).toBe(true);
    expect(isMarketTranslationHost('pathofexile.com')).toBe(true);
    expect(isMarketTranslationHost('WWW.PathOfExile.com')).toBe(true);
  });

  it('在地化子網域、台服、國服與其他網站一律不處理', () => {
    for (const host of [
      'jp.pathofexile.com',
      'ru.pathofexile.com',
      'br.pathofexile.com',
      'pathofexile.tw',
      'poe.game.qq.com',
      'poe.ninja',
      '',
    ]) {
      expect(isMarketTranslationHost(host)).toBe(false);
    }
  });
});

describe('resolveMarketTranslationLocale', () => {
  const base = { enabled: true, hostname: 'www.pathofexile.com', browserLocale: 'en-US' };

  it('關閉時不翻譯', () => {
    expect(
      resolveMarketTranslationLocale({ ...base, enabled: false, displayLocale: 'zh-TW' }),
    ).toBeNull();
  });

  it('語言明確設為繁中或簡中時採用該語系', () => {
    expect(resolveMarketTranslationLocale({ ...base, displayLocale: 'zh-TW' })).toBe('zh-TW');
    expect(resolveMarketTranslationLocale({ ...base, displayLocale: 'zh-CN' })).toBe('zh-CN');
  });

  it('語言為自動時依瀏覽器語系（英文頁的 Display Locale 規則，見 ADR-0011）', () => {
    expect(
      resolveMarketTranslationLocale({ ...base, displayLocale: 'auto', browserLocale: 'zh-TW' }),
    ).toBe('zh-TW');
    expect(
      resolveMarketTranslationLocale({ ...base, displayLocale: 'auto', browserLocale: 'zh-CN' }),
    ).toBe('zh-CN');
    expect(
      resolveMarketTranslationLocale({ ...base, displayLocale: 'auto', browserLocale: 'en-US' }),
    ).toBeNull();
  });

  it('語言解析成其他語系時不翻譯', () => {
    expect(resolveMarketTranslationLocale({ ...base, displayLocale: 'ja' })).toBeNull();
    expect(resolveMarketTranslationLocale({ ...base, displayLocale: 'en' })).toBeNull();
  });

  it('不是國際服英文市集時不翻譯', () => {
    expect(
      resolveMarketTranslationLocale({
        ...base,
        hostname: 'pathofexile.tw',
        displayLocale: 'zh-TW',
      }),
    ).toBeNull();
    expect(
      resolveMarketTranslationLocale({
        ...base,
        hostname: 'jp.pathofexile.com',
        displayLocale: 'zh-TW',
      }),
    ).toBeNull();
  });
});

describe('getMarketUiAssetPath', () => {
  it('介面字典不分遊戲版本', () => {
    expect(getMarketUiAssetPath('zh-TW')).toBe('json/locales/zh-TW/trade-ui.json');
    expect(getMarketUiAssetPath('zh-CN')).toBe('json/locales/zh-CN/trade-ui.json');
  });
});

describe('markMarketTranslationActive／readMarketDropdownLocale', () => {
  const doc = () => ({ documentElement: { dataset: {} as DOMStringMap } }) as unknown as Document;

  it('只顯示中文時，官網下拉以翻譯語系搜尋', () => {
    const target = doc();
    markMarketTranslationActive(target, { locale: 'zh-CN', bilingual: false });
    expect(readMarketDropdownLocale(target)).toBe('zh-CN');
  });

  it('中英並列或未翻譯時回傳 null（英文仍搜得到）', () => {
    const bilingual = doc();
    markMarketTranslationActive(bilingual, { locale: 'zh-TW', bilingual: true });
    expect(readMarketDropdownLocale(bilingual)).toBeNull();
    expect(readMarketDropdownLocale(doc())).toBeNull();
  });

  it('忽略不認得的標記值', () => {
    const target = doc();
    target.documentElement.dataset.poexdMarketDropdownLocale = 'ja';
    expect(readMarketDropdownLocale(target)).toBeNull();
  });
});
