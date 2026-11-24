/**
 * PoB 條目搜尋解析與草稿調整的單一外部介面（deep module seam）。
 * 內部實作拆分於 resolve.ts 與 draft.ts，不對外暴露淺層中間函式。
 */
export {
  DEFAULT_LINK_POLICY,
  DEFAULT_RARE_SEARCH,
  DEFAULT_STAT_PERCENT,
  LINK_OPTIONS,
  LINK_POLICIES,
  MAX_GEM_LEVEL,
  MAX_GEM_QUALITY,
  MAX_GEM_SOCKETS,
  NON_UNIQUE_RARITY,
  OFF_HAND_SLOT,
  RARE_SEARCH_MODES,
  STAT_PERCENT_OPTIONS,
  type BuildSearchDefaults,
  type DefenceSection,
  type EntryCategory,
  type EntryDefences,
  type EntrySearchSelection,
  type EntrySearchTarget,
  type GemFilters,
  type GemQualitySection,
  type LinkPolicy,
  type PseudoContribution,
  type RareSearchMode,
  type ResolvedEntrySearch,
  type SelectionRowSnapshot,
  type ShoppingEntryKind,
  type ShoppingMod,
  type ShoppingModKind,
  type ShoppingStat,
  type ShoppingStatFilter,
  type StatSelection,
} from './types';

export {
  applyResolvedEntrySearch,
  categoryOfItem,
  defencesOfItem,
  normalizeSearchDefaults,
  resolveEntrySearch,
} from './resolve';

export {
  clearSelectionBounds,
  cloneEntrySearchSelection,
  hasEnabledNumericBounds,
  hasRelaxableNumericBounds,
  isSelectionDraftModified,
  normalizeSelectionForEntry,
  relaxSelectionBounds,
  selectionFromRowState,
} from './draft';
