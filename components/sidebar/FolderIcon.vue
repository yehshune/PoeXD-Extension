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
    ? 'inline-flex size-[32px] shrink-0 items-center justify-center'
    : props.size === 'md'
      ? 'inline-flex h-[26px] w-[35px] shrink-0 items-center justify-center'
      : 'inline-flex h-[24px] w-[32px] shrink-0 items-center justify-center',
);
const iconSizeClass = computed(() =>
  props.size === 'lg'
    ? 'size-[24px] shrink-0'
    : props.size === 'md'
      ? 'size-[20px] shrink-0'
      : 'size-[20px] shrink-0',
);
const wideImageClass = computed(() =>
  props.size === 'lg'
    ? 'h-[30px] w-[40px] shrink-0 rounded-[3px] border border-border/60 object-cover'
    : props.size === 'md'
      ? 'h-[26px] w-[35px] shrink-0 rounded-[3px] border border-border/60 object-cover'
      : 'h-[24px] w-[32px] shrink-0 rounded-[3px] border border-border/60 object-cover',
);
const squareImageClass = computed(() =>
  props.size === 'lg'
    ? 'size-[32px] shrink-0 object-contain'
    : props.size === 'md'
      ? 'size-[26px] shrink-0 object-contain'
      : 'size-[24px] shrink-0 object-contain',
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
