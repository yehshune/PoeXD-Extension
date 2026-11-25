---
status: accepted
---

# poexd-data is the single data producer

Every file under `public/json/` is generated and published by [poexd-data](https://github.com/yehshune/poexd-data); the extension no longer contains any generator. This covers the game data (items, stats, mod lines, result labels, mercenary names) that poexd-data already built from the client tables (ADR-0011) and, since 2026-11-13, the Trade filter labels and the Market Translation shards (ADR-0012) that used to come from `scripts/update-trade-filters.mjs` and `scripts/update-market-translation.mjs` in this repository.

poexd-data groups its output into seven **consistency batches** (`poe1/game`, `poe2/game`, `poe1/mercenary`, `poe1/trade-filters`, `poe2/trade-filters`, `market`, `folder-icons`). It rebuilds the game batches when a daily check finds a new client patch and the Trade batches every Monday, runs a verification gate (required files, valid JSON, batch consistency, no file shrinking by more than 30%), and publishes a `manifest.json` (path, batch, sha256, size per file) and a `batches.json` (patch, build time, `staleLocales`) to its `gh-pages` branch. A locale whose official site cannot be reached keeps its previous file and is listed in `staleLocales`.

The extension consumes that output only through `pnpm data:sync` (`scripts/sync-data.mjs`): it pins the current `gh-pages` commit, downloads each file from `raw.githubusercontent.com/<commit>/`, takes each file's batch from the manifest (ignoring batches it does not know), rejects unsafe paths and paths outside the batch's own directory, checks every file against the manifest's size and sha256, re-validates each batch's internal consistency, and skips a whole batch when any check fails. The commit it synced from is recorded in `public/json/data-source.json`. `.github/workflows/data-refresh.yml` runs the sync daily, runs the test suite and opens a pull request when the data changed. Data still ships inside the extension package; users get new data with the next release.

## Considered Options

- **Keep the Trade generators in the extension**: rejected; the same official sources and validation rules were split across two repositories in two languages, the extension's weekly workflow refreshed only `trade-filters` while Market Translation was refreshed by hand, and nothing guaranteed that files from one batch were built together.
- **Sync from the jsDelivr branch URL**: rejected; jsDelivr caches branch URLs for up to a week and can serve a mix of old and new files. Pinning a commit SHA and fetching from GitHub raw gives a consistent snapshot.
- **Copy files from a local `git archive` of `gh-pages`**: rejected; on Windows with `core.autocrlf=true` it rewrites line endings and the hashes no longer match the manifest.
- **Load data remotely at runtime so users get new translations without an extension update**: deferred, not rejected. The manifest and batch metadata are designed so a later phase can verify remote data at runtime, but it needs a new `host_permissions` entry, which makes Chrome disable the extension on update until the user re-approves it, and a privacy policy update (see ADR-0012).

## Consequences

- Changing how a data file is generated means a change in poexd-data, followed by a sync pull request here. Runtime readers, data contracts and tests of the loaded shapes stay in the extension.
- poexd-data's `src/publish/catalog.ts` is the only list of published files. `scripts/sync-data.mjs` keeps no copy of it: it checks that every path is safe (no `..`, absolute paths or backslashes; `.json`, plus `.webp` for folder icons) and stays under its batch's directory (`checkDataPath`), so adding a data file to an existing batch needs a change in poexd-data only. It still keeps its own batch validation as a second line of defence. (Until 2026-11 it kept a copy of the whitelist, and every new file needed a matching entry in both repositories.)
- A sync that only reflects a new poexd-data commit without data changes does not rewrite `data-source.json`, so it opens no pull request.
