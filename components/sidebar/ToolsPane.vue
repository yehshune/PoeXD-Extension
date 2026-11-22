<template>
  <div class="flex flex-col gap-[var(--pxd-section-gap)]">
    <!-- 使用導覽：隨時可以重看初始導覽 -->
    <SettingsSection
      section-id="tools-tour"
      :title="t('tools.tour.title')"
      :icon="Compass"
      :collapsible="false"
      :divided="false"
    >
      <p class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground">
        {{ t('tools.tour.description') }}
      </p>
      <Button
        type="button"
        variant="outline"
        data-tools-action="start-tour"
        class="w-full"
        @click="startTour"
      >
        <Play aria-hidden="true" />
        {{ t('tools.tour.start') }}
      </Button>
    </SettingsSection>

    <!-- 價格換算資料 -->
    <SettingsSection
      section-id="tools-economy"
      :title="t('tools.economy.title')"
      :icon="Coins"
      :collapsible="false"
      :divided="false"
    >
      <!-- poe.ninja 只有國際服資料：其他網域不提供價格換算，也不取得或更新資料 -->
      <p
        v-if="!priceConversionSupported"
        class="price-conversion-unsupported m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground"
      >
        {{
          currentRealmLabel
            ? t('tools.economy.unsupportedRealmWithLabel', { realm: currentRealmLabel })
            : t('tools.economy.unsupportedRealm', { realm: '' })
        }}
      </p>
      <template v-else>
        <dl data-tools-economy-status class="m-0 flex flex-col gap-[var(--pxd-space-sm)]">
          <div class="flex min-w-0 items-baseline justify-between gap-[var(--pxd-space-md)]">
            <dt class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
              {{ t('tools.economy.dataScopeLabel') }}
            </dt>
            <dd
              class="m-0 min-w-0 truncate text-right text-[length:var(--pxd-font-caption)] font-medium text-foreground"
            >
              {{ dataScopeDisplay }}
            </dd>
          </div>
          <div class="flex min-w-0 items-baseline justify-between gap-[var(--pxd-space-md)]">
            <dt class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
              {{ t('tools.economy.cacheStatusLabel') }}
            </dt>
            <dd
              :data-cache-state="cacheStatusState"
              class="m-0 flex min-w-0 items-center justify-end gap-1.5 text-right text-[length:var(--pxd-font-caption)] font-medium tabular-nums"
              :class="cacheStatusTextClass"
            >
              <span
                class="size-2 shrink-0 rounded-full"
                :class="cacheStatusDotClass"
                aria-hidden="true"
              ></span>
              <span class="min-w-0 truncate">{{ cacheStatusDisplay }}</span>
            </dd>
          </div>
          <div class="flex min-w-0 items-baseline justify-between gap-[var(--pxd-space-md)]">
            <dt class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
              {{ t('tools.economy.lastUpdatedLabel') }}
            </dt>
            <dd
              :title="lastUpdateTooltip"
              class="m-0 min-w-0 text-right text-[length:var(--pxd-font-caption)] font-medium tabular-nums"
              :class="economyMetadata.updatedAt ? 'text-foreground' : 'text-muted-foreground'"
            >
              {{ lastUpdateDisplay }}
            </dd>
          </div>
        </dl>

        <div class="flex flex-col gap-[var(--pxd-space-xs)]">
          <Button
            variant="outline"
            size="default"
            class="w-full"
            :disabled="!currentLeague || isRefreshingEconomy"
            @click="handleForceRefreshEconomy"
          >
            <RefreshCw :class="{ 'animate-spin': isRefreshingEconomy }" aria-hidden="true" />
            {{ isRefreshingEconomy ? t('common.updating') : t('common.updateNow') }}
          </Button>
          <p v-if="economyError" class="m-0 text-[length:var(--pxd-font-caption)] text-destructive">
            {{ economyError }}
          </p>
        </div>

        <!-- 低權重說明 -->
        <div
          class="flex flex-col gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground/80"
        >
          <p class="m-0">{{ economySourceDescription }}</p>
          <p class="m-0">{{ t('tools.economy.autoRefetchHint') }}</p>
        </div>
      </template>
    </SettingsSection>

    <!-- 關於與資源：整合改版資訊與支持開發 -->
    <SettingsSection
      section-id="tools-about"
      :title="t('tools.about.title')"
      :icon="Info"
      :collapsible="false"
      :divided="true"
    >
      <template v-if="appVersion" #aside>
        <span class="text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums">
          {{ appVersion }}
        </span>
      </template>

      <!-- 改版資訊 -->
      <div class="flex flex-col gap-[var(--pxd-space-xs)]">
        <div
          class="flex flex-wrap items-center justify-between gap-x-[var(--pxd-space-sm)] gap-y-[var(--pxd-space-xs)]"
        >
          <span
            class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] font-medium text-foreground"
          >
            <Newspaper
              class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {{ t('tools.releases.title') }}
          </span>
          <a
            :href="releasesPageUrl"
            data-releases-link="github-releases"
            target="_blank"
            rel="noopener noreferrer"
            :class="
              cn(
                buttonVariants({ variant: 'link', size: 'sm' }),
                'h-auto px-0 py-0 text-[length:var(--pxd-font-caption)]',
              )
            "
          >
            {{ t('tools.releases.linkLabel') }}
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
        </div>
        <p class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground">
          {{ t('tools.releases.description') }}
        </p>
      </div>

      <!-- 支持開發 -->
      <div class="flex flex-col gap-[var(--pxd-space-xs)]">
        <div
          class="flex flex-wrap items-center justify-between gap-x-[var(--pxd-space-sm)] gap-y-[var(--pxd-space-xs)]"
        >
          <span
            class="inline-flex items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] font-medium text-foreground"
          >
            <Heart
              class="size-[var(--control-icon-sm,14px)] shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {{ t('tools.support.title') }}
          </span>
          <a
            :href="supportPageUrl"
            data-support-link="support-page"
            target="_blank"
            rel="noopener noreferrer"
            :class="
              cn(
                buttonVariants({ variant: 'link', size: 'sm' }),
                'h-auto px-0 py-0 text-[length:var(--pxd-font-caption)]',
              )
            "
          >
            {{ t('tools.support.linkLabel') }}
            <ExternalLink class="size-3.5" aria-hidden="true" />
          </a>
        </div>
        <p class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground">
          {{ t('tools.support.description') }}
        </p>
      </div>
    </SettingsSection>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref } from 'vue';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RELEASES_PAGE_URL, SUPPORT_PAGE_URL } from '@/utils/support-links';
import { Coins, Compass, ExternalLink, Heart, Info, Newspaper, Play, RefreshCw } from '@lucide/vue';
import { usePageGuide } from './page-guide/usePageGuide';
import SettingsSection from './settings/SettingsSection.vue';
import { getPoeVersion, getTradeLeague } from '@/utils/trade-context';
import { extensionMessaging } from '@/utils/extension-protocol';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { normalizeEconomyLeague, type EconomyRateMetadata } from '@/utils/economy';
import { isPriceConversionSupported } from '@/utils/trade-realms';
import { getTradeRealmLabel } from '@/utils/trade-realm-labels';
import { formatMessage, t } from '@/utils/i18n';

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return t('tools.time.justNow');
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('tools.time.minutesAgo', { count: diffMin });
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return t('tools.time.hoursAgo', { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  return t('tools.time.daysAgo', { count: diffDays });
}

export function formatFutureRelativeTime(timestamp: number, now = Date.now()): string {
  const diffSec = Math.floor((timestamp - now) / 1000);
  if (diffSec <= 0) return t('tools.time.expiredRefetch');
  if (diffSec < 60) return t('tools.time.lessThanMinuteLater');
  const diffMin = Math.ceil(diffSec / 60);
  if (diffMin < 60) return t('tools.time.minutesLater', { count: diffMin });
  const diffHours = Math.ceil(diffMin / 60);
  if (diffHours < 24) return t('tools.time.hoursLater', { count: diffHours });
  const diffDays = Math.ceil(diffHours / 24);
  return t('tools.time.daysLater', { count: diffDays });
}

export function formatAbsoluteTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatTimeWithOptionalDate(timestamp: number, now = Date.now()): string {
  const d = new Date(timestamp);
  const nowDate = new Date(now);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const isSameDay =
    d.getFullYear() === nowDate.getFullYear() &&
    d.getMonth() === nowDate.getMonth() &&
    d.getDate() === nowDate.getDate();
  if (isSameDay) {
    return timeStr;
  }
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${timeStr}`;
}

export function shouldApplyEconomyMetadata(
  current: EconomyRateMetadata,
  incoming: EconomyRateMetadata,
): boolean {
  if (current.hasData && current.updatedAt !== null) {
    if (!incoming.hasData || incoming.updatedAt === null) {
      return false;
    }
    if (incoming.updatedAt < current.updatedAt) {
      return false;
    }
  }
  return true;
}

export default defineComponent({
  name: 'ToolsPane',
  components: {
    Button,
    ExternalLink,
    Heart,
    Newspaper,
    Play,
    RefreshCw,
    SettingsSection,
  },
  setup() {
    const version = getPoeVersion();
    const displayVersion = computed(() => (version === 'poe2' ? 'PoE 2' : 'PoE 1'));
    const appVersion = computed(() => {
      try {
        const raw =
          typeof chrome !== 'undefined' && chrome.runtime?.getManifest
            ? chrome.runtime.getManifest().version
            : '';
        return raw ? `v${raw}` : '';
      } catch {
        return '';
      }
    });

    const priceConversionSupported = isPriceConversionSupported();
    const currentRealmLabel = computed(() =>
      typeof window !== 'undefined' ? getTradeRealmLabel(window.location.href) : undefined,
    );

    const currentLeague = ref<string | undefined>(
      typeof window !== 'undefined' ? getTradeLeague(window.location.pathname) : undefined,
    );

    const economyMetadata = ref<EconomyRateMetadata>({
      updatedAt: null,
      source: 'none',
      ttl: 0,
      hasData: false,
      isExpired: true,
    });

    const isRefreshingEconomy = ref(false);
    const economyError = ref('');
    const nowTimestamp = ref(Date.now());
    let timer: ReturnType<typeof setInterval> | null = null;

    const dataScopeDisplay = computed(() => {
      const leagueText = currentLeague.value || t('tools.economy.noLeagueScope');
      return `${displayVersion.value} · ${leagueText}`;
    });

    const cacheStatusState = computed<'valid' | 'expired' | 'empty'>(() => {
      if (!economyMetadata.value.hasData || !economyMetadata.value.updatedAt) {
        return 'empty';
      }
      const expireTimestamp = economyMetadata.value.updatedAt + economyMetadata.value.ttl;
      if (economyMetadata.value.isExpired || nowTimestamp.value >= expireTimestamp) {
        return 'expired';
      }
      return 'valid';
    });

    const cacheStatusDotClass = computed(() => {
      if (cacheStatusState.value === 'valid') return 'bg-emerald-500';
      if (cacheStatusState.value === 'expired') return 'bg-amber-500';
      return 'bg-muted-foreground/50';
    });

    const cacheStatusTextClass = computed(() => {
      if (cacheStatusState.value === 'valid') return 'text-foreground';
      if (cacheStatusState.value === 'expired') return 'text-amber-500';
      return 'text-muted-foreground';
    });

    const cacheStatusDisplay = computed(() => {
      if (cacheStatusState.value === 'empty' || !economyMetadata.value.updatedAt) {
        return t('tools.economy.cacheNoData');
      }
      const expireTimestamp = economyMetadata.value.updatedAt + economyMetadata.value.ttl;
      if (cacheStatusState.value === 'expired') {
        return t('tools.economy.cacheExpired');
      }
      const relativeTime = formatFutureRelativeTime(expireTimestamp, nowTimestamp.value);
      const timeStr = formatTimeWithOptionalDate(expireTimestamp, nowTimestamp.value);
      return t('tools.economy.cacheValidUntil', { time: timeStr, relative: relativeTime });
    });

    const lastUpdateDisplay = computed(() => {
      if (!economyMetadata.value.updatedAt) {
        return t('tools.economy.noData');
      }
      const timeStr = formatTimeWithOptionalDate(
        economyMetadata.value.updatedAt,
        nowTimestamp.value,
      );
      const relativeStr = formatRelativeTime(economyMetadata.value.updatedAt, nowTimestamp.value);
      return t('tools.economy.timeWithRelative', { time: timeStr, relative: relativeStr });
    });

    const lastUpdateTooltip = computed(() => {
      if (!economyMetadata.value.updatedAt) {
        return undefined;
      }
      return formatAbsoluteTime(economyMetadata.value.updatedAt);
    });

    const economySourceDescription = computed(() => {
      const ttl = economyMetadata.value.ttl;
      if (ttl && ttl > 0) {
        const minutes = Math.round(ttl / (60 * 1000));
        return t('tools.economy.sourceWithTtl', { minutes });
      }
      return t('tools.economy.sourceDefault');
    });

    const applyEconomyMetadata = (incoming: EconomyRateMetadata): boolean => {
      if (!shouldApplyEconomyMetadata(economyMetadata.value, incoming)) {
        return false;
      }
      economyMetadata.value = incoming;
      return true;
    };

    const refreshEconomyMetadata = async () => {
      if (!priceConversionSupported) return;
      const league =
        typeof window !== 'undefined' ? getTradeLeague(window.location.pathname) : undefined;
      currentLeague.value = league;
      if (!league) {
        economyMetadata.value = {
          updatedAt: null,
          source: 'none',
          ttl: 0,
          hasData: false,
          isExpired: true,
        };
        return;
      }

      try {
        const meta = await extensionMessaging.sendMessage('economy:getRateMetadata', {
          version,
          league,
        });
        if (meta) {
          applyEconomyMetadata(meta);
        }
      } catch {
        // safe fallback
      }
    };

    const handleForceRefreshEconomy = async () => {
      const league = currentLeague.value;
      if (!priceConversionSupported || !league) return;

      isRefreshingEconomy.value = true;
      economyError.value = '';

      try {
        const res = await extensionMessaging.sendMessage('economy:fetchCurrencyRates', {
          version,
          league,
          force: true,
        });

        if (res.success) {
          if (res.metadata) {
            applyEconomyMetadata(res.metadata);
          } else {
            await refreshEconomyMetadata();
          }
          dispatchPoeEvent('poexd-toast', { message: t('tools.economy.toastUpdated') });
        } else {
          const errMsg = formatMessage(res.error, 'tools.economy.errorUpdateFailed');
          economyError.value = errMsg;
          dispatchPoeEvent('poexd-toast', {
            message: errMsg,
          });
        }
      } catch (err: any) {
        const errMsg = err?.message || t('tools.economy.errorUpdateFailed');
        economyError.value = errMsg;
        dispatchPoeEvent('poexd-toast', { message: errMsg });
      } finally {
        isRefreshingEconomy.value = false;
        nowTimestamp.value = Date.now();
      }
    };

    let unhookEconomyChange: (() => void) | undefined;

    onMounted(async () => {
      try {
        unhookEconomyChange = extensionMessaging.onMessage('economy:change', (message) => {
          if (!priceConversionSupported || !message?.data) return;
          const change = message.data;
          if (change.version !== version) return;
          const activeClean = normalizeEconomyLeague(currentLeague.value || '');
          const changeClean = normalizeEconomyLeague(change.league || '');
          if (activeClean && changeClean && activeClean === changeClean) {
            if (applyEconomyMetadata(change.metadata)) {
              economyError.value = '';
              nowTimestamp.value = Date.now();
            }
          }
        });
      } catch {
        // 安全略過缺少 chrome.runtime.onMessage 的執行環境（例如單元測試環境）
      }

      await refreshEconomyMetadata();
      timer = setInterval(() => {
        nowTimestamp.value = Date.now();
      }, 30000);
    });

    onUnmounted(() => {
      if (unhookEconomyChange) {
        unhookEconomyChange();
        unhookEconomyChange = undefined;
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });

    return {
      t,
      cn,
      buttonVariants,
      releasesPageUrl: RELEASES_PAGE_URL,
      supportPageUrl: SUPPORT_PAGE_URL,
      Coins,
      Compass,
      Info,
      Newspaper,
      Heart,
      startTour: () => usePageGuide().startTour(),
      displayVersion,
      appVersion,
      priceConversionSupported,
      currentRealmLabel,
      currentLeague,
      economyMetadata,
      isRefreshingEconomy,
      economyError,
      dataScopeDisplay,
      cacheStatusState,
      cacheStatusDotClass,
      cacheStatusTextClass,
      cacheStatusDisplay,
      lastUpdateDisplay,
      lastUpdateTooltip,
      economySourceDescription,
      handleForceRefreshEconomy,
      refreshEconomyMetadata,
    };
  },
});
</script>
