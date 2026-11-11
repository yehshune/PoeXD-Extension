import {
  clearPendingSearchSubmissions,
  ensureActiveBindingSession,
  extractLeagueAndModeFromUrl,
  getOfficialCategorySnapshot,
  setOfficialCategorySnapshot,
  batchUpdateAllCategories,
  clearAllFilterCategories,
  persistBindings,
  reconcileFilterBindings,
  rolloverBindingSession,
} from './category-binding-manager';
import { getVueStore } from './poe-runtime-reader';
import type { HostVuexStore } from './host-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import {
  resolveOfficialTierCategory,
  type OfficialTierCategoryResolution,
} from '@/utils/official-category-resolver';
import type { PoeVersion } from '@/utils/trade-context';

let activeBridge: MainWorldBridge | null = null;
let unlistenCategoryRequest: (() => void) | null = null;
let storeUnsubscribe: (() => void) | null = null;
let subscribedStore: HostVuexStore | null = null;
let hasEstablishedBaseline = false;
let baselineCategory: string | null = null;
let lastQueryOverride: unknown = undefined;
let currentOfficialResolution: OfficialTierCategoryResolution = { status: 'unavailable' };

export function getCurrentOfficialResolution(): OfficialTierCategoryResolution {
  return currentOfficialResolution;
}

export function setDomTaggerBridge(bridge: MainWorldBridge | null): void {
  if (unlistenCategoryRequest) {
    unlistenCategoryRequest();
    unlistenCategoryRequest = null;
  }
  activeBridge = bridge;
  if (bridge && typeof bridge.addListener === 'function') {
    unlistenCategoryRequest = bridge.addListener('poexd-request-official-category', () => {
      if (!hasEstablishedBaseline) {
        syncOfficialCategoryFromStore();
      } else {
        bridge.dispatchEvent('poexd-equipment-type-changed', {
          type: getOfficialCategorySnapshot(),
        });
      }
    });
  }
}

export function resetOfficialCategoryBaseline(): void {
  hasEstablishedBaseline = false;
  baselineCategory = null;
  lastQueryOverride = undefined;
  currentOfficialResolution = { status: 'unavailable' };
}

export function resetOfficialCategoryBaselineForTest(): void {
  resetOfficialCategoryBaseline();
  unsubscribeStore();
}

export function syncOfficialCategoryFromStore(
  queryOverride?: unknown,
): OfficialTierCategoryResolution {
  const store = getVueStore();
  if (!store) {
    currentOfficialResolution = { status: 'unavailable' };
    return currentOfficialResolution;
  }

  if (queryOverride !== undefined) {
    lastQueryOverride = queryOverride;
  }

  const query =
    queryOverride ?? (store.state?.query || lastQueryOverride || store.state?.persistent);
  if (!query) {
    currentOfficialResolution = { status: 'unavailable' };
    return currentOfficialResolution;
  }

  const version: PoeVersion =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/trade2')
      ? 'poe2'
      : 'poe1';

  const resolution = resolveOfficialTierCategory(version, query);
  currentOfficialResolution = resolution;

  if (resolution.status === 'unavailable') {
    // 嚴格落實 unavailable：不更新 snapshot、不 batch clear、不修改 filters、不破壞 binding identity、不派發 clear
    return resolution;
  }

  const stats = store.state?.persistent?.stats || store.state?.query?.stats;

  if (resolution.status === 'known_category') {
    const nextCategory = resolution.category;
    if (!hasEstablishedBaseline) {
      hasEstablishedBaseline = true;
      baselineCategory = nextCategory;
      setOfficialCategorySnapshot(nextCategory);
      if (activeBridge) {
        activeBridge.dispatchEvent('poexd-equipment-type-changed', { type: nextCategory });
      }
    } else if (baselineCategory !== nextCategory) {
      baselineCategory = nextCategory;
      setOfficialCategorySnapshot(nextCategory);
      if (stats) {
        store._withCommit(() => {
          batchUpdateAllCategories(stats, nextCategory);
        });
      }
      if (activeBridge) {
        activeBridge.dispatchEvent('poexd-equipment-type-changed', { type: nextCategory });
      }
    }
  } else if (resolution.status === 'known_cleared') {
    if (!hasEstablishedBaseline) {
      hasEstablishedBaseline = true;
      baselineCategory = null;
      setOfficialCategorySnapshot(null);
      if (activeBridge) {
        activeBridge.dispatchEvent('poexd-equipment-type-changed', { type: null });
      }
    } else if (baselineCategory !== null) {
      baselineCategory = null;
      setOfficialCategorySnapshot(null);
      if (stats) {
        store._withCommit(() => {
          clearAllFilterCategories(stats);
        });
      }
      if (activeBridge) {
        activeBridge.dispatchEvent('poexd-equipment-type-changed', { type: null });
      }
    }
  }

  return resolution;
}

export function unsubscribeStore(): void {
  if (storeUnsubscribe) {
    try {
      storeUnsubscribe();
    } catch {
      // safe fallback
    }
    storeUnsubscribe = null;
  }
  subscribedStore = null;
}

function ensureStoreSubscribed(store: HostVuexStore) {
  if (subscribedStore === store && storeUnsubscribe) return;
  unsubscribeStore();
  subscribedStore = store;
  if (typeof store.subscribe === 'function') {
    const unsub = store.subscribe(() => {
      syncOfficialCategoryFromStore();
      tagFilterDomElements();
    });
    if (typeof unsub === 'function') {
      storeUnsubscribe = unsub;
    }
  }
}

export function saveAllCategoriesToSessionStorage() {
  const store = getVueStore();
  if (!store) return;
  const stats = store.state?.persistent?.stats || store.state?.query?.stats;
  if (!stats) return;

  persistBindings(stats);
}

export function isStatFilterGroup(group: Element): boolean {
  const header = group.querySelector('.filter-group-header');
  if (header) {
    if (header.querySelector('.filter-select') !== null) return true;
    if (header.querySelector('.multiselect') !== null) return true;
    if (header.querySelector('.filter-group-select') !== null) return true;
  }
  const inputs = Array.from(group.querySelectorAll('input'));
  return inputs.some(
    (i) =>
      i.placeholder &&
      (i.placeholder.includes('+') ||
        i.placeholder.toLowerCase().includes('filter') ||
        i.placeholder.includes('屬性') ||
        i.placeholder.includes('過濾')),
  );
}

export function tagFilterDomElements(explicitCategory?: string | null) {
  const store = getVueStore();
  if (!store) {
    console.warn('[PoeXD Inject] tagFilterDomElements: 找不到 Vuex store');
    return;
  }
  ensureStoreSubscribed(store);
  const resolution = syncOfficialCategoryFromStore();

  const stats = store.state?.persistent?.stats || store.state?.query?.stats;
  if (!stats) {
    console.warn('[PoeXD Inject] tagFilterDomElements: 找不到 stats');
    return;
  }

  // 區分 Last trusted snapshot 與 Current initialization eligibility：
  // 1. Snapshot 保留上一個可信 official category，保護既有 filters 不被 clear/overwrite。
  // 2. 只有當下 structured query resolution 為 known_category 時，才能拿 category 初始化真正的新 filter。
  // 3. 若為 known_cleared 或 unavailable，新 filter 保持 unbound (null)。
  const officialCategory =
    explicitCategory !== undefined
      ? explicitCategory
      : resolution.status === 'known_category'
        ? resolution.category
        : null;
  store._withCommit(() => {
    reconcileFilterBindings(stats, officialCategory);
  });

  const allGroups = document.querySelectorAll('.search-advanced-pane.brown .filter-group');
  const groups = Array.from(allGroups).filter(isStatFilterGroup);

  groups.forEach((group, gIdx) => {
    if (!stats[gIdx] || !stats[gIdx].filters) {
      console.warn(`[PoeXD Inject] tagFilterDomElements: stats[${gIdx}] 或其 filters 屬性不存在`);
      return;
    }
    const groupType = typeof stats[gIdx].type === 'string' ? stats[gIdx].type : '';
    if (group.getAttribute('data-poexd-group-type') !== groupType) {
      group.setAttribute('data-poexd-group-type', groupType);
    }
    const filterElements = group.querySelectorAll('.filter-group-body .filter:not(.filter-padded)');

    filterElements.forEach((filterEl, fIdx) => {
      const filter = stats[gIdx].filters?.[fIdx];
      if (filter && filter.id) {
        if (filterEl.getAttribute('data-poexd-stat-id') !== filter.id) {
          filterEl.setAttribute('data-poexd-stat-id', filter.id);
        }

        if (filter.poexdBindingId) {
          if (filterEl.getAttribute('data-poexd-binding-id') !== filter.poexdBindingId) {
            filterEl.setAttribute('data-poexd-binding-id', filter.poexdBindingId);
          }
        } else if (filterEl.hasAttribute('data-poexd-binding-id')) {
          filterEl.removeAttribute('data-poexd-binding-id');
        }

        if (filter.poexdCategory) {
          if (filterEl.getAttribute('data-poexd-category') !== filter.poexdCategory) {
            filterEl.setAttribute('data-poexd-category', filter.poexdCategory);
          }
        } else if (filterEl.hasAttribute('data-poexd-category')) {
          filterEl.removeAttribute('data-poexd-category');
        }
      } else {
        console.warn(`[PoeXD Inject] 群組 ${gIdx} 的第 ${fIdx} 個詞綴在 Vuex 中沒有對應資料或 id`);
      }
    });
  });
}

let activeTaggerObserver: MutationObserver | null = null;
let activeReadinessObserver: MutationObserver | null = null;
let activeObservedElement: Element | null = null;

export function stopDomTagger() {
  if (activeTaggerObserver) {
    activeTaggerObserver.disconnect();
    activeTaggerObserver = null;
  }
  if (activeReadinessObserver) {
    activeReadinessObserver.disconnect();
    activeReadinessObserver = null;
  }
  activeObservedElement = null;
  unsubscribeStore();
}

function startTaggerOnElement(searchAdvanced: Element) {
  if (activeReadinessObserver) {
    activeReadinessObserver.disconnect();
    activeReadinessObserver = null;
  }
  if (activeTaggerObserver && activeObservedElement === searchAdvanced) {
    tagFilterDomElements();
    return;
  }
  if (activeTaggerObserver) {
    activeTaggerObserver.disconnect();
    activeTaggerObserver = null;
  }
  activeObservedElement = searchAdvanced;
  tagFilterDomElements();
  activeTaggerObserver = new MutationObserver(() => {
    tagFilterDomElements();
  });
  activeTaggerObserver.observe(searchAdvanced, {
    childList: true,
    subtree: true,
  });
}

export function syncDomTaggerRoute(navType?: 'pushState' | 'replaceState') {
  const { league, mode, searchSlug } = extractLeagueAndModeFromUrl();
  const isSearch = mode === 'search';

  if (!isSearch) {
    stopDomTagger();
    clearPendingSearchSubmissions();
    resetOfficialCategoryBaseline();
    rolloverBindingSession({ league, mode, searchSlug });
    return;
  }

  ensureActiveBindingSession({
    league,
    mode,
    searchSlug,
    navigationType: navType,
  });

  const currentObserved = document.querySelector('.search-advanced-items');
  if (currentObserved) {
    startTaggerOnElement(currentObserved);
    return;
  }

  if (activeReadinessObserver) {
    return;
  }

  const root = document.body || document.documentElement;
  if (!root) return;

  activeReadinessObserver = new MutationObserver(() => {
    const routeNow = extractLeagueAndModeFromUrl();
    if (routeNow.mode !== 'search') {
      stopDomTagger();
      clearPendingSearchSubmissions();
      resetOfficialCategoryBaseline();
      rolloverBindingSession({
        league: routeNow.league,
        mode: routeNow.mode,
        searchSlug: routeNow.searchSlug,
      });
      return;
    }
    ensureActiveBindingSession({
      league: routeNow.league,
      mode: routeNow.mode,
      searchSlug: routeNow.searchSlug,
    });
    const el = document.querySelector('.search-advanced-items');
    if (el) {
      startTaggerOnElement(el);
    }
  });

  activeReadinessObserver.observe(root, {
    childList: true,
    subtree: true,
  });
}

export function initDomTagger(bridge?: MainWorldBridge) {
  if (bridge) {
    setDomTaggerBridge(bridge);
  }
  syncDomTaggerRoute();
}
