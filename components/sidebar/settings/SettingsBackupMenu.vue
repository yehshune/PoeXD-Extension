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
import type { PreferencesModule } from '@/utils/preferences';
import {
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

const exportSettings = () => {
  if (!props.preferences) return;
  const payload = createSettingsExport(props.preferences.read(), props.version);
  downloadTextFile({
    content: JSON.stringify(payload, null, 2),
    filename: `poexd_settings_${props.version}_${payload.exportedAt.split('T')[0]}.json`,
    mimeType: 'application/json',
  });
  toast(t('settings.backup.toast.exported'));
};

const pickImportFile = () => fileInputRef.value?.click();

const runBusyAction = async (action: (prefs: PreferencesModule) => Promise<void>) => {
  if (!props.preferences || busy.value) return;
  busy.value = true;
  try {
    await action(props.preferences);
  } finally {
    busy.value = false;
  }
};

const importSettings = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await runBusyAction(async (prefs) => {
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
      const result = await applySettingsImport(prefs, parsed.preferences);
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
    }
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
          variant="secondary"
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
          :disabled="!props.preferences"
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
