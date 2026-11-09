// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createFilterObserver } from '@/entrypoints/content/logic/filter-observer';

describe('FilterObserver readiness and debounce contracts', () => {
  let searchAdvanced: HTMLElement;
  let onRefresh: Mock<(generation: number) => void>;
  let isCurrentGeneration: Mock<(generation: number) => boolean>;
  let observerInstance: ReturnType<typeof createFilterObserver> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    searchAdvanced = document.createElement('div');
    searchAdvanced.className = 'search-advanced-items';
    document.body.appendChild(searchAdvanced);

    onRefresh = vi.fn((_generation: number) => {});
    isCurrentGeneration = vi.fn((_generation: number) => true);
  });

  afterEach(() => {
    if (observerInstance) {
      observerInstance.stop();
      observerInstance = null;
    }
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('initializes and calls onRefresh immediately on start', () => {
    observerInstance = createFilterObserver({
      onRefresh,
      isCurrentGeneration,
    });

    observerInstance.start(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(1);
  });

  it('debounces general noisy childList DOM mutations with 50ms timer', async () => {
    observerInstance = createFilterObserver({
      onRefresh,
      isCurrentGeneration,
    });

    observerInstance.start(1);
    onRefresh.mockClear();

    // 模擬 PoE 插入 filter 容器（此時尚未帶有 data-poexd-stat-id）
    const filterRow = document.createElement('div');
    filterRow.className = 'filter';
    searchAdvanced.appendChild(filterRow);

    // 等待 microtask 讓 MutationObserver 收到 childList record
    await Promise.resolve();

    // childList 不得立即觸發 onRefresh，必須走 50ms debounce
    expect(onRefresh).not.toHaveBeenCalled();

    // 模擬 20ms 時再度發生 childList 擾動 (例如內部 input 渲染)
    vi.advanceTimersByTime(20);
    const input = document.createElement('input');
    filterRow.appendChild(input);
    await Promise.resolve();

    expect(onRefresh).not.toHaveBeenCalled();

    // 推進到 50ms (累計 70ms)，debounce 觸發單次 onRefresh
    vi.advanceTimersByTime(50);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(1);
  });

  it('immediately triggers onRefresh when authoritative data-poexd-stat-id is stamped, cancelling noisy debounce timer', async () => {
    observerInstance = createFilterObserver({
      onRefresh,
      isCurrentGeneration,
    });

    observerInstance.start(1);
    onRefresh.mockClear();

    // 1. PoE 插入未標記的 filter row
    const filterRow = document.createElement('div');
    filterRow.className = 'filter';
    searchAdvanced.appendChild(filterRow);
    await Promise.resolve();

    // childList 進入 50ms debounce
    expect(onRefresh).not.toHaveBeenCalled();

    // 2. Main World 在下個 microtask / 數毫秒內寫入權威 data-poexd-stat-id
    filterRow.setAttribute('data-poexd-stat-id', 'explicit.stat_resist_fire');
    await Promise.resolve();

    // 斷言：authoritative mutation 必須立刻觸發 onRefresh，不得等待 50ms！
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(1);

    // 3. 確保原先 pending 的 50ms debounce timer 已被清除，不會在 50ms 後重複觸發
    vi.advanceTimersByTime(60);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('immediately triggers onRefresh when authoritative data-poexd-category changes', async () => {
    observerInstance = createFilterObserver({
      onRefresh,
      isCurrentGeneration,
    });

    observerInstance.start(1);
    onRefresh.mockClear();

    const filterRow = document.createElement('div');
    filterRow.className = 'filter';
    filterRow.setAttribute('data-poexd-stat-id', 'explicit.stat_resist_fire');
    searchAdvanced.appendChild(filterRow);
    await Promise.resolve();
    onRefresh.mockClear();

    // 變更 category (例如官方分類變更或手動切換)
    filterRow.setAttribute('data-poexd-category', 'ring');
    await Promise.resolve();

    // 斷言：category 變更亦視為 authoritative 變更，立即更新 domain
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(1);
  });

  it('respects isCurrentGeneration and does not trigger onRefresh for stale generation', async () => {
    isCurrentGeneration.mockReturnValue(false);

    observerInstance = createFilterObserver({
      onRefresh,
      isCurrentGeneration,
    });

    observerInstance.start(1);
    // start 仍會呼叫一次，清除後檢查非當前世代
    onRefresh.mockClear();

    const filterRow = document.createElement('div');
    filterRow.className = 'filter';
    searchAdvanced.appendChild(filterRow);
    await Promise.resolve();

    vi.advanceTimersByTime(60);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('stop() disconnects observer and prevents any pending debounce callbacks', async () => {
    observerInstance = createFilterObserver({
      onRefresh,
      isCurrentGeneration,
    });

    observerInstance.start(1);
    onRefresh.mockClear();

    const filterRow = document.createElement('div');
    filterRow.className = 'filter';
    searchAdvanced.appendChild(filterRow);
    await Promise.resolve();

    // 立即停止
    observerInstance.stop();

    vi.advanceTimersByTime(100);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
