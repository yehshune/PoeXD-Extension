import { describe, expect, it } from 'vitest';
import { getTierMinMaxList } from '@/components/sidebar/utils';

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
