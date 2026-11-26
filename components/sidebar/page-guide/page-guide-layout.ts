import type { I18nKey } from '@/utils/i18n';
import {
  SIDEBAR_DESCRIPTORS,
  type SidebarDescriptor,
  type SidebarDescriptorId,
} from '@/utils/sidebar-modules';
import {
  padGuideRect,
  type GuideBubblePosition,
  type GuideRect,
  type GuideSize,
} from './page-guide-geometry';

export interface SidebarCalloutSpec {
  readonly id: SidebarDescriptorId;
  readonly selector: string;
  readonly titleKey: I18nKey;
  readonly descKey: I18nKey;
}

export interface SidebarCallout {
  id: string;
  top: number;
  left?: number;
  right?: number;
  side: 'left' | 'right';
  titleKey: I18nKey;
  descKey: I18nKey;
}

export interface SidebarCalloutMetrics {
  key: string;
  titleWidth: number;
  cardWidth: number;
  height: number;
}

export interface ResizeHandleGeometry {
  rect: GuideRect;
  centerX: number;
  side: 'left' | 'right';
}

export interface ResizeHandleIndicator {
  top: number;
  left: number;
  width: number;
  height: number;
  centerX: number;
  anchorY: number;
  side: 'left' | 'right';
  calloutLeft?: number;
  calloutRight?: number;
}

type SidebarActionDescriptorId = Extract<SidebarDescriptor, { readonly kind: 'action' }>['id'];

const SIDEBAR_CALLOUT_DESC_KEYS: Readonly<Record<SidebarDescriptorId, I18nKey>> = Object.freeze({
  bookmark: 'pageGuide.tour.sidebar.item.bookmark',
  history: 'pageGuide.tour.sidebar.item.history',
  'stat-group-template': 'pageGuide.tour.sidebar.item.statGroupTemplate',
  'pob-build': 'pageGuide.tour.sidebar.item.pobBuild',
  'pinned-items': 'pageGuide.tour.sidebar.item.pinnedItems',
  'result-board': 'pageGuide.tour.sidebar.item.resultBoard',
  'live-search': 'pageGuide.tour.sidebar.item.liveSearch',
  tools: 'pageGuide.tour.sidebar.item.tools',
  settings: 'pageGuide.tour.sidebar.item.settings',
});

const SIDEBAR_ACTION_CALLOUT_META: Readonly<
  Record<SidebarActionDescriptorId, { readonly selector: string; readonly titleKey: I18nKey }>
> = Object.freeze({
  'live-search': {
    selector: '[data-sidebar-action="open-live-search"]',
    titleKey: 'sidebar.nav.openLiveSearch',
  },
});

/** 由單一宣告式 SIDEBAR_DESCRIPTORS 推導的側欄導覽列標註規格 */
export const SIDEBAR_CALLOUT_SPECS: readonly SidebarCalloutSpec[] = Object.freeze(
  SIDEBAR_DESCRIPTORS.map((descriptor): SidebarCalloutSpec => {
    const descKey = SIDEBAR_CALLOUT_DESC_KEYS[descriptor.id];
    if (descriptor.kind === 'action') {
      const actionMeta = SIDEBAR_ACTION_CALLOUT_META[descriptor.id];
      return Object.freeze({
        id: descriptor.id,
        selector: actionMeta.selector,
        titleKey: actionMeta.titleKey,
        descKey,
      });
    }
    return Object.freeze({
      id: descriptor.id,
      selector: `[data-sidebar-tab="${descriptor.id}"]`,
      titleKey: descriptor.labelKey,
      descKey,
    });
  }),
);

export function sameGuideRect(a: GuideRect | null, b: GuideRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export function rectsOverlap(a: GuideRect, b: GuideRect): boolean {
  return !(
    a.left + a.width <= b.left ||
    a.left >= b.left + b.width ||
    a.top + a.height <= b.top ||
    a.top >= b.top + b.height
  );
}

export function sameResizeIndicator(
  a: ResizeHandleIndicator | null,
  b: ResizeHandleIndicator | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height &&
    a.centerX === b.centerX &&
    a.anchorY === b.anchorY &&
    a.side === b.side &&
    a.calloutLeft === b.calloutLeft &&
    a.calloutRight === b.calloutRight
  );
}

export function sameSidebarCallouts(
  a: readonly SidebarCallout[],
  b: readonly SidebarCallout[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.top !== y.top ||
      x.left !== y.left ||
      x.right !== y.right ||
      x.side !== y.side
    ) {
      return false;
    }
  }
  return true;
}

export function buildSidebarCallouts(
  navRect: GuideRect,
  items: readonly { spec: SidebarCalloutSpec; rect: GuideRect }[],
  viewportWidth: number,
): SidebarCallout[] {
  if (navRect.width <= 0 || navRect.height <= 0) return [];
  const side: 'left' | 'right' =
    navRect.left + navRect.width / 2 < viewportWidth / 2 ? 'right' : 'left';
  const navRight = navRect.left + navRect.width;
  const result: SidebarCallout[] = [];
  for (const { spec, rect } of items) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const top = Math.round(rect.top + rect.height / 2);
    if (side === 'right') {
      result.push({
        id: spec.id,
        top,
        left: Math.round(navRight + 12),
        side,
        titleKey: spec.titleKey,
        descKey: spec.descKey,
      });
    } else {
      result.push({
        id: spec.id,
        top,
        right: Math.round(viewportWidth - navRect.left + 12),
        side,
        titleKey: spec.titleKey,
        descKey: spec.descKey,
      });
    }
  }
  return result;
}

export function computeSidebarCalloutMetrics(input: {
  layoutKey: string;
  titleWidths: readonly number[];
  descWidths: readonly number[];
  firstCardWidth: number;
  cardHeights: readonly number[];
  edgeOffset: number;
  viewportWidth: number;
}): SidebarCalloutMetrics | null {
  if (input.titleWidths.length === 0 || input.descWidths.length === 0) return null;
  const maxTitle = Math.ceil(Math.max(0, ...input.titleWidths));
  const maxDesc = Math.ceil(Math.max(0, ...input.descWidths));
  if (maxTitle <= 0 || maxDesc <= 0) return null;

  const chrome = Math.max(
    0,
    Math.ceil(input.firstCardWidth - (input.titleWidths[0] ?? 0) - (input.descWidths[0] ?? 0)),
  );
  const available = Math.max(220, input.viewportWidth - input.edgeOffset - 16);
  const cardWidth = Math.min(maxTitle + maxDesc + chrome + 2, available);
  const titleWidth = Math.min(maxTitle, Math.floor(cardWidth * 0.45));
  const height = Math.ceil(Math.max(34, ...input.cardHeights));

  return {
    key: input.layoutKey,
    titleWidth,
    cardWidth,
    height,
  };
}

export function expandTargetRectForCallouts(
  target: GuideRect | null,
  calloutRects: readonly GuideRect[],
): GuideRect | null {
  if (!target || calloutRects.length === 0) return target;
  let minLeft = target.left;
  let maxRight = target.left + target.width;
  for (const rect of calloutRects) {
    if (rect.width <= 0) continue;
    minLeft = Math.min(minLeft, rect.left - 8);
    maxRight = Math.max(maxRight, rect.left + rect.width + 8);
  }
  return {
    top: target.top,
    left: minLeft,
    width: maxRight - minLeft,
    height: target.height,
  };
}

export function computeInteractiveCutout(input: {
  stepId: string | undefined;
  expandRect: GuideRect | null;
  collapseRect: GuideRect | null;
  wrapperRect: GuideRect | null;
  viewportHeight: number;
}): GuideRect | null {
  if (input.stepId === 'collapse') {
    if (input.expandRect && input.expandRect.width > 0 && input.expandRect.height > 0) {
      // 收合後允許沿著整條邊緣上下拖曳位置
      return {
        top: 0,
        left: Math.max(0, input.expandRect.left - 4),
        width: input.expandRect.width + 8,
        height: input.viewportHeight,
      };
    }
    if (input.collapseRect && input.collapseRect.width > 0 && input.collapseRect.height > 0) {
      return padGuideRect(input.collapseRect, 4);
    }
    return null;
  }
  if (input.stepId === 'appearance') {
    if (input.wrapperRect && input.wrapperRect.width > 0 && input.wrapperRect.height > 0) {
      return padGuideRect(input.wrapperRect, 10);
    }
  }
  return null;
}

export function buildPageBlockerClipPath(
  cutout: GuideRect | null,
  viewport: GuideSize,
): string | null {
  if (!cutout) return null;
  const vw = viewport.width;
  const vh = viewport.height;
  const L = Math.max(0, cutout.left);
  const T = Math.max(0, cutout.top);
  const R = Math.min(vw, cutout.left + cutout.width);
  const B = Math.min(vh, cutout.top + cutout.height);
  if (R <= L || B <= T) return null;
  return `polygon(evenodd, 0px 0px, ${vw}px 0px, ${vw}px ${vh}px, 0px ${vh}px, 0px 0px, ${L}px ${T}px, ${L}px ${B}px, ${R}px ${B}px, ${R}px ${T}px, ${L}px ${T}px)`;
}

export function resolveResizeHandleSide(
  centerX: number,
  panelRect: GuideRect | null,
  viewportWidth: number,
): 'left' | 'right' {
  if (panelRect && panelRect.width > 0) {
    return centerX < panelRect.left + panelRect.width / 2 ? 'left' : 'right';
  }
  return centerX < viewportWidth / 2 ? 'right' : 'left';
}

export function computeResizeAnchorY(
  handleRect: GuideRect,
  bubbleRect: { top: number; height: number } | null,
  viewportHeight: number,
): number {
  const minY = Math.max(28, Math.round(handleRect.top + 28));
  const maxY = Math.min(viewportHeight - 28, Math.round(handleRect.top + handleRect.height - 28));
  if (!bubbleRect) {
    return Math.min(maxY, Math.max(minY, Math.round(handleRect.top + handleRect.height * 0.25)));
  }
  const clearance = 36;
  const aboveY = bubbleRect.top - clearance;
  if (aboveY >= minY) return aboveY;
  const belowY = bubbleRect.top + bubbleRect.height + clearance;
  if (belowY <= maxY) return belowY;
  return Math.min(maxY, Math.max(minY, Math.round(handleRect.top + handleRect.height * 0.2)));
}

export function buildResizeIndicator(
  handle: ResizeHandleGeometry,
  bubbleRect: { top: number; height: number } | null,
  viewport: GuideSize,
): ResizeHandleIndicator {
  const anchorY = computeResizeAnchorY(handle.rect, bubbleRect, viewport.height);
  const centerX = Math.round(handle.centerX);
  return {
    top: handle.rect.top,
    left: handle.rect.left,
    width: handle.rect.width,
    height: handle.rect.height,
    centerX,
    anchorY,
    side: handle.side,
    ...(handle.side === 'right'
      ? { calloutLeft: centerX + 20 }
      : { calloutRight: Math.round(viewport.width - centerX + 20) }),
  };
}

export function placeAffixDemoBubble(
  spotlight: GuideRect | null,
  bubbleSize: GuideSize,
  viewport: GuideSize,
): GuideBubblePosition {
  // 置於右側「待套用清單」中段空白區，避免擋住底部的套用按鈕
  const rightEdge = spotlight ? spotlight.left + spotlight.width : viewport.width;
  const topAnchor = spotlight
    ? spotlight.top + Math.round((spotlight.height - bubbleSize.height) * 0.45)
    : Math.round((viewport.height - bubbleSize.height) * 0.45);
  return {
    top: Math.max(8, Math.min(topAnchor, viewport.height - bubbleSize.height - 8)),
    left: Math.max(
      8,
      Math.min(rightEdge - bubbleSize.width - 20, viewport.width - bubbleSize.width - 8),
    ),
    placement: 'right',
  };
}

export function shouldKeepCollapseDemoBubblePosition(input: {
  stepId: string | undefined;
  currentBubblePosition: GuideBubblePosition | null;
  bubbleSize: GuideSize;
  nextRing: GuideRect | null;
  isDemoActive: boolean;
}): boolean {
  if (input.stepId !== 'collapse' || !input.currentBubblePosition || !input.isDemoActive) {
    return false;
  }
  if (!input.nextRing) return true;
  return !rectsOverlap(
    {
      top: input.currentBubblePosition.top,
      left: input.currentBubblePosition.left,
      width: input.bubbleSize.width,
      height: input.bubbleSize.height,
    },
    input.nextRing,
  );
}
