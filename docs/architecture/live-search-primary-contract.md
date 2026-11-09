# LiveSearch Primary Page Architecture Contract

## 1. 概念與核心角色

- **Per-Version Singleton Online Search Console（各遊戲版本獨立單例線上搜尋主控台）**：
  PoeXD 系統在同一瀏覽器 Session 中，針對 `poe1` 與 `poe2` **各自**有且僅有一個由擴充控制的線上搜尋主控台分頁（內部架構代號 `live-search-primary`）。
  - PoE 1 主控台與 PoE 2 主控台可同時並存，互不覆蓋、互不搶奪所有權。
  - 若該版本尚無主控台分頁：建立一個符合該遊戲版本與官方 Trade 網站的 Trade root 主控台分頁（PoE 1 為 `/trade`，PoE 2 為 `/trade2`；網域依呼叫來源延續 `pathofexile.com` 或 `pathofexile.tw`）。絕不沿用呼叫來源的 canonical search URL、league、searchId、`/live` 或 query/hash，從根源避免官方自動加載初始搜尋結果污染主控台。Primary Runtime 之 league 則由第一個合法啟用的搜尋訂閱動態鎖定。
  - 若該版本主控台已存在：直接 focus / activate 該版本的現有主控台分頁，絕不重複建立同版本的第二個分頁。
  - 關閉某版本的主控台分頁僅結束該版本的 LiveSearch session，不影響另一版本。
- **產品術語與瀏覽器分頁標題邊界（User-Facing Terminology & Console Tab Title）**：
  - 使用者可見介面（Sidebar 頂部標題、按鈕、提示、空狀態、錯誤訊息）統一稱為「**線上搜尋主控台**」。
  - 當 `pageRole === 'live-search-primary'` 時，由 `LiveSearchConsoleTitleGuard` (`entrypoints/content/logic/live-search-console-title.ts`) 將瀏覽器分頁標題 (`document.title`) 固定為 `線上搜尋主控台`（不附加 `PoE 1` / `PoE 2`、聯盟名稱、搜尋名稱、`Path of Exile`、`PoeXD` 或 `Primary`），並透過 `MutationObserver` 防止官方頁面或 SPA 過程改寫，於 teardown 時完整釋放。一般 Trade 分頁完全不介入 `document.title`。
  - `Primary` / `live-search-primary` 僅限程式碼內部型別、變數與架構文件使用，嚴禁洩漏至使用者介面。
- **Runtime Owner + View Owner**：
  線上搜尋主控台分頁同時承擔該遊戲版本的 LiveSearch runtime (查詢訂閱、WebSocket/串流接收、HTTP /fetch、佇列序列化) 與主要檢視模式 (Console View) 的持有者職責。

## 2. Page Role 與官方 Page Mode 分離

- 官方網站路由模式：`TradePageMode = 'search' | 'live'` 代表官方 Trade 頁面目前所處的 URL 路由狀態。
- PoeXD 頁面角色：`TradePageRole = 'normal' | 'live-search-primary'` 代表 PoeXD 對分頁的授權角色。
- **身分判定契約**：
  主控台身分不得由 `/live` URL、URL query 標記、DOM class 或官方 Vuex 狀態進行推測。
  主控台身分完全由 Background Service Worker 依各遊戲版本的權威狀態判定。

## 3. Background Per-Version Singleton Ownership 與生命週期管理

- **權威持有者**：Background 依 `PoeVersion` (`'poe1' | 'poe2'`) 分別持有獨立的 Primary Page ownership。
- **跨 MV3 Service Worker 重啟韌性**：
  Ownership 儲存於 `chrome.storage.session`，以 `poexd_live_search_primary_poe1` 與 `poexd_live_search_primary_poe2` 作為各版本的 Durable Session SSOT（並向下相容舊版 `poexd_live_search_primary` 讀取遷移）。在 Service Worker 進入休眠或重啟後，依然可無縫讀取與驗證各版本主控台 identity。
- **分頁真實性與版本資格驗證 (Version-Aware Eligibility Validation)**：
  在處理查詢或開啟請求前，Background 透過 `tabs.get(primaryTabId)` 驗證該分頁是否依然真實存在，且檢查其 URL 是否為合法的對應遊戲版本官方 Trade 網址（PoE 1 為 `/trade`，PoE 2 為 `/trade2`）。若分頁已被關閉、導航至非 Trade 網址或跨遊戲版本網址，自動修復並僅清除該版本的 Session 記錄。
- **生命週期事件監聽**：
  監聽 `chrome.tabs.onRemoved` 與 `chrome.tabs.onUpdated`，當某版本主控台分頁關閉或離開該版本交易頁面時立即清理該版本的 Session 記錄。
- **並發請求防禦與 Ownership 序列化 (Concurrency Race Defense)**：
  Background 透過互斥鎖處理並發 open 請求與 ownership 變更，確保即使多個頁面或使用者瞬間連點，同時間只會觸發一次解析與建立流程，且舊分頁的延遲 invalidation 絕不會誤刪新建立的主控台 ownership。
- **建立與查詢交錯 Race 消除 (Creation vs getPageRole Ordering)**：
  當新分頁啟動並發送 `liveSearch:getPageRole` 時，若 Background 正在執行 `openPrimary` 交易，`getPageRole` 會主動等待互斥鎖完成，確保 ownership 已確定性落盤至 `storage.session`。
- **加載中資格保護 (Loading Eligibility Safety)**：
  新分頁在建立初期處於 `status: 'loading'`、`about:blank` 且真實網址尚在 `pendingUrl` 階段時，檢驗邏輯視為合法加載中，嚴禁誤判為非 Trade 網址而誤殺 ownership。
- **儲存失敗乾淨性 (Storage Failure Cleanliness)**：
  若分頁建立後寫入 `storage.session` 發生異常，強制回滾清除該版本的 ownership，絕不殘留無效記錄。

## 4. Extension 通訊協定 (Messaging Contract)

沿用現有 `@webext-core/messaging` 與 `ExtensionProtocolMap`：

- `'liveSearch:openPrimary'`：由 UI (Normal Sidebar) 發送至 Background，請求建立或聚焦 Primary 分頁（支援 `active?: boolean`，預設聚焦；背景建立時可傳入 `active: false`）。
- `'liveSearch:getPageRole'`：由 Content Script 啟動時發送至 Background，由 Background 根據呼叫者的 `sender.tab.id` 與 Session SSOT 判定回傳權威角色 (`'normal' | 'live-search-primary'`)。
- `'liveSearch:enqueueConnections'`：由一般頁面（Normal Page 書籤單筆/資料夾選單「送入線上搜尋主控台」或官方搜尋控制列「送入主控台」按鈕）發送至 Background，將一筆或多筆搜尋連線背景送入該遊戲版本的線上搜尋主控台，**不搶奪使用者目前分頁焦點**：
  - 若該版本主控台分頁已存在，Background 透過 `'liveSearch:receiveEnqueuedConnections'` 直接轉發給主控台 Content Script 立即加入「本次連線」並啟動監聽。
  - 若該版本主控台分頁尚未開啟，Background 以 `active: false` 於背景建立主控台分頁並將待加入項目暫存於 `pendingEnqueueByVersion`，待主控台初始化時透過 `'liveSearch:consumePendingEnqueue'` 一次領取並啟動。
- `'liveSearch:receiveEnqueuedConnections'`：由 Background 發送至已開啟的 Primary 分頁 Content Script，觸發 `LiveSearchSourceController.enqueueIncomingConnections(items)`。
- `'liveSearch:consumePendingEnqueue'`：由 Primary 分頁 Content Script 初始化完成時發送至 Background，領取並清空該版本暫存的待加入連線清單。

## 5. Sidebar UI Mode 與共用基礎設施

- **共用基礎設施**：
  延續 `sidebar-layout.ts` 既有的 ShadowRoot、Theme、Scale、Density、Sidebar position、Sidebar width / resize、collapse geometry 與 portal / dialog 基礎設施。嚴禁複製第二套 layout 系統。
- **Normal Mode**：
  維持既有 Sidebar 導覽與 BookmarkPane、HistoryPane、SettingsPane，並於導覽列提供「開啟即時搜尋」入口。
  一般 `BookmarkPane.vue` 與 `BookmarkFolderNode.vue` 同時提供兩種並存入口：
  - 「**使用線上搜尋開啟**」：直接以 `window.open(toLiveUrl(bookmark.url), '_blank')` 開啟官方 `/live` 分頁並關閉選單。
  - 「**送入線上搜尋主控台**」（資料夾選單為「**將資料夾送入主控台**」）：透過 `'liveSearch:enqueueConnections'` 將書籤或資料夾內相容書籤背景送入線上搜尋主控台之「本次連線」，使用者維持留在目前一般頁面並收到 Toast 通知。
    此外，一般 Trade 頁面的官方搜尋控制列注入「**送入主控台**」（`.poexd-send-to-console-btn`）按鈕，點擊後先執行搜尋條件 write-through 再將當前網址與自動推導名稱背景送入主控台。
- **LiveSearch Primary Mode**：
  - 切換為 LiveSearch 專屬 Sidebar mode，提供專屬導覽列：
    - `搜尋連線`（預設主檢視，聚焦呈現「**本次連線** (`session_connections`)」與「**上次連線** (`previous_connections`)」兩大區塊，不再於主畫面平鋪未啟用的完整書籤資料夾樹）
    - `＋ 新增連線` / `＋ 暫時搜尋`（Action 按鈕，非第三個分頁；點擊後開啟雙分頁輕量 `TemporarySearchDialog`：Tab 1「**從書籤挑選**」支援從目前聯盟書籤與資料夾多選批次加入「本次連線」；Tab 2「**輸入搜尋網址**」支援貼上 Trade 搜尋網址與自選/自動推導名稱並由 `LiveSearchSourceController.addCustom()` 加入「本次連線」）
    - `主控台設定`（置底設定分頁，僅控制主控台專屬顯示偏好）
  - `Sidebar.vue` 頂部標題列之 `activeTabName` 與 Primary 導覽同步顯示 `搜尋連線` 或 `主控台設定`（瀏覽器分頁 `document.title` 仍固定為 `線上搜尋主控台`）。
  - 嚴格禁止顯示原本的快速書籤、搜尋歷史、系統設定導覽按鈕，且嚴格禁止 mount 普通 `BookmarkPane`、`HistoryPane`、`SettingsPane`（透過條件渲染根本不掛載），僅 mount 專屬的 `LiveSearchPrimaryPane` 與 `LiveSearchConsoleSettingsPane`。
  - **主控台顯示偏好（Preferences SSOT）**：
    - 所有持久化主控台顯示偏好統一整合進既有 `PreferencesModule` / `Preferences` / `DEFAULT_PREFERENCES` / `getPreferenceStorageKey()`（維持 PoE 1 / PoE 2 分版本規則，不另建獨立 storage）：
      - `liveSearchMaxDisplayedResults: 50 | 100 | 200 | 500`（預設 `100`）：結果展示區最多保留筆數，超過時淘汰最舊結果；官方上方顯示之筆數即為實際保留數（依連線篩選時為該連線筆數）。主控台不提供技術診斷顯示。
  - **搜尋連線清單操作階層與降噪規範 (Search Connections Action Hierarchy & Noise Reduction)**：
    - **單一主要狀態操作按鈕 (Single Status-Action Button)**：每筆連線右側只保留一個整合狀態與動作的 icon-only 按鈕（套用既有 `Button size="icon-sm"` 與標準 icon-button 幾何，具備明確 `title` 與 `aria-label`）：未啟用為「啟用」（Lucide `Play`），監聽中為綠色呼吸燈之「暫停監聽」（Lucide `Pause`），連線中/重連中為 disabled 的旋轉 `Loader2`（取消連線收納於 `⋯` 選單），異常為「重試」（Lucide `RotateCcw`）；從「本次連線」或「上次連線」移除（以及拖曳至 `DragTrashZone` 垃圾桶移除）僅移除主控台連線紀錄，絕不刪除持久化書籤。
    - **進行中狀態視覺語言**：connecting / reconnecting 採用 Lucide `Loader2` 旋轉動畫圖示呈現進行中狀態，不使用 Unicode 符號；active 項目維持微強調與呼吸動畫，使運行中連線比 inactive 項目更易於辨識。
    - **群組快捷操作与選單 (Group Quick Actions & Menu)**：群組 Header 若存在可直接啟用之來源（相容且非 active/pending/error），提供低干擾的快捷「啟用」操作（以 Lucide `Play` icon-only 呈現，套用 `Button size="icon-sm"`，具備 `title="啟用群組"` 與 `aria-label="啟用群組"`），一律走既有 batch controller / `enableMany()`；「本次連線」選單額外提供「移除已停止的連線」快捷清理，空狀態時提供「＋ 新增搜尋連線」入口按鈕。
    - **情境感知篩選批次列 (Context-Sensitive Filtered Batch Bar)**：預設（無關鍵字搜尋且狀態篩選為「全部」）時不渲染「符合 X 項 / 批次」操作列，節省垂直空間；僅在有搜尋關鍵字或非「全部」篩選時動態呈現。
    - **不相容提示降噪**：不相容項目維持淡化顯示，右側僅保留簡短不相容提示，完整 compatibilityMessage 統一由 Tooltip 提供。

## 6. Primary Page Runtime Pipeline 契約 (Phase 2B/2C Foundation)

置於 `entrypoints/content/logic/live-search-primary-runtime.ts`，由 Primary Page 專屬持有：

- **Primary Page GameVersion 為 Runtime Immutable Authority**：
  - Primary Page 的 `PoeVersion` 由 `runLogic(ctx, version)` 傳入，作為 runtime 的不可變權威版本。
  - 當 `subscription.gameVersion !== primaryPageGameVersion` 時，在任何 Host ensureContainer、WebSocket 建立或網路請求發生前立即拒絕。
- **Session Scope 與 League 鎖定與解鎖機制**：
  - 第一個合法加入的 subscription 鎖定 runtime 的 `runtimeLeague`，並觸發 Main World `ensureContainer`。
  - 透過 `addSubscriptionMutex` 互斥鎖確保首個 subscription 初始化與 container ensure 為原子交易，防禦並發 race。
  - 運作中期間，跨 league 訂閱請求嚴格拒絕；所有合法 subscriptions 共用同一 `displayLocalId` 合成容器。
  - **系統性 League Switch 解鎖與 Host Rebind 契約**：當進行正規 League Switch 時，Runtime 提供 `teardownAllSubscriptions(options?: { targetLeague?: string }): Promise<void>`，原子終止並清空所有 subscriptions、等待連線關閉、重置 `runtimeLeague = null` 與 `cumulativeRenderedTotal = 0`，並在傳入 `targetLeague` 時立即透過 `ensureContainer({ league: targetLeague, realm, resetResults: true })` 重置並 rebind Host display container context，使 Runtime 與 Host 於切換當下同步回到目標聯盟的純淨狀態。未傳入 `targetLeague` 時僅執行純 Runtime subscription 掃蕩，不變更 Host container context。除 `teardownAllSubscriptions()` 與頁面 teardown / `dispose()` 外，Runtime 不得擅自解除聯盟鎖定。
- **Subscription 領域實體與 Canonical Identity**：
  - 具備完整描述來源搜尋之正規 domain entity 屬性：`id`, `gameVersion`, `league`, `searchId`, `url`, `name`, `sourceBookmarkId?`。
  - 透過既有 `stripLiveSuffix()` 與 `parseTradeSearchUrl()` 解析 canonical Trade URL（含 `/live` suffix 正規化），禁止自創第二套 URL parser。
  - Subscription `id` 由 subscription domain 內部生成唯一 identity，**絕不可等於 `bookmarkId`**，徹底移除 `customId` 等 escape hatch。
  - Runtime 對外（`getSubscriptions()` / `getSubscription()`）只暴露 Readonly Snapshot，外部修改取出的物件絕不影響內部 entity 與 `/fetch` pipeline。
- **Source-Scoped Token Dedup 與獨立 WebSocket**：
  - 每個 subscription 獨立持有專屬之官方 live-search WebSocket。
  - 嚴格對齊 Phase 2A 實機訊息協定：解析 `{"result": "<token>", "count": 1}`（相容 `new`），官方認證訊息 `{"auth": true}` 一律忽略，零 fetch 與零 render。
  - **嚴格禁止全局 Set<token> 進行 dedup**：Token dedup 以 subscription 為作用域，包含 `pendingTokens`（in-flight 防護）與 `processedTokens`（成功確認）。
  - Fetch 失敗或 Host render 失敗僅從 pending 移除，不標記 processed，保留重試能力。
- **PoeXD HTTP /fetch Ownership**：
  - PoeXD 是官方 HTTP `/fetch` 的唯一擁有者與發起者。
  - 嚴格帶上對應的 `query=subscription.searchId`（PoE 2 加 `&realm=poe2`）與 `X-Requested-With: XMLHttpRequest`。
- **Cumulative Total 與 FIFO 序列化 Queue**：
  - 透過 FIFO 佇列確保並發 WebSocket 訊息以確定順序進入 Host Adapter。
  - 每次 render 使用獨立生成之 `batchId`。
  - 傳入 Host Adapter 之 `total` 為展示區實際保留筆數（與 `maxResults` 同步淘汰最舊者；依連線篩選時為該連線筆數），Cumulative Total 僅作為診斷用累計渲染數。
  - 唯有在 Host Adapter 回報成功後，才遞增累計計數並登記結果歸屬；失敗則計數不變。
- **HostClient 即時取消防護與純記憶體生命週期 (ADR-0004)**：
  - `LiveSearchHostClient.dispose()` 即刻取消定時器、移除監聽並 resolve pending Promise，杜絕懸掛。
  - Subscriptions、WebSockets、佇列與暫存 token 僅存於分頁記憶體中，嚴禁持久化。
  - 分頁 unload 或 teardown 時觸發 `dispose()` 清理所有連線與佇列。

## 7. Primary View Controller 與狀態邊界契約

落實「Runtime = domain/network SSOT、Controller = UI command + snapshot seam、Primary Pane = view only」之三層架構：

- **職責與 Ownership 邊界**：
  - **Runtime (`LiveSearchPrimaryRuntime`)**：唯一擁有 subscriptions 內部實體、`/fetch` pipeline、佇列序列化、Cumulative Total 之 SSOT（WebSocket transport lifecycle 則由 ConnectionSession 擁有）。
  - **Controller (`LiveSearchPrimaryController`)**：UI-facing narrow seam，提供 `read()`、`subscribe()`、`addFromUrl()` 與 `remove()`。封裝 canonical URL 解析與驗證，對無效網址提供型別化失敗，阻斷非預期 Host 介入與 WebSocket 連線。
  - **Primary View (`LiveSearchPrimaryPane.vue`)**：純 View 元件，僅接收 controller prop，訂閱 snapshot feed 並發送使用者意圖。嚴格禁止直接 import 或操作 Runtime，亦不得直接發起 WebSocket 或 HTTP fetch。
- **Reactive Publication 與 Snapshot 不變性**：
  - Runtime / Controller 提供單一 subscription feed，每當 subscription 增刪、連線狀態變更、WebSocket 錯誤、渲染成功造成 cumulative total 變更時，發送新版唯讀 snapshot。
  - Snapshot 之 `subscriptions` 必須維持唯讀拷貝，不暴露 mutable internal context。
  - UI 訂閱 listener 執行期間若拋出例外，Runtime 內部自動隔離，不破壞核心資料管線。
  - 嚴禁於 Domain Runtime 內引入 Vue `ref()` 作為 SSOT；Vue Reactivity 僅存在於 View 層。
- **生命週期隔離性 (Lifecycle Isolation)**：
  - Vue 元件卸載（例如 Sidebar 收合或切換檢視）僅觸發 controller feed 之 `unsubscribe`，**嚴禁**觸發 `runtime.dispose()`。
  - 進行中的 subscriptions、WebSockets 與佇列不受 Sidebar/Vue 狀態影響，持續於背景維持運作。
  - 唯有在 Content Script 收到 `onCleanup` / `onInvalidated`（分頁 teardown）時，才由 `runLogic` 正式觸發 `runtime.dispose()`。
- **Narrow Prop 傳遞鏈路**：
  - 傳遞路徑：`runLogic` → `mountSidebarLayout` → `Sidebar (liveSearchController)` → `LiveSearchPrimaryPane (:controller)`。
  - Normal page 傳遞 `null`，Primary page 傳遞由權威 Runtime 生成之 narrow controller。
  - 若 controller 缺失，Pane 呈現安全 unavailable 狀態，禁止向全域探查或回退至任何 escape hatch。

## 8. Unified Search Source & Connection Projection 契約 (Deep Module Boundary)

落實「Bookmark Domain 不得知道 LiveSearch，LiveSearch Domain 不得知道 Bookmark，主控台 UI 以單一『搜尋連線』呈現所有來源與連線狀態」之 Deep Module 架構：

```text
Bookmark Domain (Read-Only Port: LiveSearchBookmarkSourcePort)
                  │
                  ▼
   LiveSearchSourceController (live-search-bookmark-controller.ts)
   ├─ Bookmark Sources (📁 Group A, 📁 Group B...)
   ├─ Transient Temporary Search Sources (📁 暫時搜尋, page-session memory only)
   └─ Canonical Identity Reconciliation & Ownership Projection
                  ▲
                  │
LiveSearch Domain (Narrow Controller: LiveSearchPrimaryController)
```

- **雙分區主控台呈現（「本次連線」與「上次連線」）**：
  - 主控台統一於「**搜尋連線**」檢視呈現兩大操作區塊：**「本次連線」(`session_connections` / `sessionConnections`)** 與 **「上次連線」(`previous_connections` / `previousConnections`)**，不再將整棵未啟用的 Bookmark 資料夾樹直接平鋪於主控台主畫面（完整書籤資料夾樹改由 `TemporarySearchDialog` 的「從書籤挑選」分頁讀取 `snapshot.groups` 提供多選挑選）。
  - **「本次連線」(`sessionConnections`)**：僅收錄本次主控台 session 已加入或啟用過的連線（包含透過「＋ 新增連線」挑選的書籤、輸入的網址，或由一般頁面「送入主控台」背景派送的連線）。點擊進行中連線的「停止」按鈕後，該項目保留於「本次連線」並呈現 `○ 未啟用`（方便隨時再次點擊 `▶ 啟用`），若要從清單移除則透過該列選單 `⋯ -> 從本次連線移除` (`removeSessionConnection`) 執行。
  - **「上次連線」(`previousConnections`)**：收錄目前 `selectedLeague` 下存在於 `LiveSearchResumeStore` 中、且尚未加入「本次連線」的歷史連線紀錄（同時支援書籤項目與非書籤/暫時搜尋項目）。支援單筆點擊 `▶ 啟用`（啟用後移入「本次連線」）、單筆 `移除上次連線紀錄` (`removePreviousConnection`)、區塊標題列一鍵 `全部恢復` (`restoreAllPreviousConnections`) 以及 `清空上次連線紀錄` (`clearPreviousConnections`)。
  - 所有搜尋項目（Bookmark 與暫時搜尋 Temporary Search）皆投影為搜尋來源（`LiveSearchSourceItem`：`kind: 'bookmark' | 'custom'`），其連線狀態由 `LiveSearchPrimaryRuntime` 依據 Canonical Search Identity (`gameVersion + league + searchId`) 單向投影。
- **Deep Module 與介面窄化**：
  - **Bookmark Domain**：不暴露肥大的 `BookmarkModel`（不含 mutations, rename, drag-drop, import/export 等），僅以最小 `LiveSearchBookmarkSourcePort` 暴露 `readCollection()` 與 `subscribe()`。由 `createChromeBookmarkClient` 結構性滿足。
  - **LiveSearch Domain**：`LiveSearchPrimaryRuntime` 與 `LiveSearchPrimaryController` 完全不依賴 Bookmark 任何模組。
  - **Unified Source Controller (`live-search-bookmark-controller.ts`)**：唯一的合成層（導出 `createLiveSearchSourceController` 並保留 `createLiveSearchBookmarkController` 相容別名），同時管理 Bookmark 唯讀訂閱、主控台 page-session 記憶體內的暫時搜尋來源、`sessionConnections` 與 `previousConnections` 分區投影、Canonical Identity Reconciliation、Source Compatibility 投影、Pending 防重、批次啟用/停止 Orchestration 與篩選純函式（`filterLiveSearchSourceGroups`），對外暴露 `read()`、`subscribe()`、`enable(sourceId)`（別名 `add`）、`enableMany(sourceIds)`、`stopMany(sourceIds)`、`addCustom(url, options)`、`enqueueIncomingConnections(items)`、`removeSessionConnection(sourceId)`、`removePreviousConnection(sourceId)`、`restoreAllPreviousConnections()`、`clearPreviousConnections()`、`stop(sourceOrSubscriptionId)`、`retry(sourceOrSubscriptionId)`、`removeCustom(sourceId)` 與 `dispose()`。
- **Temporary Search + Bookmark Reconciliation 契約 (Source Ownership Invariant)**：
  - **Temporary Search 定義**：
    `Temporary Search`（使用者可見名稱：`暫時搜尋`）= 存在於目前線上搜尋主控台 page-session memory 的非書籤搜尋來源；不寫入持久化 `Bookmark` 或 `Preferences`，但在主控台啟用後會將其 canonical identity 與選用顯示資訊（`name`, `url`, `coverImageUrl`）寫入 `LiveSearchResumeStore`，使下次開啟主控台時可呈現於「上次連線」(`previousConnections`)。
  - **Active Subscription 投影覆蓋率核心不變量 (Coverage Invariant)**：
    對每個非 closed 的 Runtime subscription，在主控台「搜尋連線」中必須存在且只能存在一個 canonical source presentation owner：`Bookmark Source` 或 `Temporary Search Source`。嚴格禁止出現 Runtime subscription 仍在執行但 UI 無對應來源的孤兒狀態。Source ownership 始終以 `gameVersion + league + searchId` 的 canonical identity 判定，不得使用 `bookmarkId` 或 `subscriptionId` 作為 ownership identity。
  - **Bookmark 優先於 Temporary Search (Bookmark Precedence)**：
    當同一 canonical identity 同時存在於 Bookmark 與 Temporary Source 時，Bookmark 是唯一的 presentation owner，主控台僅呈現 Bookmark，同一 Runtime subscription 只能被投影一次。Runtime subscription 本身不修改、不重建、不 reconnect。
  - **Bookmark 刪除 / Canonical 修改時的 Active Connection Fallback**：
    當外部（如一般 Trade 分頁）刪除某 active Bookmark 或將其 URL 修改為不同 canonical identity 時，舊 canonical 之 active subscription 不得中斷、不得停止、不得 reconnect、不得產生第二條 WebSocket（`subscriptionId` 與 token state 保持不變）。Source ownership 由 Bookmark 無縫切換為 Temporary Search，使用既有 subscription 的 name、url 與 canonical identity 作為 page-session metadata，並附加 `provenance: 'origin-bookmark-removed'` 與 `provenanceMessage: '來源書籤已移除'` 的 UI 提示（非 error/warning）。
  - **Bookmark Rename / Move 保持 Bookmark Ownership**：
    若 Bookmark canonical identity 不變，僅更名、移動群組或調整順序，仍由 Bookmark Source 擁有，active subscription 持續運作，不得建立 Temporary Search。
  - **Temporary → Bookmark Promotion (自動提升)**：
    當主控台存在某 canonical identity 的 Temporary Search（無論 active 或 inactive），若外部新增了相同 canonical identity 的 Bookmark，Bookmark reconciliation 完成後該來源自動轉為 Bookmark 擁有，Temporary 項目消失。若為 active 連線，Runtime subscription 不中斷且零 reconnect。
  - **手動新增 Temporary Search 與既有 Bookmark 重複時之收斂**：
    使用者透過「＋ 暫時搜尋」輸入的 canonical search 若已存在於 Bookmark collection，禁止建立第二筆 Temporary Source，直接收斂至既有 Bookmark Source。若該 Bookmark 尚未啟用則觸發其啟用，若已 active 則維持現有連線，杜絕重複 source 或重複 subscription。
  - **Bookmark Read Failure 絕不視為刪除 (Failure Defense)**：
    Bookmark read failure、messaging 暫時性中斷或 stale intermediate read 絕不可將 active Bookmark Sources 降級或轉移為 Temporary Searches。Reconciliation 只能建立在最新 generation 的 successful Bookmark collection read 之上；失敗讀取僅表示 Bookmark 來源暫時 unavailable，保留最後已知 source ownership，禁止 ownership churn。
- **Source Compatibility 投影與 Runtime 最終權威契約**：
  - **Source Compatibility 投影權責**：由 `LiveSearchSourceController` 根據來源之 Canonical Search Identity（透過既有 `stripLiveSuffix()` + `parseTradeSearchUrl()` 解析，嚴禁自創 parser）與 `LiveSearchPrimaryViewSnapshot`（`gameVersion`、`runtimeLeague`）計算並投影於每筆 `LiveSearchSourceItem`：
    - `compatibility: 'compatible' | 'invalid-url' | 'wrong-version' | 'wrong-league'`
    - `compatibilityMessage?: string`（提供人類可讀原因，如 `此搜尋屬於 PoE 2，目前主控台為 PoE 1`、`主控台已鎖定 Standard，此搜尋屬於 Hardcore`，UI 嚴禁直接顯示內部 enum 字串）。
    - `active`、`pending`、`error` 與 `already active` 屬於連線/Runtime 狀態，嚴禁混入 `compatibility`。
  - **Runtime League 變更即時反應**：當 `runtimeLeague` 由 `null` 鎖定為特定聯盟（如 `standard`）時，Source Controller 透過既有的 `liveController.subscribe` snapshot feed 立即重算所有來源的 `compatibility`（例如同版本的 `Hardcore` 來源由 `compatible` 即時轉為 `wrong-league`），無須重新讀取 Bookmark storage。
  - **單筆 Enable Preflight 與 Runtime 最終權威**：`enable(sourceId)` 在呼叫 `liveController.addFromUrl()` 前先執行同一 compatibility preflight，若不相容則直接回傳型別化失敗（零 Runtime add、零 Host ensure、零 WebSocket 排程）。同时 `LiveSearchPrimaryRuntime` 完整保留最終合法性權威（`gameVersion` 驗證、`league` 鎖定與比對、canonical duplicate 拒絕、`addSubscriptionMutex`）。
- **Batch Orchestration（群組批次與目前篩選結果批次）契約**：
  - **Ownership 邊界**：Batch preflight 與 orchestration 屬於 `LiveSearchSourceController`（`enableMany` / `stopMany`）；`LiveSearchPrimaryRuntime` 不感知 group 或 filtered results；WebSocket 連線開啟節流（1500ms pacing）仍由唯一的 `LiveSearchOpenScheduler` 獨佔持有，嚴禁在 Vue 執行 `Promise.all(items.map(enable))` 或新增第二套排程器。
  - **已鎖定聯盟之 Batch Enable Preflight (`runtimeLeague !== null`)**：自動跳過 `wrong-version`、`wrong-league`、`invalid-url`、`already active`、`pending` 與同批次內重複的 canonical identity（canonical dedup），僅對真正 `compatible + inactive + not pending` 的來源依序執行 `enableSource`，並於 `LiveSearchBatchOutcome` 回報 `succeeded`、`skipped`、`failed` 與細部原因統計。
  - **尚未鎖定聯盟之 Mixed-League Atomic Preflight (`runtimeLeague === null`)**：
    - 若待啟用候選項目皆屬同一聯盟，依序執行並由第一筆正式鎖定 Runtime 聯盟。
    - 若待啟用候選項目橫跨多個不同聯盟（例如同時包含 `Standard` 與 `Hardcore`），Preflight **必須在任何 `addSubscription` 發生前原子拒絕整個批次**（`rejectReason: 'mixed-league'`，零 `addFromUrl`、零 Host `ensureContainer`、零 WebSocket 建立），回傳明確原因（`選取項目包含多個聯盟（...），請分開啟用`），嚴禁依畫面順序先鎖定第一筆再讓後續失敗。
  - **Batch Stop (`stopMany`)**：僅停止處於 active/connecting/reconnecting/error 的訂閱，已停止或未啟用項目直接略過；**絕不**刪除 Temporary Source 或 Bookmark，亦**不**解除 Runtime 已鎖定之聯盟。
  - **Bookmark Folder Hierarchy Projection 契約**：
    - **保留真實多層資料夾階層**：`LiveSearchSourceController` 作為 Bookmark → LiveSearch 的唯一投影邊界，`LiveSearchSourceGroup` 保留真實資料夾名稱（`name`，不再以 `formatFolderPath()` 壓扁為 `A / B / C`）、`id`、`parentId`、`order`、`depth` 與該資料夾自身的 direct `items`；`item.groupName` 亦對應其直屬資料夾的真實名稱。View 嚴禁自行從原始 Bookmark collection 重建第二份領域模型，亦不在主控台提供資料夾管理操作（拖曳、改名、刪除、移動、新增子資料夾）。
    - **重用既有 Tree 基礎設施**：`utils/bookmark-collection.ts` 集中提供純樹狀結構基礎設施（`buildFolderTree`、`getFlattenedFolderTree`、`getVisibleFlattenedFolders`、`getFolderDepth`、`getFolderAncestors`、`getFolderSubtreeIds`、`resolveEffectiveFolderParentMap`），由一般 Bookmark UI 與 LiveSearch 共同重用，不建立第二套 tree system。
    - **League-Scoped Source Projection 優先於 Folder Visibility**：先依目前 `selectedLeague` 過濾同遊戲版本的 Bookmark 來源（同時保留 `wrong-version` 與 `invalid-url` 供防禦性診斷），再對資料夾樹執行 subtree 可見性裁切——若 parent folder 自身為 `0` 筆 direct items，但其 descendant subtree 內存在至少 1 筆當前工作區來源，該 parent folder 與完整 ancestor chain 必須保留；若某資料夾整個 subtree 在當前工作區皆為 `0` 筆來源，則不顯示該空資料夾分支。
    - **Canonical Ordering 與損毀階層防禦 (Corrupt Hierarchy Fallback)**：
      1. 同層資料夾依 `order` 排序，child folders 依 canonical pre-order DFS 緊接於其 parent 後方；各資料夾內的 direct items 依 Bookmark `order` 排序。
      2. 若書籤之 `groupId` 指向不存在的資料夾，安全歸入 root-level `未分類` (`default_ungrouped`, `depth: 0`)。
      3. `暫時搜尋` (`custom_sources`, `kind: 'custom'`, `depth: 0`) 不屬於 Bookmark folder tree，永遠作為獨立 root-level 群組排在最後。
      4. 若資料夾之 `parentId` 指向不存在的資料夾、指向自身 (`parentId === id`) 或形成循環引用 (`A <-> B`)，由 `resolveEffectiveFolderParentMap` 確定性拆解循環並降級為 root (`parentId: undefined`, `depth: 0`)，確保不發生無限遞迴、不重複渲染節點且不遺失任何書籤來源。
  - **Group / Folder Subtree Batch vs Filtered Result Batch 語意**：
    - **Folder Subtree Batch & Stats（資料夾標題列統計、快捷 `啟用`、以及 `[⋯]`：`啟用此資料夾全部` / `停止此資料夾全部`）**：
      - 透過 `getLiveSearchGroupSubtreeItems()` 與 `getLiveSearchGroupSubtreeSourceIds()` 針對該資料夾在 `normalizedGroups` 中的**完整 descendant subtree**（自身 direct items + 所有子孫資料夾 direct items，依 canonical pre-order 排序）聚合計算 `enabledCount / totalCount`、`errorCount` 與 `hasEnableableSourcesInGroup`，並將完整 subtree source IDs 交由既有 `enableMany(ids)` / `stopMany(ids)` 執行，不受目前搜尋關鍵字或狀態篩選影響。
      - `暫時搜尋` (`kind: 'custom'`) 維持獨立群組語意（`啟用此群組全部` / `停止此群組全部`），僅作用於其自身項目。
    - **Filtered Result Batch（工具列 `符合 X 項` + `[批次 ▾]`：`啟用目前篩選結果` / `停止目前篩選結果`）**：候選來源 ID 直接取自目前 `filteredGroups` 各節點中**實際命中篩選**的 `items`，絕不將僅因維持階層上下文而保留之 ancestor 或 sibling 未命中項目納入批次。
    - **提示訊息層級收斂（Toast vs Inline）**：批次完成或操作結果（批次啟用成功/部分失敗、批次停止完成、mixed-league 拒絕、單筆啟用/重試失敗、暫時搜尋新增失敗等一次性操作結果）一律使用全域 `poexd-toast` 通知，嚴禁在面板頂部堆疊冗餘提示橫幅；inline 提示僅保留「狀態存在期間使用者應持續看到」的資訊（個別來源 row 錯誤、Source collection 載入失敗、Resume Prompt 互動式橫幅）。
- **暫時搜尋來源生命週期（Temporary Search Source Lifecycle）**：
  - **新增並自動啟用**：使用者於「＋ 新增連線」Dialog 提交合法 Trade URL 與名稱（或由一般頁面「送入主控台」背景派送）後，加入「本次連線」(`sessionConnections`) 並立即建立對應的 Runtime subscription（同時記錄至 `LiveSearchResumeStore`）。
  - **暫停後保留於本次連線**：點擊監聽中連線的 `[暫停]` 按鈕會移除 Runtime subscription 並關閉 WebSocket，但該項目保留於「本次連線」與 `LiveSearchResumeStore` 中（呈現未啟用 Play 狀態），方便隨時再次點擊 `[啟用]`。此行為亦適用於由被刪除 Bookmark fallback 而來的暫時搜尋。
  - **再次啟用**：對未啟用的項目點擊 `[啟用]`，以同一 URL 與名稱重新建立新的 Runtime subscription。
  - **從清單移除（防孤兒訂閱）**：透過選單 `[從本次連線移除]` / `[移除上次連線紀錄]` 或拖曳至 `DragTrashZone` 垃圾桶時，若該項目仍處於 `connecting`、`active`、`reconnecting` 或 `error`，必須先安全停止其 Runtime subscription，再從對應連線清單與 `LiveSearchResumeStore` 移除，嚴禁留下背景孤兒 WebSocket，且絕不刪除持久化書籤。
- **列狀態與操作契約（Compact Presentation）**：
  - 每筆連線右側整合為單一 icon-only 狀態動作按鈕（高度 `h-7`，`Button size="icon-sm"`），搭配 `⋯` 次要選單與拖曳至垃圾桶移除：
  - `未啟用`（相容）：主要按鈕為「啟用」（Lucide `Play` icon-only），`⋯` 選單提供移除連線紀錄
  - `未啟用`（不相容）：保留於列表中並降低視覺權重（`opacity-60`），不提供「啟用」操作，改顯示版本/聯盟標籤與不相容 badge（`不同版本` / `不同聯盟` / `無效網址`）搭配 shadcn-vue `Tooltip` 說明原因
  - `連線中` / `重連 X 秒`：主要按鈕為 disabled `Loader2` 旋轉圖示（`title` 顯示連線中或重連倒數秒數），`⋯` 選單提供「停止連線」與移除連線紀錄
  - `監聽中`：主要按鈕為綠色呼吸燈之「暫停監聽」（Lucide `Pause` icon-only），點擊後暫停連線並保留於「本次連線」
  - `異常`：主要按鈕為「重試」（Lucide `RotateCcw` icon-only），`⋯` 選單提供移除連線紀錄
- **階層感知搜尋、狀態篩選與可收合資料夾樹契約 (Hierarchy-Aware Search, Filter & Subtree Collapse)**：
  - 「搜尋連線」上方固定工具列提供即時搜尋框（`搜尋...`，支援清除按鈕與 `ESC` 清空）、狀態篩選列，以及 `符合 X 項` + `[批次 ▾]` 篩選結果批次選單。
  - 狀態篩選列改採單選 `ToggleGroup`（`全部`、`已啟用`、`未啟用`、`異常`），再次點擊當前選取值時強制維持原選取值，不取消選取為空值；不相容項目仍歸類於 `未啟用`。
  - 關鍵字匹配範圍涵蓋：來源名稱、Bookmark 資料夾名稱、Temporary source 名稱、URL 與 `searchId`。
  - **Hierarchy-Aware Filtering (`filterLiveSearchSourceGroups`)**：
    - **Descendant Item Match**：當子孫資料夾內的項目命中搜尋關鍵字與 `statusFilter` 時，自動保留其所有 ancestor folders（ancestor 節點之 `items` 僅含該層自身命中的 direct items）以維持完整階層上下文，並隱藏未命中的 sibling 分支。
    - **Folder Name Match**：當資料夾名稱命中搜尋關鍵字時，保留其 ancestors，並將該資料夾及其整個 descendant subtree 下符合目前 `statusFilter` 的所有項目視為命中。
    - **Status Filter + Hierarchy**：切換至 `已啟用` / `未啟用` / `異常` 時，只要某資料夾或其子孫含有符合該狀態的項目，其 ancestor chain 即保留；若整個 subtree 皆無符合該狀態的項目則隱藏。
  - 狀態分類定義：`已啟用`（`connecting` / `active` / `reconnecting`）、`未啟用`（無對應 active subscription 或 `idle` / `closed`）、`異常`（`error`）。不修改一般書籤面板的 `useBookmarkSearch.ts`。
  - **Subtree Collapse 與視覺縮排**：
    - 所有 Bookmark 資料夾與 `暫時搜尋` 群組皆支援獨立展開/收合（session UI state，不持久化，不影響一般 `BookmarkPane` 的收合狀態）。
    - 收合 parent folder 時，同時隱藏其自身 direct items 與所有 descendant folders；當搜尋關鍵字或狀態篩選啟用時，暫時展開匹配分支而不修改 `collapsedGroupIds`，清除篩選後恢復原收合狀態。
    - 依 `depth` 套用與 `BookmarkFolderNode.vue` 一致之 scale/density-aware CSS token 縮排（`marginLeft: calc((var(--pxd-space-lg) + var(--pxd-space-md)) * depth)` 等價展開式）。
- **League Context 與單一工作區來源投影契約 (League-Scoped Source Projection)**：
  - **Selected League 唯一工作區概念**：主控台建立唯一「目前聯盟 (Selected League)」工作區。下方 Bookmark 與 Temporary Search 列表**僅呈現屬於目前選定 league 的搜尋來源**，不再把其他聯盟來源放在列表內並標記 `wrong-league`。
  - **防禦性診斷保留**：`wrong-version`（跨遊戲版本）與 `invalid-url`（網址解析失敗）依然保留在當前列表中並標記原因，不默默吞掉 malformed source。
  - **League Switch 領域操作、Teardown 與序列化 Transition Boundary**：
    - 切換聯盟是一級領域操作（`LiveSearchSourceController.switchLeague(targetLeague)`），嚴禁在 View 做純前端 filter 或直接 mutate runtime。
    - **Transition Boundary 與中斷機制**：
      1. SourceController 維護內部 transition generation 與 switch serialization chain。
      2. 每次 switchLeague 立即遞增 generation 並設定 `isSwitchingLeague = true`，使切換前已啟動但尚未完成的非同步 enable/batch 立即中止作廢，不得在 teardown 完成後繼續建立舊聯盟 subscription。
      3. `enableSource()` 強制驗證來源 canonical league 必須精確符合當前 `selectedLeague`，杜絕任何 stale candidate 跨聯盟污染。
      4. rapid consecutive `switchLeague()` 採確定性序列化（Promise queue），前一個 switch 的 `finally` 絕不可提早解除 switching guard，僅由最新 switch 完成時解除。
    - **切換順序與 Transaction Atomicity**：
      1. 標記 `isSwitchingLeague = true` 並設定 `pendingTargetLeague`，阻止新的 enable/batch 操作進入過渡期。
      2. 先透過不帶 `targetLeague` 的 `liveController.teardownAll()` 安全停止目前 Runtime 的所有 subscriptions（包含 `connecting`、`active`、`reconnecting` 與 `error`）、解鎖 `runtimeLeague = null`、重置 `cumulativeRenderedTotal = 0`。
      3. 若該 switch 在開始前或 teardown 完成時已被更新的 switch supersede（`switchId !== currentSwitchId`），立即中止並回傳 `false`，**絕不發起 Host context rebind**（防止 superseded switch 留下永久 Host context commit）。
      4. 唯有當前仍為最新 switch 時，才透過 `liveController.teardownAll({ targetLeague })` 對 Host display container 執行 `ensureContainer({ league: targetLeague, realm, resetResults: true })` 完成原子 context rebind（若 Host `setSearchActive` 失敗或 no-op，Host Adapter 透過 `_withCommit` 完整回滾 container 狀態並回報失敗）。
      5. 一旦 Host rebind 成功完成，立即於該 switch transaction 內同步更新 `selectedLeague = targetLeague`，並序列化等待 `await preferences.update({ liveSearchSelectedLeague: targetLeague })` 完成後才進入下一筆排隊的 switch，確保多次 rapid switch 成功時最後穩定工作區必然是最後 persisted league，且當 superseded switch 已完成 Host rebind 並因後續 latest switch 失敗而成為實際 fallback 工作區時，該 fallback 聯盟亦已正確持久化；若 Preferences 儲存寫入失敗（unavailable），維持 non-blocking 語意，不回滾已成功的 Runtime / Host / Source switch、不產生 Source / Host split，亦不產生 unhandled rejection；若 Host rebind 本身失敗，則保留原 `selectedLeague` 與 Preferences SSOT 不變並穩定回傳 `false`（不 reject）。
      6. 於 `finally` 解除 `isSwitchingLeague` 與 `pendingTargetLeague`，並執行不帶 `targetLeague` 的純 Runtime subscription 安全掃蕩（清除切換期間延遲完成的 straggler 訂閱，但絕不重新觸發或改變 Host league context），重新計算並發佈來源投影 snapshot。
    - **語意隔離保證**：League Switch 屬於系統性切換工作區，**絕不得**刪除原聯盟的 Resume Intents。
    - **Host Display Container Context Rebind 保證**：
      於 League Switch 當下（無須等待新聯盟首筆 subscription 加入），Runtime 即透過 `teardownAllSubscriptions({ targetLeague })` 傳遞目標聯盟、`realm` 與 `resetResults: true`；Host Adapter 對既有 `displayLocalId` 重用並強制經由 store `_withCommit` 同步更新 `container.league`、`container.realm`，清空 `container.results`、重置 `container.total = 0` 與 `container.unreadHits = 0`，且若後續 `setSearchActive` 失敗或 no-op 則透過 `_withCommit` 完整回滾操作前狀態；若 store 缺失 `_withCommit` 則立即回傳失敗，阻止 `selectedLeague` commit，確保 Source、Runtime 與 Host 聯盟狀態始終一致。
  - **Temporary Search 在 League Context 下的生命週期**：
    - Canonical league 繼續為權威，不得因 selected league 竄改 URL 或 identity。
    - 若使用者輸入與目前 selected league 不同的 Temporary Search，系統安全拒絕並明確提示「此搜尋屬於 X，請先切換主控台聯盟後再新增」。
    - **切換聯盟保留 Temporary Search Metadata**：`switchLeague()` 絕不可刪除 `customSources`。原聯盟之 Temporary Search 僅因 League Projection 而隱藏，切回原聯盟時重新出現且狀態為 inactive；直到使用者關閉或刷新主控台分頁，page-session 記憶體釋放才消失。
  - **Startup League Resolution Readiness**：
    - Snapshot 具備 `leagueResolved: boolean` 語意。
    - 啟動時依確定性優先級解析 initial league：`1. persisted recent selected league > 2. Resume Store league > 3. authoritative Bookmark league > 4. official league > 5. Standard`。
    - Authoritative Bookmark collection 讀取完成後必須能參與 initial resolution，即使 official league fetch 失敗亦能自 Bookmark 敲定聯盟（例如 Hardcore），絕不提早 fallback 為 provisional Standard。
    - 在 `leagueResolved` 確立前，Snapshot 維持 `loading: true` 與 `leagueResolved: false`，ResumeController 保持 `state = 'waiting'`，絕不以未經決策之 provisional Standard 提早執行 startup restore。
- **Compact Console Status Header 與單一垂直捲動區契約**：
  - 頂部固定區以單列 Compact Status Header 呈現完整主控台狀態區：
    `[ 聯盟: SelectedLeague ▾ ] · [ X 監聽 ] (· [ Y 異常 ]) · (選配 [ 累計渲染 X ]) · [ API ● 正常 ▾ ]`。
  - **League Selector**：提供單一選單切換目前工作區聯盟，切換期間呈現 disabled 與 switching 回饋；選項由官方 League API、現有書籤與 Resume Store 之聯盟聯集去重提供；初始選擇依「最近選擇 > Resume Store 存在之聯盟 > 書籤聯盟 > 官方首選 > Standard」具備確定性（deterministic）。
  - 展開 Rate Limit 詳細資訊時，於頂部 `shrink-0` 固定區內展開，由下方 `flex-1` 單一「搜尋連線」列表捲動區（採用 ScrollArea Foundation 與 `pb-[var(--pxd-pane-scroll-end-space)]`）自動縮減高度，嚴禁產生第二層垂直捲軸。新增暫時搜尋則由獨立的 `TemporarySearchDialog` 承載，不擠壓或推移主控台列表內容。
- **搜尋連線封面縮圖唯讀投影契約 (Cover Thumbnail Projection & PoE CDN Boundary)**：
  - **唯讀投影與 PoE CDN 信任邊界**：`LiveSearchSourceItem.coverImageUrl?: string` 由 Bookmark canonical model 或經由 `isValidPoeCdnImageUrl` (`utils/poe-cdn-url.ts`) 驗證過的連線 metadata 唯讀投影（僅允許 `https://web.poecdn.com`、`https://webtw.poecdn.com` 與國服 `https://poecdn.game.qq.com`，且長度不得超過 `POE_CDN_IMAGE_URL_MAX_LENGTH`），任何非 PoE CDN、不安全協定（http、javascript、data:）或損毀網址一律投影為 `undefined`。不修改 Bookmark canonical storage schema。
  - **縮圖視覺與佔位對齊 (Visual Consistency & Placeholder Alignment)**：
    - 連線項目具有合法 `coverImageUrl` 時，渲染 `<img>`（`data-test="connection-item-thumbnail"`），套用 `size-[var(--control-height-sm)]`、`shrink-0`、`object-contain`、`alt=""` 與 `draggable="false"`，尺寸與 `BookmarkFolderNode.vue` 縮圖完全一致。
    - 連線項目無封面時，渲染固定尺寸之占位節點（`data-test="connection-item-placeholder"`，`size-[var(--control-height-sm)]`，置中符號 `•`），確保同區塊內各連線名稱垂直對齊，避免版面跳動。
  - **圖片載入失敗容錯 (Error Fallback Cleanliness)**：圖片載入失敗（`@error`）時透過 `visibility: hidden` 靜默隱藏，保留排版空間且不產生破圖破版，不發動任何 storage / preferences 改寫，亦不跳出 Toast 警告。
  - **主控台零封面管理邊界**：主控台不提供更換封面、移除封面、自動抓封面或結果圖探索功能，嚴格禁止引入 `useBookmarkCovers`。
- **搜尋連線預覽浮層契約 (Shared Trade Search Preview Tooltip)**：
  - **直球共用預覽架構**：`LiveSearchPrimaryPane.vue` 直接共用 `components/sidebar/search-preview/TradeSearchPreviewTooltip.vue` 與 `components/sidebar/composables/useTradeSearchPreview.ts`。嚴禁建立 `LiveSearchPreviewTooltip`，嚴禁複製第二套 URL decoder、dictionary loader 或 query metadata parser，亦不引入 `BookmarkPane` 專屬之 `useBookmarkPreview`。
  - **邊界錨定與外側定位契約 (Boundary Anchor & Outside Positioning)**：
    - Preview Tooltip 應定位在整個 Sidebar pane 的外側，而非僅局限於 identity trigger 的外側（Sidebar 在左側時 side = `'right'`，Preview 出現在 Sidebar 右側外側；Sidebar 在右側時 side = `'left'`，Preview 出現在 Sidebar 左側外側）。
    - `TradeSearchPreviewTooltip.vue` 透過可選之 `boundaryAnchor` prop（接收外層容器 Element，例如 `LiveSearchPrimaryPane` 的 root 容器），並經由通用 `preview-anchor.ts` 的 `createBoundaryVirtualElement` 生成 Floating UI / Popper 相容之 VirtualElement。
    - VirtualElement 定位基準：水平軸（X 軸）取自 `boundaryAnchor` 之左右邊緣（依 side 動態對齊外緣），垂直軸（Y 軸）必須永遠來自該 Tooltip instance 自身的 active trigger element（嚴格禁止全局 DOM 搜尋猜測）。
    - 保留適當 gap；nested folder indentation、row control 數量、書籤名稱寬度皆不得改變 Preview 與 Sidebar 外緣的相對距離；Preview 不得覆蓋 Sidebar 內部其他書籤或操作按鈕。
    - 一般 Bookmark consumer 未傳入 `boundaryAnchor` 時維持既有以 trigger 為錨點之定位行為，無 regression。
  - **適用對象與相容性邊界**：Bookmark Source 與 Temporary Search 只要具備合法官方 Trade URL（`compatibility !== 'invalid-url'`）皆支援 hover preview；`invalid-url` 來源硬契約禁止觸發預覽（`disabled: true`），防止損毀網址進入解碼器；`wrong-version` 但 URL 合法之來源可正常解析並展示 preview。
  - **觸發面與控制項嚴格隔離 (Confined Trigger Surface)**：Tooltip Trigger 僅包覆 row 左側之身分識別區（`[thumbnail/placeholder] Source Name [provenance]`），右側「啟用」、「停止」、「重試」、「⋯」等操作按鈕嚴禁置於 Tooltip Trigger 內部，確保使用者在點擊或 hover 右側按鈕時不會跳出預覽浮層遮蔽操作。
  - **動態彈出方向 (Dynamic Tooltip Side)**：依 `PreferencesModule` 之 `sidebarPosition` 動態推導：`sidebarPosition === 'left'` 時 side = `'right'`；`sidebarPosition === 'right'` 時 side = `'left'`。
  - **生命週期清理與快取共用 (Lifecycle & Cache SSOT)**：
    - Entity key 採用命名空間（`bookmark:id` 與 `custom:id`），保證唯一性。
    - **三元約束與動態對齊 (Identity, URL & Eligibility Constraints)**：預覽生命週期必須同時受實體識別碼（`activeEntityKey`）、當前來源網址（`activePreviewUrl`）以及相容資格（`compatibility !== 'invalid-url'`）嚴格約束；`activePreviewUrl` 與 `activeEntityKey` 共享相同的 entity-scoped 清理語意，非目前 active 實體的延遲關閉（late close）或無效網址事件不得清除當前 active 預覽的 URL context。
    - 當目前使用中之預覽項目發生以下任一狀況時，主控台必須立即關閉預覽並清除狀態：
      1. 來源項目自快照中刪除或已不存在。
      2. 來源項目因資料夾折疊、關鍵字或狀態篩選、或聯盟投影而不再可見。
      3. 正在進行聯盟切換（`isSwitchingLeague === true`）。
      4. 來源項目狀態轉變為 `invalid-url`。
      5. 同一實體識別碼之 `item.url` 與當初開啟預覽時記錄之網址不同（防範同 ID 在書籤同步、編輯或匯入後殘留舊網址之搜尋條件）。
    - 組件 unmount 時必須清理進行中的預覽。
    - 沿用 `useTradeSearchPreview` 既有之 `previewCache`，相同 URL 重複 hover 不發起重複 decode 請求。

## 9. Primary Exit Guard 與 Session Teardown 契約

### 職責與邊界分離 (Ownership != Runtime Session)

```text
Primary Tab Ownership (Background SSOT)
              ≠
LiveSearch Runtime Session (Primary Content Script)
```

- **Background 職責**：僅持有權威的 `Primary tab identity`。不持有任何 subscription、WebSocket 連線或 `/fetch` 佇列。
- **Content Runtime 職責**：持有 `subscriptions`、WebSockets、`/fetch` pipeline 與 session league。頁面真正的 teardown 僅由 `runtime.dispose()` 與 Content 生命週期完成。
- **嚴格禁止在 beforeunload 中清除 Background ownership**：Reload 與同分頁 Trade 導航亦會觸發 beforeunload，此時分頁依然是合法 Primary tab，不得建立第二條 ownership 清理通道。

### 三大離頁與導航生命週期情境

1. **Reload / Eligible Trade 導航**：
   - 使用者確認離開。
   - 舊頁面 Content 生命週期觸發 `runtime.dispose()`，WebSocket 與 Runtime session 結束。
   - Background Primary tab identity 依然保留。
   - 新 document 載入，Content 透過 `liveSearch:getPageRole` 依舊取得 `live-search-primary`。
   - 建立新的乾淨 Runtime session。
2. **關閉分頁 (Close Tab)**：
   - 觸發 `beforeunload` 警告。
   - 使用者確認關閉。
   - Content 生命週期觸發 `runtime.dispose()`。
   - Background 接收到 `chrome.tabs.onRemoved`，正式清除 `poexd_live_search_primary` 記錄，LiveSearch session 終止。
3. **導航至非 Trade 網址 (Navigate to non-Trade URL)**：
   - 觸發 `beforeunload` 警告。
   - 使用者確認離頁。
   - Content 生命週期觸發 `runtime.dispose()`。
   - Background 接收到 `chrome.tabs.onUpdated`，偵測到 URL 不再符合 Trade 資格，正式清除 Primary ownership。

### Deep Exit Guard Module (`live-search-primary-exit-guard.ts`)

- **極小介面**：對外僅暴露 `dispose(): void`。
- **高內聚低耦合**：Exit Guard 不得 import 或知道 `LiveSearchPrimaryRuntime`、Bookmark、WebSocket、Background Coordinator 或 Vue。唯一依賴由調用端注入的 `shouldWarn: () => boolean` 函式。
- **Warning 判定權威**：由 Composition Root (`runLogic`) 透過 `activePrimaryController.read().subscriptions.length > 0` 動態評估。
  - 只要 subscription entity 仍存在（包含 `connecting`, `active`, `error`, `closed`），皆視為有未儲存之 runtime state，離頁前提供保護。
  - 若所有 subscriptions 皆已被使用者移除（`subscriptions.length === 0`），則 `shouldWarn() === false`，不提示。
  - Normal Page 不實例化 Exit Guard，零 beforeunload 監聽。
- **Browser 原生 beforeunload 契約**：
  - 遵循標準 Chromium 實作：當 `shouldWarn()` 為 true 時，呼叫 `event.preventDefault()` 並設定 `event.returnValue = ''`。
  - 不使用自訂對話框（避免無法等待非同步 Dialog）。
  - **Cancel Leave 安全保證**：`beforeunload` handler 嚴禁包含任何破壞性操作（禁止提前 remove subscription、close WS 或 clear ownership）。若使用者在原生提示點擊「留在頁面」，所有 Runtime 狀態完整保留無損。
- **Best-Effort UX 限制記錄**：
  - `beforeunload` 屬於瀏覽器提供的 Best-Effort UX 保護，受限於 User Activation、進程崩潰、強制關閉政策等瀏覽器限制。
  - Exit Guard 僅作為使用者防呆保護，**不得作為 Runtime 正確性或 Teardown 的 SSOT**。系統正確性始終由 Content `runtime.dispose()` 與 Background tabs 事件保障。

## 10. Connection Session Policy & Auto-Reconnect 契約

### 10.1 職責邊界與生命週期分離

落實「Subscription Domain 專注業務管線，Connection Session 封裝 Transport 生命週期」之 Deep Module 設計：

```text
LiveSearchPrimaryRuntime (Subscription / Token / Fetch / Render Owner)
        │
        │ tiny connection-session interface
        ▼
LiveSearch Connection Session (WebSocket Transport & Reconnect Owner)
        │
        │ pacing task queue
        ▼
Primary Connection Open Scheduler (Primary-Wide Pacing Owner)
        │
        │ tiny transport seam
        ▼
Browser native WebSocket
```

- **Subscription Lifetime ≠ WebSocket Attempt Lifetime**：
  - Subscription entity 屬於業務領域，跨多次連線、意外斷線、重連甚至 terminal failure 期間始終存續。
  - WebSocket attempt 是拋棄式傳輸通道；單一 subscription 在生命週期中可依序經歷 attempt 1、attempt 2、attempt 3。
- **職責擁有權限邊界**：
  - **Runtime (`LiveSearchPrimaryRuntime`)**：唯一擁有 subscription identity、league scope、source-scoped token dedup (`pendingTokens`, `processedTokens`)、HTTP `/fetch`、FIFO 渲染佇列與 cumulative total。
  - **Connection Session (`LiveSearchConnectionSession`)**：唯一擁有 WebSocket attempt generation、stale callback 防護、current socket identity、重連定時器、retry budget、倒數計時與 manual retry transport lifecycle。
  - **Primary Open Scheduler (`LiveSearchOpenScheduler`)**：跨 subscription 序列化連線建立，擁有 1500ms connection-open pacing。

### 10.2 政策來源 (Policy Provenance)

- **Reconnect lifecycle 與 Pacing 政策**：
  - **適配來源**：PoeXD 桌面程式 `TradeSniper` 的線上搜尋 session 實作（桌面程式原始碼，不在本 repo）。
  - **非官方伺服器規定**：base delay 5s、max delay 120s、max retries 3 與 1500ms cooldown 為 **PoeXD 既有客戶端防護策略**，非官方網站伺服器協定或規定。
- **WebSocket Wire Protocol**：
  - **證據來源**：Phase 2A 官方網站實機 Runtime 稽核報告（內部研究筆記，未收錄於本 repo）。
  - 握手後第一筆訊息為 `{"auth": true}`（PoeXD 忽略，零 fetch 與零 render）。
  - 命中商品推播為 `{"result": "<JWT>", "count": 1}`（相容 legacy `new`）。

### 10.3 Attempt Isolation 與 Stale 防護

- **Generation Identity**：每次建立新 attempt（initial start、auto reconnect 定時器觸發、manual retry）均遞增 `generation`。
- **雙重檢查機制**：所有 WebSocket 事件回呼必須同時滿足：
  `attemptGen === this.generation && ws === this.currentWs`
- **隔離保證**：舊 socket 的 `open`、`message`、`error`、`close` 在新 attempt 開始後立即丟棄，**絕不**修改目前 session 狀態，**絕不**觸發 token delivery 或 fetch pipeline。

### 10.4 瀏覽器事件正規化 (Browser Event Normalization)

- **Error + Close Coalescing**：
  - 瀏覽器原生 WebSocket 常見流程為先觸發 `error` 事件，隨後觸發 `close` 事件。
  - Connection Session 將同一次 attempt 觸發的 `error` + `close` **正規化為單次連線失敗**，嚴禁重複扣除 retry budget 或重複啟動重連計時器。
- **Close-Only 支援**：
  - 若連線未收到前置 `error` 事件而直接收到 `close`，同樣正規化為單次失敗並進入重連政策，杜絕連線卡死在未受管理的關閉狀態。

### 10.5 自動重連與 Retry Budget

- **預設參數基準**：
  - `baseDelayMs`: 5,000 ms (5 秒)
  - `maxDelayMs`: 120,000 ms (120 秒)
  - `maxFailedAttempts`: 3 次
  - `jitterRatio`: ±20%
- **Backoff 計算**：
  `delay = baseDelay * (4 ** (failedAttempts - 1))`，疊加 `±20%` 隨機 jitter，上限封頂於 `maxDelayMs`。
- **成功重置 (Success Reset)**：
  任一 attempt 的 `ws.onopen` 成功觸發時，立即清除重連定時器，並重置 `failedAttempts = 0`。
- **耗盡轉為 Terminal Error (Retry Exhaustion)**：
  連續失敗次數超過 `maxFailedAttempts` (3次) 時，不再自動排程重連，進入 terminal `error` 狀態。
  Subscription entity 完整保留，UI 呈現連線失敗並提供「重試」與「停止」按鈕。

### 10.6 手動重試 (Manual Retry)

- **窄命令**：由 `LiveSearchPrimaryController.retry(subscriptionId)` 觸發。
- **僅允許 Terminal Error 狀態重試**：若 subscription 處於 `active`、`connecting` 或 `reconnecting`，拒絕重試。
- **同一實體保證**：
  - 嚴禁銷毀後重新 `addSubscription`。
  - 嚴禁產生新的 `subscription.id`。
  - 嚴禁釋放或重配 canonical search identity。
  - 重置連線 failure state，透過同一 Primary Open Scheduler 排隊建立新連線。

### 10.7 Processed Token 跨重連保留 (Dedup Continuity)

- `processedTokens` 屬於 SubscriptionContext，不屬於個別 WebSocket attempt。
- 自動重連或手動重試後，若官方伺服器再次推播已處理過的 token：
  - Source-scoped dedup 攔截成功。
  - **Zero Duplicate Fetch**。
  - **Zero Duplicate Render**。

### 10.8 Primary-Wide Connection Open Pacing

- 所有 subscriptions 共用同一瀏覽器登入狀態與會話。
- 所有 initial connection、auto reconnect 與 manual retry 一律進入 `LiveSearchOpenScheduler`。
- 每次建立 WebSocket 連線後冷卻 1500ms，防止批量書籤加入或並發重連時瞬間衝擊伺服器。
- **排隊取消防護**：若 queued open 在等待冷卻時該 subscription 被移除或 dispose，執行時 generation mismatch 自動攔截，**Zero WebSocket Creation**。

## 11. Normal Page「使用線上搜尋開啟」/「送入線上搜尋主控台」與主控台 Trade URL 自動命名契約

### 11.1 一般頁面雙軌入口：「使用線上搜尋開啟」與「送入線上搜尋主控台」

- **產品行為與邊界**：
  - 一般 Sidebar `BookmarkPane.vue` 與 `BookmarkFolderNode.vue` 書籤選單同時提供：
    1. 「**使用線上搜尋開啟**」：透過 `toLiveUrl(bookmark.url)` 將書籤網址轉換為官方 `/live` URL，並以 `window.open(toLiveUrl(bookmark.url), '_blank')` 於新分頁開啟官方線上搜尋頁面。
    2. 「**送入線上搜尋主控台**」（資料夾選單為「**將資料夾送入主控台**」）：透過 `'liveSearch:enqueueConnections'` 將書籤或資料夾內相容書籤背景送入該遊戲版本的線上搜尋主控台，**不切換使用者目前所在的一般頁面分頁**，並以 Toast 提示派送結果。
  - 一般 Trade 頁面官方搜尋控制列注入「**送入主控台**」（`.poexd-send-to-console-btn`）按鈕，點擊後先將搜尋表單條件同步至 URL，再以 `'liveSearch:enqueueConnections'` 背景送入線上搜尋主控台。
  - 主控台分頁內部的「搜尋連線」區塊透過分頁內的 `LiveSearchSourceController`（別名 `LiveSearchBookmarkController`）運作，啟用書籤來源時直接沿用 `bookmark.name`。

### 11.2 主控台 Trade URL 自動解析訂閱名稱契約（雙分支與 `disabled` 驗證鏈）

當使用者於 `LiveSearchPrimaryPane.vue` 輸入可透過 `decodeTradeSearchUrl()` 解碼的 Gzip-Base64URL Trade 搜尋網址時，透過 `extractQueryMetadata()` (`utils/trade-url-codec.ts`) 與 `utils/trade-stat-dictionary.ts` 既有字典鏈自動推導訂閱名稱（**嚴禁**從 `document.title` 取名，且僅允許使用 `name`、`type`、`category`、`rarity` 四個來源）：

1. **篩選器 `disabled` 有效性驗證鏈 (`getEffectiveFilterOption`)**：
   - 讀取 `category` (`query.filters.type_filters.filters.category`) 與 `rarity` (`query.filters.type_filters.filters.rarity`) 時，必須檢查整條有效性鏈（`query.filters`、`type_filters`、`type_filters.filters`、`category` / `rarity` 節點本身及其 `.option` 物件）。
   - 若任一層節點標記 `disabled === true`（例如官方搜尋面板將 `type_filters` 群組停用但仍保留舊 `.option` 值，或單一篩選欄位 `disabled: true`），一律視為**未生效（空字串）**，絕不納入名稱組合。
2. **分支 A：有 `name` 或 `type` 時（`name + type + rarity`，不取 `category`）**：
   - 透過 `translateItemName(rawName, version)` 與 `translateItemName(rawType, version)` 翻譯物品名稱與基底類別：
     - 同時有 `name` 與 `type`：`itemLabel = (name === type ? name : "${name} (${type})")`
     - 只有 `name`：`itemLabel = name`
     - 只有 `type`：`itemLabel = type`
   - 若有效 `rarity` 存在（透過 `formatFilterValue(rarity, 'rarity', version)` 翻譯為 `傳奇` / `稀有` / `魔法` / `一般` 等），附加於後方：`"${itemLabel} ${rarityLabel}"`（例如 `魔血 (重型腰帶) 傳奇`、`魔血 傳奇`、`重型腰帶 傳奇`）。
   - 若有效 `rarity` 不存在，直接回傳 `itemLabel`。
3. **分支 B：無 `name` 且無 `type` 時（`category + rarity`）**：
   - 以有效 `category`（透過 `formatFilterValue(category, 'category', version)` 翻譯，如 `胸甲`）與有效 `rarity`（如 `傳奇`）以單一空白組合：`[categoryLabel, rarityLabel].filter(Boolean).join(' ')`。
   - 同時有 `category` 與 `rarity`：`"$categoryLabel $rarityLabel"`（例如 `胸甲 傳奇`）。
   - 只有 `category`：`categoryLabel`（例如 `胸甲`）。
   - 只有 `rarity`：`rarityLabel`（例如 `傳奇`）。
   - 兩者皆無（包含僅有 `stats` 的查詢）：`suggestedName = ''`（不產生 `自訂條件搜尋`、`篩選: ...` 或分類/稀有度前綴文字）。

### 11.3 表單自動回填與手動編輯權重 (`LiveSearchPrimaryPane.vue`)

1. 使用者輸入可 decode 的 Trade URL 時，自動將解析出的 `suggestedName` 填入 `inputName`；同一個 `syncAutoNameForUrl()` Promise 生命週期涵蓋 `loadTradeDictionaries(decoded.gameVersion)` 完成後的最終翻譯回填。
2. 若 URL 改變且目前名稱為空白或等於前一次自動回填值，更新為新 URL 的自動名稱。
3. 若使用者已手動編輯名稱，後續 URL 變更或字典載入完成絕不覆蓋使用者手動輸入的名稱。
4. 若使用者將名稱清空，視為重新允許自動回填。
5. 若 URL 無法 decode 或推導結果為 `''`，`inputName` 維持空白（若非手動輸入）。
6. 提交成功後重置 `inputUrl`、`inputName` 與自動回填追蹤狀態。

## 12. 線上搜尋主控台 Result-Only Presentation 與宿主防護契約 (`LiveSearchConsoleHostGuard`)

在線上搜尋主控台（`pageRole === 'live-search-primary'`）頁面中，官方市集結果列表容器由 PoeXD 接管作為多筆訂閱的合成結果串流顯示區。主控台透過 `LiveSearchConsoleHostGuard` 實施 **Result-Only Presentation + Defense-in-Depth Guard**，確保使用者僅看到與操作官方結果渲染區及 PoeXD Sidebar：

### 12.1 Result-Only 視覺隱藏與完整保留邊界 (`LiveSearchConsoleHostGuard`)

- **僅於主控台角色啟用**：
  - 由 `runLogic` 在確認 `pageRole === 'live-search-primary'` 時啟動 `LiveSearchConsoleHostGuard`，Normal Trade 頁面（`pageRole === 'normal'`）完全不介入。
- **隱藏並停用之非結果官方區塊 (`OFFICIAL_NON_RESULT_CHROME_SELECTORS`)**：
  - 根節點掛載 `data-poexd-console-result-only="true"` 並注入 `<style id="poexd-console-result-only-style">`，同時由 `MutationObserver` 對匹配元素標記 `data-poexd-console-hidden="true"`、`aria-hidden="true"` 及行內 `!important` 隱藏樣式（`display: none !important; visibility: hidden !important; pointer-events: none !important;`，防止官方 `RootTrade.mounted` 的 `$("#trade .top").fadeIn()` 重新顯示面板）：
    - 官方頂部帳號/狀態列：`#statusBar`
    - 官方返回主頁、Logo 與語系切換列：`.wrapper > .linkBack`、`.wrapper > .logo`、`.wrapper > .language-select`
    - 官方交易導覽分頁列：`#trade > .navigation`（搜尋列表、批量交易、關於、設定、歷史）
    - 官方頂部搜尋與附屬面板容器：`#trade > .top`、`.search-panel`（含 `.search-bar`、`.search-advanced` 與頂/底 `.controls`）
    - 官方頁尾：`.content > .bottom`
- **強制保留之結果渲染祖先鏈、官方浮層與 PoeXD UI (`PRESERVED_CONSOLE_RESULT_SELECTORS` / `REQUIRED_CONSOLE_ANCESTOR_SELECTORS`)**：
  - 嚴格排除並完整保留 `.results` 之掛載與排版祖先鏈：`html` -> `body` -> `div.container-fluid.full` -> `div.content` -> `div.wrapper` -> `div#trade` -> `div#vue3-portal` -> `div.results` -> `div.resultset` -> `div.row`（以及負責 Teleport 結果區的 Vue 3 根節點 `div#app`）。
  - 完整保留官方結果卡片互動與浮層基礎設施：`#poe-popup-container`、`.popup-manager`、`#cboxOverlay`、`#colorbox`、`.toast-container`、`button.top-btn`、商品卡（`.results .row[data-id]` 內之 `.left`、`.middle .item-popup`、`.middle .itemPopupAdditional`、`.right` Whisper / Direct Whisper / Hideout / 賣家 `_blank` 連結）、底部 `.results .row.controls .load-more-btn`，以及 `ResultPricePresenter` 與 `ResultModHighlighter` 標註掛載點。
  - 完整保留 PoeXD ShadowRoot UI：`poexd-sidebar-container`、`poexd-toast-container`、`.pxd-sidebar-wrapper`、`[data-sidebar-pane]`。
- **Capture 階段縱深防禦與 Teardown 還原**：
  - 於 `document` capture 階段攔截落於上述非結果官方區塊、`.search-btn` / `.livesearch-btn` 控制項、非結果區同分頁跳轉連結 `a[href]`，以及 `document.body` 與 `.search-advanced input.form-control` 之 `Enter` 鍵與 `.search-panel` 之 `submit` 事件。
  - `dispose()` 時完整移除注入之 `<style>`、`data-poexd-console-result-only`、`data-poexd-console-hidden`、行內隱藏樣式與按鈕禁用狀態。

### 12.2 Main World 網路層安全網 (`network-observer.ts`)

- **跨世界狀態同步**：
  - `LiveSearchConsoleHostGuard` 啟動與 `dispose()` 時，透過 `poexd-livesearch-console-guard` CustomEvent 傳遞 `{ active: boolean }` 同步防護狀態至 Main World。
- **阻斷官方 `/api/trade*/search` 請求**：
  - 當主控台防護啟用（`isConsoleSearchGuardActive() === true`）時，Fetch 與 XHR 攔截器直接阻斷 `/api/trade/search` 與 `/api/trade2/search` 請求，同時完整放行 `/api/trade/fetch`、`/api/trade2/fetch`、`/api/trade/data` 等商品明細讀取與靜態資料 API。

## 13. LiveSearch `/fetch` Rate Gate 契約 (`LiveSearchFetchRateGate`)

### 13.1 Upstream Lineage 與 Ownership 劃分

- **PoeXD Upstream Lineage**：
  - Rate header semantics derived from the PoeXD desktop app's production rate-limit handling (desktop source, not in this repo), adapted to Extension ownership rather than duplicated wholesale.
  - 沿用 GGG `limit:window:cooldown` / `used:windowLeft:cooldownLeft` 欄位語意與 `X-Rate-Limit-Rules` 動態 rule 探索機制；**不**搬入舊版 `90% usage 自動 pause`、`missing headers 固定 sleep 1 秒`、預設固定額度常數或 Vue `shallowReactive` `RateLimiter`。
- **正式 Ownership 三層邊界**：
  - **`LiveSearchPrimaryRuntime`**：single FIFO pipeline owner + token / domain / render owner（唯一負責跨 token / 跨 subscription 的 FIFO pipeline queue 與排序權威、subscription 與 token 生命週期、source-scoped `pendingTokens` / `processedTokens` 去重、`/fetch` URL 組裝、JSON 驗證、Host render 交易與 `cumulativeRenderedTotal`）。
  - **`LiveSearchFetchRateGate` (`entrypoints/content/logic/live-search-fetch-rate-gate.ts`)**：HTTP admission / cooldown / rate-state owner（負責單次 HTTP `/fetch` 准入控制、解析並保存目前 runtime session 之 rule/window 狀態、下次請求前等待必要 cooldown、處理 `Retry-After` 與同一 request lifecycle 內之 HTTP 429 單次有限重試，以及 `dispose()` / 訂閱移除時立即取消等待；不負責跨 token / 跨 subscription 排序或通用工作佇列）。
  - **GGG Response Headers**：quota authority（所有等待時間均由伺服器回應標頭推導，絕不將歷史固定配額數字寫成產品常數）。

### 13.2 Pure Rate Header Parser 與 Admission Policy

- **純函式解析 (`parseTradeRateLimitHeaders`)**：
  - 動態解析 `X-Rate-Limit-Policy`、`X-Rate-Limit-Rules`、`X-Rate-Limit-{rule}`、`X-Rate-Limit-{rule}-State` 與 `Retry-After`。
  - 支援單一或多條動態 rule（包含未知未來 rule 名稱）、單一或逗號分隔之多區間 window；遇到缺失標頭、window 數量不一致或損毀數值時安全忽略該無效項目，絕不拋出例外中斷 pipeline。
- **准入與等待推導 (`computeRateLimitWaitMs`)**：
  - **Active restriction (`cooldownLeft > 0`)**：任一 rule window 回報 `cooldownLeft > 0` 時，下次請求必須等待最大有效 cooldown。
  - **Window exhausted (`used >= limit`)**：任一 rule window 已達配額上限（`used >= limit`）時，下次請求必須等待該區間重置（`windowLeft` 或 `window`），不得立即送出或 busy-loop。
  - **`Retry-After` 協同權威**：若回應帶有合法 `Retry-After`，與 rate-state 推導之等待時間取較大（較保守）值。

### 13.3 HTTP 429 有限重試與 Queue / Dispose 正確性

- **HTTP 429 處理**：
  1. 先 ingest 429 回應之 rate-limit 標頭與 `Retry-After` 更新 gate 狀態。
  2. 不執行 Host render、不遞增 `cumulativeRenderedTotal`、不標記 `processedTokens`。
  3. 不立即重送；等待 Rate Gate cooldown 解禁後，同一 `/fetch` 任務至多執行 **1 次**有限重試（`maxRateLimitRetries = 1`）。
  4. 若重試成功（200 OK），正常完成單次 render、單次 `cumulativeRenderedTotal` 遞增並寫入 `processedTokens`；若重試仍失敗，清理 `pendingTokens` 且不寫入 `processedTokens`，確保 token 不永久丟失。
  5. 一般 `4xx / 5xx`、網路例外或無效 JSON 不執行自動重試。
- **Subscription 移除與 Runtime Dispose 即時取消**：
  - `removeSubscription(id)`：排隊中或正在等待 rate cooldown 的該訂閱任務立即取消等待，不再發起後續 `/fetch` 或 render。
  - `runtime.dispose()`：清空佇列並呼叫 `fetchRateGate.dispose()` 立即中斷所有進行中的 cooldown 計時器，確保零後續 `/fetch` 且絕不懸掛等待。

### 13.4 Per-Version Runtime-Local Scope 邊界聲明

- PoE 1 與 PoE 2 線上搜尋主控台各自擁有獨立的 `LiveSearchPrimaryRuntime` 與 Runtime-local `LiveSearchFetchRateGate`（不建立 Background 全域資料庫、`chrome.storage` rate state 或跨分頁分散式限流器）。
- **明確架構邊界（Boundary, Not a Bug）**：
  `Runtime-local Rate Gate` 只能控制 PoeXD 該主控台分頁自己產生的 `/fetch` 流量，無法成為整個瀏覽器、其他官方交易分頁或其他外部應用程式的 GGG quota SSOT。

### 13.5 `/fetch` Rate Limit 詳細狀態單向投影契約

- **單向投影鏈路 (`FetchRateGate -> PrimaryRuntime -> PrimaryViewSnapshot`)**：
  - `LiveSearchFetchRateGate` 提供 `read()` 與 `subscribe(listener)` 唯讀狀態發佈介面；每當 `ingestResponseHeaders()` 解析並更新 rate-limit 標頭（包含 HTTP 200 以及 HTTP 429 進入 retry cooldown 等待前）時，立即發布最新 `TradeRateLimitStateSnapshot` (`policy`、`rules`、`nextAllowedAtMs`)。
  - `LiveSearchPrimaryRuntime` 訂閱 `fetchRateGate.subscribe()` 並將 `rateLimit` 納入 `LiveSearchPrimaryViewSnapshot`；`dispose()` 時解除訂閱並停止發佈。
  - `LiveSearchPrimaryPane.vue` 僅透過 `LiveSearchPrimaryController` 之 snapshot 讀取 `rateLimit`（View 嚴禁直接 import `LiveSearchFetchRateGate`），於 Compact Status Header 右側常駐呈現「`API ● 正常` / `API ◐ 等待 X 秒`」狀態；點擊展開（session UI state）後顯示 `下一次可請求：立即 / X 秒`，以及全繁體中文化之 rules（`帳號` / `IP` / `客戶端`）與各 window 之 `次數 used / limit`、`統計區間 X 秒`、`冷卻時間 X 秒`、`區間剩餘 X 秒`、`冷卻剩餘 X 秒` 明細；不顯示 `Policy`；尚未收到標頭時展開顯示 `尚未收到速率限制資料`。

## 14. LiveSearch Resume Plan 與 Startup Restore 契約

### 14.1 核心定義與架構分離保證

```text
LiveSearch Resume Plan
= durable per-version activation intent for search connections enabled in the console (both Bookmark and Temporary/Pushed connections).
```

- **嚴格分離保證**：
  - **`Resume Plan != Runtime state`**：Resume Plan 代表「使用者上次希望持續監聽的啟用意圖」，絕非 Runtime snapshot、WebSocket 連線狀態或 subscription persistence。
  - **統一紀錄範圍（Bookmark 與非書籤連線）**：只要在主控台成功啟用過的連線（包含書籤連線、從「＋ 新增連線」輸入的網址，或從一般頁面「送入主控台」的搜尋），皆會記錄至 `LiveSearchResumeStore`（附帶選用顯示資訊 `name?`、`url?`、`coverImageUrl?`），使下次啟動主控台時未啟用的項目皆能完整呈現於「上次連線」(`previousConnections`) 區塊。
  - **`Resume Mode is Preference`**：恢復模式屬於版本隔離的持久化偏好設定（`liveSearchResumeMode`: `'off' | 'prompt' | 'auto'`，預設 `'prompt'`），由 `PreferencesModule` 統一管理。
  - **`Resume Plan is independent retained domain data`**：Resume Plan 為獨立持久化領域資料，絕不塞入 Preferences、絕不塞入 Bookmark schema、絕不塞入 Background Primary coordinator，亦不得以 Runtime snapshot 作為持久化依據。

### 14.2 儲存契約 (Storage Ownership & Schema)

- **獨立小型 Persistence Domain**：由 `utils/live-search-resume-store.ts` 集中管理。
- **儲存介質**：使用 `chrome.storage.local`，並依 `poe1` / `poe2` 版本嚴格隔離（key: `liveSearchResumePlan_poe1` 與 `liveSearchResumePlan_poe2`）。
- **Versioned Structured Schema (Version 2 with V1 Migration)**：
  ```ts
  export interface LiveSearchResumeIdentity {
    gameVersion: PoeVersion;
    league: string;
    searchId: string;
    name?: string;
    url?: string;
    coverImageUrl?: string;
  }
  export interface LiveSearchResumePlanData {
    version: 2;
    identities: LiveSearchResumeIdentity[];
  }
  ```
  - **向後相容與升級遷移**：當讀取到 `version: 1` 格式時，自動將其 `identities` 陣列無損升級為 `version: 2`；寫入時統一寫入 `version: 2`。
- **禁止儲存欄位**：嚴格禁止儲存 `subscriptionId`、`bookmarkId`、`Search Record ID`、資料夾、Temporary Source ID、status、error、reconnect state、WebSocket state、tokens、queue、timestamps 或 query criteria。
- **並行寫入防禦**：Store 內部採用序列化 Promise chain 寫入，杜絕並行丟失寫入（lost write）。
- **儲存狀態與錯誤隔離 (Store Contract: unloaded / loaded / error)**：
  - 儲存讀取失敗時，Store 絕不得建立假的空 Plan，不得覆寫未知 storage 內容，亦不得在此時 prune；storage 恢復後下次讀取仍能取得原本 persisted Plan。
  - `clear()` 必須精準反映底層儲存刪除之成功/失敗；若 `storage.remove()` 失敗，快取不清除、`hasPersistedPlan` 不得置為 false，Runtime 完全不受影響。
- **儲存錯誤非阻塞保證**：Storage failure 僅作為單次警告或非阻塞回饋，絕不得 rollback 或阻止正常 LiveSearch Runtime 連線與操作。

### 14.3 更新語意與 Per-League Intent 契約 (Update Semantics)

- **Resume Plan 同一遊戲版本下支援多聯盟共存 (Per-League Intent Retention)**：
  不再實施 single-league replacement。同一 `PoeVersion` 下，可以同時保存多個 league 的 Resume Intents：
  - 當使用者在特定聯盟啟用搜尋連線時，僅追加或保留該聯盟的 intents，**絕不覆蓋或刪除其他聯盟的啟用意圖**。
  - 當使用者將某搜尋從「本次連線」或「上次連線」明確移除時，僅撤銷該搜尋在該聯盟的持久化紀錄。
- **搜尋連線啟用成功時加入**：使用者執行單筆啟用、批次啟用、新增連線或從一般頁面送入主控台，在成功建立對應 Runtime subscription 後，將其 canonical identity (`gameVersion`, `league`, `searchId` 與選用顯示資訊 `name?`, `url?`, `coverImageUrl?`) 加入 Resume Plan。加入操作具備冪等性（idempotent，不重複加入）。若 Runtime add 失敗且未建立 subscription，不得加入。
- **暫停連線時保留、明確移除時刪除**：使用者點擊「暫停」（`stop` / `stopMany`）時，連線仍留在「本次連線」清單內，因此保留於 Resume Plan（下次重新開啟主控台時將顯示於「上次連線」）；唯有執行「從本次連線移除」（`removeSessionConnection`）、「移除已停止的連線」或「移除上次連線紀錄」（`removePreviousConnection` / `clearPreviousConnections`）時，才從 Resume Plan 移除。
- **系統性 League Switch 絕不移除 Resume Intent**：使用者透過主控台 League Selector 切換聯盟時，舊聯盟連線被安全終止，但其持久化 Resume Intent 完整保留；日後切回該聯盟仍可繼續恢復。
- **Runtime 錯誤不移除 Resume Intent**：WebSocket error、reconnecting、terminal reconnect error、`/fetch` error、429 或 status = error 等非主動終止事件，**絕不得**從 Resume Plan 移除該搜尋。
- **Bookmark 刪除 / Canonical 修改時之 Authoritative Pruning**：
  只有最新 generation 的 successful authoritative Bookmark collection read 可以 reconcile Resume Plan。若 Plan 中存在已被刪除或已變更 canonical URL 的項目，該項目自 Plan 中 prune 移除；新 canonical 不自動加入，除非使用者日後實際啟用。Bookmark 僅更名或移動資料夾時，canonical identity 不變，Plan 保持不變。
- **Bookmark 讀取失敗絕不 Prune**：Bookmark read failure、中途 stale read 或 storage error 絕不可視為書籤不存在，禁止清空 Resume Plan 或 prune identities。
- **Temporary → Bookmark Promotion**：當 active Temporary Search 因外部新增同 canonical Bookmark 而升格時，此活躍連線正式由 Bookmark owner 持有，自動將其 canonical identity 加入 Resume Plan，且零 reconnect。
- **啟動瞬間防清空保護 (Fresh Runtime Safety)**：新主控台啟動時 `Runtime subscriptions = []` 是正常狀態，絕對禁止以當前空的 Runtime subscriptions 覆蓋 Resume Plan。

### 14.4 啟動協調與決策 (Startup Orchestration & Seam)

- **單一 Document 決策至多執行一次**：主控台建立時初始化 document-transient state machine (`idle -> waiting -> prompted | restoring | off -> restored | skipped`)，避免 source snapshot 變更引發重覆恢復迴圈。
- **等待 Authoritative Bookmark 就緒與 Delayed-Read Race 防護**：
  - 啟動決策必須等到 Resume Plan 成功讀取且 Bookmark Source 成功載入非 loading、非 error 的 authoritative snapshot 後才執行。
  - 若在 await resumeStore.read() 期間 Bookmark 產生更新的 snapshot，決策必須以最新 authoritative snapshot 為準，不可沿用過期 snapshot。
- **Canonical Identity 永遠為權威 (No Stale Bookmark ID Dependency)**：
  - Resume Plan 僅持有 canonical identity；Bookmark ID 僅為執行當下由最新 authoritative source snapshot join 出的 transient locator。
  - 使用者點擊「恢復」時，必須在執行當下動態重新比對 `最新 Plan ∩ 最新 Authoritative Bookmarks`，嚴禁使用啟動時保存之 stale Bookmark IDs。
- **先 Resolve Selected League 再執行 Resume 決策**：
  - 啟動決策依據已解析完成之 `selectedLeague`，**僅針對該聯盟**計算 `resumableCount` 與執行恢復。
  - 例如 Plan 同時包含 Standard (3 項) 與 Hardcore (2 項)，當前工作區為 Standard 時，僅恢復或提示 Standard 3 項，絕不同時跨聯盟恢復。
- **手動切換聯盟不自動執行 Auto-Restore**：
  - 手動切換 League Context 是工作區切換，**硬契約禁止**因 `auto` 設定而在切換時自動發起連線。
  - 切換後，新聯盟若存在 persisted intents，資料完整保留供 UI 提示或手動恢復。
- **模式語意（`liveSearchResumeMode`）**：
  - **`off`（UI 顯示：「清理」）**：啟動主控台時不自動恢復連線，並自動清除當前 `selectedLeague` 下尚未加入「本次連線」的上次連線紀錄（保留其他聯盟之持久化紀錄）。
  - **`prompt`（UI 顯示：「保留」）**：啟動主控台時將上次連線紀錄保留並投影於「上次連線」(`previousConnections`) 區塊，供使用者於區塊內單筆啟用、單筆移除、一鍵「全部恢復」或清空（不在頂部或側邊導覽列重複渲染獨立恢復橫幅/按鈕）。
  - **`auto`（UI 顯示：「自動恢復」）**：啟動時若當前聯盟有可恢復項目，直接呼叫 `LiveSearchSourceController.enableMany()`，完全重用既有相容性 preflight、canonical dedup、mixed-league atomic rejection 與 1500ms pacing。若 Plan 含損壞之跨聯盟項目，由 `enableMany()` 原子上報失敗，禁止部分恢復。
- **手動切換聯盟 (Manual League Switch) 投影與保護**：
  - 手動切換聯盟絕對不得觸發 auto restore。
  - 切換至有持久化紀錄的聯盟時，「上次連線」(`previousConnections`) 自動投影該聯盟尚未加入本次連線的項目；切回原聯盟時，原聯盟的紀錄依然完整保留並更新呈現。
- **View 不成為 Resume Domain Owner 與 Restore 執行權威保證**：
  - 使用者觸發恢復時，Controller 在執行當下重新以最新 Resume Plan 與最新 Authoritative Sources 進行動態 canonical 比對，嚴格拒絕信任或沿用過期 IDs。
- **Restore Outcome 視覺呈現**：
  - Prompt 恢復與 Auto 恢復之 `LiveSearchBatchOutcome` 均必須呈現給使用者（重用既有 `presentBatchEnableOutcome()`），例如 mixed-league 拒絕時呈現單次明確錯誤，絕不得 silent 或無事發生。
  - Controller 僅輸出 domain/orchestration outcome（Auto 恢復透過 snapshot 投影 `autoRestoreOutcome`），由 View 負責 toast/DOM 呈現，杜絕重複提示。
- **清除上次啟用記錄**：於主控台設定提供低權重清除按鈕，僅清除當前版本的 Resume Plan，不停止現存連線、不刪除暫時搜尋、不刪除書籤。
- **Narrow UI Seam**：`LiveSearchResumeController` 提供 narrow reactive snapshot (`state`, `resumableCount`, `resumableSourceIds`, `bannerVisible`, `hasPersistedPlan`, `autoRestoreOutcome`) 與操作命令（`restore()`, `skip()`, `clear()`），View 絕不直接操作 storage 或自行 join 書籤。
