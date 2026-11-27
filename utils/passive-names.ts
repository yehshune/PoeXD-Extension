/**
 * 從官方資料組出天賦名稱對照表（小寫英文 → 譯名），供 pobb.in 與市集結果列（星團珠寶底部天賦說明）共用。
 */
import type { ModLinePairs } from './market-mod-lines';

export type PassiveTradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ALLOCATES_FORBIDDEN_EN =
  /^Allocates (.+?) if you have the matching modifier on Forbidden (?:Flesh|Flame)$/;
const ALLOCATES_EN = /^Allocates (.+)$/;
const ALLOCATES_ZH = /配置\s*(.+)$/;
const ADDED_PASSIVE_EN = /^1 Added Passive Skill is (.+)$/;
const ADDED_PASSIVE_ZH = /(?:天賦|天赋)[為为]\s*(.+)$/;

/** `passive-names.json` 的 `names` 轉成「小寫英文 → 譯名」；格式不對時回傳空物件 */
export function readPassiveNames(data: unknown): Record<string, string> {
  const names = isRecord(data) ? data.names : undefined;
  if (!isRecord(names)) return {};
  const result: Record<string, string> = {};
  for (const [english, localized] of Object.entries(names)) {
    if (typeof localized !== 'string') continue;
    const key = english.trim().toLowerCase();
    const value = localized.trim();
    if (key && value && !(key in result)) result[key] = value;
  }
  return result;
}

/** 從官方 `trade-stats` 與 `mod-lines`／`stat-text-items` 抽出天賦名稱（小寫英文 → 譯名） */
export function extractPassiveNameMap(sources: {
  tradeStats?: { english: PassiveTradeStatTexts; localized: PassiveTradeStatTexts };
  modLines?: ReadonlyArray<Readonly<Record<string, ModLinePairs>>>;
}): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (english: string, localized: string) => {
    const key = english.trim().toLowerCase();
    const val = localized.trim();
    if (key && val && !(key in map)) map[key] = val;
  };

  if (sources.tradeStats) {
    const { english, localized } = sources.tradeStats;
    for (const [id, enVal] of Object.entries(english)) {
      const zhVal = localized[id];
      if (typeof enVal !== 'string' || typeof zhVal !== 'string') continue;
      const enMatch = ALLOCATES_FORBIDDEN_EN.exec(enVal) ?? ALLOCATES_EN.exec(enVal);
      const zhMatch = ALLOCATES_ZH.exec(zhVal);
      if (enMatch && zhMatch) put(enMatch[1], zhMatch[1]);
    }
  }

  for (const record of sources.modLines ?? []) {
    for (const pairs of Object.values(record)) {
      if (!Array.isArray(pairs)) continue;
      for (const pair of pairs) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
          continue;
        }
        const enMatch = ADDED_PASSIVE_EN.exec(pair[0]);
        const zhMatch = ADDED_PASSIVE_ZH.exec(pair[1]);
        if (enMatch && zhMatch) put(enMatch[1], zhMatch[1]);
      }
    }
  }

  return map;
}
