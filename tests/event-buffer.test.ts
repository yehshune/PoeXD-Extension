// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initPoeEventNonce, listenPoeEvent, startPoeEventBuffer } from '@/utils/event-contracts';

const NONCE = 'test-nonce';

/** 模擬 Main World 的 bridge.dispatchEvent */
function dispatchFromMainWorld(type: string, payload: unknown, nonce = NONCE) {
  window.dispatchEvent(new CustomEvent(type, { detail: { source: 'poexd', nonce, payload } }));
}

const flushMicrotasks = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('startPoeEventBuffer：初始化期間的 Main World 事件緩衝', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    initPoeEventNonce(NONCE);
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it('監聽註冊前發生的事件會在註冊後補送一次', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    dispatchFromMainWorld('poexd-fetch-response', 'first');
    dispatchFromMainWorld('poexd-fetch-response', 'second');

    const received: unknown[] = [];
    listenPoeEvent('poexd-fetch-response', (detail) => received.push(detail));
    expect(received).toEqual([]);
    await flushMicrotasks();
    expect(received).toEqual(['first', 'second']);
  });

  it('註冊後的事件只即時送達，不會重複補送', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    dispatchFromMainWorld('poexd-fetch-response', 'early');
    const received: unknown[] = [];
    listenPoeEvent('poexd-fetch-response', (detail) => received.push(detail));
    await flushMicrotasks();
    dispatchFromMainWorld('poexd-fetch-response', 'live');
    await flushMicrotasks();
    expect(received).toEqual(['early', 'live']);
  });

  it('每個晚註冊的監聽都各自收到補送', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    dispatchFromMainWorld('poexd-fetch-response', 'early');
    const first: unknown[] = [];
    const second: unknown[] = [];
    listenPoeEvent('poexd-fetch-response', (detail) => first.push(detail));
    listenPoeEvent('poexd-fetch-response', (detail) => second.push(detail));
    await flushMicrotasks();
    expect(first).toEqual(['early']);
    expect(second).toEqual(['early']);
  });

  it('只緩衝指定的事件類型與帶有本次 nonce 的事件', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    dispatchFromMainWorld('poexd-search-triggered', undefined);
    dispatchFromMainWorld('poexd-fetch-response', 'forged', 'wrong-nonce');

    const triggered: unknown[] = [];
    const fetched: unknown[] = [];
    listenPoeEvent('poexd-search-triggered', (detail) => triggered.push(detail));
    listenPoeEvent('poexd-fetch-response', (detail) => fetched.push(detail));
    await flushMicrotasks();
    expect(triggered).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it('達到上限後不再記錄新事件', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response'], 2);
    ['a', 'b', 'c'].forEach((payload) => dispatchFromMainWorld('poexd-fetch-response', payload));
    const received: unknown[] = [];
    listenPoeEvent('poexd-fetch-response', (detail) => received.push(detail));
    await flushMicrotasks();
    expect(received).toEqual(['a', 'b']);
  });

  it('停止緩衝後清空，之後註冊的監聽不再補送', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    dispatchFromMainWorld('poexd-fetch-response', 'early');
    stop();
    stop = null;
    const received: unknown[] = [];
    listenPoeEvent('poexd-fetch-response', (detail) => received.push(detail));
    await flushMicrotasks();
    expect(received).toEqual([]);
  });

  it('補送前就取消監聽時不送達', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    dispatchFromMainWorld('poexd-fetch-response', 'early');
    const received: unknown[] = [];
    const unlisten = listenPoeEvent('poexd-fetch-response', (detail) => received.push(detail));
    unlisten();
    await flushMicrotasks();
    expect(received).toEqual([]);
  });

  it('在同一事件的處理中註冊的新監聽，透過補送收到該事件恰好一次', async () => {
    stop = startPoeEventBuffer(['poexd-fetch-response']);
    const nested: unknown[] = [];
    const unlistenOuter = listenPoeEvent('poexd-fetch-response', () => {
      listenPoeEvent('poexd-fetch-response', (detail) => nested.push(detail));
      unlistenOuter();
    });
    await flushMicrotasks();
    dispatchFromMainWorld('poexd-fetch-response', 'event');
    await flushMicrotasks();
    expect(nested).toEqual(['event']);
  });
});
