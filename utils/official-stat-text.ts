import { ref } from 'vue';
import type { SupportedAffixLocale } from './preferences-contract';
import { getLocaleTradeStatsAssetPath, type PoeVersion } from './trade-context';
import { getCandidateStatIds, renderGenericTemplate } from './affix-lexicon';

/**
 * 官方市集的詞綴文字（各語系市集 /data/stats，以詞綴代碼為 key）。
 *
 * 市集對每個詞綴代碼只有一種寫法，正負向由代碼決定，與詞綴在遊戲裡的實際數值無關
 * （例如能力值需求在遊戲裡是「減少」，市集固定寫「增加」）。詞綴標籤要跟市集一致時用這份；
 * 遊戲寫法（階級列、結果列）仍用 poexd-data 的 tierTemplates。
 */
export const OFFICIAL_STAT_TEXT_LOCALES = ['en', 'zh-TW', 'zh-CN'] as const;
type OfficialStatTextLocale = (typeof OFFICIAL_STAT_TEXT_LOCALES)[number];

type StatTexts = Readonly<Record<string, string | readonly string[]>>;

interface VersionState {
  shards: Map<OfficialStatTextLocale, StatTexts>;
  pending: Map<OfficialStatTextLocale, Promise<boolean>>;
  unavailable: Set<OfficialStatTextLocale>;
}

const stateByVersion = new Map<PoeVersion, VersionState>();
/** 分片載入完成時遞增，讓讀取標籤的 Vue 元件重新渲染 */
const revision = ref(0);

function getState(version: PoeVersion): VersionState {
  let state = stateByVersion.get(version);
  if (!state) {
    state = { shards: new Map(), pending: new Map(), unavailable: new Set() };
    stateByVersion.set(version, state);
  }
  return state;
}

const isOfficialLocale = (locale: string): locale is OfficialStatTextLocale =>
  (OFFICIAL_STAT_TEXT_LOCALES as readonly string[]).includes(locale);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseStatTexts(data: unknown): StatTexts | null {
  if (!isRecord(data) || !isRecord(data.stats)) return null;
  const valid = Object.values(data.stats).every(
    (value) =>
      typeof value === 'string' ||
      (Array.isArray(value) && value.every((text) => typeof text === 'string')),
  );
  return valid ? (data.stats as StatTexts) : null;
}

function resolveAssetUrl(assetPath: string): string {
  const runtimeGetUrl = (globalThis as any).chrome?.runtime?.getURL;
  return typeof runtimeGetUrl === 'function' ? runtimeGetUrl(assetPath) : assetPath;
}

async function fetchShard(version: PoeVersion, locale: OfficialStatTextLocale) {
  const res = await fetch(resolveAssetUrl(getLocaleTradeStatsAssetPath(version, locale)));
  return parseStatTexts(res?.ok ? await res.json() : null);
}

/** 載入指定語系的官方詞綴文字；沒有官方資料的語系或載入失敗回傳 false，且不重複請求 */
export async function ensureOfficialStatTextLoaded(
  version: PoeVersion,
  locale: SupportedAffixLocale | string,
): Promise<boolean> {
  if (!isOfficialLocale(locale)) return false;
  const state = getState(version);
  if (state.shards.has(locale)) return true;
  if (state.unavailable.has(locale)) return false;
  const inflight = state.pending.get(locale);
  if (inflight) return inflight;

  const promise = fetchShard(version, locale)
    .catch(() => null)
    .then((stats) => {
      state.pending.delete(locale);
      if (!stats) {
        state.unavailable.add(locale);
        return false;
      }
      state.shards.set(locale, stats);
      revision.value += 1;
      return true;
    });
  state.pending.set(locale, promise);
  return promise;
}

function lookupRaw(stats: StatTexts | undefined, statId: string): string | null {
  if (!stats) return null;
  for (const candidate of getCandidateStatIds(statId)) {
    const value = stats[candidate];
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return null;
}

/**
 * 詞綴代碼在該語系市集的寫法，格式與詞綴字典的標籤相同（`#` 佔位、英文小寫）。
 * 尚未載入時在背景載入並回傳 null；中文市集回傳的仍是英文原文時也視為沒有翻譯。
 */
export function getOfficialStatLabel(
  statId: string,
  version: PoeVersion,
  locale: SupportedAffixLocale | string,
): string | null {
  void revision.value;
  if (!statId || !isOfficialLocale(locale)) return null;
  const state = getState(version);
  const stats = state.shards.get(locale);
  if (!stats) {
    void ensureOfficialStatTextLoaded(version, locale);
    return null;
  }
  const text = lookupRaw(stats, statId);
  if (!text) return null;
  if (locale !== 'en') {
    // 英文載入前先採用；載入後 revision 遞增，讀取者會重新判斷
    if (!state.shards.has('en')) void ensureOfficialStatTextLoaded(version, 'en');
    if (text === lookupRaw(state.shards.get('en'), statId)) return null;
  }
  return renderGenericTemplate(text, locale);
}

/** 測試用：直接指定某語系的官方詞綴文字；傳入 null 清除 */
export function setMockOfficialStatText(
  version: PoeVersion,
  locale: OfficialStatTextLocale,
  stats: StatTexts | null,
): void {
  const state = getState(version);
  if (stats) state.shards.set(locale, stats);
  else state.shards.delete(locale);
  revision.value += 1;
}

/** 測試用：清除所有已載入與失敗紀錄 */
export function resetOfficialStatTextForTests(): void {
  stateByVersion.clear();
  revision.value += 1;
}
