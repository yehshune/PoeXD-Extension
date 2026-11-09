<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import ToolboxIcon from '@/components/ui/ToolboxIcon.vue';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { getPreferences, type Preferences, type PreferencesModule } from '@/utils/preferences';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import { queryActiveTabTradeContext, type PoeVersion } from '@/utils/trade-context';
import {
  bindDocumentLocaleMeta,
  setActiveDisplayLocalePreference,
  t,
  type I18nKey,
} from '@/utils/i18n';
import { applyThemeToHost } from '@/lib/theme/theme-runtime';
import { syncUiRuntimeTokens } from '@/lib/tokens/ui-contract';

const props = withDefaults(
  defineProps<{
    initialVersion?: PoeVersion;
    initialIsTradePage?: boolean;
  }>(),
  {
    initialVersion: undefined,
    initialIsTradePage: undefined,
  },
);

interface ModuleConfigItem {
  key: keyof Preferences;
  titleKey: I18nKey;
  descriptionKey: I18nKey;
  version?: PoeVersion;
}

const MODULE_ITEMS: readonly ModuleConfigItem[] = [
  {
    key: 'enableTierHelper',
    titleKey: 'popup.module.enableTierHelper.title',
    descriptionKey: 'popup.module.enableTierHelper.description',
  },
  {
    key: 'enableAffixSelector',
    titleKey: 'popup.module.enableAffixSelector.title',
    descriptionKey: 'popup.module.enableAffixSelector.description',
  },
  {
    key: 'enablePriceComparison',
    titleKey: 'popup.module.enablePriceComparison.title',
    descriptionKey: 'popup.module.enablePriceComparison.description',
  },
  {
    key: 'enableResultModHighlight',
    titleKey: 'popup.module.enableResultModHighlight.title',
    descriptionKey: 'popup.module.enableResultModHighlight.description',
  },
  {
    key: 'enableItemNormalizer',
    titleKey: 'popup.module.enableItemNormalizer.title',
    descriptionKey: 'popup.module.enableItemNormalizer.description',
    version: 'poe2',
  },
  {
    key: 'enablePureBackground',
    titleKey: 'popup.module.enablePureBackground.title',
    descriptionKey: 'popup.module.enablePureBackground.description',
  },
  {
    key: 'enableAutoTitle',
    titleKey: 'popup.module.enableAutoTitle.title',
    descriptionKey: 'popup.module.enableAutoTitle.description',
  },
];

const containerRef = ref<HTMLElement | null>(null);
const activeVersion = ref<PoeVersion>(props.initialVersion || 'poe1');
const isTradePage = ref<boolean>(props.initialIsTradePage ?? false);
const preferencesState = ref<Preferences>({ ...DEFAULT_PREFERENCES });
const loading = ref(true);

const visibleModules = computed(() =>
  MODULE_ITEMS.filter((item) => !item.version || item.version === activeVersion.value),
);

let currentModule: PreferencesModule | null = null;
let stopSubscription: (() => void) | null = null;
let stopDocumentMeta: (() => void) | null = null;

function applyThemeAndTokens(snapshot: Readonly<Preferences>) {
  setActiveDisplayLocalePreference(snapshot.displayLocale, { hostname: '' });
  if (containerRef.value) {
    applyThemeToHost(containerRef.value, snapshot.theme);
    syncUiRuntimeTokens(containerRef.value, {
      scale: snapshot.fontSizeScale,
      density: snapshot.densityScale,
    });
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    applyThemeToHost(document.documentElement, snapshot.theme);
    syncUiRuntimeTokens(document.documentElement, {
      scale: snapshot.fontSizeScale,
      density: snapshot.densityScale,
    });
  }
}

async function loadPreferencesForVersion(version: PoeVersion) {
  loading.value = true;
  stopSubscription?.();
  stopSubscription = null;

  try {
    const outcome = await getPreferences(version);
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

async function updateToggle(key: keyof Preferences, value: boolean | unknown) {
  if (!currentModule) return;
  const previousVal = Boolean(preferencesState.value[key]);
  const boolVal = Boolean(value);
  if (previousVal === boolVal) return;

  preferencesState.value[key] = boolVal as never;
  try {
    const outcome = await currentModule.update({ [key]: boolVal });
    if (!outcome.ok) {
      preferencesState.value[key] = previousVal as never;
      console.error(`[PoeXD Popup] 更新 ${key} 失敗:`, outcome.error);
    }
  } catch (err) {
    preferencesState.value[key] = previousVal as never;
    console.error(`[PoeXD Popup] 更新 ${key} 異常:`, err);
  }
}

function openTradePage(version: PoeVersion) {
  const url =
    version === 'poe2' ? 'https://www.pathofexile.com/trade2' : 'https://www.pathofexile.com/trade';
  if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
    chrome.tabs.create({ url });
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

onMounted(async () => {
  stopDocumentMeta = bindDocumentLocaleMeta(() => t('popup.documentTitle'));
  if (props.initialVersion === undefined || props.initialIsTradePage === undefined) {
    const detected = await queryActiveTabTradeContext();
    activeVersion.value = props.initialVersion ?? detected.version;
    isTradePage.value = props.initialIsTradePage ?? detected.isTradePage;
  } else {
    activeVersion.value = props.initialVersion;
    isTradePage.value = props.initialIsTradePage;
  }
  await loadPreferencesForVersion(activeVersion.value);
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
            <span
              v-if="isTradePage"
              data-trade-badge
              class="text-[length:var(--pxd-font-micro,10px)] px-1.5 py-0.5 rounded font-semibold border bg-muted/70 text-muted-foreground border-border/80 uppercase leading-none"
            >
              {{
                activeVersion === 'poe2' ? t('popup.tradeBadge.poe2') : t('popup.tradeBadge.poe1')
              }}
            </span>
          </div>
          <p
            class="text-[length:var(--pxd-font-caption,11px)] text-muted-foreground mt-1 leading-none"
          >
            {{ isTradePage ? t('popup.subtitle.trade') : t('popup.subtitle.notTrade') }}
          </p>
        </div>
      </div>
    </div>

    <!-- 非官網時僅提供前往網站連結 -->
    <div v-if="!isTradePage" data-not-trade-view class="flex flex-col gap-2 pt-1">
      <Separator class="bg-border/60 mb-1" />
      <p
        class="text-[length:var(--pxd-font-caption,11px)] text-muted-foreground leading-normal m-0"
      >
        {{ t('popup.notTrade.notice') }}
      </p>
      <div class="flex flex-col gap-1.5 pt-0.5">
        <button
          type="button"
          data-open-trade="poe1"
          class="flex items-center justify-between p-2 rounded-md border border-border/80 bg-muted/30 hover:bg-muted/70 hover:border-primary/50 text-foreground transition-all cursor-pointer text-left select-none"
          @click="openTradePage('poe1')"
        >
          <div class="flex flex-col min-w-0">
            <span class="text-[length:var(--pxd-font-body,13px)] font-medium leading-tight">{{
              t('popup.notTrade.poe1Title')
            }}</span>
            <span class="text-[length:var(--pxd-font-micro,10px)] text-muted-foreground mt-0.5"
              >pathofexile.com/trade</span
            >
          </div>
          <span
            class="text-[length:var(--pxd-font-caption,11px)] text-primary font-medium shrink-0"
            >{{ t('popup.notTrade.openAction') }}</span
          >
        </button>
        <button
          type="button"
          data-open-trade="poe2"
          class="flex items-center justify-between p-2 rounded-md border border-border/80 bg-muted/30 hover:bg-muted/70 hover:border-primary/50 text-foreground transition-all cursor-pointer text-left select-none"
          @click="openTradePage('poe2')"
        >
          <div class="flex flex-col min-w-0">
            <span class="text-[length:var(--pxd-font-body,13px)] font-medium leading-tight">{{
              t('popup.notTrade.poe2Title')
            }}</span>
            <span class="text-[length:var(--pxd-font-micro,10px)] text-muted-foreground mt-0.5"
              >pathofexile.com/trade2</span
            >
          </div>
          <span
            class="text-[length:var(--pxd-font-caption,11px)] text-primary font-medium shrink-0"
            >{{ t('popup.notTrade.openAction') }}</span
          >
        </button>
      </div>
    </div>

    <!-- 僅在交易官網顯示設定與分隔線 -->
    <template v-if="isTradePage">
      <Separator class="bg-border/60 my-[var(--pxd-space-xs,4px)]" />

      <!-- 模組清單 -->
      <div class="flex flex-col gap-[var(--pxd-space-xs,4px)]">
        <div
          v-for="item in visibleModules"
          :key="item.key"
          data-popup-module-row
          :data-module-key="item.key"
          class="flex items-start justify-between gap-[var(--pxd-space-sm,6px)] p-[var(--pxd-space-sm,6px)] rounded-md hover:bg-muted/40 transition-colors cursor-pointer select-none"
          @click="updateToggle(item.key, !preferencesState[item.key])"
        >
          <div class="flex flex-col min-w-0 pr-1">
            <span
              class="text-[length:var(--pxd-font-body,13px)] font-medium text-foreground truncate leading-snug"
            >
              {{ t(item.titleKey) }}
            </span>
            <span
              class="text-[length:var(--pxd-font-caption,11px)] text-muted-foreground leading-tight mt-0.5"
            >
              {{ t(item.descriptionKey) }}
            </span>
          </div>
          <div class="shrink-0 pt-0.5" @click.stop>
            <Checkbox
              :id="item.key"
              :model-value="Boolean(preferencesState[item.key])"
              :disabled="loading"
              @update:model-value="updateToggle(item.key, $event)"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
