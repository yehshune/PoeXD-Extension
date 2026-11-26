<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import { MousePointer2, MoveHorizontal, X } from '@lucide/vue';
import PageGuideOfficialResult from './PageGuideOfficialResult.vue';
import PageGuideSetupControls from './PageGuideSetupControls.vue';
import {
  clampGuideRectToViewport,
  padGuideRect,
  placeGuideBubble,
  unionGuideRects,
  type GuideBubblePosition,
  type GuideRect,
} from './page-guide-geometry';
import {
  SIDEBAR_CALLOUT_SPECS,
  buildPageBlockerClipPath,
  buildResizeIndicator,
  buildSidebarCallouts,
  computeInteractiveCutout,
  computeSidebarCalloutMetrics,
  expandTargetRectForCallouts,
  placeAffixDemoBubble,
  resolveResizeHandleSide,
  sameGuideRect,
  sameResizeIndicator,
  sameSidebarCallouts,
  shouldKeepCollapseDemoBubblePosition,
  type ResizeHandleGeometry,
  type ResizeHandleIndicator,
  type SidebarCallout,
  type SidebarCalloutMetrics,
} from './page-guide-layout';
import { usePageGuide, type PageGuideSession } from './usePageGuide';

const props = defineProps<{
  /** 側欄 shadow root 內的 portal；內容區有 container 查詢會困住 fixed 定位 */
  portalTarget: HTMLElement | null;
  /** 測試可注入隔離的 PageGuideSession；正式環境預設使用共用單例 */
  guide?: PageGuideSession;
}>();

const RING_PADDING = 6;
const RING_TRANSITION_MS = 220;

const guide = props.guide ?? usePageGuide();
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
const isPreview = computed(() => mode.value === 'preview');
const isLastStep = computed(() => guide.stepNumber.value >= guide.stepCount.value);
const progressPercent = computed(() => {
  const total = guide.stepCount.value;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (guide.stepNumber.value / total) * 100));
});
/** 需要使用者直接操作側欄的步驟不放擋點擊的遮罩，只用外框陰影把其他地方變暗 */
const isInteractive = computed(() => isTour.value && step.value?.interactive === true);
const showReload = computed(() => isTour.value && isLastStep.value && guide.setup.reloadRequired);
const demoCursor = computed(() => (isTour.value ? guide.setup.demoCursor : null));
const activeRingElements = computed<readonly Element[]>(() => {
  if (guide.demoRingElements.value.length > 0) return guide.demoRingElements.value;
  return guide.element.value ? [guide.element.value] : [];
});
const resultBilingualPreview = computed(() =>
  Boolean(guide.setup.marketTranslation && guide.setup.marketTranslationResultBilingual),
);

function getSidebarRoot(): ParentNode {
  const root = anchor.value?.getRootNode();
  return root instanceof ShadowRoot ? root : document;
}

function readRect(el: Element | null): GuideRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function measureSidebarCallouts(): SidebarCallout[] {
  if (!isTour.value || step.value?.id !== 'sidebar') return [];
  const nav = getSidebarRoot().querySelector('.sidebar-nav');
  const navRect = readRect(nav);
  if (!nav || !navRect) return [];
  const items = SIDEBAR_CALLOUT_SPECS.flatMap((spec) => {
    const rect = readRect(nav.querySelector<HTMLElement>(spec.selector));
    return rect ? [{ spec, rect }] : [];
  });
  return buildSidebarCallouts(navRect, items, window.innerWidth);
}

function expandTargetForCallouts(
  target: GuideRect | null,
  callouts: readonly SidebarCallout[],
): GuideRect | null {
  if (!target || callouts.length === 0) return target;
  const container = props.portalTarget ?? document;
  const rects = Array.from(
    container.querySelectorAll<HTMLElement>('[data-page-guide-callout]'),
  ).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
  return expandTargetRectForCallouts(target, rects);
}

function measureInteractiveCutout(): GuideRect | null {
  if (!isTour.value || !isInteractive.value) return null;
  const sidebarRoot = getSidebarRoot();
  return computeInteractiveCutout({
    stepId: step.value?.id,
    expandRect: readRect(sidebarRoot.querySelector<HTMLElement>('[data-sidebar-action="expand"]')),
    collapseRect: readRect(
      sidebarRoot.querySelector<HTMLElement>('[data-sidebar-action="collapse"]'),
    ),
    wrapperRect: readRect(sidebarRoot.querySelector<HTMLElement>('.pxd-sidebar-wrapper')),
    viewportHeight: window.innerHeight,
  });
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
    guide.setup.fontSizeScale,
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
  const metrics = computeSidebarCalloutMetrics({
    layoutKey,
    titleWidths,
    descWidths,
    firstCardWidth: cards[0]!.getBoundingClientRect().width,
    cardHeights: cards.map((card) => card.getBoundingClientRect().height),
    edgeOffset: first.side === 'right' ? (first.left ?? 0) : (first.right ?? 0),
    viewportWidth: window.innerWidth,
  });
  if (metrics) calloutMetrics.value = metrics;
}

function findResizeHandle(): ResizeHandleGeometry | null {
  if (!isTour.value || step.value?.id !== 'appearance') return null;
  const sidebarRoot = getSidebarRoot();
  const rect = readRect(sidebarRoot.querySelector<HTMLElement>('.sidebar-resize-handle'));
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const centerX = rect.left + rect.width / 2;
  const panelRect = readRect(sidebarRoot.querySelector<HTMLElement>('.sidebar-container'));
  return {
    rect,
    centerX,
    side: resolveResizeHandleSide(centerX, panelRect, window.innerWidth),
  };
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
  if (!sameGuideRect(nextRing, ringRect.value)) ringRect.value = nextRing;
  const frameEl =
    guide.demoSpotlightElement.value ??
    (guide.state.demoFocus ? document.querySelector('[data-page-guide-mock-frame]') : null);
  const spotlight = resizeHandle
    ? paddedTarget
    : frameEl
      ? padGuideRect(frameEl.getBoundingClientRect(), RING_PADDING)
      : null;
  if (!sameGuideRect(spotlight, spotlightRect.value)) spotlightRect.value = spotlight;
  const nextCallouts = measureSidebarCallouts();
  if (!sameSidebarCallouts(nextCallouts, sidebarCallouts.value)) {
    sidebarCallouts.value = nextCallouts;
  }
  syncSidebarCalloutMetrics(nextCallouts);
  const nextCutout = measureInteractiveCutout();
  if (!sameGuideRect(nextCutout, interactiveCutout.value)) interactiveCutout.value = nextCutout;
  const box = bubble.value;
  let nextBubblePosition: GuideBubblePosition | null = null;
  if (box) {
    const bubbleSize = { width: box.offsetWidth, height: box.offsetHeight };
    if (guide.demoState.affixMode) {
      nextBubblePosition = placeAffixDemoBubble(spotlight, bubbleSize, viewport);
    } else if (
      shouldKeepCollapseDemoBubblePosition({
        stepId: step.value?.id,
        currentBubblePosition: bubblePosition.value,
        bubbleSize,
        nextRing,
        isDemoActive: guide.setup.demoPlaying || guide.setup.demoCursor !== null,
      })
    ) {
      // 收合示範播放中保持說明框穩定不跳動（只要不擋到目前高亮目標）
      nextBubblePosition = bubblePosition.value;
    } else {
      const bubbleTarget = expandTargetForCallouts(spotlight ?? nextRing, nextCallouts);
      nextBubblePosition = placeGuideBubble(bubbleTarget, bubbleSize, viewport);
    }
    const current = bubblePosition.value;
    if (
      nextBubblePosition &&
      (!current ||
        current.top !== nextBubblePosition.top ||
        current.left !== nextBubblePosition.left)
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
        viewport,
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
  window.addEventListener('keydown', handleKeydown, true);
});

onBeforeUnmount(() => {
  stopTracking();
  clearTimeout(ringTransitionTimer);
  window.removeEventListener('keydown', handleKeydown, true);
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
  const clipPath = buildPageBlockerClipPath(interactiveCutout.value, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return clipPath ? { clipPath } : { pointerEvents: 'none' as const };
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

const previewBarStyle = computed(() => {
  const rect = spotlightRect.value;
  if (!rect) return undefined;
  return {
    top: `${Math.max(8, rect.top - 42)}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
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
          v-if="step.setup"
          :guide="guide"
          :kind="step.setup"
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
            @click="guide.reload()"
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

      <!-- 設定頁借用官方示意結果列時的輕量頂部預覽列：不遮罩頁面、可隨時關閉 -->
      <div
        v-if="isPreview && previewBarStyle"
        data-page-guide-preview-bar
        class="fixed z-(--pxd-z-guide-overlay) flex items-center justify-between gap-[var(--pxd-space-sm)] rounded-sm border border-border/80 bg-popover/95 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] shadow-md"
        :style="previewBarStyle"
      >
        <span class="text-[length:var(--pxd-font-caption)] font-medium text-popover-foreground">
          {{ t('pageGuide.preview.badge') }}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-page-guide-preview-close
          @click="guide.closeResultPreview()"
        >
          <X />
          {{ t('pageGuide.preview.close') }}
        </Button>
      </div>

      <div
        v-else-if="!isTour && !isPreview && guide.state.label"
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
    v-if="guide.state.demoFocus"
    :features="guide.setup.resultFeatures"
    :result-bilingual="resultBilingualPreview"
    :highlight-style="guide.setup.resultModHighlightStyle"
    :highlight-color="guide.setup.resultModHighlightColor"
  />
</template>
