import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { useFilterData } from '@/components/sidebar/composables/useFilterData';
import type { ModTier } from '@/components/sidebar/types';
import { resetI18nStateForTests, setActiveDisplayLocale } from '@/utils/i18n';
import { setAffixLexiconMockData } from '@/utils/affix-lexicon';
import { resetOfficialStatTextForTests, setMockOfficialStatText } from '@/utils/official-stat-text';

const tier = (overrides: Partial<ModTier>): ModTier => ({
  affinities: ['prefix'],
  generation_type: '1',
  key: '',
  level: '1',
  values: [],
  types: ['gloves'],
  ...overrides,
});

describe('選擇器的詞綴標籤', () => {
  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    resetOfficialStatTextForTests();
    setMockOfficialStatText('poe2', 'en', {});
  });

  afterEach(() => {
    resetOfficialStatTextForTests();
  });

  const groupsFor = (modsData: Record<string, ModTier[]>) => {
    const filterData = useFilterData('poe2', ref('gloves'));
    filterData.rawModsData.value = modsData;
    return filterData.currentTypeGroups.value;
  };

  it('單一詞綴用官方市集的寫法，階級列仍是遊戲寫法', () => {
    setMockOfficialStatText('poe2', 'zh-TW', { 'explicit.stat_3639275092': '增加#%能力值需求' });
    const [group] = groupsFor({
      '#% reduced attribute requirements': [
        tier({
          id: 'explicit.stat_3639275092',
          key: '15% reduced attribute requirements',
          displayKey: '減少 15% 能力值需求',
          displayTemplate: '減少 #% 能力值需求',
        }),
      ],
    });
    expect(group.displayTemplate).toBe('增加#%能力值需求');
    expect(group.displayKey).toBe('減少 15% 能力值需求');
    expect(group.tiers[0].displayTemplate).toBe('減少 #% 能力值需求');
  });

  it('複合詞綴維持完整的遊戲寫法', () => {
    setMockOfficialStatText('poe2', 'zh-TW', {
      'explicit.stat_a': '增加#%護甲值',
      'explicit.stat_b': '增加#%暈眩恢復',
    });
    const [group] = groupsFor({
      hybrid: [
        tier({
          ids: ['explicit.stat_a', 'explicit.stat_b'],
          key: 'hybrid',
          displayTemplate: '增加 #% 護甲|||||增加 #% 暈眩恢復',
        }),
      ],
    });
    expect(group.displayTemplate).toBe('增加 #% 護甲|||||增加 #% 暈眩恢復');
  });

  it('官方沒有翻譯時保留原本的標籤', () => {
    setMockOfficialStatText('poe2', 'zh-TW', {});
    const [group] = groupsFor({
      x: [tier({ id: 'explicit.stat_x', key: 'x', displayTemplate: '遊戲詞綴 #%' })],
    });
    expect(group.displayTemplate).toBe('遊戲詞綴 #%');
  });

  it('官方沒有翻譯時改用詞綴字典的市集標準寫法，而不是最低階級的遊戲文字', () => {
    setMockOfficialStatText('poe2', 'zh-TW', {});
    setAffixLexiconMockData(
      'poe2',
      {
        typeTable: [['gloves']],
        groups: ['#% reduced attribute requirements'],
        tiers: [
          {
            groupIdx: 0,
            typeIdx: 0,
            affinities: ['prefix'],
            generation_type: '1',
            level: 24,
            values: [['15']],
            params: [-15],
            id: 'explicit.stat_3639275092',
          },
        ],
      } as never,
      {
        'zh-TW': {
          templates: ['減少{0:n}%能力值需求', '增加{0:d}%能力值需求'],
          tierTemplates: [0],
          statTemplates: { 'explicit.stat_3639275092': 1 },
        },
      },
    );
    const [group] = groupsFor({
      g: [
        tier({
          id: 'explicit.stat_3639275092',
          key: 'g',
          displayTemplate: '減少#%能力值需求',
        }),
      ],
    });
    expect(group.displayTemplate).toBe('增加#%能力值需求');
    setAffixLexiconMockData('poe2', null);
  });

  it('跟著顯示語系切換', () => {
    setMockOfficialStatText('poe2', 'zh-CN', { 'explicit.stat_3639275092': '属性需求提高 #%' });
    setActiveDisplayLocale('zh-CN');
    const [group] = groupsFor({
      g: [tier({ id: 'explicit.stat_3639275092', key: 'g', displayTemplate: '属性需求降低 #%' })],
    });
    expect(group.displayTemplate).toBe('属性需求提高 #%');
  });
});
