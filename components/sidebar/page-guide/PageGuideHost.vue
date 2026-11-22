<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { t, type I18nKey } from '@/utils/i18n';
import { affixDemoMode } from '@/utils/page-guide-demo-state';
import { MousePointer2, MoveHorizontal, X } from '@lucide/vue';
import PageGuideOfficialResult from './PageGuideOfficialResult.vue';
import PageGuideSetupControls from './PageGuideSetupControls.vue';
import type { PageGuideSetupBindings } from './page-guide-setup';
import {
  clampGuideRectToViewport,
  padGuideRect,
  placeGuideBubble,
  unionGuideRects,
  type GuideBubblePosition,
  type GuideRect,
} from './page-guide-geometry';
import { usePageGuide } from './usePageGuide';

const props = defineProps<{
  /** 側欄 shadow root 內的 portal；內容區有 container 查詢會困住 fixed 定位 */
  portalTarget: HTMLElement | null;
  /** 導覽前段的基礎設定步驟需要側欄的目前值；沒有提供時設定步驟只顯示說明 */
  setup?: PageGuideSetupBindings | null;
}>();

interface SidebarCallout {
  id: string;
  top: number;
  left?: number;
  right?: number;
  side: 'left' | 'right';
  titleKey: I18nKey;
  descKey: I18nKey;
}

interface SidebarCalloutMetrics {
  key: string;
  titleWidth: number;
  cardWidth: number;
  height: number;
}

interface ResizeHandleIndicator {
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

const SIDEBAR_CALLOUT_SPECS: readonly {
  id: string;
  selector: string;
  titleKey: I18nKey;
  descKey: I18nKey;
}[] = [
  {
    id: 'bookmark',
    selector: '[data-sidebar-tab="bookmark"]',
    titleKey: 'sidebar.nav.bookmarks',
    descKey: 'pageGuide.tour.sidebar.item.bookmark',
  },
  {
    id: 'history',
    selector: '[data-sidebar-tab="history"]',
    titleKey: 'sidebar.nav.history',
    descKey: 'pageGuide.tour.sidebar.item.history',
  },
  {
    id: 'stat-group-template',
    selector: '[data-sidebar-tab="stat-group-template"]',
    titleKey: 'sidebar.nav.statGroupTemplates',
    descKey: 'pageGuide.tour.sidebar.item.statGroupTemplate',
  },
  {
    id: 'pob-build',
    selector: '[data-sidebar-tab="pob-build"]',
    titleKey: 'sidebar.nav.pobBuild',
    descKey: 'pageGuide.tour.sidebar.item.pobBuild',
  },
  {
    id: 'pinned-items',
    selector: '[data-sidebar-tab="pinned-items"]',
    titleKey: 'sidebar.nav.pinnedItems',
    descKey: 'pageGuide.tour.sidebar.item.pinnedItems',
  },
  {
    id: 'result-board',
    selector: '[data-sidebar-tab="result-board"]',
    titleKey: 'sidebar.nav.resultBoard',
    descKey: 'pageGuide.tour.sidebar.item.resultBoard',
  },
  {
    id: 'live-search',
    selector: '[data-sidebar-action="open-live-search"]',
    titleKey: 'sidebar.nav.openLiveSearch',
    descKey: 'pageGuide.tour.sidebar.item.liveSearch',
  },
  {
    id: 'tools',
    selector: '[data-sidebar-tab="tools"]',
    titleKey: 'sidebar.nav.tools',
    descKey: 'pageGuide.tour.sidebar.item.tools',
  },
  {
    id: 'settings',
    selector: '[data-sidebar-tab="settings"]',
    titleKey: 'sidebar.nav.settings',
    descKey: 'pageGuide.tour.sidebar.item.settings',
  },
];

const RING_PADDING = 6;
const RING_TRANSITION_MS = 220;

const guide = usePageGuide();
const anchor = ref<HTMLElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
const primaryButton = ref<InstanceType<typeof Button> | null>(null);
const ringRect = shallowRef<GuideRect | null>(null);
/** 結果或詞綴面板示範：整個示意區保持明亮，外框只標出要介紹的部分 */
const spotlightRect = shallowRef<GuideRect | null>(null);
const bubblePosition = shallowRef<GuideBubblePosition | null>(null);
const sidebarCallouts = shallowRef<SidebarCallout[]>([]);
const calloutMetrics = ref<SidebarCalloutMetrics | null>(null);
const resizeIndicator = shallowRef<ResizeHandleIndicator | null>(null);
const interactiveCutout = shallowRef<GuideRect | null>(null);
const ringTransitioning = ref(false);
let ringTransitionTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;

const mode = computed(() => guide.state.mode);
const step = computed(() => guide.currentStep.value);
const isTour = computed(() => mode.value === 'tour');
const isLastStep = computed(() => guide.stepNumber.value >= guide.stepCount.value);
const progressPercent = computed(() => {
  const total = guide.stepCount.value;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (guide.stepNumber.value / total) * 100));
});
/** 需要使用者直接操作側欄的步驟不放擋點擊的遮罩，只用外框陰影把其他地方變暗 */
const isInteractive = computed(() => isTour.value && step.value?.interactive === true);
const showReload = computed(() => isTour.value && isLastStep.value && props.setup?.reloadRequired);
const demoCursor = computed(() => (isTour.value ? (props.setup?.demoCursor ?? null) : null));
const activeRingElements = computed<readonly Element[]>(() => {
  if (guide.demoRingElements.value.length > 0) return guide.demoRingElements.value;
  return guide.element.value ? [guide.element.value] : [];
});
const resultBilingualPreview = computed(() =>
  Boolean(props.setup?.marketTranslation && props.setup?.marketTranslationResultBilingual),
);

function getSidebarRoot(): ParentNode {
  const root = anchor.value?.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}

function sameRect(a: GuideRect | null, b: GuideRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function sameResizeIndicator(
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

function sameCallouts(a: readonly SidebarCallout[], b: readonly SidebarCallout[]): boolean {
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

function measureSidebarCallouts(): SidebarCallout[] {
  if (!isTour.value || step.value?.id !== 'sidebar') return [];
  const sidebarRoot = getSidebarRoot();
  const nav = sidebarRoot.querySelector('.sidebar-nav');
  if (!nav) return [];
  const navRect = nav.getBoundingClientRect();
  if (navRect.width <= 0 || navRect.height <= 0) return [];
  const side: 'left' | 'right' =
    navRect.left + navRect.width / 2 < window.innerWidth / 2 ? 'right' : 'left';
  const result: SidebarCallout[] = [];
  for (const spec of SIDEBAR_CALLOUT_SPECS) {
    const btn = nav.querySelector<HTMLElement>(spec.selector);
    if (!btn) continue;
    const rect = btn.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const top = Math.round(rect.top + rect.height / 2);
    if (side === 'right') {
      result.push({
        id: spec.id,
        top,
        left: Math.round(navRect.right + 12),
        side,
        titleKey: spec.titleKey,
        descKey: spec.descKey,
      });
    } else {
      result.push({
        id: spec.id,
        top,
        right: Math.round(window.innerWidth - navRect.left + 12),
        side,
        titleKey: spec.titleKey,
        descKey: spec.descKey,
      });
    }
  }
  return result;
}

function expandTargetForCallouts(
  target: GuideRect | null,
  callouts: readonly SidebarCallout[],
): GuideRect | null {
  if (!target || callouts.length === 0) return target;
  const container = props.portalTarget ?? document;
  const els = Array.from(container.querySelectorAll<HTMLElement>('[data-page-guide-callout]'));
  if (els.length === 0) return target;
  let minLeft = target.left;
  let maxRight = target.left + target.width;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) continue;
    minLeft = Math.min(minLeft, rect.left - 8);
    maxRight = Math.max(maxRight, rect.right + 8);
  }
  return {
    top: target.top,
    left: minLeft,
    width: maxRight - minLeft,
    height: target.height,
  };
}

function measureInteractiveCutout(): GuideRect | null {
  if (!isTour.value || !isInteractive.value) return null;
  const sidebarRoot = getSidebarRoot();
  const id = step.value?.id;
  if (id === 'collapse') {
    const expandBtn = sidebarRoot.querySelector<HTMLElement>('[data-sidebar-action="expand"]');
    if (expandBtn) {
      const rect = expandBtn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // 收合後允許沿著整條邊緣上下拖曳位置
        return {
          top: 0,
          left: Math.max(0, rect.left - 4),
          width: rect.width + 8,
          height: window.innerHeight,
        };
      }
    }
    const collapseBtn = sidebarRoot.querySelector<HTMLElement>('[data-sidebar-action="collapse"]');
    if (collapseBtn) {
      const rect = collapseBtn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return padGuideRect(
          { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          4,
        );
      }
    }
    return null;
  }
  if (id === 'appearance') {
    const wrapper = sidebarRoot.querySelector<HTMLElement>('.pxd-sidebar-wrapper');
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return padGuideRect(
          { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          10,
        );
      }
    }
  }
  return null;
}

function syncSidebarCalloutMetrics(callouts: readonly SidebarCallout[]) {
  if (callouts.length === 0) {
    if (calloutMetrics.value) calloutMetrics.value = null;
    return;
  }
  const first = callouts[0]!;
  const layoutKey = [
    t(first.titleKey),
    callouts.map((c) => c.id).join(','),
    props.setup?.fontSizeScale ?? 1,
    window.innerWidth,
    first.side,
  ].join('|');
  if (calloutMetrics.value) {
    if (calloutMetrics.value.key !== layoutKey) {
      calloutMetrics.value = null;
    }
    return;
  }
  const container = props.portalTarget ?? document;
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-page-guide-callout]'));
  if (cards.length !== callouts.length) return;
  const titleWidths = cards.map(
    (card) =>
      card.querySelector<HTMLElement>('[data-callout-title]')?.getBoundingClientRect().width ?? 0,
  );
  const descWidths = cards.map(
    (card) =>
      card.querySelector<HTMLElement>('[data-callout-desc]')?.getBoundingClientRect().width ?? 0,
  );
  const maxTitle = Math.ceil(Math.max(0, ...titleWidths));
  const maxDesc = Math.ceil(Math.max(0, ...descWidths));
  if (maxTitle <= 0 || maxDesc <= 0) return;

  const firstCardWidth = cards[0]!.getBoundingClientRect().width;
  const chrome = Math.max(0, Math.ceil(firstCardWidth - titleWidths[0]! - descWidths[0]!));
  const edgeOffset = first.side === 'right' ? (first.left ?? 0) : (first.right ?? 0);
  const available = Math.max(220, window.innerWidth - edgeOffset - 16);
  const cardWidth = Math.min(maxTitle + maxDesc + chrome + 2, available);
  const titleWidth = Math.min(maxTitle, Math.floor(cardWidth * 0.45));
  const height = Math.ceil(
    Math.max(34, ...cards.map((card) => card.getBoundingClientRect().height)),
  );

  calloutMetrics.value = { key: layoutKey, titleWidth, cardWidth, height };
}

function findResizeHandle(): {
  rect: GuideRect;
  centerX: number;
  side: 'left' | 'right';
} | null {
  if (!isTour.value || step.value?.id !== 'appearance') return null;
  const sidebarRoot = getSidebarRoot();
  const handle = sidebarRoot.querySelector<HTMLElement>('.sidebar-resize-handle');
  if (!handle) return null;
  const rect = handle.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const centerX = rect.left + rect.width / 2;
  const panel = sidebarRoot.querySelector<HTMLElement>('.sidebar-container');
  const panelRect = panel?.getBoundingClientRect();
  const side: 'left' | 'right' =
    panelRect && panelRect.width > 0
      ? centerX < panelRect.left + panelRect.width / 2
        ? 'left'
        : 'right'
      : centerX < window.innerWidth / 2
        ? 'right'
        : 'left';
  return {
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    centerX,
    side,
  };
}

function computeResizeAnchorY(
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

function buildResizeIndicator(
  handle: { rect: GuideRect; centerX: number; side: 'left' | 'right' },
  bubbleRect: { top: number; height: number } | null,
): ResizeHandleIndicator {
  const anchorY = computeResizeAnchorY(handle.rect, bubbleRect, window.innerHeight);
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
      : { calloutRight: Math.round(window.innerWidth - centerX + 20) }),
  };
}

function rectsOverlap(a: GuideRect, b: GuideRect): boolean {
  return !(
    a.left + a.width <= b.left ||
    a.left >= b.left + b.width ||
    a.top + a.height <= b.top ||
    a.top >= b.top + b.height
  );
}

function measure() {
  guide.refreshElement();
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const rects = activeRingElements.value
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const union = unionGuideRects(rects);
  const paddedTarget = union
    ? clampGuideRectToViewport(padGuideRect(union, RING_PADDING), viewport)
    : null;
  const resizeHandle = findResizeHandle();
  // 外觀步驟直接改以拖曳把手高亮取代整面側欄外框，避免雙重垂直線條
  const nextRing = resizeHandle ? null : paddedTarget;
  if (!sameRect(nextRing, ringRect.value)) ringRect.value = nextRing;
  const frameEl =
    guide.demoSpotlightElement.value ??
    (guide.state.demoFocus ? document.querySelector('[data-page-guide-mock-frame]') : null);
  const spotlight = resizeHandle
    ? paddedTarget
    : frameEl
      ? padGuideRect(frameEl.getBoundingClientRect(), RING_PADDING)
      : null;
  if (!sameRect(spotlight, spotlightRect.value)) spotlightRect.value = spotlight;
  const nextCallouts = measureSidebarCallouts();
  if (!sameCallouts(nextCallouts, sidebarCallouts.value)) sidebarCallouts.value = nextCallouts;
  syncSidebarCalloutMetrics(nextCallouts);
  const nextCutout = measureInteractiveCutout();
  if (!sameRect(nextCutout, interactiveCutout.value)) interactiveCutout.value = nextCutout;
  const box = bubble.value;
  let nextBubblePosition: GuideBubblePosition | null = null;
  if (box) {
    const bubbleSize = { width: box.offsetWidth, height: box.offsetHeight };
    if (affixDemoMode.value) {
      // 置於右側「待套用清單」中段空白區，避免擋住底部的套用按鈕
      const rightEdge = spotlight ? spotlight.left + spotlight.width : viewport.width;
      const topAnchor = spotlight
        ? spotlight.top + Math.round((spotlight.height - bubbleSize.height) * 0.45)
        : Math.round((viewport.height - bubbleSize.height) * 0.45);
      nextBubblePosition = {
        top: Math.max(8, Math.min(topAnchor, viewport.height - bubbleSize.height - 8)),
        left: Math.max(
          8,
          Math.min(rightEdge - bubbleSize.width - 20, viewport.width - bubbleSize.width - 8),
        ),
        placement: 'right',
      };
    } else if (
      step.value?.id === 'collapse' &&
      bubblePosition.value &&
      (props.setup?.demoPlaying || props.setup?.demoCursor !== null) &&
      (!nextRing ||
        !rectsOverlap(
          {
            top: bubblePosition.value.top,
            left: bubblePosition.value.left,
            width: bubbleSize.width,
            height: bubbleSize.height,
          },
          nextRing,
        ))
    ) {
      // 收合示範播放中保持說明框穩定不跳動（只要不擋到目前高亮目標）
      nextBubblePosition = bubblePosition.value;
    } else {
      const bubbleTarget = expandTargetForCallouts(spotlight ?? nextRing, nextCallouts);
      nextBubblePosition = placeGuideBubble(bubbleTarget, bubbleSize, viewport);
    }
    const current = bubblePosition.value;
    if (
      !current ||
      current.top !== nextBubblePosition.top ||
      current.left !== nextBubblePosition.left
    ) {
      bubblePosition.value = nextBubblePosition;
    }
  }
  const nextResizeIndicator = resizeHandle
    ? buildResizeIndicator(
        resizeHandle,
        box && nextBubblePosition
          ? { top: nextBubblePosition.top, height: box.offsetHeight }
          : null,
      )
    : null;
  if (!sameResizeIndicator(nextResizeIndicator, resizeIndicator.value)) {
    resizeIndicator.value = nextResizeIndicator;
  }
}

/** 目標會跟著頁面捲動、官方重新渲染而移動，每個畫格重新量一次。 */
function track() {
  measure();
  frame = requestAnimationFrame(track);
}

function stopTracking() {
  cancelAnimationFrame(frame);
  frame = 0;
}

watch(
  mode,
  (value) => {
    if (value === 'idle') {
      stopTracking();
      clearTimeout(ringTransitionTimer);
      ringTransitioning.value = false;
      ringRect.value = null;
      spotlightRect.value = null;
      bubblePosition.value = null;
      sidebarCallouts.value = [];
      calloutMetrics.value = null;
      resizeIndicator.value = null;
      interactiveCutout.value = null;
    } else if (!frame) {
      frame = requestAnimationFrame(track);
    }
  },
  { immediate: true },
);

// 只在切換步驟或切換高亮目標時啟用外框補間，拖曳或捲動時零延遲緊貼目標
watch(
  [() => guide.state.stepId, activeRingElements],
  ([stepId, nextEls], [prevStepId, prevEls]) => {
    if (mode.value === 'idle' || nextEls.length === 0) return;
    if (prevEls.length === 0 && !ringRect.value) return;
    const sameEls =
      nextEls.length === prevEls.length && nextEls.every((el, idx) => el === prevEls[idx]);
    if (stepId === prevStepId && sameEls) return;
    ringTransitioning.value = true;
    clearTimeout(ringTransitionTimer);
    ringTransitionTimer = setTimeout(() => {
      ringTransitioning.value = false;
    }, RING_TRANSITION_MS);
  },
);

watch(
  () => [mode.value, guide.state.stepId] as const,
  async ([value]) => {
    if (value !== 'tour') return;
    await nextTick();
    const el = primaryButton.value?.$el as HTMLElement | undefined;
    el?.focus({ preventScroll: true });
  },
);

function isEditableTarget(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  const target = (path[0] ?? event.target) as EventTarget | null;
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

function handleKeydown(event: KeyboardEvent) {
  if (mode.value === 'idle') return;
  if (event.key === 'Escape') {
    const portalRoot = props.portalTarget ?? document;
    const sidebarRoot = anchor.value?.getRootNode();
    const floatingSelectors =
      '[data-slot="select-content"][data-state="open"], [data-slot="popover-content"][data-state="open"]';
    const hasOpenFloating = Boolean(
      portalRoot.querySelector(floatingSelectors) ||
      (sidebarRoot instanceof ShadowRoot && sidebarRoot.querySelector(floatingSelectors)),
    );
    if (hasOpenFloating) return;
    event.preventDefault();
    void guide.stop();
    return;
  }
  if (!isTour.value) return;
  if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event)) return;
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    void guide.nextStep();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    void guide.previousStep();
  }
}

onMounted(() => {
  const root = anchor.value?.getRootNode();
  guide.setSidebarRoot(root instanceof ShadowRoot ? root : document);
  window.addEventListener('keydown', handleKeydown, true);
});

onBeforeUnmount(() => {
  stopTracking();
  clearTimeout(ringTransitionTimer);
  window.removeEventListener('keydown', handleKeydown, true);
  guide.setSidebarRoot(null);
  void guide.stop();
});

const ringStyle = computed(() => {
  const rect = ringRect.value;
  if (!rect) return undefined;
  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
});

const spotlightStyle = computed(() => {
  const rect = spotlightRect.value;
  if (!rect) return undefined;
  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
});

const bubbleStyle = computed(() => {
  const position = bubblePosition.value;
  // 第一次量到尺寸前先藏起來，避免閃在左上角
  if (!position) return { top: '0px', left: '0px', visibility: 'hidden' as const };
  return { top: `${position.top}px`, left: `${position.left}px` };
});

const pageBlockerStyle = computed(() => {
  const cutout = interactiveCutout.value;
  if (!cutout) return { pointerEvents: 'none' as const };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const L = Math.max(0, cutout.left);
  const T = Math.max(0, cutout.top);
  const R = Math.min(vw, cutout.left + cutout.width);
  const B = Math.min(vh, cutout.top + cutout.height);
  if (R <= L || B <= T) return { pointerEvents: 'none' as const };
  return {
    clipPath: `polygon(evenodd, 0px 0px, ${vw}px 0px, ${vw}px ${vh}px, 0px ${vh}px, 0px 0px, ${L}px ${T}px, ${L}px ${B}px, ${R}px ${B}px, ${R}px ${T}px, ${L}px ${T}px)`,
  };
});

const calloutLayoutStyle = computed(() => {
  const m = calloutMetrics.value;
  if (!m) {
    return {
      gridTemplateColumns: 'auto 1px auto',
      minHeight: '34px',
    };
  }
  return {
    gridTemplateColumns: `${m.titleWidth}px 1px minmax(0, 1fr)`,
    width: `${m.cardWidth}px`,
    minHeight: `${m.height}px`,
  };
});
</script>

<template>
  <span ref="anchor" hidden />
  <Teleport :to="props.portalTarget" :disabled="!props.portalTarget">
    <template v-if="mode !== 'idle'">
      <!-- 導覽中擋住頁面與示範視窗點擊；沒有外框時整片變暗 -->
      <div
        v-if="isTour && !isInteractive"
        data-page-guide-blocker
        class="fixed inset-0 z-(--pxd-z-guide-blocker)"
        :class="ringRect || spotlightRect ? 'bg-transparent' : 'bg-black/65'"
      />
      <!-- 可互動步驟只挖空側邊欄目標區，擋住背後官方頁面物件的滑鼠 hover 與點擊 -->
      <div
        v-else-if="isTour && isInteractive"
        data-page-guide-page-blocker
        class="fixed inset-0 z-(--pxd-z-guide-blocker) bg-transparent"
        :style="pageBlockerStyle"
      />

      <div
        v-if="isTour && spotlightRect"
        data-page-guide-spotlight
        class="pointer-events-none fixed z-(--pxd-z-guide-ring) rounded-md shadow-[0_0_0_9999px_rgb(0_0_0/0.65)]"
        :style="spotlightStyle"
      />

      <div
        v-if="ringRect"
        data-page-guide-ring
        class="pointer-events-none fixed z-(--pxd-z-guide-ring) rounded-md border-2 border-primary"
        :class="[
          isTour && !spotlightRect ? 'shadow-[0_0_0_9999px_rgb(0_0_0/0.65)]' : '',
          ringTransitioning
            ? 'motion-safe:transition-[top,left,width,height] motion-safe:duration-200'
            : '',
        ]"
        :style="ringStyle"
      >
        <span
          v-if="!isTour"
          class="absolute inset-[-4px] rounded-[inherit] border-2 border-primary/50 motion-safe:animate-pulse"
        />
      </div>

      <!-- 第 3 步：標示可拖曳調整寬度的側欄內側邊緣 -->
      <template v-if="resizeIndicator">
        <div
          data-page-guide-resize-handle
          aria-hidden="true"
          class="pointer-events-none fixed z-(--pxd-z-guide-overlay)"
          :style="{
            top: `${resizeIndicator.top}px`,
            left: `${resizeIndicator.left}px`,
            width: `${resizeIndicator.width}px`,
            height: `${resizeIndicator.height}px`,
          }"
        >
          <span
            class="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-primary shadow-[0_0_12px_var(--primary)]"
          />
          <span
            class="absolute inset-y-0 left-1/2 w-[8px] -translate-x-1/2 bg-primary/25 motion-safe:animate-pulse"
          />
        </div>

        <div
          data-page-guide-resize-grip
          aria-hidden="true"
          class="pointer-events-none fixed z-(--pxd-z-guide-overlay) flex h-9 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary bg-popover text-primary shadow-md"
          :style="{
            top: `${resizeIndicator.anchorY}px`,
            left: `${resizeIndicator.centerX}px`,
          }"
        >
          <MoveHorizontal class="size-3.5" />
        </div>

        <div
          data-page-guide-resize-callout
          :data-callout-side="resizeIndicator.side"
          class="pointer-events-none fixed z-(--pxd-z-guide-overlay) flex -translate-y-1/2 items-center gap-[var(--pxd-space-sm)] rounded-md border border-primary/80 bg-popover/95 px-[var(--pxd-space-md)] py-1.5 text-[length:var(--pxd-font-secondary)] font-medium whitespace-nowrap text-popover-foreground shadow-md"
          :style="{
            top: `${resizeIndicator.anchorY}px`,
            ...(resizeIndicator.calloutLeft !== undefined
              ? { left: `${resizeIndicator.calloutLeft}px` }
              : {}),
            ...(resizeIndicator.calloutRight !== undefined
              ? { right: `${resizeIndicator.calloutRight}px` }
              : {}),
          }"
        >
          <span
            aria-hidden="true"
            class="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center"
            :class="
              resizeIndicator.side === 'right' ? '-left-3 flex-row' : '-right-3 flex-row-reverse'
            "
          >
            <span class="size-1.5 rounded-full bg-primary" />
            <span class="h-px w-1.5 bg-primary/70" />
          </span>
          <MoveHorizontal class="size-3.5 shrink-0 text-primary" />
          <span>{{ t('pageGuide.tour.appearance.resizeCallout') }}</span>
        </div>
      </template>

      <!-- 第 4 步：側邊欄各功能圖示旁就地標註 -->
      <div
        v-for="callout in sidebarCallouts"
        :key="callout.id"
        data-page-guide-callout
        :data-callout-id="callout.id"
        class="pointer-events-none fixed z-(--pxd-z-guide-overlay) grid -translate-y-1/2 items-center gap-x-[var(--pxd-space-md)] rounded-md border border-border/90 bg-popover/95 px-[var(--pxd-space-lg)] py-1.5 text-[length:var(--pxd-font-secondary)] leading-snug text-popover-foreground shadow-md"
        :style="{
          top: `${callout.top}px`,
          ...(callout.left !== undefined ? { left: `${callout.left}px` } : {}),
          ...(callout.right !== undefined ? { right: `${callout.right}px` } : {}),
          ...calloutLayoutStyle,
        }"
      >
        <span
          aria-hidden="true"
          class="pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center"
          :class="callout.side === 'right' ? '-left-3 flex-row' : '-right-3 flex-row-reverse'"
        >
          <span class="size-1.5 rounded-full bg-primary" />
          <span class="h-px w-1.5 bg-primary/70" />
        </span>
        <span data-callout-title class="whitespace-nowrap font-semibold text-foreground">
          {{ t(callout.titleKey) }}
        </span>
        <span class="h-3.5 w-px bg-border" aria-hidden="true" />
        <span data-callout-desc class="text-muted-foreground">
          {{ t(callout.descKey) }}
        </span>
      </div>

      <section
        v-if="isTour && step"
        ref="bubble"
        data-page-guide-bubble
        role="dialog"
        aria-modal="true"
        :aria-label="t('pageGuide.nav.aria')"
        class="fixed z-(--pxd-z-guide-overlay) flex flex-col gap-[var(--pxd-space-md)] overflow-hidden rounded-md border border-border bg-popover p-[var(--pxd-pane-padding)] text-popover-foreground shadow-lg w-[min(360px,calc(100vw-16px))]"
        :style="bubbleStyle"
      >
        <div
          data-page-guide-progress
          aria-hidden="true"
          class="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] bg-muted/60"
        >
          <div
            class="h-full bg-primary motion-safe:transition-[width] motion-safe:duration-200"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <h2 class="m-0 text-[length:var(--pxd-font-section-title)] font-bold leading-snug">
            {{ t(step.titleKey) }}
          </h2>
          <div class="flex shrink-0 items-center gap-[var(--pxd-space-sm)]">
            <span
              data-page-guide-shortcuts
              :title="t('pageGuide.nav.shortcutHint')"
              class="inline-flex items-center gap-1 text-[length:var(--pxd-font-caption)] text-muted-foreground/85"
            >
              <kbd
                class="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-muted/60 px-1 font-sans text-[length:var(--pxd-font-micro)] leading-none"
                aria-hidden="true"
              >
                ←
              </kbd>
              <kbd
                class="inline-flex h-4 min-w-4 items-center justify-center rounded border border-border/80 bg-muted/60 px-1 font-sans text-[length:var(--pxd-font-micro)] leading-none"
                aria-hidden="true"
              >
                →
              </kbd>
            </span>
            <span
              data-page-guide-counter
              class="text-[length:var(--pxd-font-secondary)] tabular-nums text-muted-foreground"
            >
              {{
                t('pageGuide.nav.counter', {
                  current: guide.stepNumber.value,
                  total: guide.stepCount.value,
                })
              }}
            </span>
            <button
              type="button"
              data-page-guide-action="close"
              :title="t('pageGuide.nav.close')"
              :aria-label="t('pageGuide.nav.close')"
              class="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @click="guide.stop()"
            >
              <X class="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p class="m-0 text-[length:var(--pxd-font-body)] leading-[1.6] text-muted-foreground">
          {{ t(step.bodyKey) }}
        </p>
        <PageGuideSetupControls
          v-if="step.setup && props.setup"
          :kind="step.setup"
          :bindings="props.setup"
          :step-id="step.id"
          :focus="step.demoFocus"
        />
        <div
          v-if="showReload"
          data-page-guide-reload
          class="flex items-center justify-between gap-[var(--pxd-space-sm)] rounded-sm bg-muted/50 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-muted-foreground"
        >
          <span>{{ t('common.reloadToApply') }}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-page-guide-action="reload"
            @click="props.setup?.reload()"
          >
            {{ t('common.reload') }}
          </Button>
        </div>
        <div class="mt-[var(--pxd-space-xs)] flex items-center gap-[var(--pxd-space-sm)]">
          <Button
            v-if="!isLastStep"
            type="button"
            variant="ghost"
            size="sm"
            data-page-guide-action="skip"
            class="mr-auto"
            @click="guide.stop()"
          >
            {{ t('pageGuide.nav.skip') }}
          </Button>
          <span v-else class="mr-auto" />
          <Button
            v-if="guide.stepNumber.value > 1"
            type="button"
            variant="outline"
            size="sm"
            data-page-guide-action="previous"
            @click="guide.previousStep()"
          >
            {{ t('pageGuide.nav.previous') }}
          </Button>
          <Button
            ref="primaryButton"
            type="button"
            size="sm"
            :data-page-guide-action="isLastStep ? 'done' : 'next'"
            @click="guide.nextStep()"
          >
            {{ isLastStep ? t('pageGuide.nav.done') : t('pageGuide.nav.next') }}
          </Button>
        </div>
      </section>

      <div
        v-else-if="!isTour && guide.state.label"
        ref="bubble"
        data-page-guide-label
        class="pointer-events-none fixed z-(--pxd-z-guide-overlay) max-w-[min(260px,calc(100vw-16px))] rounded-sm bg-primary px-[var(--pxd-space-sm)] py-[2px] text-[length:var(--pxd-font-caption)] font-medium text-primary-foreground shadow-md"
        :style="bubbleStyle"
      >
        {{ guide.state.label }}
      </div>

      <!-- 收合／詞綴／階級示範的模擬滑鼠：位置變化用 transition 補間，按下時縮小並出現點擊圈 -->
      <div
        v-if="demoCursor"
        data-page-guide-cursor
        :data-pressed="demoCursor.pressed ? 'true' : undefined"
        class="pointer-events-none fixed top-0 left-0 z-(--pxd-z-guide-overlay)"
        :class="
          demoCursor.pressed
            ? ''
            : 'motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-in-out'
        "
        :style="{ transform: `translate(${demoCursor.x}px, ${demoCursor.y}px)` }"
      >
        <span
          v-if="demoCursor.pressed"
          class="absolute -top-3 -left-3 size-6 rounded-full border-2 border-primary motion-safe:animate-ping"
        />
        <MousePointer2
          class="size-6 fill-foreground text-background drop-shadow-md motion-safe:transition-transform motion-safe:duration-150"
          :class="demoCursor.pressed ? 'scale-85' : ''"
        />
      </div>
    </template>
  </Teleport>

  <!-- 結果步驟的示意結果列：放在官方頁面裡，讓官方樣式套用 -->
  <PageGuideOfficialResult
    v-if="guide.state.demoFocus && props.setup"
    :features="props.setup.resultFeatures"
    :result-bilingual="resultBilingualPreview"
  />
</template>
