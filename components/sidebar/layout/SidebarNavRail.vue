<script lang="ts">
import type { Component } from 'vue';

export interface SidebarNavTab {
  id: string;
  readonly name: string;
  icon: Component;
}

export type LiveSearchPrimaryTab = 'connections' | 'pinned-items' | 'console-settings';
</script>

<script setup lang="ts">
import { Pin, Plus, Radio, Settings } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { t } from '@/utils/i18n';
import type { TradePageRole } from '@/utils/live-search-contract';

defineProps<{
  pageRole: TradePageRole;
  activeTab: string;
  primaryActiveTab: LiveSearchPrimaryTab;
  navModuleTabs: readonly SidebarNavTab[];
  toolsTab?: SidebarNavTab;
  settingsTab?: SidebarNavTab;
  liveSearchEnabled: boolean;
  pinnedItemsEnabled: boolean;
}>();

const emit = defineEmits<{
  collapse: [];
  'select-tab': [tabId: string];
  'tab-intent': [tabId: string];
  'open-live-search': [];
  'select-primary-tab': [tab: LiveSearchPrimaryTab];
  'open-custom-search': [];
}>();
</script>

<template>
  <!-- 窄長功能導覽列 (Sidebar Panel) -->
  <div
    class="sidebar-nav w-[var(--pxd-sidebar-nav-width)] h-full bg-background flex flex-col items-center py-[var(--pxd-space-md)] gap-[var(--pxd-space-md)] box-border"
  >
    <!-- 關閉按鈕 (置頂取代收合) -->
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      :title="t('sidebar.header.close')"
      :aria-label="t('sidebar.header.close')"
      data-sidebar-action="collapse"
      @click="emit('collapse')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </Button>

    <!-- Normal 模式功能導覽列 -->
    <template v-if="pageRole === 'normal'">
      <div class="nav-divider w-[60%] h-px bg-border"></div>

      <Button
        v-for="tab in navModuleTabs"
        :key="tab.id"
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="tab.name"
        :aria-label="tab.name"
        :aria-pressed="activeTab === tab.id"
        :data-sidebar-tab="tab.id"
        @mouseenter="emit('tab-intent', tab.id)"
        @focus="emit('tab-intent', tab.id)"
        @click="emit('select-tab', tab.id)"
      >
        <component :is="tab.icon" class="w-5 h-5" />
      </Button>

      <!-- 分隔線：區隔主要 pane tabs 與外部 action -->
      <div
        v-if="navModuleTabs.length > 0 && liveSearchEnabled"
        class="nav-divider w-[60%] h-px bg-border"
      ></div>

      <!-- 開啟線上搜尋主控台入口 (Action，非 pane tab) -->
      <Button
        v-if="liveSearchEnabled"
        type="button"
        variant="outline"
        size="icon-lg"
        :title="t('sidebar.nav.openLiveSearch')"
        :aria-label="t('sidebar.nav.openLiveSearch')"
        data-sidebar-action="open-live-search"
        @click="emit('open-live-search')"
      >
        <Radio class="w-5 h-5 text-primary" />
      </Button>

      <!-- 底部功能區：工具與資訊置於系統設定上方 -->
      <Button
        v-if="toolsTab"
        type="button"
        variant="ghost"
        size="icon-lg"
        class="mt-auto"
        :title="toolsTab.name"
        :aria-label="toolsTab.name"
        :aria-pressed="activeTab === toolsTab.id"
        :data-sidebar-tab="toolsTab.id"
        @mouseenter="emit('tab-intent', toolsTab.id)"
        @focus="emit('tab-intent', toolsTab.id)"
        @click="emit('select-tab', toolsTab.id)"
      >
        <component :is="toolsTab.icon" class="w-5 h-5" />
      </Button>

      <!-- 系統設定置底 -->
      <Button
        v-if="settingsTab"
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="settingsTab.name"
        :aria-label="settingsTab.name"
        :aria-pressed="activeTab === settingsTab.id"
        :data-sidebar-tab="settingsTab.id"
        @mouseenter="emit('tab-intent', settingsTab.id)"
        @focus="emit('tab-intent', settingsTab.id)"
        @click="emit('select-tab', settingsTab.id)"
      >
        <component :is="settingsTab.icon" class="w-5 h-5" />
      </Button>
    </template>

    <!-- 線上搜尋主控台專用導覽列 (不可顯示原普通導覽) -->
    <template v-else-if="pageRole === 'live-search-primary'">
      <div class="nav-divider w-[60%] h-px bg-border"></div>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="t('sidebar.nav.liveSearchConnections')"
        :aria-label="t('sidebar.nav.liveSearchConnections')"
        :aria-pressed="primaryActiveTab === 'connections'"
        data-sidebar-tab="connections"
        data-sidebar-primary-tab="connections"
        @click="emit('select-primary-tab', 'connections')"
      >
        <Radio class="w-5 h-5" />
      </Button>

      <Button
        v-if="pinnedItemsEnabled"
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="t('sidebar.nav.pinnedItems')"
        :aria-label="t('sidebar.nav.pinnedItems')"
        :aria-pressed="primaryActiveTab === 'pinned-items'"
        data-sidebar-tab="pinned-items"
        data-sidebar-primary-tab="pinned-items"
        @click="emit('select-primary-tab', 'pinned-items')"
      >
        <Pin class="w-5 h-5" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        :title="t('sidebar.nav.addConnection')"
        :aria-label="t('sidebar.nav.addConnection')"
        data-sidebar-action="open-custom-search"
        data-sidebar-primary-action="custom-search"
        @click="emit('open-custom-search')"
      >
        <Plus class="w-5 h-5" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        class="mt-auto"
        :title="t('sidebar.nav.liveSearchSettings')"
        :aria-label="t('sidebar.nav.liveSearchSettings')"
        :aria-pressed="primaryActiveTab === 'console-settings'"
        data-sidebar-tab="console-settings"
        data-sidebar-primary-tab="console-settings"
        @click="emit('select-primary-tab', 'console-settings')"
      >
        <Settings class="w-5 h-5" />
      </Button>
    </template>
  </div>
</template>
