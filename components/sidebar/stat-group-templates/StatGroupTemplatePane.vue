<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { Eye, Pencil, SlidersHorizontal, Trash2 } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { loadTradeDictionaries } from '@/utils/trade-stat-dictionary';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';
import { criteriaFromTradeQuery } from '@/utils/criteria-overlay';
import SidebarPane from '../layout/SidebarPane.vue';
import SidebarEmptyState from '../layout/SidebarEmptyState.vue';
import SidebarFilterEmptyState from '../layout/SidebarFilterEmptyState.vue';
import DragTrashZone from '../layout/DragTrashZone.vue';
import TradeSearchPreviewPopover from '../search-preview/TradeSearchPreviewPopover.vue';
import {
  rowAnchorFromEvent,
  usePinnedPreview,
  type TradeSearchPreviewData,
} from '../composables/useTradeSearchPreview';
import { useSortableTrashList } from '../composables/useSortableTrashList';
import { useDebouncedRef } from '../composables/useDebouncedSearch';
import {
  STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH,
  filterTemplates,
  useCriteriaOverlayManager,
  type CriteriaOverlayManager,
  type StatGroupTemplate,
} from '@/entrypoints/content/logic/criteria-overlay-manager';
import {
  describeStatGroupsTooltip,
  formatCompactStatGroupChip,
  summarizeOverlayCriteria,
} from '@/components/injected/criteria-overlay-labels';
import { t } from '@/utils/i18n';
import StatGroupTemplateToolbar from './StatGroupTemplateToolbar.vue';

const props = defineProps<{
  /** 測試可注入；正式環境使用頁面共用的管理器。 */
  manager?: CriteriaOverlayManager;
  /** 測試可注入；預設讀取目前網址。 */
  readUrl?: () => string;
  /** 側邊欄所在側；預覽與垃圾桶都開在另一側。 */
  sidebarPosition?: 'left' | 'right';
}>();

const LIST_SCROLL_SELECTOR = '[data-pane="stat-group-template"] [data-slot="sidebar-pane-scroll"]';
const ROW_SELECTOR = '[data-template-id]';

const manager = props.manager ?? useCriteriaOverlayManager();
const { templates, busy } = manager;
const readUrl = props.readUrl ?? (() => window.location.href);

const query = ref('');
const listRef = ref<HTMLElement | null>(null);
const pageHasForm = ref(isTradeSearchFormUrl(readUrl()));
const sidebarPosition = computed(() => props.sidebarPosition ?? 'left');

const editingTemplateId = ref<string | null>(null);
const editingTemplateName = ref('');
const renameInputRef = ref<InstanceType<typeof Input>[] | InstanceType<typeof Input> | null>(null);

const debouncedQuery = useDebouncedRef(query);

const visibleTemplates = computed(() =>
  filterTemplates(templates.value, debouncedQuery.value, manager.version),
);
/** 搜尋中或行內編輯名稱時停用排序與拖曳刪除，避免誤觸與錯位。 */
const canDrag = computed(() => query.value.trim() === '' && editingTemplateId.value === null);

const hasVisibleTemplates = computed(() => visibleTemplates.value.length > 0);

const { setTrashZoneRef, isDragging, isOverTrash, trashStyle } = useSortableTrashList({
  listRef,
  scrollSelector: LIST_SCROLL_SELECTOR,
  draggableSelector: ROW_SELECTOR,
  filter: 'input',
  canDrag,
  hasItems: hasVisibleTemplates,
  getItemId: (el) => el.dataset.templateId,
  getOrderedIds: () => templates.value.map((template) => template.id),
  onReorder: (nextIds) => manager.reorderTemplates(nextIds),
  onTrashDrop: async (templateId) => {
    const target = templates.value.find((template) => template.id === templateId);
    if (target) await manager.removeTemplate(target);
  },
});

const preview = usePinnedPreview<StatGroupTemplate>({ disabled: isDragging });

function criteriaOf(template: StatGroupTemplate) {
  return { statGroups: template.statGroups, fields: [], sectionDisabled: {} };
}

/** 範本只有詞綴群組，直接組成預覽資料，不需要像書籤一樣解碼網址。 */
const previewData = computed<TradeSearchPreviewData | null>(() => {
  const template = preview.activeItem.value;
  if (!template) return null;
  return {
    loading: false,
    gameVersion: manager.version,
    meta: { suggestedName: template.name, stats: [], filters: [] },
    criteria: criteriaOf(template),
  };
});

/** 預覽可暫時微調的條件：範本的詞綴群組就是市集 query 的 stats */
const previewRawQuery = computed<Record<string, unknown> | null>(() => {
  const template = preview.activeItem.value;
  return template ? { query: { stats: template.statGroups } } : null;
});

/** 把預覽中微調後的詞綴群組存回範本；存回後範本更新，預覽的暫存也跟著重設 */
async function saveBackPreview(modifiedQuery: Record<string, unknown>): Promise<void> {
  const template = preview.activeItem.value;
  if (!template) return;
  const { statGroups } = criteriaFromTradeQuery(modifiedQuery);
  await manager.updateTemplateStatGroups(template, statGroups);
}

function summaryOf(template: StatGroupTemplate): string {
  const filters = template.statGroups.reduce((sum, g) => sum + g.filters.length, 0);
  const chips = template.statGroups.map(formatCompactStatGroupChip).join(' ');
  const base = `${summarizeOverlayCriteria(criteriaOf(template))} · ${filters} ${t('statGroupTemplate.unit.affixes')}`;
  return chips ? `${base} · ${chips}` : base;
}

function tooltipOf(template: StatGroupTemplate): string {
  return describeStatGroupsTooltip(template.statGroups, manager.version);
}

async function startRename(template: StatGroupTemplate) {
  editingTemplateId.value = template.id;
  editingTemplateName.value = template.name;
  await nextTick();
  const rawRef = Array.isArray(renameInputRef.value)
    ? renameInputRef.value[0]
    : renameInputRef.value;
  const inputEl =
    (rawRef?.$el instanceof HTMLInputElement
      ? rawRef.$el
      : (rawRef?.$el as HTMLElement | undefined)?.querySelector?.('input')) ??
    listRef.value?.querySelector<HTMLInputElement>(
      '[data-test="stat-group-template-rename-input"]',
    );
  inputEl?.focus();
  inputEl?.select();
}

let isCancellingRename = false;

function cancelRename() {
  isCancellingRename = true;
  editingTemplateId.value = null;
  editingTemplateName.value = '';
  void nextTick(() => {
    isCancellingRename = false;
  });
}

async function commitRename(template: StatGroupTemplate, event?: Event) {
  if (event instanceof KeyboardEvent && event.isComposing) return;
  if (isCancellingRename || editingTemplateId.value !== template.id) return;
  const targetInput =
    event?.target instanceof HTMLInputElement
      ? event.target
      : listRef.value?.querySelector<HTMLInputElement>(
          '[data-test="stat-group-template-rename-input"]',
        );
  const rawName = targetInput ? targetInput.value : editingTemplateName.value;
  const nextName = rawName.trim();
  editingTemplateId.value = null;
  editingTemplateName.value = '';
  if (!nextName || nextName === template.name) return;
  await manager.renameTemplate(template, nextName);
}

/** 官方頁面是 SPA，路由可能在側邊欄開著時改變，因此在互動時重新判斷。 */
function refreshPageHasForm() {
  pageHasForm.value = isTradeSearchFormUrl(readUrl());
}

function togglePreview(template: StatGroupTemplate, event: Event) {
  refreshPageHasForm();
  preview.toggle(template, rowAnchorFromEvent(event, ROW_SELECTOR));
}

// 預覽中的範本被刪除或改名時，同步關閉或更新
watch(templates, (list) => {
  const active = preview.activeItem.value;
  if (!active) return;
  const latest = list.find((t) => t.id === active.id);
  if (!latest) preview.close();
  else if (latest !== active) preview.activeItem.value = latest;
});

onMounted(async () => {
  try {
    await loadTradeDictionaries(manager.version);
  } catch (error) {
    console.warn('[PoeXD] 詞綴字典載入失敗，改以原始 ID 顯示:', error);
  }
});
</script>

<template>
  <SidebarPane
    data-pane="stat-group-template"
    class="stat-group-template-pane"
    @pointerenter="refreshPageHasForm"
  >
    <template #fixed>
      <StatGroupTemplateToolbar v-model:query="query" :manager="manager" :can-save="pageHasForm" />
    </template>

    <template #scroll>
      <SidebarEmptyState
        v-if="templates.length === 0"
        :message="t('statGroupTemplate.empty.noTemplates')"
        :hint="t('statGroupTemplate.empty.hint')"
        data-test="stat-group-template-empty"
      >
        <template #icon><SlidersHorizontal /></template>
      </SidebarEmptyState>

      <SidebarFilterEmptyState
        v-else-if="visibleTemplates.length === 0"
        mode="search"
        :message="t('statGroupTemplate.empty.noMatch', { query: query.trim() })"
        data-test="stat-group-template-no-match"
        @reset="query = ''"
      />

      <ul
        v-show="visibleTemplates.length > 0"
        ref="listRef"
        class="m-0 flex list-none flex-col overflow-hidden rounded-md border border-border bg-card p-0"
      >
        <li
          v-for="template in visibleTemplates"
          :key="template.id"
          :data-template-id="template.id"
          data-test="stat-group-template-item"
          class="template-row-item group flex items-center gap-[var(--pxd-space-xs)] border-0 border-b border-dashed border-border px-[var(--pxd-space-md)] py-[var(--pxd-bookmark-row-padding-y)] last:border-b-0 transition-colors"
          :class="[
            canDrag ? 'cursor-grab active:cursor-grabbing' : '',
            preview.activeItem.value?.id === template.id
              ? 'bg-primary/12 hover:bg-primary/15 shadow-[inset_2px_0_0_var(--primary)]'
              : 'hover:bg-muted/40',
          ]"
        >
          <div
            v-if="editingTemplateId === template.id"
            class="flex min-w-0 flex-1 flex-col gap-[var(--pxd-space-xs)]"
            @click.stop
          >
            <Input
              ref="renameInputRef"
              v-model="editingTemplateName"
              size="sm"
              class="w-full min-w-0"
              data-test="stat-group-template-rename-input"
              :maxlength="STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH"
              @keydown.enter.stop.prevent="commitRename(template, $event)"
              @keydown.esc.stop.prevent="cancelRename"
              @blur="commitRename(template, $event)"
            />
            <span class="truncate text-[length:var(--pxd-font-micro)] text-muted-foreground">
              {{ summaryOf(template) }}
            </span>
          </div>
          <button
            v-else
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer flex-col gap-[var(--pxd-space-xs)] border-0 bg-transparent p-0 text-left text-inherit"
            :aria-expanded="preview.activeItem.value?.id === template.id"
            :title="tooltipOf(template)"
            data-test="stat-group-template-toggle"
            @click="togglePreview(template, $event)"
          >
            <span class="truncate text-[length:var(--pxd-font-body)] font-medium text-foreground">
              {{ template.name }}
            </span>
            <span class="truncate text-[length:var(--pxd-font-micro)] text-muted-foreground">
              {{ summaryOf(template) }}
            </span>
          </button>

          <span
            v-if="editingTemplateId !== template.id"
            class="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              :title="t('statGroupTemplate.action.preview')"
              :aria-label="t('statGroupTemplate.action.preview')"
              @click.stop="togglePreview(template, $event)"
            >
              <Eye />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              data-test="stat-group-template-rename"
              :title="t('common.rename')"
              :aria-label="t('common.rename')"
              :disabled="busy"
              @click.stop="startRename(template)"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost-destructive"
              size="icon-sm"
              data-test="stat-group-template-delete"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              :disabled="busy"
              @click.stop="manager.removeTemplate(template)"
            >
              <Trash2 />
            </Button>
          </span>

          <Button
            variant="secondary"
            size="sm"
            class="shrink-0"
            :title="t('statGroupTemplate.action.overlayTitle')"
            data-test="stat-group-template-apply"
            :disabled="busy || !pageHasForm"
            @click.stop="manager.applyTemplate(template)"
          >
            {{ t('statGroupTemplate.action.overlay') }}
          </Button>
        </li>
      </ul>

      <!-- 單例預覽（點擊切換，見 GLOSSARY.md「Search Preview」） -->
      <TradeSearchPreviewPopover
        :open="preview.isOpen.value"
        :side="sidebarPosition === 'left' ? 'right' : 'left'"
        :preview-data="previewData"
        :reference="preview.anchorEl.value"
        :source-name="preview.activeItem.value?.name ?? ''"
        :manager="manager"
        :read-url="readUrl"
        :raw-query="previewRawQuery"
        tunable
        stats-only
        can-overwrite
        :overwrite-busy="busy"
        :overwrite-label="t('statGroupTemplate.action.saveBack')"
        :overwrite-title="t('statGroupTemplate.action.saveBackTitle')"
        @update:open="(open) => !open && preview.close()"
        @overwrite-search="saveBackPreview"
      />

      <DragTrashZone
        :ref="setTrashZoneRef"
        :visible="isDragging"
        :over-trash="isOverTrash"
        :sidebar-position="sidebarPosition"
        :style="trashStyle"
      >
        <div
          class="text-center text-[length:var(--pxd-font-secondary)] font-bold leading-snug select-none"
        >
          {{ t('statGroupTemplate.trash.release') }}
        </div>
      </DragTrashZone>
    </template>
  </SidebarPane>
</template>

<style scoped>
.sortable-ghost {
  opacity: 0.3;
  outline: 1px dashed var(--ring);
  outline-offset: -1px;
}

/* 懸停在垃圾桶上方時收縮佔位，預告刪除後的清單 */
.stat-group-template-pane:has(.drag-trash-zone.drag-hover) .template-row-item.sortable-ghost {
  visibility: hidden;
  height: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
</style>
