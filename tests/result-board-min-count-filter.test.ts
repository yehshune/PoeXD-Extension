// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import ResultBoardMinCountFilter from '@/components/sidebar/result-board/ResultBoardMinCountFilter.vue';
import { DEFAULT_MIN_SELLER_COUNT } from '@/components/sidebar/result-board/useResultBoard';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';

describe('ResultBoardMinCountFilter', () => {
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    setActiveDisplayLocalePreference('zh-TW');
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
    document.body.innerHTML = '';
  });

  async function mountWith(count: number): Promise<HTMLElement> {
    const container = document.createElement('div');
    document.body.append(container);
    const app = createApp({
      render: () => h(ResultBoardMinCountFilter, { modelValue: count }),
    });
    app.mount(container);
    unmount = () => app.unmount();
    await nextTick();
    return container.querySelector<HTMLElement>('[data-board-min-count-toggle]')!;
  }

  it('stays plain at the default threshold', async () => {
    const toggle = await mountWith(DEFAULT_MIN_SELLER_COUNT);
    expect(toggle.textContent?.trim()).toBe(`≥ ${DEFAULT_MIN_SELLER_COUNT} 件`);
    expect(toggle.className).not.toContain('bg-primary/10');
  });

  it('highlights the toggle when the threshold differs from the default', async () => {
    const toggle = await mountWith(DEFAULT_MIN_SELLER_COUNT + 1);
    expect(toggle.className).toContain('bg-primary/10');
  });
});
