<template>
  <!-- Compact Console Status Header -->
  <div
    data-test="runtime-summary"
    class="flex items-center justify-between gap-[var(--pxd-space-xs)] px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] rounded-md bg-muted/40 border border-border text-[length:var(--pxd-font-caption)]"
  >
    <div class="flex items-center gap-[var(--pxd-space-xs)] min-w-0 flex-1 overflow-hidden">
      <!-- League Selector (Compact Status Header) -->
      <DropdownMenu :open="isLeagueMenuOpen" @update:open="(open) => (isLeagueMenuOpen = open)">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            data-test="league-selector-trigger"
            class="inline-flex items-center gap-1 font-semibold text-foreground hover:bg-muted/70 px-1.5 py-0.5 rounded-sm cursor-pointer transition-colors max-w-[150px] truncate shrink-0"
            :disabled="isSwitchingLeague || isBatchRunning"
            :title="t('liveSearch.primary.switchLeagueTitle', { league: selectedLeagueDisplay })"
          >
            <span data-test="summary-league" class="truncate">
              {{ selectedLeagueDisplay }}
            </span>
            <Loader2
              v-if="isSwitchingLeague"
              class="size-[var(--control-icon-sm,14px)] animate-spin shrink-0 text-muted-foreground"
            />
            <ChevronDown
              v-else
              class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground transition-transform duration-150"
              :class="{ 'rotate-180': isLeagueMenuOpen }"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            v-for="league in availableLeagues"
            :key="league"
            :data-test="`league-option-${league}`"
            :disabled="isSwitchingLeague"
            class="cursor-pointer flex items-center justify-between gap-2"
            @click="handleSelectLeague(league)"
          >
            <span>{{ formatLiveSearchDisplayLeague(league) }}</span>
            <Check
              v-if="league.toLowerCase() === currentSelectedLeague.toLowerCase()"
              class="size-[var(--control-icon-sm,14px)] text-primary"
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span class="text-muted-foreground shrink-0">·</span>

      <span data-test="summary-count" class="font-medium text-foreground shrink-0 font-mono">
        {{ activeSubscriptionCount }} {{ t('liveSearch.primary.watching') }}
      </span>

      <template v-if="errorSubscriptionCount > 0">
        <span class="text-muted-foreground shrink-0">·</span>
        <span
          data-test="summary-error-count"
          class="font-medium text-destructive shrink-0 font-mono"
        >
          {{ errorSubscriptionCount }} {{ t('liveSearch.primary.error') }}
        </span>
      </template>
    </div>

    <!-- Compact API Rate Status Trigger -->
    <button
      type="button"
      data-test="btn-toggle-rate-details"
      class="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-sm hover:bg-muted transition-colors cursor-pointer"
      :aria-expanded="isRateDetailsOpen"
      :title="t('liveSearch.primary.rateToggleTitle')"
      @click="isRateDetailsOpen = !isRateDetailsOpen"
    >
      <span
        data-test="rate-limit-status"
        class="font-medium font-mono"
        :class="isRateWaiting ? 'text-amber-500' : 'text-emerald-500'"
      >
        {{
          isRateWaiting
            ? t('liveSearch.primary.rateWaiting', { seconds: remainingWaitSeconds })
            : t('liveSearch.console.apiHealthNormal')
        }}
      </span>
      <ChevronDown
        class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-150"
        :class="{ 'rotate-180': isRateDetailsOpen }"
      />
    </button>
  </div>

  <!-- 通知音效被瀏覽器擋下（ADR-0016）：點一下即可解除並試聽。
       用 pointerdown 而非 click：解除監聽在 pointerdown 就會讓提示消失，click 會落空 -->
  <button
    v-if="isSoundBlocked"
    type="button"
    data-test="sound-blocked-notice"
    class="flex items-center gap-[var(--pxd-space-xs)] px-[var(--pxd-space-md)] py-[var(--pxd-space-xs)] rounded-md border border-amber-500/25 bg-amber-500/10 text-left text-[length:var(--pxd-font-caption)] text-foreground cursor-pointer hover:bg-amber-500/15 transition-colors"
    :title="t('liveSearch.sound.blockedTitle')"
    @pointerdown="emit('enable-sound')"
    @keydown.enter.space.prevent="emit('enable-sound')"
  >
    <VolumeX class="size-[var(--control-icon-sm,14px)] shrink-0 text-amber-500" />
    <span class="min-w-0 flex-1">{{ t('liveSearch.sound.blockedNotice') }}</span>
  </button>

  <!-- 展開式 API Rate Limit Details (Session UI State) -->
  <div
    v-show="isRateDetailsOpen"
    data-test="rate-limit-details"
    class="flex flex-col gap-[var(--pxd-space-xs)] p-[var(--pxd-space-sm)] rounded-md border border-border bg-card/60 text-[length:var(--pxd-font-caption)]"
  >
    <div class="flex items-center justify-between gap-[var(--pxd-space-sm)] text-muted-foreground">
      <span class="truncate"> {{ t('liveSearch.primary.rateStatusTitle') }} </span>
      <span data-test="rate-limit-next-allowed" class="shrink-0 font-mono">
        {{
          t('liveSearch.primary.rateNextRequest', {
            time:
              remainingWaitSeconds > 0
                ? t('liveSearch.primary.rateSeconds', { seconds: remainingWaitSeconds })
                : t('liveSearch.primary.rateImmediate'),
          })
        }}
      </span>
    </div>

    <div
      v-if="rateRuleEntries.length === 0"
      data-test="rate-limit-empty"
      class="text-muted-foreground text-center py-[var(--pxd-space-xs)] border-t border-border/60"
    >
      {{ t('liveSearch.primary.noRateData') }}
    </div>
    <div
      v-for="[ruleName, windows] in rateRuleEntries"
      :key="ruleName"
      data-test="rate-limit-rule"
      :data-rule="ruleName"
      class="flex flex-col gap-[var(--pxd-space-xs)] p-[var(--pxd-space-xs)] rounded-sm bg-background/60 border border-border/50"
    >
      <span data-test="rate-limit-rule-name" class="font-semibold text-foreground">
        {{ formatRuleName(ruleName) }}
      </span>
      <div
        v-for="(win, idx) in windows"
        :key="idx"
        data-test="rate-limit-window"
        class="grid grid-cols-2 gap-x-[var(--pxd-space-xs)] gap-y-0.5 font-mono text-muted-foreground"
      >
        <span class="text-foreground font-semibold">{{
          t('liveSearch.rateLimit.used', { used: win.used, limit: win.limit })
        }}</span>
        <span>{{ t('liveSearch.rateLimit.window', { seconds: win.window }) }}</span>
        <span>{{ t('liveSearch.rateLimit.windowLeft', { seconds: win.windowLeft }) }}</span>
        <span>{{ t('liveSearch.rateLimit.cooldown', { seconds: win.cooldown }) }}</span>
        <span class="col-span-2">{{
          t('liveSearch.rateLimit.cooldownLeft', { seconds: win.cooldownLeft })
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, type PropType } from 'vue';
import { Check, ChevronDown, Loader2, VolumeX } from '@lucide/vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/utils/i18n';
import type {
  LiveSearchPrimaryViewSnapshot,
  TradeRateLimitWindow,
} from '@/utils/live-search-contract';
import { formatLiveSearchDisplayLeague } from '@/entrypoints/content/logic/live-search-sources';

const props = defineProps({
  currentSelectedLeague: {
    type: String,
    required: true,
  },
  availableLeagues: {
    type: Array as PropType<readonly string[]>,
    required: true,
  },
  isSwitchingLeague: {
    type: Boolean,
    required: true,
  },
  isBatchRunning: {
    type: Boolean,
    required: true,
  },
  activeSubscriptionCount: {
    type: Number,
    required: true,
  },
  errorSubscriptionCount: {
    type: Number,
    required: true,
  },
  isSoundBlocked: {
    type: Boolean,
    required: true,
  },
  rateLimit: {
    type: Object as PropType<Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined>,
    default: undefined,
  },
});

const emit = defineEmits<{
  (e: 'switch-league', league: string): void;
  (e: 'enable-sound'): void;
}>();

const isLeagueMenuOpen = ref(false);
const isRateDetailsOpen = ref(false);
const nowMs = ref(Date.now());
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const selectedLeagueDisplay = computed(() => {
  return formatLiveSearchDisplayLeague(props.currentSelectedLeague);
});

function handleSelectLeague(league: string) {
  isLeagueMenuOpen.value = false;
  emit('switch-league', league);
}

function clearCountdownTimer() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function computeRateCountdownEndAtMs(
  rateLimit: Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined,
): number {
  if (!rateLimit) return 0;
  let endAtMs = rateLimit.nextAllowedAtMs ?? 0;
  const observedAtMs = rateLimit.observedAtMs;
  if (typeof observedAtMs === 'number' && observedAtMs > 0 && rateLimit.rules) {
    let maxWindowOrCooldownSec = 0;
    for (const windows of Object.values(rateLimit.rules)) {
      if (!Array.isArray(windows)) continue;
      for (const win of windows) {
        if (win.windowLeft > maxWindowOrCooldownSec) {
          maxWindowOrCooldownSec = win.windowLeft;
        }
        if (win.cooldownLeft > maxWindowOrCooldownSec) {
          maxWindowOrCooldownSec = win.cooldownLeft;
        }
      }
    }
    if (maxWindowOrCooldownSec > 0) {
      endAtMs = Math.max(endAtMs, observedAtMs + maxWindowOrCooldownSec * 1000);
    }
  }
  return endAtMs;
}

function syncCountdownTimer(
  rateLimit: Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined,
) {
  nowMs.value = Date.now();
  const targetEndAtMs = computeRateCountdownEndAtMs(rateLimit);
  if (targetEndAtMs > nowMs.value) {
    if (countdownTimer === null) {
      countdownTimer = setInterval(() => {
        nowMs.value = Date.now();
        if (nowMs.value >= computeRateCountdownEndAtMs(props.rateLimit)) {
          clearCountdownTimer();
        }
      }, 250);
    }
  } else {
    clearCountdownTimer();
  }
}

watch(
  () => props.rateLimit,
  (newRateLimit) => {
    syncCountdownTimer(newRateLimit);
  },
  { immediate: true, flush: 'sync' },
);

onUnmounted(() => {
  clearCountdownTimer();
});

const remainingWaitSeconds = computed(() => {
  const nextAllowedAtMs = props.rateLimit?.nextAllowedAtMs ?? 0;
  if (nextAllowedAtMs <= 0) return 0;
  const diffMs = nextAllowedAtMs - nowMs.value;
  return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
});

const rateRuleEntries = computed<Array<[string, TradeRateLimitWindow[]]>>(() => {
  const rateLimit = props.rateLimit;
  const rules = rateLimit?.rules;
  if (!rules) return [];
  const observedAtMs = rateLimit?.observedAtMs;
  const elapsedSeconds =
    typeof observedAtMs === 'number' && observedAtMs > 0
      ? Math.floor(Math.max(0, nowMs.value - observedAtMs) / 1000)
      : 0;
  return Object.entries(rules)
    .filter(([, windows]) => Array.isArray(windows) && windows.length > 0)
    .map(([ruleName, windows]) => [
      ruleName,
      windows.map((win) => ({
        ...win,
        windowLeft: Math.max(0, win.windowLeft - elapsedSeconds),
        cooldownLeft: Math.max(0, win.cooldownLeft - elapsedSeconds),
      })),
    ]);
});

const isRateWaiting = computed(() => {
  return remainingWaitSeconds.value > 0;
});

function formatRuleName(rule: string): string {
  const lower = rule.toLowerCase();
  if (lower === 'account') return t('liveSearch.primary.rateAccount');
  if (lower === 'ip') return 'IP';
  if (lower === 'client') return t('liveSearch.primary.rateClient');
  return rule;
}
</script>
