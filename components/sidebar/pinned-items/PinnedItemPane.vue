<script setup lang="ts">
import { ref } from 'vue';
import { ChevronDown, ClipboardCopy, ExternalLink, Home, Pin, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { getActiveUiLocale, t } from '@/utils/i18n';
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import { getTradeRealm } from '@/utils/trade-realms';
import SidebarPane from '../layout/SidebarPane.vue';
import PinnedItemCardView from './PinnedItemCardView.vue';
import { usePinnedItems } from './usePinnedItems';

const {
  items,
  visibleItems,
  hiddenCount,
  showAllLeagues,
  states,
  currentLeague,
  limit,
  sameRealm,
  canCopyPob,
  sourceUrl,
  copyWhisper,
  travel,
  copyPob,
  openSource,
  unpin,
  clearVisible,
} = usePinnedItems();

/** 卡片預設收合只顯示物品名稱；展開狀態是這次瀏覽的暫時狀態，不保存 */
const expandedIds = ref<ReadonlySet<string>>(new Set());

function isExpanded(item: PinnedItemSnapshot): boolean {
  return expandedIds.value.has(item.id);
}

function toggleExpanded(item: PinnedItemSnapshot): void {
  const next = new Set(expandedIds.value);
  if (next.has(item.id)) next.delete(item.id);
  else next.add(item.id);
  expandedIds.value = next;
}

/** 有通貨圖示時與官方結果列相同顯示「數量×圖示」，否則以文字顯示通貨代碼 */
function priceLabel(item: PinnedItemSnapshot): string {
  const price = item.listing.price;
  if (!price) return t('pinnedItem.noPrice');
  const prefix = `${price.type ? `${price.type} ` : ''}${price.amount}`;
  return price.icon ? `${prefix}×` : `${prefix} ${price.currency}`;
}

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

function formatAge(iso: string | undefined): string {
  if (!iso) return '';
  const elapsed = Date.now() - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return '';
  const format = new Intl.RelativeTimeFormat(getActiveUiLocale(), { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return format.format(0, 'minute');
}

function travelLabel(item: PinnedItemSnapshot): string {
  const state = states.value[item.id];
  if (state === 'in-demand') return t('pinnedItem.action.travelAgain');
  if (state === 'teleporting') return t('pinnedItem.action.travelSent');
  return t('pinnedItem.action.travel');
}

function realmLabel(item: PinnedItemSnapshot): string {
  return t(getTradeRealm(item.realm).labelKey);
}
</script>

<template>
  <SidebarPane data-pane="pinned-items" class="pinned-items-pane">
    <template #fixed>
      <div
        class="flex items-center gap-[var(--pxd-space-sm)] pb-[var(--pxd-space-md)] w-full min-w-0"
      >
        <label
          v-if="currentLeague"
          class="flex items-center gap-[var(--pxd-space-xs)] min-w-0 flex-1 text-[length:var(--pxd-font-caption)] text-muted-foreground cursor-pointer"
        >
          <Checkbox v-model="showAllLeagues" data-pinned-items-show-all />
          <span class="truncate">{{ t('pinnedItem.showAllLeagues') }}</span>
        </label>
        <span v-else class="flex-1"></span>
        <span
          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums"
          data-pinned-items-count
          >{{ t('pinnedItem.count', { count: items.length, limit }) }}</span
        >
        <Button
          variant="secondary"
          size="sm"
          class="shrink-0"
          data-pinned-items-clear
          :disabled="visibleItems.length === 0"
          :title="
            showAllLeagues || !currentLeague
              ? t('pinnedItem.clearAll')
              : t('pinnedItem.clearLeague')
          "
          @click="clearVisible"
        >
          <Trash2 />
        </Button>
      </div>
      <Separator class="mb-[var(--pxd-space-md)]" />
    </template>

    <template #scroll>
      <div
        v-if="visibleItems.length === 0"
        class="flex flex-col items-center gap-[var(--pxd-space-sm)] py-[var(--pxd-space-xl)] text-center text-muted-foreground"
        data-pinned-items-empty
      >
        <Pin class="size-6" />
        <p class="text-[length:var(--pxd-font-body)]">{{ t('pinnedItem.empty') }}</p>
        <p v-if="hiddenCount > 0" class="text-[length:var(--pxd-font-caption)]">
          {{ t('pinnedItem.hiddenByLeague', { count: hiddenCount }) }}
        </p>
      </div>

      <ul v-else class="flex flex-col gap-[var(--pxd-space-md)]">
        <li
          v-for="item in visibleItems"
          :key="item.id"
          class="flex flex-col gap-[var(--pxd-space-xs)] border border-border p-[var(--pxd-space-sm)]"
          :class="{ 'opacity-60': states[item.id] === 'sold' }"
          :data-pinned-item-id="item.id"
        >
          <div
            role="button"
            tabindex="0"
            class="cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
            data-pinned-item-toggle
            :aria-expanded="isExpanded(item)"
            :title="
              isExpanded(item) ? t('pinnedItem.action.collapse') : t('pinnedItem.action.expand')
            "
            @click="toggleExpanded(item)"
            @keydown.enter.prevent="toggleExpanded(item)"
            @keydown.space.prevent="toggleExpanded(item)"
          >
            <PinnedItemCardView :snapshot="item" :collapsed="!isExpanded(item)" />
          </div>

          <div
            class="flex flex-wrap items-center gap-x-[var(--pxd-space-sm)] gap-y-[var(--pxd-space-2xs)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
          >
            <ChevronDown
              class="size-4 shrink-0 transition-transform"
              :class="{ 'rotate-180': isExpanded(item) }"
              aria-hidden="true"
            />
            <span
              class="inline-flex items-center gap-[var(--pxd-space-2xs)] font-bold text-foreground"
              data-pinned-item-price
            >
              {{ priceLabel(item) }}
              <img
                v-if="item.listing.price?.icon"
                :src="item.listing.price.icon"
                :alt="item.listing.price.currency"
                :title="item.listing.price.currencyName ?? item.listing.price.currency"
                class="size-6 object-contain"
                referrerpolicy="no-referrer"
                data-pinned-item-currency-icon
              />
            </span>
            <span v-if="item.listing.instantBuyout" class="text-primary">{{
              t('pinnedItem.instantBuyout')
            }}</span>
            <span v-if="item.listing.accountName" class="truncate">{{
              item.listing.accountName
            }}</span>
            <span v-if="item.listing.indexed">{{ formatAge(item.listing.indexed) }}</span>
            <span v-if="showAllLeagues || item.league !== currentLeague">{{ item.league }}</span>
            <span v-if="!sameRealm(item)">{{ realmLabel(item) }}</span>
            <span v-if="states[item.id] === 'sold'" class="text-destructive">{{
              t('pinnedItem.sold')
            }}</span>
          </div>

          <div class="flex flex-wrap items-center gap-[var(--pxd-space-xs)]">
            <Button
              v-if="item.listing.instantBuyout"
              variant="default"
              size="sm"
              data-pinned-item-travel
              :disabled="
                !sameRealm(item) || states[item.id] === 'busy' || states[item.id] === 'sold'
              "
              :title="
                sameRealm(item) ? t('pinnedItem.action.travelTitle') : t('pinnedItem.realmMismatch')
              "
              @click="travel(item)"
            >
              <Home />
              <span class="ml-1">{{ travelLabel(item) }}</span>
            </Button>
            <Button
              v-else-if="item.listing.whisper"
              variant="default"
              size="sm"
              data-pinned-item-whisper
              :disabled="!sameRealm(item)"
              :title="
                sameRealm(item)
                  ? t('pinnedItem.action.whisperTitle')
                  : t('pinnedItem.realmMismatch')
              "
              @click="copyWhisper(item)"
            >
              <ClipboardCopy />
              <span class="ml-1">{{ t('pinnedItem.action.whisper') }}</span>
            </Button>
            <Button
              v-if="canCopyPob(item)"
              variant="secondary"
              size="sm"
              data-pinned-item-pob
              :title="t('resultPobCopy.title')"
              @click="copyPob(item)"
            >
              {{ t('resultPobCopy.button') }}
            </Button>
            <Button
              v-if="sourceUrl(item)"
              variant="secondary"
              size="icon-sm"
              data-pinned-item-source
              :title="t('pinnedItem.action.openSource')"
              :aria-label="t('pinnedItem.action.openSource')"
              @click="openSource(item)"
            >
              <ExternalLink />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              class="ml-auto"
              data-pinned-item-unpin
              :title="t('pinnedItem.button.unpinTitle')"
              :aria-label="t('pinnedItem.button.unpinTitle')"
              @click="unpin(item)"
            >
              <Trash2 />
            </Button>
          </div>
        </li>
      </ul>
    </template>
  </SidebarPane>
</template>
