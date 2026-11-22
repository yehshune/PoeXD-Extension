/**
 * 主控台結果卡片來源標籤（Result Source Badge）
 *
 * 在 Live Search 主控台的每筆官方結果列（`.results .row[data-id]`）右側資訊欄頂端
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
.${RESULT_SOURCE_BADGE_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  margin: 0 0 4px 0;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(196, 173, 130, 0.35);
  background: rgba(196, 173, 130, 0.1);
  color: rgba(235, 222, 194, 0.92);
  font-size: 11px;
  line-height: 1.35;
  font-weight: 500;
  cursor: pointer;
  vertical-align: middle;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.${RESULT_SOURCE_BADGE_CLASS}:hover {
  background: rgba(196, 173, 130, 0.2);
  border-color: rgba(196, 173, 130, 0.6);
}
.${RESULT_SOURCE_BADGE_CLASS}[data-active="true"] {
  background: rgba(96, 165, 250, 0.2);
  border-color: rgba(96, 165, 250, 0.65);
  color: rgba(219, 234, 254, 0.98);
}
.${RESULT_SOURCE_BADGE_CLASS}__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.8;
  flex-shrink: 0;
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

    const target = row.querySelector('.right .details') ?? row.querySelector('.right') ?? row;
    let badge = target.querySelector<HTMLButtonElement>(`:scope > .${RESULT_SOURCE_BADGE_CLASS}`);
    if (!badge) {
      badge = doc.createElement('button');
      badge.type = 'button';
      badge.className = RESULT_SOURCE_BADGE_CLASS;
      const dot = doc.createElement('span');
      dot.className = `${RESULT_SOURCE_BADGE_CLASS}__dot`;
      dot.setAttribute('aria-hidden', 'true');
      const label = doc.createElement('span');
      label.className = `${RESULT_SOURCE_BADGE_CLASS}__label`;
      badge.append(dot, label);
      badge.addEventListener('click', (event) => {
        event.stopPropagation();
        const owner = badge?.getAttribute('data-poexd-source-owner');
        if (owner) options.onSelectOwner?.(owner);
      });
      target.prepend(badge);
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
