<script setup lang="ts">
import { reactive } from 'vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { StatGroupTemplate } from '@/utils/stat-group-template-store';
import { activeStatGroupTemplateSlots } from '@/utils/stat-group-template-slot-registry';
import { t } from '@/utils/i18n';
import { useCriteriaOverlayManager } from './criteria-overlay-manager';
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

function closeMenus() {
  Object.keys(openStateMap).forEach((key) => {
    openStateMap[Number(key)] = false;
  });
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
    <DropdownMenu v-if="slotEl.isConnected" v-model:open="openStateMap[slotIndex]">
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
        class="flex w-[260px] max-h-[min(420px,var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))] flex-col gap-[var(--pxd-space-xs)] overflow-hidden"
      >
        <DropdownMenuLabel
          class="shrink-0 text-[length:var(--pxd-font-caption)] text-muted-foreground"
        >
          {{ t('statGroupTemplate.host.menuLabel') }}
        </DropdownMenuLabel>

        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto pxd-scrollbar">
          <p
            v-if="templates.length === 0"
            class="m-0 px-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
          >
            {{ t('statGroupTemplate.empty.noTemplates') }}
          </p>
          <DropdownMenuItem
            v-for="template in templates"
            :key="template.id"
            size="sm"
            data-test="stat-group-template-menu-item"
            class="shrink-0 cursor-pointer"
            @select="applyTemplate(template)"
          >
            <span class="min-w-0 flex-1 truncate">{{ template.name }}</span>
            <span class="shrink-0 text-[length:var(--pxd-font-micro)] text-muted-foreground">
              {{ template.statGroups.length }} {{ t('statGroupTemplate.unit.groups') }}
            </span>
          </DropdownMenuItem>
        </div>

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
