<template>
  <ScrollAreaRoot
    data-sidebar-pane="live-search-console-settings"
    data-test="live-search-console-settings-pane"
    class="flex-1 box-border h-full min-h-0 relative overflow-hidden select-none"
  >
    <ScrollAreaViewport
      class="h-full w-full min-h-0 flex flex-col p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)] box-border"
    >
      <div class="flex flex-col gap-[calc(var(--pxd-section-gap)*2.4)]">
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

        <!-- 通知音效（ADR-0016）：播放官方 <audio>，可直接於主控台讀寫官網音量與音效設定 -->
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

          <!-- 官方音效選擇 + 自訂上傳 + 試聽 -->
          <div class="flex flex-col gap-[var(--pxd-space-xs)]">
            <span class="text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground">
              {{ t('liveSearch.sound.fileLabel') }}
            </span>
            <div class="flex min-w-0 items-center gap-[var(--pxd-space-xs)]">
              <Select
                :model-value="selectedSoundValue"
                :disabled="!soundNotifier"
                @update:model-value="handleSelectSound"
              >
                <SelectTrigger
                  size="sm"
                  data-test="official-sound-select"
                  class="min-w-0 flex-1 text-[length:var(--pxd-font-caption)]"
                  :aria-label="t('liveSearch.sound.fileLabel')"
                >
                  <SelectValue>{{ selectedSoundLabel }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in OFFICIAL_SOUND_OPTIONS"
                    :key="option.file"
                    :value="option.file"
                  >
                    {{ builtInSoundLabel(option.id) }}
                  </SelectItem>
                  <SelectItem v-if="officialSetting.custom" :value="CUSTOM_SOUND_SELECT_VALUE">
                    {{ customSoundLabel }}
                  </SelectItem>
                  <SelectItem v-else-if="isUnknownBuiltInFile" :value="officialSetting.file">
                    {{ unknownSoundLabel }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <input
                ref="customFileInputRef"
                type="file"
                accept="audio/*"
                class="sr-only"
                data-test="input-sound-upload"
                @change="handleUploadCustomSound"
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                data-test="btn-sound-upload"
                :disabled="!soundNotifier"
                :title="t('liveSearch.sound.uploadTitle')"
                :aria-label="t('liveSearch.sound.uploadTitle')"
                @click="triggerUploadCustomSound"
              >
                <Upload aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-test="btn-sound-preview"
                :disabled="!soundNotifier"
                class="shrink-0 text-[length:var(--pxd-font-caption)]"
                @click="handlePreviewSound"
              >
                <Play aria-hidden="true" />
                {{ t('liveSearch.sound.previewBtn') }}
              </Button>
            </div>
          </div>

          <!-- 官方音量滑桿（0–100%） -->
          <div class="flex flex-col gap-[var(--pxd-space-xs)]">
            <div class="flex items-center justify-between gap-[var(--pxd-space-xs)]">
              <label
                for="live-search-official-volume"
                class="text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground"
              >
                {{ t('liveSearch.sound.volumeLabel') }}
              </label>
              <span
                data-test="official-sound-volume-value"
                class="text-[length:var(--pxd-font-caption)] font-medium tabular-nums text-foreground"
              >
                {{
                  officialSetting.volume === 0
                    ? t('liveSearch.sound.volumeMuted')
                    : `${officialSetting.volume}%`
                }}
              </span>
            </div>
            <input
              id="live-search-official-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              data-test="official-sound-volume"
              :disabled="!soundNotifier"
              :value="officialSetting.volume"
              :aria-label="t('liveSearch.sound.volumeLabel')"
              class="h-4 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
              @input="handleVolumeInput"
              @change="handleVolumeChange"
            />
          </div>

          <p
            v-if="previewMessage"
            data-test="sound-preview-message"
            role="status"
            class="m-0 text-[length:var(--pxd-font-caption)] leading-[1.45] text-amber-500"
          >
            {{ previewMessage }}
          </p>
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
import { computed, ref, watch, onMounted, onUnmounted, type PropType } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ListOrdered, Play, RotateCcw, Upload, Volume2 } from '@lucide/vue';
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
import {
  getOfficialSoundSettingKey,
  OFFICIAL_CUSTOM_SOUND_MAX_BYTES,
  OFFICIAL_DEFAULT_SOUND_FILE,
  OFFICIAL_DEFAULT_SOUND_VOLUME,
  OFFICIAL_SOUND_OPTIONS,
  type LiveSearchSoundNotifier,
  type LiveSearchSoundPlayOutcome,
  type OfficialBuiltInSoundId,
  type OfficialSoundSetting,
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
const customFileInputRef = ref<HTMLInputElement | null>(null);
const CUSTOM_SOUND_SELECT_VALUE = '__custom__';
const officialSettingKey = getOfficialSoundSettingKey(version);
const officialSetting = ref<OfficialSoundSetting>({
  file: OFFICIAL_DEFAULT_SOUND_FILE,
  volume: OFFICIAL_DEFAULT_SOUND_VOLUME,
  custom: false,
  name: null,
});

const BUILTIN_SOUND_LABEL_KEYS: Record<OfficialBuiltInSoundId, I18nKey> = {
  pulse: 'liveSearch.sound.option.pulse',
  piano: 'liveSearch.sound.option.piano',
  chime: 'liveSearch.sound.option.chime',
  gong: 'liveSearch.sound.option.gong',
};

function builtInSoundLabel(id: OfficialBuiltInSoundId): string {
  return t(BUILTIN_SOUND_LABEL_KEYS[id]);
}

const isUnknownBuiltInFile = computed(
  () =>
    !officialSetting.value.custom &&
    !OFFICIAL_SOUND_OPTIONS.some((opt) => opt.file === officialSetting.value.file),
);

const customSoundLabel = computed(() =>
  officialSetting.value.name
    ? t('liveSearch.sound.customNamed', { name: officialSetting.value.name })
    : t('liveSearch.sound.customUnnamed'),
);

const unknownSoundLabel = computed(() => {
  const parts = officialSetting.value.file.split('/');
  return parts[parts.length - 1] || officialSetting.value.file;
});

const selectedSoundValue = computed(() =>
  officialSetting.value.custom ? CUSTOM_SOUND_SELECT_VALUE : officialSetting.value.file,
);

const selectedSoundLabel = computed(() => {
  if (officialSetting.value.custom) return customSoundLabel.value;
  const builtIn = OFFICIAL_SOUND_OPTIONS.find((opt) => opt.file === officialSetting.value.file);
  return builtIn ? builtInSoundLabel(builtIn.id) : unknownSoundLabel.value;
});

function refreshOfficialSetting() {
  if (!props.soundNotifier?.readOfficialSetting) return;
  officialSetting.value = props.soundNotifier.readOfficialSetting();
}

function handleStorageSync(event: StorageEvent) {
  if (event.key === null || event.key === officialSettingKey) {
    refreshOfficialSetting();
  }
}

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

watch(
  () => props.soundNotifier,
  () => {
    refreshOfficialSetting();
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
  refreshOfficialSetting();
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageSync);
  }
});

onUnmounted(() => {
  stopPreferences?.();
  stopResumeSub?.();
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', handleStorageSync);
  }
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

function handleVolumeInput(event: Event) {
  if (!props.soundNotifier?.updateOfficialVolume) return;
  const next = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(next)) return;
  previewMessage.value = '';
  const outcome = props.soundNotifier.updateOfficialVolume(next);
  if (outcome.ok) {
    officialSetting.value = outcome.setting;
  } else {
    previewMessage.value = t('liveSearch.sound.saveFailed');
  }
}

async function handleVolumeChange() {
  if (!props.soundNotifier || officialSetting.value.volume === 0) return;
  await handlePreviewSound();
}

async function handleSelectSound(value: unknown) {
  if (!props.soundNotifier?.updateOfficialSound) return;
  const selected = String(value);
  if (selected === CUSTOM_SOUND_SELECT_VALUE) return;
  previewMessage.value = '';
  const outcome = props.soundNotifier.updateOfficialSound({
    file: selected,
    custom: false,
    name: null,
  });
  if (!outcome.ok) {
    previewMessage.value = t('liveSearch.sound.saveFailed');
    return;
  }
  officialSetting.value = outcome.setting;
  if (officialSetting.value.volume > 0) {
    await handlePreviewSound();
  }
}

function triggerUploadCustomSound() {
  customFileInputRef.value?.click();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

async function handleUploadCustomSound(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !props.soundNotifier?.updateOfficialSound) return;

  previewMessage.value = '';
  if (file.size > OFFICIAL_CUSTOM_SOUND_MAX_BYTES) {
    previewMessage.value = t('liveSearch.sound.uploadTooLarge');
    return;
  }

  let dataUrl = '';
  try {
    dataUrl = await readFileAsDataUrl(file);
  } catch {
    previewMessage.value = t('liveSearch.sound.uploadInvalid');
    return;
  }
  if (!dataUrl.startsWith('data:audio/')) {
    previewMessage.value = t('liveSearch.sound.uploadInvalid');
    return;
  }

  const outcome = props.soundNotifier.updateOfficialSound({
    file: dataUrl,
    custom: true,
    name: file.name,
  });
  if (!outcome.ok) {
    previewMessage.value =
      outcome.reason === 'storage'
        ? t('liveSearch.sound.saveFailed')
        : t('liveSearch.sound.uploadInvalid');
    return;
  }
  officialSetting.value = outcome.setting;
  if (officialSetting.value.volume > 0) {
    await handlePreviewSound();
  }
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
