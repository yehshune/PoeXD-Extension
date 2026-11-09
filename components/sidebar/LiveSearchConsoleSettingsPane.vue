<template>
  <ScrollAreaRoot
    data-sidebar-pane="live-search-console-settings"
    data-test="live-search-console-settings-pane"
    class="flex-1 box-border h-full min-h-0 relative overflow-hidden select-none"
  >
    <ScrollAreaViewport
      class="h-full w-full min-h-0 flex flex-col p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] box-border"
    >
      <!-- 結果展示筆數上限 -->
      <div class="flex flex-col gap-[var(--pxd-space-sm)]">
        <span class="text-[length:var(--pxd-font-secondary)] font-bold text-foreground">
          {{ t('liveSearch.settings.maxResultsLabel') }}
        </span>

        <ToggleGroup
          type="single"
          :model-value="String(liveSearchMaxDisplayedResults)"
          variant="outline"
          size="sm"
          data-test="pref-max-results"
          class="w-full grid grid-cols-4 gap-0"
          @update:model-value="handleUpdateMaxResults"
        >
          <ToggleGroupItem
            v-for="option in LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES"
            :key="option"
            :value="String(option)"
            :data-test="`pref-max-results-${option}`"
            class="text-[length:var(--pxd-font-caption)] px-1 w-full justify-center"
          >
            {{ option }}
          </ToggleGroupItem>
        </ToggleGroup>

        <span class="text-[length:var(--pxd-font-caption)] text-muted-foreground leading-relaxed">
          {{ t('liveSearch.settings.maxResultsDesc') }}
        </span>
      </div>

      <!-- 重新開啟主控台時 (Resume Mode) -->
      <Separator class="my-[var(--pxd-section-gap)]" />

      <div class="flex flex-col gap-[var(--pxd-space-sm)]">
        <span class="text-[length:var(--pxd-font-secondary)] font-bold text-foreground">
          {{ t('liveSearch.settings.reopenConsole') }}
        </span>

        <ToggleGroup
          type="single"
          :model-value="liveSearchResumeMode"
          variant="outline"
          size="sm"
          data-test="pref-resume-mode"
          class="w-full grid grid-cols-3 gap-0"
          @update:model-value="handleUpdateResumeMode"
        >
          <ToggleGroupItem
            value="off"
            data-test="pref-resume-mode-off"
            class="text-[length:var(--pxd-font-caption)] px-1 w-full justify-center"
          >
            {{ t('liveSearch.settings.resumeModeClean') }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="prompt"
            data-test="pref-resume-mode-prompt"
            class="text-[length:var(--pxd-font-caption)] px-1 w-full justify-center"
          >
            {{ t('liveSearch.settings.resumeModeManual') }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="auto"
            data-test="pref-resume-mode-auto"
            class="text-[length:var(--pxd-font-caption)] px-1 w-full justify-center"
          >
            {{ t('liveSearch.settings.resumeModeAutoShort') }}
          </ToggleGroupItem>
        </ToggleGroup>

        <div
          class="text-[length:var(--pxd-font-caption)] text-muted-foreground leading-relaxed pt-0.5 min-h-[2.5rem]"
        >
          <span v-if="liveSearchResumeMode === 'off'">{{
            t('liveSearch.settings.resumeOffDesc')
          }}</span>
          <span v-else-if="liveSearchResumeMode === 'prompt'">{{
            t('liveSearch.settings.resumePromptDesc')
          }}</span>
          <span v-else-if="liveSearchResumeMode === 'auto'">{{
            t('liveSearch.settings.resumeAutoDesc')
          }}</span>
        </div>

        <div class="pt-[var(--pxd-space-xs)]">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-test="btn-clear-resume-plan"
            :disabled="!hasPersistedPlan || isClearingPlan"
            class="text-[length:var(--pxd-font-caption)] text-muted-foreground hover:text-foreground"
            @click="handleClearResumePlan"
          >
            {{
              isClearingPlan
                ? t('liveSearch.settings.clearingPlan')
                : t('liveSearch.settings.clearPlanBtn')
            }}
          </Button>
        </div>
      </div>
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, type PropType } from 'vue';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import {
  DEFAULT_PREFERENCES,
  LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES,
  getPreferences,
  type Preferences,
  type PreferencesModule,
  type LiveSearchResumeMode,
  type LiveSearchMaxDisplayedResults,
} from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';
import { t } from '@/utils/i18n';
import type { LiveSearchResumeController } from '@/entrypoints/content/logic/live-search-resume-controller';
import {
  createLiveSearchResumeStore,
  clearLiveSearchResumePlan,
  type LiveSearchResumeStore,
} from '@/utils/live-search-resume-store';

const props = defineProps({
  preferences: {
    type: Object as PropType<PreferencesModule | null>,
    default: null,
  },
  resumeController: {
    type: Object as PropType<LiveSearchResumeController | null>,
    default: null,
  },
});

const version = getPoeVersion();
const liveSearchResumeMode = ref<LiveSearchResumeMode>(DEFAULT_PREFERENCES.liveSearchResumeMode);
const liveSearchMaxDisplayedResults = ref<LiveSearchMaxDisplayedResults>(
  DEFAULT_PREFERENCES.liveSearchMaxDisplayedResults,
);
const hasPersistedPlan = ref(false);
const isClearingPlan = ref(false);

let activePreferences: PreferencesModule | undefined;
let stopPreferences: (() => void) | undefined;
let stopResumeSub: (() => void) | undefined;
let standaloneResumeStore: LiveSearchResumeStore | undefined;

function applyPreferences(snapshot: Readonly<Preferences>) {
  liveSearchResumeMode.value =
    snapshot.liveSearchResumeMode ?? DEFAULT_PREFERENCES.liveSearchResumeMode;
  liveSearchMaxDisplayedResults.value =
    snapshot.liveSearchMaxDisplayedResults ?? DEFAULT_PREFERENCES.liveSearchMaxDisplayedResults;
}

function bindPreferencesModule(mod: PreferencesModule | undefined) {
  stopPreferences?.();
  stopPreferences = undefined;
  activePreferences = mod;
  if (mod) {
    stopPreferences = mod.subscribe(applyPreferences);
    applyPreferences(mod.read());
  }
}

function bindResumeSource() {
  stopResumeSub?.();
  stopResumeSub = undefined;

  if (props.resumeController) {
    hasPersistedPlan.value = props.resumeController.read().hasPersistedPlan;
    stopResumeSub = props.resumeController.subscribe((snap) => {
      hasPersistedPlan.value = snap.hasPersistedPlan;
    });
  } else {
    if (!standaloneResumeStore) {
      standaloneResumeStore = createLiveSearchResumeStore(version);
    }
    stopResumeSub = standaloneResumeStore.subscribe((plan) => {
      hasPersistedPlan.value = plan.identities.length > 0;
    });
    void standaloneResumeStore.read().then((outcome) => {
      if (outcome.ok) {
        hasPersistedPlan.value = outcome.value.identities.length > 0;
      }
    });
  }
}

watch(
  () => props.preferences,
  (newPref) => {
    if (newPref) {
      bindPreferencesModule(newPref);
    }
  },
  { immediate: true },
);

watch(
  () => props.resumeController,
  () => {
    bindResumeSource();
  },
  { immediate: true },
);

onMounted(async () => {
  if (!props.preferences) {
    try {
      const outcome = await getPreferences(version);
      if (outcome.ok && !props.preferences) {
        bindPreferencesModule(outcome.value);
      }
    } catch {
      // Fallback to DEFAULT_PREFERENCES if storage is unavailable
    }
  }
  bindResumeSource();
});

onUnmounted(() => {
  stopPreferences?.();
  stopResumeSub?.();
});

async function updatePreference<K extends 'liveSearchResumeMode' | 'liveSearchMaxDisplayedResults'>(
  key: K,
  value: Preferences[K],
) {
  if (!activePreferences) return;
  const outcome = await activePreferences.update({ [key]: value });
  if (!outcome.ok) {
    applyPreferences(activePreferences.read());
  }
}

async function handleUpdateResumeMode(val: unknown) {
  if (val !== 'off' && val !== 'prompt' && val !== 'auto') return;
  liveSearchResumeMode.value = val;
  await updatePreference('liveSearchResumeMode', val);
}

async function handleUpdateMaxResults(val: unknown) {
  const next = Number(val);
  const match = LIVE_SEARCH_MAX_DISPLAYED_RESULTS_VALUES.find((option) => option === next);
  if (match === undefined) return;
  liveSearchMaxDisplayedResults.value = match;
  await updatePreference('liveSearchMaxDisplayedResults', match);
}

async function handleClearResumePlan() {
  if (isClearingPlan.value) return;
  isClearingPlan.value = true;
  try {
    let success = false;
    if (props.resumeController) {
      success = await props.resumeController.clear();
    } else {
      success = await clearLiveSearchResumePlan(version);
    }
    if (success) {
      hasPersistedPlan.value = false;
    }
  } catch (err) {
    console.error('[PoeXD Settings] Failed to clear resume plan:', err);
  } finally {
    isClearingPlan.value = false;
  }
}
</script>
