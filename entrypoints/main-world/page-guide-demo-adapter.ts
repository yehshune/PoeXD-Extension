import {
  parsePoePageGuideDemo,
  serializePoePageGuideDemoResult,
} from '@/utils/event-protocol-types';
import type { MainWorldBridge } from './bridge-bootstrap';
import type { HostFilterGroup } from './host-types';
import { mainWorldSearchForm, type MainWorldSearchForm } from './main-world-search-form';
import { readKnownStatIds } from './poe-runtime-reader';

/** 「+# 最大生命」：PoE1 與 PoE2 都有、而且一定有 T 階資料的常見詞綴 */
const PREFERRED_DEMO_STAT_ID = 'explicit.stat_3299347043';
/**
 * 示範詞綴綁定的物品類別（胸甲）：沒有類別時 T 階清單只會顯示「選擇物品類別」，看不到各階數值。
 * 只寫在這條示範詞綴的隱藏屬性上，不改官方的類別篩選，還原時跟著詞綴一起移除。
 */
export const DEMO_STAT_CATEGORY = 'body-armour';

export function pickDemoStatId(knownStatIds: readonly string[] | null): string | null {
  if (!knownStatIds || knownStatIds.length === 0) return PREFERRED_DEMO_STAT_ID;
  if (knownStatIds.includes(PREFERRED_DEMO_STAT_ID)) return PREFERRED_DEMO_STAT_ID;
  return knownStatIds.find((id) => id.startsWith('explicit.')) ?? null;
}

/**
 * 導覽用的示範狀態。篩選面板收起時先用官方 toggleSearch 展開；加入示範詞綴時只記錄推入的群組，
 * 還原時僅移除示範群組並收回面板（不動使用者既有詞綴與隱藏綁定屬性），也不呼叫官方 save()。
 * 表單寫入（含重新標記）都交給 MainWorldSearchForm。
 */
export function createPageGuideDemo(form: MainWorldSearchForm) {
  const addedGroups = new Set<HostFilterGroup>();
  let revealedFilters = false;

  const showFilters = () => {
    const toggled = form.setAdvancedSearchHidden(false);
    if (toggled === null) throw new Error('FORM_STATE_NOT_FOUND');
    if (toggled) revealedFilters = true;
  };

  const addStatFilter = () => {
    showFilters();
    const statId = pickDemoStatId(readKnownStatIds());
    if (!statId) throw new Error('DEMO_STAT_NOT_FOUND');
    const pushedGroup = form.addDemoStatGroup(statId, DEMO_STAT_CATEGORY);
    if (pushedGroup) addedGroups.add(pushedGroup);
  };

  const restore = () => {
    form.removeStatGroups(addedGroups);
    addedGroups.clear();
    if (revealedFilters) form.setAdvancedSearchHidden(true);
    revealedFilters = false;
  };

  return {
    showFilters,
    addStatFilter,
    restore,
    isActive: () => addedGroups.size > 0 || revealedFilters,
  };
}

export function initPageGuideDemoAdapter(bridge: MainWorldBridge) {
  const demo = createPageGuideDemo(mainWorldSearchForm);

  const unsubscribe = bridge.addListener('poexd-page-guide-demo', (detail) => {
    const request = parsePoePageGuideDemo(detail);
    if (!request) return;
    let error: string | undefined;
    try {
      if (request.action === 'show-filters') demo.showFilters();
      else if (request.action === 'add-stat-filter') demo.addStatFilter();
      else demo.restore();
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
