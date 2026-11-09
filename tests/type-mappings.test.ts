import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  typeMapPoe1,
  typeMapPoe2,
  typeNamesPoe1,
  typeNamesPoe2,
  officialCategoryMapPoe1,
  officialCategoryMapPoe2,
} from '@/components/sidebar/typeMaps';
import { tradeMappings, validateTradeMapping } from '@/components/sidebar/mapping-registry';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';

const FORBIDDEN_DUPLICATE_ALIASES = [
  'claws',
  'daggers',
  'rune_daggers',
  'rune_dagger',
  'wands',
  'sceptres',
  'staves',
  'warstaves',
  'quarterstaves',
  'one_hand_swords',
  'thrusting_one_hand_swords',
  'two_hand_swords',
  'one_hand_axes',
  'two_hand_axes',
  'one_hand_maces',
  'two_hand_maces',
  'bows',
  'crossbows',
  'spears',
  'flails',
  'talismans',
  'fishing_rods',
  'bucklers',
  'focusses',
  'foci',
  'amulets',
  'rings',
  'belts',
  'quivers',
  'life_flasks',
  'mana_flasks',
  'hybrid_flask',
  'utility_flasks',
  'charms',
  'tinctures',
  'relics',
  'urn_relic',
  'amphora_relic',
  'vase_relic',
  'seal_relic',
  'coffer_relic',
  'tapestry_relic',
  'incense_relic',
  'breach_tablet',
  'expedition_tablet',
  'delirium_tablet',
  'ritual_tablet',
  'irradiated_tablet',
  'overseer_tablet',
  'abyss_tablet',
  'temple_tablet',
  'waystones_low_tier',
  'waystones_mid_tier',
  'waystones_top_tier',
];

describe('trade mapping registry', () => {
  afterEach(() => {
    resetI18nStateForTests('zh-TW');
  });

  it('binds every canonical export to version registry', () => {
    expect(tradeMappings.poe1.typeMap).toBe(typeMapPoe1);
    expect(tradeMappings.poe1.typeNames).toBe(typeNamesPoe1);
    expect(tradeMappings.poe2.typeMap).toBe(typeMapPoe2);
    expect(tradeMappings.poe2.typeNames).toBe(typeNamesPoe2);
    expect(tradeMappings.poe1.machineOptionLookup).toBe(officialCategoryMapPoe1);
    expect(tradeMappings.poe2.machineOptionLookup).toBe(officialCategoryMapPoe2);
  });

  it.each(['poe1', 'poe2'] as const)(
    '%s mapping has no structural consistency errors across all UI locales',
    (version) => {
      for (const locale of ['zh-TW', 'zh-CN', 'en'] as const) {
        setActiveDisplayLocale(locale);
        expect(validateTradeMapping(tradeMappings[version])).toEqual([]);
      }
    },
  );

  it('removes redundant singular/plural and hyphen/underscore aliases in favor of canonical keys', () => {
    for (const version of ['poe1', 'poe2'] as const) {
      const mapping = tradeMappings[version];
      for (const alias of FORBIDDEN_DUPLICATE_ALIASES) {
        expect(
          mapping.typeMap[alias],
          `${version} typeMap should not contain ${alias}`,
        ).toBeUndefined();
        expect(
          mapping.typeNames[alias],
          `${version} typeNames should not contain ${alias}`,
        ).toBeUndefined();
      }
    }

    expect(tradeMappings.poe1.typeMap['rune-dagger']).toBeDefined();
    expect(tradeMappings.poe1.typeMap['warstaff']).toBeDefined();
    expect(tradeMappings.poe1.typeMap['thrusting-one-hand-sword']).toBeDefined();
    expect(tradeMappings.poe1.typeMap['buckler']).toBeDefined();
    expect(tradeMappings.poe1.typeMap['hybrid-flask']).toBeDefined();
    expect(tradeMappings.poe1.typeMap['utility-flask']).toBeDefined();

    expect(tradeMappings.poe2.typeMap['talisman']).toBeDefined();
    expect(tradeMappings.poe2.typeMap['buckler']).toBeDefined();
    expect(tradeMappings.poe2.typeMap['focus']).toBeDefined();
    expect(tradeMappings.poe2.typeMap['urn-relic']).toBeDefined();
    expect(tradeMappings.poe2.typeMap['breach-tablet']).toBeDefined();
    expect(tradeMappings.poe2.typeMap['waystone-t1']).toBeDefined();
  });

  it.each(['poe1', 'poe2'] as const)(
    'covers every gear-type key emitted in %s mods-tiers.json typeTable',
    (version) => {
      const artifact = JSON.parse(
        readFileSync(new URL(`../public/json/${version}/mods-tiers.json`, import.meta.url), 'utf8'),
      );
      const mapping = tradeMappings[version];
      for (const tuple of artifact.typeTable as string[][]) {
        for (const key of tuple) {
          expect(mapping.typeMap[key], `${version} typeMap missing ${key}`).toBeDefined();
          expect(mapping.typeNames[key], `${version} typeNames missing ${key}`).toBeTruthy();
        }
      }
    },
  );

  it('resolves category names, group titles, and subcategory short labels in active Display Locale without bilingual parenthetical suffixes', () => {
    setActiveDisplayLocale('zh-TW');
    expect(tradeMappings.poe1.typeNames['body-armour']).toBe('胸甲');
    expect(tradeMappings.poe1.groups[0].groupLabel).toBe('武器');
    expect(tradeMappings.poe1.typeRowConfigs[0].subKeys.body_armours_str).toBe('力');
    expect(tradeMappings.poe2.typeNames['waystone-t1']).toBe('低階換界石');

    setActiveDisplayLocale('zh-CN');
    expect(tradeMappings.poe1.typeNames['one-hand-sword']).toBe('单手剑');
    expect(tradeMappings.poe1.groups[0].groupLabel).toBe('武器');
    expect(tradeMappings.poe1.typeRowConfigs[0].subKeys.body_armours_dex).toBe('敏');
    expect(tradeMappings.poe2.typeNames['waystone-t1']).toBe('低阶引路石');

    setActiveDisplayLocale('en');
    expect(tradeMappings.poe1.typeNames['body-armour']).toBe('Body Armour');
    expect(tradeMappings.poe1.typeNames['one-hand-sword']).toBe('One-Handed Sword');
    expect(tradeMappings.poe1.groups[0].groupLabel).toBe('Weapons');
    expect(tradeMappings.poe1.typeRowConfigs[0].subKeys.body_armours_str).toBe('STR');
    expect(tradeMappings.poe2.typeNames['waystone-t1']).toBe('Low Tier Waystone');

    for (const locale of ['zh-TW', 'zh-CN', 'en'] as const) {
      setActiveDisplayLocale(locale);
      for (const version of ['poe1', 'poe2'] as const) {
        const mapping = tradeMappings[version];
        for (const [k, label] of Object.entries(mapping.typeNames)) {
          expect(label, `${version} ${locale} typeNames[${k}] has parenthetical`).not.toMatch(
            /\([^)]+\)/,
          );
        }
        for (const group of mapping.groups) {
          expect(group.groupLabel, `${version} ${locale} groupLabel has parenthetical`).not.toMatch(
            /\([^)]+\)/,
          );
        }
      }
    }
  });

  it('keeps shared canonical equipment keys in both versions', () => {
    const sharedKeys = [
      'body-armour',
      'helmet',
      'gloves',
      'boots',
      'shield',
      'buckler',
      'amulet',
      'ring',
      'belt',
    ];
    sharedKeys.forEach((key) => {
      expect(tradeMappings.poe1.typeMap[key]).toBeDefined();
      expect(tradeMappings.poe2.typeMap[key]).toBeDefined();
      expect(tradeMappings.poe1.typeNames[key]).toBeTruthy();
      expect(tradeMappings.poe2.typeNames[key]).toBeTruthy();
    });
  });
});

describe('mapping validation failures', () => {
  it('reports empty labels and unresolved lookup targets', () => {
    expect(
      validateTradeMapping({
        typeMap: { broken: { cat: [''], sub: [''] } },
        typeNames: {},
        machineOptionLookup: { '': 'missing', 'valid.opt': 'unresolved_type' },
        groups: [{ groupLabel: '', keys: ['missing-group'] }],
        typeRowConfigs: [{ mainKey: 'missing-main', subKeys: { 'missing-sub': 'Missing' } }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('non-empty category'),
        expect.stringContaining('empty subcategory'),
        expect.stringContaining('empty option key'),
        expect.stringContaining('unresolved_type is undefined'),
        expect.stringContaining('group key'),
        expect.stringContaining('row mainKey'),
        expect.stringContaining('row subKey'),
      ]),
    );
  });
});
