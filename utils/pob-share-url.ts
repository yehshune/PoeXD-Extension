/**
 * PoB 分享網址：使用者在匯入對話框貼上分享頁網址時，換成該站提供原始代碼的網址。
 *
 * 只接受白名單網站與固定路徑格式，網址來自使用者輸入，視為不可信：不接受帳密、自訂連接埠、
 * 其他路徑，換出的原始代碼網址一律由這裡組出，不沿用輸入的路徑或參數。
 *
 * - poe.ninja：已在 `host_permissions`，不需額外授權。分享頁 `/{poe1|poe2}/pob/<id>`，
 *   原始代碼 `/{poe1|poe2}/pob/raw/<id>`；舊網址 `/pob/<id>` 官網會轉到 poe1（2026-11 實測）。
 * - pobb.in、pastebin.com：選用權限（`optional_host_permissions`），使用者在授權頁同意後才能取用。
 */
import type { PoeVersion } from './trade-context';

export type PobShareSite = 'poe-ninja' | 'pobb-in' | 'pastebin';

export interface PobShareLink {
  site: PobShareSite;
  /** 取回原始代碼的網址 */
  rawUrl: string;
  /** 需要選用權限時，要授權的來源（`chrome.permissions` 的 origins 格式） */
  optionalOrigin?: string;
}

/** manifest 的 optional_host_permissions，與授權頁共用 */
export const POB_SHARE_OPTIONAL_ORIGINS = ['https://pobb.in/*', 'https://pastebin.com/*'] as const;

const MAX_INPUT_LENGTH = 512;
const POE_NINJA_PATH = /^\/(?:(poe1|poe2)\/)?pob\/(?:raw\/)?([A-Za-z0-9_-]{1,64})\/?$/;
const POBB_IN_PATH = /^\/([A-Za-z0-9_-]{4,64})(?:\/raw)?\/?$/;
const PASTEBIN_PATH = /^\/(?:raw\/)?([A-Za-z0-9]{4,32})\/?$/;

/** 輸入看起來是網址（而不是 PoB 代碼）；代碼只含 Base64 字元，不會有 `://` */
export const looksLikePobShareUrl = (input: string): boolean =>
  /^\s*https?:\/\//i.test(input) ||
  /^\s*(?:www\.)?(?:poe\.ninja|pobb\.in|pastebin\.com)\//i.test(input);

function toUrl(input: string): URL | undefined {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return undefined;
  }
}

export function parsePobShareUrl(input: string): PobShareLink | undefined {
  if (typeof input !== 'string') return undefined;
  const url = toUrl(input);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return undefined;
  if (url.username || url.password || url.port) return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'poe.ninja') {
    const match = POE_NINJA_PATH.exec(url.pathname);
    if (!match) return undefined;
    const version: PoeVersion = match[1] === 'poe2' ? 'poe2' : 'poe1';
    return { site: 'poe-ninja', rawUrl: `https://poe.ninja/${version}/pob/raw/${match[2]}` };
  }
  if (host === 'pobb.in') {
    const match = POBB_IN_PATH.exec(url.pathname);
    if (!match) return undefined;
    return {
      site: 'pobb-in',
      rawUrl: `https://pobb.in/${match[1]}/raw`,
      optionalOrigin: POB_SHARE_OPTIONAL_ORIGINS[0],
    };
  }
  if (host === 'pastebin.com') {
    const match = PASTEBIN_PATH.exec(url.pathname);
    if (!match) return undefined;
    return {
      site: 'pastebin',
      rawUrl: `https://pastebin.com/raw/${match[1]}`,
      optionalOrigin: POB_SHARE_OPTIONAL_ORIGINS[1],
    };
  }
  return undefined;
}
