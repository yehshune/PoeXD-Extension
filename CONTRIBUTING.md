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
- 架構性決策請參考 `CONTEXT.md` 與 `docs/adr/`，必要時新增 ADR。

## Commit 訊息 / Commit messages

使用 [Conventional Commits](https://www.conventionalcommits.org/)：
`feat:`、`fix:`、`refactor:`、`docs:`、`test:`、`chore:`、`perf:`、`ci:`。
Release notes 會依這些前綴自動分類。

## 遊戲資料 / Game data

`public/json/` 的物品與詞綴資料由 [poexd-data](https://github.com/yehshune/poexd-data) 產生，
一般貢獻不需要動到它。交易篩選標籤可用 `pnpm filters:update` 從官方 API 更新。

## E2E 測試

`pnpm e2e` 需要一個已通過 Cloudflare 驗證、並登入官方交易網站的瀏覽器設定檔
（先執行 `pnpm dev` 手動登入一次），因此只在本機執行，CI 不會跑。
