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
          height: showCollapsedTab ? 'var(--control-height-default)' : '100%',
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
          <SidebarNavRail
            :page-role="pageRole"
            :active-tab="activeTab"
            :primary-active-tab="primaryActiveTab"
            :nav-module-tabs="navModuleTabs"
            :tools-tab="toolsTab"
            :settings-tab="settingsTab"
            :live-search-enabled="isModuleEnabled('live-search')"
            :pinned-items-enabled="isModuleEnabled('pinned-items')"
            @collapse="toggleCollapse"
            @select-tab="activeTab = $event"
            @tab-intent="handleNavTabIntent"
            @open-live-search="handleOpenLiveSearch"
            @select-primary-tab="openPrimaryTab"
            @open-custom-search="handleOpenCustomSearch"
          />

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
                  class="active-tab-title text-[length:var(--pxd-font-section-title)] font-medium text-foreground whitespace-nowrap shrink-0 min-w-0 truncate"
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
                  <UpdateNotice
                    :version="updateNoticeVersion"
                    :highlights="updateNoticeHighlights"
                    @dismiss="dismissUpdateNotice"
                    @open-section="openSettingsSection"
                  />
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
                  :active="!isCollapsed && activeTab === 'pob-build'"
                />
                <PinnedItemPane
                  v-if="isTabMounted('pinned-items') && isTabVisible('pinned-items')"
                  v-show="activeTab === 'pinned-items'"
                  :sidebar-position="sidebarPosition"
                />
                <ResultBoardPane
                  v-if="isTabMounted('result-board') && isTabVisible('result-board')"
                  v-show="activeTab === 'result-board'"
                />
                <!-- 設定分頁自帶 SidebarPane，確保工具列固定且捲軸只涵蓋下方設定區塊 -->
                <SettingsPane
                  v-if="isTabMounted('settings')"
                  v-show="activeTab === 'settings'"
                  :focus-request="settingsFocusRequest"
                  @ready="settingsPaneReady = true"
                />

                <!-- Outer-scroll pane: Tools 由外層 ScrollArea 擁有 scrolling -->
                <ScrollAreaRoot
                  v-show="activeTab === 'tools'"
                  data-sidebar-outer-scroll
                  class="relative flex-1 min-h-0 overflow-hidden"
                >
                  <ScrollAreaViewport
                    class="h-full w-full min-h-0 p-[var(--pxd-pane-padding)] pb-[var(--pxd-pane-scroll-end-space)]"
                  >
                    <ToolsPane v-if="isTabMounted('tools')" v-show="activeTab === 'tools'" />
                  </ScrollAreaViewport>
                  <ScrollBar />
                  <ScrollAreaCorner />
                </ScrollAreaRoot>
              </template>

              <!-- Primary 模式：渲染 LiveSearch 專用 Panes (絕不 mount 普通 Bookmark/History/Settings) -->
              <template v-else-if="pageRole === 'live-search-primary'">
                <LiveSearchPrimaryPane
                  v-show="primaryActiveTab === 'connections'"
                  :controller="liveSearchConsole?.primaryController ?? null"
                  :source-controller="liveSearchConsole?.sourceController ?? null"
                  :resume-controller="liveSearchConsole?.resumeController ?? null"
                  :sound-notifier="liveSearchConsole?.soundNotifier ?? null"
                  @open-add-connection="handleOpenCustomSearch"
                />
                <PinnedItemPane
                  v-if="primaryPinnedMounted && isModuleEnabled('pinned-items')"
                  v-show="primaryActiveTab === 'pinned-items'"
                  :sidebar-position="sidebarPosition"
                />
                <LiveSearchConsoleSettingsPane
                  v-show="primaryActiveTab === 'console-settings'"
                  :resume-controller="liveSearchConsole?.resumeController ?? null"
                  :sound-notifier="liveSearchConsole?.soundNotifier ?? null"
                  :desktop-notifier="liveSearchConsole?.desktopNotifier ?? null"
                />
              </template>
            </div>
          </div>
        </div>

        <!-- 側邊欄邊界拖曳調整寬度的把手 -->
        <div
          v-if="isResizable"
          class="sidebar-resize-handle absolute inset-y-0 w-[6px] cursor-col-resize z-(--pxd-z-sidebar-handle) transition-colors duration-150 hover:bg-primary active:bg-primary"
          :class="sidebarPosition === 'left' ? 'left -right-[3px]' : 'right -left-[3px]'"
          @mousedown.prevent="handleResizeStart"
          :title="t('sidebar.header.resizeWidth')"
        ></div>

        <!-- 全域詞綴選擇器 Modal -->
        <Dialog
          :open="isModalOpen"
          :modal="!affixDemoMode"
          :unmount-on-hide="false"
          @update:open="
            (open) => {
              if (!affixDemoMode) setAffixDialogOpen(open);
            }
          "
        >
          <DialogContent
            placement="inset"
            data-sidebar-dialog="affix"
            :data-guide-demo="affixDemoMode ? 'true' : undefined"
            :inert="affixDemoMode || undefined"
            :overlay-class="affixDemoMode ? 'pointer-events-none' : undefined"
            :class="[
              'inset-x-[5vw] inset-y-[5vh] flex h-auto max-h-none w-auto max-w-none flex-col gap-0 p-0',
              affixDemoMode ? 'pointer-events-none select-none' : '',
            ]"
            :overlay-mousedown="handleOverlayMousedown"
            :overlay-mouseup="handleOverlayMouseup"
            close-class="right-[var(--pxd-pane-padding)] top-[11px]"
            @pointer-down-outside="(e) => e.preventDefault()"
            @interact-outside="(e) => e.preventDefault()"
            @escape-key-down="(e) => e.preventDefault()"
            @close-auto-focus="(e) => e.preventDefault()"
          >
            <DialogHeader
              class="h-[var(--pxd-sidebar-affix-dialog-header-height)] shrink-0 flex-row items-center justify-start gap-0 border-b border-border bg-background px-[var(--pxd-pane-padding)] py-0 text-left"
            >
              <DialogTitle
                class="text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px] shrink-0"
              >
                {{ t('affixSelector.dialog.title') }}
              </DialogTitle>
              <div
                ref="affixHeaderSlotRef"
                class="flex items-center gap-[var(--pxd-space-sm)] min-w-0 flex-1 ml-[var(--pxd-space-sm)] pr-[calc(var(--control-height-sm,28px)+var(--pxd-space-xl))]"
              />
              <DialogDescription class="sr-only">
                {{ t('affixSelector.dialog.description') }}
              </DialogDescription>
            </DialogHeader>

            <div class="flex-1 overflow-visible p-[var(--pxd-pane-padding)] relative">
              <!-- 詞綴選擇器很重（數百個詞綴列與詞綴字典）：第一次用到才掛載，之後關閉也保留狀態 -->
              <FilterPane
                v-if="isAffixPaneMounted"
                ref="filterPaneRef"
                :target-group-index="targetGroupIndex"
                :is-open="isModalOpen"
                :header-portal-target="affixHeaderSlotRef"
                @type-dialog-open-changed="handleTypeDialogOpenChange"
              />
            </div>
          </DialogContent>
        </Dialog>

        <!-- 全域共用對話框 Modal (Confirm / Alert / Prompt / Custom) -->
        <SidebarGlobalDialog @open-change="isSharedDialogOpen = $event" />

        <!-- 暫時搜尋 Dialog (僅在 live-search-primary 模式啟用) -->
        <TemporarySearchDialog
          v-if="pageRole === 'live-search-primary'"
          :open="isTemporarySearchDialogOpen"
          :source-controller="liveSearchConsole?.sourceController ?? null"
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
  provide,
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
import { defaultPobDataLoader, schedulePobIdlePrewarm } from './sidebar/pob-build/pob-data-loader';
import PinnedItemPane from './sidebar/pinned-items/PinnedItemPane.vue';
import ResultBoardPane from './sidebar/result-board/ResultBoardPane.vue';
import SettingsPane from './sidebar/SettingsPane.vue';
import LiveSearchPrimaryPane from './sidebar/LiveSearchPrimaryPane.vue';
import LiveSearchConsoleSettingsPane from './sidebar/LiveSearchConsoleSettingsPane.vue';
import TemporarySearchDialog from './sidebar/TemporarySearchDialog.vue';
import UpdateNotice from './sidebar/UpdateNotice.vue';
import { getReleaseHighlights, type SettingsFocusRequest } from '@/utils/release-highlights';
import SidebarNavRail, { type LiveSearchPrimaryTab } from './sidebar/layout/SidebarNavRail.vue';
import { SIDEBAR_NAV_TABS } from './sidebar/sidebar-module-presentation';
import SidebarGlobalDialog from './sidebar/layout/SidebarGlobalDialog.vue';
import TierDropdownHost from './injected/TierDropdownHost.vue';
import PageGuideHost from './sidebar/page-guide/PageGuideHost.vue';
import { usePageGuide } from './sidebar/page-guide/usePageGuide';
import { getPageGuideTarget } from './sidebar/page-guide/page-guide-targets';
import {
  usePageGuideDemos,
  type FilterPaneDemoHandle,
} from './sidebar/page-guide/usePageGuideDemos';
import {
  RESULT_FEATURE_KEYS,
  readResultFeatures,
  type PageGuideSetupBindings,
  type ResultFeatureFlags,
} from './sidebar/page-guide/page-guide-setup';
import { clampFontSizeScale } from '@/utils/appearance-preferences';
import { FONT_SIZE_SCALE_PREVIEW_KEY } from './sidebar/settings/font-size-preview';
import { affixDemoMode } from '@/utils/page-guide-demo-state';
import { isMarketTranslationReloadRequired } from '@/utils/market-translation';
import { getPageLoadPreferences } from '@/utils/page-load-preferences';
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
import {
  DEFAULT_SIDEBAR_MODULE_PREFERENCES,
  SIDEBAR_MODULE_PREFERENCE_KEYS,
  isSidebarFixedTab,
  isSidebarModuleEnabled,
  resolveActivePaneTab,
  resolveVisiblePaneTabs,
  usesSidebarPaneScroll,
  type SidebarModuleId,
  type SettingsSectionId,
  type SidebarModulePreferenceKey,
} from '@/utils/sidebar-modules';
import { useSidebarGeometry } from './sidebar/composables/useSidebarGeometry';
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
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ChevronLeft } from '@lucide/vue';
import ToolboxIcon from '@/components/ui/ToolboxIcon.vue';
import { extensionMessaging } from '@/utils/extension-protocol';
import { t } from '@/utils/i18n';
import type { TradePageRole } from '@/utils/live-search-contract';
import type { LiveSearchConsoleHandles } from '@/entrypoints/content/logic/live-search-primary-session';

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
    liveSearchConsole: {
      type: Object as PropType<LiveSearchConsoleHandles | null>,
      default: null,
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
    ResultBoardPane,
    SettingsPane,
    LiveSearchPrimaryPane,
    LiveSearchConsoleSettingsPane,
    TemporarySearchDialog,
    UpdateNotice,
    SidebarNavRail,
    SidebarGlobalDialog,
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
    Button,
    ToolboxIcon,
    ChevronLeft,
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
    let preferencesModule: PreferencesModule | undefined;
    const preferencesReady = ref(false);
    const fontSizeScale = ref(1.0);
    const previewFontSizeScale = ref<number | null>(null);
    provide(FONT_SIZE_SCALE_PREVIEW_KEY, (scale) => {
      previewFontSizeScale.value = scale === null ? null : clampFontSizeScale(scale);
    });
    const resultFeatures = shallowRef<ResultFeatureFlags>(readResultFeatures(DEFAULT_PREFERENCES));
    const densityScale = ref(1.0);
    const activeTab = ref('bookmark');
    const primaryActiveTab = ref<LiveSearchPrimaryTab>('connections');
    // 主控台的釘選 pane 第一次打開才掛載
    const primaryPinnedMounted = ref(false);
    const openPrimaryTab = (tab: LiveSearchPrimaryTab) => {
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
    const marketTranslationBilingual = ref<boolean>(DEFAULT_PREFERENCES.marketTranslationBilingual);
    const marketTranslationResultBilingual = ref<boolean>(
      DEFAULT_PREFERENCES.marketTranslationResultBilingual,
    );
    const displayLocale = ref<Preferences['displayLocale']>('auto');
    /** 本頁載入時的偏好基準；之後市集漢化有效狀態變動需重新整理才會套用到官網頁面 */
    let pageLoadMarketBaseline: Readonly<Preferences> | null = null;
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
    const updateNoticeHighlights = computed(() =>
      getReleaseHighlights(
        updateNoticeVersion.value,
        undefined,
        onboarding.value.highlightsSinceVersion,
      ),
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
    // 改版提示的新功能按鈕：切到系統設定分頁並捲到對應區塊
    const settingsFocusRequest = ref<SettingsFocusRequest | null>(null);
    const openSettingsSection = (section: SettingsSectionId) => {
      activeTab.value = 'settings';
      settingsFocusRequest.value = { section, seq: (settingsFocusRequest.value?.seq ?? 0) + 1 };
    };
    const updatePreference = async (patch: Partial<Preferences>, label: string) => {
      if (!preferencesModule) return;
      const outcome = await preferencesModule.update(patch);
      if (!outcome.ok) console.error(`[PoeXD Sidebar] 無法更新${label}:`, outcome.error);
    };
    const setMarketTranslation = (value: boolean) =>
      updatePreference({ marketTranslation: value }, '市集漢化設定');
    const setMarketTranslationBilingual = (value: boolean) =>
      updatePreference({ marketTranslationBilingual: value }, '市集下拉中英並列');
    const setMarketTranslationResultBilingual = (value: boolean) =>
      updatePreference({ marketTranslationResultBilingual: value }, '市集結果中英並列');
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

    if (props.pageRole === 'live-search-primary' && props.liveSearchConsole?.initialArrivalSignal) {
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

    const isSharedDialogOpen = ref(false);

    // 監聽並記憶用戶選取的導航分頁 (區分版本)
    watch(activeTab, (newVal) => {
      chrome.storage.local.set({ [activeTabKey]: newVal });
    });

    // 導覽列分頁圖示與名稱由 sidebar-modules / sidebar-module-presentation 單一來源推導
    const tabs = SIDEBAR_NAV_TABS;

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
      tabs.filter((tab) => !isSidebarFixedTab(tab.id) && isTabVisible(tab.id)),
    );
    const toolsTab = tabs.find((tab) => tab.id === 'tools');
    const settingsTab = tabs.find((tab) => tab.id === 'settings');

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

    const usesPaneScroll = computed(() => usesSidebarPaneScroll(activeTab.value));

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
        sidebarWidth.value = snapshot.sidebarWidth;
        if (!isCollapsedTabDragging.value) collapsedTabTop.value = snapshot.collapsedTabTop;
        fontSizeScale.value = snapshot.fontSizeScale;
        if (
          previewFontSizeScale.value !== null &&
          Math.abs(snapshot.fontSizeScale - previewFontSizeScale.value) <= 0.0001
        ) {
          previewFontSizeScale.value = null;
        }
        const nextResultFeatures = readResultFeatures(snapshot);
        if (
          RESULT_FEATURE_KEYS.some((key) => nextResultFeatures[key] !== resultFeatures.value[key])
        ) {
          resultFeatures.value = nextResultFeatures;
        }
        densityScale.value = snapshot.densityScale;
        marketTranslation.value = snapshot.marketTranslation === true;
        marketTranslationBilingual.value = snapshot.marketTranslationBilingual !== false;
        marketTranslationResultBilingual.value = snapshot.marketTranslationResultBilingual === true;
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
        if (pageLoadMarketBaseline === null) {
          pageLoadMarketBaseline = getPageLoadPreferences() ?? snapshot;
        }
        marketTranslationReloadRequired.value = isMarketTranslationReloadRequired(
          pageLoadMarketBaseline,
          snapshot,
          {
            hostname: typeof window !== 'undefined' ? window.location.hostname : '',
            browserLocale: detectBrowserLocale(),
          },
        );
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
          finishCollapseAnimation();
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
        // finishCollapseAnimation 會刻意 cancel()，依規格 finished 會以 AbortError reject；
        // 這是預期的結束方式，不是錯誤，接住避免成為未處理的 rejection
        animation.finished?.catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
        });
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

    const {
      actualWidth,
      runtimeTokens,
      isResizable,
      handleResizeStart,
      collapsedTabTop,
      collapsedTabTopStyle,
      isCollapsedTabDragging,
      previewCollapsedTabTop,
      handleCollapsedTabPointerDown,
      handleCollapsedTabPointerMove,
      handleCollapsedTabPointerUp,
      handleCollapsedTabPointerCancel,
      handleCollapsedTabClick,
      handleCollapsedTabKeydown,
    } = useSidebarGeometry({
      isCollapsed,
      sidebarPosition,
      sidebarWidth,
      fontSizeScale,
      previewFontSizeScale,
      densityScale,
      getPreferencesModule: () => preferencesModule,
      onExpandFromTab: toggleCollapse,
    });

    /** 從「新增詞綴群組」旁的選單跳到側邊欄管理分頁。 */
    const openStatGroupTemplateManager = () => {
      activeTab.value = 'stat-group-template';
      if (isCollapsed.value) toggleCollapse();
    };

    const isModalOpen = ref(false);
    const targetGroupIndex = ref(0);
    const filterPaneRef = ref<FilterPaneDemoHandle | null>(null);
    const affixHeaderSlotRef = ref<HTMLElement | null>(null);

    const closeModal = () => {
      isModalOpen.value = false;
    };
    const setAffixDialogOpen = (open: boolean) => {
      if (open || affixDemoMode.value) return;

      if (isModalOpen.value) {
        closeModal();
      }
    };
    const removeCloseAffixModalListener = listenPoeEvent('poexd-close-affix-modal', () => {
      if (!affixDemoMode.value) closeModal();
    });

    const isMouseDownOnOverlay = ref(false);
    const handleOverlayMousedown = () => {
      if (affixDemoMode.value) return;
      isMouseDownOnOverlay.value = true;
    };
    const handleOverlayMouseup = () => {
      if (!affixDemoMode.value && isMouseDownOnOverlay.value) {
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
      if (affixDemoMode.value) return;
      isAffixPaneMounted.value = true;
      targetGroupIndex.value = detail.groupIndex;
      isModalOpen.value = true;
    });

    // 類別選擇窗由 FilterPane 自己監聽；它還沒掛載時先掛載，再把事件補送給它
    const removeSelectTypeModalListener = listenPoeEvent('poexd-trigger-select-type-modal', () => {
      if (affixDemoMode.value || isAffixPaneMounted.value) return;
      isAffixPaneMounted.value = true;
      void nextTick(() => dispatchPoeEvent('poexd-trigger-select-type-modal'));
    });

    // 官方結果數旁的看板捷徑：展開側邊欄並切到搜尋結果看板
    const removeOpenResultBoardListener = listenPoeEvent('poexd-open-result-board', () => {
      if (!isTabVisible('result-board')) return;
      activeTab.value = 'result-board';
      if (isCollapsed.value) toggleCollapse();
    });

    const isTypeDialogOpen = ref(false);
    const handleTypeDialogOpenChange = (isOpen: boolean) => {
      isTypeDialogOpen.value = isOpen;
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (
        !affixDemoMode.value &&
        e.key === 'Escape' &&
        isModalOpen.value &&
        !isSharedDialogOpen.value &&
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
      return isModalOpen.value || isSharedDialogOpen.value || isTypeDialogOpen.value;
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
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const { demoCursor, demoPlaying, playCollapseDemo, replayStepDemo, runStepDemo, stopStepDemo } =
      usePageGuideDemos({
        portalTarget,
        isCollapsed,
        sidebarPosition,
        collapsedTabTop,
        toggleCollapse,
        previewCollapsedTabTop,
        readStoredCollapsedTabTop: () => preferencesModule?.read().collapsedTabTop,
        openAffixModalForDemo: () => {
          isAffixPaneMounted.value = true;
          targetGroupIndex.value = 0;
          isModalOpen.value = true;
        },
        closeAffixModalForDemo: closeModal,
        getFilterPaneHandle: () => filterPaneRef.value,
        setDemoElements: pageGuide.setDemoElements,
        ensureDemoStatFilter: pageGuide.ensureDemoStatFilter,
        getPoeVersion: () => version,
        getDisplayLocale: () => displayLocale.value,
      });

    const guideSetup = computed<PageGuideSetupBindings>(() => ({
      displayLocale: displayLocale.value,
      marketTranslation: marketTranslation.value,
      marketTranslationBilingual: marketTranslationBilingual.value,
      marketTranslationResultBilingual: marketTranslationResultBilingual.value,
      reloadRequired: marketTranslationReloadRequired.value,
      sidebarPosition: sidebarPosition.value,
      fontSizeScale: fontSizeScale.value,
      compactDensity: densityScale.value === 0.8,
      resultFeatures: resultFeatures.value,
      demoPlaying: demoPlaying.value,
      demoCursor: demoCursor.value,
      setDisplayLocale: (value) => void updatePreference({ displayLocale: value }, '顯示語言'),
      setMarketTranslation: (value) => void setMarketTranslation(value),
      setMarketTranslationBilingual: (value) => void setMarketTranslationBilingual(value),
      setMarketTranslationResultBilingual: (value) =>
        void setMarketTranslationResultBilingual(value),
      setSidebarPosition: (value) =>
        void updatePreference({ sidebarPosition: value }, '側邊欄位置'),
      setFontSizeScale: (value) =>
        void updatePreference({ fontSizeScale: clampFontSizeScale(value) }, '字體大小'),
      setCompactDensity: (value) =>
        void updatePreference({ densityScale: value ? 0.8 : 1 }, '緊湊介面'),
      setResultFeature: (key, value) => void updatePreference({ [key]: value }, '結果列功能'),
      replayCollapseDemo: () => void playCollapseDemo(),
      replayStepDemo,
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
      runStepDemo,
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

    let pobPrewarmScheduled = false;
    let cancelPobIdlePrewarm: (() => void) | undefined;

    const triggerPobPrewarm = () => {
      if (
        pageRole.value !== 'normal' ||
        !isModuleEnabled('pob-build') ||
        isTabMounted('pob-build')
      ) {
        return;
      }
      cancelPobIdlePrewarm?.();
      cancelPobIdlePrewarm = undefined;
      void defaultPobDataLoader.prewarm(version);
    };

    const handleNavTabIntent = (tabId: string) => {
      if (tabId === 'pob-build') triggerPobPrewarm();
    };

    watchEffect(() => {
      if (
        pageRole.value !== 'normal' ||
        !sidebarStateReady.value ||
        !isModuleEnabled('pob-build')
      ) {
        return;
      }
      if (pobPrewarmScheduled || isTabMounted('pob-build')) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      pobPrewarmScheduled = true;
      cancelPobIdlePrewarm = schedulePobIdlePrewarm(() => {
        cancelPobIdlePrewarm = undefined;
        triggerPobPrewarm();
      });
    });

    onUnmounted(() => {
      cancelPobIdlePrewarm?.();
      cancelPobIdlePrewarm = undefined;
      pageGuide.setTourContext(null);
      stopStepDemo();
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
      removeOpenResultBoardListener();
    });

    return {
      appVersion,
      version,
      showExpandHint,
      showUpdateNotice,
      updateNoticeVersion,
      dismissUpdateNotice,
      settingsFocusRequest,
      updateNoticeHighlights,
      openSettingsSection,
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
      handleNavTabIntent,
      primaryActiveTab,
      primaryPinnedMounted,
      openPrimaryTab,
      isTemporarySearchDialogOpen,
      activeTabName,
      openStatGroupTemplateManager,
      usesPaneScroll,
      tabs,
      navModuleTabs,
      toolsTab,
      settingsTab,
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
      isSharedDialogOpen,
      targetGroupIndex,
      filterPaneRef,
      affixHeaderSlotRef,
      affixDemoMode,
      isAffixPaneMounted,
      closeModal,
      setAffixDialogOpen,
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
