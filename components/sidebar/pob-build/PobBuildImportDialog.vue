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
import { Input } from '@/components/ui/input';
import { t, type I18nKey } from '@/utils/i18n';
import { POB_BUILD_NAME_MAX_LENGTH } from '@/utils/pob-build-store';

const props = withDefaults(
  defineProps<{
    open: boolean;
    isBusy: boolean;
    errorKey: I18nKey | null;
    /** update：替既有 build 換代碼，標題與按鈕文字不同 */
    mode?: 'import' | 'update';
    /** update 模式顯示在標題的 build 名稱 */
    buildName?: string;
    /** 預覽代碼對應的預設流派名稱，顯示於選填名稱欄位的 placeholder */
    previewName?: (code: string) => Promise<string | undefined>;
  }>(),
  { mode: 'import', buildName: '', previewName: undefined },
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'submit', code: string, name?: string): void;
  (e: 'clear-error'): void;
  (e: 'open-permission'): void;
}>();

const codeInput = ref('');
const nameInput = ref('');
const suggestedName = ref('');
const inputRef = ref<InstanceType<typeof Input> | null>(null);
let previewGeneration = 0;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      emit('clear-error');
      await nextTick();
      (inputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
    } else {
      previewGeneration += 1;
      codeInput.value = '';
      nameInput.value = '';
      suggestedName.value = '';
      emit('clear-error');
    }
  },
);

watch(codeInput, (value) => {
  if (!props.open || props.mode !== 'import' || !props.previewName) {
    suggestedName.value = '';
    return;
  }
  const generation = ++previewGeneration;
  if (!value.trim()) {
    suggestedName.value = '';
    return;
  }
  void props
    .previewName(value)
    .then((name) => {
      if (generation === previewGeneration) suggestedName.value = name ?? '';
    })
    .catch(() => {
      if (generation === previewGeneration) suggestedName.value = '';
    });
});

function handleOpenChange(open: boolean) {
  if (!open && props.isBusy) return;
  emit('update:open', open);
}

function handleSubmit() {
  if (props.isBusy || !codeInput.value.trim()) return;
  const trimmedName = props.mode === 'import' ? nameInput.value.trim() : '';
  emit('submit', codeInput.value, trimmedName || undefined);
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="w-[min(94vw,520px)] max-w-[min(94vw,520px)] flex flex-col gap-[var(--pxd-space-lg)] p-[var(--pxd-space-2xl)]"
    >
      <DialogHeader class="gap-[var(--pxd-space-xs)]">
        <DialogTitle class="text-[length:var(--pxd-font-heading)] font-bold">
          {{
            mode === 'update'
              ? t('pobBuild.updateDialogTitle', { name: buildName })
              : t('pobBuild.importDialogTitle')
          }}
        </DialogTitle>
        <DialogDescription class="text-[length:var(--pxd-font-secondary)] text-muted-foreground">
          {{ mode === 'update' ? t('pobBuild.updateDescription') : t('pobBuild.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-[var(--pxd-space-md)]">
        <Input
          ref="inputRef"
          v-model="codeInput"
          data-pob-build-input
          spellcheck="false"
          :placeholder="t('pobBuild.placeholder')"
          :disabled="isBusy"
          class="w-full min-w-0 font-mono"
          @keydown.enter.prevent="handleSubmit"
        />

        <label v-if="mode === 'import'" class="flex flex-col gap-[var(--pxd-space-xs)]">
          <span class="text-[length:var(--pxd-font-secondary)] font-medium text-muted-foreground">
            {{ t('pobBuild.nameLabel') }}
          </span>
          <Input
            v-model="nameInput"
            data-pob-build-name-input
            :maxlength="POB_BUILD_NAME_MAX_LENGTH"
            :placeholder="suggestedName || t('pobBuild.namePlaceholder')"
            :disabled="isBusy"
            class="w-full min-w-0"
            @keydown.enter.prevent="handleSubmit"
          />
        </label>
      </div>

      <div
        v-if="errorKey"
        role="alert"
        data-pob-build-import-error
        class="flex flex-wrap items-center gap-x-[var(--pxd-space-sm)] gap-y-[var(--pxd-space-xs)] break-words text-[length:var(--pxd-font-secondary)] text-destructive"
      >
        <span>{{ t(errorKey) }}</span>
        <Button
          v-if="errorKey === 'pobBuild.error.share.permission'"
          type="button"
          variant="link"
          size="sm"
          data-pob-build-grant-permission
          class="h-auto p-0 text-[length:var(--pxd-font-secondary)]"
          @click="emit('open-permission')"
        >
          {{ t('pobBuild.share.grantBtn') }}
        </Button>
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
          {{ t('common.cancel') }}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          :disabled="isBusy || !codeInput.trim()"
          data-pob-build-import
          @click="handleSubmit"
        >
          <template v-if="mode === 'update'">
            {{ isBusy ? t('common.updating') : t('pobBuild.updateBtn') }}
          </template>
          <template v-else>
            {{ isBusy ? t('pobBuild.importingBtn') : t('common.import') }}
          </template>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
