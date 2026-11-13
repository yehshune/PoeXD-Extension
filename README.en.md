<p align="center">
  <img src="./docs/store/images/en/promo-marquee-1400x560.png" width="100%" alt="PoeXD Extension - a helper for the official Path of Exile trade site">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/fbbkaeekjalfecgjfcephaiopffeobjg"><img src="https://img.shields.io/badge/Chrome-Web%20Store-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/hnnpgpcnmgjbmmhgogcljbnfoklblgmb"><img src="https://img.shields.io/badge/Edge-Add--ons-0078D7?style=flat-square&logo=microsoftedge&logoColor=white" alt="Edge Add-ons"></a>
  <img src="https://img.shields.io/badge/PoE-1%20%26%202-F59E0B?style=flat-square" alt="PoE 1 & 2">
  <img src="https://img.shields.io/badge/License-MIT-94A3B8?style=flat-square" alt="License">
</p>

<p align="center"><a href="./README.md">繁體中文</a> · <b>English</b></p>

**PoeXD Extension** is a helper for the official Path of Exile (PoE 1 / PoE 2) trade site: manage
live searches in one place, apply affixes quickly, organize bookmarks, and show the international
trade site in Chinese.

## Install

| Browser                          | How                                                                                                                                                                         |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome, Brave and other Chromium | [Chrome Web Store](https://chromewebstore.google.com/detail/fbbkaeekjalfecgjfcephaiopffeobjg)                                                                               |
| Microsoft Edge                   | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/hnnpgpcnmgjbmmhgogcljbnfoklblgmb)                                                                          |
| Manual install (no auto-update)  | Download `chromium.zip` from [Releases](https://github.com/yehshune/PoeXD-Extension/releases), unzip, enable Developer mode in `chrome://extensions/`, then "Load unpacked" |

Then open the [official trade site](https://www.pathofexile.com/trade); the PoeXD toolbar appears
on the right. Store versions update automatically. Firefox is not available yet.

## What's new

- **Quick filters on result mods**: hover a mod in the search results to get "+AND" and "+NOT"
  buttons that add it to the current search's AND or NOT group. Existing filters are not
  duplicated and disabled ones are re-enabled. Can be turned off in settings.
- **Mod group picker**: when a stat comes from several mod groups, the tier dropdown splits into
  two columns — mod groups on the left, tiers on the right. The group chosen in the affix selector
  carries over and survives a page reload.
- **More accurate PoE 2 rune override estimates**: armour, evasion and energy shield are calculated
  separately, accounting for quality, local attack speed, socket-bound augments and bonded mods.
  Overridden values appear inline next to the official values, socket potential moves under the
  item image, and new sort options cover armour, evasion and energy shield.
- **UI cleanup**: sidebar settings are regrouped into 5 sections; the extension popup shows trade
  site links that match your language (Taiwan, China or the international site's locale subdomain).

See [Releases](https://github.com/yehshune/PoeXD-Extension/releases) for the full history.

## Features

### ⚡ Live search console

Watch many live searches from a single tab with automatic reconnects; group them by bookmark
folder, start or stop in batches, and resume last session's connections. A results-only view,
per-connection filtering and a live API rate indicator help you stay under the official limits.

<p align="center"><img src="./docs/store/images/en/screenshot-4.jpg" width="80%" alt="Live search console"></p>

### 🎯 Stat group templates and search preview

Save common conditions (e.g. "Life + total elemental resistance") as groups and overlay them on the
current search without touching other filters, with one-click undo; share via codes or backup
files. Search preview shows the real criteria behind history entries and bookmarks, and lets you
overlay individual affixes from them.

<p align="center">
  <img src="./docs/store/images/en/screenshot-3.jpg" width="49%" alt="Stat group templates">
  <img src="./docs/store/images/en/screenshot-2.jpg" width="49%" alt="Search preview and overlay">
</p>

### 🔍 Affix filter and tier tools

Browse prefixes and suffixes by item class and write them to the official filters in one go; tier
buttons next to each filter fill in value ranges; drag affixes to reorder or move them between
groups. PoE 2 tablets, waystones and radius jewels are supported.

### 💰 Result enhancements

Price conversion between currencies using poe.ninja rates (international realm), highlighting of
matching affixes, and PoE 2 rune-override DPS / defence estimates with sorting.

### 📁 Bookmarks, history and TFT interop

Tree folders with drag and drop, cover images and hover previews; bookmarks follow your current
realm and league. Search history is recorded automatically. Import and export bookmarks with TFT
Trade Extension, with a diff preview before importing.

<p align="center"><img src="./docs/store/images/en/screenshot-1.jpg" width="80%" alt="Bookmark tree"></p>

### ⚙️ More

- Fuzzy search for item names and filters (auto `~`), focus / clear search hotkeys, item name in
  the tab title.
- Themes, panel side, width and zoom are adjustable; toggle features from the toolbar popup.
- Extension UI in Traditional Chinese, Simplified Chinese and English; affix data covers all 11
  languages of the official trade site.

<p align="center"><img src="./docs/store/images/en/screenshot-5.jpg" width="80%" alt="Settings"></p>

## Privacy

All data stays in your browser. This project runs no servers and has no analytics or tracking.
See the [privacy policy](./PRIVACY.md); report security issues privately as described in
[SECURITY.md](./SECURITY.md).

## Development

Requires Node.js `>= 22` and pnpm.

```bash
pnpm install
pnpm dev        # Chrome dev mode with hot reload
pnpm test       # unit tests
pnpm compile    # type check
pnpm build      # production build
```

See the [contributing guide](./CONTRIBUTING.md) for the full workflow; architecture and decision
records live in [CONTEXT.md](./CONTEXT.md) and [`docs/`](./docs/). Stack: WXT, Vue 3, TypeScript,
Tailwind CSS 4, Vitest, Playwright.

## Support and license

- PoeXD is free and open source. If it saves you time, consider
  [supporting development](https://yehshune.github.io/support/).
- This is an unofficial community tool, not affiliated with or endorsed by Grinding Gear Games or
  Tencent. "Path of Exile" is a trademark of Grinding Gear Games.
- Source code is under the [MIT License](./LICENSE). Game data in `public/json/` is copyrighted by
  Grinding Gear Games and is not covered by the MIT license; see [NOTICE](./NOTICE.md).
