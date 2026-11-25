/**
 * 測試用：把記憶體內的形狀轉成 poexd-data 發布的格式（ADR-0019）。
 *
 * - `publishedStats`：各語系各自帶索引的 LocaleStatsShard → 索引共用的 mods-tiers.json 與只有模板陣列的 stats.json。
 * - `publishedLines`：各語系的 `[英文, 譯文]` 句型對 → en 共用英文分片與位置對齊的譯文分片。
 */
import type { LocaleStatsShard, ModsTiersArtifact } from '@/utils/affix-lexicon';

export function publishedStats<L extends string>(
  modsTiers: ModsTiersArtifact,
  shards: Record<L, LocaleStatsShard>,
) {
  const locales = Object.keys(shards) as L[];
  const keys: string[] = [];
  const intern = (texts: Array<string | null>) => {
    const key = JSON.stringify(texts);
    if (!keys.includes(key)) keys.push(key);
    return keys.indexOf(key);
  };
  const textAt = (locale: L, index: number | undefined) =>
    index === undefined ? null : (shards[locale].templates[index] ?? null);
  const tierCount = Math.max(0, ...locales.map((locale) => shards[locale].tierTemplates.length));
  const tierTemplates = Array.from({ length: tierCount }, (_, tier) =>
    intern(locales.map((locale) => textAt(locale, shards[locale].tierTemplates[tier]))),
  );
  const statIds = new Set(locales.flatMap((locale) => Object.keys(shards[locale].statTemplates)));
  const statTemplates = Object.fromEntries(
    [...statIds].map((id) => [
      id,
      intern(locales.map((locale) => textAt(locale, shards[locale].statTemplates[id]))),
    ]),
  );
  const stats = Object.fromEntries(
    locales.map((locale, position) => [
      locale,
      {
        schemaVersion: 2,
        patch: modsTiers.patch,
        locale,
        templates: keys.map((key) => (JSON.parse(key) as Array<string | null>)[position] ?? ''),
      },
    ]),
  ) as Record<L, { schemaVersion: 2; patch?: string; locale: L; templates: string[] }>;
  return {
    modsTiers: {
      schemaVersion: 2,
      ...modsTiers,
      templateCount: keys.length,
      tierTemplates,
      statTemplates,
    },
    stats,
  };
}

type PairLines = Record<string, ReadonlyArray<readonly [string, string]>>;

export function publishedLines(byLocale: Record<string, PairLines>, patch?: string) {
  const english: Record<string, string[]> = {};
  const rows: Record<string, Record<string, Map<number, string>>> = {};
  for (const [locale, lines] of Object.entries(byLocale)) {
    rows[locale] = {};
    for (const [hash, pairs] of Object.entries(lines)) {
      const list = (english[hash] ??= []);
      const row = new Map<number, string>();
      let cursor = -1;
      for (const [en, text] of pairs) {
        let index = list.findIndex((candidate, i) => i > cursor && candidate === en && !row.has(i));
        if (index < 0) index = list.push(en) - 1;
        row.set(index, text);
        cursor = index;
      }
      rows[locale][hash] = row;
    }
  }
  const shard = (locale: string, lines: unknown) => ({
    schemaVersion: 2,
    ...(patch !== undefined ? { patch } : {}),
    locale,
    lines,
  });
  return {
    en: shard('en', english),
    ...Object.fromEntries(
      Object.entries(rows).map(([locale, byHash]) => [
        locale,
        shard(
          locale,
          Object.fromEntries(
            Object.entries(byHash).map(([hash, row]) => [
              hash,
              english[hash].map((_, i) => row.get(i) ?? null),
            ]),
          ),
        ),
      ]),
    ),
  } as Record<string, ReturnType<typeof shard>>;
}
