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

poexd-data also publishes a full catalog, `<version>/locales/{zh-TW,zh-CN}/stat-text.json`, with every rule of the item, passive and skill stat description files (33 files for PoE 1, 15 top-level files plus `specific_skill_stat_descriptions` for PoE 2). It is not in the manifest and the extension does not sync it: the extension instead syncs the smaller domain-split shards (`stat-text-items.json`, `stat-text-passives.json`, `stat-text-skills.json`), while alias tracking reads the full catalog on the poexd-data side.

**Passive stat text and passive names for pobb.in and trade results (added 2026-11-17, wired to trade results 2026-11-27)**: When `pobb.in` share-page translation was added (using the same official data shards under optional `https://pobb.in/*` permission), passive tree nodes, masteries, and cluster jewel notables/enchants needed passive descriptions and passive names that `stat-text-items.json` and `trade-stats.json` do not cover. The `<version>/game` batch in `scripts/sync-data.mjs` and `web_accessible_resources` therefore sync and serve `<version>/locales/{zh-TW,zh-CN}/stat-text-passives.json` and `<version>/locales/zh-TW/passive-names.json` (with trade-derived passive names still taking precedence). Trade result translation (`market-result-translator.ts`) also uses them for cluster jewel notable blocks (`notableProperties`).

**Skill stat text for trade result skill gems (added 2026-11-27)**: Official Trade search results render skill gem effect lines (`explicitMods` in PoE 1, `gemTabs` in PoE 2 `.gem-popup`) without `data-field="stat.*"` ids, so they rely on sentence matching. `poexd-data` now publishes `<version>/locales/{en,zh-TW,zh-CN}/stat-text-skills.json` (`schemaVersion` 2, deduplicated against `mod-lines`, `stat-text-items`, and `stat-text-passives`, covering top-level skill/gem descriptions plus PoE 2 `specific_skill_stat_descriptions/**/*.csd`; ≈0.51 MB compressed across both games and both locales). `market-result-translator.ts` lazy-loads `stat-text-skills.json` on demand only when an unmatched mod line without `data-field` is encountered, keeping normal gear searches at zero extra runtime cost.

**Scoped PoB-only fallback terms for pobb.in (added 2026-11-26)**: Official game tables (`result-labels.json`, now including PoE 1 `Quest` and `PantheonPanelLayout` via `poexd-data`) remain the primary source for all game names, gem vendor info, and Pantheon gods, and pobb.in abbreviations (`ES`, `Resistances`, `Crit Chance`, etc.) first alias to official full names before lookup. For PoB-only summary metrics and config/bandit/timeless-jewel strings that do not exist in official client tables (such as `eHP`, `Phys/Fire/Cold/Lightning/Chaos Max Hit`, `Evade`, `Hit Rate`, `Crit Multi`, `Custom Mods`, `Kill All`, and `Passives in radius are Conquered by the …`), the extension keeps a small scoped fallback table in `utils/pobbin-pob-terms.ts` queried only after official data misses; pobb.in's own site UI chrome (`Loadout`, `Gear`, `Gems`, `Copy`, etc.) remains untranslated.

poexd-data's catalog puts `stat-text-items.json`, `stat-aliases.json`, `stat-text-passives.json`, `stat-text-skills.json`, and `passive-names.json` in the `<version>/game` batch, and `scripts/sync-data.mjs` validates them (same patch as `mods-tiers.json`, matching locale; since ADR-0019 the line shards use `schemaVersion` 2 with the English text in a shared `en` shard). The translator treats them as optional: before the data is synced, or if any file fails to load, it falls back to the previous sources.

## Considered Options

- **Extend `mod-lines.json` to every rule**: rejected; Market Translation chooses one rule per Trade stat id to match the Trade site's wording, while translation of arbitrary game text needs every wording of a hash. Keeping the two files separate keeps Market Translation's behaviour unchanged.
- **Hand-written alias table**: rejected; all translations stay derived from official data. The Legacy Wordings come from earlier exports of the same official descriptions, and the alias only redirects to the current official translation.
- **Only record rewrites from now on**: rejected; text that GGG had already rewritten, which current builds still contain, would stay untranslated.
- **Ship the full `stat-text.json` catalog in the extension**: rejected; shipping the merged catalog would include atlas/map/monster noise and force every consumer to load all wording together. Passive and skill wording are shipped as separate deduplicated v2 shards (`stat-text-passives.json`, `stat-text-skills.json`, plus `passive-names.json` for `zh-TW`), with `stat-text-skills.json` lazy-loaded on demand.
- **Ship all 11 locales**: deferred; only `zh-TW` and `zh-CN` have a translator today, and the other locales would multiply the package size.

## Consequences

- The extension package grows by roughly 5 MB uncompressed (two games, two locales, plus the alias files). The files are loaded only when the PoB shopping list translates mods.
- The backfill is re-run by hand in poexd-data (`pnpm seed:aliases`) only if its logic changes; regular builds keep the aliases current.
