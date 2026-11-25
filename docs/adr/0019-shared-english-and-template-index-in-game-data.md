---
status: accepted
---

# Shared English lines and a shared template index in game data shards

> Data generation for this decision lives in poexd-data (ADR-0013). It changes the shard format of ADR-0011, ADR-0012 and ADR-0015.

Two shard families in the `<version>/game` batch repeated the same data in every locale:

- `mod-lines.json`, `stat-text-items.json` and `stat-text-passives.json` stored `stat hash → [English template, localized template][]` for zh-TW and zh-CN. The English half was 99% identical between the two locales.
- `stats.json` deduplicated templates per locale, so every one of the 11 locales carried its own `tierTemplates` (one index per tier, 17k for PoE 1) and `statTemplates` (one per Trade stat id).

poexd-data now publishes these with `schemaVersion` 2:

- **Aligned line shards**: `locales/en/<file>` holds `lines: { hash: English template[] }` for all locales; `locales/{zh-TW,zh-CN}/<file>` holds `lines: { hash: (localized template | null)[] }` aligned by position with the English array (`null` = this locale has no such line). `utils/paired-line-shards.ts` (`loadPairedLineShard`) joins the two back into the original `[English, localized]` pairs, so the translators are unchanged; `loadStatMatcher` reads only the English shard (`loadEnglishLines`). The full catalog `stat-text.json` is not shipped and keeps `schemaVersion` 1.
- **Shared template index**: `mods-tiers.json` carries `templateCount`, `tierTemplates` and `statTemplates`; each `locales/<locale>/stats.json` is `{ schemaVersion, patch, locale, templates }` with exactly `templateCount` templates, indexed by the shared index. The index deduplicates on the tuple of all locales' texts, so any locale looks up exactly the text it had before. `affix-lexicon.ts` attaches the shared index when it loads a shard.

When the format was introduced, joining the new shards reproduced the previously published content byte for byte (checked once against 3.30.0.4.3 / 0.5.5.10; the build does not repeat this check). For those patches the changed files go from 22.9 MB to 18.4 MB, and `public/json` from 36 MB to 32 MB. The saving is less than the English share of the text suggests, because CJK characters take 3 bytes in UTF-8 while English takes 1.

`scripts/sync-data.mjs` and poexd-data's `batch-validation.ts` both require the new format: `mods-tiers.json` must carry an index covering every tier, every `stats.json` must have `templateCount` templates, and every localized line shard needs `en/<file>` with the same hashes and array lengths. The runtime loaders accept only the new format: the extension ships its own synced data, so it never meets the old one. Tests build their fixtures in the published format with `tests/helpers/game-data-fixtures.ts`. poexd-data's verify gate skips the shrink check for a file whose `schemaVersion` changed, so the first deploy of the new format needs no `allow_shrink`.

## Considered options

- **Keep the English text inside each localized file but drop duplicates through a shared string table**: rejected; it adds an indirection on every lookup and still needs a shared file, with no size advantage over a plain English shard.
- **Columnar `mods-tiers.json` tiers (tuples instead of objects)**: deferred; it would cut the file about 40% before compression but touches every tier consumer, and the store download is already compressed.
