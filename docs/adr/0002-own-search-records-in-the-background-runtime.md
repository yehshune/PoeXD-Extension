# Own Search Records in the background runtime

The background runtime owns the single Search Record module and serializes its mutations so simultaneous Trade tabs cannot overwrite one another's Search Records, Bookmarks, or History Entries. Content and sidebar callers cross a typed extension-message seam, accepting that transport complexity in exchange for profile-wide ordering and consistency; tests exercise the same domain interface with in-memory adapters.
