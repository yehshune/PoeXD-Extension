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
| 類別                               | Tools（工具）；Edge：Entertainment；Firefox：Games & Entertainment                                                                            |
| 商店語言                           | English（預設）、繁體中文、简体中文                                                                                                           |

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

**Name**（取自 `_locales/en`）：`PoeXD – PoE 1 & 2 Trade Helper`

**Summary**（≤132 字元）：

```text
Path of Exile 1 & 2 trade helper: Chinese market translation, PoB shopping list, live search console, affix tools & bookmarks.
```

**Description**：

```text
PoeXD adds a sidebar to the official Path of Exile trade site (PoE 1 and PoE 2 / PoE2) that helps you organize searches, import PoB shopping lists, and react to new listings faster.

FEATURES
• Bookmark folders – save trade searches into nested folders, drag to reorder and reopen them in one click.
• Search preview – check and tune the filters of a bookmark or history entry before opening it.
• Search history – every search you run is recorded so you can find it again.
• Stat group templates – save frequently used stat filter groups and overlay them onto any search.
• Live Search Console – watch several live searches side by side in one tab with auto-reconnect, sound & desktop notifications.
• PoB shopping list – import Path of Building codes or poe.ninja / pobb.in / pastebin share links to track gear and gems, tune mod filters and search the trade site in one click.
• Trade page enhancements – tier quick buttons, affix selector, poe.ninja price conversion & sorting, PoB item copy, PoEDB links, matched-affix highlighting and PoE2 rune previews.
• Result Board – gather a search's results in the sidebar, find sellers holding several instant-buyout items and copy a stash search regex that highlights them all in their hideout.
• Pinned items – pin trade results and compare them later as official-style cards; sold items are marked.
• Market Translation – show the international trade site and pobb.in pages in Traditional or Simplified Chinese with each official realm's wording (optional bilingual mode).
• 11 built-in themes + custom theme editor, panel position, UI scale and keyboard shortcuts.
• Interface in English, Traditional Chinese and Simplified Chinese.

PRIVACY
• No account, no server, no analytics, no ads. Everything is stored locally in your browser.
• Fully open source under the MIT license.

PoeXD is a fan-made tool and is not affiliated with or endorsed by Grinding Gear Games.
Guide: https://yehshune.github.io/poexd/
Source code and issue tracker: https://github.com/yehshune/PoeXD-Extension
```

### 繁體中文

**名稱**（取自 `_locales/zh_TW`）：`PoeXD – PoE 1 & 2 市集中文化・交易助手`

**簡短說明**（≤132 字元）：

```text
流亡黯道 Path of Exile 官方交易市集中文化工具（PoE 1 & 2）：提供繁簡漢化與中英並列、PoB 購物清單與 pobb.in 翻譯、線上搜尋主控台、詞綴篩選與書籤管理。
```

**詳細說明**：

```text
PoeXD 是專為《流亡黯道》（Path of Exile / PoE 1 & PoE2）官方交易市集打造的免費開源輔助工具，同時支援國際服、台服與國服。除了提供國際服 POE 市集完整漢化（支援繁簡中文與中英並列），還在交易頁面加上側邊欄，幫你整理搜尋書籤、匯入 PoB 購物清單，並在單一分頁集中監聽多組即時搜尋（Live Search）。

功能亮點
• POE 市集漢化（國際服中文化）：以台服或國服官方用語顯示國際服市集的介面、篩選器、下拉選單與搜尋結果，支援繁體中文與簡體中文；開啟「中英並列」模式後，輸入中文或英文都搜得到。
• pobb.in 分享頁翻譯：授權存取並開啟市集漢化後，pobb.in 配裝分享頁也會自動顯示中文裝備與天賦詞綴。
• PoB 購物清單：貼上 Path of Building 代碼或 poe.ninja、pobb.in、pastebin 分享網址，依部位整理裝備與技能寶石清單、微調詞綴條件並一鍵前往官方市集搜尋。
• 線上搜尋主控台（Live Search）：在同一個分頁同時監聽多組即時搜尋，斷線自動重連，並支援官方通知音效／桌面通知、書籤分組與防止分頁自動休眠。
• 詞綴篩選與 T 階工具：篩選欄旁提供 T 階快捷按鈕與詞綴選擇器（支援物等區間與 PoE2 碑牌／換界石／珠寶），可直接帶入數值範圍並拖曳排序。
• 搜尋結果強化：整合 poe.ninja 匯率價格換算與排序（國際服）、結果詞綴高亮與「+和／+不」快速加入篩選、一鍵複製英文 PoB 裝備文字、PoEDB 連結，以及 PoE2 符文覆寫試算。
• 搜尋結果看板：把這次搜尋的結果集中到側邊欄篩選排序，找出能在同一個藏身處一次直購多件的賣家，並複製倉庫搜尋 regex 一次標出要買的物品。
• 釘選物品：釘選搜尋結果，之後以官方樣式卡片回頭比價，賣出的物品會標示已售出。
• 常用詞綴群組與搜尋預覽：儲存常用詞綴範本隨時疊加到目前搜尋；開啟書籤或歷史紀錄前可先預覽並微調篩選條件。
• 書籤資料夾與 TFT 互通：多層資料夾收納交易搜尋、拖曳排序、自動記錄搜尋歷史，並支援與 TFT Trade Extension 互相匯入匯出書籤。
• 個人化設定：11 款內建主題與自訂配色／圓角、面板左右位置、介面縮放比例與快捷鍵；擴充介面支援繁體中文、简体中文與 English。

隱私與授權
• 免註冊帳號、無後端伺服器、無追蹤分析或廣告，所有書籤與設定皆保存在你的瀏覽器本機。
• 以 MIT 授權完整開源，原始碼與問題回報：https://github.com/yehshune/PoeXD-Extension
• 使用教學：https://yehshune.github.io/poexd/

PoeXD 為玩家社群自製工具，與 Grinding Gear Games 無隸屬或背書關係。
```

### 简体中文

**名称**（取自 `_locales/zh_CN`）：`PoeXD – PoE 1 & 2 市集中文化・交易助手`

**简短说明**（≤132 字符）：

```text
流放之路 Path of Exile 官方交易市集中文化工具（PoE 1 & 2）：提供简繁汉化与中英对照、PoB 购物清单与 pobb.in 翻译、线上搜索主控台、词缀筛选与书签管理。
```

**详细说明**：

```text
PoeXD 是专为《流放之路》（Path of Exile / PoE 1 & PoE2）官方交易市集打造的免费开源辅助工具，同时支持国际服、国服与台服。除了提供国际服 POE 市集完整汉化（支持简繁中文与中英对照），还在交易页面旁加上侧边栏，帮你整理搜索书签、导入 PoB 购物清单，并在单个标签页中集中监听多组实时搜索（Live Search）。

功能亮点
• POE 市集汉化（国际服中文化）：以国服或台服官方用语显示国际服市集的界面、筛选器、下拉菜单与搜索结果，支持简体中文与繁体中文；开启「中英对照」模式后，输入中文或英文都能搜到。
• pobb.in 分享页翻译：授权访问并开启市集汉化后，pobb.in 配装分享页也会自动显示中文装备与天赋词缀。
• PoB 购物清单：粘贴 Path of Building 代码或 poe.ninja、pobb.in、pastebin 分享链接，按部位整理装备与技能宝石清单、微调词缀条件并一键前往官方市集搜索。
• 线上搜索主控台（Live Search）：在同一个标签页同时监听多组实时搜索，断线自动重连，并支持官方通知音效／桌面通知、书签分组与防止标签页自动休眠。
• 词缀筛选与 T 阶工具：筛选栏旁提供 T 阶快捷按钮与词缀选择器（支持物等区间与 PoE2 碑牌／换界石／珠宝），可直接填入数值范围并拖拽排序。
• 搜索结果增强：集成 poe.ninja 汇率价格换算与排序（国际服）、结果词缀高亮与「+和／+不」快速加入筛选、一键复制英文 PoB 装备文本、PoEDB 链接，以及 PoE2 符文覆盖试算。
• 搜索结果看板：把这次搜索的结果集中到侧边栏筛选排序，找出能在同一个藏身处一次直购多件的卖家，并复制仓库搜索 regex 一次标出要买的物品。
• 置顶物品：置顶搜索结果，之后以官方样式卡片回头比价，卖出的物品会标示已售出。
• 常用词缀群组与搜索预览：保存常用词缀模板随时叠加到当前搜索；打开书签或历史记录前可先预览并微调筛选条件。
• 书签文件夹与 TFT 互通：多级文件夹收纳交易搜索、拖拽排序、自动记录搜索历史，并支持与 TFT Trade Extension 互相导入导出书签。
• 个性化设置：11 款内置主题与自定义配色／圆角、面板左右位置、界面缩放比例与快捷键；扩展界面支持简体中文、繁体中文与 English。

隐私与许可
• 无需注册账号、无后端服务器、无统计追踪或广告，所有书签与设置均保存在你的浏览器本地。
• 以 MIT 协议完全开源，源码与问题反馈：https://github.com/yehshune/PoeXD-Extension
• 使用教程：https://yehshune.github.io/poexd/

PoeXD 为玩家社区自制工具，与 Grinding Gear Games 或腾讯无隶属或背书关系。
```

---

## 2. 隱私權實務 / Privacy practices（Chrome「隱私權」分頁）

### 單一用途 / Single purpose

```text
PoeXD enhances the official Path of Exile trade website: it lets players organize, revisit and monitor their trade searches (bookmarks, history, live search console) and adds display helpers to the trade page, including an optional Chinese display of the international trade site using the official Taiwan or China realm wording.
```

### 權限用途說明 / Permission justifications

| 權限                                                                                           | 填寫內容                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                                                      | `Stores the user's bookmarks, folders, search history, stat group templates, pinned trade results and preferences locally in the browser. Nothing is sent to a server.`                                                                                                                                                                                                                                           |
| `unlimitedStorage`                                                                             | `Bookmarks and search history can grow beyond the default 10 MB quota for long-time users, and the extension also caches trade stat dictionaries and currency rates locally. Without this permission older records would be lost.`                                                                                                                                                                                |
| `scripting`                                                                                    | `Used only to dynamically register or unregister the content script for pobb.in after the user grants or revokes the optional https://pobb.in/* host permission, keeping pobb.in strictly optional at install time.`                                                                                                                                                                                              |
| Host：`https://*.pathofexile.com/*`、`https://*.pathofexile.tw/*`、`https://poe.game.qq.com/*` | `Content scripts run only on the official Path of Exile trade pages (/trade* and /trade2*). Broad domain host permissions also allow the background service worker to fetch official trade data APIs (/api/trade[2]/data/*) and live search endpoints on the international, Taiwan and China realms.`                                                                                                             |
| Host：`https://webtw.poecdn.com/*`、`https://poecdn.game.qq.com/*`                             | `Used only when the user enables optional Market Translation (Chinese display on the international trade site) to refresh the official public UI translation dictionaries (translate.zh_TW.js / translate.zh_CN.js) as data without waiting for an extension release.`                                                                                                                                            |
| Host：`https://poe.ninja/*`                                                                    | `When the user enables price conversion on the International realm, the extension downloads public currency exchange rates from poe.ninja. Only the league name is sent. When the user pastes a poe.ninja PoB share link into the PoB shopping list, the extension fetches the raw PoB code of that link.`                                                                                                        |
| Optional host：`https://pobb.in/*`、`https://pastebin.com/*`                                   | `Optional, requested only when the user chooses to allow it on the extension's permission page. Used to fetch the raw Path of Building code of a pobb.in or pastebin share link the user pasted into the PoB shopping list (and, on pobb.in when Market Translation is enabled, to display item/gem/passive text in Chinese using bundled official data). The request carries no cookies and sends nothing else.` |

### 遠端程式碼 / Remote code

選 **No, I am not using remote code**。所有 JavaScript 都打包在擴充功能裡；從 poe.ninja 和官方網站取得的只有公開 JSON 資料與純文字介面字典（`translate.*.js` 以嚴格正規式純當資料解析，不會被 `eval` 或當成程式碼執行）。

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
7. Optional "Chinese Trade Site": open the PoeXD settings (or the toolbar popup), set Language to Traditional or Simplified Chinese, turn on "Chinese Trade Site", then reload the international trade page. The interface, filters, dropdowns and results are shown in Chinese.

How the "Chinese Trade Site" feature works:
- A content script runs in the page context (MAIN world) on www.pathofexile.com/trade* only. It wraps window.fetch and, for the four official trade data endpoints (/api/trade[2]/data/items, stats, static, filters), rewrites the display text of the JSON response in memory using translation dictionaries bundled in the extension package and refreshed in the background (6-hour local cache) from the official Taiwan/China realm public data endpoints when Market Translation is enabled.
- Only display text is changed. Request URLs, request bodies, search ids and every value sent to the official API stay identical to the English page. No user data leaves the browser, and downloaded official dictionaries are parsed purely as data (no eval) and cached locally.
- Result rows are translated by replacing the text of existing DOM text nodes and title attributes; no HTML is injected.
- When the feature is off, the wrapper passes every request and response through unchanged.

Trade page fix:
- On the trade search form, pressing Enter in a filter input dispatches that input's own "change" event just before the official site's search handler runs, so the search includes the value the user just typed (the official site otherwise needs Enter twice). No request is created or modified by the extension.

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
