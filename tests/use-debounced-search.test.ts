import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import {
  DEFAULT_SEARCH_DEBOUNCE_MS,
  useDebouncedRef,
} from '@/components/sidebar/composables/useDebouncedSearch';

describe('useDebouncedRef', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays non-empty updates by the configured duration', async () => {
    const scope = effectScope();
    const source = ref('');
    const debounced = scope.run(() => useDebouncedRef(source))!;

    source.value = '物理';
    await nextTick();
    expect(debounced.value).toBe('');

    vi.advanceTimersByTime(DEFAULT_SEARCH_DEBOUNCE_MS - 1);
    expect(debounced.value).toBe('');

    vi.advanceTimersByTime(1);
    expect(debounced.value).toBe('物理');

    scope.stop();
  });

  it('coalesces rapid consecutive edits into the final value', async () => {
    const scope = effectScope();
    const source = ref('');
    const debounced = scope.run(() => useDebouncedRef(source, 150))!;

    source.value = 'p';
    await nextTick();
    vi.advanceTimersByTime(80);
    source.value = 'ph';
    await nextTick();
    vi.advanceTimersByTime(80);
    source.value = 'phys';
    await nextTick();

    expect(debounced.value).toBe('');
    vi.advanceTimersByTime(149);
    expect(debounced.value).toBe('');
    vi.advanceTimersByTime(1);
    expect(debounced.value).toBe('phys');

    scope.stop();
  });

  it('clears immediately when source becomes empty or whitespace', async () => {
    const scope = effectScope();
    const source = ref('phys');
    const debounced = scope.run(() => useDebouncedRef(source, 150))!;
    expect(debounced.value).toBe('phys');

    source.value = '';
    await nextTick();
    expect(debounced.value).toBe('');

    source.value = 'chaos';
    await nextTick();
    vi.advanceTimersByTime(150);
    expect(debounced.value).toBe('chaos');

    source.value = '   ';
    await nextTick();
    expect(debounced.value).toBe('   ');

    scope.stop();
  });

  it('cancels pending timers when the effect scope is disposed', async () => {
    const scope = effectScope();
    const source = ref('');
    const debounced = scope.run(() => useDebouncedRef(source, 150))!;

    source.value = 'test';
    await nextTick();
    scope.stop();

    vi.advanceTimersByTime(200);
    expect(debounced.value).toBe('');
  });
});
