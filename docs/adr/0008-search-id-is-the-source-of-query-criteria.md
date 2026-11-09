---
status: accepted
supersedes: ADR-0004
---

# The canonical search ID is the single source of Trade query criteria

The official Trade site no longer resolves short server-issued search IDs (they now open an empty search); every working search ID is a gzip query hash that encodes the full query JSON. ADR-0004's rule "do not persist Trade query criteria" therefore no longer holds in practice, since every retained Search Record and Bookmark URL already carries the criteria. We keep ADR-0004's intent (a Search Record, History Entry, or Bookmark never stores a second copy of its criteria to persist, migrate, or export) and replace its premise: the canonical search ID is the single source of truth for a search's criteria, and features such as search preview and Temporary Search decode it on demand instead of caching it. User-authored Stat Group Templates are a separate concept that deliberately store stat groups; see ADR-0010.

## Consequences

- **Legacy Search IDs are invalid.** Support for non-gzip search IDs is removed. Existing Search Records and Bookmarks that hold one are not deleted automatically; they are shown as invalid so the user can remove them. Bookmark Transfer import (TFT and Better Trading) skips them and reports how many were skipped.
- ADR-0007's note that "old `searchId` short codes may not resolve on another realm" is moot.
- The removal of legacy search ID handling ships as its own change, separate from any feature that decodes criteria.
