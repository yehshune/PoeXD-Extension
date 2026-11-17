<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { ExternalLink, RotateCcw, Save, Search, X } from '@lucide/vue';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import StatDomainMenu from '../stat-domain/StatDomainMenu.vue';
import { isNestedMenuInteraction } from '../stat-domain/nested-menu-guard';
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
import {
  extractStatDomain,
  getStatDomainBadgeLabel,
  getStatDomainStyle,
  shouldShowStatDomainBadge,
  STAT_DOMAIN_BADGE_CLASS,
  type StatDomainKey,
} from '@/utils/stat-domain';
import type { ShoppingRow, StatBound } from './usePobBuild';

interface BoundEditor {
  statId: string;
  bound: StatBound;
  value?: number;
}

/** 可切換網域的標籤：點開選單選擇前綴 */
interface DomainSwitch {
  /** 條件的原代碼（使用者調整的鍵） */
  key: string;
  domains: readonly string[];
  current: string;
}

interface ModLine {
  index: number;
  mod: ShoppingMod;
  /** 這一行目前的網域（切換後的）；決定標籤文字與顏色 */
  domain: StatDomainKey | null;
  domainSwitch?: DomainSwitch;
  /** 數值輸入框；只放在同一個條件的第一行 */
  editor?: BoundEditor;
}

/** 可切換時一律顯示標籤（包含一般詞綴），否則只有非一般詞綴才顯示 */
function modDomainBadge(line: ModLine): string | null {
  if (line.domainSwitch) return getStatDomainBadgeLabel(line.domain) ?? line.domainSwitch.current;
  return shouldShowStatDomainBadge(line.domain) ? getStatDomainBadgeLabel(line.domain) : null;
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

const anchorReference = computed(() => props.reference ?? undefined);

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
    const domain = filter ? extractStatDomain(filter.id) : (mod.kind as StatDomainKey);
    const domainSwitch = filter?.domains
      ? { key: filter.key, domains: filter.domains, current: statDomainOf(filter.id) }
      : undefined;
    const line: ModLine = { index, mod, domain, ...(domainSwitch ? { domainSwitch } : {}) };
    if (!stat || seen.has(stat.id)) return line;
    seen.add(stat.id);
    if (!filter || filter.value === undefined || stat.exact) return line;
    const bound: StatBound = filter.value < 0 ? 'max' : 'min';
    return { ...line, editor: { statId: stat.id, bound, value: filter[bound] } };
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

const actionButtonClass =
  'inline-flex shrink-0 items-center gap-[var(--pxd-space-xs)] whitespace-nowrap rounded-sm border border-border bg-transparent px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] leading-none text-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const boundInputBaseClass =
  'h-[calc(var(--control-height-sm)*0.78)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none rounded-md border border-solid border-input bg-background px-[var(--input-padding-x-sm)] py-0 text-right text-[length:var(--control-font-sm)] leading-none text-foreground tabular-nums shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

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

function commitBound(editor: BoundEditor, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim();
  const value = raw === '' ? null : Number(raw);
  if (value !== null && !Number.isFinite(value)) return;
  mutateDraft((draft) => ({
    ...draft,
    stats: {
      ...draft.stats,
      [editor.statId]: { ...draft.stats?.[editor.statId], [editor.bound]: value },
    },
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

/**
 * 點擊錨點那一列交給列表自己的切換邏輯處理；否則外部點擊會先關閉、接著的 click 又把它打開。
 */
function handleInteractOutside(event: CustomEvent<{ originalEvent?: Event }>): void {
  const path = event.detail?.originalEvent?.composedPath?.() ?? [];
  if (props.reference && path.includes(props.reference)) event.preventDefault();
  // 網域選單掛在 Popover 外；側欄在 Shadow DOM 裡時要另外判斷（見 nested-menu-guard）
  if (
    isNestedMenuInteraction(path, (element) => element.hasAttribute('data-pob-build-mods-popover'))
  ) {
    event.preventDefault();
  }
}
</script>

<template>
  <Popover :open="open" @update:open="(val: boolean) => emit('update:open', val)">
    <PopoverAnchor :reference="anchorReference" />
    <PopoverContent
      v-if="open && effectiveRow"
      data-pob-build-mods-popover
      :side="side"
      align="start"
      :side-offset="10"
      :collision-padding="10"
      :avoid-collisions="true"
      class="flex flex-col w-[var(--pxd-search-preview-width)] max-w-[var(--reka-popover-content-available-width,calc(100vw-32px))] max-h-[var(--reka-popover-content-available-height,calc(100vh-32px))] overflow-hidden bg-background p-0 text-[length:var(--pxd-font-body)]"
      @open-auto-focus.prevent
      @interact-outside="handleInteractOutside"
    >
      <!-- 固定標題列（比照書籤物品預覽）：名稱、標籤與關閉鈕 -->
      <div
        class="flex h-[var(--pxd-sidebar-affix-dialog-header-height)] min-w-0 shrink-0 items-center gap-[var(--pxd-space-sm)] border-b border-border bg-background px-[var(--pxd-pane-padding)]"
      >
        <span
          class="min-w-0 flex-1 truncate text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px]"
          :class="nameClass || 'text-foreground'"
          :title="effectiveRow.label"
        >
          {{ effectiveRow.label }}
        </span>
        <div class="flex min-w-0 shrink-0 items-center gap-[var(--pxd-space-xs)]">
          <span
            v-if="effectiveRow.suffix"
            class="whitespace-nowrap rounded-sm border border-border bg-secondary px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-secondary-foreground tabular-nums"
          >
            {{ effectiveRow.suffix }}
          </span>
          <span
            v-if="rowDetailText"
            class="whitespace-nowrap rounded-sm border border-border bg-muted px-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)] font-semibold text-muted-foreground"
          >
            {{ rowDetailText }}
          </span>
        </div>
        <button
          type="button"
          class="inline-flex size-[var(--control-height-sm)] shrink-0 items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:text-accent-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
          data-pob-build-popover-close
          :aria-label="t('common.close')"
          :title="t('common.close')"
          @click="emit('update:open', false)"
        >
          <X class="size-[var(--control-icon-default)]" aria-hidden="true" />
        </button>
      </div>

      <!-- 工具列：搜尋、存回條件與還原 -->
      <div
        v-if="canSearch || effectiveRow.searchCustomized || isDraftModified"
        class="flex min-w-0 shrink-0 flex-wrap items-center gap-[var(--pxd-space-xs)] border-b border-border px-[var(--pxd-pane-padding)] py-[var(--pxd-space-sm)]"
      >
        <button
          v-if="effectiveRow.query"
          type="button"
          :class="actionButtonClass"
          data-pob-build-popover-search
          :title="t('pobBuild.searchTitle')"
          @click="emit('open-search', 'current', effectiveRow)"
        >
          <Search class="size-[var(--control-icon-sm)] shrink-0" aria-hidden="true" />
          {{ t('pobBuild.searchCurrentBtn') }}
        </button>
        <button
          v-if="effectiveRow.query"
          type="button"
          :class="actionButtonClass"
          data-pob-build-popover-new-tab
          :title="t('pobBuild.openNewTabTitle')"
          @click="emit('open-search', 'new-tab', effectiveRow)"
        >
          <ExternalLink class="size-[var(--control-icon-sm)] shrink-0" aria-hidden="true" />
          {{ t('pobBuild.openNewTabTitle') }}
        </button>
        <button
          v-if="isDraftModified"
          type="button"
          :class="actionButtonClass"
          class="border-primary/50 text-primary"
          data-pob-build-save-selection
          :title="t('pobBuild.mods.saveSelectionTitle')"
          @click="saveDraft"
        >
          <Save class="size-[var(--control-icon-sm)] shrink-0" aria-hidden="true" />
          {{ t('pobBuild.mods.saveSelection') }}
        </button>
        <button
          v-if="isDraftModified"
          type="button"
          :class="actionButtonClass"
          class="ml-auto"
          data-pob-build-discard-draft
          :title="t('searchPreview.action.resetTuneTitle')"
          @click="discardDraft"
        >
          <RotateCcw class="size-[var(--control-icon-sm)] shrink-0" aria-hidden="true" />
          {{ t('searchPreview.action.resetTune') }}
        </button>
        <button
          v-else-if="effectiveRow.searchCustomized"
          type="button"
          :class="actionButtonClass"
          class="ml-auto"
          data-pob-build-reset-search
          @click="emit('reset-search')"
        >
          <RotateCcw class="size-[var(--control-icon-sm)] shrink-0" aria-hidden="true" />
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

          <ul
            class="m-0 list-none overflow-hidden rounded-md border border-border p-0"
            :class="{ 'opacity-60': effectiveRow.searchOverride }"
          >
            <li
              v-for="line in modLines"
              :key="line.index"
              :data-mod-kind="line.mod.kind"
              :data-mod-searched="line.mod.searched ? 'true' : 'false'"
              class="flex min-h-[var(--control-height-sm)] items-center gap-[var(--pxd-space-sm)] border-t border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-body)] leading-[1.35] first:border-t-0 break-words"
              :class="[
                !line.domain || line.domain === 'explicit'
                  ? 'text-foreground'
                  : 'pxd-stat-domain-text',
                { 'opacity-60': line.mod.stat && !line.mod.searched },
              ]"
              :style="getStatDomainStyle(line.domain)"
            >
              <Checkbox
                v-if="line.mod.stat"
                data-pob-build-mod-toggle
                :model-value="line.mod.searched"
                :disabled="effectiveRow.searchOverride"
                :aria-label="t('pobBuild.mods.statAria', { text: line.mod.text })"
                @update:model-value="(value) => setStatEnabled(line.mod.stat!.id, value === true)"
              />
              <span v-else class="size-[var(--checkbox-size,18px)] shrink-0" aria-hidden="true" />
              <StatDomainMenu
                v-if="line.domainSwitch"
                data-pob-build-mod-domain
                :domain="line.domainSwitch.current"
                :domains="line.domainSwitch.domains"
                :disabled="effectiveRow.searchOverride"
                @select="(domain) => setDomain(line.domainSwitch!.key, domain)"
              />
              <span
                v-else-if="modDomainBadge(line)"
                :class="STAT_DOMAIN_BADGE_CLASS"
                :data-stat-domain="line.domain"
              >
                {{ modDomainBadge(line) }}
              </span>
              <span class="min-w-0 flex-1">{{ line.mod.text }}</span>
              <template v-if="line.editor">
                <span
                  class="shrink-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
                  aria-hidden="true"
                >
                  {{ line.editor.bound === 'min' ? '≥' : '≤' }}
                </span>
                <input
                  type="number"
                  inputmode="decimal"
                  step="any"
                  data-pob-build-mod-bound
                  :data-bound="line.editor.bound"
                  :class="[boundInputBaseClass, 'w-[calc(var(--control-height-sm)*2.25)] shrink-0']"
                  :value="line.editor.value ?? ''"
                  :disabled="!line.mod.searched || effectiveRow.searchOverride"
                  :aria-label="
                    t(
                      line.editor.bound === 'min'
                        ? 'pobBuild.mods.minAria'
                        : 'pobBuild.mods.maxAria',
                    )
                  "
                  @change="commitBound(line.editor, $event)"
                  @keydown.enter.prevent="blurTarget"
                />
              </template>
            </li>
          </ul>

          <!-- 至少符合 N 項 / 總和條件 -->
          <div
            v-if="effectiveRow.filters.length > 0"
            class="mt-[var(--pxd-space-xs)] flex flex-wrap items-center gap-x-[var(--pxd-space-lg)] gap-y-[var(--pxd-space-sm)] rounded-md border border-border bg-muted/30 px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] text-muted-foreground"
            :class="{ 'opacity-60': effectiveRow.searchOverride }"
          >
            <span class="inline-flex items-center gap-[var(--pxd-space-xs)]">
              <Checkbox
                :id="controlId('count')"
                data-pob-build-count-mode
                :model-value="effectiveRow.countMin !== undefined"
                :disabled="effectiveRow.searchOverride || effectiveRow.visceraBundle"
                @update:model-value="(value) => toggleCountMode(value === true)"
              />
              <!-- label 不包住 Checkbox：包住時點一下會被 label 再觸發一次而切回原狀 -->
              <label :for="controlId('count')" class="cursor-pointer">{{
                t('pobBuild.mods.countMode')
              }}</label>
            </span>
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
                :class="[boundInputBaseClass, 'w-[calc(var(--control-height-sm)*1.6)]']"
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
              <label :for="controlId('pseudo')" class="cursor-pointer">{{
                t('pobBuild.mods.pseudo')
              }}</label>
            </span>
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
