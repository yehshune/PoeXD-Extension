# LiveSearch Official Host Adapter Architecture Contract (Phase 2B)

> **文件狀態**：COMPLETED (2026-09-24)  
> **關聯檔案**：
>
> - `entrypoints/interceptor.ts`
> - `entrypoints/main-world/official-livesearch-adapter.ts`
> - `entrypoints/main-world/bridge-bootstrap.ts`
> - `entrypoints/main-world/host-types.ts`
> - `utils/event-protocol-types.ts`
> - `tests/official-livesearch-adapter.test.ts`  
>   **上游研究依據**：`docs/research/live-search-official-runtime-audit.md` (Phase 2A)

---

## 1. 核心邊界與 Ownership (SSOT)

延續 Phase 1 與 Phase 2A 實機確鑿驗證之邊界：

1. **Primary Page Runtime Owner**：Primary Page (Content Script / Injected View) 是 LiveSearch runtime 與 view owner。
2. **Background Singleton Authority**：Background Service Worker 唯一權威持有 Primary 分頁 identity，不涉入 LiveSearch runtime 或搜尋生命週期。
3. **PoeXD Fetch Ownership**：PoeXD Primary Runtime 是 HTTP `/fetch` 唯一 owner。官方 Vue 組件僅作為結果卡片 renderer，嚴禁由官方發起 `/fetch`。
4. **WebSocket Ownership**：Primary Page Runtime 唯一擁有並維護 Source WebSockets 連線池。Host Adapter 專職純渲染，絕不擁有任何 WebSocket；合成 Display Container 嚴格保證不產生任何 `/search`、`/fetch` 或 WebSocket 請求。
5. **單一 Main World 整合架構**：
   - 嚴格延續唯一 Main World 進入點 `entrypoints/interceptor.ts`。
   - 嚴格延續唯一 Nonce 安全通訊橋梁 `MainWorldBridge`。
   - 嚴格禁止新增第二個 Main World entrypoint 或平行的 CustomEvent 系統。

---

## 2. OfficialLiveSearchAdapter 模組職責

置於 `entrypoints/main-world/official-livesearch-adapter.ts`，專職封裝與官方 Vue 2.6.10 / Vuex Store 的 Host-level 互動：

### 2.1 Ready 探測 (`isReady`) 與 Capability 驗證 (`hasStoreMutation`)

- 透過現有 `getVueStore()` 探測 Store 存在性、`commit` 介面與 `_mutations` 註冊表。
- 每個 operation 執行前強制校驗所依賴的官方 mutations（如 `addSearchQuery`, `setSearchActive`, `addSearchResult`, `setItemForSearchResult`, `resetActiveUnreadHits`），缺失時直接判定 failure，嚴格阻絕 unknown mutation 被 Vuex 吞掉或視為 no-op。
- 零重複實作 Vue store finder。

### 2.2 Display Container 保證 (`ensureDisplayContainer`)

- 接收由 Primary Runtime 提供的容器識別資訊：
  ```typescript
  export interface PoeLiveSearchEnsureContainerPayload {
    requestId?: string;
    localId: string;
    league: string;
    realm: 'pc' | 'poe2';
    resetResults?: boolean;
  }
  ```
- **LocalId 權限**：`localId` 由 Primary Runtime / domain 提供；Host Adapter 不作為 session identity owner。
- **重用優先與 Context Rebind 原子回滾保證**：若 `state.transient.searches` 中已存在該 `localId`，直接重用並確認 `setSearchActive`，絕不重複 commit `addSearchQuery`。若傳入之 `league` 或 `realm` 與既有容器不一致（或指定 `resetResults`），必須先保存既有容器之完整交易前快照（`league`, `realm`, `results`, `total`, `unreadHits`, `active`），再透過 store `_withCommit` 同步更新 `container.league`、`container.realm`，並清空 `container.results`、重置 `container.total = 0` 與 `container.unreadHits = 0`，徹底防止跨聯盟舊結果殘留污染。若後續 `setSearchActive` 拋出例外或為 no-op，必須透過 `_withCommit` 完整回滾上述所有狀態至操作前原值（絕不建立直接 mutation fallback），確保 `ensureDisplayContainer()` 失敗時具備零殘留污染的原子語意。
- **合成容器規格**：若不存在，合成符合官方最小安全 Shape 之 `HostSearchObject`（`id: "poexd_display_search"`、`live: false`、`status: false`、`results: []`）。關鍵在於 `live: false, status: false` 可徹底消除官方 Vue runtime 自主建立 WebSocket 之副作用，同時不影響結果卡片渲染、多次 batch 注入、whisper 與 tooltip 行為。
- **實體存在性驗證**：commit `addSearchQuery` 後，嚴格以實際 `state.transient.searches` 搜尋該 `localId` 物件；絕無假性 fallback，若未實際落盤立即回報 failure 且不呼叫 `setSearchActive`。
- **Active 狀態嚴格驗證**：在重用與新建雙路徑 commit `setSearchActive` 後，均強制驗證 `store.state?.transient?.search?.active?.localId === localId`。若為 no-op 或未成功切換，立即回滾 context rebind（若為既有容器）並回報 failure，且絕不呼叫 `showAdvancedSearch(false)`。
- **零自主網路請求保證**：合成容器保證 creates no /search, creates no /fetch, creates no WebSocket。

### 2.3 原子渲染交易與 Full-State Rollback 防護 (`renderFetchedResult`)

- 接收單一同步渲染參數：
  ```typescript
  export interface PoeLiveSearchRenderResultPayload {
    requestId?: string;
    localId: string;
    batchId: string;
    sourceSearchId: string;
    token: string;
    itemData: unknown;
    total: number;
  }
  ```
- **Capability 依賴**：執行前強制校驗 `addSearchResult`, `setItemForSearchResult` mutations 存在，且 `typeof store._withCommit === 'function'`，確保具備安全 Vuex commit 上下文還原能力。
- **核心原子交易契約 (Atomic Synchronous Call Stack)**：
  在同一個同步 JavaScript call stack 連續執行：
  ```typescript
  store.commit('addSearchResult', {
    localId: params.localId,
    resultId: params.batchId,
    id: params.sourceSearchId,
    result: [params.token],
    items: { [params.token]: params.itemData }, // 實機驗證之第一道零 Fetch 防線
    total: params.total,
    inexact: false,
  });

  store.commit('setItemForSearchResult', {
    localId: params.localId,
    id: params.batchId,
    itemId: params.token,
    itemData: params.itemData,
  });
  ```
- **絕對禁止中斷**：兩次 commit 之間嚴禁 `await`、Promise/microtask yield、timer 或二階段跨 world event round trip。
- **Token 識別語意嚴格分離**：
  - `token`（傳遞給 `setItemForSearchResult` 的 `itemId`）為 LiveSearch Result Token（即 `batch.items` lookup key）。
  - 嚴格禁止錯用 HTTP `/fetch` 回傳之 `itemData.id` 作為 `itemId`。
- **Total Semantics 契約**：
  - 在 `live: false` 下，官方 `addSearchResult` 執行 `container.total = params.total`，不進行內部累加。
  - Primary Runtime 傳入之 `total` 為展示區「實際保留」的結果數（受 `maxResults` 上限限制）；依連線篩選時為該連線的保留筆數。
- **展示筆數上限（`maxResults`）**：
  - render payload 可帶 `maxResults`；交易成功後，Adapter 依新批次插入位置判斷新舊方向，透過 `_withCommit` 淘汰超出上限之最舊批次（每批次一筆結果）。
- **同步展示總數（`poexd-livesearch-sync-total`）**：
  - 依連線篩選切換時，Content World 送出 `{ localId, total }`，Adapter 只對 PoeXD 展示容器以 `_withCommit` 寫入 `container.total`，並以 `command: 'sync-total'` 回報結果。
  - 若僅作為自訂結果卡片列表展示，各卡片由各自 `batch.items` 獨立渲染，官方卡片 renderer 對外層 `container.total` 無直接依賴。
- **完整交易前狀態同步 Rollback (Full Pre-Transaction State Rollback)**：
  - 在 `addSearchResult` 執行前，保存 `container` 之完整狀態快照（`id`, `inexact`, `total`, `results: [...container.results]`）。
  - 當以下任一情況發生時：
    1. `addSearchResult` 拋出例外（可能已執行部分屬性污染或 pop 舊 batch）。
    2. `setItemForSearchResult` 拋出例外。
    3. `setItemForSearchResult` 為 no-op（未成功將 `itemData` 綁定至 `batch.items[token]`）。
  - 統一透過官方 store 的 `_withCommit` 同步還原完整狀態：
    ```typescript
    container.id = snapshot.id;
    container.inexact = snapshot.inexact;
    container.total = snapshot.total;
    container.results.splice(0, container.results.length, ...snapshot.results);
    ```
  - 物理層面確保 failure 後：
    - `container.id === before.id`
    - `container.inexact === before.inexact`
    - `container.total === before.total`
    - `container.results` 包含原先所有舊 batch 且順序一致（被官方 limit pop 淘汰之舊 batch 均被還原，半套新 batch 徹底被移除）。
  - 杜絕官方 renderer 在 Vue flush 時因 `items[token] === null` 自主發送錯誤 `/fetch`。
- **Bridge 例外穿透防護**：
  - Adapter 內部全程 try-catch，禁止未捕獲 exception 穿透 bridge listener；一律對應 dispatch 帶有 `success: false` 與診斷訊息的 `poexd-livesearch-command-result`。

### 2.4 未讀數重置契約 (`resetUnreadHits`)

- 必須驗證 `resetActiveUnreadHits` 存在。
- 必須確認傳入之 `localId` 精確等於目前 `activeSearch.localId`，若不符則判定 failure 且零 mutation。
- commit 拋出例外時安全捕捉並回報 failure。

---

## 3. 跨 World 事件契約 (Cross-World Protocol)

延續 `utils/event-protocol-types.ts` 定義之標準事件：

| 方向                | 事件名稱                            | Wire 格式                                  | 意義說明                                               |
| :------------------ | :---------------------------------- | :----------------------------------------- | :----------------------------------------------------- |
| **Content -> Main** | `poexd-livesearch-ensure-container` | `PoeLiveSearchEnsureContainerPayload` 物件 | 要求 Main World 確保 displaySearch 容器就緒並啟用      |
| **Content -> Main** | `poexd-livesearch-render-result`    | `string` (JSON serialization)              | 單一跨 world 命令：注入已完成 Fetch 之批次與裝備       |
| **Content -> Main** | `poexd-livesearch-reset-unread`     | `PoeLiveSearchResetUnreadPayload` 物件     | 重置未讀計數提示                                       |
| **Main -> Content** | `poexd-livesearch-command-result`   | `string` (JSON serialization)              | 命令執行結果確認與診斷錯誤回報 (具備 `requestId` 配對) |

---

## 4. 本階段邊界限制 (Phase 2B Boundary)

本階段僅建立 Host Adapter 基礎設施，明確不包含以下項目：

- LiveSearch WebSocket manager / 連線池
- Subscription 訂閱條件之持久化與生命週期協調
- HTTP `/fetch` 批次客戶端與速率限制
- Sidebar 即時搜尋控制面板
- Bookmark / Secondary View 整合
- 破壞性 session 清理邏輯
