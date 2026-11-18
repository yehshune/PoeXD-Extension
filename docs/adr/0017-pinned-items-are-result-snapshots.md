---
status: accepted
---

# Pinned Items are result snapshots rendered with the official card classes

Users want to keep a few Trade results to come back to and compare, above all in the LiveSearch Primary Page, where results keep arriving and older rows fall off the display cap (issue #12). We add **Pinned Items (釘選物品)**: a pin button in the result row's hover toolbar saves a snapshot, and a Sidebar pane lists the snapshots as cards styled like official results.

Verified on 2026-11-18 against the international PoE 1 site over CDP:

- An official `/fetch` result is `{ id, listing, item }`. An instant buyout listing (`status: securable`) has `hideout_token` and `fee` but no `whisper`. A regular listing has `whisper` and `whisper_token`. The whisper text is written in the seller's language.
- Both tokens are JWTs whose payload carries `exp`. A token is valid for about 5 minutes after `/fetch` returns it. `/fetch` returns a `hideout_token` only when it is called with a valid `query` (search ID). Without one, the item comes back without a token. An unknown or removed item comes back as `null`.
- The official Travel to Hideout button calls `POST /api/trade/whisper` with `{ token }`. `success: false` means the item is in demand, and clicking again sends `{ token, continue: true }`. Error `code 1` (HTTP 404, "Item no longer available") means the item is sold, and the official page marks the card as gone. A sold item is still returned by `/fetch` with its `hideout_token`, plus a top-level `gone: true`, so it must be treated as sold before any whisper is sent. Verified live with an account that was not in game: the whisper for a live item returns HTTP 400 `code 2` ("Your account must be in-game"), and the endpoint is limited per account (15/60s, 75/600s, 300/3600s, 900/21600s).
- Official result styling is scoped by `#trade …` and `.results …`, and the stylesheet file names carry a hash.
- Market Translation translates result rows in the DOM only, so `/fetch` JSON stays in the realm's own language (ADR-0012).

## Decision

1. **A Pinned Item is a result, not criteria.** It stores a whitelisted copy of the item JSON and listing, plus realm, league, source search ID and page locale. It stores no Trade query criteria, so ADR-0004 and ADR-0008 still hold. The source search ID is only used to reopen the search and to refetch the item.
2. **No tokens are stored.** `hideout_token` and `whisper_token` stay in memory in the page's result cache. When the user clicks Travel to Hideout, we use a cached token that is still valid, or refetch `/fetch/{id}?query={source search}` through the rate gate for a fresh one, then call the official whisper endpoint once. We do not retry, schedule or batch it. `null` marks the item as sold. An item without a token asks the user to reopen the source search.
3. **Realm-bound actions.** Whisper and Travel to Hideout are disabled when the current page is on another realm (ADR-0007 makes Bookmarks realm-independent, but listings are not). The source search opens on the realm the item was pinned from.
4. **Background-owned storage.** Snapshots live in `chrome.storage.local` under `poexdPinnedItemsV1_<version>`, at most 50 per game version. The Background serializes writes and re-validates every snapshot. Pages read storage directly and follow `storage.onChanged`. At the limit, new pins are rejected with a notice instead of dropping the oldest. Pinned Items are local only and are not part of Bookmark Transfer.
5. **Cards are built from JSON with official classes, in their own shadow root.** A renderer builds the card with official class names (`item-popup--<rarity>`, `item-popup__property`, `item-mod--<kind>`) using `textContent` only. Each card sits in a nested shadow root that links the official stylesheets found in `document.styleSheets` at runtime, so the official CSS styles the card without leaking into the Sidebar.
6. **One result cache per page.** Official fetch responses (MAIN-world interception) and the console's own `/fetch` results feed one in-memory `TradeResultCache`. PoB copy, external links and pinning read from it, so the console gets PoB copy data too.

## Considered Options

- **Clone the official `.row` DOM**: rejected. Official Vue handlers (whisper, travel) stop working, PoeXD's injected buttons get cloned along, and the DOM cannot be persisted across reloads.
- **Store the token with the snapshot**: rejected. It expires in about 5 minutes and is bound to the search, so a stored copy is useless and only widens what we keep.
- **Write storage from each tab**: rejected. Two tabs pinning at once would overwrite each other with read-modify-write.
- **Drop the oldest pin at the limit**: rejected. Pins are deliberate, so silently removing one is surprising.

## Consequences

- Official class names and the whisper endpoint become coupling points, like the existing result enhancements.
- The whisper endpoint's rate-limit policy and its response when the user is signed out are not verified yet. The whisper gate never retries on 429.
- Phase 2 (side-by-side comparison) can align mods by `extended.hashes`, which the whitelist keeps.
