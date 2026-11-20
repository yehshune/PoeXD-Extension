import { describe, expect, it } from 'vitest';
import {
  padGuideRect,
  placeGuideBubble,
  unionGuideRects,
} from '@/components/sidebar/page-guide/page-guide-geometry';

const viewport = { width: 1000, height: 800 };
const bubble = { width: 300, height: 200 };

describe('padGuideRect', () => {
  it('grows the rect evenly on every side', () => {
    expect(padGuideRect({ top: 10, left: 20, width: 100, height: 40 }, 6)).toEqual({
      top: 4,
      left: 14,
      width: 112,
      height: 52,
    });
  });
});

describe('placeGuideBubble', () => {
  it('centers the bubble when there is no target', () => {
    expect(placeGuideBubble(null, bubble, viewport)).toEqual({
      top: 300,
      left: 350,
      placement: 'center',
    });
  });

  it('prefers below the target, centered horizontally', () => {
    const target = { top: 100, left: 400, width: 200, height: 50 };
    expect(placeGuideBubble(target, bubble, viewport)).toEqual({
      top: 162,
      left: 350,
      placement: 'bottom',
    });
  });

  it('falls back to above when there is no room below', () => {
    const target = { top: 650, left: 400, width: 200, height: 50 };
    expect(placeGuideBubble(target, bubble, viewport).placement).toBe('top');
    expect(placeGuideBubble(target, bubble, viewport).top).toBe(438);
  });

  it('uses the side for tall targets such as the vertical nav', () => {
    const target = { top: 0, left: 950, width: 50, height: 800 };
    const position = placeGuideBubble(target, bubble, viewport);
    expect(position.placement).toBe('left');
    expect(position.left).toBe(638);
  });

  it('keeps the bubble inside the viewport horizontally', () => {
    const target = { top: 100, left: 0, width: 20, height: 20 };
    expect(placeGuideBubble(target, bubble, viewport).left).toBe(8);
  });
});

describe('unionGuideRects', () => {
  it('merges multiple rects into one bounding rect and returns null for empty input', () => {
    expect(unionGuideRects([])).toBeNull();
    expect(
      unionGuideRects([
        { top: 100, left: 200, width: 30, height: 28 },
        { top: 132, left: 100, width: 220, height: 300 },
      ]),
    ).toEqual({
      top: 100,
      left: 100,
      width: 220,
      height: 332,
    });
  });
});
