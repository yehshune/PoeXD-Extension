/**
 * 在 background 取回 PoB 分享網址的原始代碼。content script 只傳網址過來，這裡重新驗證網址、
 * 檢查選用權限，再以不帶 cookie 的請求取回；回傳的代碼仍由側欄用 decodePobBuildCode 驗證。
 */
import type { extensionMessaging as ExtensionMessaging } from './extension-protocol';
import { POB_SHARE_OPTIONAL_ORIGINS, parsePobShareUrl } from './pob-share-url';

export type PobShareFetchError =
  | 'invalid-url'
  | 'permission'
  | 'not-found'
  | 'http'
  | 'timeout'
  | 'network'
  | 'too-large'
  | 'invalid';

export type PobShareFetchOutcome =
  | { ok: true; code: string }
  | { ok: false; error: PobShareFetchError };

export interface PobShareFetchDeps {
  fetch: typeof fetch;
  hasPermission: (origin: string) => Promise<boolean>;
  timeoutMs?: number;
}

/** 與 decodePobBuildCode 的代碼長度上限一致 */
const MAX_CODE_LENGTH = 400_000;
const DEFAULT_TIMEOUT_MS = 10_000;
/** PoB 代碼是 Base64（標準或 URL 安全），允許換行與空白 */
const CODE_CHARS = /^[A-Za-z0-9+/=_\-\s]+$/;

export async function fetchPobShareCode(
  input: unknown,
  deps: PobShareFetchDeps,
): Promise<PobShareFetchOutcome> {
  const link = typeof input === 'string' ? parsePobShareUrl(input) : undefined;
  if (!link) return { ok: false, error: 'invalid-url' };
  if (link.optionalOrigin && !(await deps.hasPermission(link.optionalOrigin).catch(() => false))) {
    return { ok: false, error: 'permission' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await deps.fetch(link.rawUrl, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'text/plain' },
    });
    // 轉址後必須仍在同一個網站，避免被導到白名單以外
    if (response.url && new URL(response.url).hostname !== new URL(link.rawUrl).hostname) {
      return { ok: false, error: 'invalid' };
    }
    if (response.status === 404) return { ok: false, error: 'not-found' };
    if (!response.ok) return { ok: false, error: 'http' };
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_CODE_LENGTH) {
      return { ok: false, error: 'too-large' };
    }
    const text = await response.text();
    if (text.length > MAX_CODE_LENGTH) return { ok: false, error: 'too-large' };
    const code = text.trim();
    if (!code || !CODE_CHARS.test(code)) return { ok: false, error: 'invalid' };
    return { ok: true, code };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: 'timeout' };
    return { ok: false, error: error instanceof TypeError ? 'network' : 'invalid' };
  } finally {
    clearTimeout(timer);
  }
}

export const POB_SHARE_PERMISSION_PAGE = '/pob-share-permission.html';
export const POBBIN_ORIGIN = POB_SHARE_OPTIONAL_ORIGINS[0];
export const POBBIN_TRANSLATION_SCRIPT_ID = 'pobbin-translation';
export const POBBIN_TRANSLATION_SCRIPT_FILE = 'content-scripts/pobbin-translation.js';

export interface PobbinScriptingPort {
  getRegisteredContentScripts: (filter?: { ids?: string[] }) => Promise<Array<{ id: string }>>;
  registerContentScripts: (
    scripts: Array<{
      id: string;
      matches: string[];
      js: string[];
      runAt?: 'document_start' | 'document_end' | 'document_idle';
      persistAcrossSessions?: boolean;
    }>,
  ) => Promise<void>;
  unregisterContentScripts: (filter: { ids: string[] }) => Promise<void>;
}

/** 依 `https://pobb.in/*` 選用權限狀態，動態註冊或移除 pobb.in 翻譯腳本 */
export async function syncPobbinTranslationContentScript(deps: {
  hasPermission: (origin: string) => Promise<boolean>;
  scripting?: PobbinScriptingPort;
}): Promise<void> {
  const scripting = deps.scripting;
  if (!scripting) return;
  try {
    const [granted, registered] = await Promise.all([
      deps.hasPermission(POBBIN_ORIGIN).catch(() => false),
      scripting
        .getRegisteredContentScripts({ ids: [POBBIN_TRANSLATION_SCRIPT_ID] })
        .catch(() => []),
    ]);
    const isRegistered = registered.some((script) => script.id === POBBIN_TRANSLATION_SCRIPT_ID);
    if (granted && !isRegistered) {
      await scripting.registerContentScripts([
        {
          id: POBBIN_TRANSLATION_SCRIPT_ID,
          matches: [POBBIN_ORIGIN],
          js: [POBBIN_TRANSLATION_SCRIPT_FILE],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    } else if (!granted && isRegistered) {
      await scripting.unregisterContentScripts({ ids: [POBBIN_TRANSLATION_SCRIPT_ID] });
    }
  } catch (error) {
    console.warn('[PoeXD] 無法同步 pobb.in 翻譯腳本註冊狀態:', error);
  }
}

export function registerPobShareBackgroundHandlers(options: {
  messenger: typeof ExtensionMessaging;
  deps?: Partial<PobShareFetchDeps>;
  openPage?: (path: string) => Promise<unknown>;
  scripting?: PobbinScriptingPort;
}): () => void {
  const deps: PobShareFetchDeps = {
    fetch: (...args) => fetch(...args),
    hasPermission: (origin) => chrome.permissions.contains({ origins: [origin] }),
    ...options.deps,
  };
  const openPage =
    options.openPage ??
    ((path: string) => chrome.tabs.create({ url: chrome.runtime.getURL(path) }));
  const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
  const scripting = options.scripting ?? chromeApi?.scripting;
  const syncScript = () => {
    void syncPobbinTranslationContentScript({
      hasPermission: deps.hasPermission,
      scripting,
    });
  };

  syncScript();
  chromeApi?.permissions?.onAdded?.addListener(syncScript);
  chromeApi?.permissions?.onRemoved?.addListener(syncScript);

  const unregFetch = options.messenger.onMessage('pobShare:fetchCode', (message) =>
    fetchPobShareCode(message.data?.url, deps),
  );
  const unregOpen = options.messenger.onMessage('pobShare:openPermissionPage', async () => {
    try {
      await openPage(POB_SHARE_PERMISSION_PAGE);
      return true;
    } catch {
      return false;
    }
  });
  return () => {
    unregFetch();
    unregOpen();
    chromeApi?.permissions?.onAdded?.removeListener(syncScript);
    chromeApi?.permissions?.onRemoved?.removeListener(syncScript);
  };
}
