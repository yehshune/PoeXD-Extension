# 市集漢化（Market Translation）實作計畫

> **文件狀態**：IN PROGRESS — 第 0、1、2 階段完成 (2026-11-12)
> **決策依據**：[ADR-0012](../adr/0012-market-translation-from-official-realm-data.md)
> **範圍**：只處理國際服英文市集（`www.pathofexile.com/trade`、`/trade2`），PoE 1 與 PoE 2；目標語系為 `zh-TW`（台服用語）與 `zh-CN`（國服用語）。台服、國服與其他在地化市集一律不處理。

---

## 1. 官網耦合點（2026-11-12 實機確認）

改版時優先檢查這幾處；任一處失效時只讓該層退回英文，其他層不受影響。

| 耦合點              | 實測內容                                                                                              | 用途               |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ------------------ |
| 全域 `__` 字典      | Vue 3 bundle 的 `translate(t,e)` 為 `typeof __<"u"&&typeof __[t]<"u"?__[t]:t`；國際服未定義 `__`      | 介面字串           |
| 四份 data API       | 每次開頁都 fetch `/api/trade{,2}/data/{items,stats,static,filters}`；lscache 只剩 `settings`、`state` | 下拉選單、篩選器   |
| items 形狀          | 基底只有 `{ type }`；傳奇物品為 `{ type, text, name, flags.unique }`                                  | 只能寫入 `text`    |
| 結果列 `data-field` | 詞綴行為 `stat.<category>.stat_<hash>`；屬性行為 `pdamage`、`crit`、`ilvl` 等                         | 結果列翻譯         |
| 台服介面字典        | `https://webtw.poecdn.com/js/translate.zh_TW.js`，免登入，約 1,848 鍵                                 | zh-TW 介面字串來源 |
| 國服介面字典        | `https://poecdn.game.qq.com/js/translate.zh_CN.js`，免登入，約 1,850 鍵                               | zh-CN 介面字串來源 |

國際服 bundle 共使用 149 個 `translate()` 鍵，兩份字典都有其中 138 個鍵（台服有 9 個鍵官方沒翻、值等於英文，實際可用 129 個）。未涵蓋的是新聞、群組說明長句、語言名稱與大宗交易範例句，保持英文。

---

## 2. 資料產物

全部由更新腳本從官方來源產生，不手寫譯名。只有 `zh-TW`、`zh-CN` 會產出 Market Translation 專用檔。

| 檔案                                                       | 內容                                                                                                                                       | 來源                                 | 產生方式                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/json/locales/<locale>/trade-ui.json`               | `{ schemaVersion, locale, source, strings: { [englishKey]: text } }`                                                                       | 兩服的 `translate.*.js`              | `pnpm market:update`；以嚴格正規式解析 `__['k'] = 'v';`，不 eval，遇到無法辨識的行就整份拒絕；官方未翻譯（值等於鍵）的條目略過                                         |
| `public/json/<version>/locales/<locale>/trade-stats.json`  | `{ schemaVersion, gameVersion, locale, source, labels, stats: { [statId]: text 或 text[] }, options: { [statId]: { [optionId]: text } } }` | 該服的 `/data/stats`                 | `pnpm market:update`；只留國際服存在的 id。同一 id 在 API 裡可能出現多次且文字不同（例如 Area / Map 兩種說法），此時依出現順序存成陣列；出現次數與國際服不同就整筆略過 |
| `public/json/<version>/locales/<locale>/trade-static.json` | `{ schemaVersion, gameVersion, locale, source, labels, entries: { [groupId]: { [entryId]: text } } }`                                      | 該服的 `/data/static`                | `pnpm market:update`；static 的 id 跨群組會重複，所以依群組分層                                                                                                        |
| `trade-filters.json`（既有）                               | filters 群組、欄位、選項                                                                                                                   | 該服的 `/data/filters`               | 不變（`pnpm filters:update`）                                                                                                                                          |
| `items.json`（既有）                                       | 以索引對齊的物品名                                                                                                                         | poexd-data（zh-CN 取自國服交易資料） | 不變；執行期以英文名查索引                                                                                                                                             |
| poexd-data：詞綴變體                                       | 每個 stat 的所有 CSD 變體（英文模板與譯文模板成對、含條件）                                                                                | `stat_descriptions.csd`              | poexd-data 新增輸出；第 4 階段使用                                                                                                                                     |

`<locale>` 只有 `zh-TW`、`zh-CN`。國際服（en）的 stats / static 回應只用來篩選與驗證，不寫檔：第 3 階段改寫的是執行期拿到的國際服回應本身，不需要另存英文。第 4 階段若需要英文模板反解數值，再決定由 poexd-data 的詞綴變體提供，或另外產出 en 分片。

---

## 3. 分階段實作

每個階段都可以單獨合併、單獨發布。各階段先寫測試（TDD），完成後跑 `pnpm test`、`pnpm compile`，並在 dev 瀏覽器跑 e2e。

### 第 0 階段：前置修正

- [x] e2e 的 CDP 位址改由 `e2e/cdp-endpoint.ts` 解析：依序探測 `127.0.0.1` 與 `[::1]`（IPv4 的同一個埠被其他程式佔用時，Chrome 只會聽在 `[::1]`），以 `/json/version` 排除 Electron 應用程式；`POEXD_CDP_URL` 可直接指定位址。
- [x] 量測既有 `interceptor.js` 的注入時機（2026-11-12，見下方結果）。

#### 注入時機量測結果

方法：在 dev 瀏覽器開新分頁，以 init script 在 `window.fetch` 上放 setter，記錄被替換的時間點與呼叫堆疊，並記錄官網呼叫四份 data API 的時間（`performance.now()`，毫秒）。PoE 1、PoE 2 各量 4 次，CDN 快取為熱狀態。

| 版本 | `installFetchInterceptor` 替換 `fetch` | 官網第一次呼叫 data API | 餘裕        |
| ---- | -------------------------------------- | ----------------------- | ----------- |
| PoE2 | 607–640                                | 1,791–1,915             | 1,151–1,282 |
| PoE1 | 638–713                                | 1,870–2,040             | 1,232–1,389 |

結論：

- 8 次都由既有 interceptor 先包住 `fetch`，四份 data API 都有經過它。目前的注入路徑在一般情況下來得及。
- 但 interceptor 是在 content script 等完 Cloudflare 判定、偏好設定與搜尋觀察連線之後才注入，屬於非同步。Service worker 冷啟動、機器忙碌，或官網 bundle 已快取而變快時，餘裕可能縮小，無法保證永遠先到。
- 第 2 階段的設計因此調整為兩段：fetch 擱置與 `__` 定義放在 manifest 宣告的 MAIN-world `document_start` 腳本（保證最早），既有 interceptor 的觀察邏輯維持原樣。e2e 要加一條斷言：data API 呼叫時，Market Translation 的 wrapper 已經就位。
- 冷啟動情境（先停用 service worker 再開頁）尚未量測，留到第 2 階段的 e2e 補上。

### 第 1 階段：資料管線

- [x] `scripts/market-translation-api.mjs`：介面字典解析、stats / static 產物與驗證（條目下限；與 en 相同的比例超過 50% 時視為網域回傳英文而拒絕）。單元測試在 `tests/market-translation-api.test.js`。
- [x] `scripts/update-market-translation.mjs` 與 `pnpm market:update`：獨立於 `filters:update`。en 失敗時整批不寫入，其他語系失敗時保留既有檔案，最後以 `replaceFilesWithRollback` 一次寫入。國服字典先試 `poecdn.game.qq.com`，失敗改用內容相同的 `poe.game.qq.com`（騰訊 CDN 從海外連線時好時壞，實測曾連續逾時）。
- [x] `scripts/trade-filter-api.mjs` 新增 `buildStaticUrl`。
- [x] 更新 `docs/trade-filter-data.md`。
- [x] 量測打包大小（見下方）。

#### 第一次產出結果（2026-11-12）

| 分片           | 涵蓋情形                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 介面字串 zh-TW | 1,258 個字串；國際服 bundle 的 149 個 `translate()` 鍵涵蓋 129 個（台服字典裡有些鍵官方沒翻，值等於英文，已略過）             |
| 介面字串 zh-CN | 1,782 個字串；涵蓋 138 / 149                                                                                                  |
| PoE1 stats     | zh-TW 17,508、zh-CN 17,502 個 id（國際服 17,961，約 97%）                                                                     |
| PoE2 stats     | zh-TW 5,913、zh-CN 7,602 個 id（國際服 8,235，72% / 92%）。台服缺的多是 `explicit.stat_…\|n` 這類分支 id，台服 API 本身就沒有 |
| static         | PoE1 1,413 筆、PoE2 778 筆，兩服皆全數涵蓋                                                                                    |

大小：10 個檔案合計 3.9 MB，gzip 後約 0.9 MB（PoE1 stats 每個語系約 1.3 MB、gzip 約 290 KB），低於 2 MB 的裁剪門檻，暫不裁剪。

### 第 2 階段：注入基礎與介面字串

- [x] Preference：`marketTranslation`（全域、預設 `false`），加入 `GLOBAL_PREFERENCE_NAMES`、側欄設定與 popup 模組清單。`marketTranslationBilingual` 只影響 data API 改寫，延到第 3 階段一起加。
- [x] 目標語系判定：`resolveMarketTranslationLocale`（`utils/market-translation.ts`），條件為 `marketTranslation && 國際服 host && resolvedDisplayLocale ∈ {zh-TW, zh-CN}`；Display Locale 為 `auto` 時沿用 ADR-0011 的瀏覽器語系退回。
- [x] manifest 宣告的 MAIN-world content script `market-translation-main.content.ts`（`document_start`、只比對國際服 `/trade*`）：
  - 包住 `fetch`，只擱置四份 data API，等到 payload 或 `disabled` 訊息，或 1.5 秒逾時後放行。這個階段只擱置、不改寫回應，所以 `network-observer.ts` 讀到的仍是原始英文資料；兩者共用 wrapper 鏈的問題留到第 3 階段改寫回應時處理。
  - 收到 payload 後定義 `window.__`；已有 `__` 時只補入缺的鍵。payload 晚於 Vue mount 時，走訪 `[data-v-app]` 呼叫 `$forceUpdate` 補救。
- [x] isolated world `market-translation.content.ts`：讀偏好設定，載入 `trade-ui.json`，透過新的 `window.postMessage` 協定（`utils/market-translation-protocol.ts`，只接受 `event.source === window`）送進 MAIN world。功能關閉、語系不符或載入失敗時送 `disabled`，頁面保持原樣。
- [x] e2e（2026-11-12，dev 瀏覽器實機）：

  | 情境        | `__` 條目 | `__` 設定時間 | Vue mount | 頂欄                           |
  | ----------- | --------- | ------------- | --------- | ------------------------------ |
  | PoE2、zh-TW | 1,258     | 284 ms        | 1,916 ms  | 搜尋道具／以物易物／關於／設定 |
  | PoE2、zh-CN | 1,782     | 313 ms        | 2,209 ms  | 國服譯名                       |
  | PoE1、zh-TW | 1,258     | 338 ms        | 503 ms    | 搜尋道具                       |
  | 關閉        | 未定義    | —             | 1,701 ms  | 英文                           |

  三種開啟情境下，`__` 都早於 Vue mount 就設好，`$forceUpdate` 只是保險。篩選器群組名（Type Filters 等）來自 filters API，第 3 階段才會翻譯；「History」這類官方字典沒有的字串留到最後的涵蓋率檢查。

### 第 3 階段：下拉選單與篩選器（data API 改寫）

- [ ] Preference：`marketTranslationBilingual`（全域、預設 `true`），加入 `GLOBAL_PREFERENCE_NAMES` 與設定 UI；payload 帶上這個值與 stats／static 分片（WAR 一併加入 `trade-stats.json`、`trade-static.json`）。
- [ ] 讓 `network-observer.ts` 等內部功能拿到原始英文資料：改寫只作用於官網拿到的 `Response`，不能影響 interceptor 轉送的副本，也不能讓內部功能讀到翻譯後的 Vuex store。
- [ ] 純函式 `localizeTradeData(kind, englishResult, shards, { bilingual })`，依 kind 處理：
  - `stats`：依 `id` 換掉 `text`，類別 `label` 也一併翻譯。
  - `static`：依 `id` 換掉 `text`。
  - `filters`：依 `id` 換掉群組 `title`、欄位 `text`、選項 `text`（沿用 `trade-filters.json`）。
  - `items`：依英文 `type`／`name` 查 `items.json` 索引，寫入 `text`（基底原本沒有 `text`，要新增）；`type`、`name` 絕不改動。
  - 雙語模式時 `text` 為 `中文 English`；查不到的條目保留英文原值。
- [ ] 單元測試以實際 API 片段為 fixture，斷言 `type`、`name`、`id` 位元組不變。
- [ ] e2e：在詞綴下拉輸入中文與英文都找得到同一詞綴；選取後送出的搜尋 ID 與未翻譯頁相同。

### 第 4 階段：結果列

- [ ] poexd-data：輸出每個 stat 的全部 CSD 變體（含正負號條件），並在擴充端 `sync-game-data.mjs` 同步。
- [ ] 純函式 `translateModLine(statId, englishLine, shards)`：用英文模板建立數值擷取式 → 依條件挑選譯文模板 → 填入數值；任一步失敗回傳 `null`（保留英文）。
- [ ] 結果列 DOM 層：只改既有文字節點、不增刪節點；監聽 `characterData`，Vue 重繪改回英文時再翻一次；保留原文以便關閉功能時還原。
- [ ] 物品名與基底名用 `items.json`；屬性行（`pdamage`、`crit` 等）的標籤用 `trade-ui.json`／`trade-filters.json`。
- [ ] 沒有 `data-field` 的行才退回英文整句比對。

### 第 5 階段：既有功能稽核與收尾

- [ ] 在翻譯後的頁面逐一檢查會讀官網 DOM 文字的模組，必要時改讀 `data-field` 或 Vuex store：
      `entrypoints/content/logic/result-item-normalizer.ts`、`result-price-presenter.ts`、`result-mod-highlighter.ts`、`hotkeys.ts`、`entrypoints/main-world/poe-runtime-mutation.ts`。
- [ ] 確認 Page Locale 在國際服仍判定為英文（ADR-0011 的輸入框退回查詢不受影響）。
- [ ] 線上搜尋主控台與 Criteria Overlay 在翻譯開啟時的回歸測試。
- [ ] 更新 `README.md`、`README.en.md`、商店說明與 `NOTICE.md`（官方遊戲文本來源標示）。
- [ ] ADR-0012 狀態改為 `accepted`。

---

## 4. 風險與對策

| 風險                                        | 對策                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| MAIN-world 腳本晚於官網 data fetch          | 第 0 階段先量測；manifest 宣告的 `document_start` MAIN-world 腳本早於任何頁面腳本 |
| 擱置 data 回應拖慢開頁                      | payload 走擴充內建檔、記憶體快取；逾時放行英文；量測首屏延遲並列入 e2e            |
| 官網改版（`__` 掛勾、`data-field`、選擇器） | 各層獨立偵測，失效時靜默退回英文並只警告一次；e2e 涵蓋第 1 節所有耦合點           |
| 國服與國際服 patch 不同步，新詞綴缺譯名     | 依 id 對接，缺的保留英文；更新腳本輸出缺漏統計                                    |
| 國服網域在部分網路無法連線                  | 沿用 `update-trade-filters.mjs` 的策略：非 `en` 失敗時保留既有檔案並列出警告      |
| 譯名錯位                                    | 一律以 id 或英文名作鍵，不做位置對位；無把握時保留英文                            |

## 5. 驗收條件

- 開啟功能、Display Locale 為 `zh-TW` 時，國際服 PoE 1 與 PoE 2 的介面、篩選器、下拉、結果列詞綴與物品名都以台服用語顯示；`zh-CN` 時以國服用語顯示。
- 相同操作在翻譯與未翻譯頁產生相同的搜尋 ID 與 API 請求內容。
- 關閉功能後重新整理，頁面與現行版本完全一致。
- 書籤、歷史、線上搜尋主控台、常用詞綴群組、傭兵技能選擇器在翻譯頁上功能不變。
