---
status: superseded by ADR-0008
---

# Do not persist Trade query criteria

Treat Trade query criteria as an ephemeral page observation used by current-page features such as result mod highlighting, rather than part of a retained Search Record. Bookmark and History tooltips no longer consume the criteria, so persisting, migrating, and exporting them would add storage and schema complexity without a user-visible purpose; the unreleased query-bearing state and Bookmark bundle shapes receive no compatibility path. This supersedes ADR-0001 only where it called for migrating legacy payload caches; its History and Bookmark migration and no-dual-write decisions remain in force.
