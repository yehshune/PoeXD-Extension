<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import PageGuideMockResult from './PageGuideMockResult.vue';
import {
  padGuideRect,
  placeGuideBubble,
  type GuideBubblePosition,
  type GuideRect,
} from './page-guide-geometry';
import { usePageGuide } from './usePageGuide';

const props = defineProps<{
  /** 側欄 shadow root 內的 portal；內容區有 container 查詢會困住 fixed 定位 */
  portalTarget: HTMLElement | null;
}>();

const RING_PADDING = 6;

const guide = usePageGuide();
const anchor = ref<HTMLElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
const primaryButton = ref<InstanceType<typeof Button> | null>(null);
const ringRect = shallowRef<GuideRect | null>(null);
const bubblePosition = shallowRef<GuideBubblePosition | null>(null);
let frame = 0;

const mode = computed(() => guide.state.mode);
const step = computed(() => guide.currentStep.value);
const isTour = computed(() => mode.value === 'tour');
const isLastStep = computed(() => guide.state.stepIndex >= guide.stepCount - 1);
const showMockCard = computed(
  () => isTour.value && !guide.element.value && step.value?.fallback === 'result-card',
);

function sameRect(a: GuideRect | null, b: GuideRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function measure() {
  const el = guide.element.value;
  const next = el ? padGuideRect(el.getBoundingClientRect(), RING_PADDING) : null;
  if (!sameRect(next, ringRect.value)) ringRect.value = next;
  const box = bubble.value;
  if (box) {
    const position = placeGuideBubble(
      next,
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
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
      ringRect.value = null;
      bubblePosition.value = null;
    } else if (!frame) {
      frame = requestAnimationFrame(track);
    }
  },
  { immediate: true },
);

watch(
  () => [mode.value, guide.state.stepIndex] as const,
  async ([value]) => {
    if (value !== 'tour') return;
    await nextTick();
    const el = primaryButton.value?.$el as HTMLElement | undefined;
    el?.focus({ preventScroll: true });
  },
);

function handleKeydown(event: KeyboardEvent) {
  if (mode.value === 'idle') return;
  if (event.key === 'Escape') {
    event.preventDefault();
    void guide.stop();
    return;
  }
  if (!isTour.value) return;
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

const bubbleStyle = computed(() => {
  const position = bubblePosition.value;
  // 第一次量到尺寸前先藏起來，避免閃在左上角
  if (!position) return { top: '0px', left: '0px', visibility: 'hidden' as const };
  return { top: `${position.top}px`, left: `${position.left}px` };
});
</script>

<template>
  <span ref="anchor" hidden />
  <Teleport :to="props.portalTarget" :disabled="!props.portalTarget">
    <template v-if="mode !== 'idle'">
      <!-- 導覽中擋住頁面點擊；沒有外框時整片變暗 -->
      <div
        v-if="isTour"
        data-page-guide-blocker
        class="fixed inset-0 z-(--pxd-z-dialog)"
        :class="ringRect ? 'bg-transparent' : 'bg-black/65'"
      />

      <div
        v-if="ringRect"
        data-page-guide-ring
        class="pointer-events-none fixed z-(--pxd-z-dialog) rounded-md border-2 border-primary motion-safe:transition-[top,left,width,height] motion-safe:duration-200"
        :class="isTour ? 'shadow-[0_0_0_9999px_rgb(0_0_0/0.65)]' : ''"
        :style="ringStyle"
      >
        <span
          v-if="!isTour"
          class="absolute inset-[-4px] rounded-[inherit] border-2 border-primary/50 motion-safe:animate-pulse"
        />
      </div>

      <section
        v-if="isTour && step"
        ref="bubble"
        data-page-guide-bubble
        role="dialog"
        aria-modal="true"
        :aria-label="t('pageGuide.nav.aria')"
        class="fixed z-(--pxd-z-dialog-nested) flex w-[min(300px,calc(100vw-16px))] flex-col gap-[var(--pxd-space-sm)] rounded-md border border-border bg-popover p-[var(--pxd-space-md)] text-popover-foreground shadow-lg"
        :style="bubbleStyle"
      >
        <div class="flex items-baseline justify-between gap-[var(--pxd-space-md)]">
          <h2 class="m-0 text-[length:var(--pxd-font-body)] font-bold leading-snug">
            {{ t(step.titleKey) }}
          </h2>
          <span
            data-page-guide-counter
            class="shrink-0 text-[length:var(--pxd-font-caption)] tabular-nums text-muted-foreground"
          >
            {{
              t('pageGuide.nav.counter', {
                current: guide.state.stepIndex + 1,
                total: guide.stepCount,
              })
            }}
          </span>
        </div>
        <p class="m-0 text-[length:var(--pxd-font-secondary)] leading-[1.55] text-muted-foreground">
          {{ t(step.bodyKey) }}
        </p>
        <PageGuideMockResult v-if="showMockCard" />
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
            v-if="guide.state.stepIndex > 0"
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
        class="pointer-events-none fixed z-(--pxd-z-dialog-nested) max-w-[min(260px,calc(100vw-16px))] rounded-sm bg-primary px-[var(--pxd-space-sm)] py-[2px] text-[length:var(--pxd-font-caption)] font-medium text-primary-foreground shadow-md"
        :style="bubbleStyle"
      >
        {{ guide.state.label }}
      </div>
    </template>
  </Teleport>
</template>
