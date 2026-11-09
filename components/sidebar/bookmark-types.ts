import type {
  BookmarkPlacement,
  BookmarkFolder as CollectionBookmarkFolder,
} from '../../utils/bookmark-collection';

export interface Bookmark extends BookmarkPlacement {
  searchRecordId: string;
  /** 依目前網域與聯盟解析後、可直接開啟的網址。 */
  url: string;
  /** 書籤記錄中的原始網址（寫回儲存時使用）；尚未投影時與 `url` 相同。 */
  canonicalUrl?: string;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  order: number;
  parentId?: string;
}

export type BookmarkGroup = BookmarkFolder;
