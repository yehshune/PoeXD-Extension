<template>
  <ConfigProvider :teleport-to="portalTarget ?? undefined" :scroll-body="false">
    <TooltipProvider
      :delay-duration="220"
      :skip-delay-duration="0"
      :disable-hoverable-content="true"
    >
      <!-- 線上搜尋主控台 Viewport 全螢幕 Arrival 光框 (瞬時 800ms，pointer-events: none) -->
      <div
        v-if="pageRole === 'live-search-primary' && isArrivalActive"
        data-live-search-arrival="viewport-frame"
        class="pxd-console-arrival-frame pointer-events-none fixed inset-0 z-(--pxd-z-sidebar-overlay) overflow-hidden"
        aria-hidden="true"
      ></div>

      <div
        ref="sidebarWrapperEl"
        class="pxd-sidebar-wrapper fixed box-border text-[length:var(--pxd-font-secondary)]"
        :class="{
          collapsed: isCollapsed,
          'settings-pending invisible': !areSettingsReady,
        }"
        :data-collapse-animation="collapseAnimation ?? undefined"
        :style="{
          right: sidebarPosition === 'right' ? '0' : 'auto',
          left: sidebarPosition === 'left' ? '0' : 'auto',
          height: showCollapsedTab ? 'var(--control-height-default)' : '100vh',
          top: showCollapsedTab ? 'var(--pxd-collapsed-tab-top, 100px)' : '0',
          '--pxd-collapsed-tab-top': isCollapsed ? collapsedTabTopStyle : undefined,
          width: showCollapsedTab ? 'var(--pxd-sidebar-collapsed-width)' : actualWidth + 'px',
          ...runtimeTokens,
        }"
      >
        <!-- 收合狀態下的書籤狀小長方形 -->
        <Button
          v-show="showCollapsedTab"
          type="button"
          variant="secondary"
          size="default"
          class="relative w-[var(--pxd-sidebar-collapsed-width)] border-x-0 rounded-none px-[var(--pxd-sidebar-collapsed-padding-x)] flex items-center justify-between touch-none select-none"
          :class="isCollapsedTabDragging ? 'cursor-grabbing' : 'cursor-grab'"
          :style="{
            borderRight: sidebarPosition === 'right' ? 'none' : '1px solid var(--border)',
            borderLeft: sidebarPosition === 'left' ? 'none' : '1px solid var(--border)',
          }"
          :title="t('sidebar.header.expandDraggable')"
          :aria-label="t('sidebar.header.expand')"
          data-sidebar-action="expand"
          :data-dragging="isCollapsedTabDragging ? 'true' : undefined"
          @pointerdown="handleCollapsedTabPointerDown"
          @pointermove="handleCollapsedTabPointerMove"
          @pointerup="handleCollapsedTabPointerUp"
          @pointercancel="handleCollapsedTabPointerCancel"
          @keydown="handleCollapsedTabKeydown"
          @click="handleCollapsedTabClick"
        >
          <ToolboxIcon
            data-sidebar-brand-placeholder
            :size="'var(--pxd-brand-icon-collapsed-size)'"
            class="text-primary"
          />
          <ChevronLeft :class="sidebarPosition === 'left' ? 'rotate-180' : ''" />
          <!-- 初次安裝：尚未展開過側邊欄時的提示圓點（展開一次即消失） -->
          <span
            v-if="showExpandHint"
            data-onboarding-hint
            class="pointer-events-none absolute top-[3px] size-2 rounded-full bg-primary"
            :class="sidebarPosition === 'left' ? 'right-[3px]' : 'left-[3px]'"
            aria-hidden="true"
          ></span>
        </Button>

        <!-- 展開狀態下的側邊欄本體 -->
        <div
          v-show="!showCollapsedTab"
          class="sidebar-container flex size-full"
          :style="{ flexDirection: sidebarPosition === 'left' ? 'row-reverse' : 'row' }"
        >
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
              @click="toggleCollapse"
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
                @click="activeTab = tab.id"
              >
                <component :is="tab.icon" class="w-5 h-5" />
              </Button>

              <!-- 分隔線：區隔主要 pane tabs 與外部 action -->
              <div
                v-if="navModuleTabs.length > 0 && isModuleEnabled('live-search')"
                class="nav-divider w-[60%] h-px bg-border"
              ></div>

              <!-- 開啟線上搜尋主控台入口 (Action，非 pane tab) -->
              <Button
                v-if="isModuleEnabled('live-search')"
                type="button"
                variant="outline"
                size="icon-lg"
                :title="t('sidebar.nav.openLiveSearch')"
                :aria-label="t('sidebar.nav.openLiveSearch')"
                data-sidebar-action="open-live-search"
                @click="handleOpenLiveSearch"
              >
                <Radio class="w-5 h-5 text-primary" />
              </Button>

              <!-- 底部功能區：工具與資訊置於系統設定上方 -->
              <Button
                v-for="tab in tabs.filter((t) => t.id === 'tools')"
                :key="tab.id"
                type="button"
                variant="ghost"
                size="icon-lg"
                class="mt-auto"
                :title="tab.name"
                :aria-label="tab.name"
                :aria-pressed="activeTab === tab.id"
                :data-sidebar-tab="tab.id"
                @click="activeTab = tab.id"
              >
                <component :is="tab.icon" class="w-5 h-5" />
              </Button>

              <!-- 系統設定置底 -->
              <Button
                v-for="tab in tabs.filter((t) => t.id === 'settings')"
                :key="tab.id"
                type="button"
                variant="ghost"
                size="icon-lg"
                :title="tab.name"
                :aria-label="tab.name"
                :aria-pressed="activeTab === tab.id"
                :data-sidebar-tab="tab.id"
                @click="activeTab = tab.id"
              >
                <component :is="tab.icon" class="w-5 h-5" />
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
                @click="primaryActiveTab = 'connections'"
              >
                <Radio class="w-5 h-5" />
              </Button>

              <Button
                v-if="isModuleEnabled('pinned-items')"
                type="button"
                variant="ghost"
                size="icon-lg"
                :title="t('sidebar.nav.pinnedItems')"
                :aria-label="t('sidebar.nav.pinnedItems')"
                :aria-pressed="primaryActiveTab === 'pinned-items'"
                data-sidebar-tab="pinned-items"
                data-sidebar-primary-tab="pinned-items"
                @click="openPrimaryTab('pinned-items')"
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
                @click="handleOpenCustomSearch"
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
                @click="primaryActiveTab = 'console-settings'"
              >
                <Settings class="w-5 h-5" />
              </Button>
            </template>
          </div>

          <!-- 右側主要內容區 (Main Content) -->
          <div
            class="sidebar-content flex-1 h-full bg-background flex flex-col box-border min-w-0 @container"
            :style="{
              borderLeft: sidebarPosition === 'right' ? '1px solid var(--border)' : 'none',
              borderRight: sidebarPosition === 'left' ? '1px solid var(--border)' : 'none',
              containerType: 'inline-size',
            }"
          >
            <!-- 頂部標題區 -->
            <div
              class="content-header h-[var(--pxd-sidebar-header-height)] px-[var(--pxd-pane-padding)] border-b border-border flex items-center justify-between gap-[var(--pxd-space-sm)] bg-background min-w-0"
            >
              <div
                class="header-left flex items-baseline gap-[var(--pxd-space-sm)] min-w-0 shrink overflow-hidden"
              >
                <ToolboxIcon
                  :size="'var(--pxd-brand-icon-expanded-size)'"
                  class="text-primary self-center shrink-0"
                />
                <span
                  class="app-title pxd-header-title text-[length:var(--pxd-font-heading)] font-bold text-primary tracking-[1px] shrink-0"
                  >PoeXD</span
                >
                <span
                  v-if="appVersion"
                  class="app-version pxd-header-version text-[length:var(--pxd-font-caption)] text-muted-foreground shrink-0"
                  >{{ appVersion }}</span
                >
              </div>
              <div class="flex min-w-0 shrink items-center gap-[var(--pxd-space-xs)]">
                <span
                  class="active-tab-title text-[length:var(--pxd-font-body)] font-medium text-foreground whitespace-nowrap shrink-0 min-w-0 truncate"
                  :title="activeTabName"
                >
                  {{ activeTabName }}
                </span>
              </div>
            </div>

            <div
              class="content-body flex-1 box-border min-w-0 min-h-0 flex flex-col overflow-hidden relative"
              :class="
                pageRole === 'live-search-primary' || usesPaneScroll
                  ? 'has-pane-scroll min-h-0 p-0'
                  : ''
              "
            >
              <!-- Normal 模式：按分頁渲染對應的子元件 -->
              <template v-if="pageRole === 'normal'">
                <!-- 改版更新提示：顯示於側邊欄頂端（全分頁可見），關閉後永久不再出現 -->
                <div
                  v-if="showUpdateNotice"
                  class="shrink-0 px-[var(--pxd-pane-padding)] pt-[var(--pxd-pane-padding)]"
                >
                  <UpdateNotice :version="updateNoticeVersion" @dismiss="dismissUpdateNotice" />
                </div>
                <!-- 分頁第一次在展開的側邊欄顯示時才掛載，之後以 v-show 保留狀態 -->
                <BookmarkPane
                  v-if="isTabMounted('bookmark') && isTabVisible('bookmark')"
                  v-show="activeTab === 'bookmark'"
                />
                <HistoryPane
                  v-if="isTabMounted('history') && isTabVisible('history')"
                  v-show="activeTab === 'history'"
                />
                <StatGroupTemplatePane
                  v-if="isTabMounted('stat-group-template') && isTabVisible('stat-group-template')"
                  v-show="activeTab === 'stat-group-template'"
                  :sidebar-position="sidebarPosition"
                />
                <PobBuildPane
                  v-if="isTabMounted('pob-build') && isTabVisible('pob-build')"
                  v-show="activeTab === 'pob-build'"
                  :sidebar-position="sidebarPosition"
                />
                <PinnedItemPane
                  v-if="isTabMounted('pinned-items') && isTabVisible('pinned-items')"
                  v-show="activeTab === 'pinned-items'"
                  :sidebar-position="sidebarPosition"
                />

                <!-- Outer-scroll panes: Tools & Settings 由外層 ScrollArea 擁有 scrolling -->
                <ScrollAreaRoot
                  v-show="activeTab === 'tools' || activeTab === 'settings'"
                  data-sidebar-outer-scroll
                  class="relative flex-1 min-h-0 overflow-hidden"
                >
                  <ScrollAreaViewport
                    class="h-full w-full min-h-0 p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)]"
                  >
                    <ToolsPane v-if="isTabMounted('tools')" v-show="activeTab === 'tools'" />
                    <!-- 設定分頁控制項很多，第一次顯示才掛載；開頁就停在設定分頁時，側邊欄等它讀完偏好（ready）才顯示 -->
                    <SettingsPane
                      v-if="isTabMounted('settings')"
                      v-show="activeTab === 'settings'"
                      @ready="settingsPaneReady = true"
                    />
                  </ScrollAreaViewport>
                  <ScrollBar />
                  <ScrollAreaCorner />
                </ScrollAreaRoot>
              </template>

              <!-- Primary 模式：渲染 LiveSearch 專用 Panes (絕不 mount 普通 Bookmark/History/Settings) -->
              <template v-else-if="pageRole === 'live-search-primary'">
                <LiveSearchPrimaryPane
                  v-show="primaryActiveTab === 'connections'"
                  :controller="liveSearchController"
                  :bookmark-controller="liveSearchBookmarkController"
                  :resume-controller="liveSearchResumeController"
                  :sound-notifier="liveSearchSoundNotifier"
                  @open-add-connection="handleOpenCustomSearch"
                />
                <PinnedItemPane
                  v-if="primaryPinnedMounted && isModuleEnabled('pinned-items')"
                  v-show="primaryActiveTab === 'pinned-items'"
                  :sidebar-position="sidebarPosition"
                />
                <LiveSearchConsoleSettingsPane
                  v-show="primaryActiveTab === 'console-settings'"
                  :resume-controller="liveSearchResumeController"
                  :sound-notifier="liveSearchSoundNotifier"
                />
              </template>
            </div>
          </div>
        </div>

        <!-- 自訂寬度時的邊界拖曳把手 -->
        <div
          v-if="isResizable"
          class="sidebar-resize-handle absolute inset-y-0 w-[6px] cursor-col-resize z-(--pxd-z-sidebar-handle) transition-colors duration-150 hover:bg-primary active:bg-primary"
          :class="sidebarPosition === 'left' ? 'left -right-[3px]' : 'right -left-[3px]'"
          @mousedown.prevent="handleResizeStart"
          :title="t('sidebar.header.resizeWidth')"
        ></div>

        <!-- 全域詞綴選擇器 Modal -->
        <Dialog :open="isModalOpen" :unmount-on-hide="false" @update:open="setAffixDialogOpen">
          <DialogContent
            placement="inset"
            data-sidebar-dialog="affix"
            class="inset-x-[5vw] inset-y-[5vh] flex h-auto max-h-none w-auto max-w-none flex-col gap-0 p-0"
            :overlay-mousedown="handleOverlayMousedown"
            :overlay-mouseup="handleOverlayMouseup"
            close-class="right-[var(--pxd-pane-padding)] top-[11px]"
            @pointer-down-outside="(e) => e.preventDefault()"
            @interact-outside="(e) => e.preventDefault()"
            @escape-key-down="(e) => e.preventDefault()"
            @close-auto-focus="(e) => e.preventDefault()"
          >
            <DialogHeader
              class="h-[var(--pxd-sidebar-affix-dialog-header-height)] shrink-0 flex-row items-center justify-between gap-0 border-b border-border bg-background px-[var(--pxd-pane-padding)] py-0 text-left"
            >
              <DialogTitle class="text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px]">
                {{ t('affixSelector.dialog.title') }}
              </DialogTitle>
              <DialogDescription class="sr-only">
                {{ t('affixSelector.dialog.description') }}
              </DialogDescription>
            </DialogHeader>

            <div class="flex-1 overflow-visible p-[var(--pxd-pane-padding)] relative">
              <!-- 詞綴選擇器很重（數百個詞綴列與詞綴字典）：第一次用到才掛載，之後關閉也保留狀態 -->
              <FilterPane
                v-if="isAffixPaneMounted"
                :target-group-index="targetGroupIndex"
                :is-open="isModalOpen"
                @type-dialog-open-changed="handleTypeDialogOpenChange"
              />
            </div>
          </DialogContent>
        </Dialog>

        <!-- 全域共用對話框 Modal (Confirm / Alert / Prompt / Custom) -->
        <Dialog :open="dialogState.isOpen" @update:open="setSharedDialogOpen">
          <DialogContent
            layer="system"
            data-sidebar-dialog="shared"
            class="flex h-auto max-h-[min(var(--pxd-sidebar-shared-dialog-max-height),calc(100vh-32px))] w-[var(--pxd-sidebar-shared-dialog-width)] max-w-[calc(100vw-32px)] flex-col gap-[var(--pxd-space-lg)] p-[var(--pxd-pane-padding)]"
            @pointer-down-outside="(e) => e.preventDefault()"
            @interact-outside="(e) => e.preventDefault()"
            @escape-key-down="(e) => e.preventDefault()"
          >
            <DialogHeader
              class="shrink-0 gap-[var(--pxd-space-sm)] text-left pr-[var(--pxd-space-2xl)]"
            >
              <DialogTitle
                class="text-[length:var(--pxd-font-section-title)] font-bold tracking-[0.5px]"
              >
                {{ dialogState.title }}
              </DialogTitle>
            </DialogHeader>

            <ScrollAreaRoot
              data-sidebar-dialog-body
              class="relative min-h-0 flex-1 overflow-hidden"
            >
              <ScrollAreaViewport class="h-full w-full min-h-0">
                <DialogDescription
                  class="text-[length:var(--pxd-font-caption)] leading-[1.5] m-0 break-words [overflow-wrap:anywhere] whitespace-pre-wrap"
                >
                  {{ dialogState.message }}
                </DialogDescription>
              </ScrollAreaViewport>
              <ScrollBar />
              <ScrollAreaCorner />
            </ScrollAreaRoot>

            <div v-if="dialogState.type === 'prompt'" class="w-full shrink-0">
              <Input
                v-model="dialogState.inputValue"
                type="text"
                size="default"
                class="dialog-input w-full"
                :placeholder="dialogState.inputPlaceholder"
                data-sidebar-dialog-input
                @keyup.enter="handleDialogConfirm"
              />
            </div>

            <div
              :class="[
                'shrink-0 flex gap-[var(--pxd-space-md)] mt-[var(--pxd-space-sm)]',
                dialogState.type === 'custom' ? 'flex-col items-stretch' : 'justify-end',
              ]"
            >
              <template
                v-if="
                  dialogState.type === 'custom' &&
                  dialogState.buttons &&
                  dialogState.buttons.length > 0
                "
              >
                <Button
                  v-for="(btn, idx) in dialogState.buttons"
                  :key="idx"
                  type="button"
                  :variant="btn.variant || 'outline'"
                  size="sm"
                  class="w-full text-center"
                  data-sidebar-dialog-action="custom"
                  @click="handleCustomButtonClick(btn.value)"
                >
                  {{ btn.label }}
                </Button>
              </template>
              <template v-else>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  data-sidebar-dialog-action="confirm"
                  @click="handleDialogConfirm"
                >
                  {{ dialogState.confirmLabel || t('common.confirm') + ' (Enter)' }}
                </Button>
                <Button
                  v-if="dialogState.type !== 'alert'"
                  type="button"
                  variant="outline"
                  size="sm"
                  data-sidebar-dialog-action="cancel"
                  @click="handleDialogCancel"
                >
                  {{ dialogState.cancelLabel || t('common.cancel') + ' (Esc)' }}
                </Button>
              </template>
            </div>
          </DialogContent>
        </Dialog>

        <!-- 暫時搜尋 Dialog (僅在 live-search-primary 模式啟用) -->
        <TemporarySearchDialog
          v-if="pageRole === 'live-search-primary'"
          :open="isTemporarySearchDialogOpen"
          :source-controller="liveSearchBookmarkController"
          @update:open="isTemporarySearchDialogOpen = $event"
        />

        <!-- Injected UI: Tier Dropdown Host (掛載於既有 portalRoot) -->
        <TierDropdownHost />

        <!-- Injected UI: 「新增詞綴群組」旁的常用詞綴群組選單，僅一般頁面 -->
        <StatGroupTemplateHost
          v-if="pageRole === 'normal' && isModuleEnabled('stat-group-template')"
          @manage="openStatGroupTemplateManager"
        />

        <!-- Injected UI: 傭兵技能群組選擇器（PoE 1 一般頁面） -->
        <MercenaryPickerHost v-if="pageRole === 'normal' && version === 'poe1'" />

        <!-- 頁面導覽：設定裡的「在頁面上指出」與初始導覽 -->
        <PageGuideHost
          v-if="pageRole === 'normal'"
          :portal-target="portalTarget"
          :setup="guideSetup"
        />
      </div>
    </TooltipProvider>
  </ConfigProvider>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  shallowRef,
  onMounted,
  onUnmounted,
  watch,
  watchEffect,
  computed,
  nextTick,
  type PropType,
} from 'vue';
import { ConfigProvider } from 'reka-ui';
import BookmarkPane from './sidebar/BookmarkPane.vue';
import FilterPane from './sidebar/FilterPane.vue';
import HistoryPane from './sidebar/HistoryPane.vue';
import StatGroupTemplatePane from './sidebar/stat-group-templates/StatGroupTemplatePane.vue';
import ToolsPane from './sidebar/ToolsPane.vue';
import PobBuildPane from './sidebar/pob-build/PobBuildPane.vue';
import PinnedItemPane from './sidebar/pinned-items/PinnedItemPane.vue';
import SettingsPane from './sidebar/SettingsPane.vue';
import LiveSearchPrimaryPane from './sidebar/LiveSearchPrimaryPane.vue';
import LiveSearchConsoleSettingsPane from './sidebar/LiveSearchConsoleSettingsPane.vue';
import TemporarySearchDialog from './sidebar/TemporarySearchDialog.vue';
import UpdateNotice from './sidebar/UpdateNotice.vue';
import TierDropdownHost from './injected/TierDropdownHost.vue';
import PageGuideHost from './sidebar/page-guide/PageGuideHost.vue';
import { usePageGuide } from './sidebar/page-guide/usePageGuide';
import { getPageGuideTarget } from './sidebar/page-guide/page-guide-targets';
import type { FontSizeMode } from '@/utils/preferences-contract';
import {
  RESULT_FEATURE_KEYS,
  readResultFeatures,
  type PageGuideDemoCursor,
  type PageGuideSetupBindings,
  type ResultFeatureFlags,
} from './sidebar/page-guide/page-guide-setup';
import {
  planCustomFontSizeScale,
  planFontSizeModeChange,
  planSidebarSizeChange,
} from '@/utils/appearance-preferences';
import { findFirstTierSlotKey, tierMenuDemoSlotKey } from '@/utils/page-guide-demo-state';
import StatGroupTemplateHost from './injected/StatGroupTemplateHost.vue';
import MercenaryPickerHost from './injected/mercenary/MercenaryPickerHost.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import { getAffixSelectorPrewarmedRef } from '@/utils/affix-lexicon';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  type Preferences,
  type PreferencesModule,
} from '@/utils/preferences';
import { createVersionedStorageKeys, readStorageValue } from '@/utils/storage-contracts';
import {
  COLLAPSED_TAB_DRAG_THRESHOLD,
  COLLAPSED_TAB_KEYBOARD_STEP,
  clampCollapsedTabTop,
  collapsedTabTopCss,
} from '@/utils/collapsed-tab-position';
import { getPoeVersion } from '@/utils/trade-context';
import {
  SIDEBAR_LAYOUT_TRANSITION_EASING,
  SIDEBAR_LAYOUT_TRANSITION_MS,
} from '@/utils/sidebar-motion';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import {
  NO_ONBOARDING,
  createChromeOnboardingStore,
  dismissUpdate,
  markExpandHintSeen,
  markTourStarted,
  shouldOfferMarketTranslation,
  type OnboardingState,
} from '@/utils/onboarding';
import { createUiRuntimeTokenValues } from '@/lib/tokens';
import {
  DEFAULT_SIDEBAR_MODULE_PREFERENCES,
  SIDEBAR_MODULE_PREFERENCE_KEYS,
  isSidebarModuleEnabled,
  resolveActivePaneTab,
  resolveVisiblePaneTabs,
  type SidebarModuleId,
  type SidebarModulePreferenceKey,
} from '@/utils/sidebar-modules';
import { installDialogGlobals, useSidebarDialog } from './sidebar/composables/useSidebarDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Box,
  ChevronLeft,
  Bookmark,
  History,
  Settings,
  Radio,
  Plus,
  RotateCcw,
  CircleHelp,
  SlidersHorizontal,
  ShoppingCart,
  Pin,
} from '@lucide/vue';
import ToolboxIcon from '@/components/ui/ToolboxIcon.vue';
import { extensionMessaging } from '@/utils/extension-protocol';
import { t } from '@/utils/i18n';
import type { LiveSearchPrimaryController, TradePageRole } from '@/utils/live-search-contract';
import type { LiveSearchBookmarkController } from '@/entrypoints/content/logic/live-search-bookmark-controller';
import type { LiveSearchResumeController } from '@/entrypoints/content/logic/live-search-resume-controller';
import type { LiveSearchSoundNotifier } from '@/entrypoints/content/logic/live-search-sound-notifier';

installDialogGlobals();

function formatVersionTag(version: string | undefined): string {
  if (!version) return '';
  return version.startsWith('v') ? version : `v${version}`;
}

/** 從瀏覽器擴充資訊清單讀取目前版本號，避免在元件中寫死版本字串 */
function resolveExtensionVersion(): string {
  const manifestVersion =
    (typeof chrome !== 'undefined' ? chrome?.runtime?.getManifest?.()?.version : undefined) ??
    (
      globalThis as {
        browser?: { runtime?: { getManifest?: () => { version?: string } } };
      }
    ).browser?.runtime?.getManifest?.()?.version;
  return formatVersionTag(manifestVersion);
}

export default defineComponent({
  name: 'Sidebar',
  props: {
    portalTarget: {
      type: Object as PropType<HTMLElement | null>,
      default: null,
    },
    pageRole: {
      type: String as PropType<TradePageRole>,
      default: 'normal',
    },
    liveSearchController: {
      type: Object as PropType<LiveSearchPrimaryController | null>,
      default: null,
    },
    liveSearchBookmarkController: {
      type: Object as PropType<LiveSearchBookmarkController | null>,
      default: null,
    },
    liveSearchResumeController: {
      type: Object as PropType<LiveSearchResumeController | null>,
      default: null,
    },
    liveSearchSoundNotifier: {
      type: Object as PropType<LiveSearchSoundNotifier | null>,
      default: null,
    },
    initialArrivalSignal: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    ConfigProvider,
    TooltipProvider,
    BookmarkPane,
    FilterPane,
    HistoryPane,
    StatGroupTemplatePane,
    ToolsPane,
    PobBuildPane,
    PinnedItemPane,
    SettingsPane,
    LiveSearchPrimaryPane,
    LiveSearchConsoleSettingsPane,
    TemporarySearchDialog,
    UpdateNotice,
    TierDropdownHost,
    PageGuideHost,
    StatGroupTemplateHost,
    MercenaryPickerHost,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    ScrollAreaRoot,
    ScrollAreaViewport,
    ScrollBar,
    ScrollAreaCorner,
    Input,
    Button,
    ToolboxIcon,
    Box,
    ChevronLeft,
    Radio,
    Pin,
    Plus,
    RotateCcw,
    Settings,
  },
  setup(props) {
    const portalTarget = computed(() => props.portalTarget);
    const appVersion = resolveExtensionVersion();
    const version = getPoeVersion();
    const keys = createVersionedStorageKeys(version);
    const activeTabKey = keys.activeTab;

    const isCollapsed = ref(true);
    const sidebarPosition = ref<'left' | 'right'>('left');
    const sidebarWidth = ref(DEFAULT_PREFERENCES.sidebarWidth);
    const sidebarSize = ref<Preferences['sidebarSize']>('medium');
    let preferencesModule: PreferencesModule | undefined;
    const preferencesReady = ref(false);
    const fontSizeScale = ref(1.0);
    const fontSizeMode = ref<FontSizeMode>(DEFAULT_PREFERENCES.fontSizeMode);
    const resultFeatures = shallowRef<ResultFeatureFlags>(readResultFeatures(DEFAULT_PREFERENCES));
    const densityScale = ref(1.0);
    const activeTab = ref('bookmark');
    const primaryActiveTab = ref<'connections' | 'pinned-items' | 'console-settings'>(
      'connections',
    );
    // 主控台的釘選 pane 第一次打開才掛載
    const primaryPinnedMounted = ref(false);
    const openPrimaryTab = (tab: 'connections' | 'pinned-items' | 'console-settings') => {
      if (tab === 'pinned-items') primaryPinnedMounted.value = true;
      primaryActiveTab.value = tab;
    };
    const isTemporarySearchDialogOpen = ref(false);

    // Sidebar Module 開關：關閉的模組不出現在導覽列，也不掛載對應分頁
    const modulePrefs = ref<Record<SidebarModulePreferenceKey, boolean>>({
      ...DEFAULT_SIDEBAR_MODULE_PREFERENCES,
    });
    const isModuleEnabled = (id: SidebarModuleId) => isSidebarModuleEnabled(modulePrefs.value, id);
    const visiblePaneTabs = computed(() => resolveVisiblePaneTabs(modulePrefs.value));
    const isTabVisible = (id: string) => (visiblePaneTabs.value as readonly string[]).includes(id);

    const sidebarStateReady = ref(false);
    const settingsPaneReady = ref(props.pageRole === 'live-search-primary');
    const pageRole = computed(() => props.pageRole);
    /**
     * 側邊欄第一次顯示的時機：狀態讀完；若一開始就顯示設定分頁，也等它讀完偏好，避免先畫預設值。
     * 一旦顯示就不再收回（之後才打開設定分頁時不必讓整個側邊欄閃一下）。
     */
    const areSettingsReady = ref(false);

    /**
     * 曾在展開的側邊欄顯示過的分頁。分頁內容（書籤樹、歷史清單、PoB build 解碼等）
     * 合計數千個元件，頁面載入時全部掛載會拖慢官方頁面；第一次顯示時才掛載，之後保留。
     */
    const mountedTabs = ref<ReadonlySet<string>>(new Set());
    watchEffect(() => {
      if (!sidebarStateReady.value || isCollapsed.value) return;
      const tab = activeTab.value;
      if (mountedTabs.value.has(tab)) return;
      mountedTabs.value = new Set([...mountedTabs.value, tab]);
    });
    const isTabMounted = (tab: string) => mountedTabs.value.has(tab);
    watchEffect(() => {
      if (areSettingsReady.value || !sidebarStateReady.value) return;
      if (isTabMounted('settings') && !settingsPaneReady.value) return;
      areSettingsReady.value = true;
    });

    // 初次安裝引導（只有全新安裝才有狀態，舊使用者維持 NO_ONBOARDING）
    const onboardingStore = createChromeOnboardingStore();
    const onboarding = ref<OnboardingState>(NO_ONBOARDING);
    let stopOnboarding: (() => void) | undefined;
    const marketTranslation = ref(false);
    const displayLocale = ref<Preferences['displayLocale']>('auto');
    /** 本頁載入時的漢化狀態；之後變動需重新整理才會套用到官網頁面 */
    let pageLoadMarketTranslation: boolean | null = null;
    const marketTranslationReloadRequired = ref(false);
    const showExpandHint = computed(
      () => pageRole.value === 'normal' && isCollapsed.value && onboarding.value.expandHintPending,
    );
    const showUpdateNotice = computed(
      () =>
        pageRole.value === 'normal' &&
        !onboarding.value.tourPending &&
        onboarding.value.updatePending === true,
    );
    const updateNoticeVersion = computed(
      () => formatVersionTag(onboarding.value.lastSeenVersion) || appVersion,
    );
    const showMarketTranslationOffer = computed(() =>
      shouldOfferMarketTranslation({
        hostname: typeof window !== 'undefined' ? window.location.hostname : '',
        displayLocale: displayLocale.value,
        browserLocale: detectBrowserLocale(),
      }),
    );
    // 依序寫入：store.update 是「讀取→修改→寫回」，同時送出的兩筆更新會互相蓋掉
    let onboardingWrite: Promise<unknown> = Promise.resolve();
    const updateOnboarding = (mutate: (state: OnboardingState) => OnboardingState) => {
      onboarding.value = mutate(onboarding.value);
      onboardingWrite = onboardingWrite
        .then(() => onboardingStore.update(mutate))
        .catch((error) => {
          console.error('[PoeXD Sidebar] 無法更新初次引導狀態:', error);
        });
    };
    // 只要一般頁面的側邊欄處於展開狀態（含初始即展開、手動展開、跨分頁同步或引導狀態晚到），即清除展開提示圓點
    watchEffect(() => {
      if (
        pageRole.value === 'normal' &&
        sidebarStateReady.value &&
        !isCollapsed.value &&
        onboarding.value.expandHintPending
      ) {
        updateOnboarding(markExpandHintSeen);
      }
    });
    const dismissUpdateNotice = () => updateOnboarding(dismissUpdate);
    const updatePreference = async (patch: Partial<Preferences>, label: string) => {
      if (!preferencesModule) return;
      const outcome = await preferencesModule.update(patch);
      if (!outcome.ok) console.error(`[PoeXD Sidebar] 無法更新${label}:`, outcome.error);
    };
    const setMarketTranslation = (value: boolean) =>
      updatePreference({ marketTranslation: value }, '市集漢化設定');
    const reloadPage = () => window.location.reload();

    const isArrivalActive = ref(false);
    let arrivalTimer: ReturnType<typeof setTimeout> | null = null;

    const triggerArrivalFeedback = () => {
      if (props.pageRole !== 'live-search-primary') return;
      if (arrivalTimer) {
        clearTimeout(arrivalTimer);
        arrivalTimer = null;
      }
      isArrivalActive.value = false;
      nextTick(() => {
        isArrivalActive.value = true;
        arrivalTimer = setTimeout(() => {
          isArrivalActive.value = false;
          arrivalTimer = null;
        }, 1200);
      });
    };

    if (props.pageRole === 'live-search-primary' && props.initialArrivalSignal) {
      triggerArrivalFeedback();
    }

    let unregArrivalMessage: (() => void) | null = null;
    if (props.pageRole === 'live-search-primary') {
      try {
        unregArrivalMessage = extensionMessaging.onMessage('liveSearch:notifyArrival', () => {
          triggerArrivalFeedback();
        });
      } catch {
        // Safe fallback in test or restricted environments
      }
    }

    const handleOpenLiveSearch = async () => {
      try {
        await extensionMessaging.sendMessage('liveSearch:openPrimary', {
          gameVersion: version,
        });
      } catch (err) {
        console.error('[PoeXD Sidebar] 開啟線上搜尋主控台失敗:', err);
      }
    };

    const handleOpenCustomSearch = () => {
      isTemporarySearchDialogOpen.value = true;
    };

    const {
      dialogState,
      handleDialogConfirm,
      handleDialogCancel,
      handleCustomButtonClick,
      handleDialogDismiss,
    } = useSidebarDialog();

    const setSharedDialogOpen = (open: boolean) => {
      if (open) return;

      if (dialogState.value.isOpen) {
        handleDialogDismiss();
      }
    };

    // 監聽並記憶用戶選取的導航分頁 (區分版本)
    watch(activeTab, (newVal) => {
      chrome.storage.local.set({ [activeTabKey]: newVal });
    });

    const actualWidth = computed(() => {
      return sidebarWidth.value;
    });

    const runtimeTokens = computed(() => {
      return createUiRuntimeTokenValues({
        scale: fontSizeScale.value,
        density: densityScale.value,
        sidebarWidth: sidebarWidth.value,
      });
    });

    const isResizable = computed(() => !isCollapsed.value && sidebarSize.value === 'custom');

    let isDragging = false;
    let startX = 0;
    let startVisualWidth = 0;
    let resizeRafId: number | null = null;
    let pendingVisualWidth: number | null = null;

    const applyResizeWidth = (visualWidth: number) => {
      sidebarWidth.value = visualWidth;
      dispatchPoeEvent('poexd-sidebar-width-preview', visualWidth);
    };

    const handleResizeMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const diff = sidebarPosition.value === 'left' ? deltaX : -deltaX;
      let visualWidth = Math.round(startVisualWidth + diff);
      if (visualWidth < 300) visualWidth = 300;
      if (visualWidth > 800) visualWidth = 800;

      pendingVisualWidth = visualWidth;
      if (resizeRafId === null) {
        resizeRafId = window.requestAnimationFrame(() => {
          resizeRafId = null;
          if (pendingVisualWidth !== null && isDragging) {
            applyResizeWidth(pendingVisualWidth);
          }
        });
      }
    };

    const handleResizeEnd = () => {
      if (!isDragging) return;
      isDragging = false;
      if (resizeRafId !== null) {
        window.cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      if (pendingVisualWidth !== null) {
        applyResizeWidth(pendingVisualWidth);
        pendingVisualWidth = null;
      }
      dispatchPoeEvent('poexd-sidebar-resizing-changed', false);
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');

      void preferencesModule?.update({
        sidebarSize: 'custom',
        sidebarWidth: sidebarWidth.value,
        customSidebarWidth: sidebarWidth.value,
      });
    };

    const handleResizeStart = (e: MouseEvent) => {
      if (!isResizable.value) return;
      isDragging = true;
      startX = e.clientX;
      startVisualWidth = actualWidth.value;
      pendingVisualWidth = startVisualWidth;
      dispatchPoeEvent('poexd-sidebar-resizing-changed', true);
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      document.body.style.setProperty('user-select', 'none');
      document.body.style.setProperty('cursor', 'col-resize');
    };

    // 導覽列分頁圖示
    const tabs = [
      {
        id: 'bookmark',
        get name() {
          return t('sidebar.nav.bookmarks');
        },
        icon: Bookmark,
      },
      {
        id: 'history',
        get name() {
          return t('sidebar.nav.history');
        },
        icon: History,
      },
      {
        id: 'stat-group-template',
        get name() {
          return t('sidebar.nav.statGroupTemplates');
        },
        icon: SlidersHorizontal,
      },
      {
        id: 'pob-build',
        get name() {
          return t('sidebar.nav.pobBuild');
        },
        icon: ShoppingCart,
      },
      {
        id: 'pinned-items',
        get name() {
          return t('sidebar.nav.pinnedItems');
        },
        icon: Pin,
      },
      {
        id: 'tools',
        get name() {
          return t('sidebar.nav.tools');
        },
        icon: CircleHelp,
      },
      {
        id: 'settings',
        get name() {
          return t('sidebar.nav.settings');
        },
        icon: Settings,
      },
    ];

    const activeTabName = computed(() => {
      if (pageRole.value === 'live-search-primary') {
        if (primaryActiveTab.value === 'pinned-items') return t('sidebar.nav.pinnedItems');
        return primaryActiveTab.value === 'console-settings'
          ? t('sidebar.nav.liveSearchSettings')
          : t('sidebar.nav.liveSearchConnections');
      }
      return tabs.find((tab) => tab.id === activeTab.value)?.name ?? '';
    });

    const navModuleTabs = computed(() =>
      tabs.filter((tab) => tab.id !== 'settings' && tab.id !== 'tools' && isTabVisible(tab.id)),
    );

    // 目前分頁被關閉時，改顯示第一個仍開啟的分頁
    watch(modulePrefs, (prefs) => {
      if (!sidebarStateReady.value) return;
      const next = resolveActivePaneTab(activeTab.value, prefs);
      if (next !== activeTab.value) activeTab.value = next;
      if (
        primaryActiveTab.value === 'pinned-items' &&
        !isSidebarModuleEnabled(prefs, 'pinned-items')
      ) {
        primaryActiveTab.value = 'connections';
      }
    });

    const usesPaneScroll = computed(
      () =>
        activeTab.value === 'history' ||
        activeTab.value === 'bookmark' ||
        activeTab.value === 'stat-group-template' ||
        activeTab.value === 'pob-build' ||
        activeTab.value === 'pinned-items',
    );

    let handleStorageChange: ((changes: any) => void) | null = null;
    let stopPreferences: (() => void) | undefined;

    onMounted(async () => {
      const collapsedKey = keys.isCollapsed;
      const [preferencesOutcome, data] = await Promise.all([
        getPreferences(version),
        chrome.storage.local.get([collapsedKey, 'isCollapsed', activeTabKey, 'activeTab']),
      ]);
      if (!preferencesOutcome.ok) {
        console.error('[PoeXD Sidebar] 無法載入設定:', preferencesOutcome.error);
        return;
      }
      preferencesModule = preferencesOutcome.value;
      stopPreferences = preferencesModule.subscribe((snapshot) => {
        preferencesReady.value = true;
        sidebarPosition.value = snapshot.sidebarPosition;
        sidebarSize.value = snapshot.sidebarSize;
        sidebarWidth.value = snapshot.sidebarWidth;
        if (!isCollapsedTabDragging.value) collapsedTabTop.value = snapshot.collapsedTabTop;
        fontSizeScale.value = snapshot.fontSizeScale;
        fontSizeMode.value = snapshot.fontSizeMode;
        const nextResultFeatures = readResultFeatures(snapshot);
        if (
          RESULT_FEATURE_KEYS.some((key) => nextResultFeatures[key] !== resultFeatures.value[key])
        ) {
          resultFeatures.value = nextResultFeatures;
        }
        densityScale.value = snapshot.densityScale;
        marketTranslation.value = snapshot.marketTranslation === true;
        displayLocale.value = snapshot.displayLocale ?? 'auto';
        const nextModulePrefs = Object.fromEntries(
          SIDEBAR_MODULE_PREFERENCE_KEYS.map((key) => [key, snapshot[key] !== false]),
        ) as Record<SidebarModulePreferenceKey, boolean>;
        if (
          SIDEBAR_MODULE_PREFERENCE_KEYS.some(
            (key) => nextModulePrefs[key] !== modulePrefs.value[key],
          )
        ) {
          modulePrefs.value = nextModulePrefs;
        }
        if (pageLoadMarketTranslation === null) {
          pageLoadMarketTranslation = marketTranslation.value;
        }
        marketTranslationReloadRequired.value =
          marketTranslation.value !== pageLoadMarketTranslation;
      });

      stopOnboarding = onboardingStore.subscribe((state) => {
        onboarding.value = state;
      });
      void onboardingStore
        .read()
        .then((state) => {
          onboarding.value = state;
        })
        .catch((error) => console.error('[PoeXD Sidebar] 無法讀取初次引導狀態:', error));

      isCollapsed.value = readStorageValue(data, collapsedKey, 'isCollapsed', true);

      // 讀取 activeTab，先試新 Key，若無則試舊 Key，再不然預設 'bookmark'
      const storedActiveTab = data[activeTabKey] || data.activeTab || 'bookmark';
      activeTab.value = resolveActivePaneTab(
        tabs.some((tab) => tab.id === storedActiveTab) ? storedActiveTab : 'bookmark',
        modulePrefs.value,
      );
      sidebarStateReady.value = true;

      // 監聽非 Preference 的收合狀態。
      handleStorageChange = (changes: any) => {
        if (changes[collapsedKey]) {
          isCollapsed.value = changes[collapsedKey].newValue;
          dispatchPoeEvent('poexd-sidebar-collapsed-changed', changes[collapsedKey].newValue);
        }
      };
      chrome.storage.onChanged.addListener(handleStorageChange);

      document.addEventListener('mouseup', clearOverlayMousedown);
    });

    // 展開/收合時外框寬度與官方頁面讓位用同樣的過場；收合期間先保留面板，動畫結束才換成收合標籤
    /**
     * 展開/收合動畫：面板維持完整寬度，整個往頁面外側平移（只動 transform，不重排版面），
     * 與官方頁面讓位用同樣的時間與曲線，而且在同一個畫格起跑，面板內緣剛好貼著頁面邊緣移動。
     * 用 Web Animations 起跑，不必先畫一格起點；收合時平移結束才換成收合標籤。
     */
    const sidebarWrapperEl = ref<HTMLElement | null>(null);
    const collapseAnimation = ref<'collapsing' | 'expanding' | null>(null);
    const showCollapsedTab = computed(() => isCollapsed.value && collapseAnimation.value === null);
    let runningCollapseAnimation: Animation | null = null;
    let collapseAnimationTimer: ReturnType<typeof setTimeout> | undefined;
    const prefersReducedMotion = () =>
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const finishCollapseAnimation = () => {
      clearTimeout(collapseAnimationTimer);
      const animation = runningCollapseAnimation;
      runningCollapseAnimation = null;
      collapseAnimation.value = null;
      // 收合用 fill: forwards 停在畫面外；和換成收合標籤在同一次渲染移除
      animation?.cancel();
    };
    const playCollapseAnimation = (collapsing: boolean) => {
      finishCollapseAnimation();
      if (prefersReducedMotion()) return;
      collapseAnimation.value = collapsing ? 'collapsing' : 'expanding';
      // 沒有 Web Animations（或動畫沒結束事件）時的保險
      collapseAnimationTimer = setTimeout(
        finishCollapseAnimation,
        SIDEBAR_LAYOUT_TRANSITION_MS + 100,
      );
      void nextTick(() => {
        const el = sidebarWrapperEl.value;
        if (!el || typeof el.animate !== 'function' || collapseAnimation.value === null) return;
        const offscreen = `translateX(${sidebarPosition.value === 'left' ? '-100%' : '100%'})`;
        const animation = el.animate(
          [
            { transform: collapsing ? 'translateX(0)' : offscreen },
            { transform: collapsing ? offscreen : 'translateX(0)' },
          ],
          {
            duration: SIDEBAR_LAYOUT_TRANSITION_MS,
            easing: SIDEBAR_LAYOUT_TRANSITION_EASING,
            fill: collapsing ? 'forwards' : 'none',
          },
        );
        runningCollapseAnimation = animation;
        animation.onfinish = () => {
          if (runningCollapseAnimation === animation) finishCollapseAnimation();
        };
      });
    };

    const toggleCollapse = () => {
      playCollapseAnimation(!isCollapsed.value);
      isCollapsed.value = !isCollapsed.value;
      const collapsedKey = keys.isCollapsed;
      chrome.storage.local.set({ [collapsedKey]: isCollapsed.value });
      dispatchPoeEvent('poexd-sidebar-collapsed-changed', isCollapsed.value);
    };

    // 收合標籤：沿面板所在側邊上下拖曳；移動未超過門檻時仍視為點擊展開
    const collapsedTabTop = ref(DEFAULT_PREFERENCES.collapsedTabTop);
    const collapsedTabTopStyle = computed(() => collapsedTabTopCss(collapsedTabTop.value));
    const isCollapsedTabDragging = ref(false);
    let collapsedTabDrag: {
      pointerId: number;
      startY: number;
      startTop: number;
      tabHeight: number;
    } | null = null;
    let suppressCollapsedTabClick = false;

    const previewCollapsedTabTop = (top: number) => {
      collapsedTabTop.value = top;
      dispatchPoeEvent('poexd-sidebar-collapsed-top-preview', top);
    };

    const commitCollapsedTabTop = (top: number) => {
      previewCollapsedTabTop(top);
      void preferencesModule?.update({ collapsedTabTop: top }).then((outcome) => {
        if (!outcome.ok) console.error('[PoeXD Sidebar] 無法儲存收合標籤位置:', outcome.error);
      });
    };

    const readCollapsedTabMetrics = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      // 尚未完成排版（height <= 0）時退回目前儲存的位置與預設高度
      return {
        top: rect.height > 0 ? rect.top : collapsedTabTop.value,
        height: rect.height > 0 ? rect.height : 32,
      };
    };

    watch(isCollapsed, (collapsed) => {
      if (collapsed) return;
      collapsedTabDrag = null;
      if (isCollapsedTabDragging.value) {
        isCollapsedTabDragging.value = false;
        previewCollapsedTabTop(preferencesModule?.read().collapsedTabTop ?? collapsedTabTop.value);
      }
    });

    const handleCollapsedTabPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const { top, height } = readCollapsedTabMetrics(e.currentTarget as HTMLElement);
      // 從實際顯示位置起算：儲存值可能因視窗變小而被 CSS clamp 過
      collapsedTabDrag = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startTop: top,
        tabHeight: height,
      };
      suppressCollapsedTabClick = false;
    };

    const handleCollapsedTabPointerMove = (e: PointerEvent) => {
      const drag = collapsedTabDrag;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const deltaY = e.clientY - drag.startY;
      if (!isCollapsedTabDragging.value) {
        if (Math.abs(deltaY) < COLLAPSED_TAB_DRAG_THRESHOLD) return;
        isCollapsedTabDragging.value = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      previewCollapsedTabTop(
        clampCollapsedTabTop(drag.startTop + deltaY, window.innerHeight, drag.tabHeight),
      );
    };

    const finishCollapsedTabDrag = (e: PointerEvent, commit: boolean) => {
      const drag = collapsedTabDrag;
      if (!drag || e.pointerId !== drag.pointerId) return;
      collapsedTabDrag = null;
      if (!isCollapsedTabDragging.value) return;
      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture?.(e.pointerId)) {
        target.releasePointerCapture?.(e.pointerId);
      }
      isCollapsedTabDragging.value = false;
      if (commit) {
        // 拖曳結束後瀏覽器仍會送出 click，擋掉這一次避免誤觸展開
        suppressCollapsedTabClick = true;
        setTimeout(() => {
          suppressCollapsedTabClick = false;
        }, 0);
        commitCollapsedTabTop(collapsedTabTop.value);
      } else {
        previewCollapsedTabTop(preferencesModule?.read().collapsedTabTop ?? drag.startTop);
      }
    };

    const handleCollapsedTabPointerUp = (e: PointerEvent) => finishCollapsedTabDrag(e, true);
    const handleCollapsedTabPointerCancel = (e: PointerEvent) => finishCollapsedTabDrag(e, false);

    const handleCollapsedTabClick = () => {
      if (suppressCollapsedTabClick) {
        suppressCollapsedTabClick = false;
        return;
      }
      toggleCollapse();
    };

    /** Alt + ↑/↓ 以鍵盤調整收合標籤位置 */
    const handleCollapsedTabKeydown = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const { top: currentTop, height: tabHeight } = readCollapsedTabMetrics(
        e.currentTarget as HTMLElement,
      );
      const step = e.key === 'ArrowUp' ? -COLLAPSED_TAB_KEYBOARD_STEP : COLLAPSED_TAB_KEYBOARD_STEP;
      commitCollapsedTabTop(clampCollapsedTabTop(currentTop + step, window.innerHeight, tabHeight));
    };

    /** 從「新增詞綴群組」旁的選單跳到側邊欄管理分頁。 */
    const openStatGroupTemplateManager = () => {
      activeTab.value = 'stat-group-template';
      if (isCollapsed.value) toggleCollapse();
    };

    const isModalOpen = ref(false);
    const targetGroupIndex = ref(0);

    const closeModal = () => {
      isModalOpen.value = false;
    };
    const setAffixDialogOpen = (open: boolean) => {
      if (open) return;

      if (isModalOpen.value) {
        closeModal();
      }
    };
    const removeCloseAffixModalListener = listenPoeEvent('poexd-close-affix-modal', closeModal);

    const isMouseDownOnOverlay = ref(false);
    const handleOverlayMousedown = () => {
      isMouseDownOnOverlay.value = true;
    };
    const handleOverlayMouseup = () => {
      if (isMouseDownOnOverlay.value) {
        closeModal();
      }
      isMouseDownOnOverlay.value = false;
    };
    const clearOverlayMousedown = () => {
      isMouseDownOnOverlay.value = false;
    };

    // 詞綴選擇器很重：頁面初始載入時不掛載；等官方頁面載完並於閒置時預熱完字典，或使用者提前開啟時才掛載
    const isAffixPaneMounted = ref(false);
    const affixSelectorPrewarmed = getAffixSelectorPrewarmedRef();
    watchEffect(() => {
      if (pageRole.value === 'normal' && affixSelectorPrewarmed.value) {
        isAffixPaneMounted.value = true;
      }
    });

    // 監聽來自 content.ts (注入按鈕點擊) 的打開 Modal 事件
    const removeOpenAffixModalListener = listenPoeEvent('poexd-open-affix-modal', (detail) => {
      isAffixPaneMounted.value = true;
      targetGroupIndex.value = detail.groupIndex;
      isModalOpen.value = true;
    });

    // 類別選擇窗由 FilterPane 自己監聽；它還沒掛載時先掛載，再把事件補送給它
    const removeSelectTypeModalListener = listenPoeEvent('poexd-trigger-select-type-modal', () => {
      if (isAffixPaneMounted.value) return;
      isAffixPaneMounted.value = true;
      void nextTick(() => dispatchPoeEvent('poexd-trigger-select-type-modal'));
    });

    const isTypeDialogOpen = ref(false);
    const handleTypeDialogOpenChange = (isOpen: boolean) => {
      isTypeDialogOpen.value = isOpen;
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        isModalOpen.value &&
        !dialogState.value.isOpen &&
        !isTypeDialogOpen.value
      ) {
        closeModal();
      }
    };

    // 監聽 Affix Dialog 顯示狀態以管理全域鍵盤監聽
    watch(isModalOpen, (newVal) => {
      if (newVal) {
        window.addEventListener('keydown', handleGlobalKeyDown);
      } else {
        window.removeEventListener('keydown', handleGlobalKeyDown);
      }
    });

    // 記錄與還原原始 PoE 網站的卷軸位置，避免彈窗關閉後卷軸跳回頂部
    let savedHostScrollPosition: { x: number; y: number } | null = null;

    const getHostScrollPosition = () => {
      if (typeof window === 'undefined') return { x: 0, y: 0 };
      return {
        x:
          window.scrollX ??
          window.pageXOffset ??
          document.documentElement?.scrollLeft ??
          document.body?.scrollLeft ??
          0,
        y:
          window.scrollY ??
          window.pageYOffset ??
          document.documentElement?.scrollTop ??
          document.body?.scrollTop ??
          0,
      };
    };

    let scrollRestoreTimers: Array<ReturnType<typeof setTimeout>> = [];
    const clearScrollRestoreTimers = () => {
      scrollRestoreTimers.forEach((t) => clearTimeout(t));
      scrollRestoreTimers = [];
    };

    const restoreHostScrollPosition = (pos: { x: number; y: number }) => {
      if (typeof window === 'undefined') return;
      clearScrollRestoreTimers();

      const apply = () => {
        window.scrollTo({
          left: pos.x,
          top: pos.y,
          behavior: 'instant' as ScrollBehavior,
        });
        if (document.documentElement) {
          document.documentElement.scrollLeft = pos.x;
          document.documentElement.scrollTop = pos.y;
        }
        if (document.body) {
          document.body.scrollLeft = pos.x;
          document.body.scrollTop = pos.y;
        }
      };

      apply();
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(apply);
      }
      scrollRestoreTimers.push(setTimeout(apply, 0));
      scrollRestoreTimers.push(setTimeout(apply, 50));
      scrollRestoreTimers.push(setTimeout(apply, 150));
    };

    // 統一收斂全域 Modal active 狀態 (Affix Dialog, Shared Dialog, Type Dialog)
    const isAnyModalActive = computed(() => {
      return isModalOpen.value || dialogState.value.isOpen || isTypeDialogOpen.value;
    });

    watch(isAnyModalActive, (newVal, oldVal) => {
      if (newVal !== oldVal) {
        dispatchPoeEvent('poexd-modal-active-changed', newVal);

        if (newVal) {
          if (!savedHostScrollPosition) {
            savedHostScrollPosition = getHostScrollPosition();
          }
        } else if (savedHostScrollPosition) {
          const target = savedHostScrollPosition;
          savedHostScrollPosition = null;
          restoreHostScrollPosition(target);
        }
      }
    });

    // 初始導覽：前段直接調整語言、漢化、側欄位置與收合把手，設定步驟的值與修改方式由這裡提供
    const pageGuide = usePageGuide();
    // 收合示範：模擬滑鼠點關閉鈕收合側欄，再按住收合標籤上下拖曳（只預覽，不改儲存的位置）
    const demoCursor = ref<PageGuideDemoCursor | null>(null);
    let collapseDemoRun = 0;
    let collapseDemoTabTopChanged = false;
    const DEMO_CURSOR_MOVE_MS = 550;
    const DEMO_DRAG_DISTANCE = 120;
    const DEMO_DRAG_MS = 600;
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const findSidebarElement = (selector: string): HTMLElement | null => {
      const root = portalTarget.value?.getRootNode() as ParentNode | undefined;
      return (root ?? document).querySelector<HTMLElement>(selector);
    };
    const centerOf = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const stopCollapseDemo = () => {
      collapseDemoRun += 1;
      demoCursor.value = null;
      if (collapseDemoTabTopChanged) {
        collapseDemoTabTopChanged = false;
        previewCollapsedTabTop(preferencesModule?.read().collapsedTabTop ?? collapsedTabTop.value);
      }
    };

    const playCollapseDemo = async () => {
      stopCollapseDemo();
      const run = collapseDemoRun;
      const alive = () => run === collapseDemoRun;
      if (isCollapsed.value) {
        toggleCollapse();
        await sleep(SIDEBAR_LAYOUT_TRANSITION_MS + 120);
        if (!alive()) return;
      }
      const closeButton = findSidebarElement('[data-sidebar-action="collapse"]');
      if (!closeButton) return;
      const close = centerOf(closeButton);
      const startX = sidebarPosition.value === 'right' ? close.x - 120 : close.x + 120;
      demoCursor.value = { x: startX, y: close.y + 140, pressed: false };
      await sleep(50);
      if (!alive()) return;
      demoCursor.value = { x: close.x, y: close.y, pressed: false };
      await sleep(DEMO_CURSOR_MOVE_MS + 150);
      if (!alive()) return;
      demoCursor.value = { x: close.x, y: close.y, pressed: true };
      await sleep(150);
      if (!alive()) return;
      demoCursor.value = { x: close.x, y: close.y, pressed: false };
      if (!isCollapsed.value) toggleCollapse();
      await sleep(SIDEBAR_LAYOUT_TRANSITION_MS + 250);
      if (!alive()) return;

      const tab = findSidebarElement('[data-sidebar-action="expand"]');
      if (!tab) return;
      const grip = centerOf(tab);
      demoCursor.value = { x: grip.x, y: grip.y, pressed: false };
      await sleep(DEMO_CURSOR_MOVE_MS + 150);
      if (!alive()) return;
      demoCursor.value = { x: grip.x, y: grip.y, pressed: true };
      await sleep(200);
      if (!alive()) return;
      const tabRect = tab.getBoundingClientRect();
      const tabHeight = tabRect.height || 32;
      const startTop = tabRect.top;
      const endTop = clampCollapsedTabTop(
        startTop + DEMO_DRAG_DISTANCE,
        window.innerHeight,
        tabHeight,
      );
      // 按住時游標不補間，逐格同步移動標籤與游標
      const drag = async (from: number, to: number) => {
        const startedAt = performance.now();
        for (;;) {
          if (!alive()) return false;
          const progress = Math.min(1, (performance.now() - startedAt) / DEMO_DRAG_MS);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
          const top = from + (to - from) * eased;
          collapseDemoTabTopChanged = true;
          previewCollapsedTabTop(top);
          demoCursor.value = { x: grip.x, y: grip.y + (top - startTop), pressed: true };
          if (progress >= 1) return true;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      };
      if (!(await drag(startTop, endTop))) return;
      await sleep(300);
      if (!(await drag(endTop, startTop))) return;
      demoCursor.value = { x: grip.x, y: grip.y, pressed: false };
      await sleep(400);
      if (!alive()) return;
      stopCollapseDemo();
    };

    const stopStepDemo = () => {
      stopCollapseDemo();
      tierMenuDemoSlotKey.value = null;
    };

    const guideSetup = computed<PageGuideSetupBindings>(() => ({
      displayLocale: displayLocale.value,
      marketTranslation: marketTranslation.value,
      reloadRequired: marketTranslationReloadRequired.value,
      sidebarPosition: sidebarPosition.value,
      sidebarSize: sidebarSize.value,
      fontSizeMode: fontSizeMode.value,
      fontSizeScale: fontSizeScale.value,
      resultFeatures: resultFeatures.value,
      demoCursor: demoCursor.value,
      setDisplayLocale: (value) => void updatePreference({ displayLocale: value }, '顯示語言'),
      setMarketTranslation: (value) => void setMarketTranslation(value),
      setSidebarPosition: (value) =>
        void updatePreference({ sidebarPosition: value }, '側邊欄位置'),
      // 與設定頁共用規則：預設大小套對應寬度，自訂沿用上次的自訂值
      setSidebarSize: (value) => {
        if (!preferencesModule) return;
        void updatePreference(planSidebarSizeChange(value, preferencesModule.read()), '側邊欄大小');
      },
      setFontSizeMode: (value) => {
        if (!preferencesModule) return;
        void updatePreference(planFontSizeModeChange(value, preferencesModule.read()), '字體大小');
      },
      setFontSizeScale: (value) =>
        void updatePreference(planCustomFontSizeScale(value), '字體大小'),
      setResultFeature: (key, value) => void updatePreference({ [key]: value }, '結果列功能'),
      replayCollapseDemo: () => void playCollapseDemo(),
      reload: reloadPage,
    }));
    pageGuide.setTourContext({
      isConditionMet: (condition) =>
        condition === 'market-translation-offer' && showMarketTranslationOffer.value,
      // 指向側欄裡的位置前先展開（例如上一步收合了側欄），等展開動畫結束再量位置
      async prepareStep(step) {
        if (!step.targetId || getPageGuideTarget(step.targetId).scope !== 'sidebar') return;
        if (!isCollapsed.value) return;
        toggleCollapse();
        await sleep(SIDEBAR_LAYOUT_TRANSITION_MS + 80);
      },
      async runStepDemo(demo) {
        if (demo === 'collapse') {
          // 不等示範播完：說明框先出現，外框跟著關閉鈕/收合標籤移動
          void playCollapseDemo();
          return;
        }
        const key = findFirstTierSlotKey();
        if (!key) return;
        tierMenuDemoSlotKey.value = key;
        await nextTick();
      },
      stopStepDemo,
    });

    // 初次安裝：第一次展開側邊欄時自動開始導覽；開始即視為完成，略過或中途離開都不再自動出現
    let tourAutoStarted = false;
    watchEffect(() => {
      if (
        tourAutoStarted ||
        pageRole.value !== 'normal' ||
        !sidebarStateReady.value ||
        !preferencesReady.value ||
        isCollapsed.value ||
        !onboarding.value.tourPending
      ) {
        return;
      }
      tourAutoStarted = true;
      updateOnboarding(markTourStarted);
      void nextTick(() => pageGuide.startTour());
    });

    onUnmounted(() => {
      pageGuide.setTourContext(null);
      stopCollapseDemo();
      finishCollapseAnimation();
      clearScrollRestoreTimers();
      if (arrivalTimer) {
        clearTimeout(arrivalTimer);
        arrivalTimer = null;
      }
      unregArrivalMessage?.();
      stopPreferences?.();
      stopOnboarding?.();
      if (handleStorageChange) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
      document.removeEventListener('mouseup', clearOverlayMousedown);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      removeCloseAffixModalListener();
      removeOpenAffixModalListener();
      removeSelectTypeModalListener();
      if (resizeRafId !== null) {
        window.cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      if (isDragging) {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
        document.body.style.removeProperty('user-select');
        document.body.style.removeProperty('cursor');
      }
    });

    return {
      appVersion,
      version,
      showExpandHint,
      showUpdateNotice,
      updateNoticeVersion,
      dismissUpdateNotice,
      guideSetup,
      t,
      portalTarget,
      isCollapsed,
      sidebarPosition,
      sidebarWidth,
      fontSizeScale,
      densityScale,
      areSettingsReady,
      settingsPaneReady,
      actualWidth,
      runtimeTokens,
      activeTab,
      isTabMounted,
      primaryActiveTab,
      primaryPinnedMounted,
      openPrimaryTab,
      isTemporarySearchDialogOpen,
      activeTabName,
      openStatGroupTemplateManager,
      usesPaneScroll,
      tabs,
      navModuleTabs,
      isModuleEnabled,
      isTabVisible,
      toggleCollapse,
      collapseAnimation,
      sidebarWrapperEl,
      showCollapsedTab,
      collapsedTabTopStyle,
      isCollapsedTabDragging,
      handleCollapsedTabPointerDown,
      handleCollapsedTabPointerMove,
      handleCollapsedTabPointerUp,
      handleCollapsedTabPointerCancel,
      handleCollapsedTabClick,
      handleCollapsedTabKeydown,
      isModalOpen,
      targetGroupIndex,
      isAffixPaneMounted,
      closeModal,
      setAffixDialogOpen,
      dialogState,
      handleDialogConfirm,
      handleDialogCancel,
      handleCustomButtonClick,
      handleDialogDismiss,
      setSharedDialogOpen,
      handleOverlayMousedown,
      handleOverlayMouseup,
      isResizable,
      handleResizeStart,
      isTypeDialogOpen,
      handleTypeDialogOpenChange,
      pageRole,
      handleOpenLiveSearch,
      handleOpenCustomSearch,
      isArrivalActive,
      triggerArrivalFeedback,
    };
  },
});
</script>
