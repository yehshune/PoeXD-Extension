# 即時市集資料（Live Trade Data）實作計畫

> **文件狀態**：IN PROGRESS — 第 0、1 階段完成（國服待登入後補測）(2026-11-14)
> **決策依據**：[ADR-0014](../adr/0014-live-trade-data-from-the-current-page.md)（proposed，第 0 階段實測通過後改為 accepted）
> **範圍**：市集篩選標籤（`/data/filters` 的群組、欄位、選項）與市集寫法（`/data/stats`，含 pseudo）。詞綴階級、遊戲寫法、結果列標籤、物品名稱、傭兵資料與市集漢化分片不在範圍內，維持打包。

---

## 背景

2026-11-14 PoE 1 3.30 上線當天，官方市集已經有 `map_bonus`、`viscera`、`twice_corrupted` 等新篩選，`map_filters` 改名「Map Filters」並開始有各語系翻譯，`chart_*`、`map_gold` 被移除；擴充要等 poexd-data 重建、`pnpm data:sync`、發版後才跟上。官方頁面每次載入本來就會抓這些資料，擴充只要讀頁面已經有的那一份，不必自己發請求。

## 使用條件（摘自 ADR-0014）

| 條件       | 規則                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 語系       | 顯示語系 == Page Locale 才用即時資料；不同（市集漢化、跨服固定顯示語系）只用打包資料 |
| 合併       | 同 id 即時優先；即時沒有的 id 用打包，再走既有的 UI 語系 → en 後備；不跨語系混用     |
| 用途       | 只換顯示文字，不新增 id、不改送往 API 的值、不進 Search Record / Bookmark / 查詢流程 |
| 網路與儲存 | 不發請求、不加權限；只存記憶體，生命週期為一個 Search Observation Session            |
| 信任       | 來自 MAIN world，視為不可信：驗證形狀、型別、筆數與字串長度，只以文字渲染            |

---

## 第 0 階段：官網實測（必要，結果寫回本文件）

在國際服、台服、國服、日服（`jp.pathofexile.com`）的 PoE 1 與 PoE 2 市集頁確認：

1. **filters 在頁面狀態的位置**：`static_` / 根元件 proxy 上是否有 filters（鍵名、形狀是否等於 `/data/filters` 的 `result`）。有的話以讀狀態為主，比照 `findKnownStatsFlat()`，不受攔截時機影響。
2. **攔截時機**：`network-observer.ts`（由注入的 `interceptor.js` 安裝）能否穩定看到第一次 `/data/filters`。ADR-0012 指出注入時機晚於 `document_start`，可能漏接；若第 1 點不可行，評估改由 manifest 宣告的 MAIN world `document_start` 腳本擷取。
3. **`knownStatsFlat` 是否足以當市集寫法來源**：文字是否與 `/data/stats` 相同（含 pseudo、同 id 多筆時取哪一筆），與打包 `trade-stats.json` 取第一筆的規則是否一致。
4. **市集漢化啟用時**：確認 `knownStatsFlat` 與 filters 已被換成中文／雙語（預期如此），作為「語系不同就不用」規則的佐證。
5. **大小與頻率**：filters 序列化後大小、頁內切換（search ↔ live、換聯盟）時資料是否重載。

產出：本文件新增「官網耦合點」表格（比照 `market-translation-plan.md` §1）；若第 1、2 點都不可行，停在這裡並回頭修改 ADR。

### 第 0 階段結果（2026-11-14，`pnpm dev` 的 Chrome 以 CDP 實測）

測過：國際服 PoE 1（`/trade`，先在市集漢化 zh-TW 雙語作用中測一次，再關閉漢化測一次）、國際服 PoE 2（`/trade2`）、台服 PoE 1 與 PoE 2（登入後）、日服 PoE 1（`jp.pathofexile.com`）。國服市集要求 QQ / 微信登入，待補測。測試 fixture 取自國際服 PoE 1（漢化關閉）、台服 PoE 1 與 PoE 2：轉出的篩選標籤、市集寫法與 pseudo 文字都和同一天的打包檔一致。

| 項目              | 結果                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. filters 位置   | 根元件 proxy 的 `static_.propertyFilters`，與 `/data/filters` 的 `result` **逐字相同**（國際服、台服、日服都比對過）。PoE 1 12 個群組，PoE 2 7 個，3.30 的 `map_bonus` 已在其中。**以讀狀態為主**，不需要攔截請求                                                                                                                                                                                                                                                                |
| 2. 攔截時機       | 因第 1 點可行而不再需要。附帶發現：`initPoeRuntimeReader()` 的輪詢讀 `#trade.__vue_app__._data.static_`，在 Vue 3 上一定落空，known stats 目前只靠 `/data/*` 回應後 500ms 的 `sendKnownStats` 與側欄的 `poexd-request-known-stats` 送出，取決於攔截器是否趕上請求。第 2 階段一併改用 `getTradeRootComponent()`                                                                                                                                                                   |
| 3. 市集寫法來源   | `static_.knownStats`（群組陣列 `{ id, label, entries: [{ id, text, type }] }`）與 `/data/stats` 的 `result` **順序、文字完全相同**，保留重複 id。`knownStatsFlat` 在重複 id（日服 215 個）**取最後一筆**，打包 `trade-stats.json` 的 `lookupRaw` 取第一筆，所以**市集寫法改以 `knownStats` 取第一次出現**，不用 `knownStatsFlat`。pseudo 在 `knownStats` 的 `pseudo` 群組（PoE 1 298 筆）。注意：`knownStats` 的 entry 只有 `id`、`text`、`type`，沒有 `/data/stats` 的 `option` |
| 4. 市集漢化作用中 | 國際服 `propertyFilters` 與 `knownStats` 已是中文雙語（例如「+#% 冰冷抗性 (+#% total to Cold Resistance)」），頁面語系仍是 `en-US`。證實語系不同時頁面資料不可用，閘門必須同時檢查市集漢化                                                                                                                                                                                                                                                                                       |
| 5. 大小與頻率     | 每次開頁各抓一次 `/data/{items,stats,static,filters}`；`propertyFilters` 序列化約 16 KB，`knownStats` 約 1.6 MB（PoE 1）。頁內切換不重抓                                                                                                                                                                                                                                                                                                                                         |

### 官網耦合點

| 耦合點                    | 實測內容                                                                        | 失效時                   |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| Vue 3 根元件              | `#trade`（即 `[data-v-app]`）的 `__vue_app__._container._vnode.component.proxy` | 讀不到即時資料，退回打包 |
| `static_.propertyFilters` | 等同 `/data/filters` 的 `result`                                                | 篩選標籤退回打包         |
| `static_.knownStats`      | 等同 `/data/stats` 的 `result`，無 `option`                                     | 市集寫法退回打包         |

## 第 1 階段：純函式與契約

新增 `utils/live-trade-data.ts`（不依賴擴充 API，MAIN world 與 isolated world 都可 import）：

- `parseLiveTradeFilters(raw: unknown): TradeFiltersData | null`：把 `/data/filters` 的 `result` 轉成與打包 `trade-filters.json` 相同的 `groups` / `fields` / `options` 形狀。規則移植自 poexd-data `src/trade/trade-filter-api.ts`，兩邊行為要一致：
  - 略過 `tip`；`id: null` 的預設選項略過，唯一例外是 `sale_type` 的 null 對應 `priced`，且只在沒有明確 `priced` 選項時套用。
  - 以 API 的穩定 id 為 key，不依賴索引。
- `parseLiveStatLabels(raw: unknown)`：從頁面 `static_.knownStats` 的群組陣列取出每個 id **第一次出現**的文字（與打包 `trade-stats.json` 的取法一致），pseudo 群組另外對應 `pseudoStats`。不用 `knownStatsFlat`（重複 id 取最後一筆）。
- 驗證上限：群組、欄位、選項、stat 筆數上限，單一字串長度上限，非字串值整筆拒絕；超出上限回傳 null，不做部分採用。

測試：以打包的 `trade-filters.json` 對照同一份官方 fixture（從第 0 階段抓下的回應裁切），確認輸出相同；偽造、超大、缺欄位的輸入一律回傳 null。

## 第 2 階段：MAIN world 擷取與 bridge

- `event-protocol-types.ts` 新增 `poexd-live-trade-data`（MAIN → content，內含 `propertyFilters` 與 `knownStats`）與 `poexd-request-live-trade-data`（content → MAIN），附 serialize / parse，parse 走第 1 階段的驗證。
- `poe-runtime-reader.ts` 從 `getTradeRootComponent()` 的 `static_` 讀取，與 `sendKnownStats` 相同做法：同一份物件不重送。順手修正 `initPoeRuntimeReader()` 的輪詢在 Vue 3 上落空的問題（見第 0 階段結果第 2 點）。
- 事件內容只含資料本身。**遊戲版本與 Page Locale 由 isolated world 自行從網址判斷**，不採用頁面送來的值。

## 第 3 階段：store 接入

- 新增記憶體 store（例如 `utils/live-trade-data-store.ts`），以遊戲版本分開，存 filters 與 stat 標籤，資料到達時遞增 revision。不寫 `chrome.storage`。
- 閘門 `isLiveTradeDataUsable(version)`：在官方市集頁、顯示語系 == `resolvePageLocale()`、市集漢化未作用。
- `trade-filters-store.ts` 的 `getTradeFiltersSources()`：閘門通過時把即時資料放在顯示語系分片之前（測試 mock 仍最優先）。
- `official-stat-text.ts` 的 `getOfficialStatLabel()`：閘門通過時先查即時 stat 標籤；`OFFICIAL_STAT_TEXT_LOCALES` 以外的語系（ja、ru、de、fr、es、pt、th）也因此有市集寫法。既有「中文市集回傳英文視為沒翻譯」的判斷沿用。
- 側欄在頁面資料到達前先用打包資料渲染，到達後由 revision 觸發重新渲染。

## 第 4 階段：驗證與文件

- 單元測試：語系不同不採用、市集漢化作用中不採用、同 id 覆蓋與缺 id 後備、偽造事件被拒、資料到達觸發重新渲染。
- e2e：在至少一個非英文服（台服）確認新篩選標籤來自即時資料；頁面結構不符時退回打包資料且無錯誤。
- 文件：`docs/trade-filter-data.md`「執行期載入」補上即時資料順序；ADR-0014 改為 accepted；`CONTEXT.md` 術語確認。

---

## 待確認

- 國服（`poe.game.qq.com`）的市集要求 QQ / 微信登入，第 0 階段未實測；需在 dev profile 登入後確認 `static_` 結構相同，再進行第 4 階段 e2e。
- 擴充不在韓服（Kakao `poe.game.daum.net`）執行，`ko` 仍只能靠打包分片。
- 舊 Search Record 解出已被官方移除的篩選 id（例如 3.30 前的 `chart_shape`）時，即時資料沒有該 id，會退回打包資料；打包資料也移除後顯示原始 id。維持現行行為，不在此計畫處理。
- 第二層（執行期下載 poexd-data，含詞綴階級）另立 ADR，前提是確認 `optional_host_permissions` 不會在更新時停用擴充。
