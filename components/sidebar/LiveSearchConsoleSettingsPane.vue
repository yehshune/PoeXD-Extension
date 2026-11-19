<template>
  <ScrollAreaRoot
    data-sidebar-pane="live-search-console-settings"
    data-test="live-search-console-settings-pane"
    class="flex-1 box-border h-full min-h-0 relative overflow-hidden select-none"
  >
    <ScrollAreaViewport
      class="h-full w-full min-h-0 flex flex-col p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] box-border"
    >
      <div class="flex flex-col gap-[calc(var(--pxd-section-gap)*1.6)]">
        <!-- 結果展示筆數上限 -->
        <SettingsSection
          section-id="live-search-max-results"
          :title="t('liveSearch.settings.maxResultsLabel')"
          :icon="ListOrdered"
        >
          <ToggleGroup
            type="single"
            :model-value="String(liveSearchMaxDisplayedResults)"
            variant="outline"
            size="sm"
            data-test="pref-max-results"
            class="w-full grid grid-cols-4 gap-0"
            :aria-label="t('liveSearch.settings.maxResultsLabel')"
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
          <p class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground">
            {{ t('liveSearch.settings.maxResultsDesc') }}
          </p>
        </SettingsSection>

        <!-- 通知音效（ADR-0016）：播放官方 <audio>，音效與音量跟隨官方設定 -->
        <SettingsSection
          section-id="live-search-sound"
          :title="t('liveSearch.sound.label')"
          :icon="Volume2"
        >
          <SettingsRow
            :label="t('liveSearch.sound.enableLabel')"
            :description="t('liveSearch.sound.desc')"
            control-id="live-search-sound-enabled"
          >
            <template #default="{ describedBy }">
              <Switch
                id="live-search-sound-enabled"
                :model-value="liveSearchSoundEnabled"
                data-test="pref-sound-enabled"
                :aria-describedby="describedBy"
                @update:model-value="handleUpdateSoundEnabled"
              />
            </template>
          </SettingsRow>
          <div class="flex flex-col items-start gap-[var(--pxd-space-xs)]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-test="btn-sound-preview"
              :disabled="!soundNotifier"
              class="text-[length:var(--pxd-font-caption)]"
              @click="handlePreviewSound"
            >
              <Play aria-hidden="true" />
              {{ t('liveSearch.sound.previewBtn') }}
            </Button>
            <p
              v-if="previewMessage"
              data-test="sound-preview-message"
              role="status"
              class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-amber-500"
            >
              {{ previewMessage }}
            </p>
          </div>
        </SettingsSection>

        <!-- 重新開啟主控台時 (Resume Mode) -->
        <SettingsSection
          section-id="live-search-resume"
          :title="t('liveSearch.settings.reopenConsole')"
          :icon="RotateCcw"
        >
          <ToggleGroup
            type="single"
            :model-value="liveSearchResumeMode"
            variant="outline"
            size="sm"
            data-test="pref-resume-mode"
            class="w-full grid grid-cols-3 gap-0"
            :aria-label="t('liveSearch.settings.reopenConsole')"
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
          <p
            class="m-0 min-h-[2.5rem] text-[length:var(--pxd-font-caption)] leading-[1.45] text-muted-foreground"
          >
            <template v-if="liveSearchResumeMode === 'off'">{{
              t('liveSearch.settings.resumeOffDesc')
            }}</template>
            <template v-else-if="liveSearchResumeMode === 'prompt'">{{
              t('liveSearch.settings.resumePromptDesc')
            }}</template>
            <template v-else-if="liveSearchResumeMode === 'auto'">{{
              t('liveSearch.settings.resumeAutoDesc')
            }}</template>
          </p>
          <div>
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
        </SettingsSection>
      </div>
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, type PropType } from 'vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ListOrdered, Play, RotateCcw, Volume2 } from '@lucide/vue';
import SettingsRow from './settings/SettingsRow.vue';
import SettingsSection from './settings/SettingsSection.vue';
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
import { t, type I18nKey } from '@/utils/i18n';
import type { LiveSearchResumeController } from '@/entrypoints/content/logic/live-search-resume-controller';
import type {
  LiveSearchSoundNotifier,
  LiveSearchSoundPlayOutcome,
} from '@/entrypoints/content/logic/live-search-sound-notifier';
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
  soundNotifier: {
    type: Object as PropType<LiveSearchSoundNotifier | null>,
    default: null,
  },
});

const version = getPoeVersion();
const liveSearchResumeMode = ref<LiveSearchResumeMode>(DEFAULT_PREFERENCES.liveSearchResumeMode);
const liveSearchMaxDisplayedResults = ref<LiveSearchMaxDisplayedResults>(
  DEFAULT_PREFERENCES.liveSearchMaxDisplayedResults,
);
const liveSearchSoundEnabled = ref<boolean>(DEFAULT_PREFERENCES.liveSearchSoundEnabled);
const previewMessage = ref('');
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
  liveSearchSoundEnabled.value =
    snapshot.liveSearchSoundEnabled ?? DEFAULT_PREFERENCES.liveSearchSoundEnabled;
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

async function updatePreference<
  K extends 'liveSearchResumeMode' | 'liveSearchMaxDisplayedResults' | 'liveSearchSoundEnabled',
>(key: K, value: Preferences[K]) {
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

async function handleUpdateSoundEnabled(val: unknown) {
  if (typeof val !== 'boolean') return;
  liveSearchSoundEnabled.value = val;
  await updatePreference('liveSearchSoundEnabled', val);
}

const PREVIEW_FAILURE_KEYS = {
  muted: 'liveSearch.sound.preview.muted',
  missing: 'liveSearch.sound.preview.missing',
  blocked: 'liveSearch.sound.preview.blocked',
  error: 'liveSearch.sound.preview.error',
} as const satisfies Record<Exclude<LiveSearchSoundPlayOutcome, { ok: true }>['reason'], I18nKey>;

async function handlePreviewSound() {
  if (!props.soundNotifier) return;
  previewMessage.value = '';
  const outcome = await props.soundNotifier.preview();
  if (outcome.ok) return;
  previewMessage.value = t(PREVIEW_FAILURE_KEYS[outcome.reason]);
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
