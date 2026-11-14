---
status: accepted
---

# Live Trade Data from the current page overrides bundled Trade labels

Bundled data reaches users only with an extension release (ADR-0013), so after a game patch our Trade labels lag the official site until we sync, test and ship. On 2026-11-14 PoE 1 3.30 renamed the `map_filters` group, removed the `chart_*` and `map_gold` filters and added `map_bonus`, `viscera`, `twice_corrupted` and others; the official page showed them the same day, our sidebar only after the next release.

The official Trade page already loads exactly the data we need: every page load fetches `/api/trade{,2}/data/{filters,stats,static,items}` from its own origin (verified for ADR-0012) and keeps the results on its Vue 3 root component as `static_.propertyFilters` and `static_.knownStats`. Verified on 2026-11-14 on the international PoE 1 and PoE 2 sites and the Japanese realm: both are identical to the API `result` arrays, in the same order and including duplicate stat ids (see the implementation plan for the coupling points). `knownStatsFlat`, which `poe-runtime-reader.ts` already forwards, keeps the last occurrence of a duplicate id, while bundled `trade-stats.json` lookups take the first, so Trade Wording is read from `knownStats`.

We add **Live Trade Data (即時市集資料)**: the Trade filter labels (groups, fields, options) and stat Trade Wording (including pseudo stats) that the current Trade page itself has loaded. The extension reads it from the page instead of requesting it, and uses it ahead of bundled data under these rules:

- **Same locale only.** Live Trade Data is used only when the resolved Display Locale equals the Page Locale (ADR-0011), for example `zh-TW` on `pathofexile.tw`, `ja` on `jp.pathofexile.com`, or `en` on the international site, and Market Translation is not active. When they differ (Market Translation, or a pinned Display Locale on another realm), the bundled shards stay the only source; the page's data is in the wrong language, and under Market Translation the page state already holds our bilingual translated text while `<html lang>` stays `en-US` (verified).
- **Per-id overlay, bundled fallback.** A live entry wins over the bundled entry with the same id; ids that the live data lacks keep the bundled text, then the existing UI locale → `en` fallback chain. The bundled files stay in the package and remain the only source on extension pages, before the page has loaded its data, and on any failure.
- **Labels only.** Live Trade Data never creates ids, never changes values sent to the Trade API, and never feeds Search Record, Bookmark or query handling. It only replaces the text shown for ids we already render.
- **No requests, no storage.** It adds no network request, no `host_permissions` entry and no privacy-policy change. It lives in memory for one Search Observation Session and is never written to `chrome.storage`, so a stale copy can never outlive the page that produced it.
- **Untrusted input.** The data crosses from the page's MAIN world, where any page script can forge events, so the isolated world validates shape, types and size, drops anything unexpected, and renders it only as text.

Game-data artifacts (tier tables, Game Wording, result-row labels, item names, mercenary data) have no official API source and stay bundled-only. Market Translation shards stay bundled-only because their source is another realm's API (ADR-0012).

## Considered Options

- **Request the official data APIs ourselves from the content script**: rejected; the page already performs these requests on every load, so a second copy only adds load against the Trade API's rate limits for the same bytes.
- **Fetch poexd-data at runtime (jsDelivr / GitHub raw)**: deferred, not rejected (ADR-0013). It would also refresh game data, but it needs a new host permission and a privacy-policy update. Using `optional_host_permissions` behind an opt-in Preference may avoid Chrome disabling the extension on update; that has to be verified before a separate ADR.
- **Replace the bundled Trade shards with Live Trade Data**: rejected; extension pages, the sidebar before the page has loaded, Market Translation and cross-realm Display Locales still need them, and a page change on GGG's side would leave us with no labels at all.
- **Persist the last Live Trade Data to `chrome.storage` as a cache**: rejected; it would show one realm's or one patch's labels in another context, costs serializing megabytes per write (the reason `poexdKnownStats` moved to memory), and the page reloads the data on every visit anyway.
- **Merge live and bundled data across locales**: rejected; mixing a live English label into a Chinese bundled set is the "wrong language" failure ADR-0011 avoids. Locales are never mixed; only the per-id fallback chain that already exists applies.

## Consequences

- `trade-filters-store.ts` and `official-stat-text.ts` gain a live source that sits before the bundled shards in their lookup order, and their revision counters bump when live data arrives so the sidebar re-renders.
- Locales that have no bundled Trade Wording today (`ja`, `ru`, `de`, `fr`, `es`, `pt`, `th`) get it on their own realm, and the `ko` shard that poexd-data cannot refresh (`staleLocales`) matters less wherever the page can be read.
- The page's state shape and the data endpoints become coupling points next to the ones listed for Market Translation. When reading fails, the feature silently falls back to bundled data; e2e checks that the live path is taken on a supported realm.
- Weekly Trade rebuilds in poexd-data and the daily sync stay; they still serve extension pages, cross-locale display and the first render before the page's data is read.
