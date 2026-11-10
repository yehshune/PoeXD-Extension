# 商店上架資料 / Store listing kit

Chrome Web Store、Microsoft Edge Add-ons 與 Firefox Add-ons (AMO) 上架時要填的文字和圖片都放在這裡，照欄位複製貼上即可。

| 項目                               | 值                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome 商店 ID                     | `fbbkaeekjalfecgjfcephaiopffeobjg`                                                                                                            |
| 自行安裝版 ID（含 manifest `key`） | `pmebgakijignfpnafmepcfaefhbbncjk`                                                                                                            |
| Firefox (AMO) 附加元件 ID          | `poexd-trade-helper@yehshune`                                                                                                                 |
| 上傳檔案                           | Chrome / Edge：商店版 zip（`POEXD_STORE_BUILD=1 pnpm zip`，不含 `key`）<br>Firefox：`pnpm zip:firefox` 產出的 `poexd-extension-*-firefox.zip` |
| 隱私權政策 URL                     | <https://github.com/yehshune/PoeXD-Extension/blob/main/PRIVACY.md>                                                                            |
| 首頁 / 支援 URL                    | <https://github.com/yehshune/PoeXD-Extension> · <https://github.com/yehshune/PoeXD-Extension/issues>                                          |
| 類別                               | Lifestyle → Games（Edge：Entertainment，Firefox：Games & Entertainment）                                                                      |
| 商店語言                           | English（預設）、繁體中文                                                                                                                     |

> **Firefox (AMO) 說明：**
> 擴充套件已設定為純 Desktop 版本（不支援 Android）。若搭配本地桌面連接器使用，注意 Firefox 每次安裝時的 Origin 為動態 `moz-extension://<UUID>`。

## 圖片

| 用途                      | 規格          | English                                                              | 繁體中文                                                                |
| ------------------------- | ------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 螢幕截圖（最多 5 張）     | 1280×800 JPEG | [`images/en/screenshot-1..5.jpg`](images/en)                         | [`images/zh-TW/screenshot-1..5.jpg`](images/zh-TW)                      |
| 小型宣傳圖（Chrome 必填） | 440×280 PNG   | [`promo-small-440x280.png`](images/en/promo-small-440x280.png)       | [`promo-small-440x280.png`](images/zh-TW/promo-small-440x280.png)       |
| 大型宣傳圖（選填）        | 1400×560 PNG  | [`promo-marquee-1400x560.png`](images/en/promo-marquee-1400x560.png) | [`promo-marquee-1400x560.png`](images/zh-TW/promo-marquee-1400x560.png) |
| Edge 商店 logo            | 300×300 PNG   | [`images/logo-300x300.png`](images/logo-300x300.png)                 | 同左                                                                    |
| 商店圖示                  | 128×128 PNG   | [`public/icon/128.png`](../../public/icon/128.png)                   | 同左                                                                    |

截圖順序：1 書籤資料夾 → 2 搜尋預覽 → 3 詞綴群組範本 → 4 線上搜尋主控台 → 5 設定。
截圖用的是示範資料，帳號名稱已遮成 `Exile#0000`。

---

## 1. 商店說明 / Store listing

### English

**Name**（取自 `_locales/en`）：`PoeXD – PoE Trade Helper (Path of Exile)`

**Summary**（≤132 字元）：

```text
Bookmark folders, a multi-search live console and quality-of-life tools for the official Path of Exile trade site.
```

**Description**：

```text
PoeXD adds a sidebar to the official Path of Exile trade site (PoE 1 and PoE 2) that helps you organize searches and react to new listings faster.

FEATURES
• Bookmark folders – save trade searches into nested folders, drag to reorder and reopen them in one click.
• Search preview – check the filters of a bookmark or history entry before opening it.
• Search history – every search you run is recorded so you can find it again.
• Stat group templates – save frequently used stat filter groups and overlay them onto any search.
• LiveSearch Console – watch several live searches side by side in one tab.
• Trade page enhancements – tier quick buttons, affix selector, price conversion, matched-affix highlighting and more.
• Themes, panel position, UI scale and keyboard shortcuts.
• Interface in English, Traditional Chinese and Simplified Chinese.

PRIVACY
• No account, no server, no analytics, no ads. Everything is stored locally in your browser.
• Fully open source under the MIT license.

PoeXD is a fan-made tool and is not affiliated with or endorsed by Grinding Gear Games.
Source code and issue tracker: https://github.com/yehshune/PoeXD-Extension
```

### 繁體中文

**名稱**（取自 `_locales/zh_TW`）：`PoeXD – PoE 流亡黯道交易小幫手`

**簡短說明**（≤132 字元）：

```text
為《流亡黯道》官方交易網站加上書籤資料夾、多組即時搜尋主控台與各種便利工具。
```

**詳細說明**：

```text
PoeXD 在《流亡黯道》官方交易網站（PoE 1 與 PoE 2）加上一個側邊欄，幫你整理搜尋條件，更快掌握新上架的物品。

功能
• 書籤資料夾：用多層資料夾整理交易搜尋，可拖曳排序，一鍵重新開啟。
• 搜尋預覽：開啟書籤或歷史紀錄前，先確認裡面的篩選條件。
• 搜尋紀錄：自動記錄每一次搜尋，方便回頭找。
• 詞綴群組範本：儲存常用的詞綴篩選群組，隨時疊加到任何搜尋。
• 線上搜尋主控台：在同一個分頁同時監聽多組即時搜尋。
• 交易頁增強：T 階快捷按鈕、詞綴選擇器、價格換算、結果詞綴高亮等。
• 可調整主題、面板位置、介面縮放比例與快捷鍵。
• 介面支援繁體中文、简体中文與 English。

隱私
• 不需註冊、沒有伺服器、沒有分析或廣告，所有資料都存在你的瀏覽器裡。
• 以 MIT 授權完整開源。

PoeXD 是玩家自製工具，與 Grinding Gear Games 無關，也未獲其背書。
原始碼與問題回報：https://github.com/yehshune/PoeXD-Extension
```

---

## 2. 隱私權實務 / Privacy practices（Chrome「隱私權」分頁）

### 單一用途 / Single purpose

```text
PoeXD enhances the official Path of Exile trade website: it lets players organize, revisit and monitor their trade searches (bookmarks, history, live search console) and adds display helpers to the trade results page.
```

### 權限用途說明 / Permission justifications

| 權限                                                                                                          | 填寫內容                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                                                                     | `Stores the user's bookmarks, folders, search history, stat group templates and preferences locally in the browser. Nothing is sent to a server.`                                                                                  |
| `unlimitedStorage`                                                                                            | `Bookmarks and search history can grow beyond the default 10 MB quota for long-time users, and the extension also caches trade stat dictionaries and currency rates locally. Without this permission older records would be lost.` |
| Host：`https://*.pathofexile.com/trade*`、`https://*.pathofexile.tw/trade*`、`https://poe.game.qq.com/trade*` | `The sidebar and result enhancements are injected only into the official Path of Exile trade pages (international, Taiwan and China realms). The extension does not run on any other part of these sites.`                         |
| Host：`https://poe.game.qq.com/api/trade*`                                                                    | `The China realm serves its trade API from a different path than the trade page. The live search console needs to call this API the same way the official page does.`                                                              |
| Host：`https://poe.ninja/*`                                                                                   | `When the user enables price conversion on the International realm, the extension downloads public currency exchange rates from poe.ninja. Only the league name is sent.`                                                          |

### 遠端程式碼 / Remote code

選 **No, I am not using remote code**。所有 JavaScript 都打包在擴充功能裡；從 poe.ninja 和官方網站取得的只有 JSON 資料，不會被當成程式碼執行。

### 資料使用 / Data usage

所有資料類別都**不勾**：書籤、搜尋紀錄與設定只存在使用者的瀏覽器裡，從不傳送。

三項聲明全部勾選：

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## 3. 給審查員的測試說明 / Notes for reviewers

Chrome 的「測試說明」、Edge 的「Notes for certification」與 Firefox AMO 的「Notes to reviewers」都貼這段：

```text
The official Path of Exile trade website requires users to log in with a Path of Exile account before search interfaces and trading results are loaded. A free registered account is sufficient to test all features.

Testing steps:
1. Log in to the official Path of Exile website (https://www.pathofexile.com/login). Any free registered account works (registration is free at https://www.pathofexile.com/register).
2. Once logged in, open the official trade search page:
   - PoE 2: https://www.pathofexile.com/trade2/search/poe2/Standard
   - PoE 1: https://www.pathofexile.com/trade/search/Standard
3. The PoeXD sidebar appears on the left side of the page.
4. Run any search on the trade page, then click "New Folder" in the sidebar and use "+ Add Current Page" in the folder to bookmark the current search.
5. Click the "Search Preview" button on a bookmark or open the "History" tab to see recorded searches.
6. The extension operates entirely within the browser via local storage (`chrome.storage.local`); no remote servers or external trackers are contacted.

Third-party code notes:
- The bundle contains a "new Function" feature check from the zod library (used for input validation). It only tests whether eval is allowed and falls back when blocked by CSP; no remote or dynamic code is executed.
- innerHTML references come from the Vue runtime (nodeOps.insertStaticContent). The extension's own code does not use innerHTML and builds DOM nodes with createElement/textContent.

Source code: https://github.com/yehshune/PoeXD-Extension (MIT).
The submitted zip is built from the tagged commit with:
- Chrome / Edge: `POEXD_STORE_BUILD=1 pnpm wxt zip -b chrome`
- Firefox: `pnpm wxt zip -b firefox`
```

---

## 4. Microsoft Edge Add-ons 差異

- 在 Partner Center 新增擴充功能，上傳**同一個商店版 zip**。Edge 會給一個不同的擴充 ID，跟 Chrome 版不通用。
- Edge 只要求：說明（≥250 字元）、300×300 logo、1280×800 截圖（選填，最多 10 張）、440×280 與 1400×560 宣傳圖（選填）。
- 「Privacy policy」填同一個 PRIVACY.md 網址；「Notes for certification」貼上面的審查員說明。
- 類別選 **Entertainment**。

---

## 5. Firefox Add-ons (AMO) 差異

- **套件上傳**：上傳 `pnpm zip:firefox` 產出的 `.output/poexd-extension-1.0.0-firefox.zip`。
- **附加元件 ID**：`poexd-trade-helper@yehshune`（已在 `wxt.config.ts` 指定，不可隨意更改，且 AMO 刪除過的 ID 無法再次使用）。
- **類別**：**Games & Entertainment**。
- **支援平台**：純 Desktop 桌面版（manifest 未宣告 `gecko_android`，AMO 會自動排除 Android 版）。
- **原始碼上傳（Source code）**：若 AMO 審查要求提供原始碼以驗證打包產物，上傳打包時同步產出的 `.output/poexd-extension-1.0.0-sources.zip`，並附上建置指令：
  ```bash
  pnpm install
  pnpm build:firefox
  ```
- **給審查員的說明（Notes to reviewers）**：貼上第 3 節的英文說明（包含官方網站需登入帳號、以及 Vue runtime 的 innerHTML 說明）。

---

## 6. 重新產生截圖

截圖是用 dev 模式（`pnpm dev`）的瀏覽器，透過 Playwright `connectOverCDP` 連到 `127.0.0.1:9222` 擷取：

1. 先備份擴充功能的 `chrome.storage.local`，寫入示範書籤與設定。
2. 以 1280×800 視窗擷取，並把帳號名稱遮成 `Exile#0000`、隱藏 dev 專用工具列。
3. 把原始截圖套上標題外框，輸出成 JPEG（品質 90）。
4. 用備份還原 storage。

商店規定截圖要能反映實際功能。UI 有明顯改動時再重拍。
