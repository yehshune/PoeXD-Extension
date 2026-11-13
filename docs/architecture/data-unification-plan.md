# 資料端統一到 poexd-data（第一階段）規格

> **文件狀態**：DONE — 第 1–4 步完成（2026-11-13）；手動觸發 workflow 待推送後驗證
> **範圍**：讓 `public/json/` 下所有資料都由 [poexd-data](https://github.com/yehshune/poexd-data) 產生與發布，擴充只負責同步。使用者端行為完全不變。
> **後續**：第二階段（執行期從遠端更新資料）以本階段的發布單位與 manifest 為前提，另立文件。

---

## 1. 現況

`public/json/` 目前有三個來源：

| 資料                                                                                                                                          | 產生者                                                   | 更新方式                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `{poe1,poe2}/mods-tiers.json`、`locales/*/{stats,items,mod-lines,result-labels}.json`、`poe1/mercenary.json`、`poe1/locales/*/mercenary.json` | poexd-data（GGG CDN 解包）                               | 手動 `pnpm data:sync`，需本機 clone `../poexd-data/output` |
| `{poe1,poe2}/locales/*/trade-filters.json`                                                                                                    | 擴充 `scripts/update-trade-filters.mjs`（官方市集 API）  | `data-refresh.yml` 每週開 PR                               |
| `locales/*/trade-ui.json`、`{poe1,poe2}/locales/*/{trade-stats,trade-static}.json`                                                            | 擴充 `scripts/update-market-translation.mjs`（官方網站） | 手動 `pnpm market:update`                                  |

其他觀察：

- poexd-data 的 `deploy.yml` 只在 push 到 main 時建置，**遊戲改版不會自動更新**；actions 未鎖 SHA，且仍用 Node 20 版本的 setup actions。
- poexd-data 已經在請求官方市集 API（`trade-stats.ts`、`zh-cn-trade-names.ts` 會打 `www.pathofexile.com` 與 `poe.game.qq.com`），所以把另外兩支腳本搬過去不會帶來新的外部依賴。
- poexd-data 另外還發布 atlas、icons、unmatched-report，擴充用不到。

## 2. 目標與非目標

**目標**

1. poexd-data 成為 `public/json/` 所有檔案的**唯一產生者**。
2. 每次發布都附 `manifest.json`，列出每個檔案的 sha256、大小、所屬批次與格式版本。
3. 擴充用 `pnpm data:sync` 從**固定的 commit** 下載並驗證，不再需要本機 clone；每週 workflow 改為「同步後開 PR」。
4. 遷移完成時，在同一天產生的資料下，`public/json/` 與遷移前**逐位元組相同**（驗收條件）。

**非目標**

- 執行期遠端更新（第二階段）。
- 縮小安裝包、調整檔案格式或語系範圍。
- 擴充沒用到的 atlas、icons 資料。

## 3. 一致性批次

批次內的檔案必須來自同一次建置，整批驗證、整批寫入；不同批次之間可以獨立更新。

| 批次 ID             | 檔案                                                                       | 一致性規則                                                 | 來源週期 |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| `<v>/game`          | `mods-tiers.json`、`locales/*/{stats,items,mod-lines,result-labels}.json`  | 同一 `patch`，索引長度對齊（沿用 `validateGameDataBatch`） | 遊戲改版 |
| `poe1/mercenary`    | `mercenary.json`、`locales/*/mercenary.json`                               | 同一 `patch`，索引對齊                                     | 遊戲改版 |
| `<v>/trade-filters` | `locales/*/trade-filters.json`                                             | `en` 必須成功；其他語系失敗時沿用上一版                    | 每週     |
| `market`            | `locales/*/trade-ui.json`、`<v>/locales/*/{trade-stats,trade-static}.json` | `en` 的 `trade-stats` 必須成功；同上                       | 每週     |

`<v>` 為 `poe1` 或 `poe2`。

## 4. poexd-data 端變更

### 4.1 搬移腳本

| 擴充現有檔案                                                             | 搬到 poexd-data                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `scripts/trade-filter-api.mjs`                                           | `src/trade/trade-filter-api.ts`                               |
| `scripts/update-trade-filters.mjs`                                       | `src/trade/build-trade-filters.ts`                            |
| `scripts/market-translation-api.mjs`                                     | `src/trade/market-translation-api.ts`                         |
| `scripts/update-market-translation.mjs`                                  | `src/trade/build-market-translation.ts`                       |
| `scripts/file-update-rollback.mjs`                                       | 不搬：poexd-data 改成先寫入暫存目錄、驗證後整批搬入 `output/` |
| `tests/trade-filter-api.test.js`、`tests/market-translation-api.test.js` | `tests/*.test.ts`（改用 `node:test`）                         |

- 改寫成 TypeScript 以符合 poexd-data 慣例，邏輯與輸出格式不變。
- 新增建置目標：`build:trade`（篩選翻譯與市集漢化）。`build:all` 也包含它。
- 「`en` 失敗整批不寫、其他語系失敗沿用舊檔」的語意保留。沿用舊檔需要上一版內容，見 4.3。

### 4.2 manifest.json

發布在根目錄，與既有 `version.json` 並存（`version.json` 是 README 公開的端點，保留不動）。

```json
{
  "manifestVersion": 1,
  "generatedAt": "2026-11-13T03:00:00.000Z",
  "sourceCommit": "<poexd-data main 的 commit SHA>",
  "games": {
    "poe1": { "patchVersion": "3.29.3.6" },
    "poe2": { "patchVersion": "0.5.5.8" }
  },
  "batches": {
    "poe2/game": { "patch": "0.5.5.8", "builtAt": "…" },
    "poe2/trade-filters": { "builtAt": "…", "staleLocales": ["ko"] }
  },
  "files": {
    "poe2/mods-tiers.json": {
      "batch": "poe2/game",
      "sha256": "…",
      "bytes": 915119,
      "schema": 3,
      "fetchedAt": "…"
    }
  }
}
```

- `staleLocales`：本次抓取失敗、沿用上一版的語系。擴充同步時列在 PR 說明裡。
- `schema`：該檔自身的 `schemaVersion`，沒有的檔案省略。
- 只列擴充會用到的檔案就好；atlas、icons 不列入。

### 4.3 建置與發布流程

```text
checkout main ─► 取回目前 gh-pages 內容到 output/（沿用上一版）
              ─► 重建本次目標（game / mercenary / trade）
              ─► 驗證閘門 ─► 產生 manifest.json ─► 部署 gh-pages
```

- **沿用上一版**：先把目前的 gh-pages 內容取回 `output/`。這樣只重建部分目標時，其他檔案不會被部署動作清掉；語系抓取失敗時也有舊檔可用。
- **驗證閘門**（任一項失敗就不部署）：
  - 各批次的一致性規則（第 3 節；`validateGameDataBatch` 從擴充搬來）。
  - JSON 格式與 `schema` 符合預期。
  - **縮水保護**：任一檔案比上一版小超過 30%，判定失敗，除非手動觸發時帶 `allow_shrink: true`。
- **觸發方式**：
  - push 到 main：`build:all`。
  - 每週一 03:00 UTC：`build:trade`（取代擴充現有的每週排程）。
  - 每天：比對 GGG 最新 patch 與 `version.json`，**不同時才**執行 `build:mods`。這樣遊戲改版後新翻譯最慢一天就會發布。
  - 手動觸發：可選擇目標與 `allow_shrink`。
- **CI 衛生**：actions 鎖 commit SHA；改用跑在 Node 24 上的 setup actions；`permissions` 只在部署 job 開 `contents: write`；加上 `concurrency` 避免同時部署。

## 5. 擴充端變更

### 5.1 `pnpm data:sync`

`scripts/sync-game-data.mjs` 擴充為處理全部批次：

```text
pnpm data:sync                       # 遠端：最新 gh-pages commit
pnpm data:sync -- --ref <sha>        # 遠端：指定 commit（重現某次同步）
pnpm data:sync -- --source <dir>     # 本機 poexd-data/output（開發用）
pnpm data:sync -- --batch poe2/game  # 只同步指定批次
pnpm data:sync -- --version poe1     # 只同步指定遊戲版本（保留現有參數）
```

遠端流程：

1. 用 GitHub API 取得 `gh-pages` 目前的 commit SHA（或使用 `--ref`）。
2. 從 `https://raw.githubusercontent.com/yehshune/poexd-data/<sha>/…` 下載 `manifest.json` 與檔案。用 commit SHA 組網址，內容固定不變，不會遇到 jsDelivr 對分支的快取延遲。
3. 驗證：sha256 與大小相符、批次一致性（沿用現有 `validateGameDataBatch`）、`manifestVersion` 是已知版本。
4. 用現有的 `replaceFilesWithRollback` 整批寫入；任一批次失敗，該批次不寫入，並以非零狀態結束。
5. 寫入 `public/json/data-source.json`：`{ ref, sourceCommit, generatedAt }`。檔案只有幾十位元組，可以追溯安裝包裡的資料來自哪一次發布，也是第二階段比對版本的基準。

只同步白名單內的檔案（第 1 節表中那些），manifest 裡其他的檔案一律忽略。

### 5.2 同步 workflow

`data-refresh.yml` 改為每天 06:00 UTC（在 poexd-data 的每日 patch 檢查與每週市集更新之後）執行：

1. `pnpm data:sync`
2. 跑完整的 `pnpm test`（資料測試分散在多個檔案，全跑只多一分鐘左右）。
3. 有變動才開 PR，標題為 `chore(data): sync from poexd-data <short-sha>`。PR 說明列出變動的批次、patch 版本與 `staleLocales`。

### 5.3 移除

切換完成後刪除：`scripts/update-trade-filters.mjs`、`scripts/trade-filter-api.mjs`、`scripts/update-market-translation.mjs`、`scripts/market-translation-api.mjs` 及對應測試；`package.json` 移除 `filters:update`、`market:update`。

### 5.4 文件

- `docs/trade-filter-data.md`、`docs/architecture/market-translation-plan.md`：產生方式改為指向 poexd-data，擴充只描述執行期載入。
- 新增 ADR-0013「poexd-data 是唯一資料產生者」。ADR-0011、0012 補上一行指向它。

## 6. 遷移步驟

每一步都可以單獨 commit。舊腳本到第 4 步才刪除，所以第 4 步之前隨時可以回退。

| 步驟 | Repo       | 內容                                                | 驗收                                                        |
| ---- | ---------- | --------------------------------------------------- | ----------------------------------------------------------- |
| 1    | poexd-data | 搬移腳本與測試、新增 `build:trade`                  | 同一天兩邊各跑一次，`trade-*` 檔案逐位元組相同              |
| 2    | poexd-data | manifest、沿用上一版、驗證閘門、排程、CI 衛生       | gh-pages 出現 `manifest.json`，sha256 與實際檔案相符        |
| 3    | 擴充       | `data:sync` 支援遠端與全部批次、`data-source.json`  | 執行後 `git diff public/json` 只有新增的 `data-source.json` |
| 4    | 擴充       | 切換 `data-refresh.yml`、刪除舊腳本、更新文件與 ADR | 手動觸發 workflow 成功；`pnpm test` 通過                    |

**第 1 步結果（2026-11-13，DONE）**：兩邊先後各跑一次，32 個 `trade-*` 檔案中 31 個逐位元組相同。唯一不同的 `poe1/locales/zh-CN/trade-stats.json` 內容完全相同，只是鍵的順序不同。原因是騰訊的 PoE 1 stats 回應在兩次執行之間更新了：把同一份已存下的 API 回應分別交給新舊函式，輸出完全相同，而且新版的輸出與當下的 API 一致。之後的比對都改用「同一份已存回應」，不再依賴兩次即時抓取。兩邊的 ko 都抓取失敗（本機也連不上 Kakao），沿用既有檔案；擴充目前本來就沒有 ko 的檔案。

**第 2 步結果（2026-11-13，DONE，尚未推送）**：

- 新增 `src/publish/`：批次目錄（`catalog.ts`）、批次建置紀錄（`batches.json`）、`manifest.json`、驗證閘門（`verify`）、patch 比對（`check-patch`）。`validateGameDataBatch` 與 `validateMercenaryBatch` 連同測試從擴充搬入。
- `deploy.yml` 改為第 4.3 節的流程與排程，actions 全部鎖 commit SHA 並改用跑在 Node 24 上的版本。
- `all` 建置時，市集資料失敗只會發出警告並沿用上一版，不會擋住遊戲資料的更新。
- 本機演練（以目前 gh-pages 的內容當作上一版）：`build:trade` → `verify` → `manifest` → `check-patch` 全部通過；ko 被記為 `staleLocales`；patch 未變動時判定不需重建。
- manifest 列出 95 個檔案，與擴充 `public/json/` 的檔案集合完全相同（雙方都沒有多出或缺少的檔案）。其中 89 個 sha256 相同，其餘 6 個是 `trade-stats`，原因是官方資料在擴充上次更新後有變動。所以第 3 步可以直接依 manifest 同步。
- 目前的 gh-pages 還沒有市集資料，`verify` 會回報缺少必要檔案。推送後 push 觸發的是 `all`，會先產生這些檔案，所以第一次部署不受影響。遊戲資料批次的紀錄要等第一次 `all` 部署後才會出現在 manifest。
- 已推送。第一次 CI 建置與部署約 2 分 17 秒；gh-pages（e57e873）的 manifest 列出 95 個檔案與 6 個批次紀錄。直接從 GitHub 下載檔案核對，sha256 與 manifest 一致。在 `core.autocrlf=true` 的 Windows 上用 `git archive` 取出的檔案，換行會被轉成 CRLF，hash 就對不上，所以用戶端一律要透過 HTTP 取得檔案。

**第 3 步結果（2026-11-13，DONE）**：

- `scripts/sync-game-data.mjs` 改寫為 `scripts/sync-data.mjs`（`pnpm data:sync`）。它依 manifest 同步全部 6 個批次，支援 `--ref`、`--source`、`--batch`、`--version`。路徑白名單與 poexd-data 的 `catalog.ts` 一致：manifest 中的批次和白名單對不上，或 sha256、大小無效時，整份 manifest 都拒絕。批次一致性檢查保留在擴充端，作為第二道防線。
- 只在完整同步遠端內容且沒有任何批次失敗時，才寫入 `public/json/data-source.json`。
- 實際同步 gh-pages@e57e873：89 個檔案未變動；6 個 `trade-stats` 只有鍵的順序不同（官方 API 改了回傳順序，內容完全相同）；另外新增 `data-source.json`。符合驗收條件。

**第 4 步結果（2026-11-13，DONE，尚未推送）**：

- `data-refresh.yml` 改為每天執行 `pnpm data:sync` → `pnpm test`，有變動才開 PR（分支 `chore/sync-poexd-data`）。PR 說明附上同步紀錄，裡面列出每個批次的 patch 與 `staleLocales`。
- poexd-data 每次發布都會產生新的 commit。為了不讓「只有 `data-source.json` 變動」的 PR 每天出現，資料沒有變動時不改寫 `data-source.json`。
- 刪除 4 支舊腳本、2 個測試與 `filters:update`、`market:update`。`docs/trade-filter-data.md`、`market-translation-plan.md`、`CONTRIBUTING.md` 與兩處程式註解改為指向 poexd-data。新增 ADR-0013，ADR-0011、0012 補上指向它的一行。
- 驗收中的「手動觸發 workflow 成功」要等推送後才能做。

## 7. 風險

| 風險                                               | 對策                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GitHub 的 CI 機器連不上 Kakao（ko）或騰訊（zh-CN） | 沿用上一版並記錄在 `staleLocales`；擴充現在的每週排程也跑在同樣的機器上，風險沒有增加               |
| 官方 API 回傳殘缺資料，被當成正常發布              | 縮水保護；`en` 必須成功；擴充端還有一道 PR 人工審查                                                 |
| gh-pages 歷史每次增加約 30MB                       | 第一階段只需要「最新」那個 commit；是否改成 single-commit，留到第二階段決定（第二階段會引用舊 SHA） |
| 搬移時悄悄改變輸出                                 | 第 1、3 步都以「逐位元組相同」作為驗收                                                              |
| 官方 API 在兩次抓取之間變動，比對結果失真          | 比對時把同一份已存的 API 回應交給新舊實作，不依賴兩次即時抓取                                       |

## 8. 待決定

1. **觸發方式**：擴充端用每週排程拉取（建議，不需要跨 repo 權杖），還是 poexd-data 部署後用 `repository_dispatch` 通知擴充（較即時，但要在 poexd-data 存一個能寫擴充 repo 的 PAT）。
2. **每天比對 patch 後自動重建 game 資料**：建議開；GGG CDN 解包的建置時間需要實測，確認沒有超出 Actions 的時間限制。
3. **腳本改寫成 TypeScript**：建議改，以符合 poexd-data 慣例；不改的話也可以先原封不動搬 `.mjs`，之後再改寫。
