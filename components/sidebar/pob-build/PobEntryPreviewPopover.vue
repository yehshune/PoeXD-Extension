<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { ExternalLink, RotateCcw, Save, Search } from '@lucide/vue';
import { Checkbox } from '@/components/ui/checkbox';
import { t } from '@/utils/i18n';
import {
  applyEntrySelection,
  buildEntryQuery,
  effectiveCountMin,
  cloneEntrySearchSelection,
  entryStatFilters,
  isRequiredInCountMode,
  isSelectionDraftModified,
  normalizeSelectionForEntry,
  selectionFromRowState,
  type EntrySearchSelection,
  type ShoppingMod,
} from '@/utils/pob-shopping-list';
import { statDomainOf } from '@/utils/stat-domain-order';
import ItemPreviewHeader from '../item-preview/ItemPreviewHeader.vue';
import ItemPreviewPopover from '../item-preview/ItemPreviewPopover.vue';
import PreviewStatRow, { type PreviewStatBounds } from '../item-preview/PreviewStatRow.vue';
import StatGroupTypeSelect from '../item-preview/StatGroupTypeSelect.vue';
import {
  PREVIEW_ACTION_BUTTON_CLASS,
  PREVIEW_BOUND_INPUT_CLASS,
  PREVIEW_ICON_CLASS,
  PREVIEW_TAG_CLASS,
  PREVIEW_TOOLBAR_CLASS,
} from '../item-preview/preview-classes';
import type { ShoppingRow, StatBound } from './usePobBuild';

/** PoB 項目的詞綴群組只有兩種：全部符合（且）或至少符合 N 項（計數） */
const POB_GROUP_TYPES = ['and', 'count'] as const;

/** 一行詞綴轉成共用詞綴列需要的資料 */
interface ModLine {
  index: number;
  mod: ShoppingMod;
  /** 這一行目前的網域（切換後的）；沒有市集代碼的行用 PoB 的詞綴種類 */
  domain: string;
  /** 可切換的網域（含目前的）；只有一種時為空 */
  domains: readonly string[];
  /** 條件的原代碼（使用者調整的鍵）；沒有市集代碼時省略 */
  key?: string;
  /** 下限／上限輸入框；只放在同一個條件的第一行，選項型條件沒有 */
  bounds?: PreviewStatBounds;
}

const props = defineProps({
  open: { type: Boolean, default: false },
  side: {
    type: String as PropType<'left' | 'right' | 'top' | 'bottom'>,
    default: 'right',
  },
  reference: {
    type: Object as PropType<HTMLElement | null>,
    default: null,
  },
  buildId: { type: String, default: '' },
  row: {
    type: Object as PropType<ShoppingRow | null>,
    default: null,
  },
  rowDetailText: { type: String, default: '' },
  nameClass: { type: String, default: '' },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'save-selection', selection: EntrySearchSelection | undefined): void;
  (e: 'reset-search'): void;
  (e: 'open-search', mode: 'current' | 'new-tab', row: ShoppingRow): void;
}>();

/** Popover 內的暫存微調草稿；未微調為 null，關閉或切換項目時清空，不自動寫入儲存。 */
const draftSelection = ref<EntrySearchSelection | null>(null);

watch([() => props.open, () => props.buildId, () => props.row?.key], () => {
  draftSelection.value = null;
});

const effectiveRow = computed<ShoppingRow | null>(() => {
  const row = props.row;
  if (!row) return null;
  const draft = draftSelection.value;
  if (!draft) return row;
  const filters = entryStatFilters(row, draft);
  const applied = applyEntrySelection(row, draft);
  const countMin = effectiveCountMin(row, draft);
  const pseudo = draft.pseudo === true;
  return {
    ...row,
    mods: applied.mods,
    filters,
    countMin,
    pseudo,
    query: buildEntryQuery(row, draft),
    searchSelection: draft,
  };
});

const isDraftModified = computed(() =>
  Boolean(
    props.row && effectiveRow.value && isSelectionDraftModified(props.row, effectiveRow.value),
  ),
);

const canSearch = computed(() =>
  Boolean(
    effectiveRow.value && (effectiveRow.value.searchOverride || effectiveRow.value.query !== null),
  ),
);

const queryType = computed(() => {
  const type = effectiveRow.value?.query?.type;
  return typeof type === 'string' && type.trim() ? type.trim() : '';
});

const itemCardTitle = computed(() => {
  const row = effectiveRow.value;
  if (!row) return '';
  if (row.kind === 'equipment') return '';
  return row.label;
});

const itemCardBase = computed(() => {
  const row = effectiveRow.value;
  if (!row) return '';
  if (row.kind === 'equipment') return row.label;
  return queryType.value && queryType.value !== row.label ? queryType.value : '';
});

const showEnglishSubtitle = computed(() => {
  const row = effectiveRow.value;
  return Boolean(row?.englishName && row.englishName !== row.label);
});

/** 展開後的每一行詞綴。同一個代碼的多行是同一個條件，數值輸入只放在第一行。 */
const modLines = computed<ModLine[]>(() => {
  const row = effectiveRow.value;
  if (!row?.mods) return [];
  const seen = new Set<string>();
  return row.mods.map((mod, index) => {
    const stat = mod.stat;
    const filter = stat ? row.filters.find((entry) => entry.key === stat.id) : undefined;
    const line: ModLine = {
      index,
      mod,
      domain: filter ? statDomainOf(filter.id) : mod.kind,
      domains: filter?.domains ?? [],
      ...(stat ? { key: stat.id } : {}),
    };
    if (!stat || seen.has(stat.id)) return line;
    seen.add(stat.id);
    // 選項型條件（沒有數值）不能改範圍；其餘都可以改下限與上限
    if (!filter || filter.value === undefined) return line;
    return { ...line, bounds: { min: filter.min, max: filter.max } };
  });
});

const searchedModCount = computed(
  () => effectiveRow.value?.mods?.filter((mod) => mod.searched).length ?? 0,
);

/** 參與「至少符合 N 項」的條件數（固定詞綴與附魔一定要符合，不算在內） */
const enabledCount = computed(
  () =>
    effectiveRow.value?.filters.filter(
      (filter) => filter.enabled && !isRequiredInCountMode(filter.id),
    ).length ?? 0,
);

const hasPseudo = computed(
  () => effectiveRow.value?.mods?.some((mod) => mod.stat?.pseudo) ?? false,
);

function controlId(name: string): string {
  const raw = `${props.buildId}\u0000${props.row?.key ?? ''}`;
  return `pob-popover-${name}-${Array.from(raw, (char) => char.charCodeAt(0).toString(36)).join('')}`;
}

function blurTarget(event: Event): void {
  (event.target as HTMLInputElement).blur();
}

function mutateDraft(update: (draft: EntrySearchSelection) => EntrySearchSelection): void {
  const row = props.row;
  if (!row) return;
  const current = draftSelection.value
    ? cloneEntrySearchSelection(draftSelection.value)
    : selectionFromRowState(row);
  draftSelection.value = update(current);
}

function setStatEnabled(statId: string, enabled: boolean): void {
  mutateDraft((draft) => ({
    ...draft,
    stats: { ...draft.stats, [statId]: { ...draft.stats?.[statId], enabled } },
  }));
}

function setDomain(key: string, domain: string): void {
  mutateDraft((draft) => ({
    ...draft,
    stats: { ...draft.stats, [key]: { ...draft.stats?.[key], domain } },
  }));
}

function commitBound(statId: string, bound: StatBound, value: number | null): void {
  mutateDraft((draft) => ({
    ...draft,
    stats: { ...draft.stats, [statId]: { ...draft.stats?.[statId], [bound]: value } },
  }));
}

function toggleCountMode(on: boolean): void {
  // 預設允許少一項；條件只有一項時就是一項
  const countMin = on ? Math.max(1, enabledCount.value - 1) : undefined;
  mutateDraft(({ countMin: _previous, ...draft }) =>
    countMin === undefined ? draft : { ...draft, countMin },
  );
}

function commitCountMin(event: Event): void {
  const value = Math.floor(Number((event.target as HTMLInputElement).value));
  if (!Number.isFinite(value) || value < 1) return;
  mutateDraft((draft) => ({ ...draft, countMin: value }));
}

function setPseudo(on: boolean): void {
  mutateDraft(({ pseudo: _previous, ...draft }) => (on ? { ...draft, pseudo: true } : draft));
}

function saveDraft(): void {
  if (!props.row || !draftSelection.value) return;
  const normalized = normalizeSelectionForEntry(props.row, draftSelection.value);
  draftSelection.value = null;
  emit('save-selection', normalized);
}

function discardDraft(): void {
  draftSelection.value = null;
}
</script>

<template>
  <ItemPreviewPopover
    :open="open"
    :side="side"
    :reference="reference"
    :ready="Boolean(effectiveRow)"
    data-pob-build-mods-popover
    @update:open="(value) => emit('update:open', value)"
  >
    <template v-if="effectiveRow">
      <ItemPreviewHeader
        :title="effectiveRow.label"
        :title-class="nameClass"
        closable
        @close="emit('update:open', false)"
      >
        <template v-if="effectiveRow.suffix || rowDetailText" #tags>
          <span v-if="effectiveRow.suffix" :class="[PREVIEW_TAG_CLASS.secondary, 'tabular-nums']">
            {{ effectiveRow.suffix }}
          </span>
          <span v-if="rowDetailText" :class="PREVIEW_TAG_CLASS.muted">{{ rowDetailText }}</span>
        </template>
      </ItemPreviewHeader>

      <!-- 工具列：搜尋、存回條件與還原 -->
      <div
        v-if="canSearch || effectiveRow.searchCustomized || isDraftModified"
        :class="PREVIEW_TOOLBAR_CLASS"
      >
        <button
          v-if="effectiveRow.query"
          type="button"
          :class="PREVIEW_ACTION_BUTTON_CLASS"
          data-pob-build-popover-search
          :title="t('pobBuild.searchTitle')"
          @click="emit('open-search', 'current', effectiveRow)"
        >
          <Search :class="PREVIEW_ICON_CLASS" aria-hidden="true" />
          {{ t('pobBuild.searchCurrentBtn') }}
        </button>
        <button
          v-if="effectiveRow.query"
          type="button"
          :class="PREVIEW_ACTION_BUTTON_CLASS"
          data-pob-build-popover-new-tab
          :title="t('pobBuild.openNewTabTitle')"
          @click="emit('open-search', 'new-tab', effectiveRow)"
        >
          <ExternalLink :class="PREVIEW_ICON_CLASS" aria-hidden="true" />
          {{ t('pobBuild.openNewTabTitle') }}
        </button>
        <button
          v-if="isDraftModified"
          type="button"
          :class="[PREVIEW_ACTION_BUTTON_CLASS, 'border-primary/50 text-primary']"
          data-pob-build-save-selection
          :title="t('pobBuild.mods.saveSelectionTitle')"
          @click="saveDraft"
        >
          <Save :class="PREVIEW_ICON_CLASS" aria-hidden="true" />
          {{ t('pobBuild.mods.saveSelection') }}
        </button>
        <button
          v-if="isDraftModified"
          type="button"
          :class="[PREVIEW_ACTION_BUTTON_CLASS, 'ml-auto']"
          data-pob-build-discard-draft
          :title="t('searchPreview.action.resetTuneTitle')"
          @click="discardDraft"
        >
          <RotateCcw :class="PREVIEW_ICON_CLASS" aria-hidden="true" />
          {{ t('searchPreview.action.resetTune') }}
        </button>
        <button
          v-else-if="effectiveRow.searchCustomized"
          type="button"
          :class="[PREVIEW_ACTION_BUTTON_CLASS, 'ml-auto']"
          data-pob-build-reset-search
          @click="emit('reset-search')"
        >
          <RotateCcw :class="PREVIEW_ICON_CLASS" aria-hidden="true" />
          {{ t('pobBuild.mods.reset') }}
        </button>
      </div>

      <!-- 內容捲動區 -->
      <div
        class="min-h-0 flex-1 overflow-y-auto pxd-scrollbar p-[var(--pxd-pane-padding)] flex flex-col gap-[var(--pxd-space-md)]"
      >
        <!-- 物品／基底卡片 -->
        <div
          class="flex flex-col gap-[var(--pxd-space-xs)] rounded-md border border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] leading-[1.35]"
        >
          <div v-if="itemCardTitle" class="text-foreground">
            {{ t('searchPreview.label.item')
            }}<span class="font-semibold" :class="nameClass">{{ itemCardTitle }}</span>
          </div>
          <div v-if="itemCardBase" class="text-muted-foreground">
            {{ t('searchPreview.label.base')
            }}<span class="text-foreground">{{ itemCardBase }}</span>
          </div>
          <div
            v-if="showEnglishSubtitle"
            class="text-[length:var(--pxd-font-caption)] text-muted-foreground"
          >
            {{ effectiveRow.englishName }}
          </div>
        </div>

        <!-- 上架狀態卡片 -->
        <div
          v-if="effectiveRow.query && !effectiveRow.searchOverride"
          class="flex items-center justify-between gap-[var(--pxd-space-md)] rounded-md border border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)]"
        >
          <span class="text-muted-foreground">
            {{ t('searchPreview.label.status')
            }}<span class="text-foreground">{{ t('pobBuild.statusInstantBuyout') }}</span>
          </span>
        </div>

        <!-- 存回搜尋覆寫提示 -->
        <p
          v-if="effectiveRow.searchOverride"
          data-pob-build-override-notice
          class="m-0 rounded-md border border-primary/40 bg-primary/10 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-primary"
        >
          {{ t('pobBuild.mods.overrideNotice') }}
        </p>

        <!-- 詞綴清單區 -->
        <div
          v-if="effectiveRow.mods?.length"
          data-pob-build-mods
          class="flex flex-col gap-[var(--pxd-space-xs)]"
        >
          <div class="flex items-center gap-[var(--pxd-space-xs)]">
            <span class="text-[length:var(--pxd-font-section-title)] font-semibold text-foreground">
              {{ t('searchPreview.section.stats') }}
            </span>
            <span class="text-[length:var(--pxd-font-caption)] text-muted-foreground tabular-nums">
              ({{ searchedModCount }}/{{ effectiveRow.mods.length }})
            </span>
          </div>

          <div
            class="overflow-hidden rounded-md border border-border"
            :class="{ 'opacity-60': effectiveRow.searchOverride }"
          >
            <PreviewStatRow
              v-for="line in modLines"
              :key="line.index"
              :data-mod-kind="line.mod.kind"
              :data-mod-searched="line.mod.searched ? 'true' : 'false'"
              :domain="line.domain"
              :domains="line.domains"
              :domain-disabled="effectiveRow.searchOverride"
              :lines="[line.mod.text]"
              wrap
              :checked="line.key ? line.mod.searched : undefined"
              reserve-toggle
              :toggle-disabled="effectiveRow.searchOverride"
              :toggle-aria-label="t('pobBuild.mods.statAria', { text: line.mod.text })"
              :bounds="line.bounds ?? null"
              :bounds-disabled="!line.mod.searched || effectiveRow.searchOverride"
              :dimmed="Boolean(line.key) && !line.mod.searched"
              @toggle="(checked) => setStatEnabled(line.key!, checked)"
              @select-domain="(domain) => setDomain(line.key!, domain)"
              @commit-bound="(bound, value) => commitBound(line.key!, bound, value)"
            />
          </div>

          <!-- 群組類別（且／計數，同市集的詞綴群組）與總和條件 -->
          <div
            v-if="effectiveRow.filters.length > 0"
            class="mt-[var(--pxd-space-xs)] flex flex-wrap items-center gap-x-[var(--pxd-space-lg)] gap-y-[var(--pxd-space-sm)] rounded-md border border-border bg-muted/30 px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] text-muted-foreground"
            :class="{ 'opacity-60': effectiveRow.searchOverride }"
          >
            <StatGroupTypeSelect
              data-pob-build-count-mode
              :type="effectiveRow.countMin !== undefined ? 'count' : 'and'"
              :options="POB_GROUP_TYPES"
              :disabled="effectiveRow.searchOverride || effectiveRow.visceraBundle"
              :aria-label="t('pobBuild.mods.groupTypeAria')"
              @select="(type) => toggleCountMode(type === 'count')"
            />
            <span
              v-if="effectiveRow.countMin !== undefined"
              class="inline-flex items-center gap-[var(--pxd-space-xs)]"
            >
              <input
                type="number"
                min="1"
                :max="enabledCount"
                step="1"
                data-pob-build-count-min
                :class="[PREVIEW_BOUND_INPUT_CLASS, 'w-[calc(var(--control-height-sm)*1.6)]']"
                :value="effectiveRow.countMin"
                :disabled="effectiveRow.searchOverride"
                :aria-label="t('pobBuild.mods.countAria')"
                @change="commitCountMin($event)"
                @keydown.enter.prevent="blurTarget"
              />
              <span v-if="t('pobBuild.mods.countUnit')">{{ t('pobBuild.mods.countUnit') }}</span>
            </span>
            <span v-if="hasPseudo" class="inline-flex items-center gap-[var(--pxd-space-xs)]">
              <Checkbox
                :id="controlId('pseudo')"
                data-pob-build-pseudo
                :model-value="effectiveRow.pseudo"
                :disabled="effectiveRow.searchOverride"
                @update:model-value="(value) => setPseudo(value === true)"
              />
              <!-- label 不包住 Checkbox：包住時點一下會被 label 再觸發一次而切回原狀 -->
              <label :for="controlId('pseudo')" class="cursor-pointer">{{
                t('pobBuild.mods.pseudo')
              }}</label>
            </span>
          </div>
        </div>
      </div>
    </template>
  </ItemPreviewPopover>
</template>
