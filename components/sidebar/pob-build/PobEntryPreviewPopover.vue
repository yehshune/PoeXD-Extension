<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { ExternalLink, RotateCcw, Save, Search } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '@/utils/i18n';
import {
  applyEntrySelection,
  buildEntryQuery,
  effectiveCountMin,
  effectiveLinks,
  LINK_OPTIONS,
  cloneEntrySearchSelection,
  entryStatFilters,
  isRequiredInCountMode,
  isSelectionDraftModified,
  normalizeSelectionForEntry,
  selectionFromRowState,
  type BuildSearchDefaults,
  type EntrySearchSelection,
  type ShoppingMod,
} from '@/utils/pob-shopping-list';
import { statDomainOf } from '@/utils/stat-domain-order';
import ItemPreviewHeader from '../item-preview/ItemPreviewHeader.vue';
import ItemPreviewPopover from '../item-preview/ItemPreviewPopover.vue';
import PreviewStatRow, { type PreviewStatBounds } from '../item-preview/PreviewStatRow.vue';
import StatGroupTypeSelect from '../item-preview/StatGroupTypeSelect.vue';
import {
  PREVIEW_BOUND_INPUT_CLASS,
  PREVIEW_CARD_CLASS,
  PREVIEW_GROUP_HEADER_CLASS,
  PREVIEW_META_BLOCK_CLASS,
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
  /** 所屬 build 的整體搜尋設定；草稿沒改到的條件依它計算 */
  searchDefaults: {
    type: Object as PropType<BuildSearchDefaults>,
    default: () => ({}),
  },
});

/** 連結數選項的「不限」值（ToggleGroup 只收字串） */
const LINKS_ANY = 'any';

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'save-selection', selection: EntrySearchSelection | undefined): void;
  (e: 'reset-search'): void;
  (e: 'open-search', mode: 'current' | 'new-tab', row: ShoppingRow): void;
}>();

/** Popover 內的暫存微調草稿；未微調為 null，依項目暫存於工作階段，避免誤關視窗遺失調整。 */
const draftsByTarget = new Map<string, EntrySearchSelection>();
const draftSelection = ref<EntrySearchSelection | null>(null);

const currentTargetKey = () => (props.row ? `${props.buildId}\u0000${props.row.key}` : '');

watch(
  [() => props.open, () => props.buildId, () => props.row?.key],
  () => {
    const key = currentTargetKey();
    const saved = key ? draftsByTarget.get(key) : undefined;
    draftSelection.value = saved ? cloneEntrySearchSelection(saved) : null;
  },
  { immediate: true },
);

const effectiveRow = computed<ShoppingRow | null>(() => {
  const row = props.row;
  if (!row) return null;
  const draft = draftSelection.value;
  if (!draft) return row;
  const defaults = props.searchDefaults;
  const filters = entryStatFilters(row, draft, defaults);
  const applied = applyEntrySelection(row, draft, defaults);
  const countMin = effectiveCountMin(row, draft);
  const pseudo = draft.pseudo === true;
  return {
    ...row,
    mods: applied.mods,
    filters,
    countMin,
    pseudo,
    linksMin: effectiveLinks(row, draft, defaults),
    query: buildEntryQuery(row, draft, defaults),
    searchSelection: draft,
  };
});

/** PoB 裝備五連以上（或單件已指定連結）時顯示連結條件 */
const showLinks = computed(() =>
  Boolean(
    effectiveRow.value &&
    !effectiveRow.value.searchOverride &&
    (effectiveRow.value.links !== undefined || effectiveRow.value.linksMin !== undefined),
  ),
);

const linksValue = computed(() =>
  effectiveRow.value?.linksMin === undefined ? LINKS_ANY : String(effectiveRow.value.linksMin),
);

function setLinks(value: unknown): void {
  // ToggleGroup 再點一次已選的項目會送出空值，維持原選擇
  if (typeof value !== 'string' || value === '') return;
  const links = value === LINKS_ANY ? null : Number(value);
  if (links !== null && !LINK_OPTIONS.includes(links)) return;
  mutateDraft((draft) => ({ ...draft, links }));
}

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

const itemCardBase = computed(() => {
  const row = effectiveRow.value;
  if (!row) return '';
  return queryType.value && queryType.value !== row.label ? queryType.value : '';
});

const showEnglishSubtitle = computed(() => {
  const row = effectiveRow.value;
  return Boolean(
    row?.englishName && row.englishName !== row.label && row.englishName !== itemCardBase.value,
  );
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

/** 上下限鎖定為同一個精確值（如星團天賦數、插槽數、永恆珠寶種子碼）不應被「-10%」放寬 */
function isExactLockedBound(filter: { min?: number; max?: number }): boolean {
  return filter.min !== undefined && filter.max !== undefined && filter.min === filter.max;
}

const hasEnabledNumericBounds = computed(() =>
  Boolean(
    effectiveRow.value &&
    !effectiveRow.value.searchOverride &&
    effectiveRow.value.filters.some(
      (filter) =>
        filter.enabled &&
        filter.value !== undefined &&
        (filter.min !== undefined || filter.max !== undefined),
    ),
  ),
);

const hasRelaxableNumericBounds = computed(() =>
  Boolean(
    effectiveRow.value &&
    !effectiveRow.value.searchOverride &&
    effectiveRow.value.filters.some(
      (filter) =>
        filter.enabled &&
        filter.value !== undefined &&
        (filter.min !== undefined || filter.max !== undefined) &&
        !isExactLockedBound(filter),
    ),
  ),
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
    : selectionFromRowState(row, props.searchDefaults);
  const next = update(current);
  draftSelection.value = next;
  const key = currentTargetKey();
  if (key) draftsByTarget.set(key, cloneEntrySearchSelection(next));
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

function relaxBounds(): void {
  const row = effectiveRow.value;
  if (!row || row.searchOverride) return;
  mutateDraft((draft) => {
    const nextStats = { ...draft.stats };
    for (const filter of row.filters) {
      if (!filter.enabled || filter.value === undefined) continue;
      if (filter.min === undefined && filter.max === undefined) continue;
      if (isExactLockedBound(filter)) continue;
      const entry = { ...nextStats[filter.key] };
      if (filter.min !== undefined) {
        entry.min =
          filter.min > 0
            ? Math.floor(filter.min * 0.9)
            : filter.min < 0
              ? Math.floor(filter.min * 1.1)
              : 0;
      }
      if (filter.max !== undefined) {
        entry.max =
          filter.max < 0
            ? Math.ceil(filter.max * 0.9)
            : filter.max > 0
              ? Math.ceil(filter.max * 1.1)
              : 0;
      }
      nextStats[filter.key] = entry;
    }
    return { ...draft, stats: nextStats };
  });
}

function clearBounds(): void {
  const row = effectiveRow.value;
  if (!row || row.searchOverride) return;
  mutateDraft((draft) => {
    const nextStats = { ...draft.stats };
    for (const filter of row.filters) {
      if (!filter.enabled || filter.value === undefined) continue;
      if (filter.min === undefined && filter.max === undefined) continue;
      nextStats[filter.key] = { ...nextStats[filter.key], min: null, max: null };
    }
    return { ...draft, stats: nextStats };
  });
}

function saveDraft(): void {
  if (!props.row || !draftSelection.value) return;
  const normalized = normalizeSelectionForEntry(
    props.row,
    draftSelection.value,
    props.searchDefaults,
  );
  const key = currentTargetKey();
  if (key) draftsByTarget.delete(key);
  draftSelection.value = null;
  emit('save-selection', normalized);
}

function discardDraft(): void {
  const key = currentTargetKey();
  if (key) draftsByTarget.delete(key);
  draftSelection.value = null;
}

function handleResetSearch(): void {
  const key = currentTargetKey();
  if (key) draftsByTarget.delete(key);
  draftSelection.value = null;
  emit('reset-search');
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
        :modified="isDraftModified"
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
        <Button
          v-if="effectiveRow.query"
          variant="secondary"
          size="sm"
          class="border-transparent px-[var(--pxd-space-sm)] shadow-none"
          data-pob-build-popover-search
          :title="t('pobBuild.searchTitle')"
          @click="emit('open-search', 'current', effectiveRow)"
        >
          <Search aria-hidden="true" />
          {{ t('pobBuild.searchCurrentBtn') }}
        </Button>
        <Button
          v-if="effectiveRow.query"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-foreground/80"
          data-pob-build-popover-new-tab
          :title="t('pobBuild.openNewTabTitle')"
          :aria-label="t('pobBuild.openNewTabTitle')"
          @click="emit('open-search', 'new-tab', effectiveRow)"
        >
          <ExternalLink aria-hidden="true" />
          <span class="sr-only">{{ t('pobBuild.openNewTabTitle') }}</span>
        </Button>
        <Button
          v-if="isDraftModified"
          variant="outline"
          size="sm"
          class="ml-auto border-primary/50 bg-primary/10 px-[var(--pxd-space-sm)] text-primary shadow-none"
          data-pob-build-save-selection
          :title="t('pobBuild.mods.saveSelectionTitle')"
          @click="saveDraft"
        >
          <Save aria-hidden="true" />
          {{ t('pobBuild.mods.saveSelection') }}
        </Button>
        <Button
          v-if="isDraftModified"
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          data-pob-build-discard-draft
          :title="t('searchPreview.action.resetTuneTitle')"
          :aria-label="t('searchPreview.action.resetTune')"
          @click="discardDraft"
        >
          <RotateCcw aria-hidden="true" />
          <span class="sr-only">{{ t('searchPreview.action.resetTune') }}</span>
        </Button>
        <Button
          v-else-if="effectiveRow.searchCustomized"
          variant="ghost"
          size="sm"
          class="ml-auto px-[var(--pxd-space-sm)]"
          data-pob-build-reset-search
          @click="handleResetSearch"
        >
          <RotateCcw aria-hidden="true" />
          {{ t('pobBuild.mods.reset') }}
        </Button>
      </div>

      <!-- 內容捲動區 -->
      <div
        class="min-h-0 flex-1 overflow-y-auto pxd-scrollbar p-[var(--pxd-pane-padding)] flex flex-col gap-[var(--pxd-space-md)]"
      >
        <!-- 基底、英文副標與上架狀態摘要區：省略與標題重複的名稱 -->
        <div
          v-if="
            itemCardBase ||
            showEnglishSubtitle ||
            (effectiveRow.query && !effectiveRow.searchOverride)
          "
          :class="[PREVIEW_META_BLOCK_CLASS, 'flex flex-col gap-[var(--pxd-space-xs)]']"
        >
          <div
            class="flex flex-wrap items-baseline justify-between gap-x-[var(--pxd-space-md)] gap-y-[var(--pxd-space-xs)]"
          >
            <div
              class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-[var(--pxd-space-md)] gap-y-[var(--pxd-space-xs)]"
            >
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
            <span
              v-if="effectiveRow.query && !effectiveRow.searchOverride"
              class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
            >
              {{ t('searchPreview.label.status')
              }}<span class="text-foreground">{{ t('pobBuild.statusInstantBuyout') }}</span>
            </span>
          </div>
        </div>

        <!-- 存回搜尋覆寫提示 -->
        <p
          v-if="effectiveRow.searchOverride"
          data-pob-build-override-notice
          class="m-0 rounded-md border border-primary/40 bg-primary/10 px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] text-primary"
        >
          {{ t('pobBuild.mods.overrideNotice') }}
        </p>

        <!-- 物品條件區：連結數（PoB 五連以上） -->
        <div
          v-if="showLinks"
          data-pob-build-item-filters
          class="flex flex-col gap-[var(--pxd-space-xs)]"
        >
          <span class="text-[length:var(--pxd-font-section-title)] font-semibold text-foreground">
            {{ t('pobBuild.itemFilters.title') }}
          </span>
          <div
            :class="[
              PREVIEW_CARD_CLASS,
              'flex items-center gap-[var(--pxd-space-md)] p-[var(--pxd-space-sm)]',
            ]"
          >
            <span class="shrink-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground">
              {{ t('pobBuild.itemFilters.links') }}
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              data-pob-build-links
              :model-value="linksValue"
              @update:model-value="setLinks"
            >
              <ToggleGroupItem :value="LINKS_ANY" data-pob-build-links-option="any">
                {{ t('pobBuild.itemFilters.linksAny') }}
              </ToggleGroupItem>
              <ToggleGroupItem
                v-for="count in LINK_OPTIONS"
                :key="count"
                :value="String(count)"
                :data-pob-build-links-option="count"
              >
                {{ t('pobBuild.itemFilters.linksCount', { count }) }}
              </ToggleGroupItem>
            </ToggleGroup>
            <span
              v-if="effectiveRow.links !== undefined"
              class="ml-auto shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
            >
              {{
                t('pobBuild.itemFilters.linksPob', {
                  count: effectiveRow.links,
                })
              }}
            </span>
          </div>
        </div>

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
            <div
              v-if="hasEnabledNumericBounds"
              class="ml-auto flex items-center gap-[var(--pxd-space-xs)]"
            >
              <Button
                v-if="hasRelaxableNumericBounds"
                variant="ghost"
                size="sm"
                class="h-auto px-[var(--pxd-space-xs)] py-[2px] text-[length:var(--pxd-font-caption)] text-muted-foreground hover:text-foreground"
                data-pob-build-relax-bounds
                :title="t('pobBuild.mods.relaxBoundsTitle')"
                @click="relaxBounds"
              >
                {{ t('pobBuild.mods.relaxBounds') }}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="h-auto px-[var(--pxd-space-xs)] py-[2px] text-[length:var(--pxd-font-caption)] text-muted-foreground hover:text-foreground"
                data-pob-build-clear-bounds
                :title="t('pobBuild.mods.clearBoundsTitle')"
                @click="clearBounds"
              >
                {{ t('common.clearValues') }}
              </Button>
            </div>
          </div>

          <div :class="[PREVIEW_CARD_CLASS, { 'opacity-60': effectiveRow.searchOverride }]">
            <!-- 群組類別（且／計數，比照搜尋預覽整合在卡片標頭）與總和條件 -->
            <div
              v-if="effectiveRow.filters.length > 0"
              :class="[
                PREVIEW_GROUP_HEADER_CLASS,
                'gap-x-[var(--pxd-space-md)] text-muted-foreground',
              ]"
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
                <Input
                  size="sm"
                  type="number"
                  min="1"
                  :max="enabledCount"
                  step="1"
                  data-pob-build-count-min
                  :class="PREVIEW_BOUND_INPUT_CLASS"
                  :model-value="effectiveRow.countMin"
                  :disabled="effectiveRow.searchOverride"
                  :aria-label="t('pobBuild.mods.countAria')"
                  @input="commitCountMin($event)"
                  @change="commitCountMin($event)"
                  @keydown.enter.prevent="blurTarget"
                />
                <span v-if="t('pobBuild.mods.countUnit')">{{ t('pobBuild.mods.countUnit') }}</span>
              </span>
              <span
                v-if="hasPseudo"
                class="ml-auto inline-flex items-center gap-[var(--pxd-space-xs)]"
                :title="t('pobBuild.mods.pseudoTitle')"
              >
                <Checkbox
                  :id="controlId('pseudo')"
                  data-pob-build-pseudo
                  :model-value="effectiveRow.pseudo"
                  :disabled="effectiveRow.searchOverride"
                  @update:model-value="(value) => setPseudo(value === true)"
                />
                <!-- label 不包住 Checkbox：包住時點一下會被 label 再觸發一次而切回原狀 -->
                <label
                  :for="controlId('pseudo')"
                  class="cursor-pointer whitespace-nowrap text-foreground/85"
                  >{{ t('pobBuild.mods.pseudo') }}</label
                >
              </span>
            </div>

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
        </div>
      </div>
    </template>
  </ItemPreviewPopover>
</template>
