<template>
  <div
    class="mod-item-container border-b border-border bg-transparent"
    :id="'mod_container_' + mod.id"
    :data-mod-id="mod.id"
    :data-mod-official-id="mod.officialId || mod.ids?.[0] || undefined"
  >
    <!-- 最上層詞綴行 -->
    <div
      class="mod-row group/mod-row relative flex items-stretch justify-between p-0 box-border transition-colors duration-100"
      :class="
        demoHighlighted
          ? 'bg-accent'
          : isSelected
            ? 'bg-muted hover:bg-accent'
            : 'bg-transparent hover:bg-accent'
      "
    >
      <!-- 左側選取區 -->
      <div
        class="mod-select-zone flex items-center justify-center py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] shrink-0"
        :class="hasOfficialId ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
        :title="hasOfficialId ? t('modItem.select.title') : t('modItem.select.unsupported')"
        @click="handleToggleSelect"
      >
        <Checkbox
          :model-value="isSelected"
          :disabled="!hasOfficialId"
          :aria-label="hasOfficialId ? t('modItem.select.aria') : t('modItem.select.unsupported')"
          :title="hasOfficialId ? t('modItem.select.title') : t('modItem.select.unsupported')"
          @click.stop
          @update:model-value="hasOfficialId ? $emit('toggle-select', mod, affinity) : undefined"
        />
      </div>

      <!-- 中央詞綴標題展開區 -->
      <button
        type="button"
        class="mod-content-action mod-name-section appearance-none box-border border-0 bg-transparent m-0 p-0 [font:inherit] text-inherit cursor-pointer flex flex-1 items-center min-w-0 text-left gap-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] pr-[var(--pxd-space-sm)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-mod-action="toggle-expand"
        :aria-expanded="isExpanded"
        @click.stop="$emit('toggle-expand', mod.id)"
      >
        <span
          class="expand-arrow text-arrow text-[length:var(--pxd-font-micro)] text-muted-foreground group-hover/mod-row:text-accent-foreground transition-transform duration-150 shrink-0"
          :class="isExpanded ? 'rotate-90' : ''"
          >▶</span
        >
        <span
          class="mod-name text-[length:var(--pxd-font-body)] text-foreground group-hover/mod-row:text-accent-foreground break-all whitespace-pre-line leading-[1.25]"
          ><template
            v-for="(segment, idx) in getHighlightSegments(mod.displayTemplate || mod.key)"
            :key="idx"
            ><mark v-if="segment.highlighted" class="mod-search-highlight">{{ segment.text }}</mark
            ><template v-else>{{ segment.text }}</template></template
          ></span
        >
        <span
          v-if="!hasOfficialId"
          class="no-official-id-badge ml-[var(--pxd-space-xs)] inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--pxd-font-micro)] text-amber-500 bg-amber-500/10 border border-amber-500/25 shrink-0 select-none align-middle"
          :title="t('modItem.badge.noOfficialIdTitle')"
          data-badge="no-official-id"
        >
          {{ t('modItem.badge.noOfficialId') }}
        </span>
        <span
          v-if="tierSummary"
          class="mod-tier-summary ml-auto pl-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-muted-foreground group-hover/mod-row:opacity-0 transition-opacity shrink-0 tabular-nums whitespace-nowrap"
        >
          {{ tierSummary }}
        </span>
      </button>

      <!-- 右側浮動加入按鈕區 (形式 A: 行內文字連結 + 長距平滑漸層，無硬切線且極致輕量) -->
      <div
        class="mod-action-zone pxd-hover-actions-overlay [--pxd-hover-overlay-bg:var(--accent)] absolute right-0 top-0 bottom-0 flex items-center pl-[var(--pxd-space-2xl)] pr-[var(--pxd-space-sm)] transition-opacity z-(--pxd-z-sticky)"
        :class="
          demoHighlighted
            ? 'opacity-100 pointer-events-auto'
            : 'pointer-events-none opacity-0 group-hover/mod-row:opacity-100 group-hover/mod-row:pointer-events-auto focus-within/mod-row:opacity-100 focus-within/mod-row:pointer-events-auto'
        "
      >
        <Button
          type="button"
          variant="link"
          size="sm"
          data-mod-action="add-now"
          class="h-full p-0 border-0 shadow-none text-[length:var(--pxd-font-micro)] text-accent-foreground hover:text-accent-foreground/85 font-medium gap-0.5 shrink-0 transition-colors"
          :aria-label="
            hasOfficialId ? t('modItem.actions.addNowTitle') : t('modItem.actions.fillSearchTitle')
          "
          :title="
            hasOfficialId ? t('modItem.actions.addNowTitle') : t('modItem.actions.fillSearchTitle')
          "
          @click.stop="$emit('add-filter', mod, affinity)"
        >
          <ArrowRight v-if="hasOfficialId" class="size-[var(--control-icon-sm,12px)]" />
          <Search v-else class="size-[var(--control-icon-sm,12px)]" />
          <span>{{
            hasOfficialId ? t('modItem.actions.addNow') : t('modItem.actions.fillSearch')
          }}</span>
        </Button>
      </div>
    </div>

    <!-- 展開的 Tier 清單 -->
    <div
      v-if="isExpanded"
      class="mod-tiers-list py-[var(--pxd-space-xs)] pl-[var(--pxd-space-md)] ml-[var(--pxd-space-lg)] border-l-2 border-border bg-transparent"
    >
      <div
        v-if="mod.tiers && mod.tiers.length > 1"
        class="mod-tier-hint px-[var(--pxd-space-sm)] pb-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] text-muted-foreground select-none"
      >
        {{ t('modItem.tierHint') }}
      </div>
      <div
        v-for="(tier, idx) in mod.tiers"
        :key="idx"
        class="tier-row group/tier-row relative flex items-center justify-between gap-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] transition-colors duration-100"
        :data-item-level-locked="isTierItemLevelLocked(tier) ? 'true' : undefined"
        :title="isTierItemLevelLocked(tier) ? getTierSelectTitle(tier) : undefined"
        :class="[
          isTierSelectable(tier) ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
          isTierRowSelected(tier, idx)
            ? 'bg-muted hover:bg-accent'
            : 'bg-transparent hover:bg-accent',
        ]"
        @click="handleToggleTierSelect(tier, idx)"
      >
        <!-- Checkbox 勾選框 -->
        <Checkbox
          :model-value="isTierRowSelected(tier, idx)"
          :disabled="!isTierSelectable(tier)"
          :aria-label="
            isTierSelectable(tier) ? t('modItem.selectTier.aria') : getTierSelectTitle(tier)
          "
          :title="getTierSelectTitle(tier)"
          @click.stop
          @update:model-value="
            isTierSelectable(tier)
              ? $emit('toggle-tier-select', mod, tier, idx, affinity)
              : undefined
          "
        />
        <div class="tier-content-section flex items-center flex-1 min-w-0 self-stretch">
          <span
            class="tier-rank inline-flex items-center min-w-[26px] pr-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] tabular-nums shrink-0"
            :class="
              resolveTierNumber(tier, idx) === 1
                ? 'text-primary font-bold group-hover/tier-row:text-accent-foreground'
                : 'text-muted-foreground group-hover/tier-row:text-accent-foreground'
            "
            >T{{ resolveTierNumber(tier, idx) }}</span
          >
          <span
            class="tier-level text-[length:var(--pxd-font-caption)] text-primary group-hover/tier-row:text-accent-foreground w-[var(--pxd-mod-tier-level-width)] shrink-0"
            >Lv.{{ tier.level }}</span
          >
          <span
            class="tier-desc text-[length:var(--pxd-font-secondary)] text-muted-foreground group-hover/tier-row:text-accent-foreground flex-1 break-all whitespace-pre-line leading-[1.2]"
            ><template
              v-for="(segment, idx) in getHighlightSegments(tier.displayKey || tier.key)"
              :key="idx"
              ><mark v-if="segment.highlighted" class="mod-search-highlight">{{
                segment.text
              }}</mark
              ><template v-else>{{ segment.text }}</template></template
            ></span
          >
        </div>
        <div
          v-if="!isTierItemLevelLocked(tier)"
          class="tier-action-zone pxd-hover-actions-overlay [--pxd-hover-overlay-bg:var(--accent)] absolute right-0 top-0 bottom-0 flex items-center pl-[var(--pxd-space-2xl)] pr-[var(--pxd-space-sm)] pointer-events-none opacity-0 group-hover/tier-row:opacity-100 group-hover/tier-row:pointer-events-auto focus-within/tier-row:opacity-100 focus-within/tier-row:pointer-events-auto transition-opacity z-(--pxd-z-sticky)"
        >
          <Button
            type="button"
            variant="link"
            size="sm"
            class="h-full p-0 border-0 shadow-none text-[length:var(--pxd-font-micro)] text-accent-foreground hover:text-accent-foreground/85 font-medium gap-0.5 shrink-0 transition-colors"
            :aria-label="
              tierHasOfficialId(tier)
                ? t('modItem.actions.addTierTitle')
                : t('modItem.actions.fillSearchTitle')
            "
            :title="
              tierHasOfficialId(tier)
                ? t('modItem.actions.addTierTitle')
                : t('modItem.actions.fillSearchTitle')
            "
            @click.stop="$emit('add-tier-filter', mod, tier, affinity)"
          >
            <ArrowRight v-if="tierHasOfficialId(tier)" class="size-[var(--control-icon-sm,12px)]" />
            <Search v-else class="size-[var(--control-icon-sm,12px)]" />
            <span>{{
              tierHasOfficialId(tier)
                ? t('modItem.actions.addNow')
                : t('modItem.actions.fillSearch')
            }}</span>
          </Button>
        </div>
        <span
          v-else
          class="tier-locked-indicator flex items-center text-muted-foreground group-hover/tier-row:text-accent-foreground shrink-0"
          data-tier-lock-icon="item-level"
          :title="getTierSelectTitle(tier)"
        >
          <Lock class="size-[var(--control-icon-sm,12px)]" />
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue';
import type { ModGroup, ModTier } from './types';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ArrowRight } from '@lucide/vue';
import { Lock, Search } from '@lucide/vue';
import { t } from '@/utils/i18n';
import { isTierLockedByItemLevelMax, parseTierLevel } from './utils';

export default defineComponent({
  name: 'ModItem',
  components: {
    Checkbox,
    Button,
    ArrowRight,
    Lock,
    Search,
  },
  props: {
    mod: {
      type: Object as PropType<ModGroup>,
      required: true,
    },
    affinity: {
      type: String,
      required: true,
    },
    isExpanded: {
      type: Boolean,
      default: false,
    },
    isSelected: {
      type: Boolean,
      default: false,
    },
    /** 會收到 mod 與 affinity，父層可傳同一個函式給所有詞綴，避免每次重繪都產生新 prop 使全部 ModItem 重繪 */
    isTierSelected: {
      type: Function as PropType<(idx: number, mod: ModGroup, affinity: string) => boolean>,
      required: true,
    },
    searchQuery: {
      type: String,
      default: '',
    },
    getTierNumber: {
      type: Function as PropType<(tier: ModTier, idx: number, mod: ModGroup) => number>,
      default: undefined,
    },
    itemLevelMax: {
      type: Number as PropType<number | null>,
      default: null,
    },
    demoHighlighted: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['toggle-select', 'toggle-expand', 'toggle-tier-select', 'add-filter', 'add-tier-filter'],
  setup(props, { emit }) {
    const formatModText = (text: string) => {
      if (!text) return '';
      return text.replace(/\|\|\|\|\|/g, '\n');
    };

    interface HighlightSegment {
      text: string;
      highlighted: boolean;
    }

    const escapeRegExp = (str: string) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const getHighlightSegments = (rawText: string): HighlightSegment[] => {
      const text = formatModText(rawText);
      if (!text) return [];

      const query = props.searchQuery?.trim();
      if (!query) return [{ text, highlighted: false }];

      const tokens = query
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.length === 0) return [{ text, highlighted: false }];

      const pattern = tokens.map((t) => escapeRegExp(t)).join('|');
      if (!pattern) return [{ text, highlighted: false }];

      try {
        const regex = new RegExp(pattern, 'gi');
        const segments: HighlightSegment[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          if (match.index > lastIndex) {
            segments.push({
              text: text.slice(lastIndex, match.index),
              highlighted: false,
            });
          }
          segments.push({
            text: match[0],
            highlighted: true,
          });
          lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
          segments.push({
            text: text.slice(lastIndex),
            highlighted: false,
          });
        }

        return segments.length > 0 ? segments : [{ text, highlighted: false }];
      } catch {
        return [{ text, highlighted: false }];
      }
    };

    const hasOfficialId = computed(() => {
      return Boolean(props.mod.officialId || (props.mod.ids && props.mod.ids.length > 0));
    });

    const tierHasOfficialId = (tier: ModTier) => {
      return Boolean(
        tier.id || tier.officialId || (tier.ids && tier.ids.length > 0) || hasOfficialId.value,
      );
    };

    const isTierItemLevelLocked = (tier: ModTier) => {
      return isTierLockedByItemLevelMax(tier.level, props.itemLevelMax);
    };

    const isTierSelectable = (tier: ModTier) => {
      return tierHasOfficialId(tier) && !isTierItemLevelLocked(tier);
    };

    const isTierRowSelected = (tier: ModTier, idx: number) => {
      if (isTierItemLevelLocked(tier)) return false;
      return props.isTierSelected(idx, props.mod, props.affinity);
    };

    const getTierSelectTitle = (tier: ModTier) => {
      if (isTierItemLevelLocked(tier)) {
        return t('modItem.selectTier.itemLevelTooHigh', {
          level: tier.level,
          max: props.itemLevelMax ?? '',
        });
      }
      return tierHasOfficialId(tier)
        ? t('modItem.selectTier.title')
        : t('modItem.select.unsupported');
    };

    const handleToggleSelect = () => {
      if (!hasOfficialId.value) return;
      emit('toggle-select', props.mod, props.affinity);
    };

    const handleToggleTierSelect = (tier: ModTier, idx: number) => {
      if (!isTierSelectable(tier)) return;
      emit('toggle-tier-select', props.mod, tier, idx, props.affinity);
    };

    const resolveTierNumber = (tier: ModTier, idx: number): number => {
      if (props.getTierNumber) return props.getTierNumber(tier, idx, props.mod);
      const total = props.mod.tiers?.length ?? 1;
      return Math.max(1, total - idx);
    };

    const tierSummary = computed(() => {
      const tiers = props.mod.tiers;
      if (!tiers || tiers.length === 0) return '';
      const levels = tiers
        .map((tier) => parseTierLevel(tier.level))
        .filter((lvl): lvl is number => lvl !== null);
      if (levels.length === 0) return '';
      const minLvl = Math.min(...levels);
      const maxLvl = Math.max(...levels);
      const lockedCount = tiers.filter((tier) => isTierItemLevelLocked(tier)).length;
      if (lockedCount > 0) {
        const available = tiers.length - lockedCount;
        if (minLvl === maxLvl) {
          return t('modItem.tierSummaryLockedSingle', {
            available,
            total: tiers.length,
            level: minLvl,
          });
        }
        return t('modItem.tierSummaryLockedRange', {
          available,
          total: tiers.length,
          min: minLvl,
          max: maxLvl,
        });
      }
      if (minLvl === maxLvl) {
        return t('modItem.tierSummarySingle', { count: tiers.length, level: minLvl });
      }
      return t('modItem.tierSummaryRange', { count: tiers.length, min: minLvl, max: maxLvl });
    });

    return {
      t,
      getHighlightSegments,
      hasOfficialId,
      tierHasOfficialId,
      isTierItemLevelLocked,
      isTierSelectable,
      isTierRowSelected,
      getTierSelectTitle,
      handleToggleSelect,
      handleToggleTierSelect,
      resolveTierNumber,
      tierSummary,
    };
  },
});
</script>

<style scoped>
:deep(.mod-search-highlight) {
  background-color: color-mix(in srgb, var(--primary) 22%, transparent);
  color: inherit !important;
  font-weight: 600;
  padding: 0 2px;
  border-radius: var(--radius-sm);
}
</style>
