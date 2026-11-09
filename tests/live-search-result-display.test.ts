// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  syncDisplayTotal,
  trimOldestBatches,
} from '@/entrypoints/main-world/official-livesearch-adapter';
import type { HostSearchObject, HostVuexStore } from '@/entrypoints/main-world/host-types';
import {
  RESULT_FILTER_STYLE_ID,
  buildResultFilterCss,
  createLiveSearchResultFilter,
} from '@/entrypoints/content/logic/live-search-result-filter';
import {
  buildFakeTradeResults,
  buildFallbackDevOwners,
} from '@/entrypoints/content/logic/live-search-dev-fixtures';
import { LiveSearchPrimaryRuntime } from '@/entrypoints/content/logic/live-search-primary-runtime';
import type {
  HostCommandOutcome,
  ILiveSearchHostClient,
  RenderResultOptions,
} from '@/entrypoints/content/logic/live-search-host-client';
import {
  parsePoeLiveSearchCommandResult,
  parsePoeLiveSearchRenderResult,
} from '@/utils/event-protocol-types';
import type { SyncTotalOptions } from '@/entrypoints/content/logic/live-search-host-client';
import { createInMemoryPreferencesStorage, createPreferencesModule } from '@/utils/preferences';

function makeStore(): HostVuexStore {
  return {
    _withCommit: (fn) => fn(),
    commit: vi.fn(),
  };
}

function makeContainer(ids: string[]): HostSearchObject {
  return {
    localId: 'display',
    type: 'live',
    live: true,
    status: true,
    realm: 'pc',
    league: 'Standard',
    results: ids.map((id) => ({ id, result: [`t_${id}`], total: 1 })),
    total: ids.length,
    inexact: false,
    collapse: false,
    dirty: false,
    unreadHits: 0,
  };
}

describe('trimOldestBatches（展示筆數上限）', () => {
  it('新批次在前端時，從尾端淘汰最舊者', () => {
    const container = makeContainer(['n', 'a', 'b', 'c']);
    expect(trimOldestBatches(makeStore(), container, 'n', 2)).toBe(2);
    expect(container.results.map((b) => b.id)).toEqual(['n', 'a']);
  });

  it('新批次在尾端時，從前端淘汰最舊者', () => {
    const container = makeContainer(['a', 'b', 'c', 'n']);
    expect(trimOldestBatches(makeStore(), container, 'n', 3)).toBe(1);
    expect(container.results.map((b) => b.id)).toEqual(['b', 'c', 'n']);
  });

  it('未超過上限或上限無效時不變更', () => {
    const container = makeContainer(['n', 'a']);
    expect(trimOldestBatches(makeStore(), container, 'n', 5)).toBe(0);
    expect(trimOldestBatches(makeStore(), container, 'n', undefined)).toBe(0);
    expect(trimOldestBatches(makeStore(), container, 'n', 0)).toBe(0);
    expect(container.results).toHaveLength(2);
  });
});

describe('render payload maxResults', () => {
  const base = {
    requestId: 'r',
    localId: 'l',
    batchId: 'b',
    sourceSearchId: 's',
    token: 't',
    itemData: { id: 'x' },
    total: 1,
  };

  it('保留合法的正整數上限', () => {
    expect(
      parsePoeLiveSearchRenderResult(JSON.stringify({ ...base, maxResults: 100 })),
    ).toMatchObject({ maxResults: 100 });
  });

  it('丟棄非法上限', () => {
    const parsed = parsePoeLiveSearchRenderResult(JSON.stringify({ ...base, maxResults: -1 }));
    expect(parsed).toBeDefined();
    expect(parsed).not.toHaveProperty('maxResults');
  });
});

describe('Result Filter（依連線篩選）', () => {
  it('只隱藏非選定連線的結果列', () => {
    const map = [
      { itemId: 'a1', owner: 'k1' },
      { itemId: 'b1', owner: 'k2' },
      { itemId: 'a"2', owner: 'k1' },
    ];
    expect(buildResultFilterCss(map, null)).toBe('');
    const css = buildResultFilterCss(map, 'k2');
    expect(css).toContain('.row[data-id="a1"]');
    expect(css).toContain('.row[data-id="a\\"2"]');
    expect(css).not.toContain('b1');
  });

  it('套用與取消篩選時注入／移除樣式', () => {
    const filter = createLiveSearchResultFilter({ document });
    filter.record('a1', 'k1');
    filter.record('b1', 'k2');
    filter.setFilter('k1');
    const style = document.getElementById(RESULT_FILTER_STYLE_ID);
    expect(style?.textContent).toContain('b1');
    filter.record('b2', 'k2');
    expect(style?.textContent).toContain('b2');
    expect(filter.countFor('k2')).toBe(2);
    filter.setFilter(null);
    expect(document.getElementById(RESULT_FILTER_STYLE_ID)).toBeNull();
    filter.dispose();
  });

  it('記錄數超過上限時淘汰最舊者', () => {
    const filter = createLiveSearchResultFilter({ document, maxTracked: 2 });
    filter.record('a', 'k');
    filter.record('b', 'k');
    filter.record('c', 'k');
    expect(filter.countFor('k')).toBe(2);
    filter.dispose();
  });
});

describe('Dev 假資料', () => {
  it('依連線輪流分配並具備官方 result 形狀', () => {
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    const items = buildFakeTradeResults(5, 'Standard', 'poe1', owners, 1_000);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.itemData.id)).size).toBe(5);
    expect(items[0].ownerKey).toBe(owners[0].canonicalKey);
    expect(items[1].ownerKey).toBe(owners[1].canonicalKey);
    expect(items[0].itemData).toMatchObject({
      listing: { price: { currency: 'chaos' } },
      item: { league: 'Standard', identified: true },
    });
  });

  it('沒有連線歸屬時不產生資料，且數量有上限', () => {
    expect(buildFakeTradeResults(5, 'Standard', 'poe1', [])).toEqual([]);
    expect(
      buildFakeTradeResults(5000, 'Standard', 'poe1', buildFallbackDevOwners('poe1', 'Standard')),
    ).toHaveLength(1000);
  });
});

class RecordingHostClient implements ILiveSearchHostClient {
  renderCalls: RenderResultOptions[] = [];
  syncCalls: SyncTotalOptions[] = [];
  async syncTotal(options: SyncTotalOptions): Promise<HostCommandOutcome> {
    this.syncCalls.push(options);
    return { success: true };
  }
  ensureCalls = 0;
  async ensureContainer(): Promise<HostCommandOutcome> {
    this.ensureCalls++;
    return { success: true };
  }
  async renderResult(options: RenderResultOptions): Promise<HostCommandOutcome> {
    this.renderCalls.push(options);
    return { success: true };
  }
  async resetUnread(): Promise<HostCommandOutcome> {
    return { success: true };
  }
  dispose(): void {}
}

describe('Runtime 假結果渲染與篩選', () => {
  it('不建立 WebSocket、不呼叫 fetch，並帶入展示上限與連線歸屬', async () => {
    const hostClient = new RecordingHostClient();
    const webSocketFactory = vi.fn();
    const fetchClient = vi.fn();
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory,
      fetchClient,
      getMaxDisplayedResults: () => 50,
    });
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    const outcome = await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(6, 'Standard', 'poe1', owners),
    );

    expect(outcome).toEqual({ rendered: 6, failed: 0 });
    expect(webSocketFactory).not.toHaveBeenCalled();
    expect(fetchClient).not.toHaveBeenCalled();
    expect(hostClient.ensureCalls).toBe(1);
    expect(hostClient.renderCalls.every((call) => call.maxResults === 50)).toBe(true);
    expect(runtime.getCumulativeRenderedTotal()).toBe(6);

    runtime.setResultFilter(owners[0].canonicalKey);
    expect(runtime.getSnapshot().resultFilterKey).toBe(owners[0].canonicalKey);
    expect(document.getElementById(RESULT_FILTER_STYLE_ID)?.textContent).toContain(
      String(
        hostClient.renderCalls[1].itemData &&
          (hostClient.renderCalls[1].itemData as { id: string }).id,
      ),
    );

    runtime.setResultFilter(null);
    expect(runtime.getSnapshot()).not.toHaveProperty('resultFilterKey');
    runtime.dispose();
  });
});

describe('偏好設定：liveSearchMaxDisplayedResults', () => {
  it('預設 100，僅接受 50/100/200/500', async () => {
    const outcome = await createPreferencesModule('poe1', createInMemoryPreferencesStorage());
    if (!outcome.ok) throw new Error(outcome.error.message);
    const prefs = outcome.value;
    expect(prefs.read().liveSearchMaxDisplayedResults).toBe(100);
    expect((await prefs.update({ liveSearchMaxDisplayedResults: 200 })).ok).toBe(true);
    expect(prefs.read().liveSearchMaxDisplayedResults).toBe(200);
    const invalid = await prefs.update({
      liveSearchMaxDisplayedResults: 123 as unknown as 100,
    });
    expect(invalid.ok).toBe(false);
    expect(prefs.read().liveSearchMaxDisplayedResults).toBe(200);
  });
});

describe('官方上方顯示筆數（實際保留數，與篩選連動）', () => {
  it('syncDisplayTotal 只寫入 PoeXD 展示容器的 total', () => {
    const container = makeContainer(['a', 'b']);
    container.total = 99;
    const store: HostVuexStore = {
      ...makeStore(),
      state: { transient: { searches: [container] } },
    };
    expect(syncDisplayTotal({ localId: 'display', total: 2 }, store)).toEqual({ success: true });
    expect(container.total).toBe(2);
    expect(syncDisplayTotal({ localId: 'other', total: 1 }, store).success).toBe(false);
    expect(syncDisplayTotal({ localId: 'display', total: -1 }, store).success).toBe(false);
    expect(container.total).toBe(2);
  });

  it('command result 接受 sync-total', () => {
    expect(
      parsePoeLiveSearchCommandResult(JSON.stringify({ command: 'sync-total', success: true })),
    ).toMatchObject({ command: 'sync-total', success: true });
  });

  it('渲染時 total 不超過上限，篩選時為該連線筆數並立即同步', async () => {
    const hostClient = new RecordingHostClient();
    const runtime = new LiveSearchPrimaryRuntime('poe1', {
      hostClient,
      webSocketFactory: vi.fn(),
      fetchClient: vi.fn(),
      getMaxDisplayedResults: () => 4,
    });
    const owners = buildFallbackDevOwners('poe1', 'Standard');
    await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(6, 'Standard', 'poe1', owners),
    );
    expect(hostClient.renderCalls.map((call) => call.total)).toEqual([1, 2, 3, 4, 4, 4]);
    expect(runtime.getCumulativeRenderedTotal()).toBe(6);

    // 保留的最後 4 筆依序屬於 owners[2], owners[0], owners[1], owners[2]
    runtime.setResultFilter(owners[2].canonicalKey);
    expect(hostClient.syncCalls.at(-1)?.total).toBe(2);

    await runtime.renderSyntheticResults(
      'Standard',
      buildFakeTradeResults(1, 'Standard', 'poe1', [owners[0]], 99_999),
    );
    // 新增一筆 owners[0]，淘汰最舊的 owners[2] → 篩選中的連線剩 1 筆
    expect(hostClient.renderCalls.at(-1)?.total).toBe(1);

    runtime.setResultFilter(null);
    expect(hostClient.syncCalls.at(-1)?.total).toBe(4);
    runtime.dispose();
  });
});
