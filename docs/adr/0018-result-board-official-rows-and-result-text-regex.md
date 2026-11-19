---
status: accepted
---

# Result Board reads official result rows only, and Stash Search Regex uses the result's own text

Players want the results of one Trade search gathered in the Sidebar so they can filter, sort and group them, above all to find a Seller who holds several of the results they want and buy them in one hideout visit. Today almost every listing is instant buyout, so the useful follow-up is not a whisper but text that lights up the chosen items in that Seller's stash. We add the **Result Board (搜尋結果看板)** and the **Stash Search Regex (倉庫搜尋 regex)**.

Observed on 2026-11-19 against the international PoE 1 site over CDP: a search lists at most 100 result ids ("Showing 100 results (10000+ matched)"), the official page fetches them 10 at a time, and further batches are fetched only through its own "load more" button. Official fetch responses already feed PoeXD's in-memory `TradeResultCache` (ADR-0017).

## Decision

1. **The board only shows official result rows.** "Load more" and "load all" on the board drive the official page's own "load more" one batch at a time, waiting for each official fetch to finish (plus a short pause) and stopping on an error or rate limit, at 100 results, when the button disappears, when the user stops, or when the search changes. PoeXD never calls `/fetch` for the board itself. Every board entry is therefore also an official row, so locating and highlighting it always works, and the existing result enhancements (converted price, mod highlight, Market Translation) apply to it unchanged.
2. **The board does not change the official list.** Its filters and sorting live in the Sidebar only; the official rows keep their order and visibility.
3. **Stash Search Regex is written from the result's own item data.** It uses the text the realm's `/fetch` returned (which Market Translation never changes, ADR-0012), never the Display Locale, so it needs no game-data lookup and no extra Preference. The stash search reportedly accepts English text even on a localized client; this is to be confirmed in game, and a separate Game Client Language Preference is the fallback if it does not hold. One regex aims to light up every result the user picked from that Seller at once. It includes the listed price, written the way the Trade site writes it, because the Seller's stash holds many items the board never saw; only when the game's length limit is exceeded is it shortened first and then split into parts.

## Considered Options

- **The board calls `/fetch` itself through PoeXD's rate gate**: rejected. Results fetched that way have no official row, so they cannot be located, they miss every result enhancement, and PoeXD would compete with the official page for the same per-account fetch budget. The cost of the chosen option is a dependency on the official "load more" button, which the result sort controller already has.
- **Regex in the Display Locale**: rejected. It would be wrong for everyone who reads the site in Chinese but plays on the international client.
- **A Game Client Language Preference with Game Wording from poexd-data**: deferred. It costs a data dependency and a setting; the result's own text is enough unless in-game testing shows otherwise.
- **Bulk whisper text for one Seller**: rejected. Instant buyout made it rarely useful.
