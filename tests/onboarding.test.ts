import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  NO_ONBOARDING,
  ONBOARDING_STORAGE_KEY,
  createInstallOnboardingState,
  createOnboardingStore,
  dismissWelcome,
  markExpandHintSeen,
  parseOnboardingState,
  shouldOfferMarketTranslation,
  type OnboardingStorageArea,
} from '@/utils/onboarding';

function createArea(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = structuredClone(initial);
  const listeners = new Set<(changes: Record<string, unknown>) => void>();
  const area: OnboardingStorageArea & { values: Record<string, unknown> } = {
    values,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in values).map((k) => [k, values[k]]));
    },
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
      listeners.forEach((listener) => listener(items));
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return area;
}

describe('createInstallOnboardingState', () => {
  it('creates pending welcome and expand hint only for a fresh install', () => {
    expect(createInstallOnboardingState('install', '1.5.0')).toEqual({
      welcomePending: true,
      expandHintPending: true,
      lastSeenVersion: '1.5.0',
    });
  });

  it.each(['update', 'chrome_update', 'shared_module_update'])(
    'returns null for %s so existing users never see onboarding',
    (reason) => {
      expect(createInstallOnboardingState(reason, '1.5.0')).toBeNull();
    },
  );
});

describe('parseOnboardingState', () => {
  it('treats a missing or malformed record as no onboarding', () => {
    expect(parseOnboardingState(undefined)).toBe(NO_ONBOARDING);
    expect(parseOnboardingState({ welcomePending: 'yes' })).toBe(NO_ONBOARDING);
    expect(parseOnboardingState([])).toBe(NO_ONBOARDING);
  });

  it('keeps valid flags and an optional version', () => {
    expect(
      parseOnboardingState({
        welcomePending: false,
        expandHintPending: true,
        lastSeenVersion: '1',
      }),
    ).toEqual({ welcomePending: false, expandHintPending: true, lastSeenVersion: '1' });
  });
});

describe('state transitions', () => {
  it('returns new objects without mutating the input', () => {
    const initial = createInstallOnboardingState('install', '1.5.0')!;
    const dismissed = dismissWelcome(initial);
    const seen = markExpandHintSeen(initial);
    expect(initial.welcomePending).toBe(true);
    expect(initial.expandHintPending).toBe(true);
    expect(dismissed).toMatchObject({ welcomePending: false, expandHintPending: true });
    expect(seen).toMatchObject({ welcomePending: true, expandHintPending: false });
  });
});

describe('shouldOfferMarketTranslation', () => {
  it('offers on the international English site with a Chinese display locale', () => {
    expect(
      shouldOfferMarketTranslation({ hostname: 'www.pathofexile.com', displayLocale: 'zh-TW' }),
    ).toBe(true);
    expect(
      shouldOfferMarketTranslation({
        hostname: 'www.pathofexile.com',
        displayLocale: 'auto',
        browserLocale: 'zh-CN',
      }),
    ).toBe(true);
  });

  it('does not offer on localized or regional sites, or for non-Chinese locales', () => {
    expect(
      shouldOfferMarketTranslation({ hostname: 'pathofexile.tw', displayLocale: 'zh-TW' }),
    ).toBe(false);
    expect(
      shouldOfferMarketTranslation({ hostname: 'jp.pathofexile.com', displayLocale: 'zh-TW' }),
    ).toBe(false);
    expect(
      shouldOfferMarketTranslation({ hostname: 'www.pathofexile.com', displayLocale: 'en' }),
    ).toBe(false);
  });
});

describe('createOnboardingStore', () => {
  it('persists transitions for fresh-install users', async () => {
    const area = createArea({
      [ONBOARDING_STORAGE_KEY]: createInstallOnboardingState('install', '1.5.0'),
    });
    const store = createOnboardingStore(area);
    await store.update(dismissWelcome);
    expect(area.values[ONBOARDING_STORAGE_KEY]).toMatchObject({
      welcomePending: false,
      expandHintPending: true,
      lastSeenVersion: '1.5.0',
    });
  });

  it('never creates a record for users without onboarding state', async () => {
    const area = createArea();
    const store = createOnboardingStore(area);
    await expect(store.update(dismissWelcome)).resolves.toBe(NO_ONBOARDING);
    await store.update(markExpandHintSeen);
    expect(area.set).not.toHaveBeenCalled();
  });

  it('skips writes when nothing changes', async () => {
    const area = createArea({
      [ONBOARDING_STORAGE_KEY]: { welcomePending: false, expandHintPending: false },
    });
    await createOnboardingStore(area).update(dismissWelcome);
    expect(area.set).not.toHaveBeenCalled();
  });

  it('notifies subscribers only for the onboarding key', async () => {
    const area = createArea();
    const store = createOnboardingStore(area);
    const listener = vi.fn();
    store.subscribe(listener);
    await area.set({ unrelated: 1 });
    expect(listener).not.toHaveBeenCalled();
    await area.set({
      [ONBOARDING_STORAGE_KEY]: { welcomePending: true, expandHintPending: false },
    });
    expect(listener).toHaveBeenCalledWith({ welcomePending: true, expandHintPending: false });
  });
});

describe('background install hook', () => {
  it('registers onInstalled synchronously and writes the install state', () => {
    const source = readFileSync('entrypoints/background/index.ts', 'utf8');
    expect(source).toMatch(/browser\.runtime\.onInstalled\.addListener/);
    expect(source).toMatch(/createInstallOnboardingState\(reason/);
  });
});
