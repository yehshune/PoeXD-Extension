<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
import { STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH } from '@/utils/stat-group-template-store';
import { t } from '@/utils/i18n';
import type { CriteriaOverlayPartLabel } from './criteria-overlay-labels';

const props = defineProps<{
  open: boolean;
  parts: CriteriaOverlayPartLabel[];
  defaultName: string;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  save: [payload: { name: string; keys: string[] }];
}>();

const name = ref('');
const selected = ref<Set<string>>(new Set());

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.defaultName;
    selected.value = new Set(props.parts.map((p) => p.key));
  },
  { immediate: true },
);

const groupedParts = computed(() => {
  const groups = new Map<string, CriteriaOverlayPartLabel[]>();
  props.parts.forEach((part) => {
    groups.set(part.group, [...(groups.get(part.group) ?? []), part]);
  });
  return Array.from(groups, ([group, parts]) => ({ group, parts }));
});

const canSave = computed(() => name.value.trim() !== '' && selected.value.size > 0);

function toggle(key: string, checked: boolean | 'indeterminate') {
  const next = new Set(selected.value);
  if (checked === true) next.add(key);
  else next.delete(key);
  selected.value = next;
}

function submit() {
  if (!canSave.value) return;
  emit('save', {
    name: name.value.trim(),
    keys: props.parts.filter((p) => selected.value.has(p.key)).map((p) => p.key),
  });
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      layer="system"
      data-test="stat-group-template-save-dialog"
      class="flex max-h-[calc(100vh-32px)] w-[420px] max-w-[calc(100vw-32px)] flex-col gap-[var(--pxd-space-md)] p-[var(--pxd-pane-padding)]"
    >
      <DialogHeader class="shrink-0 text-left pr-[var(--pxd-space-2xl)]">
        <DialogTitle class="text-[length:var(--pxd-font-section-title)] font-bold">
          {{ t('statGroupTemplate.dialog.saveTitle') }}
        </DialogTitle>
        <DialogDescription class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
          {{ t('statGroupTemplate.dialog.description') }}
        </DialogDescription>
      </DialogHeader>

      <form class="flex min-h-0 flex-col gap-[var(--pxd-space-md)]" @submit.prevent="submit">
        <div class="flex flex-col gap-1">
          <label
            for="stat-group-template-name"
            class="text-[length:var(--pxd-font-caption)] font-medium text-foreground"
          >
            {{ t('statGroupTemplate.dialog.nameLabel') }}
          </label>
          <Input
            id="stat-group-template-name"
            v-model="name"
            size="sm"
            data-test="stat-group-template-name"
            :maxlength="STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH"
            :placeholder="t('statGroupTemplate.dialog.namePlaceholder')"
          />
        </div>

        <div
          class="flex min-h-0 flex-col gap-[var(--pxd-space-md)] overflow-y-auto pxd-scrollbar pr-[var(--pxd-space-xs)]"
        >
          <section
            v-for="block in groupedParts"
            :key="block.group"
            class="flex flex-col gap-[var(--pxd-space-xs)]"
          >
            <h3 class="m-0 text-[length:var(--pxd-font-caption)] font-bold text-muted-foreground">
              {{ block.group }}
            </h3>
            <label
              v-for="part in block.parts"
              :key="part.key"
              :data-part-key="part.key"
              class="flex cursor-pointer items-start gap-[var(--pxd-space-sm)] rounded-sm px-[var(--pxd-space-xs)] py-0.5 hover:bg-accent/50"
            >
              <Checkbox
                class="mt-0.5"
                :model-value="selected.has(part.key)"
                @update:model-value="toggle(part.key, $event)"
              />
              <span class="flex min-w-0 flex-col">
                <span class="text-[length:var(--pxd-font-secondary)] text-foreground">
                  {{ part.label }}
                </span>
                <span
                  v-if="part.detail"
                  class="whitespace-pre-line text-[length:var(--pxd-font-caption)] text-muted-foreground"
                >
                  {{ part.detail }}
                </span>
              </span>
            </label>
          </section>
        </div>

        <DialogFooter class="flex items-center justify-end gap-[var(--pxd-space-xs)]">
          <Button type="button" variant="outline" size="sm" @click="emit('update:open', false)">
            {{ t('common.cancel') }}
          </Button>
          <Button type="submit" size="sm" data-test="stat-group-template-save" :disabled="!canSave">
            {{ t('common.save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
