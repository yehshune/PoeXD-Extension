<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import ToolboxIcon from '@/components/ui/ToolboxIcon.vue';
import { Separator } from '@/components/ui/separator';
import { getPreferences, type Preferences, type PreferencesModule } from '@/utils/preferences';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import { type PoeVersion } from '@/utils/trade-context';
import { buildTradeRootUrl, resolveQuickTradeRealms } from '@/utils/trade-realms';
import { bindDocumentLocaleMeta, setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { applyThemeFromPreferences } from '@/lib/theme/theme-runtime';
import { syncUiRuntimeTokens } from '@/lib/tokens/ui-contract';

const containerRef = ref<HTMLElement | null>(null);
const preferencesState = ref<Preferences>({ ...DEFAULT_PREFERENCES });
const loading = ref(true);

const POE_VERSIONS: readonly PoeVersion[] = ['poe1', 'poe2'];

const visibleRealms = computed(() =>
  resolveQuickTradeRealms({ displayLocale: preferencesState.value.displayLocale }),
);

let currentModule: PreferencesModule | null = null;
let stopSubscription: (() => void) | null = null;
let stopDocumentMeta: (() => void) | null = null;

function applyThemeAndTokens(snapshot: Readonly<Preferences>) {
  setActiveDisplayLocalePreference(snapshot.displayLocale, { hostname: '' });
  if (containerRef.value) {
    applyThemeFromPreferences(containerRef.value, snapshot);
    syncUiRuntimeTokens(containerRef.value, {
      scale: snapshot.fontSizeScale,
      density: snapshot.densityScale,
    });
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    applyThemeFromPreferences(document.documentElement, snapshot);
    syncUiRuntimeTokens(document.documentElement, {
      scale: snapshot.fontSizeScale,
      density: snapshot.densityScale,
    });
  }
}

async function loadPreferences() {
  loading.value = true;
  stopSubscription?.();
  stopSubscription = null;

  try {
    const outcome = await getPreferences('poe1');
    if (outcome.ok) {
      currentModule = outcome.value;
      const snapshot = currentModule.read();
      preferencesState.value = { ...snapshot };
      await nextTick();
      applyThemeAndTokens(snapshot);

      stopSubscription = currentModule.subscribe((newSnapshot) => {
        preferencesState.value = { ...newSnapshot };
        applyThemeAndTokens(newSnapshot);
      });
    }
  } catch (err) {
    console.error('[PoeXD Popup] 載入偏好設定失敗:', err);
  } finally {
    loading.value = false;
  }
}

function openTradePage(origin: string, version: PoeVersion) {
  const url = buildTradeRootUrl(origin, version);
  if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
    chrome.tabs.create({ url });
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

onMounted(async () => {
  stopDocumentMeta = bindDocumentLocaleMeta(() => t('popup.documentTitle'));
  await loadPreferences();
});

onUnmounted(() => {
  stopDocumentMeta?.();
  stopDocumentMeta = null;
  stopSubscription?.();
  stopSubscription = null;
});
</script>

<template>
  <div
    ref="containerRef"
    class="w-[300px] bg-background text-foreground p-[var(--pxd-pane-padding,15px)] flex flex-col gap-[var(--pxd-space-sm,6px)] font-sans select-none box-border"
  >
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-[var(--pxd-space-sm,6px)]">
        <ToolboxIcon :size="24" class="text-primary shrink-0" />
        <div class="flex flex-col">
          <div class="flex items-center gap-1.5">
            <h1
              class="text-[length:var(--pxd-font-section-title,14px)] font-bold tracking-tight text-foreground leading-none"
            >
              PoeXD
            </h1>
          </div>
          <p
            class="text-[length:var(--pxd-font-caption,12px)] text-muted-foreground mt-1 leading-none"
          >
            {{ t('popup.subtitle.notTrade') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 非官網時僅提供前往網站連結 -->
    <div v-if="!loading" data-not-trade-view class="flex flex-col gap-2 pt-1">
      <Separator class="bg-border/60 mb-1" />
      <p
        class="text-[length:var(--pxd-font-caption,12px)] text-muted-foreground leading-normal m-0"
      >
        {{ t('popup.notTrade.notice') }}
      </p>
      <div class="flex flex-col gap-2.5 pt-0.5">
        <div
          v-for="realm in visibleRealms"
          :key="`${realm.id}:${realm.origin}`"
          :data-trade-realm-group="realm.id"
          class="flex flex-col gap-1.5"
        >
          <div class="flex items-center justify-between gap-2 px-0.5">
            <span class="text-[length:var(--pxd-font-caption,12px)] font-semibold text-foreground">
              {{ t(realm.labelKey) }}
            </span>
            <span class="text-[length:var(--pxd-font-micro,11px)] text-muted-foreground font-mono">
              {{ realm.hostLabel }}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="version in POE_VERSIONS"
              :key="version"
              type="button"
              :data-open-realm="realm.id"
              :data-open-trade="version"
              :title="buildTradeRootUrl(realm.origin, version)"
              class="flex items-center justify-between gap-1 px-2.5 py-2 rounded-md border border-border/80 bg-muted/30 hover:bg-muted/70 hover:border-primary/50 text-foreground transition-all cursor-pointer text-left select-none"
              @click="openTradePage(realm.origin, version)"
            >
              <span class="text-[length:var(--pxd-font-body,13px)] font-medium leading-tight">
                {{
                  t(
                    version === 'poe2'
                      ? 'popup.notTrade.poe2ShortTitle'
                      : 'popup.notTrade.poe1ShortTitle',
                  )
                }}
              </span>
              <span
                class="text-[length:var(--pxd-font-caption,12px)] text-primary font-medium shrink-0"
                >{{ t('popup.notTrade.openAction') }}</span
              >
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
