# Migrate Bookmark Collections V2 to V3 hierarchy

Adopt Bookmark Collection Schema V3 as the single canonical persistence format supporting arbitrary-depth folder hierarchies (`folders` + `bookmarks.groupId`). Perform a one-time, lossless, deterministic migration on initialization when legacy V2 storage is detected: transform legacy V2 groups into V3 root folders (preserving `id`, `name`, `order`, and `gameVersion`), retain bookmarks with their canonical `groupId` pointing to the owning folder, commit the migrated V3 state to the canonical key, and immediately remove legacy V2 storage keys. Dual active ownership between V2 and V3 is strictly disallowed; runtime collection views expose folders via `groups` (preserving `parentId` hierarchy metadata) and runtime bookmark ownership exclusively uses canonical `groupId`, preventing duplicate persistence roots and conflicting ownership. Legacy `folderId` compatibility is strictly confined to storage migration and canonicalization boundaries. This supersedes ADR-0005's clean-break no-migration decision for bookmark collections.

## Hierarchy Consumer Semantics & Transfer V2

For hierarchy-aware consumers:

1. **Bookmark Transfer V2 (`poexd-bm2:`)**: Portable transfer schema adopts recursive folder trees (`folders?: BookmarkTransferFolder[]`) without leaking internal IDs, timestamps, or search records. Collection-scoped export preserves the complete root forest and nested descendant orders; folder-scoped export packages the selected folder's complete subtree as the export root. Legacy V1 transfer (`poexd-bm1:`) remains fully decodable and imported as root folders. Import assigns fresh internal IDs, reconstructs parent-child references, and enforces fail-closed validation against cycles and capacity limits.
2. **Subtree League Replacement**: Folder-scoped `replace-bookmark-league` targets all bookmarks across the selected folder's subtree via canonical `getSubtreeBookmarkIds`, updating search records atomically without duplicate graph traversals.
3. **LiveSearch Breadcrumb Projection**: LiveSearch source groups maintain flat `LiveSearchSourceGroup[]` projections with ancestor path names (`formatFolderPath`, e.g. `裝備 / 武器 / 弓`). Pure structural parent folders lacking direct bookmarks produce no empty groups, while group identity strictly retains the owning folder ID, preserving runtime subscription IDs, Resume Plans, and WebSocket connection lifecycles.

## Tree UI Projection & Component Lifecycle (Phase C)

1. **Recursive Projection & Ordering Invariant**: `BookmarkPane` renders arbitrary-depth folder hierarchies via recursive `BookmarkFolderNode` projection without nested scrollbars. Children order strictly enforces **child folders first, direct bookmarks second**, with depth-based visual indentation and tree rails.
2. **Subtree-Aware Mutations**: Deleting a folder cascades across its entire subtree in both UI confirmation dialogs and optimistic model projection (`getFolderSubtreeIds`), pruning descendant folders and bookmarks simultaneously.
3. **Scoped Sibling Calculations**: Root folder creation calculates sibling order and duplicate-name avoidance against root folders (`parentId === undefined`); subfolder creation scopes sibling calculations strictly to immediate siblings under the parent folder.
4. **DnD Transition Guard**: Legacy flat folder sortable was temporarily restricted to flat-only collections during Phase C, paving the way for multi-container nested drag-and-drop in Phase D.

## Nested Drag-and-Drop & Atomic Placement Invariants (Phase D)

1. **Folder Drop Intent & Resolution**: Folder dragging introduces explicit drop intents (`before`, `inside`, `after`) resolved via pure domain logic (`resolveFolderDropPlacement`). _(Note: The initial Phase D 25% / 50% / 25% Y-axis gesture thresholds are superseded by Phase F Horizontal Tree Projection below)._
2. **Single Atomic Persistence Mutation**: A drop operation translates to a single atomic `move-folder` command carrying `dropIntent`. The collection module atomically updates `parentId`, normalizes target sibling orders, and compacts source sibling orders (0..N-1) in one single state revision without intermediate states or split mutations.
3. **Cycle & Self Prevention**: Dropping a folder onto itself or any of its descendants is strictly disallowed and rejected fail-closed both at the UI resolver level and inside domain validation (`canMoveFolder`), preventing graph cycles and subtree orphan states.
4. **Dedicated Drag Grip**: Folder dragging is exclusively bound to the `.folder-drag-handle` control (`<GripVertical />`). The folder header row is reserved for expand/collapse and row interactions, eliminating unintended drag initiations.
5. **Subtree Atomicity & Ownership Invariant**: Moving a parent folder moves its entire subtree as an immutable unit. Descendants retain their existing relative `parentId` and direct bookmark `groupId` references without modification. Bookmark dragging remains fully supported across nested folders at any hierarchy depth.
6. **Subtree-Aware Drag-to-Trash**: Dragging a folder to the trash zone invokes a confirmation dialogue explicitly reporting the count of descendant subfolders and bookmarks to be pruned. Cancellation aborts mutation and restores DOM structure.
7. **DOM / SortableJS Boundary**: DOM nodes and SortableJS instances serve strictly as transient gesture sensors and drop targets. Neither DOM hierarchy nor SortableJS internal state acts as the source of truth; all UI structures and ordering remain exclusively projected from canonical flat `folders` + `parentId` state.

## Regression & Residual Audit Closure (Phase E)

1. **Storage Migration Compatibility vs Active Runtime Contract**:
   - **Persisted Migration Compatibility**: The storage layer accepts legacy V2 states (lossless migration to V3), legacy V3 states with equivalent `groupId` and `folderId` (lossless normalization to single `groupId`), and legacy V3 states with `folderId`-only (normalized to `groupId`). Conflicting ownership fails closed. Re-commitment to storage commits pure canonical V3 (`folders` + `bookmarks.groupId`).
   - **Active Runtime Contract**: In-memory and runtime messaging surfaces operate strictly on canonical identifiers:
     - Folder mutations exclusively route through `put-group` (creation and updates), `delete-group` (subtree cascade deletion), `reorder-groups` (legacy flat fallback when `!hasHierarchy`), and `move-folder` (atomic hierarchy placement and sibling reordering with `dropIntent`).
     - Bookmark mutations and views exclusively consume and expose canonical `groupId`. The runtime `folderId` getter on read bookmarks and mutation fallback accepting `folderId` are removed.
     - View projections exclusively provide `groups` (which carries full hierarchy metadata including `parentId`); the runtime alias `BookmarkCollectionView.folders` and dynamic `folders` getter on `buildView()` and `collection.read()` are removed. Persisted `state.folders` remains the sole V3 persistence SSOT.
2. **Removed Compatibility Surfaces (Zero Production Callers)**:
   - **Dead Folder Command Aliases**: Removed `put-folder`, `delete-folder`, and `reorder-folders` from `BookmarkCollectionCommand`, `BookmarkCommand`, coordinator routing, and collection execution branches. Bidirectional alias symmetry is discarded as justification for dead code.
   - **Dead Client Methods**: Removed `BookmarkClient.putFolder`, `BookmarkClient.deleteFolder`, and `BookmarkClient.reorderFolders`.
   - **Runtime Alias Types & Getters**: Removed `folderId?: string` from `BookmarkPlacement` and `BookmarkReorderPlacement`; removed non-enumerable `folderId` getter on read items; removed runtime `folders` view alias.
   - **Dead Gesture Sensor**: Removed obsolete `groupSortable` variable and cleanup references in `useBookmarkSortables.ts`.
3. **Deliberately Retained Compatibility Surfaces**:
   - Runtime `groups` projection on `BookmarkCollectionView` and `collection.read()`.
   - Type aliases `BookmarkCollectionGroup` (equal to `BookmarkFolder`) and `BookmarkCollectionGroupV2`.
   - Production commands `put-group`, `delete-group`, flat-only fallback `reorder-groups`, and nested `move-folder`.
   - Portable Bookmark Transfer V1 decoding into root folders alongside V2 recursive format.
   - Storage migration compatibility and legacy V3 canonicalization.
4. **Verified Subsystem Invariants**:
   - **Search & Collapse**: `buildSearchFilteredFolderTree` prunes irrelevant branches and retains only matching nodes and their ancestor chains; `isGroupCollapsed` cascades collapse state down the subtree.
   - **Subtree Cascading**: Subtree deletions atomically prune all descendant folders, bookmarks, and associated `SearchRecord` entities across collections and live search sessions.
   - **Transfer Portable Format**: Transfer V2 (`poexd-bm2:`) encapsulates arbitrary subtrees without leaking internal IDs or state; legacy V1 (`poexd-bm1:`) decodes cleanly into root folders.
   - **Cross-Instance Reconcile**: Reconciles external changes including parentId and sibling changes cleanly without orphaned DOM nodes or detached SortableJS listeners.

## Explicit Drop Zones & Horizontal Tree Projection Contract (Phase F Convergence)

The initial Phase D gesture model relied solely on vertical pointer position across the target header, causing unintended nesting during vertical scrolling. A subsequent intermediate iteration experimented with making the horizontal X-axis the sole owner of all depth decisions. To achieve optimal usability and deterministic placement, Phase F converges onto the **Explicit Drop Zones Contract**, where distinct card surfaces explicitly partition gesture responsibilities:

1. **Explicit Target Surfaces & Zone Ownership**:
   - **Target Hit Surface Expansion**: Folder drop hit-testing resolves targets at the `.group-container` card level (`elementFromPoint -> closest('.group-container')`), accepting hits across the header, direct-bookmark body, and child rows rather than being restricted to the narrow `.group-header-row`.
   - **Three Unambiguous Hit Zones**:
     - `before`: Top edge strip of the target card (`clientY <= cTop + edgeHeight`). Explicitly conveys insertion before the target item.
     - `inside`: The entire central area of the card (middle 50% of collapsed headers, or the full card body including direct bookmarks when expanded). Pointer hovering over the folder surface directly conveys "move inside this folder as a child", 100% owned by the central surface and completely decoupled from horizontal X-axis drag offset (`dropPosition: 'inside'`).
     - `after`: Bottom edge strip of the target card (`clientY >= cBottom - edgeHeight`). Explicitly conveys insertion after the target item/subtree.
     - Dynamic `edgeHeight` adapts gracefully across collapsed rows and tall expanded cards (`Math.max(4, Math.min(Math.round(baseRowHeight * 0.25), Math.floor(cHeight / 3)))`).
2. **Role of X-Axis Projection (Scoped to Edge Zones)**:
   - **Not the Sole Depth Owner**: The X-axis does not govern nesting into `inside`. `inside` is directly triggered by the central card surface without requiring horizontal displacement.
   - **Ancestral Outdenting & Sibling Insertion**: For `before` and `after` edge zones, X-axis horizontal displacement relative to drag start (`dragStartX`) strictly governs ancestor outdenting (`clampedDepth <= targetItem.depth`) and sibling level insertion. Moving left outdents up the ancestor chain (`depthDelta < 0`), while moving right is clamped to the target item's depth (`maxDepth = targetItem.depth`), ensuring that `before` and `after` edges **never mutate into `inside`**.
3. **True Sibling & Ancestor Slot Preservation**:
   - Dropping `before` or `after` with matching depth maps to `{ targetFolderId, position: 'before' | 'after' }`.
   - When outdenting (`clampedDepth < targetItem.depth`), the projection resolves the appropriate ancestor at that depth (`findAncestorAtDepth`), mapping cleanly to the ancestor's `before` or `after` slot.
   - Dropping `inside` maps directly to `{ targetFolderId: targetItem.id, position: 'inside' }`.
4. **Transient Auto-Expand Invariant**:
   - **Self-Origin Horizontal Outdent & Indentation Gutter Gesture Corridor**:
     - Horizontal projection, beyond acting on other folders' before/after edges, allows the dragged origin folder surface to serve as a pure gesture sensor for ordinal-preserving ancestor outdent.
     - Dragging left from self origin reduces depth (`depthDelta < 0`), mapping the final domain intent to the corresponding ancestor's `after` slot (`FolderDropIntent { targetFolderId: ancestorId, position: 'after' }`) clamped to root depth 0.
     - Self gestures without outdent, rightward drags on self, self-inside, or cycle attempts fail closed as no-ops with zero mutation. Dragged subtree descendants remain strictly rejected as drop targets.
     - **Indentation Gutter Gesture Corridor**: Dragging originates from `.folder-drag-handle` at the card's left margin. Outdenting across indentation steps naturally places the pointer into the un-padded left gutter (`clientX < originRect.left`). While maintaining vertical bounds (`originRect.top <= clientY <= originRect.bottom`), this left corridor continues to resolve the dragged origin as a gesture sensor, preventing unwanted indicator cancellation without modifying domain target validation or mutation contracts. Moving vertically out of the corridor seamlessly switches to standard Explicit Drop Zones.
   - Hovering over a collapsed folder for 500ms triggers transient expansion in memory (`transientExpandedFolderIds`) to expose its subtree and insertion slots.
   - Transient expansion causes **zero storage writes, zero persistence preference mutation, and zero SortableJS re-initialization**. Upon drag completion or cancellation, transient expansion is immediately cleared and user collapse preferences remain completely unchanged.
5. **Runtime Geometry & Indicator Local Coordinates**:
   - Indentation step width (`resolveTreeIndentationWidth`) dynamically measures real parent/child DOM offsets or computes the full nesting step from active runtime design tokens (`--pxd-space-lg` + `--pxd-space-md`), adapting seamlessly to UI Scale and Density without hardcoded 20px assumptions.
   - Drop indicator coordinates are expressed locally on `targetHeader` (`(clampedDepth - targetItem.depth) * indentStep`), eliminating visual offsets from accumulated ancestor indentation.
   - **High-Affordance Visual Feedback & Projected Insertion Gap**:
     - `before` / `after`: Clear horizontal insertion lines (`::before` / `::after` on `.group-container` as single visual owner) centered within the inter-card gap (`--drop-indicator-offset-y`) rather than stuck to folder card borders. The line accurately represents the projected insertion slot upon release: `before X` precedes X's visible card, `after X` follows X's entire visible subtree (after its last visible descendant), and horizontal outdent dynamically re-targets to the ancestor's slot with horizontal `--drop-indicator-indent` matching projected depth.
     - `inside`: Full-card highlighted state (`.drop-indicator-inside` on `.group-container`) applying primary tint, inset glow, header tint emphasis, and folder icon scaling (`scale(1.15)`).
6. **Single Atomic Domain Mutation Seam**:
   - Projection outputs strictly translate into canonical `FolderDropIntent` (`{ targetFolderId, position: 'before' | 'inside' | 'after' }`).
   - All folder hierarchy and ordering changes exclusively execute via `FolderDropIntent → resolveFolderDropPlacement → move-folder` in `BookmarkCollectionModule`. No parallel hierarchy owner or secondary ordering mechanism is introduced.

## Flat Visual Tree & Single Sortable Root Convergence (Phase F Subsystem Alignment)

To eliminate Sortable container contention and drag jitter caused by recursive nested DOM containers while aligning DOM structure with canonical flat `folders` + `parentId` storage:

1. **Flat Visual Tree DOM Structure**:
   - `BookmarkPane` renders all visible folders as direct sibling elements under a single `.bookmark-sortable-root` container, eliminating recursive `<BookmarkFolderNode>` DOM nesting and nested `.folder-children-list` containers.
   - Folder hierarchy is expressed purely via visual indentation: each card's `.group-container` applies dynamic indentation via homogeneous nesting step addition (`margin-left: calc((var(--pxd-space-lg) + var(--pxd-space-md)) + ...)`), strictly avoiding CSS typed arithmetic while synchronizing with runtime Scale/Density tokens.
   - The card `.group-body` contains only its own direct bookmarks (`.bookmark-list-wrapper`), completely removing child folder DOM from parent card bodies.
2. **Visible-Tree Projection & Collapse Ownership**:
   - Descendant visibility during collapse is owned by visible-tree projection (`visibleFolderNodes` in `BookmarkPane`), which prunes collapsed subtrees from the flat list before rendering, rather than relying on DOM containment.
   - Search filtering maintains matching folders + ancestors semantics before flat projection.
3. **Single Sortable Root Gesture Owner**:
   - Folder dragging is owned exclusively by a single SortableJS instance mounted on `.bookmark-sortable-root`. Multi-container shared pools (`folders-shared-pool`) across nested lists are abolished, eliminating container handoff contention, race conditions, and visual jitter.
4. **Layout-Stable Subtree Origin Contract (Zero Layout Jump)**:
   - **Footprint Preservation Across Entire Drag Lifecycle**: Drag start strictly preserves the original geometry and layout flow of the dragged folder card, its direct bookmark body, and all descendant folder rows across the entire drag lifecycle, including when hovering over the drag trash zone (folder ghost preserves geometry via opacity/visibility without height/padding/margin collapse, distinguishing from bookmark row collapse). No DOM nodes are removed or collapsed via `display: none !important` (`dragging-parent-collapsed` and `dragging-descendant-hidden` are abolished), completely eliminating list displacement and viewport scroll jumping upon drag initiation.
   - **Transient Subtree Styling**: During drag (`onStart`), the dragged folder is assigned `.dragging-subtree-origin` and its descendants are assigned `.dragging-subtree-descendant`, applying theme-compatible visual attenuation (`opacity: 0.45`) to signal that the entire subtree moves together while strictly maintaining full layout footprints.
   - **Layout-Stable Destructive Subtree Preview (Trash Hover)**: Folder drag trash adopts a "layout-stable destructive subtree preview". Visible subtree elements provide direct visual feedback (`dragging-subtree-origin` and `dragging-subtree-descendant` switch synchronously to theme semantic destructive tokens: border, header inset rail, and background tint, while strictly preserving layout footprints and never setting dragged root to `visibility: hidden`), collapsed/unrendered subtrees are represented by live canonical impact summaries in the trash zone (`放開以刪除`, `N 個資料夾`, `M 個書籤`, derived via pure helper `getFolderDeleteImpact`), and hovering over the trash zone performs zero canonical mutations. Subtree cascade deletion commits only upon post-drop confirmation dialog approval.
   - **Robust Target Exclusion Seam**: Subtree atomicity and invalid target prevention do not rely on hiding DOM. Pointer hit-testing (`updateFolderDropIntentFromPoint`), domain tree projection (`projectTreeDrop`), and mutation validation (`canMoveFolder` / `resolveFolderDropPlacement`) independently fail closed on the dragged folder ID and its subtree IDs, guaranteeing that self and descendants are strictly rejected as drop targets even while remaining fully rendered in the DOM.
   - All transient styling classes are cleanly restored on `onEnd`.
5. **Zero Persistence & Seam Impact**:
   - Canonical V3 persistence (`folders` + `parentId`), `move-folder` mutation, `resolveFolderDropPlacement()`, and horizontal projection logic remain 100% intact. Flattening the DOM is strictly a presentation and gesture sensor boundary convergence.
6. **Static DOM Dragging & Indicator-Driven Placement Convergence**:
   - **SortableJS Responsibility Boundary**: Folder SortableJS is strictly scoped to drag lifecycle initialization, ghost rendering, handle binding, and container auto-scroll (`scroll: accordion`). Realtime DOM reordering is completely disabled (`sort: false`, `onMove: () => false`, `animation: 0`). Other folder cards never shift, swap, or yield position while a dragged folder is in flight, eliminating visual jitter and hit-test target displacement.
   - **Placement Preview Ownership**: Visual placement preview is owned 100% by the projected drop indicator (`drop-indicator-before` / `drop-indicator-inside` / `drop-indicator-after` with `--drop-indicator-indent` and inter-card gap centering `--drop-indicator-offset-y`), driven by pointer hit-testing and orthogonal horizontal tree projection to reflect the exact projected insertion gap.
   - **Drop-Only Atomic Commit**: Upon mouse release (`onEnd`), the final projection commits exactly once via `FolderDropIntent → resolveFolderDropPlacement → move-folder`. Vue reactivity renders the updated canonical order in a single declarative update. Obsolete `newIndex`-based reordering fallbacks (`calculateGroupReorderPlacements`) in folder drop handlers are abolished, establishing `activeDropIntent` as the sole gesture-to-placement source of truth.
