<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ArchiveRestore, Download, RotateCcw, Upload } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { downloadTextFile } from '@/utils/download-file';
import { t } from '@/utils/i18n';
import { getPreferences, type PreferencesModule } from '@/utils/preferences';
import {
  applySettingsImport,
  createSettingsExport,
  parseSettingsImport,
  resetSettingsToDefaults,
} from '@/utils/settings-transfer';
import { getPoeVersion } from '@/utils/trade-context';
import SettingsRow from './SettingsRow.vue';
import SettingsSection from './SettingsSection.vue';

type DialogWindow = Window & {
  poexdConfirm?: (message: string, title?: string) => Promise<boolean>;
  poexdAlert?: (message: string, title?: string) => Promise<void>;
};

const version = getPoeVersion();
const preferences = ref<PreferencesModule | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const busy = ref(false);

onMounted(async () => {
  const outcome = await getPreferences(version);
  if (outcome.ok) preferences.value = outcome.value;
});

const toast = (message: string) => dispatchPoeEvent('poexd-toast', { message });
const alertError = async (message: string) => {
  const dialog = (window as DialogWindow).poexdAlert;
  if (typeof dialog === 'function') await dialog(message, t('settings.section.backup'));
  else toast(message);
};

const exportSettings = () => {
  if (!preferences.value) return;
  const payload = createSettingsExport(preferences.value.read(), version);
  downloadTextFile({
    content: JSON.stringify(payload, null, 2),
    filename: `poexd_settings_${version}_${payload.exportedAt.split('T')[0]}.json`,
    mimeType: 'application/json',
  });
  toast(t('settings.backup.toast.exported'));
};

const pickImportFile = () => fileInputRef.value?.click();

const importSettings = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !preferences.value || busy.value) return;
  busy.value = true;
  try {
    const parsed = parseSettingsImport(await file.text());
    if (!parsed.ok) {
      await alertError(
        t(
          parsed.error === 'invalid-json'
            ? 'settings.backup.error.invalidJson'
            : 'settings.backup.error.wrongFormat',
        ),
      );
      return;
    }
    const result = await applySettingsImport(preferences.value, parsed.preferences);
    const skipped = result.rejected.length + parsed.unknown.length;
    toast(
      skipped > 0
        ? t('settings.backup.toast.importedPartial', { count: result.applied.length, skipped })
        : t('settings.backup.toast.imported', { count: result.applied.length }),
    );
  } catch (error) {
    await alertError(
      t('settings.backup.error.failed', {
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    busy.value = false;
  }
};

const resetSettings = async () => {
  if (!preferences.value || busy.value) return;
  const confirm = (window as DialogWindow).poexdConfirm;
  const confirmed =
    typeof confirm === 'function'
      ? await confirm(t('settings.backup.reset.confirm'), t('settings.backup.reset.label'))
      : false;
  if (!confirmed) return;
  busy.value = true;
  try {
    const outcome = await resetSettingsToDefaults(preferences.value);
    if (outcome.ok) toast(t('settings.backup.toast.reset'));
    else await alertError(t('settings.backup.error.failed', { message: outcome.error.message }));
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <SettingsSection section-id="backup" :title="t('settings.section.backup')" :icon="ArchiveRestore">
    <SettingsRow
      :label="t('settings.backup.export.label')"
      :details="t('settings.backup.export.details')"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="w-[140px]"
        data-settings-backup="export"
        :disabled="!preferences"
        @click="exportSettings"
      >
        <Download />
        {{ t('settings.backup.export.button') }}
      </Button>
    </SettingsRow>

    <SettingsRow
      :label="t('settings.backup.import.label')"
      :details="t('settings.backup.import.details')"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="w-[140px]"
        data-settings-backup="import"
        :disabled="!preferences || busy"
        @click="pickImportFile"
      >
        <Upload />
        {{ t('settings.backup.import.button') }}
      </Button>
      <input
        ref="fileInputRef"
        type="file"
        accept="application/json,.json"
        class="hidden"
        data-settings-backup-file
        @change="importSettings"
      />
    </SettingsRow>

    <SettingsRow
      :label="t('settings.backup.reset.label')"
      :details="t('settings.backup.reset.details')"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="w-[140px] text-destructive hover:text-destructive"
        data-settings-backup="reset"
        :disabled="!preferences || busy"
        @click="resetSettings"
      >
        <RotateCcw />
        {{ t('settings.backup.reset.button') }}
      </Button>
    </SettingsRow>
  </SettingsSection>
</template>
