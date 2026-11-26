import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_CALLOUT_SPECS,
  buildPageBlockerClipPath,
  buildResizeIndicator,
  buildSidebarCallouts,
  computeInteractiveCutout,
  computeResizeAnchorY,
  computeSidebarCalloutMetrics,
  expandTargetRectForCallouts,
  placeAffixDemoBubble,
  rectsOverlap,
  resolveResizeHandleSide,
  sameGuideRect,
  sameResizeIndicator,
  sameSidebarCallouts,
  shouldKeepCollapseDemoBubblePosition,
} from '@/components/sidebar/page-guide/page-guide-layout';
import { SIDEBAR_DESCRIPTORS } from '@/utils/sidebar-modules';

describe('SIDEBAR_CALLOUT_SPECS', () => {
  it('derives every callout spec in order from SIDEBAR_DESCRIPTORS', () => {
    expect(SIDEBAR_CALLOUT_SPECS.map((s) => s.id)).toEqual(SIDEBAR_DESCRIPTORS.map((d) => d.id));

    const bookmark = SIDEBAR_CALLOUT_SPECS.find((s) => s.id === 'bookmark');
    expect(bookmark).toEqual({
      id: 'bookmark',
      selector: '[data-sidebar-tab="bookmark"]',
      titleKey: 'sidebar.nav.bookmarks',
      descKey: 'pageGuide.tour.sidebar.item.bookmark',
    });

    const liveSearch = SIDEBAR_CALLOUT_SPECS.find((s) => s.id === 'live-search');
    expect(liveSearch).toEqual({
      id: 'live-search',
      selector: '[data-sidebar-action="open-live-search"]',
      titleKey: 'sidebar.nav.openLiveSearch',
      descKey: 'pageGuide.tour.sidebar.item.liveSearch',
    });

    const settings = SIDEBAR_CALLOUT_SPECS.find((s) => s.id === 'settings');
    expect(settings).toEqual({
      id: 'settings',
      selector: '[data-sidebar-tab="settings"]',
      titleKey: 'sidebar.nav.settings',
      descKey: 'pageGuide.tour.sidebar.item.settings',
    });
  });
});

describe('buildSidebarCallouts', () => {
  const specA = SIDEBAR_CALLOUT_SPECS[0]!;
  const specB = SIDEBAR_CALLOUT_SPECS[1]!;

  it('places callouts to the right when the nav rail sits on the left half of the viewport', () => {
    const callouts = buildSidebarCallouts(
      { top: 0, left: 320, width: 48, height: 800 },
      [
        { spec: specA, rect: { top: 20, left: 326, width: 36, height: 36 } },
        { spec: specB, rect: { top: 68, left: 326, width: 36, height: 36 } },
      ],
      1440,
    );
    expect(callouts).toEqual([
      {
        id: specA.id,
        top: 38,
        left: 380,
        side: 'right',
        titleKey: specA.titleKey,
        descKey: specA.descKey,
      },
      {
        id: specB.id,
        top: 86,
        left: 380,
        side: 'right',
        titleKey: specB.titleKey,
        descKey: specB.descKey,
      },
    ]);
  });

  it('places callouts to the left when the nav rail sits on the right half of the viewport', () => {
    const callouts = buildSidebarCallouts(
      { top: 0, left: 1060, width: 48, height: 800 },
      [{ spec: specA, rect: { top: 20, left: 1066, width: 36, height: 36 } }],
      1440,
    );
    expect(callouts).toEqual([
      {
        id: specA.id,
        top: 38,
        right: 392,
        side: 'left',
        titleKey: specA.titleKey,
        descKey: specA.descKey,
      },
    ]);
  });

  it('skips zero-sized nav or item rects', () => {
    expect(buildSidebarCallouts({ top: 0, left: 0, width: 0, height: 800 }, [], 1440)).toEqual([]);
    const callouts = buildSidebarCallouts(
      { top: 0, left: 0, width: 48, height: 800 },
      [{ spec: specA, rect: { top: 20, left: 0, width: 0, height: 36 } }],
      1440,
    );
    expect(callouts).toEqual([]);
  });
});

describe('computeSidebarCalloutMetrics & expandTargetRectForCallouts', () => {
  it('unifies card width, title column width, and height clamped to viewport', () => {
    const metrics = computeSidebarCalloutMetrics({
      layoutKey: 'k1',
      titleWidths: [50, 80],
      descWidths: [100, 140],
      firstCardWidth: 182,
      cardHeights: [32, 40],
      edgeOffset: 380,
      viewportWidth: 1440,
    });
    expect(metrics).toEqual({
      key: 'k1',
      titleWidth: 80,
      cardWidth: 254,
      height: 40,
    });
  });

  it('clamps cardWidth to available viewport space and caps titleWidth at 45%', () => {
    const metrics = computeSidebarCalloutMetrics({
      layoutKey: 'narrow',
      titleWidths: [200],
      descWidths: [300],
      firstCardWidth: 530,
      cardHeights: [30],
      edgeOffset: 400,
      viewportWidth: 660,
    });
    // available = max(220, 660 - 400 - 16) = 244; titleWidth = min(200, floor(244 * 0.45) = 109)
    expect(metrics).toEqual({
      key: 'narrow',
      titleWidth: 109,
      cardWidth: 244,
      height: 34,
    });
  });

  it('expands horizontal bounds of a target rect to enclose callout rects with 8px margin', () => {
    expect(
      expandTargetRectForCallouts({ top: 0, left: 320, width: 48, height: 800 }, [
        { top: 20, left: 380, width: 220, height: 36 },
        { top: 68, left: 380, width: 260, height: 36 },
      ]),
    ).toEqual({
      top: 0,
      left: 320,
      width: 328,
      height: 800,
    });
  });
});

describe('resize handle indicator layout', () => {
  it('determines indicator side from panel center or viewport fallback', () => {
    expect(resolveResizeHandleSide(380, { top: 0, left: 0, width: 380, height: 900 }, 1440)).toBe(
      'right',
    );
    expect(
      resolveResizeHandleSide(1060, { top: 0, left: 1060, width: 380, height: 900 }, 1440),
    ).toBe('left');
    expect(resolveResizeHandleSide(300, null, 1440)).toBe('right');
    expect(resolveResizeHandleSide(1100, null, 1440)).toBe('left');
  });

  it('places anchorY above the bubble when room exists, otherwise below, otherwise fallback', () => {
    const handleRect = { top: 0, left: 377, width: 6, height: 900 };
    expect(computeResizeAnchorY(handleRect, { top: 300, height: 220 }, 900)).toBe(264);
    expect(computeResizeAnchorY(handleRect, { top: 20, height: 220 }, 900)).toBe(276);
    expect(computeResizeAnchorY(handleRect, null, 900)).toBe(225);
  });

  it('builds left-sided and right-sided resize indicators', () => {
    const rightIndicator = buildResizeIndicator(
      { rect: { top: 0, left: 377, width: 6, height: 900 }, centerX: 380, side: 'right' },
      null,
      { width: 1440, height: 900 },
    );
    expect(rightIndicator).toEqual({
      top: 0,
      left: 377,
      width: 6,
      height: 900,
      centerX: 380,
      anchorY: 225,
      side: 'right',
      calloutLeft: 400,
    });

    const leftIndicator = buildResizeIndicator(
      { rect: { top: 0, left: 1057, width: 6, height: 900 }, centerX: 1060, side: 'left' },
      null,
      { width: 1440, height: 900 },
    );
    expect(leftIndicator).toEqual({
      top: 0,
      left: 1057,
      width: 6,
      height: 900,
      centerX: 1060,
      anchorY: 225,
      side: 'left',
      calloutRight: 400,
    });
  });
});

describe('interactive cutout & page blocker clip-path', () => {
  it('returns full-height edge track cutout when expand handle is visible in collapse step', () => {
    expect(
      computeInteractiveCutout({
        stepId: 'collapse',
        expandRect: { top: 100, left: 0, width: 42, height: 34 },
        collapseRect: null,
        wrapperRect: null,
        viewportHeight: 900,
      }),
    ).toEqual({
      top: 0,
      left: 0,
      width: 50,
      height: 900,
    });
  });

  it('pads collapse button in collapse step and wrapper in appearance step', () => {
    expect(
      computeInteractiveCutout({
        stepId: 'collapse',
        expandRect: null,
        collapseRect: { top: 100, left: 340, width: 28, height: 28 },
        wrapperRect: null,
        viewportHeight: 900,
      }),
    ).toEqual({
      top: 96,
      left: 336,
      width: 36,
      height: 36,
    });

    expect(
      computeInteractiveCutout({
        stepId: 'appearance',
        expandRect: null,
        collapseRect: null,
        wrapperRect: { top: 0, left: 0, width: 380, height: 900 },
        viewportHeight: 900,
      }),
    ).toEqual({
      top: -10,
      left: -10,
      width: 400,
      height: 920,
    });
  });

  it('builds evenodd polygon clip-path and returns null for empty cutout', () => {
    expect(buildPageBlockerClipPath(null, { width: 1000, height: 800 })).toBeNull();
    expect(
      buildPageBlockerClipPath(
        { top: 10, left: 20, width: 100, height: 50 },
        { width: 1000, height: 800 },
      ),
    ).toBe(
      'polygon(evenodd, 0px 0px, 1000px 0px, 1000px 800px, 0px 800px, 0px 0px, 20px 10px, 20px 60px, 120px 60px, 120px 10px, 20px 10px)',
    );
  });
});

describe('affix-demo & collapse-demo bubble placement helpers', () => {
  it('places affix-demo bubble inside the right whitespace area of the spotlight clamped to viewport', () => {
    expect(
      placeAffixDemoBubble(
        { top: 50, left: 60, width: 1100, height: 700 },
        { width: 340, height: 200 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      top: 275,
      left: 800,
      placement: 'right',
    });
  });

  it('keeps collapse-demo bubble steady while demo is active and bubble does not overlap ring', () => {
    expect(
      shouldKeepCollapseDemoBubblePosition({
        stepId: 'collapse',
        currentBubblePosition: { top: 200, left: 500, placement: 'right' },
        bubbleSize: { width: 300, height: 180 },
        nextRing: { top: 100, left: 0, width: 60, height: 40 },
        isDemoActive: true,
      }),
    ).toBe(true);

    expect(
      shouldKeepCollapseDemoBubblePosition({
        stepId: 'collapse',
        currentBubblePosition: { top: 100, left: 40, placement: 'right' },
        bubbleSize: { width: 300, height: 180 },
        nextRing: { top: 100, left: 0, width: 60, height: 40 },
        isDemoActive: true,
      }),
    ).toBe(false);

    expect(
      shouldKeepCollapseDemoBubblePosition({
        stepId: 'collapse',
        currentBubblePosition: { top: 200, left: 500, placement: 'right' },
        bubbleSize: { width: 300, height: 180 },
        nextRing: null,
        isDemoActive: false,
      }),
    ).toBe(false);
  });
});

describe('equality & overlap predicates', () => {
  it('compares rects, overlap, callouts, and resize indicators accurately', () => {
    const a = { top: 10, left: 20, width: 100, height: 50 };
    const b = { top: 10, left: 20, width: 100, height: 50 };
    const c = { top: 60, left: 20, width: 100, height: 50 };
    expect(sameGuideRect(a, b)).toBe(true);
    expect(sameGuideRect(a, null)).toBe(false);
    expect(sameGuideRect(null, null)).toBe(true);
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(a, c)).toBe(false);

    const ind = buildResizeIndicator(
      { rect: { top: 0, left: 377, width: 6, height: 900 }, centerX: 380, side: 'right' },
      null,
      { width: 1440, height: 900 },
    );
    expect(sameResizeIndicator(ind, { ...ind })).toBe(true);
    expect(sameResizeIndicator(ind, { ...ind, anchorY: 100 })).toBe(false);

    const list = buildSidebarCallouts(
      { top: 0, left: 320, width: 48, height: 800 },
      [{ spec: SIDEBAR_CALLOUT_SPECS[0]!, rect: { top: 20, left: 326, width: 36, height: 36 } }],
      1440,
    );
    expect(sameSidebarCallouts(list, [...list])).toBe(true);
    expect(sameSidebarCallouts(list, [])).toBe(false);
  });
});
