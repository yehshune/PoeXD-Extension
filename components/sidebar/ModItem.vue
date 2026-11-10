<template>
  <div
    class="mod-item-container border-b border-border bg-transparent"
    :id="'mod_container_' + mod.id"
  >
    <!-- 最上層詞綴行 -->
    <div
      class="mod-row group/mod-row relative flex items-stretch justify-between p-0 box-border transition-colors duration-100"
      :class="isSelected ? 'bg-muted hover:bg-accent' : 'bg-transparent hover:bg-accent'"
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
      </button>

      <!-- 右側浮動加入按鈕區 (形式 A: 行內文字連結 + 長距平滑漸層，無硬切線且極致輕量) -->
      <div
        class="mod-action-zone absolute right-0 top-0 bottom-0 flex items-center pl-20 pr-[var(--pxd-space-sm)] bg-gradient-to-l from-accent from-45% via-accent/70 to-transparent pointer-events-none opacity-0 group-hover/mod-row:opacity-100 group-hover/mod-row:pointer-events-auto focus-within/mod-row:opacity-100 focus-within/mod-row:pointer-events-auto transition-opacity z-10"
      >
        <Button
          type="button"
          variant="link"
          size="sm"
          class="h-full p-0 border-0 shadow-none text-[length:var(--pxd-font-micro)] text-primary hover:text-primary/80 font-medium gap-0.5 shrink-0 transition-colors"
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
        v-for="(tier, idx) in mod.tiers"
        :key="idx"
        class="tier-row group/tier-row relative flex items-center justify-between gap-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] px-[var(--pxd-space-sm)] transition-colors duration-100"
        :class="[
          tierHasOfficialId(tier) ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
          isTierSelected(idx) ? 'bg-muted hover:bg-accent' : 'bg-transparent hover:bg-accent',
        ]"
        @click="handleToggleTierSelect(tier, idx)"
      >
        <!-- Checkbox 勾選框 -->
        <Checkbox
          :model-value="isTierSelected(idx)"
          :disabled="!tierHasOfficialId(tier)"
          :aria-label="
            tierHasOfficialId(tier) ? t('modItem.selectTier.aria') : t('modItem.select.unsupported')
          "
          :title="
            tierHasOfficialId(tier)
              ? t('modItem.selectTier.title')
              : t('modItem.select.unsupported')
          "
          @click.stop
          @update:model-value="
            tierHasOfficialId(tier)
              ? $emit('toggle-tier-select', mod, tier, idx, affinity)
              : undefined
          "
        />
        <div class="tier-content-section flex items-center flex-1 min-w-0 self-stretch">
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
          class="tier-action-zone absolute right-0 top-0 bottom-0 flex items-center pl-20 pr-[var(--pxd-space-sm)] bg-gradient-to-l from-accent from-45% via-accent/70 to-transparent pointer-events-none opacity-0 group-hover/tier-row:opacity-100 group-hover/tier-row:pointer-events-auto focus-within/tier-row:opacity-100 focus-within/tier-row:pointer-events-auto transition-opacity z-10"
        >
          <Button
            type="button"
            variant="link"
            size="sm"
            class="h-full p-0 border-0 shadow-none text-[length:var(--pxd-font-micro)] text-primary hover:text-primary/80 font-medium gap-0.5 shrink-0 transition-colors"
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
import { Search } from '@lucide/vue';
import { t } from '@/utils/i18n';

export default defineComponent({
  name: 'ModItem',
  components: {
    Checkbox,
    Button,
    ArrowRight,
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
    isTierSelected: {
      type: Function as PropType<(idx: number) => boolean>,
      required: true,
    },
    searchQuery: {
      type: String,
      default: '',
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

    const handleToggleSelect = () => {
      if (!hasOfficialId.value) return;
      emit('toggle-select', props.mod, props.affinity);
    };

    const handleToggleTierSelect = (tier: ModTier, idx: number) => {
      if (!tierHasOfficialId(tier)) return;
      emit('toggle-tier-select', props.mod, tier, idx, props.affinity);
    };

    return {
      t,
      getHighlightSegments,
      hasOfficialId,
      tierHasOfficialId,
      handleToggleSelect,
      handleToggleTierSelect,
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
