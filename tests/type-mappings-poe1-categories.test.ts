import { afterEach, describe, expect, it } from 'vitest';
import { tradeMappings } from '@/components/sidebar/mapping-registry';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';

const poe1 = tradeMappings.poe1;

const groupOf = (key: string) => poe1.groups.find((g) => g.keys.includes(key))?.groupLabel;
const rowOf = (mainKey: string) => poe1.typeRowConfigs.find((r) => r.mainKey === mainKey);

describe('PoE 1 item categories', () => {
  afterEach(() => {
    resetI18nStateForTests();
  });

  it('treats ward armour as standalone bases outside the slot categories', () => {
    setActiveDisplayLocale('zh-TW');
    expect(poe1.typeMap.body_armours_ward).toBeUndefined();
    for (const slot of ['helmet', 'gloves', 'boots']) {
      expect(Object.keys(rowOf(slot)?.subKeys ?? {})).not.toContain(
        `${slot === 'helmet' ? 'helmets' : slot}_ward`,
      );
    }
    expect(groupOf('helmets_ward')).toBe('防具');
    expect(poe1.typeNames.helmets_ward).toBe('保護頭盔');
    expect(poe1.typeNames.gloves_ward).toBe('保護手套');
    expect(poe1.typeNames.boots_ward).toBe('保護鞋子');
  });

  it('adds base-specific minion and unset categories', () => {
    setActiveDisplayLocale('zh-TW');
    expect(poe1.typeNames.wands_minion).toBe('召喚法杖');
    expect(poe1.typeNames.rings_minion).toBe('召喚戒指');
    expect(poe1.typeNames.unset_ring).toBe('潛能之戒');
    expect(rowOf('shield')?.subKeys.shields_minion).toBe('召喚');
  });

  it('splits jewels by colour and flasks by type like the jewel rows', () => {
    setActiveDisplayLocale('zh-TW');
    expect(Object.keys(rowOf('jewel')?.subKeys ?? {})).toEqual([
      'crimson_jewel',
      'viridian_jewel',
      'cobalt_jewel',
      'prismatic_jewel',
    ]);
    expect(Object.keys(rowOf('flask')?.subKeys ?? {})).toEqual([
      'life-flask',
      'mana-flask',
      'hybrid-flask',
      'utility-flask',
      'iron-flask',
    ]);
    expect(groupOf('tincture')).toBe('藥劑與萃取物');
  });

  it('separates maps, sanctum relics and heist into their own groups', () => {
    setActiveDisplayLocale('zh-TW');
    expect(groupOf('map')).toBe('地圖');
    expect(groupOf('relic')).toBe('聖域');
    expect(groupOf('contract')).toBe('劫盜');
    expect(groupOf('trinket')).toBe('劫盜');
    expect(Object.keys(rowOf('heist_equipment')?.subKeys ?? {})).toEqual([
      'heist_gear',
      'heist_tool',
      'heist_cloak',
      'heist_brooch',
    ]);
    expect(poe1.machineOptionLookup['heistequipment.heisttool']).toBe('heist_tool');
  });

  it('uses official trade-site names in all three UI locales', () => {
    setActiveDisplayLocale('zh-TW');
    expect(poe1.typeNames.tincture).toBe('萃取物');
    expect(poe1.typeNames.contract).toBe('劫盜契約書');
    expect(poe1.typeNames.relic).toBe('聖域聖物');
    expect(poe1.typeNames.trinket).toBe('飾品');
    expect(poe1.typeNames['fishing-rod']).toBe('釣竿');
    expect(rowOf('abyss_jewel')?.subKeys).toEqual({
      murderous_eye_jewel: '殺戮',
      searching_eye_jewel: '勘查',
      hypnotic_eye_jewel: '催眠',
      ghastly_eye_jewel: '極懼',
    });
    expect(groupOf('amulet')).toBe('配件');

    setActiveDisplayLocale('zh-CN');
    expect(poe1.typeNames.tincture).toBe('酊剂');
    expect(poe1.typeNames.sceptre).toBe('短杖');
    expect(poe1.typeNames.warstaff).toBe('战争长杖');
    expect(poe1.typeNames.hypnotic_eye_jewel).toBe('安睡之凝珠宝');
    expect(poe1.typeNames['iron-flask']).toBe('坚铁药剂');

    setActiveDisplayLocale('en');
    expect(poe1.typeNames.heist_equipment).toBe('Heist Equipment');
    expect(poe1.typeNames.trinket).toBe('Trinket');
    expect(poe1.typeNames.relic).toBe('Sanctum Relic');
  });
});
