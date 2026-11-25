---
name: poe-live
description: 在使用者 `pnpm dev` 開的瀏覽器（CDP 9222，已登入官方市集）上實機查看或驗證擴充行為。使用者說「連 9222 看一下」「實機驗證」「到官方頁面確認」或要截圖、讀官方 store、操作官方搜尋時使用。
---

# 官方頁面實機驗證（`pnpm poe`）

一律用 `pnpm poe <command>`，不要另外寫 `connectOverCDP` 的一次性腳本。工具在 `e2e/live/`，`pnpm poe help` 有完整說明。

## 常用流程

1. `pnpm poe status`：確認 dev 瀏覽器活著、有沒有官方搜尋分頁、擴充是否注入（`extensionMounted`）、結果筆數、store 摘要。
2. 沒有分頁：`pnpm poe open poe2`（或 `poe1`、完整網址；只給 searchId 會沿用目前聯盟）。
3. 查看：`shot [selector]`（存到 `e2e/.shots/`，再用 Read 看圖）、`store <path>`、`eval "<expr>"`。
4. 操作：`act filters show|hide`、`act layout compact|compact-two|immersion`、`act clear`、`act search`、`act load-more`、`act live on|off`。

有多個搜尋分頁時加 `--tab N`（順序同 `status`）。

## 規則

- **改擴充程式碼前先 `pnpm poe close-trade`**：dev 熱更新會一直刷新官方分頁。改完要驗證時再 `open`。
- `open`、`reload`、`act search`、`act load-more`、`act live on` 會打官方 API，有速率限制；能用唯讀指令確認的就不要重複搜尋。看到 429 就停下來等。
- 遇到 Cloudflare 驗證頁：請使用者在 dev 瀏覽器手動通過，不要嘗試自動處理。
- 官方 UI 會被擴充中文化，判斷狀態用 class／store，不要比對按鈕文字。
- 視窗最小化時，`shot`、`act`、`eval` 會在這次連線期間自動模擬 1600×1000，並在 stderr 提示；斷線後恢復，不影響使用者。

## 何時改寫成測試

同一個驗證會反覆用到時，寫成 `e2e/*.e2e.ts`（共用 `e2e/fixtures.ts` 的 `tradePage`），以 `pnpm e2e` 執行。官方 DOM／store 契約變動用 `pnpm e2e:canary` 檢查。新的官方操作請加在 `e2e/live/official-actions.ts`，讓 CLI 與測試共用。
