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

    <div class="flex items-center gap-1 shrink-0">
      <!-- 清空結果區：保留所有監聽連線，一鍵清除已渲染結果 -->
      <button
        v-if="canClearResults && displayedResultCount > 0"
        type="button"
        data-test="btn-clear-results"
        class="inline-flex items-center justify-center p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        :title="t('liveSearch.primary.clearResultsTitle')"
        :aria-label="t('liveSearch.primary.clearResultsTitle')"
        @click="emit('clear-results')"
      >
        <Trash2 class="size-[var(--control-icon-sm,14px)]" aria-hidden="true" />
      </button>

      <!-- 快捷音效開關：不必離開連線列表即可一鍵靜音／開啟 -->
      <button
        v-if="canToggleSound"
        type="button"
        data-test="btn-toggle-sound"
        class="inline-flex items-center justify-center p-1 rounded-sm hover:bg-muted transition-colors cursor-pointer"
        :class="
          isSoundEnabled
            ? 'text-foreground/80 hover:text-foreground'
            : 'text-muted-foreground/60 hover:text-foreground'
        "
        :aria-pressed="isSoundEnabled"
        :title="
          isSoundEnabled
            ? t('liveSearch.sound.quickMuteTitle')
            : t('liveSearch.sound.quickUnmuteTitle')
        "
        :aria-label="
          isSoundEnabled
            ? t('liveSearch.sound.quickMuteTitle')
            : t('liveSearch.sound.quickUnmuteTitle')
        "
        @click="emit('toggle-sound')"
      >
        <Volume2
          v-if="isSoundEnabled"
          class="size-[var(--control-icon-sm,14px)]"
          aria-hidden="true"
        />
        <VolumeX v-else class="size-[var(--control-icon-sm,14px)]" aria-hidden="true" />
      </button>

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
      <span class="truncate">
        {{ t('liveSearch.primary.rateStatusTitle') }}
        <span v-if="rateObservedAgeLabel" data-test="rate-limit-updated-ago" class="ml-1">
          · {{ rateObservedAgeLabel }}
        </span>
      </span>
      <span
        data-test="rate-limit-next-allowed"
        class="shrink-0 font-mono"
        :class="isRateWaiting ? 'text-amber-500' : ''"
      >
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
      <!-- 同一規則的各區間共用一個 grid：標籤欄依最長文字（如「近 3 小時」）撐開且各列對齊 -->
      <div
        class="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-x-[var(--pxd-space-sm)] gap-y-0.5 font-mono"
      >
        <div
          v-for="(win, idx) in windows"
          :key="idx"
          data-test="rate-limit-window"
          :data-state="win.state"
          :title="win.title"
          class="contents"
        >
          <span class="text-muted-foreground whitespace-nowrap" :title="win.title">{{
            win.label
          }}</span>
          <span class="h-1.5 rounded-full bg-muted overflow-hidden" :title="win.title">
            <span
              class="block h-full rounded-full transition-[width] duration-300"
              :class="win.barClass"
              :style="{ width: `${win.percent}%` }"
            />
          </span>
          <span class="text-right whitespace-nowrap" :class="win.textClass" :title="win.title">
            {{ win.usageText }}
            <span v-if="win.statusText" class="ml-1">{{ win.statusText }}</span>
          </span>
        </div>
      </div>
    </div>
    <p
      v-if="rateRuleEntries.length > 0"
      data-test="rate-limit-note"
      class="m-0 text-muted-foreground leading-snug"
    >
      {{ t('liveSearch.rateLimit.note') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch, type PropType } from 'vue';
import { Check, ChevronDown, Loader2, Trash2, Volume2, VolumeX } from '@lucide/vue';
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
  isSoundEnabled: {
    type: Boolean,
    default: true,
  },
  canToggleSound: {
    type: Boolean,
    default: false,
  },
  displayedResultCount: {
    type: Number,
    default: 0,
  },
  canClearResults: {
    type: Boolean,
    default: false,
  },
  rateLimit: {
    type: Object as PropType<Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined>,
    default: undefined,
  },
});

const emit = defineEmits<{
  (e: 'switch-league', league: string): void;
  (e: 'enable-sound'): void;
  (e: 'toggle-sound'): void;
  (e: 'clear-results'): void;
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

type RateLimitSnapshot = Readonly<LiveSearchPrimaryViewSnapshot['rateLimit']> | undefined;

/**
 * GGG 的 `X-Rate-Limit-{rule}-State` 為「目前次數:區間長度:限制剩餘秒數」。
 * 次數是滾動區間內的請求數，伺服器不會告知每筆何時過期，因此只有「限制剩餘」能在本地倒數；
 * 次數維持最後一次 fetch 回應的值，僅在距上次更新超過整個區間時才確定已歸零。
 */
function computeCooldownEndAtMs(rateLimit: RateLimitSnapshot): number {
  if (!rateLimit) return 0;
  let endAtMs = rateLimit.nextAllowedAtMs ?? 0;
  const observedAtMs = rateLimit.observedAtMs;
  if (typeof observedAtMs === 'number' && observedAtMs > 0) {
    for (const windows of Object.values(rateLimit.rules ?? {})) {
      if (!Array.isArray(windows)) continue;
      for (const win of windows) {
        if (win.cooldownLeft > 0) {
          endAtMs = Math.max(endAtMs, observedAtMs + win.cooldownLeft * 1000);
        }
      }
    }
  }
  return endAtMs;
}

function hasObservedRateData(rateLimit: RateLimitSnapshot): boolean {
  return typeof rateLimit?.observedAtMs === 'number' && rateLimit.observedAtMs > 0;
}

/** 等待中、限制倒數中，或明細展開（顯示「幾秒前更新」）時才需要每 250ms 更新 */
function shouldTick(rateLimit: RateLimitSnapshot): boolean {
  if (computeCooldownEndAtMs(rateLimit) > nowMs.value) return true;
  return isRateDetailsOpen.value && hasObservedRateData(rateLimit);
}

function syncCountdownTimer(rateLimit: RateLimitSnapshot) {
  nowMs.value = Date.now();
  if (!shouldTick(rateLimit)) {
    clearCountdownTimer();
    return;
  }
  if (countdownTimer !== null) return;
  countdownTimer = setInterval(() => {
    nowMs.value = Date.now();
    if (!shouldTick(props.rateLimit)) clearCountdownTimer();
  }, 250);
}

watch(
  [() => props.rateLimit, isRateDetailsOpen],
  () => {
    syncCountdownTimer(props.rateLimit);
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

function formatSpan(seconds: number): string {
  const n = Math.max(0, Math.round(seconds));
  if (n >= 3600 && n % 3600 === 0) return t('liveSearch.rateLimit.unitHours', { n: n / 3600 });
  if (n >= 60 && n % 60 === 0) return t('liveSearch.rateLimit.unitMinutes', { n: n / 60 });
  return t('liveSearch.rateLimit.unitSeconds', { n });
}

/** 「幾秒前更新」：一分鐘內以秒、一小時內以分鐘、其餘以小時（無條件捨去） */
function formatAge(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  if (n < 60) return t('liveSearch.rateLimit.unitSeconds', { n });
  if (n < 3600) return t('liveSearch.rateLimit.unitMinutes', { n: Math.floor(n / 60) });
  return t('liveSearch.rateLimit.unitHours', { n: Math.floor(n / 3600) });
}

const rateElapsedSeconds = computed(() => {
  const observedAtMs = props.rateLimit?.observedAtMs;
  if (typeof observedAtMs !== 'number' || observedAtMs <= 0) return null;
  return Math.max(0, nowMs.value - observedAtMs) / 1000;
});

const rateObservedAgeLabel = computed(() => {
  const elapsed = rateElapsedSeconds.value;
  if (elapsed === null || rateRuleEntries.value.length === 0) return '';
  return t('liveSearch.rateLimit.updatedAgo', { age: formatAge(elapsed) });
});

interface RateWindowView {
  label: string;
  title: string;
  usageText: string;
  statusText: string;
  percent: number;
  state: 'restricted' | 'expired' | 'high' | 'normal';
  barClass: string;
  textClass: string;
}

function buildWindowView(win: TradeRateLimitWindow, elapsedSeconds: number): RateWindowView {
  const span = formatSpan(win.window);
  const title = t('liveSearch.rateLimit.windowTitle', {
    span,
    limit: win.limit,
    cooldown: formatSpan(win.cooldown),
  });
  const base = { label: t('liveSearch.rateLimit.windowLabel', { span }), title };
  const cooldownLeft = Math.ceil(Math.max(0, win.cooldownLeft - elapsedSeconds));
  if (cooldownLeft > 0) {
    return {
      ...base,
      usageText: `${win.used} / ${win.limit}`,
      statusText: t('liveSearch.rateLimit.restricted', { seconds: cooldownLeft }),
      percent: 100,
      state: 'restricted',
      barClass: 'bg-red-500',
      textClass: 'text-red-500',
    };
  }
  // 距上次更新已超過整個區間：當時計入的請求都已滑出區間
  if (elapsedSeconds >= win.window) {
    return {
      ...base,
      title: `${title}
${t('liveSearch.rateLimit.expiredTitle', { span })}`,
      usageText: `0 / ${win.limit}`,
      statusText: t('liveSearch.rateLimit.expired'),
      percent: 0,
      state: 'expired',
      barClass: 'bg-emerald-500',
      textClass: 'text-muted-foreground',
    };
  }
  const ratio = win.limit > 0 ? win.used / win.limit : 0;
  const high = ratio >= 0.8;
  return {
    ...base,
    usageText: `${win.used} / ${win.limit}`,
    statusText: '',
    percent: Math.min(100, Math.round(ratio * 100)),
    state: high ? 'high' : 'normal',
    barClass: high ? 'bg-amber-500' : 'bg-emerald-500',
    textClass: high ? 'text-amber-500' : 'text-foreground',
  };
}

const rateRuleEntries = computed<Array<[string, RateWindowView[]]>>(() => {
  const rules = props.rateLimit?.rules;
  if (!rules) return [];
  const elapsed = rateElapsedSeconds.value ?? 0;
  return Object.entries(rules)
    .filter(([, windows]) => Array.isArray(windows) && windows.length > 0)
    .map(([ruleName, windows]) => [ruleName, windows.map((win) => buildWindowView(win, elapsed))]);
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
