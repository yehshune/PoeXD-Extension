import { afterEach, describe, it, expect } from 'vitest';
import {
  getAffinityProfile,
  poe1AffinityProfile,
  poe2AffinityProfile,
  commonAffinityProfile,
} from '@/utils/affinity-registry';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';

describe('Affinity Registry & Version Profiles', () => {
  afterEach(() => {
    resetI18nStateForTests('zh-TW');
  });
  it('returns distinct profiles for poe1 and poe2', () => {
    const p1 = getAffinityProfile('poe1');
    const p2 = getAffinityProfile('poe2');

    expect(p1.version).toBe('poe1');
    expect(p2.version).toBe('poe2');
    expect(p1).not.toBe(p2);
  });

  describe('PoE 1 Affinity Profile', () => {
    it('correctly maps crafted. to master and veiled only', () => {
      expect(poe1AffinityProfile.resolveTargetAffinities('crafted.stat_1234')).toEqual([
        'master',
        'veiled',
      ]);
    });

    it('correctly maps veiled. and implicit. in poe1', () => {
      expect(poe1AffinityProfile.resolveTargetAffinities('veiled.stat_1234')).toEqual(['veiled']);
      expect(poe1AffinityProfile.resolveTargetAffinities('implicit.stat_1234')).toEqual([
        'normal',
        'corrupted',
      ]);
    });

    it('contains poe1 specific special affinities and categories', () => {
      expect(poe1AffinityProfile.specialExplicitAffinities.has('bestiary')).toBe(true);
      expect(poe1AffinityProfile.specialExplicitAffinities.has('infamous')).toBe(true);
      expect(poe1AffinityProfile.specialExplicitAffinities.has('bonded')).toBe(false);

      expect(poe1AffinityProfile.categoryNames.master).toBe('工藝');
      expect(poe1AffinityProfile.categoryNames.veiled).toBe('隱匿');
      expect(poe1AffinityProfile.categoryNames.bonded).toBeUndefined();
    });
  });

  describe('PoE 2 Affinity Profile', () => {
    it('correctly maps crafted. to essence, perfect_essence, crafted, and liquid', () => {
      expect(poe2AffinityProfile.resolveTargetAffinities('crafted.stat_1234')).toEqual([
        'essence',
        'perfect_essence',
        'crafted',
        'liquid',
      ]);
    });

    it('correctly maps rune. and desecrated. in poe2', () => {
      expect(poe2AffinityProfile.resolveTargetAffinities('rune.stat_1234')).toEqual([
        'socketable',
        'bonded',
      ]);
      expect(poe2AffinityProfile.resolveTargetAffinities('desecrated.stat_1234')).toEqual([
        'desecrated',
      ]);
    });

    it('contains poe2 specific special affinities and categories', () => {
      expect(poe2AffinityProfile.specialExplicitAffinities.has('bonded')).toBe(true);
      expect(poe2AffinityProfile.specialExplicitAffinities.has('desecrated')).toBe(true);
      expect(poe2AffinityProfile.specialExplicitAffinities.has('bestiary')).toBe(false);

      expect(poe2AffinityProfile.categoryNames.bonded).toBe('命定詞綴');
      expect(poe2AffinityProfile.categoryNames.liquid).toBe('液態情感');
      expect(poe2AffinityProfile.categoryNames.master).toBeUndefined();
    });
  });

  describe('Common Affinity Profile (Fallback)', () => {
    it('maps prefixes across both games into safe fallback union', () => {
      expect(commonAffinityProfile.resolveTargetAffinities('crafted.stat_1234')).toEqual([
        'master',
        'veiled',
        'essence',
        'perfect_essence',
        'crafted',
        'liquid',
      ]);
      expect(commonAffinityProfile.resolveTargetAffinities('rune.stat_1234')).toEqual([
        'socketable',
        'bonded',
      ]);
      expect(commonAffinityProfile.resolveTargetAffinities('veiled.stat_1234')).toEqual(['veiled']);
    });

    it('combines special explicit affinities from both games', () => {
      expect(commonAffinityProfile.specialExplicitAffinities.has('bestiary')).toBe(true);
      expect(commonAffinityProfile.specialExplicitAffinities.has('bonded')).toBe(true);
    });

    it('resolves affinity categoryNames across zh-TW, zh-CN, and en in the active Display Locale', () => {
      setActiveDisplayLocale('zh-TW');
      expect(getAffinityProfile('poe1').categoryNames.master).toBe('工藝');
      expect(getAffinityProfile('poe1').categoryNames.shaper).toBe('塑界者');
      expect(getAffinityProfile('poe2').categoryNames.bonded).toBe('命定詞綴');
      expect(getAffinityProfile('poe2').categoryNames.liquid).toBe('液態情感');

      setActiveDisplayLocale('zh-CN');
      expect(getAffinityProfile('poe1').categoryNames.master).toBe('工艺');
      expect(getAffinityProfile('poe1').categoryNames.veiled).toBe('隐匿');
      expect(getAffinityProfile('poe2').categoryNames.bonded).toBe('命定词缀');
      expect(getAffinityProfile('poe2').categoryNames.liquid).toBe('液态情感');

      setActiveDisplayLocale('en');
      expect(getAffinityProfile('poe1').categoryNames.master).toBe('Crafted');
      expect(getAffinityProfile('poe1').categoryNames.veiled).toBe('Veiled');
      expect(getAffinityProfile('poe1').categoryNames.shaper).toBe('Shaper');
      expect(getAffinityProfile('poe2').categoryNames.bonded).toBe('Bonded');
      expect(getAffinityProfile('poe2').categoryNames.liquid).toBe('Distilled');
    });
  });
});
