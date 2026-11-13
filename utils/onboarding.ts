/**
 * 初次安裝引導（Onboarding）狀態。
 *
 * 只有 Background 在 `runtime.onInstalled` 收到 `reason === 'install'` 時才會建立狀態，
 * 因此從舊版更新上來的使用者沒有這筆資料，永遠不會看到歡迎卡片。
 * 狀態跨 PoE1 / PoE2 共用，存在 `chrome.storage.local` 的單一 key。
 */
import { resolveDisplayLocale } from './locale-resolution';
import { isMarketTranslationHost, MARKET_TRANSLATION_LOCALES } from './market-translation';
import type { DisplayLocalePreference } from './preferences-contract';

export const ONBOARDING_STORAGE_KEY = 'poexdOnboarding';

export interface OnboardingState {
  /** 尚未關閉側邊欄的歡迎卡片 */
  readonly welcomePending: boolean;
  /** 尚未展開過側邊欄（收合把手顯示提示圓點） */
  readonly expandHintPending: boolean;
  /** 最後一次看過的擴充版本，供日後的新功能提示比對 */
  readonly lastSeenVersion?: string;
}

/** 沒有狀態時（舊使用者或資料無效）一律視為不需引導 */
export const NO_ONBOARDING: OnboardingState = Object.freeze({
  welcomePending: false,
  expandHintPending: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseOnboardingState(raw: unknown): OnboardingState {
  if (!isRecord(raw)) return NO_ONBOARDING;
  if (typeof raw.welcomePending !== 'boolean' || typeof raw.expandHintPending !== 'boolean') {
    return NO_ONBOARDING;
  }
  return Object.freeze({
    welcomePending: raw.welcomePending,
    expandHintPending: raw.expandHintPending,
    ...(typeof raw.lastSeenVersion === 'string' && raw.lastSeenVersion
      ? { lastSeenVersion: raw.lastSeenVersion }
      : {}),
  });
}

/**
 * 依 `runtime.onInstalled` 的 reason 決定要寫入的初始狀態；
 * 只有全新安裝會回傳狀態，更新、瀏覽器更新等其他情況回傳 null（不寫入）。
 */
export function createInstallOnboardingState(
  reason: string,
  version: string | undefined,
): OnboardingState | null {
  if (reason !== 'install') return null;
  return Object.freeze({
    welcomePending: true,
    expandHintPending: true,
    ...(version ? { lastSeenVersion: version } : {}),
  });
}

export function dismissWelcome(state: OnboardingState): OnboardingState {
  return Object.freeze({ ...state, welcomePending: false });
}

export function markExpandHintSeen(state: OnboardingState): OnboardingState {
  return Object.freeze({ ...state, expandHintPending: false });
}

export interface MarketTranslationOfferInput {
  hostname: string;
  displayLocale: DisplayLocalePreference;
  browserLocale?: string;
}

/** 國際服英文市集且介面語言為繁中或簡中時，歡迎卡片才提供「用中文顯示這個市集」 */
export function shouldOfferMarketTranslation(input: MarketTranslationOfferInput): boolean {
  if (!isMarketTranslationHost(input.hostname)) return false;
  const resolved = resolveDisplayLocale(input.displayLocale, {
    hostname: input.hostname,
    browserLocale: input.browserLocale,
  });
  return (MARKET_TRANSLATION_LOCALES as readonly string[]).includes(resolved);
}

export interface OnboardingStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  subscribe(listener: (changes: Record<string, unknown>) => void): () => void;
}

export interface OnboardingStore {
  read(): Promise<OnboardingState>;
  update(mutate: (state: OnboardingState) => OnboardingState): Promise<OnboardingState>;
  subscribe(listener: (state: OnboardingState) => void): () => void;
}

export function createOnboardingStore(area: OnboardingStorageArea): OnboardingStore {
  const read = async () => {
    const stored = await area.get([ONBOARDING_STORAGE_KEY]);
    return parseOnboardingState(stored[ONBOARDING_STORAGE_KEY]);
  };
  return {
    read,
    async update(mutate) {
      const current = await read();
      // 舊使用者沒有狀態，不建立新的記錄
      if (current === NO_ONBOARDING) return current;
      const next = mutate(current);
      if (
        next.welcomePending === current.welcomePending &&
        next.expandHintPending === current.expandHintPending &&
        next.lastSeenVersion === current.lastSeenVersion
      ) {
        return current;
      }
      await area.set({ [ONBOARDING_STORAGE_KEY]: { ...next } });
      return next;
    },
    subscribe(listener) {
      return area.subscribe((changes) => {
        if (ONBOARDING_STORAGE_KEY in changes) {
          listener(parseOnboardingState(changes[ONBOARDING_STORAGE_KEY]));
        }
      });
    },
  };
}

export function createChromeOnboardingStore(): OnboardingStore {
  return createOnboardingStore({
    get: (keys) => chrome.storage.local.get(keys),
    set: (values) => chrome.storage.local.set(values),
    subscribe(listener) {
      const handle = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
        if (areaName !== 'local') return;
        listener(Object.fromEntries(Object.entries(changes).map(([key, c]) => [key, c.newValue])));
      };
      chrome.storage.onChanged.addListener(handle);
      return () => chrome.storage.onChanged.removeListener(handle);
    },
  });
}
