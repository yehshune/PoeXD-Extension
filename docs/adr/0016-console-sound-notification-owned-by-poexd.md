---
status: proposed
---

# The console triggers its own sound notification and plays the official audio element

The official Trade site plays a sound when a live search finds an item. The LiveSearch Primary Page (線上搜尋主控台) never does, because that sound is wired into the official WebSocket handler, which the console bypasses by design (live-search-host-adapter-contract §1).

Verified on 2026-11-17 against the international PoE 1 site (`trade.*.js`, `chunk.D8xVuI9HtNLD.js`) over CDP:

- The official live WebSocket `onmessage` handles `{ count, result }` by committing `addSearchResult`, then calling the Vue root's `notify(count)`, then committing `incrementActiveUnreadHits`.
- `notify` calls `doWoop()`, which rewinds and plays the root's `<audio>` element (`$refs.audio`) at `audio.volume / 100`, and skips playback when the volume is 0. When the tab is not focused, `notify` also prefixes `document.title` with `(N)`, sets a favicon badge, and raises a desktop `Notification` if permission was already granted.
- The page renders exactly one `<audio preload="auto">`, whose `src` is the user's chosen sound already resolved against the realm's CDN (`https://web.poecdn.com/audio/trade/pulse.mp3` by default; a custom sound is a `data:audio/...` URL).
- The volume is the root's `audio.volume`, saved with lscache under `lscache-tradewoop` (PoE 1) or `lscache-trade2woop` (PoE 2) as JSON `{ file, volume, custom, name }`. The key is absent until the user changes the setting, and the default volume is 50.
- The console's display container is synthesized with `live: false`, and the console owns its WebSockets, so none of the above runs. `entrypoints/main-world/` calls no `notify`, `doWoop` or `$root` method.
- A Trade tab created in the background with no user interaction rejects `HTMLMediaElement.play()` with `NotAllowedError` (Chrome autoplay policy; `navigator.userActivation.hasBeenActive === false`). This is how the console is usually opened (`openPrimary` / `enqueueConnections` with `active: false`). The official page fails silently in the same situation.

We decide that **the console owns when its sound notification (通知音效) plays, and plays the official `<audio>` element to make the sound.** The isolated world finds that element in the DOM, sets its volume from the official setting, rewinds it and plays it. We do not call the official `notify` / `doWoop`.

- **Trigger.** Play when the runtime accepts a new result token for an active connection (after per-connection dedup, before `/fetch`). This matches the official timing, which plays on the WebSocket message, so the sound is not delayed by the `/fetch` rate gate.
- **Coalescing.** Tokens that arrive within 300 ms, from any number of connections, produce one sound. The official page replays once per message and cuts the previous playback short.
- **Sound and volume sync with the official setting.** The console reads and writes the page's own `localStorage` (`lscache-tradewoop` / `lscache-trade2woop`, sharing the origin). The value is page-writable, so only an integer volume from 0 to 100 and valid sound paths (`audio/...` or `data:audio/...`) are accepted; anything else falls back to volume 50 / `audio/trade/pulse.mp3`. A volume of 0 means no sound, as on the official page. Built-in sound selection (`Pulse`, `Piano`, `Chime`, `Gong`), custom audio upload (up to 1 MB as `data:audio/...`), and volume (0–100) can be edited directly in the console settings pane, updating the official `localStorage` entry (preserving unknown fields) and syncing `<audio>.src` immediately against the realm's CDN origin.
- **One Preference.** `liveSearchSoundEnabled` (boolean, version-specific, default `true`) turns the sound off for the console only.
- **Blocked playback is surfaced, not swallowed.** When `play()` rejects with `NotAllowedError`, the console shows a notice that asks the user to click the console once, and clears it after the first user activation. Missed sounds are not replayed. A missing `<audio>` element or other playback errors are logged without page data.
- **No new permission, no new web-accessible resource, no main-world change.** Everything happens in the isolated world against the page's DOM and storage.

## Considered Options

- **Call the official `$root.notify(count)`**: rejected. It depends on private, minified methods on the Vue root, needs a new bridge command, rewrites `document.title`, which `LiveSearchConsoleTitleGuard` keeps fixed, can raise a desktop notification per result, and does not coalesce bursts.
- **Call only the official `doWoop()`**: rejected. It is the same few lines we run against the DOM element, but through a private Vue method and the main-world bridge.
- **Play after the result renders**: rejected as the trigger. The `/fetch` rate gate can hold a result for seconds, and for a live search the sound is the cue to look.
- **Our own `Audio` with our own sound choice and volume Preferences**: deferred. It is needed for a per-connection sound, which is the next step; the trigger and coalescing stay, only the playback source changes.
- **Play from an offscreen document (`chrome.offscreen`, `AUDIO_PLAYBACK`)**: deferred. It could avoid the autoplay block on a background-opened console, but it needs the `offscreen` permission, has no Firefox equivalent, and needs its own sound source.
- **Desktop notifications, title unread count and favicon badge**: out of scope; each needs its own decision.

## Consequences

- `LiveSearchPrimaryRuntime` gains an injectable result-accepted callback, and a new `LiveSearchSoundNotifier` (isolated world) owns coalescing, volume reading, playback and the blocked state, with injectable DOM and timer access so tests need no real audio.
- New coupling points: the single official `<audio>` element and the lscache key and value shape. If the element disappears, the console logs it once and stays silent; if the volume cannot be read, it plays at 50%.
- Changing the sound or volume can be done directly in the console settings pane (or on the official settings page of a normal Trade tab), since both read and write the same `lscache-tradewoop` / `lscache-trade2woop` entry. Changes apply immediately in the console by syncing `<audio>.src` and volume on write/play, and take effect in normal Trade tabs on reload.
