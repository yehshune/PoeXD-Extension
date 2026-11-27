<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { t } from '@/utils/i18n';
import { SIDEBAR_MODULES, type SidebarModulePreferenceKey } from '@/utils/sidebar-modules';
import {
  SIDEBAR_MODULE_PRESENTATION,
  getSidebarModuleDescription,
  getSidebarModuleLabel,
} from '../sidebar-module-presentation';
import SettingsRow from './SettingsRow.vue';

const props = defineProps<{
  values: Readonly<Record<SidebarModulePreferenceKey, boolean>>;
}>();

const emit = defineEmits<{
  toggle: [key: SidebarModulePreferenceKey, value: boolean];
  openPobSharePermission: [];
}>();

const controlId = (id: string) => `sidebar-module-${id}`;
</script>

<template>
  <div class="flex flex-col gap-[var(--pxd-field-gap)]">
    <ul class="m-0 flex list-none flex-col gap-[var(--pxd-space-xs)] p-0" role="list">
      <li v-for="module in SIDEBAR_MODULES" :key="module.id" :data-sidebar-module="module.id">
        <SettingsRow
          :label="getSidebarModuleLabel(module.id)"
          :details="getSidebarModuleDescription(module.id)"
          :keywords="
            module.id === 'pob-build' ? [t('pobShare.settings.label'), 'pobb.in', 'pastebin'] : []
          "
          :control-id="controlId(module.id)"
          class="rounded-md py-[var(--pxd-space-xs)] transition-opacity"
          :class="props.values[module.preferenceKey] ? '' : 'opacity-70'"
        >
          <template #leading>
            <span
              class="inline-flex size-[var(--control-height-sm,1.75rem)] shrink-0 items-center justify-center rounded-md border transition-colors"
              :class="
                props.values[module.preferenceKey]
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-dashed border-border bg-transparent text-muted-foreground'
              "
              aria-hidden="true"
            >
              <component
                :is="SIDEBAR_MODULE_PRESENTATION[module.id].icon"
                class="size-[var(--control-icon-default,16px)]"
              />
            </span>
          </template>
          <template #default="{ describedBy }">
            <div class="flex items-center gap-[var(--pxd-space-sm)]">
              <Button
                v-if="module.id === 'pob-build' && props.values[module.preferenceKey]"
                type="button"
                variant="outline"
                size="sm"
                class="shrink-0"
                data-test="pob-share-permission"
                :title="t('pobShare.settings.label')"
                @click="emit('openPobSharePermission')"
              >
                {{ t('pobShare.settings.manageBtn') }}
              </Button>
              <Switch
                :id="controlId(module.id)"
                :model-value="props.values[module.preferenceKey]"
                :aria-describedby="describedBy"
                @update:model-value="emit('toggle', module.preferenceKey, Boolean($event))"
              />
            </div>
          </template>
        </SettingsRow>
      </li>
    </ul>
  </div>
</template>
