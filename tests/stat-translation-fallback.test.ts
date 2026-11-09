import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetAffixLexiconCacheForTests,
  setAffixLexiconMockData,
  type LocaleStatsShard,
  type ModsTiersArtifact,
} from '@/utils/affix-lexicon';
import { resetI18nStateForTests, setActiveDisplayLocalePreference } from '@/utils/i18n';
import { resetTradeFiltersForTests, setMockTradeFilters } from '@/utils/trade-filters-store';
import { translateStatLines } from '@/utils/trade-stat-dictionary';

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '..', path), 'utf8')) as T;

function loadShippedLexicon(version: 'poe1' | 'poe2') {
  setAffixLexiconMockData(
    version,
    readJson<ModsTiersArtifact>(`public/json/${version}/mods-tiers.json`),
    {
      en: readJson<LocaleStatsShard>(`public/json/${version}/locales/en/stats.json`),
      'zh-TW': readJson<LocaleStatsShard>(`public/json/${version}/locales/zh-TW/stats.json`),
    },
  );
}

describe('stat translation fallbacks', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    resetAffixLexiconCacheForTests();
    resetTradeFiltersForTests();
    loadShippedLexicon('poe2');
  });

  afterEach(() => {
    resetAffixLexiconCacheForTests();
    resetTradeFiltersForTests();
  });

  it('translates an explicit stat that the lexicon only knows under another category', () => {
    // 字典只收錄 rune.stat_2704225257（精魂），交易查詢用的是 explicit.
    const lines = translateStatLines('explicit.stat_2704225257', 'poe2');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('stat_2704225257');
    expect(lines[0]).toContain('精魂');
  });

  it('keeps only the line of a hybrid template that belongs to the requested stat', () => {
    resetI18nStateForTests('en');
    // rune.stat_2704225257 的模板是「精魂 + 每 2 級精魂」的混合詞綴
    expect(translateStatLines('explicit.stat_2704225257', 'poe2')).toEqual(['# to spirit']);
    expect(translateStatLines('explicit.stat_610569665', 'poe2')).toEqual([
      '# to spirit per 2 levels',
    ]);
  });

  it('translates pseudo stats from the trade filters data of the display locale', () => {
    setMockTradeFilters('poe2', {
      groups: {},
      fields: {},
      pseudoStats: { 'pseudo.pseudo_total_chaos_resistance': '+#% 總混沌抗性' },
    });
    expect(translateStatLines('pseudo.pseudo_total_chaos_resistance', 'poe2')).toEqual([
      '+#% 總混沌抗性',
    ]);
  });

  it('lowercases English pseudo text to match lexicon output', () => {
    setActiveDisplayLocalePreference('en');
    setMockTradeFilters('poe2', {
      locale: 'en',
      groups: {},
      fields: {},
      pseudoStats: { 'pseudo.pseudo_total_chaos_resistance': '+#% total to Chaos Resistance' },
    });
    expect(translateStatLines('pseudo.pseudo_total_chaos_resistance', 'poe2')).toEqual([
      '+#% total to chaos resistance',
    ]);
  });

  it('ships pseudo stat translations for both game versions in the bundled locales', () => {
    for (const version of ['poe1', 'poe2'] as const) {
      for (const locale of ['en', 'zh-TW', 'zh-CN']) {
        const data = readJson<{ pseudoStats?: Record<string, string> }>(
          `public/json/${version}/locales/${locale}/trade-filters.json`,
        );
        expect(
          data.pseudoStats?.['pseudo.pseudo_total_chaos_resistance'],
          `${version} ${locale}`,
        ).toBeTruthy();
      }
    }
    const zhTw = readJson<{ pseudoStats: Record<string, string> }>(
      'public/json/poe2/locales/zh-TW/trade-filters.json',
    );
    expect(zhTw.pseudoStats['pseudo.pseudo_total_chaos_resistance']).toContain('混沌');
  });

  it('uses bundled pseudo data without any mock', () => {
    expect(translateStatLines('pseudo.pseudo_total_chaos_resistance', 'poe2')[0]).toContain('混沌');
  });
});
