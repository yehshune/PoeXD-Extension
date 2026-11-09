import { ref, watchEffect, type Ref } from 'vue';
import type {
  DisplayLocalePreference,
  SupportedLocale,
  SupportedUiLocale,
} from '../preferences-contract';
import {
  DISPLAY_LOCALE_VALUES,
  LEGACY_DISPLAY_LOCALE_KEYS,
  resolveStoredDisplayLocale,
} from '../preferences-contract';

export type { SupportedUiLocale } from '../preferences-contract';
import {
  resolveDisplayLocale,
  resolveUiLocale,
  type LocaleResolutionInput,
} from '../locale-resolution';
import { ZH_TW_MESSAGES, type I18nKey, type I18nMessageCatalog } from './messages/zh-TW';
import { ZH_CN_MESSAGES } from './messages/zh-CN';
import { EN_MESSAGES } from './messages/en';
import { isLocalizedMessage, type MessageValue } from '../localized-message';

export type { I18nKey, I18nMessageCatalog } from './messages/zh-TW';

export const I18N_MESSAGES: Readonly<Record<SupportedUiLocale, I18nMessageCatalog>> = Object.freeze(
  {
    'zh-TW': Object.freeze(ZH_TW_MESSAGES),
    'zh-CN': Object.freeze(ZH_CN_MESSAGES),
    en: Object.freeze(EN_MESSAGES),
  },
);

const activeDisplayLocalePreferenceRef = ref<DisplayLocalePreference>('auto');
const activeDisplayLocaleRef = ref<SupportedLocale>('zh-TW');
const activeUiLocaleRef = ref<SupportedUiLocale>('zh-TW');

export function getActiveUiLocaleRef(): Ref<SupportedUiLocale> {
  return activeUiLocaleRef;
}

export function getActiveUiLocale(): SupportedUiLocale {
  return activeUiLocaleRef.value;
}

export function getActiveDisplayLocale(): SupportedLocale {
  return activeDisplayLocaleRef.value;
}

export function getActiveDisplayLocaleRef(): Readonly<Ref<SupportedLocale>> {
  return activeDisplayLocaleRef;
}

export function getActiveDisplayLocalePreference(): DisplayLocalePreference {
  return activeDisplayLocalePreferenceRef.value;
}

/** 直接指定已解析的 Display Locale（不經過 Preference 解析），並推導對應的 UI Locale */
export function setActiveDisplayLocale(locale: SupportedLocale): SupportedUiLocale {
  const uiLocale = resolveUiLocale(locale);
  activeDisplayLocaleRef.value = locale;
  activeUiLocaleRef.value = uiLocale;
  return uiLocale;
}

export function setActiveDisplayLocalePreference(
  preference: DisplayLocalePreference,
  input?: LocaleResolutionInput,
): SupportedUiLocale {
  const normalizedPref: DisplayLocalePreference = (
    DISPLAY_LOCALE_VALUES as readonly unknown[]
  ).includes(preference)
    ? preference
    : 'auto';
  activeDisplayLocalePreferenceRef.value = normalizedPref;
  const resolvedDisplay = resolveDisplayLocale(normalizedPref, input);
  activeDisplayLocaleRef.value = resolvedDisplay;
  const resolvedUi = resolveUiLocale(resolvedDisplay, input);
  activeUiLocaleRef.value = resolvedUi;
  return resolvedUi;
}

export function resetI18nStateForTests(locale: SupportedUiLocale = 'zh-TW'): void {
  activeDisplayLocalePreferenceRef.value = 'auto';
  activeDisplayLocaleRef.value = locale;
  activeUiLocaleRef.value = locale;
}

export function t(
  key: I18nKey,
  params?: Readonly<Record<string, string | number>>,
  localeOverride?: SupportedUiLocale,
): string {
  const locale = localeOverride ?? activeUiLocaleRef.value;
  const catalog = I18N_MESSAGES[locale] ?? I18N_MESSAGES.en;
  const template = catalog[key] ?? I18N_MESSAGES.en[key] ?? String(key);
  if (!params) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, paramName: string) => {
    const val = params[paramName];
    return val !== undefined && val !== null ? String(val) : match;
  });
}

/**
 * 將 Background 傳來的訊息轉成目前語系文字：可翻譯訊息走 `t()`，原始字串原樣回傳，
 * 空值時使用 `fallbackKey`。
 */
export function formatMessage(
  value: MessageValue | null | undefined,
  fallbackKey?: I18nKey,
): string {
  if (isLocalizedMessage(value)) return t(value.key, value.params);
  if (typeof value === 'string' && value) return value;
  return fallbackKey ? t(fallbackKey) : '';
}

export function applyDocumentLocaleMeta(title?: string, doc?: Document): void {
  const targetDoc = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc) return;
  if (targetDoc.documentElement) {
    targetDoc.documentElement.lang = activeUiLocaleRef.value;
  }
  if (title !== undefined) {
    targetDoc.title = title;
  }
}

export function bindDocumentLocaleMeta(getTitle?: () => string, doc?: Document): () => void {
  return watchEffect(() => {
    const title = getTitle ? getTitle() : undefined;
    applyDocumentLocaleMeta(title, doc);
  });
}

export function initStorageDisplayLocaleSync(input?: LocaleResolutionInput): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return () => {};
  }

  let disposed = false;
  void Promise.resolve(chrome.storage.local.get(['displayLocale', ...LEGACY_DISPLAY_LOCALE_KEYS]))
    .then((stored) => {
      if (disposed) return;
      const pref = resolveStoredDisplayLocale(stored);
      setActiveDisplayLocalePreference(pref, input);
    })
    .catch(() => {});

  const handleStorageChange = (
    changes: Record<string, { newValue?: unknown }>,
    areaName?: string,
  ) => {
    if (areaName && areaName !== 'local') return;
    if ('displayLocale' in changes) {
      const nextVal = changes.displayLocale?.newValue;
      const pref: DisplayLocalePreference = (DISPLAY_LOCALE_VALUES as readonly unknown[]).includes(
        nextVal,
      )
        ? (nextVal as DisplayLocalePreference)
        : 'auto';
      setActiveDisplayLocalePreference(pref, input);
    }
  };

  chrome.storage.onChanged?.addListener?.(handleStorageChange);
  return () => {
    disposed = true;
    chrome.storage.onChanged?.removeListener?.(handleStorageChange);
  };
}

export function createActiveUiLocaleProxy<T extends object>(
  byLocale: Readonly<Record<SupportedUiLocale, T>>,
): T {
  const active = (): T => byLocale[getActiveUiLocale()] ?? byLocale.en;
  // 以可擴充的空 target（陣列表用 []）取代任一語系表：語系表即使被 freeze 也不會違反 Proxy 不變式。
  // 描述子一律回報為 configurable 且唯讀；唯一例外是陣列 target 本身不可設定的 length。
  const target = (Array.isArray(byLocale.en) ? [] : {}) as T;
  return new Proxy(target, {
    get: (_target, prop) => Reflect.get(active(), prop),
    has: (_target, prop) => Reflect.has(active(), prop),
    ownKeys: () => Reflect.ownKeys(active()),
    getOwnPropertyDescriptor(innerTarget, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(active(), prop);
      if (!descriptor) return undefined;
      const targetDescriptor = Reflect.getOwnPropertyDescriptor(innerTarget, prop);
      if (targetDescriptor && !targetDescriptor.configurable) {
        return { ...descriptor, configurable: false, writable: targetDescriptor.writable };
      }
      return { ...descriptor, configurable: true, writable: false };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}
