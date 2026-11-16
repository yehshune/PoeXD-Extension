<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { t, type I18nKey } from '@/utils/i18n';

const props = defineProps<{
  open: boolean;
  isBusy: boolean;
  errorKey: I18nKey | null;
}>();

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'submit', code: string): void;
  (e: 'clear-error'): void;
}>();

const codeInput = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (open) {
      emit('clear-error');
      await nextTick();
      textareaRef.value?.focus?.();
    } else {
      codeInput.value = '';
      emit('clear-error');
    }
  },
);

function handleOpenChange(open: boolean) {
  if (!open && props.isBusy) return;
  emit('update:open', open);
}

function handleSubmit() {
  if (props.isBusy || !codeInput.value.trim()) return;
  emit('submit', codeInput.value);
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="w-[min(94vw,520px)] max-w-[min(94vw,520px)] flex flex-col gap-[var(--pxd-space-lg)] p-[var(--pxd-space-2xl)]"
    >
      <DialogHeader class="gap-[var(--pxd-space-xs)]">
        <DialogTitle class="text-[length:var(--pxd-font-heading)] font-bold">
          {{ t('pobBuild.importDialogTitle') }}
        </DialogTitle>
        <DialogDescription class="text-[length:var(--pxd-font-secondary)] text-muted-foreground">
          {{ t('pobBuild.description') }}
        </DialogDescription>
      </DialogHeader>

      <textarea
        ref="textareaRef"
        v-model="codeInput"
        data-pob-build-input
        rows="5"
        spellcheck="false"
        :placeholder="t('pobBuild.placeholder')"
        :disabled="isBusy"
        class="w-full resize-y rounded-md border border-input bg-background px-[var(--input-padding-x-default)] py-[var(--pxd-space-sm)] font-mono text-[length:var(--pxd-font-caption)] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        @keydown.ctrl.enter.prevent="handleSubmit"
        @keydown.meta.enter.prevent="handleSubmit"
      ></textarea>

      <div
        v-if="errorKey"
        role="alert"
        data-pob-build-import-error
        class="break-words text-[length:var(--pxd-font-caption)] text-destructive"
      >
        {{ t(errorKey) }}
      </div>

      <DialogFooter class="gap-[var(--pxd-space-sm)]">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="isBusy"
          data-pob-build-import-cancel
          @click="handleOpenChange(false)"
        >
          {{ t('pobBuild.cancelBtn') }}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          :disabled="isBusy || !codeInput.trim()"
          data-pob-build-import
          @click="handleSubmit"
        >
          {{ isBusy ? t('pobBuild.importingBtn') : t('pobBuild.importBtn') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
