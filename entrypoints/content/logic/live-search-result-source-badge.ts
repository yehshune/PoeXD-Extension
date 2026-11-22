/**
 * 主控台結果卡片來源標籤（Result Source Badge）
 *
 * 在 Live Search 主控台的每筆官方結果列（`.results .row[data-id]`）左下角留白區
 *（所有三種官方版型 Default / Compact / Compact Two 中 `.left` 寬度皆為 25%，左下角皆不與圖示、操作按鈕或報價列重疊）
 * 顯示命中的監聽來源名稱；點擊標籤可直接篩選／取消篩選該連線的結果。
 * - 只使用安全 DOM API（createElement / textContent），絕不使用 innerHTML。
 * - CSS 不含任何硬編碼 hex 色票，僅使用 rgba / currentColor 以相容官網深色版型。
 */

export const RESULT_SOURCE_BADGE_STYLE_ID = 'poexd-live-search-source-badge-style';
export const RESULT_SOURCE_BADGE_CLASS = 'poexd-live-source-badge';
const MAX_TRACKED_ITEMS = 2000;

export interface LiveSearchResultSourceBadgeOptions {
  document?: Document;
  resolveSourceName: (ownerKey: string) => string | undefined;
  onSelectOwner?: (ownerKey: string) => void;
  getFilterOwner?: () => string | null;
  formatTooltip?: (sourceName: string) => string;
}

export interface LiveSearchResultSourceBadge {
  record(itemId: string, ownerKey: string): void;
  syncAll(): void;
  clear(): void;
  dispose(): void;
}

const BADGE_CSS = `
.results .row[data-id] > .${RESULT_SOURCE_BADGE_CLASS} {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  height: 22px;
  max-width: calc(25% - 20px);
  margin: 0;
  padding: 0 8px 0 7px;
  border-radius: 2px;
  border: 1px solid rgba(160, 145, 118, 0.28);
  border-left: 2px solid rgba(196, 173, 130, 0.72);
  background: rgba(16, 18, 22, 0.88);
  color: rgba(218, 204, 178, 0.9);
  font-size: 11px;
  line-height: 20px;
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.results .row[data-id] > .${RESULT_SOURCE_BADGE_CLASS}:hover {
  background: rgba(34, 31, 26, 0.94);
  border-color: rgba(196, 173, 130, 0.55);
  border-left-color: rgba(224, 198, 148, 0.95);
  color: rgba(242, 232, 210, 0.98);
}
.results .row[data-id] > .${RESULT_SOURCE_BADGE_CLASS}[data-active="true"] {
  background: rgba(30, 58, 138, 0.38);
  border-color: rgba(96, 165, 250, 0.6);
  border-left-color: rgba(147, 197, 253, 0.98);
  color: rgba(219, 234, 254, 0.98);
}
.${RESULT_SOURCE_BADGE_CLASS}__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`.trim();

export function createLiveSearchResultSourceBadge(
  options: LiveSearchResultSourceBadgeOptions,
): LiveSearchResultSourceBadge {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const itemOwners = new Map<string, string>();
  let styleEl: HTMLStyleElement | null = null;
  let observer: MutationObserver | null = null;
  let syncScheduled = false;
  let disposed = false;

  const ensureStyle = () => {
    if (!doc || disposed) return;
    if (styleEl && styleEl.isConnected) return;
    const existing = doc.getElementById(RESULT_SOURCE_BADGE_STYLE_ID);
    if (existing && existing.tagName === 'STYLE') {
      styleEl = existing as HTMLStyleElement;
      return;
    }
    styleEl = doc.createElement('style');
    styleEl.id = RESULT_SOURCE_BADGE_STYLE_ID;
    styleEl.textContent = BADGE_CSS;
    (doc.head ?? doc.documentElement)?.appendChild(styleEl);
  };

  const stopObserver = () => {
    observer?.disconnect();
    observer = null;
  };

  const ensureObserver = () => {
    if (!doc || disposed || observer || itemOwners.size === 0) return;
    const ObserverCtor = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    if (typeof ObserverCtor !== 'function' || !doc.documentElement) return;
    observer = new ObserverCtor(() => {
      scheduleSync();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  };

  const stampRow = (row: Element, ownerKey: string, activeFilter: string | null) => {
    if (!doc) return;
    const sourceName = options.resolveSourceName(ownerKey)?.trim();
    if (!sourceName) return;

    let badge = row.querySelector<HTMLButtonElement>(`:scope > .${RESULT_SOURCE_BADGE_CLASS}`);
    if (!badge) {
      badge = doc.createElement('button');
      badge.type = 'button';
      badge.className = RESULT_SOURCE_BADGE_CLASS;
      const label = doc.createElement('span');
      label.className = `${RESULT_SOURCE_BADGE_CLASS}__label`;
      badge.appendChild(label);
      badge.addEventListener('click', (event) => {
        event.stopPropagation();
        const owner = badge?.getAttribute('data-poexd-source-owner');
        if (owner) options.onSelectOwner?.(owner);
      });
      row.appendChild(badge);
    }

    if (badge.getAttribute('data-poexd-source-owner') !== ownerKey) {
      badge.setAttribute('data-poexd-source-owner', ownerKey);
    }
    const labelEl = badge.querySelector(`.${RESULT_SOURCE_BADGE_CLASS}__label`);
    if (labelEl && labelEl.textContent !== sourceName) {
      labelEl.textContent = sourceName;
    }
    const tooltip = options.formatTooltip ? options.formatTooltip(sourceName) : sourceName;
    if (badge.getAttribute('title') !== tooltip) {
      badge.setAttribute('title', tooltip);
    }
    const isActive = activeFilter === ownerKey;
    if (isActive) {
      if (badge.getAttribute('data-active') !== 'true') {
        badge.setAttribute('data-active', 'true');
      }
    } else if (badge.hasAttribute('data-active')) {
      badge.removeAttribute('data-active');
    }
  };

  const syncAll = () => {
    if (!doc || typeof doc.querySelectorAll !== 'function' || disposed || itemOwners.size === 0) {
      return;
    }
    ensureStyle();
    const activeFilter = options.getFilterOwner?.() ?? null;
    const rows = doc.querySelectorAll('.results .row[data-id]');
    for (const row of Array.from(rows)) {
      const id = row.getAttribute('data-id')?.trim();
      if (!id) continue;
      const ownerKey = itemOwners.get(id);
      if (!ownerKey) continue;
      stampRow(row, ownerKey, activeFilter);
    }
  };

  const scheduleSync = () => {
    if (syncScheduled || disposed || itemOwners.size === 0) return;
    syncScheduled = true;
    queueMicrotask(() => {
      syncScheduled = false;
      syncAll();
    });
  };

  const removeBadgesFromDom = () => {
    if (!doc || typeof doc.querySelectorAll !== 'function') return;
    for (const badge of Array.from(doc.querySelectorAll(`.${RESULT_SOURCE_BADGE_CLASS}`))) {
      badge.remove();
    }
  };

  return {
    record(itemId: string, ownerKey: string) {
      if (disposed) return;
      const id = itemId.trim();
      const owner = ownerKey.trim();
      if (!id || !owner) return;
      itemOwners.delete(id);
      itemOwners.set(id, owner);
      while (itemOwners.size > MAX_TRACKED_ITEMS) {
        const oldest = itemOwners.keys().next().value;
        if (oldest === undefined) break;
        itemOwners.delete(oldest);
      }
      ensureObserver();
      scheduleSync();
    },

    syncAll() {
      syncAll();
    },

    clear() {
      itemOwners.clear();
      stopObserver();
      removeBadgesFromDom();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      itemOwners.clear();
      stopObserver();
      removeBadgesFromDom();
      styleEl?.remove();
      styleEl = null;
    },
  };
}
