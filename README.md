<p align="center">
  <img src="./docs/store/images/zh-TW/promo-marquee-1400x560.png" width="100%" alt="PoeXD Extension - Path of Exile 官方交易市集輔助擴充套件">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/fbbkaeekjalfecgjfcephaiopffeobjg"><img src="https://img.shields.io/badge/Chrome-Web%20Store-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <a href="https://microsoftedge.microsoft.com/addons/detail/hnnpgpcnmgjbmmhgogcljbnfoklblgmb"><img src="https://img.shields.io/badge/Edge-Add--ons-0078D7?style=flat-square&logo=microsoftedge&logoColor=white" alt="Edge Add-ons"></a>
  <img src="https://img.shields.io/badge/PoE-1%20%26%202-F59E0B?style=flat-square" alt="PoE 1 & 2">
  <img src="https://img.shields.io/badge/License-MIT-94A3B8?style=flat-square" alt="License">
</p>

<p align="center"><b>繁體中文</b> · <a href="./README.en.md">English</a></p>

**PoeXD Extension** 是《流亡黯道》（PoE 1／PoE 2）官方交易市集的輔助擴充套件：集中管理即時搜尋、快速套用詞綴、整理書籤，並把國際服市集翻成中文。

## 安裝

| 瀏覽器                    | 安裝方式                                                                                                                                                                      |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome、Brave 等 Chromium | [Chrome Web Store](https://chromewebstore.google.com/detail/fbbkaeekjalfecgjfcephaiopffeobjg)                                                                                 |
| Microsoft Edge            | [Edge 附加元件](https://microsoftedge.microsoft.com/addons/detail/hnnpgpcnmgjbmmhgogcljbnfoklblgmb)                                                                           |
| 手動安裝（不會自動更新）  | 到 [Releases](https://github.com/yehshune/PoeXD-Extension/releases) 下載 `chromium.zip` 解壓縮，在 `chrome://extensions/` 開啟「開發人員模式」→「載入未封裝項目」選擇該資料夾 |

裝好後開啟[官方交易網站](https://www.pathofexile.com/trade)，右側會出現 PoeXD 工具列。商店版會自動更新；Firefox 目前不提供。

## 最新更新

- **市集漢化**：國際服英文市集可用台服或國服的官方用語顯示介面、篩選器、下拉選單與搜尋結果（詞綴、物品名、屬性標籤）。只改顯示文字，送出的搜尋與英文頁相同；開啟中英並列時輸入英文也搜得到。
- **搜尋結果翻譯補齊**：「最高品質」提示、最後通牒的需求物品與傳奇獎勵下拉、星團珠寶附魔、技能與多行詞綴、傭兵資訊都會翻譯。
- **修正官網 Enter 搜尋**：在篩選欄輸入數值後第一次按 Enter，搜尋就會帶到剛輸入的值（官網原本要按兩次）。
- **詞綴工具**：PoE 2 範圍珠寶詞綴與一般珠寶分開；負向詞綴與星團珠寶的階級範圍修正；搜尋預覽與傭兵選擇器改用和詞綴選擇器一致的版面。

完整紀錄見 [Releases](https://github.com/yehshune/PoeXD-Extension/releases)。

## 功能

### ⚡ 線上搜尋主控台

在單一分頁集中監聽多組即時搜尋，斷線自動重連；依書籤資料夾分組、批次啟用或停止，重開瀏覽器可恢復上次的連線。只顯示結果區、可點單一連線過濾，並即時顯示 API 速率狀態，避免觸發官方限制。

<p align="center"><img src="./docs/store/images/zh-TW/screenshot-4.jpg" width="80%" alt="線上搜尋主控台"></p>

### 🎯 常用詞綴群組與搜尋預覽

把常用條件（例如「生命 + 總元素抗性」）存成群組，直接疊加到目前的搜尋，不覆蓋其他篩選，套錯可一鍵復原；可用分享碼或備份檔匯入匯出。搜尋預覽能看到歷史紀錄或書籤背後的實際條件，並單獨疊加其中的詞綴。

<p align="center">
  <img src="./docs/store/images/zh-TW/screenshot-3.jpg" width="49%" alt="常用詞綴群組">
  <img src="./docs/store/images/zh-TW/screenshot-2.jpg" width="49%" alt="搜尋預覽與疊加">
</p>

### 🔍 詞綴篩選與階級工具

依物品類別瀏覽前綴／後綴、勾選後一次寫入官方篩選器；篩選欄旁的 T 階按鈕一鍵填入數值範圍；詞綴可拖曳排序或移到其他群組。PoE 2 碑牌、換界石與範圍珠寶也支援。

### 💰 搜尋結果強化

依 poe.ninja 匯率換算不同通貨的標價（國際服）、標示符合條件的詞綴，以及 PoE 2 符文覆寫後的 DPS／防禦試算與排序。

### 📁 書籤、歷史紀錄與 TFT 互通

樹狀資料夾收納搜尋，支援拖曳、封面圖與滑過預覽；書籤會自動套用目前的伺服器與聯盟。自動記錄搜尋歷史。可與 TFT Trade Extension 互相匯入匯出書籤，匯入前可預覽差異。

<p align="center"><img src="./docs/store/images/zh-TW/screenshot-1.jpg" width="80%" alt="樹狀書籤管理"></p>

### ⚙️ 其他

- 道具名稱與篩選欄模糊搜尋（自動加 `~`）、聚焦／清除搜尋欄快捷鍵、分頁標題顯示道具名稱。
- 主題、面板位置、寬度與縮放可調整；點工具列圖示即可開關各項功能。
- 擴充介面提供繁體中文、簡體中文與英文；詞綴資料涵蓋官方交易網站的 11 種語言。

<p align="center"><img src="./docs/store/images/zh-TW/screenshot-5.jpg" width="80%" alt="設定頁"></p>

## 隱私

所有資料都存在你的瀏覽器本機；本專案沒有伺服器，也沒有分析或追蹤程式碼。詳見[隱私權政策](./PRIVACY.md)，安全性問題請依 [SECURITY.md](./SECURITY.md) 私下回報。

## 開發

需要 Node.js `>= 22` 與 pnpm。

```bash
pnpm install
pnpm dev        # Chrome 開發模式（熱重載）
pnpm test       # 單元測試
pnpm compile    # 型別檢查
pnpm build      # 生產建置
```

完整流程與規範見[貢獻指南](./CONTRIBUTING.md)；架構與決策紀錄在 [CONTEXT.md](./CONTEXT.md) 與 [`docs/`](./docs/)。技術棧：WXT、Vue 3、TypeScript、Tailwind CSS 4、Vitest、Playwright。

## 支持與授權

- PoeXD 免費且開源，如果它幫你省下時間，歡迎到[贊助頁](https://yehshune.github.io/support/)支持。
- 本專案為社群維護的非官方工具，與 Grinding Gear Games 或騰訊沒有隸屬或背書關係。「Path of Exile」為 Grinding Gear Games 的商標。
- 原始碼採用 [MIT License](./LICENSE)；`public/json/` 內的遊戲資料版權屬於 Grinding Gear Games，不在 MIT 授權範圍內，詳見 [NOTICE](./NOTICE.md)。
