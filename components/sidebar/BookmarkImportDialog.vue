<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="bookmark-import-dialog w-[min(94vw,680px)] max-w-[min(94vw,680px)] max-h-[88vh] flex flex-col overflow-hidden p-0"
    >
      <div
        class="import-drop-zone flex min-h-0 flex-1 flex-col gap-[var(--pxd-space-lg)] overflow-y-auto pxd-scrollbar p-[var(--pxd-space-2xl)]"
        @dragover.prevent
        @drop.prevent="!isBusy && handleFileDrop($event)"
      >
        <DialogHeader class="gap-[var(--pxd-space-xs)]">
          <DialogTitle class="text-[length:var(--pxd-font-heading)] font-bold">{{
            t('bookmarkImport.dialog.title')
          }}</DialogTitle>
          <DialogDescription class="text-[length:var(--pxd-font-secondary)] text-muted-foreground">
            {{ t('bookmarkImport.dialog.description') }}
          </DialogDescription>
        </DialogHeader>

        <!-- 來源：分享碼輸入、剪貼簿、備份檔 -->
        <div class="flex flex-wrap items-center gap-[var(--pxd-space-md)]">
          <Input
            v-model="shareCodeInput"
            :aria-label="t('bookmarkImport.input.ariaLabel')"
            class="min-w-0 flex-1 font-mono"
            :placeholder="t('bookmarkImport.input.placeholder')"
            :disabled="isBusy"
          />
          <Button variant="outline" size="sm" :disabled="isBusy" @click="pasteFromClipboard">
            <ClipboardPaste class="size-[var(--control-icon-sm,14px)]" />
            {{ t('bookmarkImport.action.pasteClipboard') }}
          </Button>
          <Button variant="outline" size="sm" :disabled="isBusy" @click="triggerFileInput">
            <ArrowUpFromLine class="size-[var(--control-icon-sm,14px)]" />
            {{ t('bookmarkImport.action.chooseFile') }}
          </Button>
          <input
            ref="fileInputRef"
            type="file"
            accept=".json,.txt"
            class="hidden"
            @change="handleFileSelected"
          />
        </div>

        <p
          v-if="isParsing"
          role="status"
          class="text-[length:var(--pxd-font-secondary)] text-muted-foreground"
        >
          {{ t('bookmarkImport.status.parsing') }}
        </p>
        <div
          v-if="parseError"
          role="alert"
          class="break-words text-[length:var(--pxd-font-body)] text-destructive"
        >
          {{ parseError }}
        </div>

        <template v-if="parsedPayload">
          <!-- 匯入方式：只有需要選擇時才顯示 -->
          <div v-if="showModeOptions" class="grid min-w-0 gap-[var(--pxd-space-sm)]">
            <div
              role="group"
              :aria-label="t('bookmarkImport.mode.groupAria')"
              class="grid grid-cols-1 gap-[var(--pxd-space-sm)] sm:grid-cols-3"
            >
              <button
                v-for="option in modeOptions"
                :key="option.mode"
                type="button"
                :aria-pressed="importMode === option.mode"
                class="import-mode-option flex h-[var(--control-height-sm,28px)] min-w-0 items-center justify-center rounded-md border px-[var(--pxd-space-md)] text-[length:var(--pxd-font-body)] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                :class="
                  importMode === option.mode
                    ? 'border-border bg-primary/15 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                "
                @click="importMode = option.mode"
              >
                <span class="truncate">{{ option.label }}</span>
              </button>
            </div>
            <p
              v-if="activeModeOption"
              class="text-[length:var(--pxd-font-secondary)] text-muted-foreground"
            >
              {{ activeModeOption.description }}
            </p>
          </div>

          <div
            v-if="isFolderScope && importMode !== 'create' && conflictInfo.candidates.length > 1"
            class="grid min-w-0 gap-[var(--pxd-space-sm)]"
          >
            <label class="text-[length:var(--pxd-font-secondary)]">{{
              t('bookmarkImport.targetFolder.label')
            }}</label>
            <Select v-model="targetGroupId">
              <SelectTrigger
                size="sm"
                class="w-full min-w-0"
                :aria-label="t('bookmarkImport.targetFolder.label')"
              >
                <SelectValue :placeholder="t('bookmarkImport.targetFolder.placeholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="candidate in conflictInfo.candidates"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.path }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <template v-if="currentPlan && !needsTarget">
            <div
              class="flex flex-wrap items-center justify-between gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)]"
            >
              <span class="text-muted-foreground">
                {{ version.toUpperCase() }} ·
                {{
                  isFolderScope ? t('bookmarkImport.scope.folder') : t('bookmarkImport.scope.all')
                }}（{{ incomingCounts.folders }} {{ t('bookmarkImport.unit.folders') }}、{{
                  incomingCounts.bookmarks
                }}
                {{ t('bookmarkImport.unit.bookmarks') }}）
              </span>
              <span class="import-summary tabular-nums text-foreground">
                {{
                  t('bookmarkImport.summary.created', {
                    folders: summary!.createdFoldersCount,
                    bookmarks: summary!.createdBookmarksCount,
                  })
                }}
                <template v-if="summary!.updatedBookmarksCount">
                  {{
                    t('bookmarkImport.summary.updated', { count: summary!.updatedBookmarksCount })
                  }}
                </template>
                <template v-if="summary!.skippedBookmarksCount">
                  {{
                    t('bookmarkImport.summary.skipped', { count: summary!.skippedBookmarksCount })
                  }}
                  <template v-if="summary!.skippedLegacyBookmarksCount">
                    {{
                      t('bookmarkImport.summary.skippedLegacy', {
                        count: summary!.skippedLegacyBookmarksCount,
                      })
                    }}
                  </template>
                </template>
                <span v-if="hasDestructiveChanges" class="text-destructive">
                  {{
                    t('bookmarkImport.summary.deleted', {
                      folders: summary!.deletedFoldersCount,
                      bookmarks: summary!.deletedBookmarksCount,
                    })
                  }}
                </span>
              </span>
            </div>
            <p
              v-if="hasDestructiveChanges"
              role="note"
              class="rounded-md border border-destructive/50 bg-destructive/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] text-destructive"
            >
              {{ t('bookmarkImport.warning.destructive') }}
            </p>
            <div
              class="import-diff-tree max-h-64 min-h-20 min-w-0 overflow-auto pxd-scrollbar rounded-md border border-border p-[var(--pxd-space-md)]"
              :aria-label="t('bookmarkImport.preview.ariaLabel')"
            >
              <BookmarkImportDiffNode
                v-for="folderNode in currentPlan.tree"
                :key="folderNode.id || folderNode.name"
                :node="folderNode"
                show-only-changed
                expand-all
              />
              <p
                v-if="currentPlan.tree.length === 0"
                class="px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-muted-foreground"
              >
                {{ t('bookmarkImport.preview.empty') }}
              </p>
            </div>
          </template>
          <p
            v-else-if="needsTarget"
            class="text-[length:var(--pxd-font-secondary)] text-muted-foreground"
          >
            {{ t('bookmarkImport.targetFolder.hint') }}
          </p>
        </template>

        <div
          class="flex flex-wrap justify-end gap-[var(--pxd-space-sm)] border-t border-border pt-[var(--pxd-space-lg)]"
        >
          <Button variant="outline" size="sm" :disabled="isBusy" @click="closeDialog">{{
            t('common.cancel')
          }}</Button>
          <Button
            class="import-confirm-button"
            size="sm"
            :variant="hasDestructiveChanges ? 'destructive' : 'default'"
            :disabled="isSubmitDisabled"
            @click="handleConfirmImport"
          >
            {{ submitButtonText }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowUpFromLine, ClipboardPaste } from '@lucide/vue';
import BookmarkImportDiffNode from './BookmarkImportDiffNode.vue';
import type { PoeVersion } from '@/utils/trade-context';
import { readBookmarkTargetContext } from '@/utils/bookmark-target';
import {
  decodeBookmarkTransfer,
  detectBookmarkImportConflict,
  planBookmarkTransferImport,
  type BookmarkImportMode,
  type BookmarkTransferFolder,
  type BookmarkTransferPayload,
  type BookmarkTransferPlan,
} from '@/utils/bookmark-transfer';
import { describeBookmarkImportError } from '@/utils/bookmark-transfer-messages';
import { t } from '@/utils/i18n';

function countIncoming(folders: readonly BookmarkTransferFolder[]): {
  folders: number;
  bookmarks: number;
} {
  return folders.reduce(
    (total, folder) => {
      const nested = countIncoming(folder.folders ?? []);
      return {
        folders: total.folders + 1 + nested.folders,
        bookmarks: total.bookmarks + folder.bookmarks.length + nested.bookmarks,
      };
    },
    { folders: 0, bookmarks: 0 },
  );
}

export default defineComponent({
  name: 'BookmarkImportDialog',
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    ArrowUpFromLine,
    ClipboardPaste,
    BookmarkImportDiffNode,
  },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    version: {
      type: String as PropType<PoeVersion>,
      required: true,
    },
    currentCollection: {
      type: Object as PropType<{
        groups: ReadonlyArray<{ id: string; name: string; order: number; parentId?: string }>;
        bookmarks: ReadonlyArray<{
          id: string;
          name: string;
          url: string;
          groupId: string;
          order: number;
          createdAt?: number;
          coverImageUrl?: string;
          leaguePinned?: true;
        }>;
      }>,
      required: true,
    },
    initialPayload: {
      type: Object as PropType<BookmarkTransferPayload | null>,
      default: null,
    },
  },
  emits: ['update:open', 'import'],
  setup(props, { emit }) {
    const shareCodeInput = ref('');
    const parseError = ref<string | null>(null);
    const isParsing = ref(false);
    const fileInputRef = ref<HTMLInputElement | null>(null);
    const parsedPayload = ref<BookmarkTransferPayload | null>(null);
    const importMode = ref<BookmarkImportMode>('create');
    const targetGroupId = ref('');
    let previousCandidateCount = 0;
    let parseRevision = 0;
    /** 以程式填入（檔案、剪貼簿）時，避免輸入框 watcher 重複解析同一份內容。 */
    let lastParsedInput = '';

    const isBusy = computed(() => isParsing.value);

    const resetDialogState = () => {
      parseRevision += 1;
      shareCodeInput.value = '';
      lastParsedInput = '';
      parseError.value = null;
      isParsing.value = false;
      parsedPayload.value = null;
      importMode.value = 'create';
      targetGroupId.value = '';
      previousCandidateCount = 0;
    };

    const applyParsedPayload = (payload: BookmarkTransferPayload) => {
      if (payload.gameVersion !== props.version) {
        parsedPayload.value = null;
        parseError.value = t('bookmarkImport.error.versionMismatch', {
          source: payload.gameVersion.toUpperCase(),
          target: props.version.toUpperCase(),
        });
        return;
      }
      parsedPayload.value = payload;
      parseError.value = null;
      importMode.value = 'create';
      previousCandidateCount = 0;
      const conflict = detectBookmarkImportConflict(payload, props.currentCollection.groups);
      targetGroupId.value = conflict.candidates.length === 1 ? conflict.candidates[0].id : '';
    };

    const parseInput = async (raw: string) => {
      const input = raw.trim();
      lastParsedInput = input;
      const revision = ++parseRevision;
      if (!input) {
        parsedPayload.value = null;
        parseError.value = null;
        isParsing.value = false;
        return;
      }
      isParsing.value = true;
      parseError.value = null;
      try {
        const payload = await decodeBookmarkTransfer(input, {
          gameVersion: props.version,
          fallbackLeague: readBookmarkTargetContext().league,
        });
        if (revision !== parseRevision) return;
        applyParsedPayload(payload);
      } catch (err) {
        if (revision !== parseRevision) return;
        parsedPayload.value = null;
        parseError.value = t('bookmarkImport.error.readFailed', {
          error: describeBookmarkImportError(err),
        });
      } finally {
        if (revision === parseRevision) isParsing.value = false;
      }
    };

    watch(shareCodeInput, (value) => {
      if (!props.open || value.trim() === lastParsedInput) return;
      void parseInput(value);
    });

    const loadInput = (text: string) => {
      const trimmed = text.trim();
      lastParsedInput = trimmed;
      shareCodeInput.value = trimmed;
      void parseInput(trimmed);
    };

    watch(
      () => props.open,
      (open) => {
        resetDialogState();
        if (open && props.initialPayload) applyParsedPayload(props.initialPayload);
      },
      { immediate: true },
    );

    watch(
      () => props.initialPayload,
      (payload) => {
        if (payload && props.open) applyParsedPayload(payload);
      },
    );

    const handleOpenChange = (open: boolean) => {
      emit('update:open', open);
    };

    const closeDialog = () => {
      emit('update:open', false);
    };

    const pasteFromClipboard = async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) {
          parseError.value = t('bookmarkImport.error.clipboardEmpty');
          return;
        }
        loadInput(text);
      } catch (err) {
        parseError.value =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? t('bookmarkImport.error.clipboardDenied')
            : t('bookmarkImport.error.clipboardFailed');
      }
    };

    const triggerFileInput = () => {
      fileInputRef.value?.click();
    };

    const readFile = async (file: File) => {
      try {
        loadInput(await file.text());
      } catch {
        parseError.value = t('bookmarkImport.error.fileReadFailed');
      }
    };

    const handleFileSelected = (event: Event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (file) void readFile(file);
    };

    const handleFileDrop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) void readFile(file);
    };

    const isFolderScope = computed(() => parsedPayload.value?.scope === 'folder');

    const incomingCounts = computed(() => countIncoming(parsedPayload.value?.folders ?? []));

    const conflictInfo = computed(() =>
      parsedPayload.value
        ? detectBookmarkImportConflict(parsedPayload.value, props.currentCollection.groups)
        : { hasConflict: false, candidates: [] },
    );

    /** 與 PoeXD 相同：資料夾範圍只在同名衝突時、全部範圍在已有書籤時才需要選擇匯入方式。 */
    const showModeOptions = computed(() =>
      isFolderScope.value
        ? conflictInfo.value.hasConflict
        : conflictInfo.value.hasConflict || props.currentCollection.groups.length > 0,
    );

    watch(
      () => [conflictInfo.value, showModeOptions.value] as const,
      ([conflict, hasModeOptions]) => {
        if (!hasModeOptions) importMode.value = 'create';
        const candidates = conflict.candidates;
        if (candidates.length === 1) {
          targetGroupId.value = candidates[0].id;
        } else if (
          previousCandidateCount <= 1 ||
          !candidates.some((candidate) => candidate.id === targetGroupId.value)
        ) {
          targetGroupId.value = '';
        }
        previousCandidateCount = candidates.length;
      },
      { immediate: true },
    );

    const modeOptions = computed(() => [
      {
        mode: 'create' as const,
        label: t('bookmarkImport.mode.create.label'),
        description: t('bookmarkImport.mode.create.description'),
      },
      {
        mode: 'merge' as const,
        label: isFolderScope.value
          ? t('bookmarkImport.mode.mergeFolder.label')
          : t('bookmarkImport.mode.mergeAll.label'),
        description: t('bookmarkImport.mode.merge.description'),
      },
      {
        mode: 'replace' as const,
        label: isFolderScope.value
          ? t('bookmarkImport.mode.replaceFolder.label')
          : t('bookmarkImport.mode.replaceAll.label'),
        description: isFolderScope.value
          ? t('bookmarkImport.mode.replaceFolder.description')
          : t('bookmarkImport.mode.replaceAll.description'),
      },
    ]);

    const activeModeOption = computed(() =>
      modeOptions.value.find((option) => option.mode === importMode.value),
    );

    const needsTarget = computed(
      () => isFolderScope.value && importMode.value !== 'create' && !targetGroupId.value,
    );

    const currentPlan = computed<BookmarkTransferPlan | null>(() => {
      if (!parsedPayload.value || needsTarget.value) return null;
      try {
        return planBookmarkTransferImport(
          parsedPayload.value,
          props.currentCollection,
          props.version,
          {
            mode: importMode.value,
            targetGroupId:
              isFolderScope.value && importMode.value !== 'create'
                ? targetGroupId.value || undefined
                : undefined,
          },
        );
      } catch {
        return null;
      }
    });

    const summary = computed(() => currentPlan.value?.summary);

    const hasDestructiveChanges = computed(() => {
      if (!currentPlan.value) return false;
      if (importMode.value === 'replace') return true;
      return (
        (summary.value?.deletedFoldersCount ?? 0) + (summary.value?.deletedBookmarksCount ?? 0) > 0
      );
    });

    const isSubmitDisabled = computed(
      () => isBusy.value || Boolean(parseError.value) || !currentPlan.value,
    );

    const submitButtonText = computed(() => {
      if (!parsedPayload.value) return t('bookmarkImport.action.import');
      if (importMode.value === 'replace') return t('bookmarkImport.action.replaceAndImport');
      if (importMode.value === 'merge') return t('bookmarkImport.action.mergeAndImport');
      return t('bookmarkImport.action.createAndImport');
    });

    const handleConfirmImport = () => {
      if (!parsedPayload.value || isSubmitDisabled.value || !currentPlan.value) return;
      emit('import', {
        payload: parsedPayload.value,
        mode: currentPlan.value.mode,
        targetGroupId:
          currentPlan.value.mode === 'create'
            ? undefined
            : currentPlan.value.targetGroupId || undefined,
      });
      closeDialog();
    };

    return {
      t,
      shareCodeInput,
      parseError,
      isParsing,
      isBusy,
      fileInputRef,
      parsedPayload,
      importMode,
      targetGroupId,
      handleOpenChange,
      closeDialog,
      pasteFromClipboard,
      triggerFileInput,
      handleFileSelected,
      handleFileDrop,
      isFolderScope,
      incomingCounts,
      conflictInfo,
      showModeOptions,
      modeOptions,
      activeModeOption,
      needsTarget,
      currentPlan,
      summary,
      hasDestructiveChanges,
      isSubmitDisabled,
      submitButtonText,
      handleConfirmImport,
    };
  },
});
</script>
