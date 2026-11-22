import { describe, expect, it } from 'vitest';
import {
  RELEASE_HIGHLIGHTS,
  getReleaseHighlights,
  toReleaseSeries,
  type ReleaseHighlight,
} from '@/utils/release-highlights';

const FIXTURE: readonly ReleaseHighlight[] = [
  {
    id: 'a',
    release: '1.12',
    section: 'appearance',
    labelKey: 'onboarding.update.highlight.theme',
  },
  { id: 'b', release: '1.13', section: 'modules', labelKey: 'onboarding.update.highlight.modules' },
];

describe('release highlights', () => {
  it('parses the major.minor release series from version strings', () => {
    expect(toReleaseSeries('1.12.0')).toBe('1.12');
    expect(toReleaseSeries('v1.12.3')).toBe('1.12');
    expect(toReleaseSeries('1.12')).toBe('1.12');
    expect(toReleaseSeries('01.012.0')).toBe('1.12');
    expect(toReleaseSeries('')).toBeNull();
    expect(toReleaseSeries(undefined)).toBeNull();
    expect(toReleaseSeries('next')).toBeNull();
  });

  it('only returns highlights of the same release series, including patch versions', () => {
    expect(getReleaseHighlights('v1.12.0', FIXTURE).map((h) => h.id)).toEqual(['a']);
    expect(getReleaseHighlights('1.12.4', FIXTURE).map((h) => h.id)).toEqual(['a']);
    expect(getReleaseHighlights('1.13.0', FIXTURE).map((h) => h.id)).toEqual(['b']);
    expect(getReleaseHighlights('1.14.0', FIXTURE)).toEqual([]);
    expect(getReleaseHighlights(undefined, FIXTURE)).toEqual([]);
  });

  it('declares every shipped highlight with a valid release series', () => {
    for (const highlight of RELEASE_HIGHLIGHTS) {
      expect(highlight.release).toMatch(/^\d+\.\d+$/);
    }
  });
});
