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

/** 官方市集 /data/stats 的詞綴文字（poexd-data 產生，pnpm data:sync 同步） */
export function getLocaleTradeStatsAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/trade-stats.json`;
}

/** 市集漢化（ADR-0012）的官方 /data/static 譯名，只有 zh-TW、zh-CN */
export function getLocaleTradeStaticAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/trade-static.json`;
}

/** 市集漢化（ADR-0012）的官方 /data/items disc 條目與後綴譯名，只有 zh-TW、zh-CN */
export function getLocaleTradeItemsAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/trade-items.json`;
}

/** 市集漢化結果列的遊戲寫法變體（poexd-data 產生）：zh-TW、zh-CN 的譯文，與 en 的共用英文（ADR-0019） */
export function getLocaleModLinesAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/mod-lines.json`;
}

/** 物品詞綴描述檔裡 mod-lines 沒收錄的句子（poexd-data 的 stat-text-items.json），格式同 mod-lines */
export function getLocaleStatTextAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/stat-text-items.json`;
}

/** 天賦描述檔裡 mod-lines 與 stat-text-items 都沒收錄的句子（pobb.in 天賦樹與星團結果列用） */
export function getLocalePassiveStatTextAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/stat-text-passives.json`;
}

/** 技能寶石描述檔裡其餘分片未收錄的句子（結果列寶石效果行按需懶載入） */
export function getLocaleSkillStatTextAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/stat-text-skills.json`;
}

/** 遊戲資料表的天賦名稱表（英文 → 譯名；只有 zh-TW） */
export function getLocalePassiveNamesAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/passive-names.json`;
}

/** 舊英文寫法別名（stat hash → [舊英文模板, 現行英文模板]，poexd-data 產生），與語系無關 */
export function getStatAliasesAssetPath(version: PoeVersion): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/stat-aliases.json`;
}

/** 市集漢化結果列標籤（poexd-data 產生），只有用戶端有資料的 zh-TW */
export function getLocaleResultLabelsAssetPath(version: PoeVersion, locale: string): string {
  const profile = tradeVersionProfiles[version];
  return `json/${profile.dataDirectory}/locales/${locale}/result-labels.json`;
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
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
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
