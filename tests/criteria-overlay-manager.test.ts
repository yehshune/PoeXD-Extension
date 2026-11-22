// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryPreferencesStorage } from '@/utils/preferences';
import type {
  CriteriaOverlayOp,
  CriteriaOverlayStatGroup,
  OverlayCriteria,
} from '@/utils/criteria-overlay';
import {
  CriteriaOverlaySyncError,
  STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH,
  STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
  createCriteriaOverlayManager,
  createPoeEventCriteriaOverlayChannel,
  describeCriteriaOverlayReport,
  filterTemplates,
  parseStatGroupTemplateTransfer,
  serializeStatGroupTemplates,
  statGroupTemplateStorageKey,
  syncSearchFormToUrl,
  type CriteriaOverlayPageChannel,
  type StatGroupTemplate,
} from '@/components/injected/criteria-overlay-manager';
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

const groups: CriteriaOverlayStatGroup[] = [
  { type: 'and', filters: [{ id: 'explicit.a', value: { min: 1 } }] },
  { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.b' }] },
];

const formCriteria: OverlayCriteria = {
  status: 'online',
  statGroups: groups,
  fields: [{ section: 'type_filters', field: 'rarity', value: { option: 'rare' } }],
  sectionDisabled: {},
};

const defaultFormSnapshot = {
  name: null,
  type: null,
  disc: null,
  term: null,
  status: 'securable',
  filters: {},
  stats: [
    { type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 1 } }] },
    { type: 'count', value: { min: 2 }, filters: [{ id: 'explicit.stat_2' }] },
  ],
};

function createFakeChannel(
  initialSnapshot: Record<string, unknown> = defaultFormSnapshot,
): CriteriaOverlayPageChannel & {
  commits: CriteriaOverlayOp[][];
  setSnapshot(next: Record<string, unknown>): void;
} {
  let currentSnapshot = JSON.parse(JSON.stringify(initialSnapshot)) as Record<string, unknown>;
  const commits: CriteriaOverlayOp[][] = [];
  return {
    commits,
    setSnapshot(next) {
      currentSnapshot = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
    },
    read: vi.fn(async () => ({ snapshot: currentSnapshot, knownStatIds: null })),
    commit: vi.fn(async (ops) => {
      commits.push([...ops]);
    }),
  };
}

async function setup(
  options: {
    version?: 'poe1' | 'poe2';
    initialStorage?: Record<string, unknown>;
    seedTemplates?: boolean;
    snapshot?: Record<string, unknown>;
    confirmResult?: boolean;
  } = {},
) {
  const version = options.version ?? 'poe1';
  const key = statGroupTemplateStorageKey(version);
  const seed =
    options.seedTemplates === false
      ? {}
      : {
          [key]: [
            { id: 't1', name: 'A', statGroups: groups, createdAt: 1, updatedAt: 1 },
            { id: 't2', name: 'B', statGroups: groups, createdAt: 2, updatedAt: 2 },
          ],
        };
  const storage = createInMemoryPreferencesStorage(options.initialStorage ?? seed);
  let id = 2;
  let time = 1000;
  const channel = createFakeChannel(options.snapshot);
  const notify = vi.fn();
  const manager = createCriteriaOverlayManager({
    version,
    channel,
    storage,
    createId: () => `t${++id}`,
    now: () => ++time,
    notify,
    confirm: async () => options.confirmResult ?? true,
    loadDictionaries: async () => {},
  });
  await manager.start();
  return { manager, storage, channel, notify };
}

const names = (templates: readonly StatGroupTemplate[]) => templates.map((item) => item.name);

describe('filterTemplates', () => {
  it('matches name and stat lines case-insensitively and returns everything for a blank query', () => {
    const templates = [
      { name: 'Life Res', statGroups: [{ type: 'and', filters: [{ id: 'explicit.stat_life' }] }] },
      { name: '移速', statGroups: [{ type: 'and', filters: [{ id: 'explicit.stat_ms' }] }] },
    ] as StatGroupTemplate[];
    expect(filterTemplates(templates, '  ')).toBe(templates);
    expect(names(filterTemplates(templates, 'res'))).toEqual(['Life Res']);
    expect(names(filterTemplates(templates, 'stat_ms'))).toEqual(['移速']);
  });
});

describe('createCriteriaOverlayManager — Criteria Overlay & Undo', () => {
  it('overlays a template as stat groups only', async () => {
    const { manager, channel, notify } = await setup();
    await manager.applyTemplate(manager.templates.value[0]);
    expect(channel.commits).toHaveLength(1);
    expect(channel.commits[0]).toEqual([
      {
        kind: 'pushStatGroup',
        type: 'and',
        filters: [{ id: 'explicit.a', value: { min: 1 } }],
      },
      {
        kind: 'pushStatGroup',
        type: 'count',
        filters: [{ id: 'explicit.b' }],
      },
      {
        kind: 'setStatGroupValue',
        group: 3,
        value: { min: 1 },
      },
    ]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('A'), 'success');
  });

  it('overlays arbitrary criteria from a Search Preview, then undoes it exactly once', async () => {
    const { manager, channel, notify } = await setup();
    expect(manager.canUndo.value).toBe(false);

    const applied = await manager.overlay(formCriteria, '書籤');
    expect(applied).toBe(true);
    expect(manager.canUndo.value).toBe(true);
    expect(channel.commits[0]).toContainEqual({
      kind: 'pushStatGroup',
      type: 'and',
      filters: [{ id: 'explicit.a', value: { min: 1 } }],
    });

    await manager.undo();
    expect(manager.canUndo.value).toBe(false);
    expect(channel.commits).toHaveLength(2);
    expect(notify).toHaveBeenLastCalledWith(t('statGroupTemplate.toast.undone'), 'success');

    await manager.undo();
    expect(channel.commits).toHaveLength(2);
  });

  it('refuses to undo and clears undo state once the form changed after applying', async () => {
    const { manager, channel, notify } = await setup();
    await manager.overlay(formCriteria, '書籤');
    expect(manager.canUndo.value).toBe(true);

    channel.setSnapshot({ ...defaultFormSnapshot, status: 'any' });
    await manager.undo();
    expect(channel.commits).toHaveLength(1);
    expect(manager.canUndo.value).toBe(false);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('無法復原'), 'error');
  });

  it('refuses an empty overlay without touching the page and does not commit when nothing changes', async () => {
    const { manager, channel, notify } = await setup();
    const applied = await manager.overlay(
      { statGroups: [], fields: [], sectionDisabled: {} },
      '空',
    );
    expect(applied).toBe(false);
    expect(channel.commit).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');

    // Overlaying a duplicate stat group already on the form produces 0 ops and leaves canUndo false
    await manager.overlay(
      {
        statGroups: [{ type: 'and', filters: [{ id: 'explicit.stat_1', value: { min: 1 } }] }],
        fields: [],
        sectionDisabled: {},
      },
      '重複群組',
    );
    expect(channel.commit).not.toHaveBeenCalled();
    expect(manager.canUndo.value).toBe(false);
  });

  it('supports replaceStatGroup, updateStatGroup and readFormSnapshot', async () => {
    const { manager, channel, notify } = await setup();
    expect(await manager.readFormSnapshot()).toEqual(defaultFormSnapshot);

    const replaced = await manager.replaceStatGroup(
      0,
      [{ type: 'not', filters: [{ id: 'explicit.replaced' }] }],
      '傭兵',
    );
    expect(replaced).toBe(true);
    expect(manager.canUndo.value).toBe(true);

    const updated = await manager.updateStatGroup(
      1,
      [{ id: 'explicit.updated', value: { min: 3 } }],
      '傭兵',
      { min: 1 },
    );
    expect(updated).toBe(true);
    expect(channel.commits).toHaveLength(2);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('傭兵'), 'success');
  });

  it('surfaces channel errors as toasts instead of throwing', async () => {
    const { manager, channel, notify } = await setup();
    vi.mocked(channel.commit).mockRejectedValueOnce(new Error('頁面尚未就緒'));
    await manager.applyTemplate(manager.templates.value[0]);
    expect(notify).toHaveBeenCalledWith('頁面尚未就緒', 'error');
    expect(manager.busy.value).toBe(false);
  });
});

describe('createCriteriaOverlayManager — Stat Group Template storage & transfer', () => {
  it('loads templates on start under game-version key and is idempotent', async () => {
    const { manager } = await setup({ version: 'poe2' });
    await manager.start();
    expect(names(manager.templates.value)).toEqual(['A', 'B']);
    expect(statGroupTemplateStorageKey('poe2')).toBe('poexdStatGroupTemplatesV1_poe2');
  });

  it('opens the save dialog with current form stat groups and saves picked ones as deep copies', async () => {
    const mutableSnapshot = {
      ...defaultFormSnapshot,
      stats: JSON.parse(JSON.stringify(groups)),
    };
    const { manager } = await setup({ snapshot: mutableSnapshot });
    await manager.beginSaveTemplate();
    expect(manager.saveDialog.open.value).toBe(true);
    expect(manager.saveDialog.parts.value.map((p) => p.key)).toEqual(['stat:0', 'stat:1']);

    await manager.saveTemplate({ name: '  計數 ', keys: ['stat:1'] });
    expect(manager.saveDialog.open.value).toBe(false);
    const saved = manager.templates.value.at(-1)!;
    expect(saved.name).toBe('計數');
    expect(saved.statGroups).toEqual([groups[1]]);

    // Allowing duplicate names
    await manager.beginSaveTemplate();
    await manager.saveTemplate({ name: '計數', keys: ['stat:0'] });
    expect(names(manager.templates.value).slice(-2)).toEqual(['計數', '計數']);
  });

  it('reports when the form has no stat groups to save or when template name is invalid', async () => {
    const { manager, notify } = await setup({
      snapshot: { ...defaultFormSnapshot, stats: [] },
    });
    await manager.beginSaveTemplate();
    expect(manager.saveDialog.open.value).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('詞綴群組'), 'error');

    const withStats = await setup();
    await withStats.manager.beginSaveTemplate();
    await withStats.manager.saveTemplate({ name: '   ', keys: ['stat:0'] });
    expect(withStats.notify).toHaveBeenLastCalledWith(
      expect.stringContaining('名稱不可為空白'),
      'error',
    );

    await withStats.manager.saveTemplate({
      name: 'x'.repeat(STAT_GROUP_TEMPLATE_NAME_MAX_LENGTH + 1),
      keys: ['stat:0'],
    });
    expect(withStats.notify).toHaveBeenLastCalledWith(expect.stringContaining('最多'), 'error');
  });

  it('renames, updates stat groups, removes and reorders templates', async () => {
    const { manager, notify } = await setup();
    const [a, b] = manager.templates.value;
    await manager.renameTemplate(a, ' 新名稱 ');
    await manager.reorderTemplates([b.id, a.id]);
    expect(names(manager.templates.value)).toEqual(['B', '新名稱']);

    const tuned: CriteriaOverlayStatGroup[] = [
      { type: 'and', filters: [{ id: 'explicit.z', value: { min: 3 } }] },
    ];
    expect(await manager.updateTemplateStatGroups(manager.templates.value[1], tuned)).toBe(true);
    expect(manager.templates.value[1].statGroups).toEqual(tuned);
    expect(manager.templates.value[0].statGroups).toEqual(groups);

    expect(await manager.updateTemplateStatGroups(manager.templates.value[1], [])).toBe(false);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('沒有可儲存'), 'error');

    await manager.removeTemplate(b);
    expect(names(manager.templates.value)).toEqual(['新名稱']);
  });

  it('skips malformed entries on read but preserves them on write and clear', async () => {
    const key = statGroupTemplateStorageKey('poe2');
    const bad = { id: 'bad', name: 'Bad', statGroups: 'nope' };
    const { manager, storage } = await setup({
      version: 'poe2',
      initialStorage: {
        [key]: [{ id: 'ok', name: 'OK', statGroups: groups, createdAt: 1, updatedAt: 1 }, bad],
      },
    });
    expect(manager.templates.value.map((item) => item.id)).toEqual(['ok']);

    await manager.importTemplateEntries([{ name: 'New', statGroups: groups }]);
    const rawAfterImport = storage.inspect()[key] as unknown[];
    expect(rawAfterImport).toHaveLength(3);
    expect(rawAfterImport).toContainEqual(bad);

    await manager.clearTemplates();
    expect(manager.templates.value).toEqual([]);
    expect(storage.inspect()[key]).toEqual([bad]);
  });

  it('updates templates reactively when its storage key changes externally', async () => {
    const key = statGroupTemplateStorageKey('poe1');
    const { manager, storage } = await setup({ seedTemplates: false });
    expect(manager.templates.value).toEqual([]);

    await storage.setExternal({
      [key]: [{ id: 'ext1', name: '外部同步', statGroups: groups, createdAt: 1, updatedAt: 1 }],
    });
    expect(names(manager.templates.value)).toEqual(['外部同步']);
  });

  it('exports, parses and imports template entries while reporting skipped items', async () => {
    const { manager, notify } = await setup({ version: 'poe2' });
    const exported = manager.exportTemplates();
    expect(JSON.parse(exported)).toEqual({
      format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
      version: 1,
      gameVersion: 'poe2',
      templates: [
        { name: 'A', statGroups: groups },
        { name: 'B', statGroups: groups },
      ],
    });

    const mixedJson = JSON.stringify({
      format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
      version: 1,
      gameVersion: 'poe2',
      templates: [
        { name: ' 有效 ', statGroups: groups },
        { name: '', statGroups: groups },
        { name: '沒有群組', statGroups: [] },
        'garbage',
      ],
    });
    const parsed = parseStatGroupTemplateTransfer(mixedJson, 'poe2');
    expect(parsed).toEqual({
      entries: [{ name: '有效', statGroups: groups }],
      skipped: 3,
    });

    await manager.importTemplateEntries(parsed.entries, parsed.skipped);
    expect(names(manager.templates.value)).toEqual(['A', 'B', '有效']);
    expect(notify).toHaveBeenLastCalledWith(
      '已匯入 1 筆常用詞綴群組（略過 3 筆無效項目）',
      'success',
    );

    expect(() => parseStatGroupTemplateTransfer('not json', 'poe1')).toThrow('格式');
    expect(() => parseStatGroupTemplateTransfer('{"format":"other"}', 'poe1')).toThrow('格式');
    expect(() => parseStatGroupTemplateTransfer(exported, 'poe1')).toThrow('POE2');
    expect(() =>
      parseStatGroupTemplateTransfer(serializeStatGroupTemplates('poe1', []), 'poe1'),
    ).toThrow('沒有');
  });
});

describe('createPoeEventCriteriaOverlayChannel & syncSearchFormToUrl', () => {
  beforeEach(() => initPoeEventNonce('nonce-1'));

  it('round-trips read and commit requests over page events', async () => {
    const stopRead = listenPoeEvent('poexd-criteria-overlay-read', (detail) => {
      const request = parsePoeCriteriaOverlayRead(detail)!;
      dispatchPoeEvent(
        'poexd-criteria-overlay-read-result',
        serializePoeCriteriaOverlayReadResult({
          requestId: request.requestId,
          snapshot: defaultFormSnapshot,
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
    expect(read.snapshot).toEqual(defaultFormSnapshot);
    expect(read.knownStatIds?.has('explicit.stat_1')).toBe(true);
    await expect(channel.commit([{ kind: 'setStatus', status: 'online' }])).rejects.toThrow('boom');

    stopRead();
    stopCommit();
  });

  it('rejects when the main world does not answer', async () => {
    const channel = createPoeEventCriteriaOverlayChannel(10);
    await expect(channel.read()).rejects.toThrow('沒有回應');
  });

  it('summarizes changes and skips in describeCriteriaOverlayReport', () => {
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

  describe('channel.syncToUrl', () => {
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

    it('translates main-world error codes and keeps diagnostics', async () => {
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

    it('returns the synced URL from the channel and skips non-search routes', async () => {
      const syncToUrl = vi.fn(async () => 'https://www.pathofexile.com/trade/search/Standard/new');
      await expect(
        syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => SEARCH_URL }),
      ).resolves.toBe('https://www.pathofexile.com/trade/search/Standard/new');
      expect(syncToUrl).toHaveBeenCalledOnce();

      const exchangeUrl = 'https://www.pathofexile.com/trade/exchange/Standard/x';
      await expect(
        syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => exchangeUrl }),
      ).resolves.toBe(exchangeUrl);
      expect(syncToUrl).toHaveBeenCalledOnce();
    });

    it('rejects with actual reason, logs sanitized diagnostics, and falls back on empty message', async () => {
      const syncToUrl = vi.fn(async () => {
        throw new CriteriaOverlaySyncError('官方頁面尚未載入完成', 'PAGE_NOT_LOADED', {
          loaded: false,
        });
      });
      await expect(
        syncSearchFormToUrl({ channel: { syncToUrl }, readUrl: () => SEARCH_URL }),
      ).rejects.toThrow(t('formUrlSync.failed', { reason: '官方頁面尚未載入完成' }));
      const logged = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(logged).toMatchObject({
        code: 'PAGE_NOT_LOADED',
        route: 'trade/search',
        loaded: false,
      });
      expect(JSON.stringify(logged)).not.toContain('Standard/old');

      await expect(
        syncSearchFormToUrl({
          channel: {
            syncToUrl: async () => {
              throw new Error('');
            },
          },
          readUrl: () => SEARCH_URL,
        }),
      ).rejects.toThrow(t('formUrlSync.failed', { reason: t('formUrlSync.unknownReason') }));
    });
  });

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
