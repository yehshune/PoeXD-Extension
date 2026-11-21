<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowUpFromLine, ClipboardPaste } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import {
  parseStatGroupTemplateTransfer,
  type StatGroupTemplateEntry,
} from '@/utils/stat-group-template-transfer';
import {
  describeStatGroupsTooltip,
  formatCompactStatGroupChip,
} from '@/components/injected/criteria-overlay-labels';
import type { PoeVersion } from '@/utils/trade-context';
import { t } from '@/utils/i18n';

const props = defineProps<{
  open: boolean;
  version: PoeVersion;
  busy?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  import: [payload: { entries: StatGroupTemplateEntry[]; skipped: number }];
}>();

const rawInput = ref('');
const parseError = ref<string | null>(null);
const parsedEntries = ref<StatGroupTemplateEntry[]>([]);
const skippedCount = ref(0);
const selectedIndices = ref<Set<number>>(new Set());
const fileInputRef = ref<HTMLInputElement | null>(null);

function resetState() {
  rawInput.value = '';
  parseError.value = null;
  parsedEntries.value = [];
  skippedCount.value = 0;
  selectedIndices.value = new Set();
}

watch(
  () => props.open,
  (open) => {
    if (!open) resetState();
  },
);

function parseContent(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    parseError.value = null;
    parsedEntries.value = [];
    skippedCount.value = 0;
    selectedIndices.value = new Set();
    return;
  }
  try {
    const result = parseStatGroupTemplateTransfer(trimmed, props.version);
    parseError.value = null;
    parsedEntries.value = result.entries;
    skippedCount.value = result.skipped;
    selectedIndices.value = new Set(result.entries.map((_, idx) => idx));
  } catch (err) {
    parsedEntries.value = [];
    skippedCount.value = 0;
    selectedIndices.value = new Set();
    parseError.value = err instanceof Error ? err.message : String(err);
  }
}

watch(rawInput, (val) => {
  if (props.open) parseContent(val);
});

async function pasteFromClipboard() {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      parseError.value = t('bookmarkImport.error.clipboardEmpty');
      return;
    }
    rawInput.value = text;
  } catch (err) {
    parseError.value =
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? t('bookmarkImport.error.clipboardDenied')
        : t('bookmarkImport.error.clipboardFailed');
  }
}

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function readFile(file: File) {
  try {
    rawInput.value = (await file.text()).trim();
  } catch {
    parseError.value = t('bookmarkImport.error.fileReadFailed');
  }
}

function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void readFile(file);
}

function handleFileDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (file) void readFile(file);
}

function toggleIndex(index: number, checked: boolean | 'indeterminate') {
  const next = new Set(selectedIndices.value);
  if (checked === true) next.add(index);
  else next.delete(index);
  selectedIndices.value = next;
}

const allSelected = computed(
  () => parsedEntries.value.length > 0 && selectedIndices.value.size === parsedEntries.value.length,
);

function toggleAll() {
  if (allSelected.value) {
    selectedIndices.value = new Set();
  } else {
    selectedIndices.value = new Set(parsedEntries.value.map((_, idx) => idx));
  }
}

const selectedEntries = computed(() =>
  parsedEntries.value.filter((_, idx) => selectedIndices.value.has(idx)),
);

const canConfirm = computed(() => !props.busy && selectedEntries.value.length > 0);

function entrySummary(entry: StatGroupTemplateEntry): string {
  const totalAffixes = entry.statGroups.reduce((sum, g) => sum + g.filters.length, 0);
  const chips = entry.statGroups.map(formatCompactStatGroupChip).join(' ');
  return `${chips} · ${totalAffixes} ${t('statGroupTemplate.unit.affixes')}`;
}

function handleSubmit() {
  if (!canConfirm.value) return;
  emit('import', {
    entries: selectedEntries.value,
    skipped: 0,
  });
  emit('update:open', false);
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      layer="system"
      data-test="stat-group-template-import-dialog"
      class="flex max-h-[calc(100vh-32px)] w-[min(94vw,480px)] max-w-[min(94vw,480px)] flex-col gap-[var(--pxd-space-md)] p-[var(--pxd-pane-padding)]"
      @dragover.prevent
      @drop.prevent="!busy && handleFileDrop($event)"
    >
      <DialogHeader class="shrink-0 text-left pr-[var(--pxd-space-2xl)]">
        <DialogTitle class="text-[length:var(--pxd-font-section-title)] font-bold">
          {{ t('statGroupTemplate.dialog.importTitle') }}
        </DialogTitle>
        <DialogDescription class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
          {{ t('statGroupTemplate.import.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]">
        <Input
          v-model="rawInput"
          size="sm"
          data-test="stat-group-template-import-input"
          class="min-w-0 flex-1 font-mono"
          :placeholder="t('statGroupTemplate.import.placeholder')"
          :disabled="busy"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-test="stat-group-template-import-paste"
          :disabled="busy"
          @click="pasteFromClipboard"
        >
          <ClipboardPaste />
          {{ t('bookmarkImport.action.pasteClipboard') }}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-test="stat-group-template-import-file-btn"
          :disabled="busy"
          @click="triggerFileInput"
        >
          <ArrowUpFromLine />
          {{ t('statGroupTemplate.import.chooseFile') }}
        </Button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json,.txt"
          class="hidden"
          data-test="stat-group-template-import-file"
          @change="handleFileSelected"
        />
      </div>

      <div
        v-if="parseError"
        role="alert"
        data-test="stat-group-template-import-error"
        class="break-words text-[length:var(--pxd-font-secondary)] text-destructive"
      >
        {{ parseError }}
      </div>

      <template v-if="parsedEntries.length > 0">
        <div
          class="flex items-center justify-between gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
        >
          <span>
            {{
              t('statGroupTemplate.import.selectedSummary', {
                selected: selectedEntries.length,
                total: parsedEntries.length,
              })
            }}
            <template v-if="skippedCount > 0">
              {{ t('statGroupTemplate.import.skippedNotice', { skipped: skippedCount }) }}
            </template>
          </span>
          <Button
            v-if="parsedEntries.length > 1"
            type="button"
            variant="ghost"
            size="sm"
            data-test="stat-group-template-import-toggle-all"
            @click="toggleAll"
          >
            {{
              allSelected
                ? t('statGroupTemplate.dialog.clearAll')
                : t('statGroupTemplate.dialog.selectAll')
            }}
          </Button>
        </div>

        <ScrollAreaRoot
          class="relative max-h-[240px] min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
        >
          <ScrollAreaViewport class="h-full w-full min-h-0 p-[var(--pxd-space-sm)]">
            <div class="flex flex-col gap-[var(--pxd-space-xs)]">
              <label
                v-for="(entry, idx) in parsedEntries"
                :key="idx"
                data-test="stat-group-template-import-item"
                :title="describeStatGroupsTooltip(entry.statGroups, version)"
                class="flex cursor-pointer items-start gap-[var(--pxd-space-sm)] rounded-sm px-[var(--pxd-space-xs)] py-[var(--pxd-space-xs)] hover:bg-accent/50"
              >
                <Checkbox
                  class="mt-0.5 shrink-0"
                  :model-value="selectedIndices.has(idx)"
                  @update:model-value="toggleIndex(idx, $event)"
                />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span
                    class="truncate text-[length:var(--pxd-font-body)] font-medium text-foreground"
                  >
                    {{ entry.name }}
                  </span>
                  <span class="truncate text-[length:var(--pxd-font-micro)] text-muted-foreground">
                    {{ entrySummary(entry) }}
                  </span>
                </span>
              </label>
            </div>
          </ScrollAreaViewport>
          <ScrollBar />
          <ScrollAreaCorner />
        </ScrollAreaRoot>
      </template>

      <DialogFooter class="flex items-center justify-end gap-[var(--pxd-space-xs)]">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="busy"
          @click="emit('update:open', false)"
        >
          {{ t('common.cancel') }}
        </Button>
        <Button
          type="button"
          size="sm"
          data-test="stat-group-template-import-confirm"
          :disabled="!canConfirm"
          @click="handleSubmit"
        >
          {{
            selectedEntries.length > 0
              ? t('statGroupTemplate.import.confirmBtn', { count: selectedEntries.length })
              : t('bookmarkImport.action.import')
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
