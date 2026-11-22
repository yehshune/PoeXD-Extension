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

/** 將外框裁切回視窗範圍內，避免靠邊元件（例如貼齊左緣的收合把手）的外框被切掉。 */
export function clampGuideRectToViewport(rect: GuideRect, viewport: GuideSize): GuideRect {
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(viewport.width, rect.left + rect.width);
  const bottom = Math.min(viewport.height, rect.top + rect.height);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** 合併多個元素的矩形外框（例如同時框住 T 按鈕與展開的選單）。 */
export function unionGuideRects(rects: readonly GuideRect[]): GuideRect | null {
  if (rects.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.left + r.width);
    bottom = Math.max(bottom, r.top + r.height);
  }
  return { top, left, width: right - left, height: bottom - top };
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
  const fitsBelow = below + bubble.height <= viewport.height - VIEWPORT_MARGIN;
  const fitsAbove = above >= VIEWPORT_MARGIN;
  const fitsRight = right + bubble.width <= viewport.width - VIEWPORT_MARGIN;
  const fitsLeft = left >= VIEWPORT_MARGIN;

  // 高目標（如展開的階級選單或直立導覽列）在較矮視窗上優先放左右，避免硬塞下方或重疊
  const isTallTarget = target.height >= viewport.height * 0.4;
  if (isTallTarget) {
    if (fitsRight && fitsLeft) {
      const rightSpace = viewport.width - (target.left + target.width);
      const leftSpace = target.left;
      return leftSpace >= rightSpace
        ? { top: centeredTop, left, placement: 'left' }
        : { top: centeredTop, left: right, placement: 'right' };
    }
    if (fitsRight) return { top: centeredTop, left: right, placement: 'right' };
    if (fitsLeft) return { top: centeredTop, left, placement: 'left' };
  }

  if (fitsBelow) {
    return { top: below, left: centeredLeft, placement: 'bottom' };
  }
  if (fitsAbove) {
    return { top: above, left: centeredLeft, placement: 'top' };
  }
  if (fitsRight) {
    return { top: centeredTop, left: right, placement: 'right' };
  }
  if (fitsLeft) {
    return { top: centeredTop, left, placement: 'left' };
  }
  return { top: maxTop, left: centeredLeft, placement: 'bottom' };
}
