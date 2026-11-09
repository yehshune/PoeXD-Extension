<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { computed, ref } from 'vue';
import { X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { t } from '@/utils/i18n';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    clearable?: boolean;
    disabled?: boolean;
    class?: HTMLAttributes['class'];
    ariaLabel?: string;
  }>(),
  {
    modelValue: '',
    clearable: true,
    disabled: false,
  },
);

const effectivePlaceholder = computed(() => props.placeholder ?? t('settings.hotkeys.placeholder'));
const recordingText = computed(() => t('settings.hotkeys.recording'));

const emits = defineEmits<{
  (e: 'update:modelValue', val: string): void;
}>();

const isRecording = ref(false);

const handleFocus = () => {
  if (props.disabled) return;
  isRecording.value = true;
};

const handleBlur = () => {
  isRecording.value = false;
};

const clear = () => {
  if (props.disabled) return;
  emits('update:modelValue', '');
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (props.disabled) return;

  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) {
    return;
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    clear();
    isRecording.value = false;
    if (event.target && typeof (event.target as any).blur === 'function') {
      (event.target as any).blur();
    }
    return;
  }

  if (event.key === 'Escape') {
    isRecording.value = false;
    if (event.target && typeof (event.target as any).blur === 'function') {
      (event.target as any).blur();
    }
    return;
  }

  let combo = '';
  if (event.ctrlKey) combo += 'Ctrl+';
  if (event.altKey) combo += 'Alt+';
  if (event.shiftKey) combo += 'Shift+';

  let keyName = event.key;
  if (keyName === ' ') keyName = 'Space';

  combo += keyName;

  emits('update:modelValue', combo);
  isRecording.value = false;
  if (event.target && typeof (event.target as any).blur === 'function') {
    (event.target as any).blur();
  }
};
</script>

<template>
  <div
    data-slot="settings-hotkey-input"
    class="group relative flex items-center box-border"
    :class="props.class"
  >
    <Input
      size="default"
      type="text"
      readonly
      :disabled="disabled"
      :model-value="isRecording ? recordingText : modelValue || ''"
      :placeholder="isRecording ? recordingText : effectivePlaceholder"
      :title="
        isRecording
          ? t('settings.hotkeys.titleRecording')
          : modelValue
            ? t('settings.hotkeys.titleRebind')
            : t('settings.hotkeys.titleBind')
      "
      :aria-label="ariaLabel"
      class="w-[var(--pxd-settings-hotkey-width)] cursor-pointer text-center caret-transparent"
      @focus="handleFocus"
      @blur="handleBlur"
      @keydown.prevent.stop="handleKeyDown"
    />
    <Button
      v-if="clearable && modelValue && !isRecording && !disabled"
      type="button"
      variant="ghost-destructive"
      size="icon-sm"
      :title="t('settings.hotkeys.clearTitle')"
      :aria-label="
        ariaLabel
          ? t('settings.hotkeys.clearNamedAria', { label: ariaLabel })
          : t('settings.hotkeys.clearTitle')
      "
      data-settings-hotkey-action="clear"
      class="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity"
      @click.stop="clear"
    >
      <X />
    </Button>
  </div>
</template>
