// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ResultBoardRuntime,
  TRAVEL_REFRESH_TIMEOUT_MS,
} from '@/entrypoints/content/logic/result-board-runtime';
import {
  dispatchPoeEvent,
  listenPoeEvent,
  serializePoeFetchResponse,
} from '@/utils/event-contracts';
import {
  serializeFetchFailure,
  serializeSearchResultSummary,
  serializeWhisperOutcome,
} from '@/utils/result-board/board-events';
import { TradeResultCache } from '@/utils/trade-result-cache';

const SEARCH = 's1';

function officialPage(ids: string[], { loadMore = true } = {}) {
  document.body.innerHTML = `
    <div class="results">
      <div class="row row-total">Showing 100 results</div>
      <div class="resultset">
        ${ids
          .map(
            (id) =>
              `<div class="row" data-id="${id}"><div class="right"><button class="direct-btn">Travel</button></div></div>`,
          )
          .join('')}
      </div>
      ${loadMore ? '<button class="load-more-btn">Load more</button>' : ''}
    </div>`;
}

function fetchResponse(ids: string[], searchId = SEARCH) {
  return serializePoeFetchResponse({
    url: `https://www.pathofexile.com/api/trade/fetch/${ids.join(',')}?query=${searchId}`,
    data: {
      result: ids.map((id) => ({
        id,
        item: { typeLine: 'Ring', frameType: 2 },
        listing: {
          account: { name: 'Seller#1', online: { league: 'Std' } },
          price: { amount: 1, currency: 'chaos' },
          hideout_token: 't',
        },
      })),
    },
  });
}

/** 比照 runtime：先送事件，再把結果放進快取 */
function deliverFetch(cache: TradeResultCache, ids: string[], searchId = SEARCH) {
  const detail = fetchResponse(ids, searchId);
  dispatchPoeEvent('poexd-fetch-response', detail);
  cache.ingestFetchResponse(detail);
}

const summary = (resultCount: number, searchId = SEARCH) =>
  serializeSearchResultSummary({ searchId, total: 5000, resultCount, inexact: false });

describe('ResultBoardRuntime', () => {
  let cache: TradeResultCache;
  let runtime: ResultBoardRuntime;
  let now = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    cache = new TradeResultCache();
    officialPage(['a', 'b']);
    runtime = new ResultBoardRuntime(cache, document, () => now);
    runtime.setEnabled(true);
  });

  afterEach(() => {
    runtime.cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('follows the official search and fetch responses', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    deliverFetch(cache, ['a', 'b']);
    const state = runtime.session.getState();
    expect(state.searchId).toBe(SEARCH);
    expect(state.summary?.resultCount).toBe(20);
    expect(state.ledger.entries.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(runtime.isComplete()).toBe(false);
  });

  it('adopts the search from fetches when no search response was seen', () => {
    deliverFetch(cache, ['a'], 'late');
    expect(runtime.session.getState().searchId).toBe('late');
  });

  it('is complete once every listed result is retrieved, capped at 100', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(2));
    deliverFetch(cache, ['a', 'b']);
    expect(runtime.isComplete()).toBe(true);
  });

  it('falls back to the load more button when there is no summary', () => {
    expect(runtime.isComplete()).toBe(false);
    officialPage(['a'], { loadMore: false });
    expect(runtime.isComplete()).toBe(true);
  });

  it('loads the next batch through the official button', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const button = document.querySelector<HTMLButtonElement>('.load-more-btn')!;
    button.addEventListener('click', () => deliverFetch(cache, ['c']));
    expect(await runtime.loader.loadNext()).toBeUndefined();
    expect(runtime.session.getState().ledger.entries.map((entry) => entry.id)).toEqual(['c']);
  });

  it('stops loading all on an official rate limit', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const button = document.querySelector<HTMLButtonElement>('.load-more-btn')!;
    button.addEventListener('click', () =>
      dispatchPoeEvent('poexd-fetch-failed', serializeFetchFailure({ url: '/fetch', status: 429 })),
    );
    expect(await runtime.loader.loadAll()).toBe('rate-limited');
  });

  it('times out when the official page never answers', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const pending = runtime.loader.loadNext();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toBe('timeout');
  });

  it('reports no button when the official button is disabled', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    document.querySelector('.load-more-btn')!.setAttribute('disabled', '');
    expect(await runtime.loader.loadNext()).toBe('no-button');
  });

  it('locates and briefly highlights an official row', () => {
    const row = document.querySelector<HTMLElement>('[data-id="b"]')!;
    row.scrollIntoView = vi.fn();
    expect(runtime.locate('b')).toBe(true);
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(row.classList.contains('poexd-board-locate')).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(row.classList.contains('poexd-board-locate')).toBe(false);
    expect(runtime.locate('missing')).toBe(false);
  });

  it('travels through the official button and marks the result visited', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    await expect(runtime.travel('a')).resolves.toBe('travelled');
    expect(runtime.session.getState().marks).toEqual({ a: 'visited' });
    document.querySelector('[data-id="b"] .direct-btn')!.classList.add('disabled');
    await expect(runtime.travel('b')).resolves.toBe('unavailable');
    await expect(runtime.travel('missing')).resolves.toBe('unavailable');
  });

  /** 比照官方：連結過期時按鈕為 `expired disabled`，結果列上有「重新整理」 */
  function expire(id: string, onRefresh?: (row: HTMLElement, button: HTMLElement) => void) {
    const row = document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const button = row.querySelector<HTMLElement>('.direct-btn')!;
    button.classList.add('expired', 'disabled');
    button.setAttribute('disabled', '');
    const refresh = document.createElement('button');
    refresh.className = 'refresh';
    const clicks = vi.fn(() => {
      row.classList.add('refreshing');
      onRefresh?.(row, button);
    });
    refresh.addEventListener('click', clicks);
    row.prepend(refresh);
    return { row, button, refreshClicks: clicks };
  }

  const restore = (row: HTMLElement, button: HTMLElement) => () => {
    row.classList.remove('refreshing');
    button.classList.remove('expired', 'disabled');
    button.removeAttribute('disabled');
  };

  it('refreshes an expired result and then travels', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const travelClicks = vi.fn();
    const { refreshClicks } = expire('a', (row, button) => {
      button.addEventListener('click', travelClicks);
      setTimeout(restore(row, button), 350);
    });
    const onRefreshing = vi.fn();

    const outcome = runtime.travel('a', onRefreshing);
    expect(refreshClicks).toHaveBeenCalledTimes(1);
    expect(onRefreshing).toHaveBeenCalledTimes(1);
    expect(travelClicks).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);

    await expect(outcome).resolves.toBe('travelled');
    expect(travelClicks).toHaveBeenCalledTimes(1);
    expect(runtime.session.getState().marks).toEqual({ a: 'visited' });
  });

  it('waits for a refresh already in progress instead of sending another', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const { row, button, refreshClicks } = expire('a');
    row.classList.add('refreshing');
    setTimeout(restore(row, button), 200);

    const outcome = runtime.travel('a');
    await vi.advanceTimersByTimeAsync(300);
    await expect(outcome).resolves.toBe('travelled');
    expect(refreshClicks).not.toHaveBeenCalled();
  });

  it('gives up when the refresh never restores the button', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    expire('a', (row) => setTimeout(() => row.classList.remove('refreshing'), 300));

    const outcome = runtime.travel('a');
    await vi.advanceTimersByTimeAsync(TRAVEL_REFRESH_TIMEOUT_MS + 200);
    await expect(outcome).resolves.toBe('refresh-failed');
    expect(runtime.session.getState().marks).toEqual({});
  });

  it('gives up when the refreshed row disappears', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    expire('a', (row) => setTimeout(() => row.remove(), 300));

    const outcome = runtime.travel('a');
    await vi.advanceTimersByTimeAsync(500);
    await expect(outcome).resolves.toBe('refresh-failed');
  });

  it('does not refresh an expired result while loading more', async () => {
    officialPage(['a', 'b']);
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    deliverFetch(cache, ['a', 'b']);
    const { refreshClicks } = expire('a');
    void runtime.loader.loadAll();
    expect(runtime.loader.getState().running).toBe(true);

    await expect(runtime.travel('a')).resolves.toBe('busy');
    expect(refreshClicks).not.toHaveBeenCalled();
    runtime.loader.stop();
  });

  it('marks a result sold when the official whisper says it is gone', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    document.querySelector<HTMLElement>('[data-id="a"] .direct-btn')!.click();
    dispatchPoeEvent('poexd-whisper-outcome', serializeWhisperOutcome({ status: 404, code: 1 }));
    expect(runtime.session.getState().marks).toEqual({ a: 'sold' });
  });

  it('ignores whisper outcomes that are late, unrelated or successful', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    dispatchPoeEvent('poexd-whisper-outcome', serializeWhisperOutcome({ status: 404, code: 1 }));
    document.querySelector<HTMLElement>('[data-id="a"] .direct-btn')!.click();
    now = 30_000;
    dispatchPoeEvent('poexd-whisper-outcome', serializeWhisperOutcome({ status: 404, code: 1 }));
    document.querySelector<HTMLElement>('[data-id="b"] .direct-btn')!.click();
    dispatchPoeEvent('poexd-whisper-outcome', serializeWhisperOutcome({ status: 200 }));
    expect(runtime.session.getState().marks).toEqual({ a: 'visited', b: 'visited' });
  });

  it('adds a shortcut beside the result count that opens the board', () => {
    const opened = vi.fn();
    const stop = listenPoeEvent('poexd-open-result-board', opened);
    const shortcut = document.querySelector<HTMLButtonElement>('.row-total .poexd-board-shortcut');
    expect(shortcut).not.toBeNull();
    expect(shortcut!.style.getPropertyValue('--poexd-board-shortcut-right')).toBe('8px');
    runtime.ensureShortcut();
    expect(document.querySelectorAll('.poexd-board-shortcut')).toHaveLength(1);
    shortcut!.click();
    expect(opened).toHaveBeenCalledTimes(1);
    stop();
  });

  it('offsets the shortcut to the left of official layout buttons and syncs native button metrics', () => {
    const rowTotal = document.querySelector<HTMLElement>('.row.row-total')!;
    const shortcut = rowTotal.querySelector<HTMLButtonElement>('.poexd-board-shortcut')!;
    const offsets = [1039, 1077, 1115];
    for (const left of offsets) {
      const btn = document.createElement('button');
      btn.className = 'layout-btn';
      Object.defineProperty(btn, 'offsetHeight', { value: 30, configurable: true });
      Object.defineProperty(btn, 'offsetTop', { value: 2, configurable: true });
      Object.defineProperty(btn, 'offsetLeft', { value: left, configurable: true });
      rowTotal.appendChild(btn);
    }

    // 未排版（clientWidth === 0）時依按鈕數量推算右距：8 + 3 * 38 = 122px
    runtime.ensureShortcut();
    expect(shortcut.style.getPropertyValue('--poexd-board-shortcut-right')).toBe('122px');

    // 有實際寬度時以最左顆 layout-btn 的位置與高度同步
    Object.defineProperty(rowTotal, 'clientWidth', { value: 1153, configurable: true });
    runtime.ensureShortcut();
    expect(shortcut.style.getPropertyValue('--poexd-native-btn-size')).toBe('30px');
    expect(shortcut.style.getPropertyValue('--poexd-native-btn-top')).toBe('2px');
    expect(shortcut.style.getPropertyValue('--poexd-board-shortcut-right')).toBe('122px');

    const styleText = document.getElementById('poexd-result-board-style')?.textContent ?? '';
    expect(styleText).toContain('position: absolute;');
    expect(styleText).toContain('FontinSmallcaps');
    expect(styleText).toContain('border-radius: 0;');
  });

  it('removes everything it added when disabled and stops listening', () => {
    runtime.setEnabled(false);
    expect(document.querySelector('.poexd-board-shortcut')).toBeNull();
    expect(document.getElementById('poexd-result-board-style')).toBeNull();
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    expect(runtime.session.getState().searchId).toBe('');
    expect(runtime.isEnabled()).toBe(false);
  });

  it('resets the loader when a new search arrives', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(0));
    await runtime.loader.loadAll();
    expect(runtime.loader.getState().lastStop).toBe('complete');
    dispatchPoeEvent('poexd-search-result-summary', summary(20, 's2'));
    expect(runtime.loader.getState()).toEqual({ running: false });
  });

  it('matches whisper outcomes to travel clicks in order', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    document.querySelector<HTMLElement>('[data-id="a"] .direct-btn')!.click();
    document.querySelector<HTMLElement>('[data-id="b"] .direct-btn')!.click();
    dispatchPoeEvent('poexd-whisper-outcome', serializeWhisperOutcome({ status: 404, code: 1 }));
    expect(runtime.session.getState().marks).toEqual({ a: 'sold', b: 'visited' });
    dispatchPoeEvent('poexd-whisper-outcome', serializeWhisperOutcome({ status: 404, code: 1 }));
    expect(runtime.session.getState().marks).toEqual({ a: 'sold', b: 'sold' });
  });

  it('ignores a late fetch from a previous search', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20, 's2'));
    document.querySelector<HTMLElement>('[data-id="a"] .direct-btn')!.click();
    deliverFetch(cache, ['old'], SEARCH);
    const state = runtime.session.getState();
    expect(state.searchId).toBe('s2');
    expect(state.summary?.resultCount).toBe(20);
    expect(state.marks).toEqual({ a: 'visited' });
  });

  it('counts delisted results the official fetch returned as null', () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(3));
    const detail = serializePoeFetchResponse({
      url: `https://www.pathofexile.com/api/trade/fetch/a,b,gone?query=${SEARCH}`,
      data: { result: [...JSON.parse(fetchResponse(['a', 'b'])).data.result, null] },
    });
    dispatchPoeEvent('poexd-fetch-response', detail);
    cache.ingestFetchResponse(detail);
    expect(runtime.session.getState().ledger.skippedIds).toEqual(['gone']);
    expect(runtime.isComplete()).toBe(true);
  });

  it('finishes a batch on the fetch response even if the cache adds nothing', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const button = document.querySelector<HTMLButtonElement>('.load-more-btn')!;
    button.addEventListener('click', () =>
      dispatchPoeEvent('poexd-fetch-response', fetchResponse([])),
    );
    expect(await runtime.loader.loadNext()).toBeUndefined();
  });

  it('clears the stop reason when disabled mid-load', async () => {
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    const pending = runtime.loader.loadNext();
    runtime.setEnabled(false);
    await pending;
    expect(runtime.loader.getState()).toEqual({ running: false });
  });

  it('learns currency icons from the official rows after a fetch', async () => {
    const icon = 'https://web.poecdn.com/image/Art/chaos.png';
    document
      .querySelector('[data-id="a"]')!
      .insertAdjacentHTML(
        'beforeend',
        `<div class="price"><span class="currency-image"><img src="${icon}"><span>Chaos Orb</span></span></div>`,
      );
    document
      .querySelector('[data-id="b"]')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="price"><span class="currency-image"><img src="https://evil.example/x.png"></span></div>',
      );
    dispatchPoeEvent('poexd-search-result-summary', summary(20));
    deliverFetch(cache, ['a', 'b']);
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.session.getState().currencies).toEqual({ chaos: { icon, name: 'Chaos Orb' } });
  });
});
