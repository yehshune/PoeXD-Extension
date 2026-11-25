import { describe, expect, it } from 'vitest';
import {
  markMarketTranslationActive,
  readMarketDropdownLocale,
  getMarketUiAssetPath,
  isMarketTranslationHost,
  isMarketTranslationReloadRequired,
  resolveEffectiveMarketTranslationState,
  resolveMarketTranslationLocale,
} from '@/utils/market-translation';

describe('isMarketTranslationHost', () => {
  it('只接受國際服英文市集', () => {
    expect(isMarketTranslationHost('www.pathofexile.com')).toBe(true);
    expect(isMarketTranslationHost('pathofexile.com')).toBe(true);
    expect(isMarketTranslationHost('WWW.PathOfExile.com')).toBe(true);
  });

  it('在地化子網域、台服、騰訊服與其他網站一律不處理', () => {
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
    expect(
      resolveMarketTranslationLocale({
        ...base,
        displayLocale: 'auto',
        browserLocale: 'en-US',
        browserLanguages: ['en-US', 'zh-TW'],
      }),
    ).toBe('zh-TW');
    expect(
      resolveMarketTranslationLocale({
        ...base,
        displayLocale: 'auto',
        browserLocale: 'en-US',
        browserLanguages: ['en-US', 'zh-CN'],
      }),
    ).toBe('zh-CN');
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

describe('resolveEffectiveMarketTranslationState／isMarketTranslationReloadRequired', () => {
  const intlZhTw = { hostname: 'www.pathofexile.com', browserLocale: 'zh-TW' };
  const intlEnUs = { hostname: 'www.pathofexile.com', browserLocale: 'en-US' };
  const twRealm = { hostname: 'pathofexile.tw', browserLocale: 'zh-TW' };

  it('將未指定的 marketTranslationBilingual 視為啟用（與預設值 true 一致），停用翻譯時 bilingual 為 false', () => {
    expect(
      resolveEffectiveMarketTranslationState(
        { marketTranslation: true, displayLocale: 'zh-TW', marketTranslationBilingual: undefined },
        intlEnUs,
      ),
    ).toEqual({ locale: 'zh-TW', bilingual: true });

    expect(
      resolveEffectiveMarketTranslationState(
        { marketTranslation: true, displayLocale: 'zh-CN', marketTranslationBilingual: false },
        intlEnUs,
      ),
    ).toEqual({ locale: 'zh-CN', bilingual: false });

    expect(
      resolveEffectiveMarketTranslationState(
        { marketTranslation: false, displayLocale: 'zh-TW', marketTranslationBilingual: true },
        intlEnUs,
      ),
    ).toEqual({ locale: null, bilingual: false });
  });

  it('依明確傳入的 browserLocale 解析 displayLocale: auto', () => {
    expect(
      resolveEffectiveMarketTranslationState(
        { marketTranslation: true, displayLocale: 'auto' },
        intlZhTw,
      ),
    ).toEqual({ locale: 'zh-TW', bilingual: true });

    expect(
      resolveEffectiveMarketTranslationState(
        { marketTranslation: true, displayLocale: 'auto' },
        intlEnUs,
      ),
    ).toEqual({ locale: null, bilingual: false });
  });

  it('偵測市集漢化開關、Display Locale 與下拉中英並列切換是否需要重新整理', () => {
    const offBase = {
      marketTranslation: false,
      displayLocale: 'auto' as const,
      marketTranslationBilingual: true,
    };
    const onTwAuto = {
      marketTranslation: true,
      displayLocale: 'auto' as const,
      marketTranslationBilingual: undefined,
    };
    const onTwExplicit = {
      marketTranslation: true,
      displayLocale: 'zh-TW' as const,
      marketTranslationBilingual: true,
    };
    const onCn = {
      marketTranslation: true,
      displayLocale: 'zh-CN' as const,
      marketTranslationBilingual: true,
    };
    const onTwMono = {
      marketTranslation: true,
      displayLocale: 'zh-TW' as const,
      marketTranslationBilingual: false,
    };

    // 開關市集漢化
    expect(isMarketTranslationReloadRequired(offBase, onTwAuto, intlZhTw)).toBe(true);
    expect(isMarketTranslationReloadRequired(offBase, offBase, intlZhTw)).toBe(false);

    // auto（瀏覽器 zh-TW）與明確 zh-TW、以及 undefined 與 true 的 bilingual 皆為相同有效狀態
    expect(isMarketTranslationReloadRequired(onTwAuto, onTwExplicit, intlZhTw)).toBe(false);

    // 切換目標中文語系或切換下拉中英並列需重新整理
    expect(isMarketTranslationReloadRequired(onTwExplicit, onCn, intlZhTw)).toBe(true);
    expect(isMarketTranslationReloadRequired(onTwAuto, onTwMono, intlZhTw)).toBe(true);
    expect(isMarketTranslationReloadRequired(onTwExplicit, onTwMono, intlZhTw)).toBe(true);

    // 未啟用漢化時切換 bilingual 不需重新整理
    expect(
      isMarketTranslationReloadRequired(
        { marketTranslation: false, displayLocale: 'zh-TW', marketTranslationBilingual: true },
        { marketTranslation: false, displayLocale: 'zh-TW', marketTranslationBilingual: false },
        intlZhTw,
      ),
    ).toBe(false);
  });

  it('非國際服（例如台服或日服）一律不需要重新整理', () => {
    const baseline = {
      marketTranslation: false,
      displayLocale: 'en' as const,
      marketTranslationBilingual: true,
    };
    const current = {
      marketTranslation: true,
      displayLocale: 'zh-TW' as const,
      marketTranslationBilingual: false,
    };

    expect(resolveEffectiveMarketTranslationState(current, twRealm)).toEqual({
      locale: null,
      bilingual: false,
    });
    expect(isMarketTranslationReloadRequired(baseline, current, twRealm)).toBe(false);
    expect(
      isMarketTranslationReloadRequired(baseline, current, {
        hostname: 'jp.pathofexile.com',
        browserLocale: 'zh-TW',
      }),
    ).toBe(false);
  });
});
