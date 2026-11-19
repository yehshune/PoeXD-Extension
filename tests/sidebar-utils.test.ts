import { describe, expect, it } from 'vitest';
import {
  filterModGroupsByItemLevel,
  getTierMinMaxList,
  isTierLockedByItemLevelMax,
} from '@/components/sidebar/utils';
import type { ModGroup } from '@/components/sidebar/types';

describe('tier ranges', () => {
  it('extracts single and averaged double-value ranges', () => {
    expect(
      getTierMinMaxList('# to life|||||#% increased damage', [
        ['10', '20'],
        ['30', '40'],
      ]),
    ).toEqual({ mins: ['10', '30'], maxs: ['20', '40'] });
    expect(
      getTierMinMaxList('# to # damage', [
        ['10', '20'],
        ['30', '40'],
      ]),
    ).toEqual({ mins: ['20'], maxs: ['30'] });
  });

  it('handles empty values, one-sided values and text without placeholders', () => {
    expect(getTierMinMaxList('plain text', [])).toEqual({ mins: [], maxs: [] });
    expect(getTierMinMaxList('# value|||||plain', [['5']])).toEqual({
      mins: ['5', ''],
      maxs: ['', ''],
    });
  });
});

describe('item level filtering', () => {
  const makeTier = (level: string) => ({
    affinities: ['normal'],
    generation_type: '1',
    key: '# to maximum life',
    level,
    values: [['10', '20']],
    types: ['body-armour'],
  });

  const groups: ModGroup[] = [
    {
      id: 'life',
      key: '# to maximum life',
      details: '',
      generation_type: '1',
      affinities: ['normal'],
      tiers: [makeTier('1'), makeTier('44'), makeTier('73')],
    },
    {
      id: 'chaos',
      key: '#% to chaos resistance',
      details: '',
      generation_type: '2',
      affinities: ['normal'],
      tiers: [makeTier('80')],
    },
  ];

  it('detects tiers above max item level via isTierLockedByItemLevelMax', () => {
    expect(isTierLockedByItemLevelMax('73', null)).toBe(false);
    expect(isTierLockedByItemLevelMax('73', 73)).toBe(false);
    expect(isTierLockedByItemLevelMax('73', 50)).toBe(true);
    expect(isTierLockedByItemLevelMax('', 50)).toBe(false);
  });

  it('keeps higher tiers above max when includeHigherTiersAboveMax is enabled while excluding ineligible mods and tiers below min', () => {
    const strict = filterModGroupsByItemLevel(groups, { min: 40, max: 60 });
    expect(strict.map((g) => g.id)).toEqual(['life']);
    expect(strict[0].tiers.map((t) => t.level)).toEqual(['44']);

    const withHigher = filterModGroupsByItemLevel(
      groups,
      { min: 40, max: 60 },
      { includeHigherTiersAboveMax: true },
    );
    expect(withHigher.map((g) => g.id)).toEqual(['life']);
    expect(withHigher[0].tiers.map((t) => t.level)).toEqual(['44', '73']);
  });
});
