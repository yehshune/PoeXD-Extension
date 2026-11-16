# PoB 購物清單優化計畫

> **文件狀態**：IN PROGRESS — 第 1、2 階段完成並實測，第 3–4 階段未開始 (2026-11-16)
> **範圍**：側欄「PoB 購物清單」的搜尋準確度、清單操作、與書籤／線上搜尋主控台的串接、PoB 分享網址匯入。
> **相關檔案**：`utils/pob-build.ts`（解析）、`utils/pob-shopping-list.ts`（組搜尋）、`utils/pob-stat-matcher.ts`（詞綴對代碼）、`utils/pob-build-store.ts`（本機儲存）、`components/sidebar/pob-build/usePobBuild.ts`、`components/sidebar/pob-build/PobBuildPane.vue`、`PobBuildImportDialog.vue`。
>
> 每完成一項就把 `[ ]` 改成 `[x]`，並在該階段標題後註記日期與 commit。

---

## 背景與現況

2026-11-16 以 `pnpm dev` 的 Chrome（CDP 9222）檢視一份 Slayer build（46 項）與程式碼，確認以下現況：

| 項目           | 現況                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 搜尋條件       | 稀有／魔法／普通裝只把**一般詞綴**（`explicit.*`）帶入，所有詞綴以 `and` 群組、下限取八成；傳奇只帶名稱與基底；寶石帶等級與品質下限                                  |
| 固定詞綴、附魔 | 不帶入。`trade-stats.json` 已有 `implicit.*`（2006 筆）與 `enchant.*`（2442 筆），但 `createStatMatcher` 寫死 `explicit` 網域                                        |
| 同代碼的多行   | `matchExplicitMods` 以 `filters.has(statId)` 去重，第二行直接丟掉，下限只用第一行（例：79% + 129% 物理傷害只搜 ≥63）                                                 |
| 小數、負數     | `min = floor(value × 0.8)`，`min < 1` 時只加代碼不加數值（0.5% 變成「有即可」）；負值同樣不設上下限                                                                  |
| 重複項目       | 天賦樹珠寶的 slot 一律是 `Jewel`，相同珠寶共用 key 被合併；寶石在 `parseGems` 就以「名稱＋等級＋品質」去重。兩者都會少買                                             |
| 永恆珠寶       | PoB 名稱如 `Lethal Pride 11057; 7; Duelist` 對不到市集名稱，整列無法搜尋。市集有 `explicit.pseudo_timeless_jewel_*` 可依種子編號搜尋                                 |
| 排序           | 依「傳奇／其他裝備／寶石」分組，同部位（藥劑、珠寶）被拆散在兩組                                                                                                     |
| 重匯           | 只能刪掉整份再匯入，名稱、進度、圖示全失；但 entry key 由內容決定（`item\0slot\0rarity\0name\0baseType`、`gem\0name\0level\0quality`），換代碼後未變動項目可直接對回 |
| 搜尋代碼       | 官方網址的搜尋代碼即 `base64url(gzip(query JSON))`（不含 `sort`），已解開目前分頁的網址確認。擴充可在本機產生，前提是官網接受（第 3 階段第 0 步實測）                |
| 權限           | `host_permissions` 已含 `https://poe.ninja/*`；其他 PoB 分享站（pobb.in、pastebin）不在其中                                                                          |

## 共通原則

- PoB 代碼與網址內容視為不可信輸入：維持現有的長度、筆數、解壓大小上限，只以文字渲染。
- 不用猜的名稱或代碼去搜；對不到的維持「列出但不可搜尋」。
- 儲存仍只存原始代碼與使用者的選擇（ADR-0008 精神：搜尋條件以搜尋代碼為準，不另存第二份條件），新欄位一律在 `parseStored` / `applyPatch` 驗證。
- 每一階段都要有 `tests/` 的單元測試；UI 變更用 CDP 在 PoE 1、PoE 2 各實看一次。

---

## 第 1 階段：搜尋準確度（完成並實測 2026-11-16，commit cbc20c1）

純邏輯為主，集中在 `pob-build.ts`、`pob-stat-matcher.ts`、`pob-shopping-list.ts`。測試：`tests/pob-shopping-search.test.ts`（新增）與既有 PoB 測試。以 dev 瀏覽器裡的真實 build（PoE 1 Slayer、PoE 2 Oracle）跑過一次輸出確認。

### 1.1 同代碼多行加總（bug）

- [x] 依 `statId` 合併成一個條件（`entryStatFilters`），數值加總後再算下限
- [x] 兩行都標為 `searched`，勾選狀態一起變
- [x] 測試：79% + 50% 物理傷害 → 單一條件、下限 103

> 實測發現原本舉例的 129% 是工藝詞綴（本來就不帶入），真實案例是 PoE 2 手套的 99% + 42% 閃避。

### 1.2 固定詞綴與附魔帶入搜尋

- [x] `createStatMatcher` 支援 `domain: 'explicit' | 'implicit' | 'enchant'`
- [x] mod-lines 對不到時改以市集寫法比對：補上選項型代碼（`enchant.stat_3948993189|8` → `value: { option: 8 }`）、沒有 hash 的代碼、標 `(Local)` 的代碼
- [x] 區分固定詞綴與附魔：PoB 實際上把附魔寫成固定詞綴區裡標 `{crafted}` 的行（不是 `{enchant}`），`implicitMods` 改為帶 `crafted` 旗標
- [x] 固定詞綴預設帶入；附魔只有星團珠寶預設帶入，且用精確數值（天賦數、插槽數不取八成）；其他附魔（頭盔附魔、塗油）可勾選但預設不帶
- [x] `ShoppingModKind` 增加 `enchant`，UI 給對應顏色
- [x] 測試：雙玉戒指冰冷／閃電固定詞綴、Large Cluster Jewel 附魔與選項

### 1.3 小數與負數數值

- [x] `defaultStatBounds`：整數捨去到整數；小於 10 的非整數保留一位小數（0.5 → 0.4）
- [x] 負值改設上限（-12 → max -9）；比對器保留 `{0:d}` 佔位符的正負號
- [x] 測試：`+0.5% to Critical Strike Chance`、`-12 to Strength Requirement`

### 1.4 相同項目顯示數量

- [x] `buildShoppingList` 合併相同 key 時累計 `count`
- [x] `parseGems` 不再去重；真實 PoE 2 build 有 7 種寶石出現兩次以上（PoE 2 寶石不列入清單，但 PoE 1 同理）
- [x] UI 在名稱後顯示 `×N`；勾選完成仍以整列為單位
- [x] 測試：兩顆相同星團珠寶 → `×2`；兩組連結各用一顆相同輔助 → `×2`

### 1.5 永恆珠寶

- [x] 去掉名稱後的 `<seed>; <n>; <keystone>` 找市集名稱；種子編號取自選用變體的詞綴（`Commanded leadership over 16137 warriors under Kaom`）
- [x] 搜尋條件：傳奇名稱 + `explicit.pseudo_timeless_jewel_<領袖>`，`min = max = seed`
- [x] 名稱後顯示種子編號（`ShoppingEntry.suffix`）
- [x] 測試：Lethal Pride（其他永恆珠寶走同一條路徑，未另外寫測試）

### 1.6 孔數與連結（PoE 1）

- [x] 解析屬性區的 `Sockets:` 行，記為 `maxLinks`
- [x] 連結數 ≥ 5 時帶入 `socket_filters.links.min`（單手武器最多三連，所以不必判斷部位），傳奇也適用
- [x] 測試：`Sockets: R-R-R-R-R-R` → links min 6；三連不帶入

### 1.7 自選詞綴與「至少符合 N 項」

- [x] 展開後每一行可勾選（沒有市集代碼的行不能勾）；同一條件的第一行有數值輸入框，正數改下限、負數改上限，清空表示不設
- [x] 「至少符合 N 項」勾選後 N 預設為勾選數減一，可修改
- [x] 選擇以市集代碼為鍵存在 `StoredPobBuild.searchSelections`（不是原計畫的詞綴索引：同一代碼的多行本來就是同一個條件，PoB 重匯詞綴順序變動也不會錯位）
- [x] 使用者選擇優先於預設；有調整的項目名稱旁有圓點，「還原預設」清掉調整
- [x] 「抗性、生命、能力值改用總和」：勾選的行換成 `pseudo_total_elemental_resistance`、`_chaos_resistance`、`_life`、`_strength` 等，雙抗、全抗依倍數計算
- [x] 傳奇的詞綴也可以勾選（預設不帶入）
- [x] 測試：停用、改下限、清掉下限、上限、count 模式與上限、pseudo 合併、本機資料驗證、開啟搜尋用調整後的條件

### 1.8 未翻譯的部位與名稱

- [x] `pob-slot-label.ts` 補 `<部位> Abyssal Socket N`
- [ ] ~~天賦樹珠寶顯示編號~~：不做。相同珠寶已合併成 `×N`，再加編號反而對不上
- [x] 基底帶種類說明（`Two-Stone Ring (Cold/Lightning)`）時去掉說明再找市集名稱，種類改由固定詞綴表示

### 第 1 階段的介面實測（2026-11-16，dev 瀏覽器）

以真實 build 開啟搜尋，官網都接受產生的條件，篩選欄顯示正確：

- 雙玉戒指（冰冷／閃電固定詞綴 + 總和 + 至少符合）、Lethal Pride（「岡姆指揮領導超過 # 戰士」）、Large Cluster Jewel（「附加的小型天賦給予：持盾時增加 12% 攻擊傷害」）、六連胸甲 + 7 個條件。
- 選項型條件經官網重新編碼後顯示為 `enchant.stat_3948993189|8`、沒有 value，屬正常現象。
- PoE 2 手套的閃避 99% + 42% 合併成一個條件（下限 112），數值框只出現在第一行；`命定:`、汙染說明等行沒有代碼、不能勾選。
- 預設的 and 條件很嚴格，上述搜尋目前都是 0 筆；這是預期行為，使用者可以改用「至少符合 N 項」放寬。

實測後的修正：

- [x] 總和模式保留固定詞綴為獨立條件（數值仍計入總和），否則雙玉戒指會搜出火焰／混沌的種類
- [x] 「至少符合」模式下固定詞綴與附魔放在 and 群組必須符合，不計入 N
- [x] 星團附魔改用精確數值（原本取八成，天賦數變成至少 6）
- [x] 勾選框改用主題的 Checkbox 元件；label 以 `for` 對應，避免點一下切換兩次
- [x] 數值輸入框隱藏上下箭頭，避免擋住數字

### 第 1 階段的已知限制

- PoB 偶爾以逗號當小數點（`Inflicts Mana Burn every 0,41 Seconds`），這類行對不到代碼，不會帶入。
- PoE 2 的 `Arm` / `Leg` 部位名稱仍保留英文。
- PoE 2 的 `Destined`（`命定:`）詞綴對不到市集代碼，不會帶入。

---

## 第 2 階段：清單體驗（完成並實測 2026-11-16，未 commit）

### 2.1 依部位排序與寶石分組

- [x] 裝備合為一組，排序：主手 → 副手 → 頭部 → 胸甲 → 手套 → 鞋子 → 項鍊 → 戒指 → 腰帶（深淵插槽跟在所屬部位後）→ 藥劑 → 護符 → 認不得的部位 → 珠寶（`slotRank`）
- [x] 傳奇以名稱顏色區分，不再分組
- [x] 寶石依插的部位分組（「寶石 · 胸甲」）；沒有指定部位的以連線分組，標題為 PoB 的技能標籤或第一顆主動寶石（「寶石 · 電弧」），排在有部位的分組之後。分組內維持 PoB 的順序
- [x] 寶石的 key 加上分組（`gem\0<部位或 link:連線>\0名稱\0等級\0品質`）：不同部位各用一顆相同寶石時分列在各自的分組，同一部位內相同的寶石合併成 `×N`
- [x] 舊版進度搬遷：讀回時把不分組的寶石 key（`done`、`removed`、`icons`）換成新格式並存回本機（`migrateLegacyGemKeys`）
- [x] 測試：部位排序、部位與連線分組、舊 key 搬遷

> 原計畫寶石維持獨立一組；依使用者要求改為依部位／連線分組。

### 2.2 隱藏已完成

- [x] 清單選項列加「隱藏已完成」勾選框，狀態存在 `StoredPobBuild.hideDone`；有已完成項目或已開啟時才顯示
- [x] 關閉時已完成項目沉到所屬分組最下面
- [x] 進度數字維持計算全部項目；分組全部完成且隱藏時整組不列出，整份都完成時顯示「全部完成，已隱藏 N 項」

> 原計畫在每個全部完成的分組顯示「已全部完成」；寶石分組變多後會太雜，改為整組不列出。

### 2.3 更新既有清單的代碼

- [x] `PobBuildStore.replaceCode(id, code, patch)`：換代碼並在同一次寫入清掉已不存在的項目，`name`、`hideDone`、選用的套裝保留
- [x] 換代碼後只留下新代碼任一套裝／技能組還有的 key（`done`、`removed`、`icons`、`searchSelections`）；原選用的套裝／技能組不存在時退回 PoB 選用的那一組
- [x] `usePobBuild.updateCode(buildId, code)`：代碼無效、遊戲版本不同時拒絕，沿用匯入的錯誤訊息，原本的清單不變
- [x] 入口：清單標題列的鉛筆旁加「更新代碼」，開啟同一個匯入對話框的「更新」模式，標題含 build 名稱、按鈕為「更新」
- [x] 更新後以提示訊息顯示「已更新代碼：保留 N 項進度，新增 M 項，移除 K 項」（以目前選用的套裝計算）
- [x] 測試：保留名稱、勾選與搜尋調整，移除項目被清掉，代碼無效與版本不符被拒

### 2.4 列上的操作

- [x] 列尾的箭頭改為獨立按鈕，直接展開詞綴；滑過才出現的按鈕只留「新分頁開啟」「移除」，位置讓開箭頭
- [x] 鍵盤操作：名稱按鈕上 Enter 開搜尋、空白鍵切換完成（提示文字寫在按鈕的 title）

### 第 2 階段的介面實測（2026-11-16，dev 瀏覽器 PoE 1）

- Slayer build：裝備 23 列依部位排序，腰帶深淵插槽接在腰帶後，已完成的藥劑沉到裝備組最下面；寶石分成「寶石 · 主手」「寶石 · 副手」「寶石 · 頭部」等組
- 滑過列時「新分頁開啟」「移除」排在箭頭左邊；點箭頭展開與收合詞綴正常
- 勾選「隱藏已完成」後裝備組 23 → 22 列，進度維持 1/46；取消後恢復
- 「更新代碼」開啟的對話框標題為「更新「Slayer Lv.100」的 PoB 代碼」；實際換代碼的流程由單元測試涵蓋，沒有在瀏覽器貼新代碼

---

## 第 3 階段：串接書籤與線上搜尋主控台

### 3.0 前置實測

- [ ] 在國際服、台服的 PoE 1 與 PoE 2 開啟本機產生的 `base64url(gzip(query))` 搜尋網址，確認官網照常執行搜尋，並能啟動線上搜尋
- [ ] 結果寫回本節。不接受時，3.2 改為「開啟搜尋 → 等網址換成代碼 → 送出」

### 3.1 搜尋代碼產生

- [ ] `utils/trade-url-codec.ts` 新增 `encodeQueryToGzipBase64Url(query)`（`CompressionStream('gzip')`），與 `decodeGzipBase64UrlToQuery` 成對，測試往返一致
- [ ] `buildTradeSearchUrl` 保留 `?q=`（含價格排序）作為預設開啟方式；需要固定網址時改用代碼網址

### 3.2 送進線上搜尋主控台

- [ ] 列上新增「送進主控台」，以該項目目前的條件（含 1.7 的 `searchSelections`、3.3 的覆寫）組成網址，交給 `createLiveSearchSubscriptionFromUrl`，名稱帶入清單名＋項目名
- [ ] 主控台已滿或頁面沒有聯盟時顯示原因，不靜默失敗
- [ ] 測試：送出的網址可被 `parseTradeSearchUrl` 解析，`searchId` 解碼後等於該項目的條件

### 3.3 存回這一格

- [ ] 列上新增「以目前頁面更新搜尋」（僅在目前頁面是市集搜尋時可用），存目前網址的搜尋代碼到 `StoredPobBuild.searchOverrides[entryKey]`
- [ ] 有覆寫時開啟搜尋改用覆寫，列上標示「已自訂」，提供「還原預設」
- [ ] 覆寫只收 `isGzipHash` 通過的代碼；聯盟不跟著存，開啟時用目前頁面的聯盟

### 3.4 轉存書籤

- [ ] 列上新增「加入書籤」，選擇資料夾後走書籤的 `add-bookmark` intent，名稱帶入項目名、封面帶入已擷取的圖示
- [ ] 需要跨面板呼叫：評估由 `bookmark-model` 提供可共用的新增入口，避免 PoB 面板直接操作書籤儲存

---

## 第 4 階段：PoB 分享網址匯入

### 4.1 poe.ninja（不需改權限）

- [ ] 實測 poe.ninja PoB 分享頁（PoE 1、PoE 2）的原始代碼網址格式，結果寫回本節
- [ ] 匯入對話框接受網址：在 background 以 `fetch` 取回代碼，沿用 `decodePobBuildCode` 的大小上限與驗證
- [ ] 只接受白名單網域與固定路徑格式；網址解析失敗、HTTP 錯誤、逾時各有錯誤訊息

### 4.2 其他分享站（選用權限）

- [ ] manifest 新增 `optional_host_permissions`（pobb.in、pastebin.com 等），不動既有 `host_permissions`（新增選用權限不會讓已安裝使用者被停用或重新授權）
- [ ] `chrome.permissions.request` 只能在擴充頁面以使用者點擊觸發，側欄（content script）不能直接呼叫：新增一個小型擴充頁面，由設定中的「允許從分享網址匯入」開關開啟並完成授權
- [ ] 匯入時先 `chrome.permissions.contains` 檢查，未授權則提示前往設定
- [ ] Firefox 實測同一流程
- [ ] 更新 `PRIVACY.md`：貼上分享網址時會連線到該網站取回代碼，不傳送其他資料
- [ ] 商店上架說明（`docs/store`）補充選用權限用途

---

## 進度總覽

| 階段            | 狀態              | 完成日期 / commit  |
| --------------- | ----------------- | ------------------ |
| 1. 搜尋準確度   | 完成              | 2026-11-16 cbc20c1 |
| 2. 清單體驗     | 完成（未 commit） | 2026-11-16         |
| 3. 串接         | 未開始            |                    |
| 4. 分享網址匯入 | 未開始            |                    |
