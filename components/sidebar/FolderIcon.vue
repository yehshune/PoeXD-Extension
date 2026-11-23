<script setup lang="ts">
import { computed, type Component } from 'vue';
import {
  Crown,
  Flame,
  Folder,
  FolderOpen,
  Gem,
  Heart,
  Scroll,
  Shield,
  Sparkles,
  Star,
  Sword,
  Tag,
  Target,
  Zap,
} from '@lucide/vue';
import {
  getFolderColorSpec,
  resolveFolderIcon,
  type FolderLucideIconKey,
} from '@/utils/folder-icons';

const props = withDefaults(
  defineProps<{
    icon?: string;
    color?: string;
    open?: boolean;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  {
    open: false,
    size: 'sm',
  },
);

const LUCIDE_COMPONENTS: Record<FolderLucideIconKey, Component> = {
  star: Star,
  zap: Zap,
  flame: Flame,
  crown: Crown,
  gem: Gem,
  sword: Sword,
  shield: Shield,
  sparkles: Sparkles,
  scroll: Scroll,
  target: Target,
  tag: Tag,
  heart: Heart,
};

const resolved = computed(() => resolveFolderIcon(props.icon));
const colorSpec = computed(() => getFolderColorSpec(props.color));

const colorClass = computed(() => colorSpec.value?.textClass ?? 'text-muted-foreground');
const slotClass = computed(() =>
  props.size === 'lg'
    ? 'inline-flex size-[var(--control-height-default,32px)] shrink-0 items-center justify-center'
    : 'inline-flex h-[var(--pxd-folder-icon-slot-height,24px)] w-[var(--pxd-folder-icon-slot-width,32px)] shrink-0 items-center justify-center',
);
const iconSizeClass = computed(() =>
  props.size === 'lg'
    ? 'size-[var(--pxd-folder-icon-slot-height,24px)] shrink-0'
    : 'size-[var(--control-icon-lg,20px)] shrink-0',
);
const wideImageClass = computed(
  () =>
    'h-[var(--pxd-folder-icon-slot-height,24px)] w-[var(--pxd-folder-icon-slot-width,32px)] shrink-0 rounded-xs border border-border/60 object-cover',
);
const squareImageClass = computed(() =>
  props.size === 'lg'
    ? 'size-[var(--control-height-default,32px)] shrink-0 object-contain'
    : 'size-[var(--pxd-folder-icon-slot-height,24px)] shrink-0 object-contain',
);
</script>

<template>
  <span :class="slotClass">
    <img
      v-if="resolved?.kind === 'image'"
      :src="resolved.url"
      :class="resolved.wide ? wideImageClass : squareImageClass"
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
    />
    <component
      :is="LUCIDE_COMPONENTS[resolved.iconKey]"
      v-else-if="resolved?.kind === 'lucide'"
      :class="[iconSizeClass, colorClass]"
    />
    <FolderOpen v-else-if="open" :class="[iconSizeClass, colorClass]" />
    <Folder v-else :class="[iconSizeClass, colorClass]" />
  </span>
</template>
