import { describe, expect, it } from 'vitest';
import { tradeMappings } from '@/components/sidebar/mapping-registry';
import {
  getCategoryColorDots,
  getCategoryDotToneClass,
  splitTypeGroupsIntoColumns,
} from '@/utils/item-category-visuals';

describe('item-category-visuals', () => {
  it('assigns semantic attribute, jewel, and flask color dots', () => {
    expect(getCategoryColorDots('body_armours_str')).toEqual(['str']);
    expect(getCategoryColorDots('body_armours_str_dex')).toEqual(['str', 'dex']);
    expect(getCategoryColorDots('body_armours_str_dex_int')).toEqual(['str', 'dex', 'int']);
    expect(getCategoryColorDots('helmets_ward')).toEqual(['ward']);
    expect(getCategoryColorDots('shields_minion')).toEqual(['minion']);
    expect(getCategoryColorDots('crimson_jewel')).toEqual(['str']);
    expect(getCategoryColorDots('viridian_jewel')).toEqual(['dex']);
    expect(getCategoryColorDots('cobalt_jewel')).toEqual(['int']);
    expect(getCategoryColorDots('prismatic_jewel')).toEqual(['prismatic']);
    expect(getCategoryColorDots('ruby')).toEqual(['str']);
    expect(getCategoryColorDots('emerald')).toEqual(['dex']);
    expect(getCategoryColorDots('sapphire')).toEqual(['int']);
    expect(getCategoryColorDots('diamond')).toEqual(['prismatic']);
    expect(getCategoryColorDots('hybrid-flask')).toEqual(['str', 'int']);
    expect(getCategoryColorDots('utility-flask')).toEqual(['ward']);
    expect(getCategoryColorDots('iron-flask')).toEqual(['amber']);
    expect(getCategoryColorDots('one-hand-sword')).toEqual([]);

    for (const tone of ['str', 'dex', 'int', 'ward', 'minion', 'prismatic', 'amber'] as const) {
      expect(getCategoryDotToneClass(tone)).toBeTruthy();
    }
  });

  it.each(['poe1', 'poe2'] as const)(
    'balances %s groups across two columns without losing any group',
    (version) => {
      const mapping = tradeMappings[version];
      const groups = mapping.groups.map((g) => ({
        groupLabel: g.groupLabel,
        rows: mapping.typeRowConfigs.filter((r) => g.keys.includes(r.mainKey)),
        singleOptions: g.keys.filter(
          (k) =>
            !mapping.typeRowConfigs.some(
              (r) => r.mainKey === k || Object.prototype.hasOwnProperty.call(r.subKeys, k),
            ),
        ),
      }));

      const [left, right] = splitTypeGroupsIntoColumns(groups);
      expect(left.length).toBeGreaterThan(0);
      expect(right.length).toBeGreaterThan(0);
      expect(left.length + right.length).toBe(groups.length);
    },
  );
});
