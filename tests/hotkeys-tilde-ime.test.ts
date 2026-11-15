// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initHotkeysAndTildeListeners } from '@/entrypoints/content/logic/hotkeys';
import type { PreferencesModule } from '@/utils/preferences';

const preferences = {
  read: () => ({ enableSearchTilde: true, enableFilterTilde: false, enableHotkeys: false }),
} as unknown as PreferencesModule;

describe('search tilde prefix with IME composition', () => {
  let input: HTMLInputElement;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<div class="search-bar"><input class="multiselect__input" placeholder="搜尋道具..."></div>';
    input = document.querySelector('input')!;
    cleanup = initHotkeysAndTildeListeners(preferences);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const compose = (type: 'compositionstart' | 'compositionend') =>
    input.dispatchEvent(new CompositionEvent(type, { bubbles: true }));

  it('prefixes ~ after a finished composition', () => {
    compose('compositionstart');
    input.value = '暗';
    compose('compositionend');
    vi.advanceTimersByTime(60);
    expect(input.value).toBe('~暗');
  });

  it('never rewrites the value while the next composition is still active', () => {
    compose('compositionstart');
    input.value = '暗';
    compose('compositionend');
    // 使用者在 50ms 內接著輸入下一個字，輸入法仍在組字
    compose('compositionstart');
    input.value = '暗ㄧㄥ';
    vi.advanceTimersByTime(60);
    expect(input.value).toBe('暗ㄧㄥ');

    input.value = '暗影';
    compose('compositionend');
    vi.advanceTimersByTime(60);
    expect(input.value).toBe('~暗影');
  });
});
