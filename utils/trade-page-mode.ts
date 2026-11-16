import { listenPoeEvent } from './event-contracts';
import type { TradePageRole } from './live-search-contract';

export type TradePageMode = 'search' | 'live';

const HISTORY_EVENT = 'poexd-history-changed';

export function getTradePageMode(
  pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '',
): TradePageMode {
  const path = typeof pathname === 'string' ? pathname : '';
  const parts = path.split('/').filter(Boolean);
  return parts.some((p) => p.toLowerCase() === 'live') ? 'live' : 'search';
}

export function isLiveOrConsoleTradePage(
  pageMode: TradePageMode,
  pageRole: TradePageRole = 'normal',
): boolean {
  if (pageMode === 'live' || pageRole === 'live-search-primary') {
    return true;
  }
  if (typeof window !== 'undefined' && getTradePageMode(window.location?.pathname) === 'live') {
    return true;
  }
  if (typeof document !== 'undefined') {
    const consoleEl = document.querySelector?.('.live-search-primary, [data-console-host]');
    const hasConsoleElement =
      consoleEl !== null &&
      consoleEl !== undefined &&
      (typeof consoleEl.matches !== 'function' ||
        consoleEl.matches('.live-search-primary, [data-console-host]'));
    if (
      document.documentElement?.getAttribute?.('data-poexd-console-result-only') === 'true' ||
      document.body?.getAttribute?.('data-poexd-page-role') === 'live-search-primary' ||
      document.body?.classList?.contains?.('live-search-primary') ||
      hasConsoleElement
    ) {
      return true;
    }
  }
  return false;
}

export function watchTradePageMode(listener: (mode: TradePageMode) => void) {
  let current = getTradePageMode();
  const update = () => {
    const next = getTradePageMode();
    if (next === current) return;
    current = next;
    listener(next);
  };
  const unlistenHistory = listenPoeEvent(HISTORY_EVENT, update);
  window.addEventListener('popstate', update);
  listener(current);
  return () => {
    unlistenHistory();
    window.removeEventListener('popstate', update);
  };
}
