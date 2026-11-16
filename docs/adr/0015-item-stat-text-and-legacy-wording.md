---
status: accepted
---

# Item stat text and Legacy Wording for PoB translation

> Data generation for this decision lives in poexd-data (ADR-0013).

The PoB shopping list shows each item's mods in the Display Locale. Until now it translated them only from `mod-lines.json` (ADR-0012), which holds just the stat hashes that appear on the official Trade site, plus the Trade site's own texts as a fallback. Measured against a real build, this left three kinds of lines untranslated: mods that are not on the Trade site (many unique mods, passive tree and skill text), lines whose English GGG has since rewritten (**Legacy Wording**, for example "22% increased Rarity of Items found" in a build exported before 3.30), and a few stat-description placeholder forms poexd-data did not normalize.

poexd-data now publishes two more files in each game batch, built from the same official stat descriptions:

- **`<version>/locales/{zh-TW,zh-CN}/stat-text-items.json`**: every rule of the item stat description files (`stat_descriptions`, plus `tincture_stat_descriptions` and `graft_stat_descriptions` for PoE 1), minus the sentences `mod-lines.json` already has, in the same shape as `mod-lines.json` (stat hash → `[English template, localized template]` pairs). Together with `mod-lines.json` it covers every wording of an item mod. About 0.7 MB (PoE 1) and 1.6 MB (PoE 2) per locale.
- **`<version>/stat-aliases.json`**: per stat hash, `[Legacy Wording template, current English template]` pairs. It is locale-independent; the extension maps a Legacy Wording to the localized template of its current English. Sources: a one-time backfill that compares every Path of Building Community (MIT) export of `stat_descriptions.lua` with the current descriptions (committed in poexd-data as `data/stat-aliases/`), and, on every build, a comparison with the previously published full catalog (below), so future rewrites are recorded automatically. Aliases are chained to the newest wording and dropped when they no longer reach a current one.

The PoB mod translator tries, in order: `mod-lines.json`, `stat-text-items.json`, Legacy Wording, the gem-name and prefix rules, the Trade site texts, and finally a translated tail behind an untranslated prefix. When a Legacy Wording and its current wording differ in direction (an "increased"/"reduced" pair mapped to a signed `+#%`), `translateModLine` converts the value back to its actual sign before formatting it, so "22% reduced …" becomes "-22% …".

poexd-data also publishes a full catalog, `<version>/locales/{zh-TW,zh-CN}/stat-text.json`, with every rule of the item, passive and skill stat description files (33 files for PoE 1, 15 for PoE 2; about 2.6–2.9 MB per locale and game). It is not in the manifest and the extension does not sync it: PoB item text only needs item mods, and the alias tracking reads it on the poexd-data side.

`scripts/sync-data.mjs` whitelists `stat-text-items.json` and `stat-aliases.json` in the `<version>/game` batch and validates them (same patch as `mods-tiers.json`, `schemaVersion` 1, matching locale), mirroring poexd-data's catalog. The translator treats both as optional: before the data is synced, or if either fails to load, it falls back to the previous sources.

## Considered Options

- **Extend `mod-lines.json` to every rule**: rejected; Market Translation chooses one rule per Trade stat id to match the Trade site's wording, while translation of arbitrary game text needs every wording of a hash. Keeping the two files separate keeps Market Translation's behaviour unchanged.
- **Hand-written alias table**: rejected; all translations stay derived from official data. The Legacy Wordings come from earlier exports of the same official descriptions, and the alias only redirects to the current official translation.
- **Only record rewrites from now on**: rejected; text that GGG had already rewritten, which current builds still contain, would stay untranslated.
- **Ship the full catalog in the extension**: rejected; passive and skill wording is not needed to translate PoB item text, and it would roughly triple the size.
- **Ship all 11 locales**: deferred; only `zh-TW` and `zh-CN` have a translator today, and the other locales would multiply the package size.

## Consequences

- The extension package grows by roughly 5 MB uncompressed (two games, two locales, plus the alias files). The files are loaded only when the PoB shopping list translates mods.
- The backfill is re-run by hand in poexd-data (`pnpm seed:aliases`) only if its logic changes; regular builds keep the aliases current.
