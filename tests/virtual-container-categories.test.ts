import { afterEach, describe, expect, it } from 'vitest';
import { tradeMappings, validateTradeMapping } from '@/components/sidebar/mapping-registry';
import {
  resolveOfficialCategoryOption,
  resolveOfficialTierCategory,
} from '@/utils/official-category-resolver';
import {
  filterTiersByCategory,
  groupTiersByMod,
} from '@/entrypoints/content/logic/tier-domain-service';
import {
  isContainerSubtypeOf,
  resolveAvailableContainerSubKeys,
} from '@/utils/item-category-hierarchy';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';

const categoryQuery = (option: string) => ({
  filters: { type_filters: { filters: { category: { option } } } },
});

const POE1_GENERIC_CONTAINERS = [
  ['weapon.onesword', 'any-one-hand-sword', ['one-hand-sword', 'thrusting-one-hand-sword']],
  ['weapon.dagger', 'any-dagger', ['dagger', 'rune-dagger']],
  ['weapon.onemace', 'any-one-hand-mace', ['one-hand-mace', 'sceptre']],
  ['weapon.staff', 'any-staff', ['staff', 'warstaff']],
] as const;

describe('官方泛用類別對應到虛擬容器父類', () => {
  afterEach(() => {
    resetI18nStateForTests();
  });

  it.each(POE1_GENERIC_CONTAINERS)('PoE 1 %s → %s，子類別為 %j', (option, parent, subKeys) => {
    expect(resolveOfficialTierCategory('poe1', categoryQuery(option))).toEqual({
      status: 'known_category',
      category: parent,
    });
    const row = tradeMappings.poe1.typeRowConfigs.find((r) => r.mainKey === parent);
    expect(Object.keys(row?.subKeys ?? {})).toEqual([...subKeys]);
    expect(
      resolveAvailableContainerSubKeys(tradeMappings.poe1.typeRowConfigs, parent, [...subKeys]),
    ).toEqual([...subKeys]);
  });

  it('PoE 1 任何劫盜裝備（heistequipment）對應到劫盜裝備容器', () => {
    expect(resolveOfficialTierCategory('poe1', categoryQuery('heistequipment'))).toEqual({
      status: 'known_category',
      category: 'heist_equipment',
    });
    expect(tradeMappings.poe1.machineOptionLookup.heist_equipment).toBeUndefined();
  });

  it('PoE 2 任何藥劑（flask）對應到含生命、魔力、護符的容器', () => {
    expect(resolveOfficialTierCategory('poe2', categoryQuery('flask'))).toEqual({
      status: 'known_category',
      category: 'any-flask',
    });
    const row = tradeMappings.poe2.typeRowConfigs.find((r) => r.mainKey === 'any-flask');
    expect(Object.keys(row?.subKeys ?? {})).toEqual(['life-flask', 'mana-flask', 'charm']);
  });

  it('虛擬父類有三語名稱，且對應表驗證無錯誤', () => {
    setActiveDisplayLocale('zh-TW');
    expect(tradeMappings.poe1.typeNames['any-one-hand-sword']).toBe('任何單手劍');
    expect(tradeMappings.poe1.typeNames['any-dagger']).toBe('任一匕首');
    expect(tradeMappings.poe2.typeNames['any-flask']).toBe('任何藥劑');
    setActiveDisplayLocale('en');
    expect(tradeMappings.poe1.typeNames['any-one-hand-sword']).toBe('Any One-Handed Sword');
    expect(tradeMappings.poe2.typeNames['any-flask']).toBe('Any Flask');
    expect(validateTradeMapping(tradeMappings.poe1)).toEqual([]);
    expect(validateTradeMapping(tradeMappings.poe2)).toEqual([]);
  });

  it('具體子類別仍反查回各自的官方類別', () => {
    expect(resolveOfficialCategoryOption('poe1', 'one-hand-sword')?.option).toBe(
      'weapon.basesword',
    );
    expect(resolveOfficialCategoryOption('poe1', 'thrusting-one-hand-sword')?.option).toBe(
      'weapon.rapier',
    );
    expect(resolveOfficialCategoryOption('poe1', 'rune-dagger')?.option).toBe('weapon.runedagger');
    expect(resolveOfficialCategoryOption('poe1', 'sceptre')?.option).toBe('weapon.sceptre');
    expect(resolveOfficialCategoryOption('poe2', 'charm')?.option).toBe('flask.charm');
  });

  it('isContainerSubtypeOf 只認容器父類底下的子類別', () => {
    const rows = tradeMappings.poe1.typeRowConfigs;
    expect(isContainerSubtypeOf(rows, 'any-one-hand-sword', 'thrusting-one-hand-sword')).toBe(true);
    expect(isContainerSubtypeOf(rows, 'cluster_jewel', 'small_cluster_jewel')).toBe(true);
    expect(isContainerSubtypeOf(rows, 'any-one-hand-sword', 'two-hand-sword')).toBe(false);
    // 非容器父類（防具屬性列）不算
    expect(isContainerSubtypeOf(rows, 'helmet', 'helmets_str')).toBe(false);
  });
});

describe('虛擬容器父類的 T 階過濾與拆組', () => {
  const shared = (level: string, values: string[]) => ({
    displayTemplate: '增加 #% 物理傷害',
    level,
    types: ['one-hand-sword', 'thrusting-one-hand-sword'],
    values: [values],
  });

  it('依子類別展開過濾，不需要資料帶有虛擬父類鍵', () => {
    const tiers = [
      shared('1', ['40', '49']),
      { displayTemplate: 'x', level: '1', types: ['two-hand-sword'], values: [['1', '2']] },
      {
        displayTemplate: 'y',
        level: '1',
        types: ['thrusting-one-hand-sword'],
        values: [['3', '4']],
      },
    ];
    expect(filterTiersByCategory(tiers, 'any-one-hand-sword', 'poe1')).toHaveLength(2);
    // 沒給版本時維持原本的精確比對
    expect(filterTiersByCategory(tiers, 'any-one-hand-sword')).toHaveLength(0);
    expect(filterTiersByCategory(tiers, 'one-hand-sword', 'poe1')).toHaveLength(1);
  });

  it('兩個子類共用的階級留在同一組，不產生重複分組', () => {
    const tiers = [shared('1', ['40', '49']), shared('83', ['170', '179'])];
    const groups = groupTiersByMod(tiers, 'poe1', 'any-one-hand-sword');
    expect(groups).toHaveLength(1);
    expect(groups[0].tiers).toHaveLength(2);
  });

  it('子類別各自擁有獨立階級池時依子類別拆組', () => {
    const tiers = [
      { displayTemplate: '+# 智慧', level: '1', types: ['staff'], values: [['8', '12']] },
      { displayTemplate: '+# 智慧', level: '1', types: ['warstaff'], values: [['10', '14']] },
    ];
    const groups = groupTiersByMod(tiers, 'poe1', 'any-staff');
    expect(groups.map((g) => g.affinityLabel)).toEqual(['長杖', '征戰長杖']);
  });
});
