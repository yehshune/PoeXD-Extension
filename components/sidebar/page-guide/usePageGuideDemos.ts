import { nextTick, ref, type Ref } from 'vue';
import { clampCollapsedTabTop } from '@/utils/collapsed-tab-position';
import {
  affixDemoHoveredModId,
  affixDemoMode,
  findFirstTierSlotKey,
  tierMenuDemoSlotKey,
  tierTriggerDemoSlotKey,
} from '@/utils/page-guide-demo-state';
import { SIDEBAR_LAYOUT_TRANSITION_MS } from '@/utils/sidebar-motion';
import type { PoeVersion } from '@/utils/trade-context';
import type { PageGuideDemoCursor } from './page-guide-setup';
import type { PageGuideStepDemo } from './page-guide-tour';

export interface FilterPaneSnapshot {
  selectedType: string;
  searchQuery: string;
}

export interface FilterPaneDemoHandle {
  isLoading: () => boolean;
  getSnapshot: () => FilterPaneSnapshot;
  restoreSnapshot: (snapshot: FilterPaneSnapshot) => void;
  openTypeDialog: () => void;
  selectTypeForDemo: (type: string) => void;
  setSearchQueryForDemo: (query: string) => void;
  findDemoLifeMod: () => { id: string; label: string } | null;
}

export interface PageGuideDemosOptions {
  portalTarget: Ref<HTMLElement | null>;
  isCollapsed: Ref<boolean>;
  sidebarPosition: Ref<'left' | 'right'>;
  collapsedTabTop: Ref<number>;
  toggleCollapse: () => void;
  previewCollapsedTabTop: (top: number) => void;
  readStoredCollapsedTabTop: () => number | undefined;
  openAffixModalForDemo: () => void;
  closeAffixModalForDemo: () => void;
  getFilterPaneHandle: () => FilterPaneDemoHandle | null;
  setDemoElements: (targets: {
    ring?: Element | readonly Element[] | null;
    spotlight?: Element | null;
  }) => void;
  ensureDemoStatFilter: () => Promise<boolean>;
  getPoeVersion: () => PoeVersion;
  getDisplayLocale: () => string;
}

const DEMO_CURSOR_MOVE_MS = 550;
const DEMO_DRAG_DISTANCE = 120;
const DEMO_DRAG_MS = 600;
const DEMO_STAT_ID = 'explicit.stat_3299347043';
const DEMO_CATEGORY = 'body-armour';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function centerOf(el: Element) {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function resolveDemoSearchText(
  version: PoeVersion,
  displayLocale: string,
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

export function usePageGuideDemos(options: PageGuideDemosOptions) {
  const demoCursor = ref<PageGuideDemoCursor | null>(null);
  const demoPlaying = ref(false);
  let activeRun = 0;
  let collapseDemoTabTopChanged = false;
  let affixSnapshot: FilterPaneSnapshot | null = null;
  let affixOpenedByDemo = false;

  const findSidebarElement = (selector: string): HTMLElement | null => {
    const root = options.portalTarget.value?.getRootNode() as ParentNode | undefined;
    return (root ?? document).querySelector<HTMLElement>(selector);
  };

  const stopStepDemo = () => {
    activeRun += 1;
    demoCursor.value = null;
    demoPlaying.value = false;
    tierMenuDemoSlotKey.value = null;
    tierTriggerDemoSlotKey.value = null;
    affixDemoHoveredModId.value = null;
    if (affixOpenedByDemo) {
      affixOpenedByDemo = false;
      const handle = options.getFilterPaneHandle();
      if (affixSnapshot && handle) {
        handle.restoreSnapshot(affixSnapshot);
      }
      affixSnapshot = null;
      options.closeAffixModalForDemo();
    }
    affixDemoMode.value = false;
    if (collapseDemoTabTopChanged) {
      collapseDemoTabTopChanged = false;
      options.previewCollapsedTabTop(
        options.readStoredCollapsedTabTop() ?? options.collapsedTabTop.value,
      );
    }
    options.setDemoElements({ ring: null, spotlight: null });
  };

  const playCollapseDemo = async () => {
    stopStepDemo();
    const run = activeRun;
    const alive = () => run === activeRun;
    demoPlaying.value = true;
    try {
      if (options.isCollapsed.value) {
        options.toggleCollapse();
        await sleep(SIDEBAR_LAYOUT_TRANSITION_MS + 120);
        if (!alive()) return;
      }
      const closeButton = findSidebarElement('[data-sidebar-action="collapse"]');
      if (!closeButton) return;
      const close = centerOf(closeButton);
      const startX = options.sidebarPosition.value === 'right' ? close.x - 120 : close.x + 120;
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
      if (!options.isCollapsed.value) options.toggleCollapse();
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
          options.previewCollapsedTabTop(top);
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
      stopStepDemo();
    } finally {
      if (alive()) demoPlaying.value = false;
    }
  };

  const playAffixSelectorDemo = async () => {
    stopStepDemo();
    const run = activeRun;
    const alive = () => run === activeRun;
    demoPlaying.value = true;
    try {
      const triggerBtn = document.querySelector<HTMLElement>(
        '.poexd-filter-select-btn, .poexd-category-select-btn',
      );
      if (!triggerBtn) return;

      const btnCenter = centerOf(triggerBtn);
      demoCursor.value = { x: btnCenter.x + 110, y: btnCenter.y + 80, pressed: false };
      await sleep(50);
      if (!alive()) return;
      demoCursor.value = { x: btnCenter.x, y: btnCenter.y, pressed: false };
      await sleep(DEMO_CURSOR_MOVE_MS + 120);
      if (!alive()) return;
      demoCursor.value = { x: btnCenter.x, y: btnCenter.y, pressed: true };
      await sleep(150);
      if (!alive()) return;
      demoCursor.value = { x: btnCenter.x, y: btnCenter.y, pressed: false };

      affixDemoMode.value = true;
      affixOpenedByDemo = true;
      options.openAffixModalForDemo();

      // 等待 FilterPane 掛載與字典載入完成
      let handle: FilterPaneDemoHandle | null = null;
      for (let i = 0; i < 80; i += 1) {
        await nextTick();
        handle = options.getFilterPaneHandle();
        if (
          handle &&
          !handle.isLoading() &&
          findSidebarElement('[data-filter-action="open-type-dialog"]')
        ) {
          break;
        }
        await sleep(50);
        if (!alive()) return;
      }
      if (!handle || handle.isLoading()) return;
      affixSnapshot = handle.getSnapshot();
      // 打開面板即直接顯示「胸甲」類別，不再另外開啟類別選單
      handle.selectTypeForDemo(DEMO_CATEGORY);
      await nextTick();
      await sleep(180);
      if (!alive()) return;

      const affixDialog = findSidebarElement('[data-sidebar-dialog="affix"]');
      const searchInput = findSidebarElement('[data-filter-search]');
      if (!affixDialog || !searchInput) return;
      options.setDemoElements({ spotlight: affixDialog, ring: searchInput });

      const searchCenter = centerOf(searchInput);
      demoCursor.value = { x: searchCenter.x, y: searchCenter.y, pressed: false };
      await sleep(DEMO_CURSOR_MOVE_MS + 100);
      if (!alive()) return;
      demoCursor.value = { x: searchCenter.x, y: searchCenter.y, pressed: true };
      await sleep(130);
      if (!alive()) return;
      demoCursor.value = { x: searchCenter.x, y: searchCenter.y, pressed: false };

      const lifeMod = handle.findDemoLifeMod();
      const searchTerm = resolveDemoSearchText(
        options.getPoeVersion(),
        options.getDisplayLocale(),
        lifeMod?.label,
      );
      for (let len = 1; len <= searchTerm.length; len += 1) {
        handle.setSearchQueryForDemo(searchTerm.slice(0, len));
        await sleep(80);
        if (!alive()) return;
      }
      await nextTick();
      await sleep(180);
      if (!alive()) return;

      const modRow =
        (lifeMod ? findSidebarElement(`[data-mod-id="${CSS.escape(lifeMod.id)}"]`) : null) ??
        findSidebarElement(`[data-mod-official-id="${DEMO_STAT_ID}"]`);
      if (modRow) {
        modRow.scrollIntoView({ block: 'center', behavior: 'auto' });
        await nextTick();
        const modId = modRow.dataset.modId ?? lifeMod?.id ?? null;
        if (modId) affixDemoHoveredModId.value = modId;
        await nextTick();
        await sleep(100);
        if (!alive()) return;

        options.setDemoElements({ ring: modRow });
        const addBtn = modRow.querySelector<HTMLElement>('[data-mod-action="add-now"]');
        const target = addBtn ?? modRow;
        const addCenter = centerOf(target);
        demoCursor.value = { x: addCenter.x, y: addCenter.y, pressed: false };
        await sleep(DEMO_CURSOR_MOVE_MS + 120);
        if (!alive()) return;
        demoCursor.value = { x: addCenter.x, y: addCenter.y, pressed: true };
        await sleep(180);
        if (!alive()) return;
        demoCursor.value = { x: addCenter.x, y: addCenter.y, pressed: false };
      }

      // 透過導覽示範通道真正插入第 7 步會用到的示範詞綴，方便第 7 步沿用與結束時一併清除
      await options.ensureDemoStatFilter();
      if (!alive()) return;

      affixDemoHoveredModId.value = null;
      if (affixSnapshot && handle) {
        handle.restoreSnapshot(affixSnapshot);
      }
      affixSnapshot = null;
      affixOpenedByDemo = false;
      options.closeAffixModalForDemo();
      affixDemoMode.value = false;
      demoCursor.value = null;
      await nextTick();
      await sleep(120);
      if (!alive()) return;

      const insertedRow = document.querySelector('[data-poexd-page-guide-demo="true"]');
      options.setDemoElements({
        spotlight: null,
        ring: insertedRow ?? triggerBtn,
      });
    } finally {
      if (alive()) {
        demoPlaying.value = false;
        demoCursor.value = null;
      }
    }
  };

  const playTierDemo = async () => {
    stopStepDemo();
    const run = activeRun;
    const alive = () => run === activeRun;
    const hasDemoFilter = document.querySelector('[data-poexd-page-guide-demo="true"]') !== null;
    let key = findFirstTierSlotKey(document, { demoOnly: hasDemoFilter });
    if (!key && hasDemoFilter) {
      for (let i = 0; i < 12; i += 1) {
        await sleep(40);
        if (!alive()) return;
        key = findFirstTierSlotKey(document, { demoOnly: true });
        if (key) break;
      }
    }
    key ??= findFirstTierSlotKey();
    if (!key) return;
    tierTriggerDemoSlotKey.value = key;
    tierMenuDemoSlotKey.value = key;
    await nextTick();
    const triggerSelector = hasDemoFilter
      ? `[data-poexd-page-guide-demo="true"] .poexd-tier-trigger[data-tier-slot-key="${key}"]`
      : `.poexd-tier-trigger[data-tier-slot-key="${key}"]`;
    const trigger = document.querySelector<HTMLElement>(triggerSelector);
    for (let i = 0; i < 15; i += 1) {
      const menu = findSidebarElement('[data-slot="dropdown-menu-content"][data-state="open"]');
      if (menu && menu.getBoundingClientRect().width > 0) {
        options.setDemoElements({ ring: trigger ? [trigger, menu] : menu });
        return;
      }
      await sleep(40);
      if (!alive()) return;
    }
    if (trigger) options.setDemoElements({ ring: trigger });
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

  const replayStepDemo = (stepId: string) => {
    if (stepId === 'collapse') void playCollapseDemo();
    else if (stepId === 'affix-selector') void playAffixSelectorDemo();
  };

  return {
    demoCursor,
    demoPlaying,
    playCollapseDemo,
    replayStepDemo,
    runStepDemo,
    stopStepDemo,
  };
}
