import {
  parsePoePageGuideDemo,
  serializePoePageGuideDemoResult,
} from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import {
  readCriteriaOverlaySnapshot,
  restoreCriteriaOverlaySnapshot,
} from './criteria-overlay-adapter';
import { tagFilterDomElements } from './dom-tagger';
import type { HostVuexStore } from './host-types';
import { getVueStore, readKnownStatIds } from './poe-runtime-reader';

/** 「+# 最大生命」：PoE1 與 PoE2 都有、而且一定有 T 階資料的常見詞綴 */
const PREFERRED_DEMO_STAT_ID = 'explicit.stat_3299347043';

export function pickDemoStatId(knownStatIds: readonly string[] | null): string | null {
  if (!knownStatIds || knownStatIds.length === 0) return PREFERRED_DEMO_STAT_ID;
  if (knownStatIds.includes(PREFERRED_DEMO_STAT_ID)) return PREFERRED_DEMO_STAT_ID;
  return knownStatIds.find((id) => id.startsWith('explicit.')) ?? null;
}

/**
 * 導覽用的示範狀態。篩選面板收起時先用官方 toggleSearch 展開；加入詞綴前先存下表單快照，
 * 還原時整份寫回並收回面板。都不呼叫官方 save()，網址、搜尋與歷史紀錄不受影響。
 */
export function createPageGuideDemo(getStore: () => HostVuexStore | null) {
  let backup: Record<string, unknown> | null = null;
  let revealedFilters = false;

  const requireStore = (): HostVuexStore => {
    const store = getStore();
    if (!store) throw new Error('FORM_STATE_NOT_FOUND');
    return store;
  };

  const showFilters = () => {
    const store = requireStore();
    if (store.state?.transient?.advancedSearchHidden !== true) return;
    store.commit('toggleSearch', undefined);
    revealedFilters = true;
  };

  const addStatFilter = () => {
    const store = requireStore();
    showFilters();
    const statId = pickDemoStatId(readKnownStatIds());
    if (!statId) throw new Error('DEMO_STAT_NOT_FOUND');
    if (!backup) backup = readCriteriaOverlaySnapshot(store);
    store.commit('pushStatGroup', {
      type: 'and',
      filters: [{ id: statId, value: {}, disabled: false }],
    });
  };

  const restore = () => {
    const store = getStore();
    if (store && backup) restoreCriteriaOverlaySnapshot(store, backup);
    if (store && revealedFilters && store.state?.transient?.advancedSearchHidden === false) {
      store.commit('toggleSearch', undefined);
    }
    backup = null;
    revealedFilters = false;
  };

  return {
    showFilters,
    addStatFilter,
    restore,
    isActive: () => backup !== null || revealedFilters,
  };
}

export function initPageGuideDemoAdapter(bridge: MainWorldBridge) {
  const demo = createPageGuideDemo(getVueStore);

  const unsubscribe = bridge.addListener('poexd-page-guide-demo', (detail) => {
    const request = parsePoePageGuideDemo(detail);
    if (!request) return;
    let error: string | undefined;
    try {
      if (request.action === 'show-filters') demo.showFilters();
      else if (request.action === 'add-stat-filter') demo.addStatFilter();
      else demo.restore();
      // 等官方重新渲染後重新標記詞綴，T 階按鈕才會出現或移除
      setTimeout(() => tagFilterDomElements(), 20);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    bridge.dispatchEvent(
      'poexd-page-guide-demo-result',
      serializePoePageGuideDemoResult({
        requestId: request.requestId,
        success: !error,
        ...(error ? { error } : {}),
      }),
    );
  });

  // 離開頁面前一定還原，避免官方把示範條件存進本機狀態
  const handlePageHide = () => demo.restore();
  window.addEventListener('pagehide', handlePageHide);

  return () => {
    demo.restore();
    unsubscribe();
    window.removeEventListener('pagehide', handlePageHide);
  };
}
