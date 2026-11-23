// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MainWorldBridge } from '@/entrypoints/main-world/bridge-bootstrap';
import {
  initPoeRuntimeReader,
  resetLiveTradeDataSentForTests,
  sendLiveTradeData,
} from '@/entrypoints/main-world/poe-runtime-reader';
import { parsePoeLiveTradeData, serializePoeLiveTradeData } from '@/utils/event-contracts';
import { resetTradeRequestIdleForTests } from '@/entrypoints/main-world/trade-request-idle';
import {
  getUsableLiveTradeData,
  resetTradeLabelsForTests,
  setLiveTradeData,
} from '@/utils/trade-label-resolver';

const readJson = (path: string): any =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

// 國際服 PoE 1（市集漢化關閉）的頁面資料，見 live-trade-data.test.ts
const enFilters = readJson('./fixtures/live-trade-data/poe1-en-property-filters.json');
const enStats = readJson('./fixtures/live-trade-data/poe1-en-known-stats.json');
const bundledEn = readJson('../public/json/poe1/locales/en/trade-filters.json');

interface DispatchedEvent {
  type: string;
  payload?: string;
}

function createBridge() {
  const events: DispatchedEvent[] = [];
  const listeners = new Map<string, () => void>();
  const bridge = {
    dispatchEvent: (type: string, payload?: string) => events.push({ type, payload }),
    addListener: (type: string, callback: () => void) => {
      listeners.set(type, callback);
      return () => listeners.delete(type);
    },
  } as unknown as MainWorldBridge;
  return { bridge, events, listeners };
}

/** 模擬官方 Vue 3 頁面：靜態資料掛在 `#trade.__vue_app__` 根元件 proxy 的 `static_` */
function mountVue3Trade(staticData: Record<string, unknown>) {
  const tradeEl = document.createElement('div');
  tradeEl.id = 'trade';
  (tradeEl as any).__vue_app__ = {
    _container: { _vnode: { component: { proxy: { static_: staticData } } } },
  };
  document.body.appendChild(tradeEl);
  return tradeEl;
}

const liveEvents = (events: DispatchedEvent[]) =>
  events.filter((event) => event.type === 'poexd-live-trade-data');

describe('parsePoeLiveTradeData', () => {
  const wire = serializePoeLiveTradeData({ propertyFilters: enFilters, knownStats: enStats });

  it('解碼頁面原始資料並走完整驗證', () => {
    const payload = parsePoeLiveTradeData(wire);
    expect(payload?.filters?.groups).toEqual(bundledEn.groups);
    expect(payload?.statLabels?.pseudoStats).toMatchObject(
      Object.fromEntries(
        Object.keys(payload!.statLabels!.pseudoStats).map((id) => [id, bundledEn.pseudoStats[id]]),
      ),
    );
  });

  it('只有一部分有效時，另一部分為 null', () => {
    const payload = parsePoeLiveTradeData(
      serializePoeLiveTradeData({ propertyFilters: { forged: true }, knownStats: enStats }),
    );
    expect(payload?.filters).toBeNull();
    expect(payload?.statLabels).not.toBeNull();
  });

  it('由分組的 knownStats 推導 id → stat 對照，取代另外序列化一份 knownStatsFlat', () => {
    const groups = [
      {
        id: 'pseudo',
        label: 'Pseudo',
        entries: [{ id: 'pseudo.a', text: 'A', type: 'pseudo' }],
      },
      {
        id: 'explicit',
        label: 'Explicit',
        entries: [
          { id: 'explicit.x', text: 'Area contains X', type: 'explicit' },
          { id: 'explicit.y', text: 'Y', type: 'explicit', option: { options: [] } },
          // 官方 knownStatsFlat 對重複 id 採後出現的寫法
          { id: 'explicit.x', text: 'Your Maps contain X', type: 'explicit' },
        ],
      },
    ];
    const payload = parsePoeLiveTradeData(
      serializePoeLiveTradeData({ propertyFilters: null, knownStats: groups }),
    );
    expect(payload?.knownStats).toEqual({
      'pseudo.a': { id: 'pseudo.a', text: 'A', type: 'pseudo' },
      'explicit.x': { id: 'explicit.x', text: 'Your Maps contain X', type: 'explicit' },
      'explicit.y': { id: 'explicit.y', text: 'Y', type: 'explicit' },
    });
  });

  it('knownStats 條目形狀不符時，推導的對照為 null', () => {
    const groups = [
      { id: 'pseudo', label: 'Pseudo', entries: [{ id: 'pseudo.a', text: 'A', type: 7 }] },
    ];
    const payload = parsePoeLiveTradeData(
      serializePoeLiveTradeData({ propertyFilters: enFilters, knownStats: groups }),
    );
    expect(payload?.knownStats).toBeNull();
    expect(payload?.filters).not.toBeNull();
  });

  it.each([
    ['不是字串', { propertyFilters: enFilters }],
    ['不是 JSON', 'not-json'],
    ['是陣列', JSON.stringify([enFilters])],
    ['兩部分都無效', serializePoeLiveTradeData({ propertyFilters: 1, knownStats: 'x' })],
  ])('%s時回傳 undefined', (_label, detail) => {
    expect(parsePoeLiveTradeData(detail)).toBeUndefined();
  });
});

describe('sendLiveTradeData（MAIN world）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetLiveTradeDataSentForTests();
  });

  it('從 Vue 3 根元件的 static_ 送出 propertyFilters 與 knownStats，同一份不重送', () => {
    const staticData = { propertyFilters: enFilters, knownStats: enStats };
    mountVue3Trade(staticData);
    const { bridge, events } = createBridge();

    sendLiveTradeData(bridge);
    sendLiveTradeData(bridge);
    expect(liveEvents(events)).toHaveLength(1);
    expect(parsePoeLiveTradeData(liveEvents(events)[0].payload)?.filters).not.toBeNull();

    staticData.propertyFilters = structuredClone(enFilters);
    sendLiveTradeData(bridge);
    expect(liveEvents(events)).toHaveLength(2);
  });

  it('頁面沒有分組 knownStats、只有 knownStatsFlat 時，退回用它推導 known stats', () => {
    const knownStatsFlat = {
      'pseudo.a': { id: 'pseudo.a', text: 'A', type: 'pseudo' },
      'explicit.b': { id: 'explicit.b', text: 'B', type: 'explicit' },
    };
    mountVue3Trade({ propertyFilters: enFilters, knownStatsFlat });
    const { bridge, events } = createBridge();

    sendLiveTradeData(bridge);
    sendLiveTradeData(bridge);
    expect(liveEvents(events)).toHaveLength(1);
    const payload = parsePoeLiveTradeData(liveEvents(events)[0].payload);
    expect(payload?.knownStats).toEqual(knownStatsFlat);
    expect(payload?.filters).not.toBeNull();
    // 攤平資料沒有群組標題與 pseudo 群組，不當作市集寫法來源
    expect(payload?.statLabels).toBeNull();
  });

  it('頁面資料尚未載入時不送', () => {
    mountVue3Trade({});
    const { bridge, events } = createBridge();
    sendLiveTradeData(bridge);
    expect(events).toHaveLength(0);
  });
});

describe('initPoeRuntimeReader（MAIN world）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 送資料前會等主執行緒閒置；讓 idle callback 也走 fake timers
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => setTimeout(callback, 0));
    resetTradeRequestIdleForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.body.innerHTML = '';
    resetLiveTradeDataSentForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Vue 3 頁面上輪詢就能送出即時市集資料，不再另外序列化 knownStatsFlat', () => {
    mountVue3Trade({
      knownStatsFlat: { 'pseudo.a': { id: 'pseudo.a', text: 'A', type: 'pseudo' } },
      propertyFilters: enFilters,
      knownStats: enStats,
    });
    const { bridge, events } = createBridge();

    initPoeRuntimeReader(bridge);
    vi.advanceTimersByTime(301); // 輪詢命中後再等主執行緒閒置

    expect(events.some((event) => event.type === 'poexd-known-stats')).toBe(false);
    expect(liveEvents(events)).toHaveLength(1);
  });

  it('側邊欄請求 known stats 時補送即時市集資料（已送過就不重送）', () => {
    mountVue3Trade({ propertyFilters: enFilters, knownStats: enStats });
    const { bridge, events, listeners } = createBridge();
    initPoeRuntimeReader(bridge);

    listeners.get('poexd-request-known-stats')?.();
    listeners.get('poexd-request-known-stats')?.();
    expect(liveEvents(events)).toHaveLength(1);
    expect(events.some((event) => event.type === 'poexd-known-stats')).toBe(false);
  });

  it('回應 content script 的請求；已送過同一份時不重送', () => {
    mountVue3Trade({ propertyFilters: enFilters, knownStats: enStats });
    const { bridge, events, listeners } = createBridge();
    initPoeRuntimeReader(bridge);

    listeners.get('poexd-request-live-trade-data')?.();
    listeners.get('poexd-request-live-trade-data')?.();
    expect(liveEvents(events)).toHaveLength(1);
  });
});

describe('trade-label-resolver 的頁面即時資料', () => {
  afterEach(() => resetTradeLabelsForTests());

  it('依遊戲版本分開保存，更新時不改動先前的快照', () => {
    const filters = parsePoeLiveTradeData(
      serializePoeLiveTradeData({ propertyFilters: enFilters, knownStats: enStats }),
    )!;
    setLiveTradeData('poe1', { pageLocale: 'en', ...filters });
    const first = getUsableLiveTradeData('poe1', 'en', 'www.pathofexile.com');
    expect(Object.isFrozen(first)).toBe(true);
    expect(getUsableLiveTradeData('poe2', 'en', 'www.pathofexile.com')).toBeUndefined();

    setLiveTradeData('poe1', { pageLocale: 'zh-TW', filters: null, statLabels: null });
    expect(first?.pageLocale).toBe('en');
    expect(getUsableLiveTradeData('poe1', 'zh-TW', 'pathofexile.tw')?.pageLocale).toBe('zh-TW');
  });
});
