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
        class="pxd-sidebar-wrapper fixed box-border text-[length:var(--pxd-font-secondary)]"
        :class="{
          collapsed: isCollapsed,
          'settings-pending invisible': !areSettingsReady,
        }"
        :style="{
          right: sidebarPosition === 'right' ? '0' : 'auto',
          left: sidebarPosition === 'left' ? '0' : 'auto',
          height: isCollapsed ? 'var(--control-height-default)' : '100vh',
          top: isCollapsed ? '100px' : '0',
          width: isCollapsed ? 'var(--pxd-sidebar-collapsed-width)' : actualWidth + 'px',
          ...runtimeTokens,
        }"
      >
        <!-- 收合狀態下的書籤狀小長方形 -->
        <Button
          v-show="isCollapsed"
          type="button"
          variant="secondary"
          size="default"
          class="w-[var(--pxd-sidebar-collapsed-width)] border-x-0 rounded-none px-[var(--pxd-sidebar-collapsed-padding-x)] flex items-center justify-between"
          :style="{
            borderRight: sidebarPosition === 'right' ? 'none' : '1px solid var(--border)',
            borderLeft: sidebarPosition === 'left' ? 'none' : '1px solid var(--border)',
          }"
          :title="t('sidebar.header.expand')"
          :aria-label="t('sidebar.header.expand')"
          data-sidebar-action="expand"
          @click="toggleCollapse"
        >
          <ToolboxIcon
            data-sidebar-brand-placeholder
            :size="'var(--pxd-brand-icon-collapsed-size)'"
            class="text-primary"
          />
          <ChevronLeft :class="sidebarPosition === 'left' ? 'rotate-180' : ''" />
        </Button>

        <!-- 展開狀態下的側邊欄本體 -->
        <div
          v-show="!isCollapsed"
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
                v-for="tab in tabs.filter((t) => t.id !== 'settings' && t.id !== 'tools')"
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
              <div class="nav-divider w-[60%] h-px bg-border"></div>

              <!-- 開啟線上搜尋主控台入口 (Action，非 pane tab) -->
              <Button
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
              <span
                class="active-tab-title text-[length:var(--pxd-font-body)] font-medium text-foreground whitespace-nowrap shrink-0 min-w-0 truncate"
                :title="activeTabName"
              >
                {{ activeTabName }}
              </span>
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
                <BookmarkPane v-show="activeTab === 'bookmark'" />
                <HistoryPane v-show="activeTab === 'history'" />
                <StatGroupTemplatePane
                  v-show="activeTab === 'stat-group-template'"
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
                    <ToolsPane v-show="activeTab === 'tools'" />
                    <SettingsPane
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
                  @open-add-connection="handleOpenCustomSearch"
                />
                <LiveSearchConsoleSettingsPane
                  v-show="primaryActiveTab === 'console-settings'"
                  :resume-controller="liveSearchResumeController"
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
                詞綴選擇器 (Affix Selector)
              </DialogTitle>
              <DialogDescription class="sr-only"> 選擇與設定詞綴篩選條件 </DialogDescription>
            </DialogHeader>

            <div class="flex-1 overflow-visible p-[var(--pxd-pane-padding)] relative">
              <FilterPane
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
          v-if="pageRole === 'normal'"
          @manage="openStatGroupTemplateManager"
        />

        <!-- Injected UI: 傭兵技能群組選擇器（PoE 1 一般頁面） -->
        <MercenaryPickerHost v-if="pageRole === 'normal' && version === 'poe1'" />
      </div>
    </TooltipProvider>
  </ConfigProvider>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  onUnmounted,
  watch,
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
import SettingsPane from './sidebar/SettingsPane.vue';
import LiveSearchPrimaryPane from './sidebar/LiveSearchPrimaryPane.vue';
import LiveSearchConsoleSettingsPane from './sidebar/LiveSearchConsoleSettingsPane.vue';
import TemporarySearchDialog from './sidebar/TemporarySearchDialog.vue';
import TierDropdownHost from './injected/TierDropdownHost.vue';
import StatGroupTemplateHost from './injected/StatGroupTemplateHost.vue';
import MercenaryPickerHost from './injected/mercenary/MercenaryPickerHost.vue';
import { dispatchPoeEvent, listenPoeEvent } from '@/utils/event-contracts';
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  type Preferences,
  type PreferencesModule,
} from '@/utils/preferences';
import { createVersionedStorageKeys, readStorageValue } from '@/utils/storage-contracts';
import { getPoeVersion } from '@/utils/trade-context';
import { createUiRuntimeTokenValues } from '@/lib/tokens';
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
} from '@lucide/vue';
import ToolboxIcon from '@/components/ui/ToolboxIcon.vue';
import { extensionMessaging } from '@/utils/extension-protocol';
import { t } from '@/utils/i18n';
import type { LiveSearchPrimaryController, TradePageRole } from '@/utils/live-search-contract';
import type { LiveSearchBookmarkController } from '@/entrypoints/content/logic/live-search-bookmark-controller';
import type { LiveSearchResumeController } from '@/entrypoints/content/logic/live-search-resume-controller';

installDialogGlobals();

/** 從瀏覽器擴充資訊清單讀取目前版本號，避免在元件中寫死版本字串 */
function resolveExtensionVersion(): string {
  const manifestVersion =
    (typeof chrome !== 'undefined' ? chrome?.runtime?.getManifest?.()?.version : undefined) ??
    (
      globalThis as {
        browser?: { runtime?: { getManifest?: () => { version?: string } } };
      }
    ).browser?.runtime?.getManifest?.()?.version;
  return manifestVersion ? `v${manifestVersion}` : '';
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
    SettingsPane,
    LiveSearchPrimaryPane,
    LiveSearchConsoleSettingsPane,
    TemporarySearchDialog,
    TierDropdownHost,
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
    const fontSizeScale = ref(1.0);
    const densityScale = ref(1.0);
    const activeTab = ref('bookmark');
    const primaryActiveTab = ref<'connections' | 'console-settings'>('connections');
    const isTemporarySearchDialogOpen = ref(false);
    const sidebarStateReady = ref(false);
    const settingsPaneReady = ref(props.pageRole === 'live-search-primary');
    const pageRole = computed(() => props.pageRole);
    const areSettingsReady = computed(() => sidebarStateReady.value && settingsPaneReady.value);

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
        return primaryActiveTab.value === 'console-settings'
          ? t('sidebar.nav.liveSearchSettings')
          : t('sidebar.nav.liveSearchConnections');
      }
      return tabs.find((tab) => tab.id === activeTab.value)?.name ?? '';
    });

    const usesPaneScroll = computed(
      () =>
        activeTab.value === 'history' ||
        activeTab.value === 'bookmark' ||
        activeTab.value === 'stat-group-template',
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
        sidebarPosition.value = snapshot.sidebarPosition;
        sidebarSize.value = snapshot.sidebarSize;
        sidebarWidth.value = snapshot.sidebarWidth;
        fontSizeScale.value = snapshot.fontSizeScale;
        densityScale.value = snapshot.densityScale;
      });

      isCollapsed.value = readStorageValue(data, collapsedKey, 'isCollapsed', true);

      // 讀取 activeTab，先試新 Key，若無則試舊 Key，再不然預設 'bookmark'
      const storedActiveTab = data[activeTabKey] || data.activeTab || 'bookmark';
      activeTab.value = tabs.some((tab) => tab.id === storedActiveTab)
        ? storedActiveTab
        : 'bookmark';
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

    const toggleCollapse = () => {
      isCollapsed.value = !isCollapsed.value;
      const collapsedKey = keys.isCollapsed;
      chrome.storage.local.set({ [collapsedKey]: isCollapsed.value });
      dispatchPoeEvent('poexd-sidebar-collapsed-changed', isCollapsed.value);
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

    // 監聽來自 content.ts (注入按鈕點擊) 的打開 Modal 事件
    const removeOpenAffixModalListener = listenPoeEvent('poexd-open-affix-modal', (detail) => {
      targetGroupIndex.value = detail.groupIndex;
      isModalOpen.value = true;
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

    onUnmounted(() => {
      clearScrollRestoreTimers();
      if (arrivalTimer) {
        clearTimeout(arrivalTimer);
        arrivalTimer = null;
      }
      unregArrivalMessage?.();
      stopPreferences?.();
      if (handleStorageChange) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
      document.removeEventListener('mouseup', clearOverlayMousedown);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      removeCloseAffixModalListener();
      removeOpenAffixModalListener();
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
      primaryActiveTab,
      isTemporarySearchDialogOpen,
      activeTabName,
      openStatGroupTemplateManager,
      usesPaneScroll,
      tabs,
      toggleCollapse,
      isModalOpen,
      targetGroupIndex,
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
