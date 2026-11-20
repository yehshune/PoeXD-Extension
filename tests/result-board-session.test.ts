import { describe, expect, it, vi } from 'vitest';
import { ResultBoardSession } from '@/utils/result-board/board-session';
import type { TradeResultEntry } from '@/utils/trade-result-cache';
import { rawResult } from './helpers/result-board-fixtures';

function setup(initial: TradeResultEntry[] = []) {
  let entries = initial;
  // 固定時鐘 0：fixture 的結果都算這次搜尋之後取得
  const session = new ResultBoardSession(
    (searchId) => entries.filter((entry) => entry.sourceSearchId === searchId),
    () => 0,
  );
  return {
    session,
    setEntries: (next: TradeResultEntry[]) => {
      entries = next;
    },
  };
}

const summary = (searchId: string, resultCount = 100) => ({
  searchId,
  total: 5000,
  resultCount,
  inexact: false,
});

describe('ResultBoardSession', () => {
  it('starts empty, adopts a search summary and fills from fetches', () => {
    const { session } = setup([rawResult({ id: 'a', searchId: 's1' })]);
    expect(session.getState().searchId).toBe('');
    session.setSummary(summary('s1'));
    expect(session.getState().ledger.entries).toEqual([]);
    session.observeFetch('s1');
    const state = session.getState();
    expect(state.summary?.resultCount).toBe(100);
    expect(state.ledger.entries.map((entry) => entry.id)).toEqual(['a']);
  });

  it('adds new results for the current search when fetches arrive', () => {
    const { session, setEntries } = setup([rawResult({ id: 'a' })]);
    session.setSummary(summary('search-1'));
    setEntries([
      rawResult({ id: 'a' }),
      rawResult({ id: 'b' }),
      rawResult({ id: 'x', searchId: 'other' }),
    ]);
    session.observeFetch('search-1');
    expect(session.getState().ledger.entries.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('switches search from a fetch when no search response was seen', () => {
    const { session } = setup([rawResult({ id: 'a', searchId: 's2' })]);
    session.observeFetch('s2');
    expect(session.getState().searchId).toBe('s2');
    expect(session.getState().summary).toBeUndefined();
    session.observeFetch(undefined);
    expect(session.getState().searchId).toBe('s2');
  });

  it('starts over on every search response, even with the same search id', () => {
    const { session } = setup();
    session.setSummary(summary('s1'));
    session.hideSeller('A#1');
    session.markVisited('a');
    session.observeFetch('s1');
    expect(session.getState().hiddenAccounts.has('A#1')).toBe(true);
    session.setSummary({ ...summary('s1'), total: 6000 });
    expect(session.getState().hiddenAccounts.size).toBe(0);
    expect(session.getState().marks).toEqual({});
    expect(session.getState().summary?.total).toBe(6000);
  });

  it('ignores cached results from an earlier run of the same search', () => {
    let now = 100;
    const entries = [
      { ...rawResult({ id: 'old', searchId: 's1' }), receivedAt: 50 },
      { ...rawResult({ id: 'new', searchId: 's1' }), receivedAt: 150 },
    ];
    const session = new ResultBoardSession(
      (searchId) => entries.filter((entry) => entry.sourceSearchId === searchId),
      () => now,
    );
    session.setSummary(summary('s1'));
    now = 200;
    session.observeFetch('s1');
    expect(session.getState().ledger.entries.map((entry) => entry.id)).toEqual(['new']);
  });

  it('hides and shows sellers', () => {
    const { session } = setup();
    session.setSummary(summary('s1'));
    session.hideSeller('A#1');
    session.hideSeller('B#2');
    session.showSeller('A#1');
    expect([...session.getState().hiddenAccounts]).toEqual(['B#2']);
    session.showAllSellers();
    expect(session.getState().hiddenAccounts.size).toBe(0);
  });

  it('never turns a sold mark back into visited', () => {
    const { session } = setup();
    session.setSummary(summary('s1'));
    session.markVisited('a');
    session.markSold('a');
    session.markVisited('a');
    session.markSold('b');
    expect(session.getState().marks).toEqual({ a: 'sold', b: 'sold' });
  });

  it('notifies only on real changes and stops after unsubscribing', () => {
    const { session } = setup();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.setSummary(summary('s1'));
    session.showSeller('nobody');
    session.showAllSellers();
    session.markSold('a');
    session.markSold('a');
    session.observeFetch('s1');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    session.markVisited('b');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores fetches from another search once a summary is known', () => {
    const { session, setEntries } = setup();
    session.setSummary(summary('s2'));
    setEntries([rawResult({ id: 'old', searchId: 's1' })]);
    session.observeFetch('s1');
    expect(session.getState().searchId).toBe('s2');
    expect(session.isStale('s1')).toBe(true);
    expect(session.isStale('s2')).toBe(false);
  });

  it('records delisted results as skipped for the current search only', () => {
    const { session } = setup([rawResult({ id: 'a', searchId: 's1' })]);
    session.setSummary(summary('s1'));
    session.observeFetch('s1');
    session.skipMissing('s1', ['a', 'gone', 'gone']);
    session.skipMissing('other', ['x']);
    session.skipMissing('s1', []);
    expect(session.getState().ledger.skippedIds).toEqual(['gone']);
  });

  it('keeps notifying other listeners when one throws', () => {
    const { session } = setup();
    const listener = vi.fn();
    session.subscribe(() => {
      throw new Error('boom');
    });
    session.subscribe(listener);
    session.setSummary(summary('s1'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
