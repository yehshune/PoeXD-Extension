# Migrate Search Records without dual-writing

Adopt a one-time, idempotent migration that combines legacy payload caches, History Entries, and Bookmarks into canonical Search Records and references while preserving user-visible names, groups, ordering, and timestamps. After a successful migration, read and write only the new format; retain the legacy keys unchanged for the first release as a recovery snapshot, because ongoing dual-writing would add permanent consistency complexity while immediate deletion would make recovery unsafe.
