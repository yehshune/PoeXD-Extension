---
status: superseded by ADR-0010
---

# Filter Presets capture the live search form and write through official mutations

Filter Presets reintroduce durable, user-authored criteria after the retired "affix package" feature, but as their own concept: separate from Bookmarks in data and UI (a Bookmark opens a complete search; a preset overlays onto the current one), stored locally per game version, and never part of Bookmark Transfer. A preset is captured by reading the official Vuex store (`state.persistent`) rather than decoding the URL, because the URL is not reliably updated on every form edit (it has been observed to change only after the page regains focus) while the store is; it is applied only through the official mutations (`pushStatGroup`, `setStatGroupValue`, `setStatFilter`, `setPropertyFilter`, `setFilterGroupDisabled`, `setItem`, `setStatus`) followed by the root component's `save(true)`, so the URL, dirty flag and the official app's local state stay consistent with what a user edit would produce. Both PoE 1 and PoE 2 Trade run Vue 3 with a strict Vuex 4 store exposing these mutations (verified 2026-11).

## Considered Options

- **Bookmark type or shared bookmark tree**: rejected; mixing "open" and "overlay" in one list confuses users.
- **Decode presets from URLs**: rejected for capture; the URL is not updated on every form edit.
- **Push raw objects into `stats` (the retired feature's approach)**: rejected; it bypasses official mutations and leaves the URL and dirty state stale.
