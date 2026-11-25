/**
 * poexd-data 的英文共用句型分片（schemaVersion 2）載入與還原。
 *
 * `mod-lines.json`、`stat-text-items.json`、`stat-text-passives.json` 發布時把英文模板抽到
 * `locales/en/<file>`（`lines: { hash: 英文模板[] }`），各語系檔只存與英文以位置對齊的譯文
 * （`lines: { hash: (譯文模板 | null)[] }`）。這裡把兩份合回 `[英文, 譯文]` 句型對，
 * 呼叫端直接拿到句型對。
 */
import type { ModLinePairs } from './market-mod-lines';
import {
  getLocaleModLinesAssetPath,
  getLocalePassiveStatTextAssetPath,
  getLocaleStatTextAssetPath,
  type PoeVersion,
} from './trade-context';

export type PairedLineFile = 'mod-lines' | 'stat-text-items' | 'stat-text-passives';

type LoadJson = (path: string) => Promise<unknown>;
type Json = Record<string, unknown>;

export const ALIGNED_LINES_SCHEMA_VERSION = 2;
const ENGLISH_LOCALE = 'en';

/** 呼叫時才取路徑函式，模組載入時不讀 trade-context 的匯出 */
const ASSET_PATHS: Record<PairedLineFile, (version: PoeVersion, locale: string) => string> = {
  'mod-lines': (version, locale) => getLocaleModLinesAssetPath(version, locale),
  'stat-text-items': (version, locale) => getLocaleStatTextAssetPath(version, locale),
  'stat-text-passives': (version, locale) => getLocalePassiveStatTextAssetPath(version, locale),
};

/** 還原後的分片：`[英文, 譯文]` 句型對 */
export interface PairedLineShard {
  patch?: string;
  locale: string;
  lines: Record<string, ModLinePairs>;
}

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 依位置配對英文與譯文；null 表示該語系沒有這句，長度不同的 hash 視為對不齊而略過 */
export function joinAlignedLines(
  english: Readonly<Record<string, readonly string[]>>,
  localized: Readonly<Record<string, ReadonlyArray<string | null>>>,
): Record<string, ModLinePairs> {
  const result: Record<string, ModLinePairs> = {};
  for (const [hash, texts] of Object.entries(localized)) {
    const englishTexts = english[hash];
    if (!Array.isArray(englishTexts) || !Array.isArray(texts)) continue;
    if (englishTexts.length !== texts.length) continue;
    const pairs = texts.flatMap((text, index) =>
      typeof text === 'string' ? [[englishTexts[index], text] as const] : [],
    );
    if (pairs.length > 0) result[hash] = pairs;
  }
  return result;
}

function requireAlignedShard(data: unknown, name: string): Json & { lines: Json } {
  if (
    !isRecord(data) ||
    data.schemaVersion !== ALIGNED_LINES_SCHEMA_VERSION ||
    !isRecord(data.lines)
  ) {
    throw new Error(`${name} 格式不符`);
  }
  return data as Json & { lines: Json };
}

/** 只讀英文模板（`locales/en/<file>`） */
export async function loadEnglishLines(
  loadJson: LoadJson,
  file: PairedLineFile,
  version: PoeVersion,
): Promise<Record<string, readonly string[]>> {
  const shard = requireAlignedShard(
    await loadJson(ASSET_PATHS[file](version, ENGLISH_LOCALE)),
    `${file}.json (en)`,
  );
  return shard.lines as Record<string, readonly string[]>;
}

/**
 * 載入某語系的句型分片並還原成 `[英文, 譯文]`。
 * 語系分片或 en 分片缺少、格式不符，或兩者來自不同 patch 時 reject，與直接載入失敗的處理相同。
 */
export async function loadPairedLineShard(
  loadJson: LoadJson,
  file: PairedLineFile,
  version: PoeVersion,
  locale: string,
): Promise<PairedLineShard> {
  const shard = requireAlignedShard(
    await loadJson(ASSET_PATHS[file](version, locale)),
    `${file}.json (${locale})`,
  );
  const english = requireAlignedShard(
    await loadJson(ASSET_PATHS[file](version, ENGLISH_LOCALE)),
    `${file}.json (en)`,
  );
  if (english.patch !== shard.patch) {
    throw new Error(`${file}.json (en) patch ${String(english.patch)} ≠ ${String(shard.patch)}`);
  }
  if (shard.locale !== locale) throw new Error(`${file}.json (${locale}) 語系不符`);
  return {
    ...(typeof shard.patch === 'string' ? { patch: shard.patch } : {}),
    locale,
    lines: joinAlignedLines(
      english.lines as Record<string, readonly string[]>,
      shard.lines as Record<string, ReadonlyArray<string | null>>,
    ),
  };
}
