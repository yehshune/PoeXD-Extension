import { listenPoeEvent } from './event-contracts';

export type TradePageMode = 'search' | 'live';

const HISTORY_EVENT = 'poexd-history-changed';

export function getTradePageMode(
  pathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '',
): TradePageMode {
  const path = typeof pathname === 'string' ? pathname : '';
  const parts = path.split('/').filter(Boolean);
  return parts.some((p) => p.toLowerCase() === 'live') ? 'live' : 'search';
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
