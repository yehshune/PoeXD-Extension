export interface GuideRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface GuideSize {
  width: number;
  height: number;
}

export type GuidePlacement = 'bottom' | 'top' | 'right' | 'left' | 'center';

export interface GuideBubblePosition {
  top: number;
  left: number;
  placement: GuidePlacement;
}

const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** 外框比目標元素向外多留一點空間，避免貼住文字。 */
export function padGuideRect(rect: GuideRect, padding: number): GuideRect {
  return {
    top: rect.top - padding,
    left: rect.left - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

/**
 * 說明框擺在目標下方，放不下就上方，再不行就左右（例如側欄的直立導覽列）；
 * 沒有目標時置中。結果一律夾在視窗內。
 */
export function placeGuideBubble(
  target: GuideRect | null,
  bubble: GuideSize,
  viewport: GuideSize,
  gap = 12,
): GuideBubblePosition {
  const maxLeft = viewport.width - bubble.width - VIEWPORT_MARGIN;
  const maxTop = viewport.height - bubble.height - VIEWPORT_MARGIN;
  if (!target) {
    return {
      top: clamp((viewport.height - bubble.height) / 2, VIEWPORT_MARGIN, maxTop),
      left: clamp((viewport.width - bubble.width) / 2, VIEWPORT_MARGIN, maxLeft),
      placement: 'center',
    };
  }

  const centeredLeft = clamp(
    target.left + target.width / 2 - bubble.width / 2,
    VIEWPORT_MARGIN,
    maxLeft,
  );
  const centeredTop = clamp(
    target.top + target.height / 2 - bubble.height / 2,
    VIEWPORT_MARGIN,
    maxTop,
  );
  const below = target.top + target.height + gap;
  const above = target.top - gap - bubble.height;
  const right = target.left + target.width + gap;
  const left = target.left - gap - bubble.width;

  if (below + bubble.height <= viewport.height - VIEWPORT_MARGIN) {
    return { top: below, left: centeredLeft, placement: 'bottom' };
  }
  if (above >= VIEWPORT_MARGIN) {
    return { top: above, left: centeredLeft, placement: 'top' };
  }
  if (right + bubble.width <= viewport.width - VIEWPORT_MARGIN) {
    return { top: centeredTop, left: right, placement: 'right' };
  }
  if (left >= VIEWPORT_MARGIN) {
    return { top: centeredTop, left, placement: 'left' };
  }
  return { top: maxTop, left: centeredLeft, placement: 'bottom' };
}
