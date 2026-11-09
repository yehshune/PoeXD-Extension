---
status: accepted
supersedes: ADR-0009
---

# Stat Group Templates and Search Preview overlay replace Filter Presets

Filter Presets (ADR-0009) bundled any mix of stat groups, non-stat fields, status and item into a stored preset applied from a menu beside the official clear button. In use, the reusable part turned out to be stat groups, while everything else was already reachable from Bookmarks, whose search ID encodes the full query (ADR-0008). We therefore drop Filter Presets and split the job in two: a **Stat Group Template** stores only one or more stat groups and is used and saved from a menu beside the official "add stat group" button and managed in its own Sidebar pane as one flat, drag-ordered list; and **Criteria Overlay** of anything else comes from the toggled Search Preview of a Bookmark or History Entry, where stats overlay only as whole groups (one group or the whole stat area) and non-stat criteria only per filter section or all at once. To make the Bookmark the trustworthy source for that overlay, adding a Bookmark now first writes the official form through to the URL (the root component's `save(true)`) and refuses to add the Bookmark if that fails, so its search ID always matches what the form showed. ADR-0009's mechanics stay in force for every overlay: criteria are captured from the official Vuex store (`state.persistent`), never the possibly stale URL, and written only through the official mutations followed by `save(true)`.

## Considered Options

- **Keep Filter Presets with a management pane**: rejected; a second store of full criteria duplicates what Bookmarks already hold.
- **Derive stat groups from every Bookmark**: rejected; it floods the "add stat group" menu with groups nobody chose.
- **Bookmark capture dialog with part selection, encoding the subset ourselves**: rejected; adding a Bookmark stays one click, and writing through the official `save(true)` keeps the official encoding instead of a hand-written gzip encoder.
- **Single-stat overlay**: rejected; a lone stat must be placed into some group, and guessing which one is unpredictable.

## Consequences

- The unreleased `poexdFilterPresetsV1_*` storage is abandoned without migration; templates use `poexdStatGroupTemplatesV1_{version}`.
- The Search Preview must render stats grouped (type, count/weight value), not as a flat list.
