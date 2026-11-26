import { computed, nextTick, reactive, readonly, shallowRef } from 'vue';
import { clampFontSizeScale } from '@/utils/appearance-preferences';
import { clampCollapsedTabTop } from '@/utils/collapsed-tab-position';
import { requestMainWorld, type PageGuideDemoAction } from '@/utils/cross-world-rpc';
import { dispatchPoeEvent } from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import {
  buildMarketTranslationTogglePatch,
  isMarketTranslationReloadRequired,
} from '@/utils/market-translation';
import { shouldOfferMarketTranslation } from '@/utils/onboarding';
import { findFirstTierSlotKey, type PageGuideDemoState } from '@/utils/page-guide-demo-state';
import { clearResultReveal, revealFirstResult } from '@/utils/page-guide-reveal';
import { getPageLoadPreferences } from '@/utils/page-load-preferences';
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesModule } from '@/utils/preferences';
import type {
  DisplayLocalePreference,
  ResultModHighlightColor,
  ResultModHighlightStyle,
  SidebarPosition,
} from '@/utils/preferences-contract';
import { SIDEBAR_LAYOUT_TRANSITION_MS } from '@/utils/sidebar-motion';
import { getPoeVersion as detectPoeVersion, type PoeVersion } from '@/utils/trade-context';
import {
  RESULT_FEATURE_KEYS,
  readResultFeatures,
  type PageGuideDemoCursor,
  type ResultFeatureFlags,
  type ResultFeatureKey,
} from './page-guide-setup';
import {
  PAGE_GUIDE_TOUR_STEPS,
  type PageGuideDemoFocus,
  type PageGuideStepCondition,
  type PageGuideStepDemo,
  type PageGuideTourStep,
} from './page-guide-tour';
import {
  findPageGuideElement,
  getPageGuideTarget,
  type PageGuideNeed,
  type PageGuideTargetId,
} from './page-guide-targets';

/** 單點指出的外框停留時間 */
const POINT_DURATION_MS = 3200;
/** 示範條件加入後，等官方與 T 階按鈕重新渲染 */
const DEMO_RENDER_WAIT_MS = 160;
const PAGE_GUIDE_DEMO_TIMEOUT_MS = 3000;
/** 示範畫面出現後，找外框新目標的重試次數與間隔 */
const DEMO_TARGET_RETRIES = 10;
const DEMO_TARGET_RETRY_MS = 50;

const DEMO_CURSOR_MOVE_MS = 550;
const DEMO_DRAG_DISTANCE = 120;
const DEMO_DRAG_MS = 600;
const DEMO_STAT_ID = 'explicit.stat_3299347043';
const DEMO_CATEGORY = 'body-armour';

export type GuideMode = 'idle' | 'point' | 'tour' | 'preview';

export interface FilterPaneSnapshot {
  selectedType: string;
  searchQuery: string;
}

export interface FilterPaneDemoHandle {
  isLoading: () => boolean;
  getSnapshot: () => FilterPaneSnapshot;
  restoreSnapshot: (snapshot: FilterPaneSnapshot) => void;
  selectTypeForDemo: (type: string) => void;
  setSearchQueryForDemo: (query: string) => void;
  findDemoLifeMod: () => { id: string; label: string } | null;
}

export interface PageGuideEnvironment {
  hostname: string;
  browserLocale: string;
  browserLanguages?: readonly string[];
}

/**
 * Page Guide Session 唯一的外部依賴縫隙：
 * 正式環境由 Sidebar 透過 `attachHost` 注入殼層與瀏覽器配接器，測試則直接傳入 fake host。
 */
export interface PageGuideHost {
  // Preferences & reload
  preferences?: PreferencesModule | null;
  getPageLoadPreferences?: () => Readonly<Preferences> | null;
  getEnvironment?: () => PageGuideEnvironment;
  reload?: () => void;

  // Sidebar shell actions
  isCollapsed?: () => boolean;
  toggleCollapse?: () => void;
  getSidebarPosition?: () => SidebarPosition;
  getCollapsedTabTop?: () => number;
  previewCollapsedTabTop?: (top: number) => void;
  openAffixModal?: () => void;
  closeAffixModal?: () => void;
  getFilterPaneHandle?: () => FilterPaneDemoHandle | null;
  getSidebarRoot?: () => ParentNode | null;
  getPoeVersion?: () => PoeVersion;

  // Main-world & UI effects
  requestDemo?: (action: PageGuideDemoAction) => Promise<boolean>;
  notify?: (message: string) => void;
  scrollIntoView?: (el: Element) => void;
  revealResults?: (enabled: boolean) => void;

  // Deterministic timing & DOM queries
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  nextAnimationFrame?: () => Promise<void>;
  queryPage?: <E extends Element = HTMLElement>(selector: string) => E | null;
  querySidebar?: <E extends Element = HTMLElement>(selector: string) => E | null;
  getViewportHeight?: () => number;
}

export interface PageGuideSessionOptions {
  steps?: readonly PageGuideTourStep[];
}

export interface PageGuideSetupState {
  readonly displayLocale: DisplayLocalePreference;
  readonly marketTranslation: boolean;
  readonly marketTranslationBilingual: boolean;
  readonly marketTranslationResultBilingual: boolean;
  readonly reloadRequired: boolean;
  readonly sidebarPosition: SidebarPosition;
  readonly fontSizeScale: number;
  readonly compactDensity: boolean;
  readonly enablePureBackground: boolean;
  readonly resultFeatures: ResultFeatureFlags;
  readonly resultModHighlightStyle: ResultModHighlightStyle;
  readonly resultModHighlightColor: ResultModHighlightColor;
  readonly demoPlaying: boolean;
  readonly demoCursor: PageGuideDemoCursor | null;
}

/** 需要先在官方頁面暫時補出元素的位置，對應要送出的示範動作 */
const DEMO_ACTION_BY_NEED: Partial<Record<PageGuideNeed, PageGuideDemoAction>> = {
  filters: 'show-filters',
  'stat-filter': 'add-stat-filter',
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function centerOf(el: Element) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function escapeCssIdent(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value;
}

function resolveDemoSearchText(
  version: PoeVersion,
  displayLocale: DisplayLocalePreference,
  modLabel: string | undefined,
): string {
  if (modLabel) {
    if (modLabel.includes('最大生命')) return '最大生命';
    if (modLabel.includes('生命上限')) return '生命上限';
    if (modLabel.toLowerCase().includes('maximum life')) return 'maximum Life';
  }
  if (displayLocale === 'en') return 'maximum Life';
  if (version === 'poe2' && displayLocale === 'zh-CN') return '生命上限';
  return '最大生命';
}

function defaultEnvironment(): PageGuideEnvironment {
  return {
    hostname: typeof window !== 'undefined' && window.location ? window.location.hostname : '',
    browserLocale: detectBrowserLocale(),
    browserLanguages: typeof navigator !== 'undefined' ? navigator.languages : undefined,
  };
}

function createInitialSetupState(): {
  displayLocale: DisplayLocalePreference;
  marketTranslation: boolean;
  marketTranslationBilingual: boolean;
  marketTranslationResultBilingual: boolean;
  reloadRequired: boolean;
  sidebarPosition: SidebarPosition;
  fontSizeScale: number;
  compactDensity: boolean;
  enablePureBackground: boolean;
  resultFeatures: ResultFeatureFlags;
  resultModHighlightStyle: ResultModHighlightStyle;
  resultModHighlightColor: ResultModHighlightColor;
  demoPlaying: boolean;
  demoCursor: PageGuideDemoCursor | null;
} {
  return {
    displayLocale: DEFAULT_PREFERENCES.displayLocale,
    marketTranslation: DEFAULT_PREFERENCES.marketTranslation,
    marketTranslationBilingual: DEFAULT_PREFERENCES.marketTranslationBilingual,
    marketTranslationResultBilingual: DEFAULT_PREFERENCES.marketTranslationResultBilingual,
    reloadRequired: false,
    sidebarPosition: DEFAULT_PREFERENCES.sidebarPosition,
    fontSizeScale: DEFAULT_PREFERENCES.fontSizeScale,
    compactDensity: DEFAULT_PREFERENCES.densityScale === 0.8,
    enablePureBackground: DEFAULT_PREFERENCES.enablePureBackground,
    resultFeatures: readResultFeatures(DEFAULT_PREFERENCES),
    resultModHighlightStyle: DEFAULT_PREFERENCES.resultModHighlightStyle,
    resultModHighlightColor: DEFAULT_PREFERENCES.resultModHighlightColor,
    demoPlaying: false,
    demoCursor: null,
  };
}

/**
 * Page Guide Session：統一管理導覽狀態機、三段互動示範腳本、偏好設定同步與寫入、
 * 側欄離場恢復，以及跨 App 共用的唯讀示範鎖定狀態（`demoState`）。
 */
export function createPageGuideSession(
  initialHost?: PageGuideHost,
  options: PageGuideSessionOptions = {},
) {
  const steps = options.steps ?? PAGE_GUIDE_TOUR_STEPS;
  const attachedHost = shallowRef<PageGuideHost | null>(null);

  const stateWritable = reactive({
    mode: 'idle' as GuideMode,
    /** 目前步驟在「會出現的步驟」中的位置 */
    stepIndex: 0,
    stepId: '',
    label: '',
    /** 結果步驟或設定預覽顯示的示意結果列；null 時不顯示 */
    demoFocus: null as PageGuideDemoFocus | null,
  });
  const elementWritable = shallowRef<Element | null>(null);
  const demoRingElementsWritable = shallowRef<readonly Element[]>([]);
  const demoSpotlightElementWritable = shallowRef<Element | null>(null);

  const demoStateWritable = reactive({
    tierMenuSlotKey: null as string | null,
    tierTriggerSlotKey: null as string | null,
    affixMode: false,
    affixHoveredModId: null as string | null,
  });

  const setupWritable = reactive(createInitialSetupState());

  let stopPreferences: (() => void) | undefined;
  let pageLoadMarketBaseline: Readonly<Preferences> | null = null;
  let activeDemoAction: PageGuideDemoAction | null = null;
  let pendingDemoStatFilter: Promise<boolean> | null = null;
  let pointTimer: ReturnType<typeof setTimeout> | undefined;
  let runToken = 0;
  let expandOnTourExit = false;

  // 互動示範腳本私有狀態
  let activeDemoRun = 0;
  let collapseDemoTabTopChanged = false;
  let affixSnapshot: FilterPaneSnapshot | null = null;
  let affixOpenedByDemo = false;

  // ---- Host accessors with production browser defaults ----
  const getEnvironment = (): PageGuideEnvironment =>
    attachedHost.value?.getEnvironment?.() ?? defaultEnvironment();

  const getSidebarRoot = (): ParentNode | null =>
    attachedHost.value?.getSidebarRoot ? attachedHost.value.getSidebarRoot() : document;

  const queryPage = <E extends Element = HTMLElement>(selector: string): E | null => {
    if (attachedHost.value?.queryPage) {
      return attachedHost.value.queryPage<E>(selector);
    }
    return typeof document !== 'undefined' ? document.querySelector<E>(selector) : null;
  };

  const querySidebar = <E extends Element = HTMLElement>(selector: string): E | null => {
    if (attachedHost.value?.querySidebar) {
      return attachedHost.value.querySidebar<E>(selector);
    }
    const root = getSidebarRoot() ?? (typeof document !== 'undefined' ? document : null);
    return root ? root.querySelector<E>(selector) : null;
  };

  const wait = (ms: number): Promise<void> =>
    attachedHost.value?.wait
      ? attachedHost.value.wait(ms)
      : new Promise((resolve) => setTimeout(resolve, ms));

  const now = (): number =>
    attachedHost.value?.now ? attachedHost.value.now() : performance.now();

  const nextAnimationFrame = (): Promise<void> =>
    attachedHost.value?.nextAnimationFrame
      ? attachedHost.value.nextAnimationFrame()
      : new Promise((resolve) => requestAnimationFrame(() => resolve()));

  const getViewportHeight = (): number =>
    attachedHost.value?.getViewportHeight
      ? attachedHost.value.getViewportHeight()
      : typeof window !== 'undefined'
        ? window.innerHeight
        : 800;

  const isCollapsed = (): boolean => attachedHost.value?.isCollapsed?.() ?? false;

  const toggleCollapse = (): void => {
    attachedHost.value?.toggleCollapse?.();
  };

  const getSidebarPosition = (): SidebarPosition =>
    attachedHost.value?.getSidebarPosition?.() ?? setupWritable.sidebarPosition;

  const getCollapsedTabTop = (): number =>
    attachedHost.value?.getCollapsedTabTop?.() ?? DEFAULT_PREFERENCES.collapsedTabTop;

  const previewCollapsedTabTop = (top: number): void => {
    attachedHost.value?.previewCollapsedTabTop?.(top);
  };

  const getPoeVersion = (): PoeVersion => {
    if (attachedHost.value?.getPoeVersion) return attachedHost.value.getPoeVersion();
    try {
      return detectPoeVersion();
    } catch {
      return 'poe2';
    }
  };

  const requestDemo = async (action: PageGuideDemoAction): Promise<boolean> => {
    if (attachedHost.value?.requestDemo) {
      return attachedHost.value.requestDemo(action);
    }
    return (
      await requestMainWorld(
        'page-guide.demo',
        { action },
        { timeoutMs: PAGE_GUIDE_DEMO_TIMEOUT_MS },
      )
    ).ok;
  };

  const notify = (message: string): void => {
    if (attachedHost.value?.notify) {
      attachedHost.value.notify(message);
      return;
    }
    dispatchPoeEvent('poexd-toast', { message });
  };

  const scrollIntoView = (el: Element): void => {
    if (attachedHost.value?.scrollIntoView) {
      attachedHost.value.scrollIntoView(el);
      return;
    }
    el.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const revealResults = (enabled: boolean): void => {
    if (attachedHost.value?.revealResults) {
      attachedHost.value.revealResults(enabled);
      return;
    }
    if (enabled) revealFirstResult();
    else clearResultReveal();
  };

  const reload = (): void => {
    if (attachedHost.value?.reload) {
      attachedHost.value.reload();
      return;
    }
    if (typeof window !== 'undefined') window.location.reload();
  };

  // ---- Preferences sync & writers ----
  const resetSetupPreferences = () => {
    const { demoPlaying, demoCursor } = setupWritable;
    Object.assign(setupWritable, createInitialSetupState(), { demoPlaying, demoCursor });
  };

  const syncPreferencesSnapshot = (snapshot: Readonly<Preferences>) => {
    setupWritable.displayLocale = snapshot.displayLocale ?? DEFAULT_PREFERENCES.displayLocale;
    setupWritable.marketTranslation = snapshot.marketTranslation === true;
    setupWritable.marketTranslationBilingual = snapshot.marketTranslationBilingual !== false;
    setupWritable.marketTranslationResultBilingual =
      snapshot.marketTranslationResultBilingual === true;
    setupWritable.sidebarPosition = snapshot.sidebarPosition ?? DEFAULT_PREFERENCES.sidebarPosition;
    setupWritable.fontSizeScale = snapshot.fontSizeScale ?? DEFAULT_PREFERENCES.fontSizeScale;
    setupWritable.compactDensity = snapshot.densityScale === 0.8;
    setupWritable.enablePureBackground = snapshot.enablePureBackground === true;
    const nextResultFeatures = readResultFeatures(snapshot);
    if (
      RESULT_FEATURE_KEYS.some(
        (key) => nextResultFeatures[key] !== setupWritable.resultFeatures[key],
      )
    ) {
      setupWritable.resultFeatures = nextResultFeatures;
    }
    setupWritable.resultModHighlightStyle =
      snapshot.resultModHighlightStyle ?? DEFAULT_PREFERENCES.resultModHighlightStyle;
    setupWritable.resultModHighlightColor =
      snapshot.resultModHighlightColor ?? DEFAULT_PREFERENCES.resultModHighlightColor;

    if (pageLoadMarketBaseline === null) {
      const baselineReader = attachedHost.value?.getPageLoadPreferences ?? getPageLoadPreferences;
      pageLoadMarketBaseline = baselineReader() ?? snapshot;
    }
    setupWritable.reloadRequired = isMarketTranslationReloadRequired(
      pageLoadMarketBaseline,
      snapshot,
      getEnvironment(),
    );
  };

  const updatePreference = async (patch: Partial<Preferences>, label: string): Promise<void> => {
    const prefs = attachedHost.value?.preferences;
    if (!prefs) return;
    const outcome = await prefs.update(patch);
    if (!outcome.ok) console.error(`[PoeXD PageGuide] 無法更新${label}:`, outcome.error);
  };

  const setDisplayLocale = (value: DisplayLocalePreference) =>
    updatePreference({ displayLocale: value }, '顯示語言');

  const setMarketTranslation = (value: boolean) => {
    const env = getEnvironment();
    const patch = buildMarketTranslationTogglePatch(value, setupWritable.displayLocale, {
      browserLocale: env.browserLocale,
      browserLanguages: env.browserLanguages,
    });
    return updatePreference(patch, '市集漢化設定');
  };

  const setMarketTranslationBilingual = (value: boolean) =>
    updatePreference({ marketTranslationBilingual: value }, '市集下拉中英並列');

  const setMarketTranslationResultBilingual = (value: boolean) =>
    updatePreference({ marketTranslationResultBilingual: value }, '市集結果中英並列');

  const setSidebarPosition = (value: SidebarPosition) =>
    updatePreference({ sidebarPosition: value }, '側邊欄位置');

  const setFontSizeScale = (value: number) =>
    updatePreference({ fontSizeScale: clampFontSizeScale(value) }, '字體大小');

  const setCompactDensity = (value: boolean) =>
    updatePreference({ densityScale: value ? 0.8 : 1 }, '緊湊介面');

  const setEnablePureBackground = (value: boolean) =>
    updatePreference({ enablePureBackground: value }, '隱藏官方網頁背景');

  const setResultFeature = (key: ResultFeatureKey, value: boolean) =>
    updatePreference({ [key]: value }, '結果列功能');

  const setResultModHighlightStyle = (value: ResultModHighlightStyle) =>
    updatePreference({ resultModHighlightStyle: value }, '結果詞綴高亮樣式');

  const setResultModHighlightColor = (value: ResultModHighlightColor) =>
    updatePreference({ resultModHighlightColor: value }, '結果詞綴高亮強調色');

  // ---- Demo element spotlight/ring ----
  const setDemoElements = (targets: {
    ring?: Element | readonly Element[] | null;
    spotlight?: Element | null;
  }) => {
    if ('ring' in targets) {
      if (!targets.ring) demoRingElementsWritable.value = [];
      else {
        demoRingElementsWritable.value = Array.isArray(targets.ring)
          ? targets.ring
          : [targets.ring];
      }
    }
    if ('spotlight' in targets) demoSpotlightElementWritable.value = targets.spotlight ?? null;
  };

  // ---- Interactive demo scripts ----
  const restoreAffixDemoModal = () => {
    demoStateWritable.affixHoveredModId = null;
    if (affixOpenedByDemo) {
      affixOpenedByDemo = false;
      const handle = attachedHost.value?.getFilterPaneHandle?.() ?? null;
      if (affixSnapshot && handle) {
        handle.restoreSnapshot(affixSnapshot);
      }
      affixSnapshot = null;
      attachedHost.value?.closeAffixModal?.();
    }
    demoStateWritable.affixMode = false;
  };

  const stopStepDemo = () => {
    activeDemoRun += 1;
    setupWritable.demoCursor = null;
    setupWritable.demoPlaying = false;
    demoStateWritable.tierMenuSlotKey = null;
    demoStateWritable.tierTriggerSlotKey = null;
    restoreAffixDemoModal();
    if (collapseDemoTabTopChanged) {
      collapseDemoTabTopChanged = false;
      const storedTop = attachedHost.value?.preferences?.read().collapsedTabTop;
      previewCollapsedTabTop(storedTop ?? getCollapsedTabTop());
    }
    setDemoElements({ ring: null, spotlight: null });
  };

  const moveAndPressCursor = async (
    target: { x: number; y: number },
    alive: () => boolean,
    opts: {
      startPos?: { x: number; y: number };
      movePauseMs?: number;
      pressHoldMs?: number;
      release?: boolean;
    } = {},
  ): Promise<boolean> => {
    if (opts.startPos) {
      setupWritable.demoCursor = { x: opts.startPos.x, y: opts.startPos.y, pressed: false };
      await wait(50);
      if (!alive()) return false;
    }
    setupWritable.demoCursor = { x: target.x, y: target.y, pressed: false };
    await wait(DEMO_CURSOR_MOVE_MS + (opts.movePauseMs ?? 120));
    if (!alive()) return false;
    setupWritable.demoCursor = { x: target.x, y: target.y, pressed: true };
    await wait(opts.pressHoldMs ?? 150);
    if (!alive()) return false;
    if (opts.release !== false) {
      setupWritable.demoCursor = { x: target.x, y: target.y, pressed: false };
    }
    return true;
  };

  const playCollapseDemo = async () => {
    stopStepDemo();
    const run = activeDemoRun;
    const alive = () => run === activeDemoRun;
    setupWritable.demoPlaying = true;
    try {
      if (isCollapsed()) {
        toggleCollapse();
        await wait(SIDEBAR_LAYOUT_TRANSITION_MS + 120);
        if (!alive()) return;
      }
      const closeButton = querySidebar('[data-sidebar-action="collapse"]');
      if (!closeButton) return;
      const close = centerOf(closeButton);
      const startX = getSidebarPosition() === 'right' ? close.x - 120 : close.x + 120;
      if (
        !(await moveAndPressCursor(close, alive, {
          startPos: { x: startX, y: close.y + 140 },
          movePauseMs: 150,
          pressHoldMs: 150,
        }))
      ) {
        return;
      }
      if (!isCollapsed()) toggleCollapse();
      await wait(SIDEBAR_LAYOUT_TRANSITION_MS + 250);
      if (!alive()) return;

      const tab = querySidebar('[data-sidebar-action="expand"]');
      if (!tab) return;
      const grip = centerOf(tab);
      if (
        !(await moveAndPressCursor(grip, alive, {
          movePauseMs: 150,
          pressHoldMs: 200,
          release: false,
        }))
      ) {
        return;
      }
      const tabRect = tab.getBoundingClientRect();
      const tabHeight = tabRect.height || 32;
      const startTop = tabRect.top;
      const endTop = clampCollapsedTabTop(
        startTop + DEMO_DRAG_DISTANCE,
        getViewportHeight(),
        tabHeight,
      );
      // 按住時游標不補間，逐格同步移動標籤與游標
      const drag = async (from: number, to: number) => {
        const startedAt = now();
        for (;;) {
          if (!alive()) return false;
          const progress = Math.min(1, (now() - startedAt) / DEMO_DRAG_MS);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
          const top = from + (to - from) * eased;
          collapseDemoTabTopChanged = true;
          previewCollapsedTabTop(top);
          setupWritable.demoCursor = { x: grip.x, y: grip.y + (top - startTop), pressed: true };
          if (progress >= 1) return true;
          await nextAnimationFrame();
        }
      };
      if (!(await drag(startTop, endTop))) return;
      await wait(300);
      if (!(await drag(endTop, startTop))) return;
      setupWritable.demoCursor = { x: grip.x, y: grip.y, pressed: false };
      await wait(400);
      if (!alive()) return;
      stopStepDemo();
    } finally {
      if (alive()) setupWritable.demoPlaying = false;
    }
  };

  const playAffixSelectorDemo = async () => {
    stopStepDemo();
    const run = activeDemoRun;
    const alive = () => run === activeDemoRun;
    setupWritable.demoPlaying = true;
    try {
      const triggerBtn = queryPage('.poexd-filter-select-btn, .poexd-category-select-btn');
      if (!triggerBtn) return;

      const btnCenter = centerOf(triggerBtn);
      if (
        !(await moveAndPressCursor(btnCenter, alive, {
          startPos: { x: btnCenter.x + 110, y: btnCenter.y + 80 },
        }))
      ) {
        return;
      }

      demoStateWritable.affixMode = true;
      affixOpenedByDemo = true;
      attachedHost.value?.openAffixModal?.();

      // 等待 FilterPane 掛載與字典載入完成
      let handle: FilterPaneDemoHandle | null = null;
      for (let i = 0; i < 80; i += 1) {
        await nextTick();
        handle = attachedHost.value?.getFilterPaneHandle?.() ?? null;
        if (
          handle &&
          !handle.isLoading() &&
          querySidebar('[data-filter-action="open-type-dialog"]')
        ) {
          break;
        }
        await wait(50);
        if (!alive()) return;
      }
      if (!handle || handle.isLoading()) return;
      affixSnapshot = handle.getSnapshot();
      // 打開面板即直接顯示「胸甲」類別，不再另外開啟類別選單
      handle.selectTypeForDemo(DEMO_CATEGORY);
      await nextTick();
      await wait(180);
      if (!alive()) return;

      const affixDialog = querySidebar('[data-sidebar-dialog="affix"]');
      const searchInput = querySidebar('[data-filter-search]');
      if (!affixDialog || !searchInput) return;
      setDemoElements({ spotlight: affixDialog, ring: searchInput });

      const searchCenter = centerOf(searchInput);
      if (
        !(await moveAndPressCursor(searchCenter, alive, { movePauseMs: 100, pressHoldMs: 130 }))
      ) {
        return;
      }

      const lifeMod = handle.findDemoLifeMod();
      const searchTerm = resolveDemoSearchText(
        getPoeVersion(),
        setupWritable.displayLocale,
        lifeMod?.label,
      );
      for (let len = 1; len <= searchTerm.length; len += 1) {
        handle.setSearchQueryForDemo(searchTerm.slice(0, len));
        await wait(80);
        if (!alive()) return;
      }
      await nextTick();
      await wait(180);
      if (!alive()) return;

      const modRow =
        (lifeMod ? querySidebar(`[data-mod-id="${escapeCssIdent(lifeMod.id)}"]`) : null) ??
        querySidebar(`[data-mod-official-id="${DEMO_STAT_ID}"]`);
      if (modRow) {
        scrollIntoView(modRow);
        await nextTick();
        const modId = modRow.dataset.modId ?? lifeMod?.id ?? null;
        if (modId) demoStateWritable.affixHoveredModId = modId;
        await nextTick();
        await wait(100);
        if (!alive()) return;

        setDemoElements({ ring: modRow });
        const addBtn = modRow.querySelector<HTMLElement>('[data-mod-action="add-now"]');
        const target = addBtn ?? modRow;
        const addCenter = centerOf(target);
        if (!(await moveAndPressCursor(addCenter, alive, { pressHoldMs: 180 }))) {
          return;
        }
      }

      // 透過導覽示範通道真正插入第 7 步會用到的示範詞綴，方便第 7 步沿用與結束時一併清除
      await ensureDemoStatFilter();
      if (!alive()) return;

      restoreAffixDemoModal();
      setupWritable.demoCursor = null;
      await nextTick();
      await wait(120);
      if (!alive()) return;

      const insertedRow = queryPage('[data-poexd-page-guide-demo="true"]');
      setDemoElements({
        spotlight: null,
        ring: insertedRow ?? triggerBtn,
      });
    } finally {
      if (alive()) {
        if (affixOpenedByDemo || demoStateWritable.affixMode) {
          restoreAffixDemoModal();
        }
        setupWritable.demoPlaying = false;
        setupWritable.demoCursor = null;
      }
    }
  };

  const playTierDemo = async () => {
    stopStepDemo();
    const run = activeDemoRun;
    const alive = () => run === activeDemoRun;
    const queryPageRoot = { querySelector: queryPage };
    let key = findFirstTierSlotKey(queryPageRoot, { demoOnly: true });
    if (!key) {
      for (let i = 0; i < 15; i += 1) {
        await wait(40);
        if (!alive()) return;
        key = findFirstTierSlotKey(queryPageRoot, { demoOnly: true });
        if (key) break;
      }
    }
    if (!key) return;
    demoStateWritable.tierTriggerSlotKey = key;
    demoStateWritable.tierMenuSlotKey = key;
    await nextTick();
    const triggerSelector = `[data-poexd-page-guide-demo="true"] .poexd-tier-trigger[data-tier-slot-key="${key}"]`;
    const trigger = queryPage(triggerSelector);
    const demoRow = trigger?.closest<HTMLElement>('[data-poexd-page-guide-demo="true"]') ?? null;
    for (let i = 0; i < 15; i += 1) {
      const menu = querySidebar('[data-slot="dropdown-menu-content"][data-state="open"]');
      if (menu && menu.getBoundingClientRect().width > 0) {
        const anchorEl = demoRow ?? trigger;
        setDemoElements({ ring: anchorEl ? [anchorEl, menu] : menu });
        return;
      }
      await wait(40);
      if (!alive()) return;
    }
    if (demoRow ?? trigger) setDemoElements({ ring: (demoRow ?? trigger)! });
  };

  const runStepDemo = async (demo: PageGuideStepDemo) => {
    if (demo === 'collapse') {
      void playCollapseDemo();
      return;
    }
    if (demo === 'affix-selector') {
      void playAffixSelectorDemo();
      return;
    }
    if (demo === 'tier-menu') {
      await playTierDemo();
    }
  };

  const replayStepDemo = async (stepId: string): Promise<void> => {
    if (stepId === 'collapse') await playCollapseDemo();
    else if (stepId === 'affix-selector') await playAffixSelectorDemo();
  };

  // ---- Step visibility & state machine ----
  const isConditionMet = (condition: PageGuideStepCondition): boolean => {
    if (condition !== 'market-translation-offer') return false;
    const env = getEnvironment();
    return shouldOfferMarketTranslation({
      hostname: env.hostname,
      displayLocale: setupWritable.displayLocale,
      browserLocale: env.browserLocale,
    });
  };

  /** 條件會在導覽中改變（例如第一步換了語言），每次重新計算 */
  const visibleSteps = computed(() => {
    // 依賴 attachedHost 以在 attach/detach 後重新評估環境條件
    void attachedHost.value;
    return steps.filter((step) => !step.when || isConditionMet(step.when));
  });

  const roots = () => ({ page: document, sidebar: getSidebarRoot() });

  const restoreDemo = async () => {
    pendingDemoStatFilter = null;
    if (!activeDemoAction) return;
    activeDemoAction = null;
    await requestDemo('restore');
  };

  const locate = async (targetId: PageGuideTargetId): Promise<Element | null> => {
    const target = getPageGuideTarget(targetId);
    revealResults(target.needs === 'results');
    const found = findPageGuideElement(target, roots());
    const demoAction = target.needs ? DEMO_ACTION_BY_NEED[target.needs] : undefined;
    if (found || !demoAction) return found;
    if (await requestDemo(demoAction)) {
      if (demoAction === 'add-stat-filter' || !activeDemoAction) {
        activeDemoAction = demoAction;
      }
    }
    await wait(DEMO_RENDER_WAIT_MS);
    return findPageGuideElement(target, roots());
  };

  const prepareStep = async (step: PageGuideTourStep) => {
    if (!step.targetId || !attachedHost.value?.toggleCollapse) return;
    const scope = getPageGuideTarget(step.targetId).scope;
    const collapsed = isCollapsed();
    const needsToggle = (scope === 'sidebar' && collapsed) || (scope === 'page' && !collapsed);
    if (!needsToggle) return;
    toggleCollapse();
    await wait(SIDEBAR_LAYOUT_TRANSITION_MS + 80);
  };

  const reset = () => {
    clearTimeout(pointTimer);
    stopStepDemo();
    stateWritable.demoFocus = null;
    stateWritable.mode = 'idle';
    stateWritable.label = '';
    stateWritable.stepId = '';
    elementWritable.value = null;
  };

  const stop = async () => {
    const wasTour = stateWritable.mode === 'tour';
    runToken += 1;
    reset();
    if (wasTour) {
      const shouldExpand = expandOnTourExit;
      expandOnTourExit = false;
      if (shouldExpand && isCollapsed()) {
        toggleCollapse();
      }
    }
    revealResults(false);
    await restoreDemo();
  };

  /** 設定旁的「在頁面上指出」：捲過去、框一下，幾秒後自動消失。 */
  const pointAt = async (targetId: PageGuideTargetId, label: string) => {
    await stop();
    const token = runToken;
    const found = await locate(targetId);
    if (token !== runToken) return;
    if (!found) {
      await restoreDemo();
      const needsResults = getPageGuideTarget(targetId).needs === 'results';
      notify(t(needsResults ? 'pageGuide.point.needsResults' : 'pageGuide.point.notFound'));
      return;
    }
    scrollIntoView(found);
    elementWritable.value = found;
    stateWritable.label = label;
    stateWritable.mode = 'point';
    pointTimer = setTimeout(() => {
      if (token === runToken) void stop();
    }, POINT_DURATION_MS);
  };

  const showStep = async (index: number) => {
    const token = ++runToken;
    clearTimeout(pointTimer);
    const step = visibleSteps.value[index];
    if (!step) return;
    const needs = step.targetId ? getPageGuideTarget(step.targetId).needs : undefined;
    const nextDemoAction = needs ? DEMO_ACTION_BY_NEED[needs] : undefined;
    if (
      !nextDemoAction ||
      (activeDemoAction === 'add-stat-filter' && nextDemoAction !== 'add-stat-filter')
    ) {
      await restoreDemo();
    }
    stopStepDemo();
    await prepareStep(step);
    if (token !== runToken) return;
    // 示意結果列要先畫出來，外框才找得到裡面的按鈕
    stateWritable.demoFocus = step.demoFocus ?? null;
    if (step.demoFocus) await nextTick();
    if (!step.targetId) revealResults(false);
    // 導覽的階級步驟一律優先確保專用示範詞綴存在，避免在尚未等第 6 步播完就跳步時誤抓到頁面原本的其他詞綴
    if (nextDemoAction === 'add-stat-filter') {
      await ensureDemoStatFilter();
      if (token !== runToken) return;
    }
    const found = step.targetId ? await locate(step.targetId) : null;
    if (token !== runToken) return;
    if (found) scrollIntoView(found);
    stateWritable.mode = 'tour';
    stateWritable.stepIndex = index;
    stateWritable.stepId = step.id;
    stateWritable.label = '';
    elementWritable.value = found;
    if (step.demo) await runDemo(step, token);
  };

  const runDemo = async (step: PageGuideTourStep, token: number) => {
    if (!step.demo) return;
    await runStepDemo(step.demo);
    if (token !== runToken || !step.demoTargetId) return;
    const target = getPageGuideTarget(step.demoTargetId);
    for (let attempt = 0; attempt < DEMO_TARGET_RETRIES; attempt += 1) {
      const found = findPageGuideElement(target, roots());
      if (token !== runToken) return;
      if (found) {
        elementWritable.value = found;
        return;
      }
      await wait(DEMO_TARGET_RETRY_MS);
    }
  };

  /** 目前步驟在會出現的步驟中的位置；條件改變後步驟可能前移或消失 */
  const currentVisibleIndex = () => {
    const index = visibleSteps.value.findIndex((step) => step.id === stateWritable.stepId);
    return index >= 0 ? index : stateWritable.stepIndex;
  };

  const startTour = async () => {
    if (stateWritable.mode !== 'tour') {
      expandOnTourExit = !isCollapsed();
    }
    await showStep(0);
  };

  const nextStep = async () => {
    const index = currentVisibleIndex();
    if (index >= visibleSteps.value.length - 1) {
      await stop();
      return;
    }
    await showStep(index + 1);
  };

  const previousStep = async () => {
    const index = currentVisibleIndex();
    if (index > 0) await showStep(index - 1);
  };

  const currentStep = computed(() =>
    stateWritable.mode === 'tour'
      ? (steps.find((step) => step.id === stateWritable.stepId) ?? null)
      : null,
  );
  const stepCount = computed(() => visibleSteps.value.length);
  const stepNumber = computed(() => currentVisibleIndex() + 1);

  /**
   * 目標被移除或藏起來時（例如導覽中收合側欄）同步改找對照表裡下一個看得到的元素；
   * 不送示範動作，找不到就維持原樣。
   */
  const refreshElement = () => {
    const step = currentStep.value;
    if (!step?.targetId) return;
    const current = elementWritable.value;
    if (current?.isConnected) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return;
    }
    // 示範的畫面（例如 T 階清單）被關掉後，退回步驟原本的目標
    const found = findPageGuideElement(getPageGuideTarget(step.targetId), roots());
    if (found && found !== current) elementWritable.value = found;
  };

  /** 供第 6 步／第 7 步確保專用示範詞綴已插入，避免頁面上原有其他詞綴干擾第 7 步目標 */
  const ensureDemoStatFilter = async (): Promise<boolean> => {
    if (activeDemoAction === 'add-stat-filter') return true;
    if (pendingDemoStatFilter) return pendingDemoStatFilter;
    const run = (async () => {
      const ok = await requestDemo('add-stat-filter');
      if (ok) {
        activeDemoAction = 'add-stat-filter';
        await wait(DEMO_RENDER_WAIT_MS);
        // 官方頁面重新標記示範列與注入 T 階按鈕皆為非同步，持續等到示範列的 T 按鈕出現再繼續
        for (let attempt = 0; attempt < DEMO_TARGET_RETRIES; attempt += 1) {
          if (queryPage('[data-poexd-page-guide-demo="true"] .poexd-tier-trigger')) {
            break;
          }
          await wait(DEMO_TARGET_RETRY_MS);
        }
      }
      return ok;
    })();
    pendingDemoStatFilter = run;
    try {
      return await run;
    } finally {
      if (pendingDemoStatFilter === run) pendingDemoStatFilter = null;
    }
  };

  /** 設定頁借用官方示意結果列當作即時預覽畫布：不蓋暗遮罩、不阻擋側邊欄操作 */
  const openResultPreview = (focus: PageGuideDemoFocus = 'mods') => {
    if (stateWritable.mode === 'tour') return;
    clearTimeout(pointTimer);
    runToken += 1;
    revealResults(false);
    void restoreDemo();
    elementWritable.value = null;
    demoRingElementsWritable.value = [];
    demoSpotlightElementWritable.value = null;
    stateWritable.label = '';
    stateWritable.stepId = '';
    stateWritable.demoFocus = focus;
    stateWritable.mode = 'preview';
  };

  /** 關閉設定頁開啟的示意結果預覽；進行中的導覽或指出不受影響 */
  const closeResultPreview = () => {
    if (stateWritable.mode !== 'preview') return;
    void stop();
  };

  // ---- Host attachment lifecycle ----
  const attachHost = (host: PageGuideHost) => {
    stopPreferences?.();
    stopPreferences = undefined;
    attachedHost.value = host;
    pageLoadMarketBaseline = null;
    if (host.preferences) {
      stopPreferences = host.preferences.subscribe(syncPreferencesSnapshot);
    } else {
      resetSetupPreferences();
    }
  };

  const detachHost = () => {
    stopPreferences?.();
    stopPreferences = undefined;
    expandOnTourExit = false;
    void stop();
    attachedHost.value = null;
    pageLoadMarketBaseline = null;
    resetSetupPreferences();
  };

  if (initialHost) {
    attachHost(initialHost);
  }

  return {
    state: readonly(stateWritable),
    element: computed(() => elementWritable.value),
    demoRingElements: computed(() => demoRingElementsWritable.value),
    demoSpotlightElement: computed(() => demoSpotlightElementWritable.value),
    demoState: readonly(demoStateWritable) as PageGuideDemoState,
    setup: readonly(setupWritable) as PageGuideSetupState,
    currentStep,
    stepCount,
    stepNumber,
    attachHost,
    detachHost,
    ensureDemoStatFilter,
    openResultPreview,
    closeResultPreview,
    pointAt,
    startTour,
    nextStep,
    previousStep,
    refreshElement,
    stop,
    setDisplayLocale,
    setMarketTranslation,
    setMarketTranslationBilingual,
    setMarketTranslationResultBilingual,
    setSidebarPosition,
    setFontSizeScale,
    setCompactDensity,
    setEnablePureBackground,
    setResultFeature,
    setResultModHighlightStyle,
    setResultModHighlightColor,
    replayStepDemo,
    reload,
  };
}

export type PageGuideSession = ReturnType<typeof createPageGuideSession>;

let sharedGuide: PageGuideSession | null = null;

/** 整個側欄與跨 App 消費者（例如 TierDropdownHost）共用的導覽工作階段單例。 */
export function usePageGuide(): PageGuideSession {
  sharedGuide ??= createPageGuideSession();
  return sharedGuide;
}
