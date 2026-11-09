/**
 * 主控台結果篩選（Result Filter）
 *
 * 記錄每筆已渲染結果（官方 `.row[data-id]`，即 itemData.id）屬於哪一條連線（canonical key），
 * 選定某連線後，以單一 <style> 規則隱藏其他連線的結果列。
 * - 不修改官方 Vuex state 與 DOM 節點，只注入樣式，取消篩選即完整還原。
 * - 記錄與官方展示區採用同一上限、同樣淘汰最舊者，因此記錄筆數即為展示區實際保留的筆數，
 *   可據以計算官方上方顯示的結果數（篩選時為該連線的筆數）。
 */

export const RESULT_FILTER_STYLE_ID = 'poexd-live-search-result-filter';
const DEFAULT_MAX_TRACKED = 2000;

export interface LiveSearchResultFilterOptions {
  document?: Document;
  maxTracked?: number;
}

export interface LiveSearchResultFilter {
  /**
   * 記錄一筆已渲染結果；`limit` 為展示上限，超過時淘汰最舊者。
   * `entryKey` 對應官方的一個結果批次（Result Token），預設與 itemId 相同。
   */
  record(itemId: string, ownerKey: string, limit?: number, entryKey?: string): void;
  /** 預估加入此筆結果後應顯示的總數（不修改狀態）。 */
  projectDisplayTotal(entryKey: string, ownerKey: string, limit?: number): number;
  /** 目前應顯示的總數：篩選中為該連線的筆數，否則為全部保留筆數。 */
  displayTotal(): number;
  setFilter(ownerKey: string | null): void;
  getFilter(): string | null;
  /** 各連線目前記錄的結果數 */
  countFor(ownerKey: string): number;
  clear(): void;
  dispose(): void;
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');
}

export interface ResultEntry {
  itemId: string;
  owner: string;
}

export function buildResultFilterCss(
  entries: Iterable<ResultEntry>,
  filterKey: string | null,
): string {
  if (!filterKey) return '';
  const hidden = new Set<string>();
  for (const { itemId, owner } of entries) {
    if (owner !== filterKey) hidden.add(`.row[data-id="${escapeAttributeValue(itemId)}"]`);
  }
  if (hidden.size === 0) return '';
  return `:is(${[...hidden].join(',')}){display:none !important;}`;
}

export function createLiveSearchResultFilter(
  options: LiveSearchResultFilterOptions = {},
): LiveSearchResultFilter {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const maxTracked = Math.max(1, options.maxTracked ?? DEFAULT_MAX_TRACKED);
  const entries = new Map<string, ResultEntry>();
  let filterKey: string | null = null;
  let styleEl: HTMLStyleElement | null = null;

  const render = () => {
    if (!doc) return;
    const css = buildResultFilterCss(entries.values(), filterKey);
    if (!css) {
      styleEl?.remove();
      styleEl = null;
      return;
    }
    if (!styleEl || !styleEl.isConnected) {
      styleEl = doc.createElement('style');
      styleEl.id = RESULT_FILTER_STYLE_ID;
      (doc.head ?? doc.documentElement).appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  };

  const effectiveLimit = (limit: number | undefined) =>
    typeof limit === 'number' && Number.isInteger(limit) && limit > 0
      ? Math.min(limit, maxTracked)
      : maxTracked;

  const countOwner = (ownerKey: string) => {
    let count = 0;
    for (const entry of entries.values()) if (entry.owner === ownerKey) count++;
    return count;
  };

  return {
    projectDisplayTotal(entryKey, ownerKey, limit) {
      const key = entryKey.trim();
      const owners = [...entries].filter(([k]) => k !== key).map(([, entry]) => entry.owner);
      owners.push(ownerKey);
      const kept = owners.slice(-effectiveLimit(limit));
      return filterKey ? kept.filter((owner) => owner === filterKey).length : kept.length;
    },
    displayTotal() {
      return filterKey ? countOwner(filterKey) : entries.size;
    },
    record(itemId, ownerKey, limit, entryKey) {
      const id = itemId.trim();
      const key = (entryKey ?? itemId).trim();
      if (!id || !key || !ownerKey) return;
      entries.delete(key);
      entries.set(key, { itemId: id, owner: ownerKey });
      const cap = effectiveLimit(limit);
      let evicted = false;
      while (entries.size > cap) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
        evicted = true;
      }
      if (filterKey && (ownerKey !== filterKey || evicted)) render();
    },
    setFilter(ownerKey) {
      const next = ownerKey || null;
      if (next === filterKey) return;
      filterKey = next;
      render();
    },
    getFilter() {
      return filterKey;
    },
    countFor(ownerKey) {
      return countOwner(ownerKey);
    },
    clear() {
      entries.clear();
      render();
    },
    dispose() {
      entries.clear();
      filterKey = null;
      styleEl?.remove();
      styleEl = null;
    },
  };
}
