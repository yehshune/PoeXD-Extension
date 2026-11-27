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

  it('returns highlights of the current series, including patch versions', () => {
    expect(getReleaseHighlights('v1.12.0', FIXTURE, '1.11.0').map((h) => h.id)).toEqual(['a']);
    expect(getReleaseHighlights('1.12.4', FIXTURE, '1.12.3').map((h) => h.id)).toEqual(['a']);
    expect(getReleaseHighlights('1.13.0', FIXTURE, '1.12.1').map((h) => h.id)).toEqual(['b']);
    expect(getReleaseHighlights('1.14.0', FIXTURE, '1.13.0')).toEqual([]);
    expect(getReleaseHighlights(undefined, FIXTURE, '1.12.0')).toEqual([]);
  });

  it('includes every series after the version the user upgraded from', () => {
    const multi: readonly ReleaseHighlight[] = [
      ...FIXTURE,
      {
        id: 'c',
        release: '1.11',
        section: 'bookmarks',
        labelKey: 'onboarding.update.highlight.theme',
      },
      {
        id: 'd',
        release: '1.14',
        section: 'modules',
        labelKey: 'onboarding.update.highlight.modules',
      },
    ];
    // 1.11 直接升到 1.13：補上 1.12 的項目，不含已看過的 1.11 與未來的 1.14
    expect(getReleaseHighlights('1.13.0', multi, '1.11.2').map((h) => h.id)).toEqual(['a', 'b']);
    // 1.12 升到 1.13：只顯示 1.13
    expect(getReleaseHighlights('1.13.0', multi, '1.12.1').map((h) => h.id)).toEqual(['b']);
    // 同系列小版更新：仍顯示該系列
    expect(getReleaseHighlights('1.13.1', multi, '1.13.0').map((h) => h.id)).toEqual(['b']);
  });

  it('shows every series up to the current one when the upgrade source is unknown', () => {
    expect(getReleaseHighlights('1.13.0', FIXTURE, undefined).map((h) => h.id)).toEqual(['a', 'b']);
    expect(getReleaseHighlights('1.12.0', FIXTURE, 'garbage').map((h) => h.id)).toEqual(['a']);
  });

  it('declares every shipped highlight with a valid release series', () => {
    for (const highlight of RELEASE_HIGHLIGHTS) {
      expect(highlight.release).toMatch(/^\d+\.\d+$/);
    }
  });

  it('surfaces the 1.15 layout and highlight style entries when upgrading from 1.14', () => {
    expect(
      getReleaseHighlights('1.15.0', RELEASE_HIGHLIGHTS, '1.14.0').map((h) => ({
        id: h.id,
        section: h.section,
      })),
    ).toEqual([
      { id: 'two-column-layout', section: 'pageLayout' },
      { id: 'highlight-style', section: 'resultDisplay' },
    ]);
  });
});
