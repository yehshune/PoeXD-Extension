<script setup lang="ts">
/**
 * 釘選物品的操作按鈕。收合列 hover 時浮出精簡版（只有圖示、全部是 ghost），
 * 展開後在卡片下方顯示完整版：只有主要動作（前往藏身處或複製密語）用主題色。
 * 取消釘選放在「⋯」選單裡，平常也可以直接拖到垃圾桶。
 */
import { ref } from 'vue';
import { ClipboardCopy, Copy, ExternalLink, Home, MoreVertical, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import type { PinnedItemTransientState } from './usePinnedItems';

const props = defineProps<{
  item: PinnedItemSnapshot;
  state?: PinnedItemTransientState;
  sameRealm: boolean;
  canCopyPob: boolean;
  hasSource: boolean;
  /** true：展開後的完整按鈕列；false：收合列 hover 浮出的圖示列 */
  full: boolean;
}>();

const emit = defineEmits<{
  travel: [];
  whisper: [];
  pob: [];
  source: [];
  unpin: [];
}>();

const menuOpen = ref(false);

function travelLabel(): string {
  if (props.state === 'in-demand') return t('pinnedItem.action.travelAgain');
  if (props.state === 'teleporting') return t('pinnedItem.action.travelSent');
  return t('pinnedItem.action.travel');
}

const travelDisabled = () => !props.sameRealm || props.state === 'busy' || props.state === 'sold';
</script>

<template>
  <div class="flex items-center gap-[var(--pxd-space-xs)]" @pointerdown.stop>
    <Button
      v-if="item.listing.instantBuyout"
      :variant="full ? 'secondary' : 'ghost'"
      :size="full ? 'sm' : 'icon-sm'"
      data-pinned-item-travel
      :disabled="travelDisabled()"
      :title="sameRealm ? t('pinnedItem.action.travelTitle') : t('pinnedItem.realmMismatch')"
      :aria-label="travelLabel()"
      @click.stop="emit('travel')"
    >
      <Home />
      <span v-if="full">{{ travelLabel() }}</span>
    </Button>
    <Button
      v-else-if="item.listing.whisper"
      :variant="full ? 'secondary' : 'ghost'"
      :size="full ? 'sm' : 'icon-sm'"
      data-pinned-item-whisper
      :disabled="!sameRealm"
      :title="sameRealm ? t('pinnedItem.action.whisperTitle') : t('pinnedItem.realmMismatch')"
      :aria-label="t('pinnedItem.action.whisper')"
      @click.stop="emit('whisper')"
    >
      <ClipboardCopy />
      <span v-if="full">{{ t('pinnedItem.action.whisper') }}</span>
    </Button>
    <Button
      v-if="canCopyPob"
      :variant="full ? 'outline' : 'ghost'"
      size="sm"
      class="px-[var(--pxd-space-sm)]"
      data-pinned-item-pob
      :title="t('resultPobCopy.title')"
      @click.stop="emit('pob')"
    >
      <Copy v-if="full" />
      <span>{{ t('resultPobCopy.button') }}</span>
    </Button>
    <Button
      v-if="hasSource"
      :variant="full ? 'outline' : 'ghost'"
      size="icon-sm"
      data-pinned-item-source
      :title="t('pinnedItem.action.openSource')"
      :aria-label="t('pinnedItem.action.openSource')"
      @click.stop="emit('source')"
    >
      <ExternalLink />
    </Button>
    <DropdownMenu v-model:open="menuOpen">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="{ 'ml-auto': full }"
          data-pinned-item-menu
          :title="t('pinnedItem.action.more')"
          :aria-label="t('pinnedItem.action.more')"
          @click.stop
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent v-if="menuOpen" align="end">
        <DropdownMenuItem data-pinned-item-unpin @click="emit('unpin')">
          <Trash2 class="text-muted-foreground" />
          {{ t('pinnedItem.button.unpinTitle') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
