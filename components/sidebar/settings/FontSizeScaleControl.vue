<script setup lang="ts">
import { Minus, Plus, RotateCcw, SlidersHorizontal } from '@lucide/vue';
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { LAYOUT_TOKENS, createUiRuntimeTokenValues } from '@/lib/tokens';
import {
  DEFAULT_FONT_SIZE_PERCENT,
  FONT_SIZE_PERCENT_BOUNDS,
  clampFontSizePercent,
  clampFontSizeScale,
  fontSizeScaleToPercent,
  stepFontSizeScale,
} from '@/utils/appearance-preferences';
import { t } from '@/utils/i18n';
import { DEFAULT_PREFERENCES, FONT_SIZE_PERCENT_STEP } from '@/utils/preferences-contract';
import { FONT_SIZE_SCALE_PREVIEW_KEY } from './font-size-preview';

type VirtualAnchor = {
  getBoundingClientRect: () => DOMRect;
};

const WHEEL_COMMIT_DELAY_MS = 80;
const PENDING_ACK_TIMEOUT_MS = 800;

// 浮層固定鎖在 1.0x 基準尺寸 token，確保背後側邊欄縮放時浮層自身不會跟著變形或位移
const { [LAYOUT_TOKENS.sidebarWidthVar]: _ignoredSidebarWidth, ...baselineTokenStyles } =
  createUiRuntimeTokenValues({ scale: 1, density: 1 });
const FIXED_POPOVER_STYLE = Object.freeze(baselineTokenStyles);

const props = withDefaults(
  defineProps<{
    scale: number;
    inGuide?: boolean;
  }>(),
  {
    inGuide: false,
  },
);

const emit = defineEmits<{
  (e: 'update:scale', value: number): void;
}>();

const setPreview = inject(FONT_SIZE_SCALE_PREVIEW_KEY, null);

const localPercent = ref(fontSizeScaleToPercent(props.scale));
const draftPercent = ref(String(localPercent.value));
const isDefault = computed(() => localPercent.value === DEFAULT_FONT_SIZE_PERCENT);
const atMin = computed(() => localPercent.value <= FONT_SIZE_PERCENT_BOUNDS.min);
const atMax = computed(() => localPercent.value >= FONT_SIZE_PERCENT_BOUNDS.max);

const isOpen = ref(false);
const isSliderDragging = ref(false);
const triggerWrapRef = ref<HTMLElement | null>(null);
const frozenAnchorReference = shallowRef<VirtualAnchor | undefined>(undefined);

let pendingCommitScale: number | null = null;
let pendingAckTimer: ReturnType<typeof setTimeout> | null = null;
let wheelCommitTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWheelScale: number | null = null;
let sliderReleaseFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let removeWindowSliderListeners: (() => void) | null = null;

function clearPendingCommit() {
  pendingCommitScale = null;
  if (pendingAckTimer !== null) {
    clearTimeout(pendingAckTimer);
    pendingAckTimer = null;
  }
}

function setPendingCommit(scale: number) {
  clearPendingCommit();
  pendingCommitScale = scale;
  pendingAckTimer = setTimeout(() => {
    clearPendingCommit();
  }, PENDING_ACK_TIMEOUT_MS);
}

function cancelWheelCommit() {
  if (wheelCommitTimer !== null) {
    clearTimeout(wheelCommitTimer);
    wheelCommitTimer = null;
  }
  pendingWheelScale = null;
}

function flushWheelCommit() {
  if (pendingWheelScale === null) {
    cancelWheelCommit();
    return;
  }
  const targetScale = pendingWheelScale;
  cancelWheelCommit();
  commitScale(targetScale);
}

function detachWindowSliderListeners() {
  if (sliderReleaseFallbackTimer !== null) {
    clearTimeout(sliderReleaseFallbackTimer);
    sliderReleaseFallbackTimer = null;
  }
  removeWindowSliderListeners?.();
  removeWindowSliderListeners = null;
}

watch(
  () => props.scale,
  (nextScale) => {
    if (isSliderDragging.value || wheelCommitTimer !== null) return;
    if (pendingCommitScale !== null) {
      if (Math.abs(nextScale - pendingCommitScale) <= 0.0001) {
        clearPendingCommit();
      } else {
        // 忽略拖曳或連點期間尚未追上的舊 storage 回音，避免滑桿與數值回彈跳動
        return;
      }
    }
    const nextPercent = fontSizeScaleToPercent(nextScale);
    localPercent.value = nextPercent;
    draftPercent.value = String(nextPercent);
  },
);

onBeforeUnmount(() => {
  detachWindowSliderListeners();
  flushWheelCommit();
  clearPendingCommit();
  setPreview?.(null);
});

function captureFrozenAnchor(): VirtualAnchor | undefined {
  const rect = triggerWrapRef.value?.getBoundingClientRect();
  if (!rect) return undefined;
  return {
    getBoundingClientRect: () => rect,
  };
}

function handlePopoverOpenChange(nextOpen: boolean) {
  if (nextOpen && !isOpen.value) {
    frozenAnchorReference.value = captureFrozenAnchor();
  } else if (!nextOpen) {
    detachWindowSliderListeners();
    isSliderDragging.value = false;
    flushWheelCommit();
    frozenAnchorReference.value = undefined;
  }
  isOpen.value = nextOpen;
}

function toggleOpen() {
  handlePopoverOpenChange(!isOpen.value);
}

function handleInteractOutside(event: CustomEvent<{ originalEvent?: Event }>) {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  if (triggerWrapRef.value && path.includes(triggerWrapRef.value)) {
    event.preventDefault();
  }
}

function commitScale(nextScale: number) {
  cancelWheelCommit();
  const clampedScale = clampFontSizeScale(nextScale);
  const nextPercent = fontSizeScaleToPercent(clampedScale);
  localPercent.value = nextPercent;
  draftPercent.value = String(nextPercent);
  if (Math.abs(clampedScale - props.scale) > 0.0001 || pendingCommitScale !== null) {
    setPendingCommit(clampedScale);
    setPreview?.(clampedScale);
    emit('update:scale', clampedScale);
  } else {
    clearPendingCommit();
    setPreview?.(null);
  }
}

function step(deltaSteps: number) {
  commitScale(stepFontSizeScale(localPercent.value / 100, deltaSteps));
}

function reset() {
  commitScale(DEFAULT_PREFERENCES.fontSizeScale);
}

function handleSliderPointerDown() {
  detachWindowSliderListeners();
  isSliderDragging.value = true;
  const onPointerFinish = () => {
    removeWindowSliderListeners?.();
    removeWindowSliderListeners = null;
    // pointerup 通常早於或伴隨 change 觸發；若放開時值沒變導致瀏覽器不送 change，下一個 tick 收尾
    sliderReleaseFallbackTimer = setTimeout(() => {
      sliderReleaseFallbackTimer = null;
      if (!isSliderDragging.value) return;
      isSliderDragging.value = false;
      commitScale(localPercent.value / 100);
    }, 0);
  };
  window.addEventListener('pointerup', onPointerFinish, { once: true });
  window.addEventListener('pointercancel', onPointerFinish, { once: true });
  removeWindowSliderListeners = () => {
    window.removeEventListener('pointerup', onPointerFinish);
    window.removeEventListener('pointercancel', onPointerFinish);
  };
}

function handleSliderInput(event: Event) {
  const parsed = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(parsed)) return;
  const clamped = clampFontSizePercent(parsed);
  localPercent.value = clamped;
  draftPercent.value = String(clamped);
  setPreview?.(clamped / 100);
}

function handleSliderChange(event: Event) {
  detachWindowSliderListeners();
  isSliderDragging.value = false;
  const parsed = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(parsed)) {
    commitScale(localPercent.value / 100);
    return;
  }
  commitScale(clampFontSizePercent(parsed) / 100);
}

function handleWheel(event: WheelEvent) {
  if (event.deltaY === 0) return;
  const nextScale = stepFontSizeScale(localPercent.value / 100, event.deltaY < 0 ? 1 : -1);
  const nextPercent = fontSizeScaleToPercent(nextScale);
  localPercent.value = nextPercent;
  draftPercent.value = String(nextPercent);
  setPreview?.(nextScale);
  pendingWheelScale = nextScale;
  if (wheelCommitTimer !== null) clearTimeout(wheelCommitTimer);
  wheelCommitTimer = setTimeout(() => {
    flushWheelCommit();
  }, WHEEL_COMMIT_DELAY_MS);
}

function handleModelUpdate(value: string | number) {
  const raw = String(value);
  draftPercent.value = raw;
  if (raw.trim() === '') return;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;
  if (parsed >= FONT_SIZE_PERCENT_BOUNDS.min && parsed <= FONT_SIZE_PERCENT_BOUNDS.max) {
    commitScale(Math.round(parsed) / 100);
  }
}

function handleCommit(event?: Event) {
  const inputVal = (event?.target as HTMLInputElement | undefined)?.value;
  const raw = inputVal !== undefined ? inputVal : draftPercent.value;
  if (raw.trim() === '') {
    draftPercent.value = String(localPercent.value);
    return;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    draftPercent.value = String(localPercent.value);
    return;
  }
  const clamped = clampFontSizePercent(parsed);
  commitScale(clamped / 100);
}
</script>

<template>
  <Popover :open="isOpen" @update:open="handlePopoverOpenChange">
    <PopoverAnchor :reference="frozenAnchorReference" />
    <div class="flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
      <span ref="triggerWrapRef" class="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :aria-expanded="isOpen"
          :aria-label="t('settings.fontSize.triggerAria')"
          :title="t('settings.fontSize.triggerAria')"
          data-font-scale-trigger
          class="gap-[var(--pxd-space-xs)] tabular-nums"
          @click="toggleOpen"
        >
          <SlidersHorizontal />
          <span>{{ localPercent }}%</span>
        </Button>
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        :disabled="isDefault"
        :aria-label="t('settings.fontSize.resetAria')"
        :title="t('settings.fontSize.resetAria')"
        data-font-scale-action="reset"
        @click="reset"
      >
        <RotateCcw />
      </Button>
    </div>

    <PopoverContent
      v-if="isOpen"
      side="bottom"
      align="end"
      :side-offset="6"
      :collision-padding="8"
      :avoid-collisions="true"
      data-font-scale-popover
      :class="inGuide ? 'z-(--pxd-z-guide-floating) w-[264px]' : 'z-(--pxd-z-floating) w-[264px]'"
      :style="FIXED_POPOVER_STYLE"
      @open-auto-focus.prevent
      @interact-outside="handleInteractOutside"
    >
      <div class="flex flex-col gap-[var(--pxd-space-md)]" @wheel.prevent="handleWheel">
        <div class="flex items-center justify-between gap-[var(--pxd-space-sm)]">
          <span class="text-[length:var(--pxd-font-secondary)] font-medium text-foreground">
            {{ t('settings.fontSize.label') }}
          </span>
          <span class="text-[length:var(--pxd-font-caption)] tabular-nums text-muted-foreground">
            {{ FONT_SIZE_PERCENT_BOUNDS.min }}% – {{ FONT_SIZE_PERCENT_BOUNDS.max }}%
          </span>
        </div>

        <input
          type="range"
          :value="localPercent"
          :min="FONT_SIZE_PERCENT_BOUNDS.min"
          :max="FONT_SIZE_PERCENT_BOUNDS.max"
          step="1"
          :aria-label="t('settings.fontSize.sliderAria')"
          data-font-scale-slider
          class="h-2 w-full cursor-pointer accent-primary"
          @pointerdown="handleSliderPointerDown"
          @input="handleSliderInput"
          @change="handleSliderChange"
        />

        <div class="flex items-center justify-between gap-[var(--pxd-space-sm)]">
          <div class="flex items-center gap-[var(--pxd-space-xs)]">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              :disabled="atMin"
              :aria-label="t('settings.fontSize.decreaseAria')"
              :title="t('settings.fontSize.decreaseAria')"
              data-font-scale-action="decrease"
              @click="step(-1)"
            >
              <Minus />
            </Button>
            <label
              class="box-border flex h-[var(--control-height-sm,1.75rem)] shrink-0 cursor-text items-center gap-[2px] rounded-md border border-input bg-background px-[var(--input-padding-x-sm,8px)] shadow-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring"
            >
              <input
                type="number"
                :value="draftPercent"
                :min="FONT_SIZE_PERCENT_BOUNDS.min"
                :max="FONT_SIZE_PERCENT_BOUNDS.max"
                :step="FONT_SIZE_PERCENT_STEP"
                :aria-label="t('settings.fontSize.inputAria')"
                data-font-scale-input
                class="m-0 w-[3.6ch] min-w-0 appearance-none border-0 bg-transparent p-0 text-right font-[inherit] text-[length:var(--control-font-sm,12px)] text-foreground tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                @input="handleModelUpdate(($event.target as HTMLInputElement).value)"
                @blur="handleCommit"
                @keydown.enter="handleCommit"
              />
              <span
                aria-hidden="true"
                class="shrink-0 select-none text-[length:var(--pxd-font-caption)] leading-none text-muted-foreground"
                >%</span
              >
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              :disabled="atMax"
              :aria-label="t('settings.fontSize.increaseAria')"
              :title="t('settings.fontSize.increaseAria')"
              data-font-scale-action="increase"
              @click="step(1)"
            >
              <Plus />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            :disabled="isDefault"
            :aria-label="t('settings.fontSize.resetAria')"
            :title="t('settings.fontSize.resetAria')"
            data-font-scale-popover-reset
            @click="reset"
          >
            <RotateCcw />
          </Button>
        </div>

        <p class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
          {{ t('settings.fontSize.wheelHint') }}
        </p>
      </div>
    </PopoverContent>
  </Popover>
</template>
