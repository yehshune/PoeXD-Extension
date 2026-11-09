<p align="center">
  <img src="./docs/store/images/en/promo-marquee-1400x560.png" width="100%" alt="PoeXD Extension - an all-in-one helper for the official Path of Exile trade site">
</p>

<p align="center">
  <a href="https://github.com/yehshune/PoeXD-Extension/actions"><img src="https://img.shields.io/badge/Status-Active%20Development-6366F1?style=flat-square" alt="Status"></a>
  <img src="https://img.shields.io/badge/Manifest-V3%20(Chrome%20%7C%20Edge%20%7C%20Firefox)-10B981?style=flat-square" alt="Manifest">
  <img src="https://img.shields.io/badge/PoE-1%20%26%202%20Ready-F59E0B?style=flat-square" alt="PoE Version">
  <img src="https://img.shields.io/badge/License-MIT-94A3B8?style=flat-square" alt="License">
</p>

<p align="center"><a href="./README.md">繁體中文</a> · <b>English</b></p>

---

## About

**PoeXD Extension** is a browser extension for the official trade site of Path of Exile 1 and
Path of Exile 2.

It targets the pain points of heavy trade users: watching many live searches at once, tweaking
stat filters repeatedly, and organizing searches across leagues. It adds a **LiveSearch console**,
**stat group templates**, **hierarchical bookmarks** and **two-way compatibility with TFT Trade
Extension**, without getting in the way of the official site.

---

## Features

### ⚡ LiveSearch console

- **Many connections, one tab**: manage multiple live searches from a single console tab instead
  of a dozen memory-hungry tabs.
- **Resume plan**: remembers which live searches were active, so you can restore them after a
  browser restart or reload.
- **Result-only presentation**: hides the official header and unrelated panels to give results
  and live notifications as much room as possible.
- **Rate-limit protection**: monitors the `/fetch` request rate and connection health
  (`API ● OK` / `API ◐ waiting Xs`) to avoid hitting the official rate limits.
- **Temporary search**: paste any trade URL, or push an existing search, and start watching it
  without creating a bookmark first.

<p align="center">
  <img src="./docs/store/images/en/screenshot-4.jpg" width="80%" alt="LiveSearch console">
</p>

### 🎯 Stat group templates & criteria overlay

- **Reusable stat groups**: save common filter sets (for example "life + total elemental
  resistance") as templates.
- **Non-destructive overlay**: apply a stat group on top of the current search form without
  touching the item type or other filters.
- **Tier dropdown**: pick T1–T3 directly in the official form to fill the matching value range.
- **Search preview**: decode and inspect the real query behind any history entry or bookmark, and
  overlay selected stat groups with one click.

<p align="center">
  <img src="./docs/store/images/en/screenshot-3.jpg" width="49%" alt="Stat group templates">
  <img src="./docs/store/images/en/screenshot-2.jpg" width="49%" alt="Search preview and overlay">
</p>

### 📁 Hierarchical bookmarks & TFT transfer

- **Nested folders**: organize searches by class, league stage or build, with drag-and-drop
  sorting.
- **Auto league**: bookmarks are realm-independent and follow the server and league you are
  browsing, or can be pinned to a specific league.
- **TFT Trade Extension compatible**: import and export TFT bookmark folders via the standard
  Base64 transfer code, with diffing and safe merging.

<p align="center">
  <img src="./docs/store/images/en/screenshot-1.jpg" width="80%" alt="Hierarchical bookmarks">
</p>

### 🌐 Native support for PoE 1 & PoE 2

- **Localized data**: bundled stat dictionaries, item names and category mappings for both games
  in all official trade site languages.
- **Separate runtimes**: PoE 1 and PoE 2 consoles each have their own background coordinator.

<p align="center">
  <img src="./docs/store/images/en/screenshot-5.jpg" width="80%" alt="Settings">
</p>

---

## Architecture

<p align="center">
  <img src="./assets/readme/workflow.svg" width="100%" alt="PoeXD Extension architecture and workflow">
</p>

1. **The search ID is the source of truth (ADR-0008)**
   The short code in an official trade URL identifies the stored query. PoeXD treats it as the
   canonical search ID and never keeps stale copies of query criteria, so previews and overlays
   always match the official search.
2. **Main-world adapters, non-intrusive integration**
   Lightweight adapters in `entrypoints/main-world/` observe the official Vue runtime and only
   mount extension controls when the official state changes.
3. **Background-owned coordination**
   Live search connections are coordinated by the background service worker, so they recover
   reliably across tab switches, network drops and browser sleep.

---

## Installation

### Option 1: Extension stores (recommended)

- **Chrome**: Chrome Web Store (under review)
- **Edge**: Microsoft Edge Add-ons (under review)
- **Firefox**: Firefox Add-ons (AMO, under review)

Store versions update automatically.

### Option 2: Manual install (Chrome / Edge / Brave / Opera)

1. Download `poexd-extension-<version>-chromium.zip` from
   [Releases](https://github.com/yehshune/PoeXD-Extension/releases) and unzip it.
2. Open `chrome://extensions/` (`edge://extensions/` on Edge) and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.
4. Open the [official trade site](https://www.pathofexile.com/trade); the PoeXD toolbar appears
   on the right.

> Manually installed builds **do not update automatically**. Download new releases, unzip over
> the same folder, then click "Reload" on the extensions page. Your local data is kept when you
> update in place.
>
> Firefox does not allow unsigned extensions; please install from Firefox Add-ons.

### Option 3: Build from source (developers)

Requirements: **Node.js** `>= 22`, **pnpm** (see `packageManager` in `package.json`).

```bash
git clone https://github.com/yehshune/PoeXD-Extension.git
cd PoeXD-Extension
pnpm install

pnpm dev               # Chrome with hot reload
pnpm dev:firefox       # Firefox
pnpm test              # unit tests
pnpm compile           # type check
pnpm format            # format code

pnpm build             # .output/chrome-mv3
pnpm build:firefox     # .output/firefox-mv3
pnpm zip               # release zips
POEXD_STORE_BUILD=1 pnpm zip   # store build without the fixed-ID manifest key
```

---

## Tech stack

| Area                | Choice                                                                      |
| :------------------ | :-------------------------------------------------------------------------- |
| Extension framework | [WXT](https://wxt.dev/)                                                     |
| UI                  | [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) |
| Components          | [Reka UI](https://reka-ui.com/) + [Lucide](https://lucide.dev/)             |
| Styling             | [Tailwind CSS 4](https://tailwindcss.com/)                                  |
| Messaging           | `@webext-core/messaging`                                                    |
| Testing             | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/)       |

---

## Documentation

Architecture decisions and contracts live in `docs/` (mostly in Traditional Chinese):

- [Domain context](./CONTEXT.md)
- [ADR-0007: TFT transfer](./docs/adr/0007-realm-independent-bookmarks-and-tft-transfer.md)
- [ADR-0008: Search ID as source of truth](./docs/adr/0008-search-id-is-the-source-of-query-criteria.md)
- [ADR-0010: Stat group templates and preview overlay](./docs/adr/0010-stat-group-templates-and-preview-overlay-replace-filter-presets.md)
- [LiveSearch console contract](./docs/architecture/live-search-primary-contract.md)

---

## Privacy & permissions

- All data stays in your browser. The project runs no server and contains no analytics or
  tracking.
- See the [privacy policy](./PRIVACY.md). Report security issues privately as described in
  [SECURITY.md](./SECURITY.md).

---

## Support

PoeXD is free and open source. If it saves you time, you can support its development on
[Ko-fi](https://ko-fi.com/shu540886).

---

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

---

## Disclaimer & license

- **Disclaimer**: this is an unofficial, community-made tool. It is not affiliated with, endorsed
  by, or sponsored by Grinding Gear Games or Tencent. "Path of Exile" is a trademark of Grinding
  Gear Games.
- **License**: source code is released under the [MIT License](./LICENSE). Game data in
  `public/json/` is © Grinding Gear Games and is not covered by the MIT License; see
  [NOTICE](./NOTICE.md).
