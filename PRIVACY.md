# Privacy Policy / 隱私權政策

Effective date / 生效日期：2026-11-09

- [English](#english)
- [繁體中文](#繁體中文)

---

## English

PoeXD Extension ("the extension") is an open-source helper for the official Path of Exile trade
site. The developer does not operate any server, and the extension contains no analytics,
advertising or tracking code.

### Data stored on your device

The extension stores the following data locally in your browser (`chrome.storage` /
`browser.storage`). It never leaves your device unless described below:

- Bookmarks, folders and stat group templates you create
- Search history records and live search connections to restore
- Preferences such as theme, display language and layout
- Cached currency exchange rates

Uninstalling the extension deletes all of this data.

### Network requests

| Destination                                                                                                                                               | When                                                                                    | What is sent                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official trade sites (`pathofexile.com`, `pathofexile.tw`, `poe.game.qq.com`) and their CDNs (`web.poecdn.com`, `webtw.poecdn.com`, `poecdn.game.qq.com`) | While you use the trade site (and in the background when Market Translation is enabled) | The same trade queries and live search connections the official site makes on your behalf; when Market Translation is enabled, public official trade data and UI dictionary files (`translate.zh_TW.js` / `translate.zh_CN.js`) are fetched and cached locally |
| `poe.ninja`                                                                                                                                               | When price conversion is enabled on the International realm                             | The league name, to fetch public currency exchange rates                                                                                                                                                                                                       |

### Data sharing

The developer does not collect, sell or share any personal data.

### Changes and contact

Changes to this policy are tracked in this file's Git history. Questions can be filed as a
[GitHub issue](https://github.com/yehshune/PoeXD-Extension/issues). For security issues, see
[SECURITY.md](./SECURITY.md).

---

## 繁體中文

PoeXD Extension（以下稱「本擴充功能」）是《流亡黯道》官方交易網站的開源輔助工具。開發者沒有經營任何伺服器，
本擴充功能也不含任何分析、廣告或追蹤程式碼。

### 儲存在你裝置上的資料

本擴充功能只把以下資料存放在瀏覽器的本機儲存空間（`chrome.storage` / `browser.storage`），
除下文說明的情況外，不會離開你的裝置：

- 你建立的書籤、資料夾與常用詞綴群組
- 搜尋紀錄與可還原的即時搜尋連線
- 主題、顯示語言、版面等偏好設定
- 快取的通貨匯率

移除本擴充功能時，上述資料會一併刪除。

### 網路請求

| 對象                                                                                                                                         | 時機                                             | 傳送內容                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官方交易網站（`pathofexile.com`、`pathofexile.tw`、`poe.game.qq.com`）與其 CDN（`web.poecdn.com`、`webtw.poecdn.com`、`poecdn.game.qq.com`） | 你使用交易網站時（以及啟用市集漢化時於背景更新） | 與官方網站代你送出的相同交易查詢與即時搜尋連線；啟用市集漢化時會抓取官方公開交易資料與介面字典檔（`translate.zh_TW.js` / `translate.zh_CN.js`）並快取於本機 |
| `poe.ninja`                                                                                                                                  | 在國際服啟用價格換算時                           | 聯盟名稱，用於取得公開的通貨匯率                                                                                                                            |

### 資料分享

開發者不會收集、販售或分享任何個人資料。

### 政策變更與聯絡方式

本政策的變更記錄於此檔案的 Git 歷史。如有疑問，請於 [GitHub Issues](https://github.com/yehshune/PoeXD-Extension/issues)
提出；安全性問題請參閱 [SECURITY.md](./SECURITY.md)。
