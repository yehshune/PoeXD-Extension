# Rebuild Bookmark Collections without migration

> Superseded by [ADR-0006](0006-migrate-bookmark-collections-v2-to-v3-hierarchy.md) for Bookmark Collection migration and storage schema.

Because the product is still unreleased, treat Bookmark Collection V2 and Bookmark Transfer v1 as a clean break: initialize an absent collection as empty and do not migrate or import legacy Bookmark storage or bundle formats. This supersedes ADR-0001 and ADR-0004 only for Bookmark migration and compatibility; their Search Record, History, and no-dual-write decisions remain in force.
