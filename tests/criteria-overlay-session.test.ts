// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCriteriaOverlaySession,
  createPoeEventCriteriaOverlayChannel,
  CriteriaOverlaySyncError,
  describeCriteriaOverlayReport,
  syncSearchFormToUrl,
  type CriteriaOverlayPageChannel,
} from '@/entrypoints/content/logic/criteria-overlay-session';
import {
  dispatchPoeEvent,
  initPoeEventNonce,
  listenPoeEvent,
  parsePoeCriteriaOverlayCommit,
  parsePoeCriteriaOverlayRead,
  parsePoeCriteriaOverlaySync,
  serializePoeCriteriaOverlayCommitResult,
  serializePoeCriteriaOverlayReadResult,
  serializePoeCriteriaOverlaySyncResult,
} from '@/utils/event-contracts';
import { t } from '@/utils/i18n';
import { isTradeSearchFormUrl } from '@/utils/trade-search-identity';
import type { OverlayCriteria } from '@/utils/criteria-overlay';

const snapshot = {
  name: null,
  type: null,
  disc: null,
  term: null,
  status: 'securable',
  filters: {},
  stats: [{ type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 1 } }] }],
};

const preset: OverlayCriteria = {
  statGroups: [{ type: 'and', filters: [{ id: 'explicit.stat_2' }] }],
  fields: [{ section: 'misc_filters', field: 'corrupted', value: { option: 'false' } }],
  sectionDisabled: {},
};

function fakeChannel(): CriteriaOverlayPageChannel & { commits: unknown[][] } {
  const commits: unknown[][] = [];
  return {
    commits,
    read: vi.fn(async () => ({ snapshot, knownStatIds: null })),
    commit: vi.fn(async (ops) => {
      commits.push([...ops]);
    }),
  };
}

describe('createCriteriaOverlaySession', () => {
  it('captures the current form as criteria', async () => {
    const session = createCriteriaOverlaySession(fakeChannel());
    const criteria = await session.capture();
    expect(criteria.status).toBe('securable');
    expect(criteria.statGroups).toHaveLength(1);
  });

  it('applies a preset, then undoes it exactly once', async () => {
    const channel = fakeChannel();
    const session = createCriteriaOverlaySession(channel);
    const undoStates: boolean[] = [];
    session.subscribeUndo((v) => undoStates.push(v));

    const report = await session.apply(preset);
    expect(report.addedStatGroups).toBe(1);
    expect(channel.commits[0]).toContainEqual({
      kind: 'pushStatGroup',
      type: 'and',
      filters: [{ id: 'explicit.stat_2' }],
    });
    expect(session.canUndo()).toBe(true);

    expect(await session.undo()).toBe(true);
    expect(channel.commits[1]).toEqual([
      { kind: 'removeStatGroup', group: 1 },
      { kind: 'setPropertyFilter', group: 'misc_filters', index: 'corrupted', value: null },
    ]);
    expect(await session.undo()).toBe(false);
    expect(undoStates).toEqual([false, true, false]);
  });

  it('refuses to undo once the form changed after applying', async () => {
    const channel = fakeChannel();
    const session = createCriteriaOverlaySession(channel);
    await session.apply(preset);
    expect(session.canUndo()).toBe(true);

    vi.mocked(channel.read).mockResolvedValue({
      snapshot: { ...snapshot, status: 'online' },
      knownStatIds: null,
    });
    await expect(session.undo()).rejects.toThrow('無法復原');
    expect(channel.commits).toHaveLength(1);
    expect(session.canUndo()).toBe(false);
  });

  it('does not commit or replace the undo when nothing changes', async () => {
    const channel = fakeChannel();
    const session = createCriteriaOverlaySession(channel);
    const report = await session.apply({ statGroups: [], fields: [], sectionDisabled: {} });
    expect(channel.commit).not.toHaveBeenCalled();
    expect(report.addedStatGroups).toBe(0);
    expect(session.canUndo()).toBe(false);
  });
});

describe('createPoeEventCriteriaOverlayChannel', () => {
  beforeEach(() => initPoeEventNonce('nonce-1'));

  it('round-trips read and commit requests over page events', async () => {
    const stopRead = listenPoeEvent('poexd-criteria-overlay-read', (detail) => {
      const request = parsePoeCriteriaOverlayRead(detail)!;
      dispatchPoeEvent(
        'poexd-criteria-overlay-read-result',
        serializePoeCriteriaOverlayReadResult({
          requestId: request.requestId,
          snapshot,
          knownStatIds: ['explicit.stat_1'],
        }),
      );
    });
    const stopCommit = listenPoeEvent('poexd-criteria-overlay-commit', (detail) => {
      const request = parsePoeCriteriaOverlayCommit(detail)!;
      dispatchPoeEvent(
        'poexd-criteria-overlay-commit-result',
        serializePoeCriteriaOverlayCommitResult({
          requestId: request.requestId,
          success: false,
          error: 'boom',
        }),
      );
    });

    const channel = createPoeEventCriteriaOverlayChannel(500);
    const read = await channel.read();
    expect(read.snapshot).toEqual(snapshot);
    expect(read.knownStatIds?.has('explicit.stat_1')).toBe(true);
    await expect(channel.commit([{ kind: 'setStatus', status: 'online' }])).rejects.toThrow('boom');

    stopRead();
    stopCommit();
  });

  it('rejects when the main world does not answer', async () => {
    const channel = createPoeEventCriteriaOverlayChannel(10);
    await expect(channel.read()).rejects.toThrow('沒有回應');
  });
});

describe('describeCriteriaOverlayReport', () => {
  it('summarizes changes and skips', () => {
    expect(
      describeCriteriaOverlayReport('純淨基底', {
        addedStatGroups: 1,
        skippedDuplicateStatGroups: 1,
        skippedUnknownStatFilters: 2,
        changedFields: 2,
        changedItem: false,
        changedStatus: true,
      }),
    ).toBe(
      '已套用「純淨基底」：新增 1 個詞綴群組、設定 2 個篩選欄位、設定上架狀態；略過 1 個重複群組、2 條已不存在的詞綴',
    );
  });
});

describe('channel.syncToUrl', () => {
  beforeEach(() => initPoeEventNonce('nonce-1'));

  function answerSync(reply: Record<string, unknown>) {
    return listenPoeEvent('poexd-criteria-overlay-sync', (detail) => {
      const request = parsePoeCriteriaOverlaySync(detail)!;
      dispatchPoeEvent(
        'poexd-criteria-overlay-sync-result',
        serializePoeCriteriaOverlaySyncResult({ requestId: request.requestId, ...reply } as any),
      );
    });
  }

  it('returns the URL the main world reports after saving', async () => {
    const stop = answerSync({
      success: true,
      url: 'https://www.pathofexile.com/trade/search/S/new',
    });
    await expect(createPoeEventCriteriaOverlayChannel(500).syncToUrl()).resolves.toBe(
      'https://www.pathofexile.com/trade/search/S/new',
    );
    stop();
  });

  it('translates main-world error codes and keeps the diagnostics', async () => {
    const stop = answerSync({
      success: false,
      error: 'PAGE_NOT_LOADED',
      diagnostics: { loaded: false, rootFound: true },
    });
    const error = await createPoeEventCriteriaOverlayChannel(500)
      .syncToUrl()
      .catch((e) => e);
    expect(error).toBeInstanceOf(CriteriaOverlaySyncError);
    expect(error.message).toBe(t('criteriaOverlay.session.pageNotLoaded'));
    expect(error.code).toBe('PAGE_NOT_LOADED');
    expect(error.diagnostics).toEqual({ loaded: false, rootFound: true });
    stop();
  });

  it('reports NO_RESPONSE when the main world never answers', async () => {
    const error = await createPoeEventCriteriaOverlayChannel(10)
      .syncToUrl()
      .catch((e) => e);
    expect(error.code).toBe('NO_RESPONSE');
    expect(error.message).toBe(t('criteriaOverlay.session.noResponse'));
  });
});

describe('syncSearchFormToUrl', () => {
  const SEARCH_URL = 'https://www.pathofexile.com/trade/search/Standard/old';
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('returns the synced URL from the channel', async () => {
    const syncToUrl = vi.fn(async () => 'https://www.pathofexile.com/trade/search/Standard/new');
    await expect(
      syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => SEARCH_URL }),
    ).resolves.toBe('https://www.pathofexile.com/trade/search/Standard/new');
    expect(syncToUrl).toHaveBeenCalledOnce();
  });

  it('skips the write-through on non-search routes', async () => {
    const syncToUrl = vi.fn(async () => 'unused');
    const url = 'https://www.pathofexile.com/trade/exchange/Standard/x';
    await expect(syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => url })).resolves.toBe(
      url,
    );
    expect(syncToUrl).not.toHaveBeenCalled();
  });

  it('rejects with the actual reason and logs code, route and diagnostics without the query', async () => {
    const syncToUrl = vi.fn(async () => {
      throw new CriteriaOverlaySyncError('官方頁面尚未載入完成', 'PAGE_NOT_LOADED', {
        loaded: false,
      });
    });
    await expect(
      syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => SEARCH_URL }),
    ).rejects.toThrow(t('formUrlSync.failed', { reason: '官方頁面尚未載入完成' }));
    const logged = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(logged).toMatchObject({ code: 'PAGE_NOT_LOADED', route: 'trade/search', loaded: false });
    expect(JSON.stringify(logged)).not.toContain('Standard/old');
  });

  it('falls back to a refresh hint when the failure has no message', async () => {
    const syncToUrl = vi.fn(async () => {
      throw new Error('');
    });
    await expect(
      syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => SEARCH_URL }),
    ).rejects.toThrow(t('formUrlSync.failed', { reason: t('formUrlSync.unknownReason') }));
  });
});

describe('isTradeSearchFormUrl', () => {
  it('only treats official search routes as having a writable form', () => {
    expect(isTradeSearchFormUrl('https://www.pathofexile.com/trade/search/Standard/x')).toBe(true);
    expect(isTradeSearchFormUrl('https://www.pathofexile.com/trade2/search/poe2/Standard/x')).toBe(
      true,
    );
    expect(isTradeSearchFormUrl('https://www.pathofexile.com/trade/exchange/Standard/x')).toBe(
      false,
    );
  });
});
