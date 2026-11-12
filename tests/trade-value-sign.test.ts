import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findModTiersByStatId,
  resetAffixLexiconCacheForTests,
  setAffixLexiconMockData,
  type LocaleStatsShard,
  type ModsTiersArtifact,
} from '@/utils/affix-lexicon';
import { isTradeValueNegated, negateRange } from '@/utils/trade-value-sign';
import { getTierMinMaxList } from '@/components/sidebar/utils';
import { parseTierValues } from '@/entrypoints/content/logic/tier-domain-service';

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '..', path), 'utf8')) as T;

describe('isTradeValueNegated', () => {
  it('遊戲寫法取負（reduced）而市集寫法不取負（increased）時，市集數值為負', () => {
    expect(
      isTradeValueNegated(
        '{0:n}% reduced Attribute Requirements',
        '{0:d}% increased Attribute Requirements',
      ),
    ).toBe(true);
  });

  it('兩邊取負方式相同或缺少市集寫法時不翻號', () => {
    expect(isTradeValueNegated('{0:d}% increased Damage', '{0:d}% increased Damage')).toBe(false);
    expect(isTradeValueNegated('{0:n}% reduced Foo', '{0:n}% reduced Foo')).toBe(false);
    expect(isTradeValueNegated('{0:n}% reduced Foo', undefined)).toBe(false);
  });

  it('多行模板不處理', () => {
    expect(isTradeValueNegated('{0:n}% reduced A|||||{1:d} B', '{0:d}% increased A')).toBe(false);
  });
});

describe('negateRange', () => {
  it('取負並保持由小到大', () => {
    expect(negateRange(['18'])).toEqual(['-18']);
    expect(negateRange(['31', '36'])).toEqual(['-36', '-31']);
  });
});

describe('負值階級的上下限', () => {
  it('parseTierValues 依 tradeNegated 回傳市集的帶號數值', () => {
    const parsed = parseTierValues({ values: [['18']], tradeNegated: true });
    expect(parsed.valMin).toBe('-18');
    expect(parsed.valMax).toBe('-18');
    expect(parseTierValues({ values: [['31', '36']], tradeNegated: true })).toMatchObject({
      valMin: '-36',
      valMax: '-31',
    });
  });

  it('getTierMinMaxList 翻號後「至少此階」落在最大值', () => {
    expect(getTierMinMaxList('#% reduced attribute requirements', [['18']], true)).toEqual({
      mins: [''],
      maxs: ['-18'],
    });
    expect(getTierMinMaxList('#% reduced x', [['31', '36']], true)).toEqual({
      mins: ['-36'],
      maxs: ['-31'],
    });
  });
});

describe('詞庫載入時標記市集數值翻號', () => {
  afterEach(() => resetAffixLexiconCacheForTests());

  it('PoE1 能力值需求（遊戲顯示減少 18%，市集寫增加）標記為 tradeNegated', () => {
    setAffixLexiconMockData(
      'poe1',
      readJson<ModsTiersArtifact>('public/json/poe1/mods-tiers.json'),
      { en: readJson<LocaleStatsShard>('public/json/poe1/locales/en/stats.json') },
    );
    const tiers = findModTiersByStatId('explicit.stat_3639275092', 'poe1', 'en') ?? [];
    expect(tiers.length).toBeGreaterThan(0);
    expect(tiers.every((tier) => tier.tradeNegated)).toBe(true);
  });
});
