import { describe, expect, it } from 'vitest';
import { clampCollapsedTabTop, collapsedTabTopCss } from '@/utils/collapsed-tab-position';
import {
  COLLAPSED_TAB_TOP_BOUNDS,
  DEFAULT_PREFERENCES,
  createInMemoryPreferencesStorage,
  createPreferencesModule,
} from '@/utils/preferences';

describe('Collapsed tab position', () => {
  it('keeps the tab inside the viewport', () => {
    expect(clampCollapsedTabTop(250, 800, 32)).toBe(250);
    expect(clampCollapsedTabTop(-40, 800, 32)).toBe(0);
    expect(clampCollapsedTabTop(900, 800, 32)).toBe(768);
    expect(clampCollapsedTabTop(120.6, 800, 32)).toBe(121);
  });

  it('falls back to the default top and preference bounds for invalid input', () => {
    expect(clampCollapsedTabTop(Number.NaN, 800, 32)).toBe(DEFAULT_PREFERENCES.collapsedTabTop);
    expect(clampCollapsedTabTop(99999, Number.NaN, 32)).toBe(COLLAPSED_TAB_TOP_BOUNDS.max);
    expect(clampCollapsedTabTop(50, 20, 32)).toBe(0);
  });

  it('renders a CSS clamp so a stored top stays on screen after the window shrinks', () => {
    expect(collapsedTabTopCss(240)).toBe(
      'clamp(0px, 240px, calc(100vh - var(--control-height-default)))',
    );
    expect(collapsedTabTopCss(undefined)).toBe(
      'clamp(0px, 100px, calc(100vh - var(--control-height-default)))',
    );
  });

  it('persists collapsedTabTop per game version and repairs invalid stored values', async () => {
    const storage = createInMemoryPreferencesStorage({ collapsedTabTop_poe2: -5 });
    const outcome = await createPreferencesModule('poe2', storage);
    if (!outcome.ok) throw new Error(outcome.error.message);
    expect(outcome.value.read().collapsedTabTop).toBe(DEFAULT_PREFERENCES.collapsedTabTop);
    expect(storage.inspect().collapsedTabTop_poe2).toBe(DEFAULT_PREFERENCES.collapsedTabTop);

    await expect(outcome.value.update({ collapsedTabTop: 320 })).resolves.toEqual({
      ok: true,
      changed: true,
    });
    expect(storage.inspect().collapsedTabTop_poe2).toBe(320);
    expect((await outcome.value.update({ collapsedTabTop: Number.NaN })).ok).toBe(false);
  });
});
