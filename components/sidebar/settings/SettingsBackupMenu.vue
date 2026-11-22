<script setup lang="ts">
import { ref } from 'vue';
import { Download, MoreVertical, RotateCcw, Upload } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { downloadTextFile } from '@/utils/download-file';
import { t } from '@/utils/i18n';
import { getPreferences, type PreferencesModule } from '@/utils/preferences';
import {
  applyParsedSettingsImport,
  applySettingsImport,
  createSettingsExport,
  parseSettingsImport,
  resetSettingsToDefaults,
} from '@/utils/settings-transfer';
import type { PoeVersion } from '@/utils/trade-context';

type DialogWindow = Window & {
  poexdConfirm?: (message: string, title?: string) => Promise<boolean>;
  poexdAlert?: (message: string, title?: string) => Promise<void>;
};

const props = defineProps<{
  preferences: PreferencesModule | null;
  version: PoeVersion;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const busy = ref(false);

const toast = (message: string) => dispatchPoeEvent('poexd-toast', { message });
const alertError = async (message: string) => {
  const dialog = (window as DialogWindow).poexdAlert;
  if (typeof dialog === 'function') await dialog(message, t('settings.section.backup'));
  else toast(message);
};

const runBusyAction = async (action: (prefs: PreferencesModule) => Promise<void>) => {
  if (!props.preferences || busy.value) return;
  busy.value = true;
  try {
    await action(props.preferences);
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

const resolveAllVersionModules = async (
  currentPrefs: PreferencesModule,
): Promise<Record<PoeVersion, PreferencesModule> | null> => {
  const otherVersion: PoeVersion = props.version === 'poe1' ? 'poe2' : 'poe1';
  const otherOutcome = await getPreferences(otherVersion);
  if (!otherOutcome.ok) {
    await alertError(t('settings.backup.error.failed', { message: otherOutcome.error.message }));
    return null;
  }
  return props.version === 'poe1'
    ? { poe1: currentPrefs, poe2: otherOutcome.value }
    : { poe1: otherOutcome.value, poe2: currentPrefs };
};

const exportSettings = async () => {
  await runBusyAction(async (prefs) => {
    const modules = await resolveAllVersionModules(prefs);
    if (!modules) return;
    const payload = createSettingsExport(
      { poe1: modules.poe1.read(), poe2: modules.poe2.read() },
      props.version,
    );
    downloadTextFile({
      content: JSON.stringify(payload, null, 2),
      filename: `poexd_settings_${payload.exportedAt.split('T')[0]}.json`,
      mimeType: 'application/json',
    });
    toast(t('settings.backup.toast.exported'));
  });
};

const pickImportFile = () => fileInputRef.value?.click();

const importSettings = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await runBusyAction(async (prefs) => {
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
    let result;
    if (parsed.data.version === 1) {
      result = await applySettingsImport(prefs, parsed.data.preferences);
    } else {
      const modules = await resolveAllVersionModules(prefs);
      if (!modules) return;
      result = await applyParsedSettingsImport(modules, parsed.data, props.version);
    }
    const skipped = result.rejected.length + parsed.unknown.length;
    toast(
      skipped > 0
        ? t('settings.backup.toast.importedPartial', { count: result.applied.length, skipped })
        : t('settings.backup.toast.imported', { count: result.applied.length }),
    );
  });
};

const resetSettings = async () => {
  await runBusyAction(async (prefs) => {
    const confirm = (window as DialogWindow).poexdConfirm;
    const confirmed =
      typeof confirm === 'function'
        ? await confirm(t('settings.backup.reset.confirm'), t('settings.backup.reset.label'))
        : false;
    if (!confirmed) return;
    const outcome = await resetSettingsToDefaults(prefs);
    if (outcome.ok) toast(t('settings.backup.toast.reset'));
    else await alertError(t('settings.backup.error.failed', { message: outcome.error.message }));
  });
};
</script>

<template>
  <div class="shrink-0">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          data-settings-backup-menu
          :title="t('settings.section.backup')"
          :aria-label="t('settings.section.backup')"
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-settings-backup="export"
          :disabled="!props.preferences || busy"
          @click="exportSettings"
        >
          <Download class="text-muted-foreground" />
          {{ t('settings.backup.export.label') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-settings-backup="import"
          :disabled="!props.preferences || busy"
          @click="pickImportFile"
        >
          <Upload class="text-muted-foreground" />
          {{ t('settings.backup.import.label') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-settings-backup="reset"
          :disabled="!props.preferences || busy"
          @click="resetSettings"
        >
          <RotateCcw />
          {{ t('settings.backup.reset.label') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <input
      ref="fileInputRef"
      type="file"
      accept="application/json,.json"
      class="hidden"
      data-settings-backup-file
      @change="importSettings"
    />
  </div>
</template>
