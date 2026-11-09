// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCriteriaOverlaySession,
  createPoeEventCriteriaOverlayChannel,
  describeCriteriaOverlayReport,
  type CriteriaOverlayPageChannel,
} from '@/entrypoints/content/logic/criteria-overlay-session';
import {
  dispatchPoeEvent,
  initPoeEventNonce,
  listenPoeEvent,
  parsePoeCriteriaOverlayCommit,
  parsePoeCriteriaOverlayRead,
  serializePoeCriteriaOverlayCommitResult,
  serializePoeCriteriaOverlayReadResult,
} from '@/utils/event-contracts';
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
