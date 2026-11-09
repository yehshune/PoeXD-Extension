<p align="center">
  <img src="./docs/store/images/zh-TW/promo-marquee-1400x560.png" width="100%" alt="PoeXD Extension - Path of Exile 官方交易市集全方位輔助擴充套件">
</p>

<p align="center">
  <a href="https://github.com/yehshune/PoeXD-Extension/actions"><img src="https://img.shields.io/badge/Status-Active%20Development-6366F1?style=flat-square" alt="Status"></a>
  <img src="https://img.shields.io/badge/Manifest-V3%20(Chrome%20%7C%20Edge%20%7C%20Firefox)-10B981?style=flat-square" alt="Manifest">
  <img src="https://img.shields.io/badge/PoE-1%20%26%202%20Ready-F59E0B?style=flat-square" alt="PoE Version">
  <img src="https://img.shields.io/badge/License-MIT-94A3B8?style=flat-square" alt="License">
</p>

<p align="center"><b>繁體中文</b> · <a href="./README.en.md">English</a></p>

---

## 專案介紹

**PoeXD Extension** 是一款專為《流亡黯道》（Path of Exile 1 與 Path of Exile 2）玩家與交易愛好者打造的官方交易網站輔助擴充套件。

旨在徹底解決官方交易市集在大量連線監聽、多重詞綴微調、跨聯盟搜尋管理上的痛點。透過輕量無侵入的架構，提供**線上搜尋主控台**、**常用詞綴群組疊加**、**樹狀書籤管理**與 **TFT Trade Extension 雙向互通**，為流亡者帶來流暢、清晰且高效的交易搜尋體驗。

---

## 核心特色

### ⚡ 線上搜尋主控台 (LiveSearch Primary Console)

- **多連線集中監聽**：告別傳統多開十幾個分頁耗盡記憶體的困擾，在專屬的權威主控台分頁中統一管理多組即時搜尋。
- **本次連線與上次連線 (Resume Plan)**：自動記住前次會話所啟用的搜尋連線，瀏覽器重開或分頁重載皆可一鍵還原。
- **結果專注模式 (Result-Only Presentation)**：自動隱藏官方冗長頁首與無關搜尋面板，最大化保留交易物品展示區與即時推播資訊。
- **API 速率智慧保護**：即時監控 `/fetch` 請求速率與連線健康度（`API ● 正常` / `API ◐ 等待 Xs`），有效防止觸發官方頻率限制。
- **暫時搜尋 (Temporary Search)**：支援直接貼入自訂網址或從現有搜尋一鍵推播，無需預先建立書籤即可即時監聽。

<p align="center">
  <img src="./docs/store/images/zh-TW/screenshot-4.jpg" width="80%" alt="線上搜尋主控台">
</p>

### 🎯 常用詞綴群組與條件疊加 (Stat Group Templates & Criteria Overlay)

- **模組化詞綴群組**：將常用的配裝條件（例如「生命 + 總元素抗性」、「法術壓抑 + 移動速度」）儲存為專屬模板。
- **無損疊加套用 (Overlay)**：直接在現有搜尋表單上疊加特定詞綴模組，不覆蓋其它篩選設定，維持原有物品類型與其他條件。
- **階級選擇器 (Tier Dropdown)**：官方搜尋表單深度整合，點選即可快速填入 T1～T3 詞綴對應數值範圍。
- **搜尋預覽 (Search Preview)**：隨時展開解碼檢視歷史紀錄或書籤背後的真實查詢條件，可單鍵選擇性疊加特定詞綴組。

<p align="center">
  <img src="./docs/store/images/zh-TW/screenshot-3.jpg" width="49%" alt="常用詞綴群組">
  <img src="./docs/store/images/zh-TW/screenshot-2.jpg" width="49%" alt="搜尋預覽與疊加">
</p>

### 📁 樹狀階層書籤與 TFT 互通 (Hierarchical Bookmarks & Transfer)

- **多層級資料夾組織**：以樹狀目錄直覺收納各職業、拓荒階段或流派配裝搜尋，支援自由排序與拖曳整理。
- **跨分流無感切換 (Auto League)**：書籤本體具備 Realm-Independent 特性，自動依據當前瀏覽的伺服器與聯盟即時套用，亦支援個別鎖定聯盟。
- **TFT Trade Extension 雙向相容**：採用標準 Base64 傳輸碼（Bookmark Transfer），無縫讀取與匯出 TFT 書籤資料夾，支援差異比對與安全合併。

<p align="center">
  <img src="./docs/store/images/zh-TW/screenshot-1.jpg" width="80%" alt="樹狀書籤管理">
</p>

### 🌐 PoE 1 & PoE 2 雙版本原生支援

- **完整繁中數據庫**：內建最新 PoE 1 與 PoE 2 繁體中文詞綴辭典、物品中英對照與分類對應資料。
- **獨立運行環境**：PoE 1 與 PoE 2 主控台各自具備獨立的 Background 調度協調者，互不干擾。

<p align="center">
  <img src="./docs/store/images/zh-TW/screenshot-5.jpg" width="80%" alt="設定頁">
</p>

---

## 架構與工作流程

<p align="center">
  <img src="./assets/readme/workflow.svg" width="100%" alt="PoeXD Extension 核心功能架構與工作流程">
</p>

### 核心運作機制

1. **以 Search ID 作為單一真理來源 (ADR-0008)**
   官方 Trade 網址中的短碼本質為 Gzip 壓縮的查詢條件雜湊值。PoeXD 嚴格以此作為單一資料權威（Canonical Search ID），不在前端快取中殘留過期或衝突的條件物件，確保所有預覽與疊加皆 100% 精準忠實於官方原始設定。

2. **Main-World 攔截與非侵入式整合**
   透過 `entrypoints/main-world/` 注入輕量適配器，不破壞官方 Vue 運行時響應狀態，僅在官方觸發狀態變更時安全捕捉並掛載擴充套件按鈕與標籤。

3. **Background 集中權威調度**
   即時搜尋連線與 WebSocket 通道由 Background Service Worker 集中協調，保障在分頁切換、網路波動或瀏覽器睡眠喚醒時，連線狀態能可靠復原。

---

## 快速上手

### 方式一：從擴充功能商店安裝（推薦）

- **Chrome**：Chrome Web Store（上架審核中）
- **Edge**：Microsoft Edge Add-ons（上架審核中）
- **Firefox**：Firefox Add-ons（AMO，上架審核中）

商店版會自動更新，是最建議的安裝方式。

### 方式二：手動安裝未封裝版本（Chrome / Edge / Brave / Opera）

1. 前往 [Releases](https://github.com/yehshune/PoeXD-Extension/releases) 下載 `poexd-extension-<版本>-chromium.zip` 並解壓縮。
2. 開啟 `chrome://extensions/`（Edge 為 `edge://extensions/`），啟用「**開發人員模式**」。
3. 點選「**載入未封裝項目**」，選擇解壓縮後的資料夾。
4. 開啟 [Path of Exile 官方交易網站](https://www.pathofexile.com/trade)，右側會出現 PoeXD 工具列。

> 手動安裝的版本**不會自動更新**，請定期到 Releases 下載新版，解壓縮覆蓋原資料夾後，在擴充功能頁按「重新載入」。
> 同一個資料夾覆蓋更新，書籤等本機資料會保留。
>
> Firefox 不允許安裝未簽署的擴充功能，請從 Firefox Add-ons 安裝。

---

### 方式三：從原始碼開發與建置（開發者）

#### 環境需求

- **Node.js**: `>= 22.0.0`
- **pnpm**: `>= 12.0.0`

#### 安裝步驟

```bash
# 複製專案庫
git clone https://github.com/yehshune/PoeXD-Extension.git
cd PoeXD-Extension

# 安裝依賴項
pnpm install
```

#### 開發與測試指令

```bash
# 啟動 Chrome 開發即時熱重載
pnpm dev

# 啟動 Firefox 開發模式
pnpm dev:firefox

# 執行單元測試
pnpm test

# 執行測試覆蓋率分析
pnpm test:coverage

# 執行 TypeScript 型別檢查
pnpm compile

# 執行程式碼自動格式化
pnpm format
```

#### 生產建置

```bash
# 建置 Chrome MV3 生產檔案 (輸出至 .output/chrome-mv3)
pnpm build

# 建置 Firefox MV3 生產檔案 (輸出至 .output/firefox-mv3)
pnpm build:firefox

# 打包產出發布用 ZIP 壓縮檔案
pnpm zip

# 商店上架用建置（不含固定擴充 ID 的 manifest key）
POEXD_STORE_BUILD=1 pnpm zip
```

---

## 技術棧

| 領域                    | 技術選型                                                                    | 說明                                                     |
| :---------------------- | :-------------------------------------------------------------------------- | :------------------------------------------------------- |
| **Extension Framework** | [WXT (Web Extension Tools)](https://wxt.dev/)                               | 現代化跨瀏覽器擴充套件建構架構，支援原生 Vite 與 MV3/MV2 |
| **Frontend Framework**  | [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) | Composition API、`<script setup>` 嚴格型別架構           |
| **UI Components**       | [Reka UI](https://reka-ui.com/) + [Lucide Icons](https://lucide.dev/)       | 無障礙友善的 Headless 原語與精美現代化圖標               |
| **Styling**             | [Tailwind CSS 4](https://tailwindcss.com/)                                  | 新世代 CSS 引擎，結合專案自訂暗色遊戲風格設計系統        |
| **Cross-Context Comms** | `@webext-core/messaging`                                                    | Type-safe 的 Background、Content Script 與 Popup 通訊    |
| **Testing**             | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/)       | 快速單元測試、覆蓋率檢驗與瀏覽器 E2E 自動化整合測試      |

---

## 專案規格與文件

更詳盡的架構決策與研究文件，請參閱本專案 `docs/` 目錄：

- [領域模型定義 (Domain Context)](./CONTEXT.md)
- [ADR-0007: TFT Transfer 互通協定規範](./docs/adr/0007-realm-independent-bookmarks-and-tft-transfer.md)
- [ADR-0008: Search ID 單一真理來源決策](./docs/adr/0008-search-id-is-the-source-of-query-criteria.md)
- [ADR-0010: 常用詞綴群組與搜尋預覽疊加機制](./docs/adr/0010-stat-group-templates-and-preview-overlay-replace-filter-presets.md)
- [LiveSearch 主控台架構合約](./docs/architecture/live-search-primary-contract.md)

---

## 隱私權與權限

- 所有資料都存放在你的瀏覽器本機，本專案不經營任何伺服器，也沒有分析或追蹤程式碼。
- 完整說明請見 [隱私權政策](./PRIVACY.md)；安全性問題請依 [SECURITY.md](./SECURITY.md) 私下回報。

---

## 贊助支持

PoeXD 免費且開源。如果它幫你省下時間，歡迎透過 [Ko-fi](https://ko-fi.com/shu540886) 贊助支持後續開發。

---

## 參與貢獻

歡迎提出 Issue 與 PR，請先閱讀 [貢獻指南](./CONTRIBUTING.md)。

---

## 免責聲明與授權條款

- **免責聲明**：本專案為社群自發維護的非官方開源工具，與 Grinding Gear Games (GGG) 或 Tencent 沒有任何隸屬、背書或贊助關係。「Path of Exile」為 Grinding Gear Games 的商標。
- **開源授權**：原始碼採用 [MIT License](./LICENSE)。`public/json/` 內的遊戲資料版權屬於 Grinding Gear Games，不在 MIT 授權範圍內，詳見 [NOTICE](./NOTICE.md)。
