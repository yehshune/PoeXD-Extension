<script setup lang="ts">
/**
 * 釘選物品的操作按鈕。收合列 hover 時浮出精簡版（只有圖示、全部是 ghost），
 * 展開後在卡片下方顯示完整版：主要動作（前往藏身處或複製密語）使用 secondary 按鈕樣式。
 * 複製 PoB 物品文字在展開後直接顯示於操作列，收合列則與取消釘選一併收進「⋯」選單。
 */
import { ref } from 'vue';
import {
  ClipboardCopy,
  Copy,
  ExternalLink,
  Home,
  Loader2,
  MoreVertical,
  Sparkles,
  Trash2,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  /** 可以找相似（ADR-0020）：選單一律有，`similarButton` 時操作列也顯示按鈕 */
  canFindSimilar?: boolean;
  similarButton?: boolean;
}>();

const emit = defineEmits<{
  travel: [];
  whisper: [];
  pob: [];
  source: [];
  unpin: [];
  similar: [];
}>();

const menuOpen = ref(false);

const isBusy = () => props.state === 'refreshing' || props.state === 'traveling';

function travelLabel(): string {
  if (props.state === 'sold') return t('common.sold');
  if (props.state === 'refreshing') return t('pinnedItem.action.refreshing');
  if (props.state === 'traveling') return t('pinnedItem.action.traveling');
  if (props.state === 'in-demand') return t('pinnedItem.action.travelAgain');
  if (props.state === 'teleporting') return t('pinnedItem.action.travelSent');
  return t('common.travelToHideout');
}

const travelDisabled = () => !props.sameRealm || isBusy() || props.state === 'sold';
</script>

<template>
  <div class="flex items-center gap-[var(--pxd-space-xs)]" @pointerdown.stop>
    <Button
      v-if="item.listing.instantBuyout"
      :variant="full ? 'secondary' : 'ghost'"
      :size="full ? 'sm' : 'icon-sm'"
      data-pinned-item-travel
      :disabled="travelDisabled()"
      :aria-busy="isBusy() ? 'true' : undefined"
      :title="sameRealm ? t('pinnedItem.action.travelTitle') : t('pinnedItem.realmMismatch')"
      :aria-label="travelLabel()"
      @click.stop="emit('travel')"
    >
      <Loader2 v-if="isBusy()" class="animate-spin" />
      <Home v-else />
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
      v-if="full && canCopyPob"
      variant="outline"
      size="sm"
      class="px-[var(--pxd-space-sm)]"
      data-pinned-item-pob
      :title="t('resultPobCopy.title')"
      @click.stop="emit('pob')"
    >
      <Copy />
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
    <Button
      v-if="canFindSimilar && (full || similarButton)"
      :variant="full ? 'outline' : 'ghost'"
      size="icon-sm"
      data-pinned-item-similar
      :title="t('similarSearch.buttonTitle')"
      :aria-label="t('similarSearch.buttonTitle')"
      @click.stop="emit('similar')"
    >
      <Sparkles />
    </Button>
    <DropdownMenu v-model:open="menuOpen">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          :class="{ 'ml-auto': full }"
          data-pinned-item-menu
          :title="t('common.moreActions')"
          :aria-label="t('common.moreActions')"
          @click.stop
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent v-if="menuOpen" align="end">
        <template v-if="!full && canCopyPob">
          <DropdownMenuItem
            data-pinned-item-pob
            :title="t('resultPobCopy.title')"
            @click="emit('pob')"
          >
            <Copy class="text-muted-foreground" />
            {{ t('settings.resultPobCopy.label') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </template>
        <template v-if="canFindSimilar">
          <DropdownMenuItem data-pinned-item-similar-menu @click="emit('similar')">
            <Sparkles class="text-muted-foreground" />
            {{ t('similarSearch.buttonTitle') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </template>
        <DropdownMenuItem data-pinned-item-unpin @click="emit('unpin')">
          <Trash2 class="text-muted-foreground" />
          {{ t('common.unpin') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
