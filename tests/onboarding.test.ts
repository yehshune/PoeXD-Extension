import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  NO_ONBOARDING,
  ONBOARDING_STORAGE_KEY,
  createInstallOnboardingState,
  createOnboardingStore,
  createUpdateOnboardingState,
  dismissUpdate,
  markTourStarted,
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
  it('creates pending tour and expand hint only for a fresh install', () => {
    expect(createInstallOnboardingState('install', '1.5.0')).toEqual({
      tourPending: true,
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

describe('createUpdateOnboardingState', () => {
  it('creates pending update notice without expand hint dot when version changes', () => {
    expect(
      createUpdateOnboardingState({
        reason: 'update',
        version: '1.6.1',
        previousVersion: '1.6.0',
      }),
    ).toEqual({
      tourPending: false,
      expandHintPending: false,
      updatePending: true,
      lastSeenVersion: '1.6.1',
    });
  });

  it('returns null for non-update reasons or same-version dev reloads', () => {
    expect(
      createUpdateOnboardingState({
        reason: 'install',
        version: '1.6.1',
        previousVersion: '1.6.0',
      }),
    ).toBeNull();
    expect(
      createUpdateOnboardingState({ reason: 'update', version: '1.6.1', previousVersion: '1.6.1' }),
    ).toBeNull();
    expect(
      createUpdateOnboardingState({
        reason: 'update',
        version: '1.6.1',
        current: { tourPending: false, expandHintPending: false, lastSeenVersion: '1.6.1' },
      }),
    ).toBeNull();
  });

  it('keeps tourPending without stacking updatePending if user has not dismissed first-install tour', () => {
    expect(
      createUpdateOnboardingState({
        reason: 'update',
        version: '1.6.1',
        previousVersion: '1.6.0',
        current: { tourPending: true, expandHintPending: true, lastSeenVersion: '1.6.0' },
      }),
    ).toEqual({
      tourPending: true,
      expandHintPending: true,
      lastSeenVersion: '1.6.1',
    });
  });
});

describe('parseOnboardingState', () => {
  it('treats a missing or malformed record as no onboarding', () => {
    expect(parseOnboardingState(undefined)).toBe(NO_ONBOARDING);
    expect(parseOnboardingState({ tourPending: 'yes' })).toBe(NO_ONBOARDING);
    expect(parseOnboardingState([])).toBe(NO_ONBOARDING);
  });

  it('keeps valid flags and an optional version', () => {
    expect(
      parseOnboardingState({
        tourPending: false,
        expandHintPending: true,
        lastSeenVersion: '1',
      }),
    ).toEqual({ tourPending: false, expandHintPending: true, lastSeenVersion: '1' });
    expect(
      parseOnboardingState({
        tourPending: false,
        expandHintPending: false,
        updatePending: true,
        lastSeenVersion: '1.6.1',
      }),
    ).toEqual({
      tourPending: false,
      expandHintPending: false,
      updatePending: true,
      lastSeenVersion: '1.6.1',
    });
  });

  it('reads the legacy welcomePending flag as tourPending', () => {
    expect(parseOnboardingState({ welcomePending: true, expandHintPending: false })).toEqual({
      tourPending: true,
      expandHintPending: false,
    });
    expect(
      parseOnboardingState({ tourPending: false, welcomePending: true, expandHintPending: false }),
    ).toEqual({ tourPending: false, expandHintPending: false });
  });
});

describe('state transitions', () => {
  it('returns new objects without mutating the input', () => {
    const initial = createInstallOnboardingState('install', '1.5.0')!;
    const dismissed = markTourStarted(initial);
    const seen = markExpandHintSeen(initial);
    expect(initial.tourPending).toBe(true);
    expect(initial.expandHintPending).toBe(true);
    expect(dismissed).toMatchObject({ tourPending: false, expandHintPending: true });
    expect(seen).toMatchObject({ tourPending: true, expandHintPending: false });

    const updated = createUpdateOnboardingState({
      reason: 'update',
      version: '1.6.1',
      previousVersion: '1.6.0',
    })!;
    expect(updated.updatePending).toBe(true);
    expect(dismissUpdate(updated)).toEqual({
      tourPending: false,
      expandHintPending: false,
      lastSeenVersion: '1.6.1',
    });
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
    await store.update(markTourStarted);
    expect(area.values[ONBOARDING_STORAGE_KEY]).toMatchObject({
      tourPending: false,
      expandHintPending: true,
      lastSeenVersion: '1.5.0',
    });
  });

  it('never creates a record for users without onboarding state', async () => {
    const area = createArea();
    const store = createOnboardingStore(area);
    await expect(store.update(markTourStarted)).resolves.toBe(NO_ONBOARDING);
    await store.update(markExpandHintSeen);
    expect(area.set).not.toHaveBeenCalled();
  });

  it('skips writes when nothing changes', async () => {
    const area = createArea({
      [ONBOARDING_STORAGE_KEY]: { tourPending: false, expandHintPending: false },
    });
    await createOnboardingStore(area).update(markTourStarted);
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
      [ONBOARDING_STORAGE_KEY]: { tourPending: true, expandHintPending: false },
    });
    expect(listener).toHaveBeenCalledWith({ tourPending: true, expandHintPending: false });
  });
});

describe('background install hook', () => {
  it('registers onInstalled synchronously and writes the install state', () => {
    const source = readFileSync('entrypoints/background/index.ts', 'utf8');
    expect(source).toMatch(/browser\.runtime\.onInstalled\.addListener/);
    expect(source).toMatch(/createInstallOnboardingState\(reason/);
  });
});
