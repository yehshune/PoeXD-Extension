<script setup lang="ts">
import { watch } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import { t } from '@/utils/i18n';
import { installDialogGlobals, useSidebarDialog } from '../composables/useSidebarDialog';

installDialogGlobals();

const emit = defineEmits<{
  'open-change': [open: boolean];
}>();

const {
  dialogState,
  handleDialogConfirm,
  handleDialogCancel,
  handleCustomButtonClick,
  handleDialogDismiss,
} = useSidebarDialog();

const setSharedDialogOpen = (open: boolean) => {
  if (open) return;

  if (dialogState.value.isOpen) {
    handleDialogDismiss();
  }
};

watch(
  () => dialogState.value.isOpen,
  (open) => {
    emit('open-change', open);
  },
  { flush: 'sync' },
);
</script>

<template>
  <!-- 全域共用對話框 Modal (Confirm / Alert / Prompt / Custom) -->
  <Dialog :open="dialogState.isOpen" @update:open="setSharedDialogOpen">
    <DialogContent
      layer="system"
      data-sidebar-dialog="shared"
      class="flex h-auto max-h-[min(var(--pxd-sidebar-shared-dialog-max-height),calc(100vh-32px))] w-[var(--pxd-sidebar-shared-dialog-width)] max-w-[calc(100vw-32px)] flex-col gap-[var(--pxd-space-lg)] p-[var(--pxd-pane-padding)]"
      @pointer-down-outside="(e) => e.preventDefault()"
      @interact-outside="(e) => e.preventDefault()"
      @escape-key-down="(e) => e.preventDefault()"
    >
      <DialogHeader class="shrink-0 gap-[var(--pxd-space-sm)] text-left pr-[var(--pxd-space-2xl)]">
        <DialogTitle class="text-[length:var(--pxd-font-section-title)] font-bold tracking-[0.5px]">
          {{ dialogState.title }}
        </DialogTitle>
      </DialogHeader>

      <ScrollAreaRoot data-sidebar-dialog-body class="relative min-h-0 flex-1 overflow-hidden">
        <ScrollAreaViewport class="h-full w-full min-h-0">
          <DialogDescription
            class="text-[length:var(--pxd-font-caption)] leading-[1.5] m-0 break-words [overflow-wrap:anywhere] whitespace-pre-wrap"
          >
            {{ dialogState.message }}
          </DialogDescription>
        </ScrollAreaViewport>
        <ScrollBar />
        <ScrollAreaCorner />
      </ScrollAreaRoot>

      <div v-if="dialogState.type === 'prompt'" class="w-full shrink-0">
        <Input
          v-model="dialogState.inputValue"
          type="text"
          size="default"
          class="dialog-input w-full"
          :placeholder="dialogState.inputPlaceholder"
          data-sidebar-dialog-input
          @keyup.enter="handleDialogConfirm"
        />
      </div>

      <div
        :class="[
          'shrink-0 flex gap-[var(--pxd-space-md)] mt-[var(--pxd-space-sm)]',
          dialogState.type === 'custom' ? 'flex-col items-stretch' : 'justify-end',
        ]"
      >
        <template
          v-if="
            dialogState.type === 'custom' && dialogState.buttons && dialogState.buttons.length > 0
          "
        >
          <Button
            v-for="(btn, idx) in dialogState.buttons"
            :key="idx"
            type="button"
            :variant="btn.variant || 'outline'"
            size="sm"
            class="w-full text-center"
            data-sidebar-dialog-action="custom"
            @click="handleCustomButtonClick(btn.value)"
          >
            {{ btn.label }}
          </Button>
        </template>
        <template v-else>
          <Button
            type="button"
            variant="default"
            size="sm"
            data-sidebar-dialog-action="confirm"
            @click="handleDialogConfirm"
          >
            {{ dialogState.confirmLabel || t('common.confirm') + ' (Enter)' }}
          </Button>
          <Button
            v-if="dialogState.type !== 'alert'"
            type="button"
            variant="outline"
            size="sm"
            data-sidebar-dialog-action="cancel"
            @click="handleDialogCancel"
          >
            {{ dialogState.cancelLabel || t('common.cancel') + ' (Esc)' }}
          </Button>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
