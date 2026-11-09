import { describe, expect, it } from 'vitest';
import { resolveOfficialTierCategory } from '@/utils/official-category-resolver';

describe('official category structured query resolver', () => {
  it('resolves canonical PoE2 buckler and talisman and PoE1 weapon sub-types', () => {
    const makeCategoryQuery = (option: string) => ({
      filters: {
        type_filters: {
          filters: {
            category: { option },
          },
        },
      },
    });
    expect(resolveOfficialTierCategory('poe2', makeCategoryQuery('armour.buckler'))).toEqual({
      status: 'known_category',
      category: 'buckler',
    });
    expect(resolveOfficialTierCategory('poe2', makeCategoryQuery('weapon.talisman'))).toEqual({
      status: 'known_category',
      category: 'talisman',
    });
    expect(resolveOfficialTierCategory('poe1', makeCategoryQuery('weapon.runedagger'))).toEqual({
      status: 'known_category',
      category: 'rune-dagger',
    });
    expect(resolveOfficialTierCategory('poe1', makeCategoryQuery('weapon.warstaff'))).toEqual({
      status: 'known_category',
      category: 'warstaff',
    });
    expect(resolveOfficialTierCategory('poe1', makeCategoryQuery('weapon.rapier'))).toEqual({
      status: 'known_category',
      category: 'thrusting-one-hand-sword',
    });
  });

  it('resolves canonical bow in both PoE versions', () => {
    const query = {
      filters: {
        type_filters: {
          filters: {
            category: { option: 'weapon.bow' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe1', query)).toEqual({
      status: 'known_category',
      category: 'bow',
    });
    expect(resolveOfficialTierCategory('poe2', query)).toEqual({
      status: 'known_category',
      category: 'bow',
    });
  });

  it('resolves explicit clear when category is null, omitted, or empty in hydrated query', () => {
    // 1. category 欄位不存在
    const queryOmitted = {
      status: { option: 'online' },
      filters: { type_filters: { filters: {} } },
    };
    expect(resolveOfficialTierCategory('poe2', queryOmitted)).toEqual({
      status: 'known_cleared',
    });

    // 2. category.option 為 null
    const queryNull = {
      filters: {
        type_filters: {
          filters: {
            category: { option: null },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', queryNull)).toEqual({
      status: 'known_cleared',
    });

    // 3. category.option 為空字串
    const queryEmpty = {
      filters: {
        type_filters: {
          filters: {
            category: { option: '' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', queryEmpty)).toEqual({
      status: 'known_cleared',
    });
  });

  it('treats unknown future machine option as unavailable, never as clear', () => {
    const query = {
      filters: {
        type_filters: {
          filters: {
            category: { option: 'armour.future_type' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', query)).toEqual({
      status: 'unavailable',
    });
  });

  it('treats unhydrated or unreadable query structure as unavailable', () => {
    expect(resolveOfficialTierCategory('poe2', null)).toEqual({
      status: 'unavailable',
    });
    expect(resolveOfficialTierCategory('poe2', undefined)).toEqual({
      status: 'unavailable',
    });
    expect(resolveOfficialTierCategory('poe2', {})).toEqual({
      status: 'unavailable',
    });
    expect(resolveOfficialTierCategory('poe2', { invalid: 123 })).toEqual({
      status: 'unavailable',
    });
  });

  it('refines PoE2 tablet using structured query.type or query.name', () => {
    const queryBreach = {
      type: 'Breach Precursor Tablet',
      filters: {
        type_filters: {
          filters: {
            category: { option: 'map.tablet' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', queryBreach)).toEqual({
      status: 'known_category',
      category: 'breach-tablet',
    });

    const queryExpedition = {
      name: { option: '探險記事板' },
      filters: {
        type_filters: {
          filters: {
            category: { option: 'map.tablet' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', queryExpedition)).toEqual({
      status: 'known_category',
      category: 'expedition-tablet',
    });

    const zhCnTablets: ReadonlyArray<readonly [string, string]> = [
      ['裂隙先驱石板', 'breach-tablet'],
      ['先祖秘藏先驱碑牌', 'expedition-tablet'],
      ['谵妄先驱碑牌', 'delirium-tablet'],
      ['仪式先驱碑牌', 'ritual-tablet'],
      ['辐照先驱石板', 'irradiated-tablet'],
      ['总督的先驱石板', 'overseer-tablet'],
      ['深渊先驱碑牌', 'abyss-tablet'],
      ['神庙先驱碑牌', 'temple-tablet'],
    ];
    for (const [tabletName, expectedCat] of zhCnTablets) {
      expect(
        resolveOfficialTierCategory('poe2', {
          type: tabletName,
          filters: {
            type_filters: {
              filters: {
                category: { option: 'map.tablet' },
              },
            },
          },
        }),
      ).toEqual({
        status: 'known_category',
        category: expectedCat,
      });
    }
  });

  it('safely falls back to generic tablet when refinement is unrecognized, never clears', () => {
    const queryUnknownTablet = {
      type: 'mysterious tablet',
      filters: {
        type_filters: {
          filters: {
            category: { option: 'map.tablet' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', queryUnknownTablet)).toEqual({
      status: 'known_category',
      category: 'tablet',
    });

    const queryGenericTablet = {
      filters: {
        type_filters: {
          filters: {
            category: { option: 'map.tablet' },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', queryGenericTablet)).toEqual({
      status: 'known_category',
      category: 'tablet',
    });
  });

  it('unwraps outer query object correctly', () => {
    const wrapped = {
      query: {
        filters: {
          type_filters: {
            filters: {
              category: { option: 'armour.helmet' },
            },
          },
        },
      },
    };
    expect(resolveOfficialTierCategory('poe2', wrapped)).toEqual({
      status: 'known_category',
      category: 'helmet',
    });
  });

  it('resolves unique equivalent categories to known_category', () => {
    const bowQuery = {
      filters: { type_filters: { filters: { category: { option: 'weapon.bow' } } } },
    };
    const helmetQuery = {
      filters: { type_filters: { filters: { category: { option: 'armour.helmet' } } } },
    };
    expect(resolveOfficialTierCategory('poe1', bowQuery)).toEqual({
      status: 'known_category',
      category: 'bow',
    });
    expect(resolveOfficialTierCategory('poe2', helmetQuery)).toEqual({
      status: 'known_category',
      category: 'helmet',
    });
  });

  it('safely treats broad/ambiguous official options without unique Tier category as unavailable', () => {
    const makeQuery = (option: string) => ({
      filters: { type_filters: { filters: { category: { option } } } },
    });

    // PoE1 & PoE2 shared broad options
    for (const broadOption of ['weapon', 'armour', 'accessory']) {
      expect(resolveOfficialTierCategory('poe1', makeQuery(broadOption))).toEqual({
        status: 'unavailable',
      });
      expect(resolveOfficialTierCategory('poe2', makeQuery(broadOption))).toEqual({
        status: 'unavailable',
      });
    }

    // PoE1 specific broad options
    for (const poe1Broad of [
      'weapon.one',
      'weapon.onemelee',
      'weapon.twomelee',
      'weapon.dagger',
      'weapon.onesword',
      'weapon.onemace',
      'weapon.staff',
      'jewel',
    ]) {
      expect(resolveOfficialTierCategory('poe1', makeQuery(poe1Broad))).toEqual({
        status: 'unavailable',
      });
    }

    // PoE2 specific broad options
    for (const poe2Broad of [
      'weapon.onemelee',
      'weapon.twomelee',
      'weapon.ranged',
      'weapon.caster',
      'map',
      'flask',
    ]) {
      expect(resolveOfficialTierCategory('poe2', makeQuery(poe2Broad))).toEqual({
        status: 'unavailable',
      });
    }
  });
});
