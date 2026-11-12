import { isSupportedTradeHost } from './trade-realms';

export type PoeVersion = 'poe1' | 'poe2';

export interface TradeVersionProfile {
  version: PoeVersion;
  routeRoot: 'trade' | 'trade2';
  searchVersionSegment?: 'poe2';
  defaultTitle: string;
  dataDirectory: 'poe1' | 'poe2';
  modsTiersFile: 'mods-tiers.json';
}

export const tradeVersionProfiles: Record<PoeVersion, TradeVersionProfile> = {
  poe1: {
    version: 'poe1',
    routeRoot: 'trade',
    defaultTitle: 'Path of Exile - Trade',
    dataDirectory: 'poe1',
    modsTiersFile: 'mods-tiers.json',
  },
  poe2: {
    version: 'poe2',
    routeRoot: 'trade2',
    searchVersionSegment: 'poe2',
    defaultTitle: 'Trade - Path of Exile',
    dataDirectory: 'poe2',
    modsTiersFile: 'mods-tiers.json',
  },
};

export function getModsTiersAssetPath(version: PoeVersion): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/${profile.modsTiersFile}`;
}

export function getLocaleStatsAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/stats.json`;
}

export function getLocaleItemsAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/items.json`;
}

/** 官方市集 /data/stats 的詞綴文字（scripts/update-market-translation.mjs 產生） */
export function getLocaleTradeStatsAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/trade-stats.json`;
}

export function getLocaleTradeFiltersAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/trade-filters.json`;
}

export interface ParsedTradePath {
  version: PoeVersion;
  parts: string[];
  leagueIndex?: number;
}

export function parseTradePath(pathname: string): ParsedTradePath | undefined {
  const parts = pathname.split('/').filter(Boolean);
  const version =
    parts[0] === tradeVersionProfiles.poe2.routeRoot
      ? 'poe2'
      : parts[0] === tradeVersionProfiles.poe1.routeRoot
        ? 'poe1'
        : undefined;
  if (!version) return undefined;

  const resultIndex = parts.findIndex((part) => part === 'search' || part === 'exchange');
  if (resultIndex !== 1) return { version, parts };
  const profile = tradeVersionProfiles[version];
  const hasExpectedSegment = profile.searchVersionSegment
    ? parts[resultIndex + 1] === profile.searchVersionSegment
    : parts[resultIndex + 1] !== tradeVersionProfiles.poe2.searchVersionSegment;
  if (!hasExpectedSegment) return undefined;

  return {
    version,
    parts,
    leagueIndex: resultIndex + (profile.searchVersionSegment ? 2 : 1),
  };
}

export function getPoeVersion(pathname = window.location.pathname): PoeVersion {
  const routeRoot = pathname.split('/').filter(Boolean)[0];
  return routeRoot === tradeVersionProfiles.poe2.routeRoot ? 'poe2' : 'poe1';
}

export interface TradeUrlContext {
  isTradePage: boolean;
  version: PoeVersion;
}

export function detectTradeContextFromUrl(rawUrl?: string): TradeUrlContext {
  if (!rawUrl) {
    return { isTradePage: false, version: 'poe1' };
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { isTradePage: false, version: 'poe1' };
    }
    if (!isSupportedTradeHost(url.hostname)) {
      return { isTradePage: false, version: 'poe1' };
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const tradeSegment = parts[0] === 'api' ? parts[1] : parts[0];
    if (tradeSegment === tradeVersionProfiles.poe2.routeRoot) {
      return { isTradePage: true, version: 'poe2' };
    }
    if (tradeSegment === tradeVersionProfiles.poe1.routeRoot) {
      return { isTradePage: true, version: 'poe1' };
    }
    return { isTradePage: false, version: 'poe1' };
  } catch {
    return { isTradePage: false, version: 'poe1' };
  }
}

export async function queryActiveTabTradeContext(): Promise<TradeUrlContext> {
  try {
    if (typeof chrome !== 'undefined' && chrome?.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return detectTradeContextFromUrl(tab?.url);
    }
  } catch {
    // 預設為非官網 poe1
  }
  return { isTradePage: false, version: 'poe1' };
}

export function getTradeLeague(pathname = window.location.pathname) {
  const path = parseTradePath(pathname);
  if (path?.leagueIndex === undefined) return undefined;
  const league = decodeRepeatedly(path.parts[path.leagueIndex] || '')
    .trim()
    .replace(/\s+/g, ' ');
  return league || undefined;
}

export function getTradeVersionProfile(version: PoeVersion) {
  return tradeVersionProfiles[version];
}

export function decodeRepeatedly(value: string) {
  let decoded = value;
  for (let count = 0; count < 5; count += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}
