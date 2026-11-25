# 貢獻指南 / Contributing

感謝你願意協助改進 PoeXD Extension！Issue 與 PR 都歡迎使用繁體中文或英文。
Thanks for helping! Issues and pull requests are welcome in Traditional Chinese or English.

## 開發環境 / Setup

- Node.js `>= 22`
- pnpm（版本見 `package.json` 的 `packageManager`，建議用 `corepack enable`）

```bash
pnpm install
pnpm dev            # Chrome，熱重載
pnpm dev:firefox    # Firefox
```

## 送出 PR 前 / Before opening a PR

請確認以下指令都通過（CI 會跑同一套檢查）：

```bash
pnpm format:check
pnpm compile
pnpm test
pnpm build && pnpm build:firefox
```

- 新功能與修正請附上測試；邏輯放在 `utils/` 或 `entrypoints/*/logic/`，方便單元測試。
- 使用者看得到的文字必須同時加入 `utils/i18n/messages/` 的 `zh-TW`、`zh-CN`、`en` 三個語系。
- 不要用 `innerHTML` 插入動態內容，請改用 `utils/safe-dom.ts` 或 `textContent`。
- 新增權限需要在 PR 說明理由；非核心功能需要的權限請改用可選權限（`optional_permissions`），
  在使用者主動啟用時才請求。
- 架構性決策請參考 `GLOSSARY.md` 與 `docs/adr/`，必要時新增 ADR。

## Commit 訊息 / Commit messages

使用 [Conventional Commits](https://www.conventionalcommits.org/)：
`feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`chore:`、`perf:`、`ci:`。
Release notes 會依這些前綴自動分類。

## 遊戲資料 / Game data

`public/json/` 的資料（物品、詞綴、傭兵、市集篩選與市集漢化）全部由 poexd-data 產生，發布在 [poexd-data-dist](https://github.com/yehshune/poexd-data-dist)，
一般貢獻不需要動到它。要手動同步最新發布可執行 `pnpm data:sync`；排程會每天自動開 PR。

## E2E 測試

E2E 分成兩套：

- **離線 E2E**（`pnpm e2e:offline`，CI 會跑）：先建置 Chrome 版，再由 Playwright 自行啟動 Chromium 載入
  `.output/chrome-mv3`。官方頁面由 `e2e/offline/fixtures/` 的最小骨架回放，其他對外請求一律擋下並記錄，
  所以不會遇到 Cloudflare，也不會消耗官方 API 的速率限制。測試檔為 `e2e/offline/*.offline.ts`。
  第一次執行前需 `pnpm exec playwright install chromium`。
  線上搜尋的 WebSocket 由 content script 建立，Playwright 攔不到，改由本機 WSS 替身伺服器
  （`e2e/offline/live-socket-server.ts`）扮演官方；它在測試當下用 `openssl` 產生自簽憑證，所以 PATH 上需要有
  `openssl`（Git for Windows、macOS、GitHub Actions 的 Ubuntu 都內建）。
  結果列用的 `fixtures/poe1-fetch.json`、`fixtures/poe2-fetch.json` 是真實官方 API 回應（已去除帳號、
  藏身處 token 等個資）；官方改了回應格式時，在 dev 瀏覽器開一個有結果的搜尋頁，執行
  `node e2e/offline/record-fetch.ts poe1`（或 `poe2`）重錄。去識別化會讓同一個真實帳號對應同一個假賣家。
  PoE2 的錄音要同時有混沌石標價、不同價格與同一賣家的多筆刊登（價格換算、看板排序與賣家分組靠這些資料），
  缺少時測試會直接說明缺什麼；一次搜尋湊不齊時可以合併兩次錄音。
  repo 只保存 API JSON，不保存官方網站的 HTML / JS / CSS。

- **實機金絲雀**（`pnpm e2e:canary`，不進 CI）：離線 E2E 只驗證替身頁，官方改版時仍會全綠，所以另外用
  `e2e/official-page-contract.ts` 列出擴充功能依賴的官方 DOM 選擇器與 Vuex store 形狀。`pnpm dev` 開著、
  在 dev 瀏覽器開好一個有結果的官方搜尋頁後執行，它只讀取已開啟分頁的 DOM 與 store，不發任何請求。
  同一份契約中標成 `offline: true` 的項目也由 `e2e/offline/contract.offline.ts` 檢查替身頁，
  讓替身頁跟著官方更新。新功能開始依賴官方的某個結構時，請一併加進契約。

- **實機 E2E**（`pnpm e2e`）：需要一個已通過 Cloudflare 驗證、並登入官方交易網站的瀏覽器設定檔
  （先執行 `pnpm dev` 手動登入一次），因此只在本機執行，CI 不會跑。用於確認真實官方頁面上的版面。

## 發版 / Releasing

推送 `v*.*.*` tag 會觸發 `.github/workflows/release.yml` 打包。打 tag 前請確認：

1. main 最新 commit 的 CI 全部通過（包含 `e2e-offline`）。
2. 在 dev 瀏覽器分別開好有結果的 PoE1 與 PoE2 搜尋頁，執行 `pnpm e2e:canary` 確認官方頁面仍符合契約。
   CI 跑不了實機檢查，官方改版只有這一步會發現；不符合時先修好再發版。
