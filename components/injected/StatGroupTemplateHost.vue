<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import type { StatGroupTemplate } from '@/utils/stat-group-template-store';
import { activeStatGroupTemplateSlots } from '@/utils/stat-group-template-slot-registry';
import { t } from '@/utils/i18n';
import { filterTemplatesByName, useCriteriaOverlayManager } from './criteria-overlay-manager';
import { describeStatGroupsTooltip, formatCompactStatGroupChip } from './criteria-overlay-labels';
import StatGroupTemplateSaveDialog from './StatGroupTemplateSaveDialog.vue';

const emit = defineEmits<{
  /** 使用者要求開啟側邊欄的「常用詞綴群組」管理分頁。 */
  manage: [];
}>();

const manager = useCriteriaOverlayManager();
const { templates, canUndo, busy, saveDialog } = manager;
const saveDialogOpen = saveDialog.open;
const saveParts = saveDialog.parts;
const openStateMap = reactive<Record<number, boolean>>({});
const menuFilterQuery = ref('');

const filteredTemplates = computed(() =>
  filterTemplatesByName(templates.value, menuFilterQuery.value, manager.version),
);

function handleOpenChange(slotIndex: number, open: boolean) {
  openStateMap[slotIndex] = open;
  if (!open) menuFilterQuery.value = '';
}

function closeMenus() {
  Object.keys(openStateMap).forEach((key) => {
    openStateMap[Number(key)] = false;
  });
  menuFilterQuery.value = '';
}

function menuItemBadge(template: StatGroupTemplate): string {
  return template.statGroups.map(formatCompactStatGroupChip).join(' ');
}

function menuItemTooltip(template: StatGroupTemplate): string {
  return describeStatGroupsTooltip(template.statGroups, manager.version);
}

function applyTemplate(template: StatGroupTemplate) {
  closeMenus();
  void manager.applyTemplate(template);
}

function undoLastApply() {
  closeMenus();
  void manager.undo();
}

function beginSave() {
  closeMenus();
  void manager.beginSaveTemplate();
}

function openManager() {
  closeMenus();
  emit('manage');
}
</script>

<template>
  <template v-for="(slotEl, slotIndex) in activeStatGroupTemplateSlots" :key="slotIndex">
    <DropdownMenu
      v-if="slotEl.isConnected"
      :open="openStateMap[slotIndex]"
      @update:open="(val) => handleOpenChange(slotIndex, val)"
    >
      <Teleport :to="slotEl">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="btn poexd-stat-group-template-btn"
            style="
              height: 100%;
              margin: 0;
              box-sizing: border-box;
              display: inline-flex;
              align-items: center;
            "
            data-test="stat-group-template-trigger"
            :title="t('statGroupTemplate.title')"
            :disabled="busy"
          >
            <span>{{ t('statGroupTemplate.host.trigger') }}</span>
          </button>
        </DropdownMenuTrigger>
      </Teleport>

      <DropdownMenuContent
        side="bottom"
        align="start"
        :side-offset="4"
        :collision-padding="8"
        class="flex w-[280px] max-h-[min(420px,var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] flex-col gap-[var(--pxd-space-xs)] overflow-hidden"
      >
        <DropdownMenuLabel
          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
        >
          {{ t('statGroupTemplate.host.menuLabel') }}
        </DropdownMenuLabel>

        <div v-if="templates.length > 5" class="shrink-0 px-[var(--pxd-space-xs)]">
          <Input
            v-model="menuFilterQuery"
            size="sm"
            data-test="stat-group-template-host-search"
            :placeholder="t('statGroupTemplate.host.searchPlaceholder')"
            @keydown.stop
          />
        </div>

        <ScrollAreaRoot class="relative min-h-0 flex-1 overflow-hidden">
          <ScrollAreaViewport class="h-full w-full min-h-0">
            <div class="flex flex-col">
              <p
                v-if="templates.length === 0"
                class="m-0 px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
              >
                {{ t('statGroupTemplate.empty.noTemplates') }}
              </p>
              <p
                v-else-if="filteredTemplates.length === 0"
                class="m-0 px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
              >
                {{ t('statGroupTemplate.empty.noMatch', { query: menuFilterQuery.trim() }) }}
              </p>
              <DropdownMenuItem
                v-for="template in filteredTemplates"
                :key="template.id"
                size="sm"
                data-test="stat-group-template-menu-item"
                :title="menuItemTooltip(template)"
                class="shrink-0 cursor-pointer"
                @select="applyTemplate(template)"
              >
                <span class="min-w-0 flex-1 truncate">{{ template.name }}</span>
                <span class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground">
                  {{ menuItemBadge(template) }}
                </span>
              </DropdownMenuItem>
            </div>
          </ScrollAreaViewport>
          <ScrollBar />
          <ScrollAreaCorner />
        </ScrollAreaRoot>

        <DropdownMenuSeparator class="shrink-0" />
        <DropdownMenuItem
          size="sm"
          data-test="stat-group-template-save-current"
          class="shrink-0 cursor-pointer"
          @select="beginSave"
        >
          {{ t('statGroupTemplate.host.saveCurrent') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          size="sm"
          data-test="stat-group-template-undo"
          class="shrink-0 cursor-pointer"
          :disabled="!canUndo"
          @select="undoLastApply"
        >
          {{ t('statGroupTemplate.action.undoTitle') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          size="sm"
          data-test="stat-group-template-manage"
          class="shrink-0 cursor-pointer"
          @select="openManager"
        >
          {{ t('statGroupTemplate.action.manage') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </template>

  <StatGroupTemplateSaveDialog
    :open="saveDialogOpen"
    :parts="saveParts"
    default-name=""
    @update:open="saveDialogOpen = $event"
    @save="manager.saveTemplate($event)"
  />
</template>
