/**
 * 初次安裝引導（Onboarding）狀態。
 *
 * 只有 Background 在 `runtime.onInstalled` 收到 `reason === 'install'` 時才會建立狀態，
 * 因此從舊版更新上來的使用者沒有這筆資料，不會自動跳出初始導覽。
 * 狀態跨 PoE1 / PoE2 共用，存在 `chrome.storage.local` 的單一 key。
 */
import { resolveDisplayLocale } from './locale-resolution';
import { isMarketTranslationHost, MARKET_TRANSLATION_LOCALES } from './market-translation';
import type { DisplayLocalePreference } from './preferences-contract';

export const ONBOARDING_STORAGE_KEY = 'poexdOnboarding';

export interface OnboardingState {
  /** 尚未開始過初始導覽（第一次展開側邊欄時自動開始，開始即視為完成） */
  readonly tourPending: boolean;
  /** 尚未展開過側邊欄（收合把手顯示提示圓點） */
  readonly expandHintPending: boolean;
  /** 尚未關閉側邊欄的改版更新提示 */
  readonly updatePending?: boolean;
  /** 最後一次看過的擴充版本，供日後的新功能提示比對 */
  readonly lastSeenVersion?: string;
}

/** 沒有狀態時（舊使用者或資料無效）一律視為不需引導 */
export const NO_ONBOARDING: OnboardingState = Object.freeze({
  tourPending: false,
  expandHintPending: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 舊版以 `welcomePending`（歡迎卡片）記錄同一件事，讀取時視為 `tourPending` */
function readTourPending(raw: Record<string, unknown>): boolean | undefined {
  if (typeof raw.tourPending === 'boolean') return raw.tourPending;
  if (typeof raw.welcomePending === 'boolean') return raw.welcomePending;
  return undefined;
}

export function parseOnboardingState(raw: unknown): OnboardingState {
  if (!isRecord(raw)) return NO_ONBOARDING;
  const tourPending = readTourPending(raw);
  if (tourPending === undefined || typeof raw.expandHintPending !== 'boolean') {
    return NO_ONBOARDING;
  }
  return Object.freeze({
    tourPending,
    expandHintPending: raw.expandHintPending,
    ...(raw.updatePending === true ? { updatePending: true } : {}),
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
    tourPending: true,
    expandHintPending: true,
    ...(version ? { lastSeenVersion: version } : {}),
  });
}

export interface UpdateOnboardingInput {
  reason: string;
  version: string | undefined;
  previousVersion?: string;
  current?: OnboardingState;
}

/**
 * 依 `runtime.onInstalled` 的 `reason === 'update'` 決定要寫入的改版提示狀態；
 * 同版本重載（dev reload）或未提供版本號時回傳 null（不寫入）。
 * 若使用者尚未看過初始導覽，則僅更新版本號、不疊加改版提示。
 */
export function createUpdateOnboardingState(input: UpdateOnboardingInput): OnboardingState | null {
  const { reason, version, previousVersion, current = NO_ONBOARDING } = input;
  if (reason !== 'update' || !version) return null;
  if (previousVersion === version || current.lastSeenVersion === version) return null;
  if (current.tourPending) {
    return Object.freeze({
      tourPending: true,
      expandHintPending: current.expandHintPending,
      lastSeenVersion: version,
    });
  }
  return Object.freeze({
    tourPending: false,
    expandHintPending: false,
    updatePending: true,
    lastSeenVersion: version,
  });
}

export function markTourStarted(state: OnboardingState): OnboardingState {
  return Object.freeze({ ...state, tourPending: false });
}

export function dismissUpdate(state: OnboardingState): OnboardingState {
  const { updatePending: _, ...rest } = state;
  return Object.freeze(rest);
}

export function markExpandHintSeen(state: OnboardingState): OnboardingState {
  return Object.freeze({ ...state, expandHintPending: false });
}

export interface MarketTranslationOfferInput {
  hostname: string;
  displayLocale: DisplayLocalePreference;
  browserLocale?: string;
}

/** 國際服英文市集且介面語言為繁中或簡中時，初始導覽才提供「用中文顯示這個市集」 */
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
        next.tourPending === current.tourPending &&
        next.expandHintPending === current.expandHintPending &&
        Boolean(next.updatePending) === Boolean(current.updatePending) &&
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
