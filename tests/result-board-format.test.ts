import { beforeEach, describe, expect, it } from 'vitest';
import {
  entryTitle,
  formatAge,
  formatAmount,
  formatPrice,
  formatTotal,
  rarityColour,
  stopMessage,
} from '@/components/sidebar/result-board/result-board-format';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { toBoardEntry } from '@/utils/result-board/board-entry';
import { rawResult } from './helpers/result-board-fixtures';

describe('result board format', () => {
  beforeEach(() => setActiveDisplayLocalePreference('en'));

  it('colours names by rarity and joins name with base', () => {
    const rare = toBoardEntry(rawResult({ id: 'a', name: 'Doom Shell', frameType: 2 }), 0)!;
    expect(rarityColour(rare)).toBe('oklch(0.76 0.13 92)');
    expect(entryTitle(rare)).toBe('Doom Shell Vaal Regalia');
    const plain = toBoardEntry(rawResult({ id: 'b', frameType: 99 }), 0)!;
    expect(rarityColour(plain)).toBe('var(--foreground)');
    expect(entryTitle(plain)).toBe('Vaal Regalia');
  });

  it('formats listing age relative to now', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    expect(formatAge(now - 2 * 3_600_000, now)).toBe('2 hours ago');
    expect(formatAge(now - 10_000, now)).toBe('this minute');
    expect(formatAge(undefined, now)).toBe('');
  });

  it('formats amounts, prices and totals', () => {
    expect(formatAmount(1.256)).toBe('1.26');
    expect(formatPrice({ amount: 5, currency: 'divine' })).toBe('5 divine');
    expect(formatPrice(undefined)).toBe('No price');
    expect(
      formatTotal({ kind: 'converted', currency: 'chaos', amount: 1234.5, unconverted: 0 }),
    ).toBe('1,234.5 chaos');
    expect(formatTotal({ kind: 'converted', currency: 'chaos', amount: 10, unconverted: 2 })).toBe(
      '10 chaos (+2 not converted)',
    );
    expect(
      formatTotal({
        kind: 'per-currency',
        totals: [
          { currency: 'divine', amount: 2 },
          { currency: 'chaos', amount: 150 },
        ],
        unpriced: 0,
      }),
    ).toBe('2 divine + 150 chaos');
    expect(formatTotal({ kind: 'per-currency', totals: [], unpriced: 1 })).toBe('No price');
  });

  it('explains why loading stopped', () => {
    expect(stopMessage('rate-limited')).toContain('rate limit');
  });
});
