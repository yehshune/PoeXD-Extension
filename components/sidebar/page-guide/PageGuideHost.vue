<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { t, type I18nKey } from '@/utils/i18n';
import { affixDemoMode } from '@/utils/page-guide-demo-state';
import { MousePointer2 } from '@lucide/vue';
import PageGuideOfficialResult from './PageGuideOfficialResult.vue';
import PageGuideSetupControls from './PageGuideSetupControls.vue';
import type { PageGuideSetupBindings } from './page-guide-setup';
import {
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
const interactiveCutout = shallowRef<GuideRect | null>(null);
const ringTransitioning = ref(false);
let ringTransitionTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;

const mode = computed(() => guide.state.mode);
const step = computed(() => guide.currentStep.value);
const isTour = computed(() => mode.value === 'tour');
const isLastStep = computed(() => guide.stepNumber.value >= guide.stepCount.value);
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

function sameRect(a: GuideRect | null, b: GuideRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
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
  const root = anchor.value?.getRootNode();
  const sidebarRoot = root instanceof ShadowRoot ? root : document;
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
  const root = anchor.value?.getRootNode();
  const sidebarRoot = root instanceof ShadowRoot ? root : document;
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

function measure() {
  guide.refreshElement();
  const rects = activeRingElements.value
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const union = unionGuideRects(rects);
  const next = union ? padGuideRect(union, RING_PADDING) : null;
  if (!sameRect(next, ringRect.value)) ringRect.value = next;
  const frameEl =
    guide.demoSpotlightElement.value ??
    (guide.state.demoFocus ? document.querySelector('[data-page-guide-mock-frame]') : null);
  const spotlight = frameEl ? padGuideRect(frameEl.getBoundingClientRect(), RING_PADDING) : null;
  if (!sameRect(spotlight, spotlightRect.value)) spotlightRect.value = spotlight;
  const nextCallouts = measureSidebarCallouts();
  if (!sameCallouts(nextCallouts, sidebarCallouts.value)) sidebarCallouts.value = nextCallouts;
  const nextCutout = measureInteractiveCutout();
  if (!sameRect(nextCutout, interactiveCutout.value)) interactiveCutout.value = nextCutout;
  const box = bubble.value;
  if (box) {
    let position: GuideBubblePosition;
    if (affixDemoMode.value) {
      position = {
        top: Math.max(8, window.innerHeight - box.offsetHeight - 20),
        left: Math.max(8, window.innerWidth - box.offsetWidth - 20),
        placement: 'bottom',
      };
    } else {
      const bubbleTarget = expandTargetForCallouts(spotlight ?? next, nextCallouts);
      position = placeGuideBubble(
        bubbleTarget,
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
    }
    const current = bubblePosition.value;
    if (!current || current.top !== position.top || current.left !== position.left) {
      bubblePosition.value = position;
    }
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
    const hasOpenSelect = Boolean(
      portalRoot.querySelector('[data-slot="select-content"][data-state="open"]') ||
      (sidebarRoot instanceof ShadowRoot &&
        sidebarRoot.querySelector('[data-slot="select-content"][data-state="open"]')),
    );
    if (hasOpenSelect) return;
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

      <!-- 第 4 步：側邊欄各功能圖示旁就地標註 -->
      <div
        v-for="callout in sidebarCallouts"
        :key="callout.id"
        data-page-guide-callout
        :data-callout-id="callout.id"
        class="pointer-events-none fixed z-(--pxd-z-guide-overlay) flex -translate-y-1/2 items-center gap-[var(--pxd-space-sm)] whitespace-nowrap rounded-md border border-border bg-popover/95 px-[var(--pxd-space-md)] py-1.5 text-[length:var(--pxd-font-secondary)] text-popover-foreground shadow-md"
        :style="{
          top: `${callout.top}px`,
          ...(callout.left !== undefined ? { left: `${callout.left}px` } : {}),
          ...(callout.right !== undefined ? { right: `${callout.right}px` } : {}),
        }"
      >
        <span class="font-semibold text-foreground">{{ t(callout.titleKey) }}</span>
        <span class="text-muted-foreground">{{ t(callout.descKey) }}</span>
      </div>

      <section
        v-if="isTour && step"
        ref="bubble"
        data-page-guide-bubble
        role="dialog"
        aria-modal="true"
        :aria-label="t('pageGuide.nav.aria')"
        class="fixed z-(--pxd-z-guide-overlay) flex flex-col gap-[var(--pxd-space-md)] rounded-md border border-border bg-popover p-[var(--pxd-pane-padding)] text-popover-foreground shadow-lg w-[min(360px,calc(100vw-16px))]"
        :style="bubbleStyle"
      >
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
