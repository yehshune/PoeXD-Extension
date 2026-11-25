# 主控台音效通知（Console Sound Notification）實作計畫

> **文件狀態**：IN PROGRESS (2026-11-17)
> **決策依據**：[ADR-0016](../adr/0016-console-sound-notification-owned-by-poexd.md)（proposed，實機驗證通過後改為 accepted）
> **範圍**：主控台自己決定何時播放，播放官方頁面上的 `<audio>` 元素，並可直接於主控台設定頁讀寫官網音量（0–100）與音效（內建 4 款＋自訂音檔上傳），即時同步 `<audio>.src`；另有主控台專用的開關、300 ms 合併、被瀏覽器擋下時的提示。每條連線各自的音效、桌面通知、標題未讀數、favicon badge 不在範圍內。

---

## 背景

官方線上搜尋在 WebSocket `onmessage` 收到結果時呼叫根元件的 `notify(count)` → `doWoop()` 播放音效。主控台自己持有 WebSocket，合成的顯示容器是 `live: false`，所以這條路徑從來不會執行，主控台沒有任何音效（2026-11-17 以 CDP 實測，細節見 ADR-0016）。

## 官網耦合點（2026-11-17 實測）

| 耦合點                   | 實測內容                                                                                                                                      | 失效時                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 官方 `<audio>` 元素      | 頁面上唯一的 `<audio preload="auto">`，`src` 為使用者選的音效（預設 `https://web.poecdn.com/audio/trade/pulse.mp3`，自訂為 `data:audio/...`） | 記錄一次錯誤，不播放           |
| lscache 音量             | `localStorage['lscache-tradewoop']`（PoE 2 為 `lscache-trade2woop`），JSON `{ file, volume, custom, name }`                                   | 鍵不存在或格式不符：音量 50    |
| 自動播放（背景開啟分頁） | 未互動過的分頁 `play()` 拋 `NotAllowedError`，`navigator.userActivation.hasBeenActive === false`                                              | 顯示「點一下主控台以啟用音效」 |

騰訊服（`poe.game.qq.com`）需要登入，`<audio>` 元素與 lscache 鍵待補測。

---

## 實作

1. **Preference**：`liveSearchSoundEnabled: boolean`，分遊戲版本，預設 `true`（`utils/preferences-contract.ts`、`utils/preferences.ts` 的布林清單）。
2. **Runtime 訊號**：`LiveSearchPrimaryRuntimeOptions.onResultTokenAccepted?: (event: { ownerKey: string }) => void`，在 `handleReceivedToken()` 通過 dedup、推入佇列之後呼叫，以 try/catch 隔離。
3. **`LiveSearchSoundNotifier`**（`entrypoints/content/logic/live-search-sound-notifier.ts`）：
   - 可注入 `isEnabled`、`findAudio`、`readStorage`、`scheduler`、`userActivation`、`addActivationListener`。
   - `notify()`：300 ms 內只播一次。播放時找官方 `<audio>`，從 lscache 讀音量（只接受 0–100 整數，否則 50；0 不播），`pause()`、`currentTime = 0`、設定 `volume` 後 `play()`。
   - `NotAllowedError` → 狀態 `blocked` 並通知訂閱者；之後第一次 `pointerdown` / `keydown` 或 `hasBeenActive` 變成 true 時回到 `ready`。不補播。
   - 找不到 `<audio>` 或其他錯誤只記錄錯誤名稱，同一種錯誤只記一次。
   - `preview()` 給設定頁試聽用，跳過合併；`dispose()` 清掉計時器與監聽器。
4. **接線**：`entrypoints/content/logic/runtime.ts` 在主控台角色建立 notifier，teardown 時釋放；透過 Sidebar 既有的主控台物件傳到 UI。
5. **UI**：`LiveSearchConsoleSettingsPane.vue` 提供「通知音效」開關、官方音效選擇（含自訂音檔上傳）、官方音量滑桿與試聽按鈕，直接同步官方網站設定並即時生效；被擋下時在主控台顯示提示。所有顯示語系補齊 i18n。
6. **測試**：`tests/live-search-sound-notifier.test.ts`（合併、開關、音量解析與偽造值、音量 0、被擋與解除、找不到元素、dispose）、runtime 訊號測試、Preferences 測試、i18n 測試。

## 實機驗證

在 `pnpm dev` 的 Chrome 以 CDP 驗證，結果寫回本文件：

1. 前景主控台：有結果時播放一次，多條連線同時命中只播一次。
2. 背景開啟的主控台：出現被擋提示，點一下後消失，下一筆結果有聲音。
3. 在一般 Trade 分頁把官方音量改成 30% 後，主控台下一次播放就用 30%。
4. 台服 PoE 1 / PoE 2、Firefox 的自動播放行為。

### 實機驗證結果（2026-11-17，`pnpm dev` 的 Chrome 以 CDP 實測，國際服 PoE 1）

| 項目                        | 結果                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 主控台上的官方 `<audio>`    | Result-Only Presentation 只設 `display: none`，元素仍在，`src` 為 `https://web.poecdn.com/audio/trade/pulse.mp3`                                       |
| 跟隨官方音量                | lscache 音量設為 30 後試聽，`<audio>.volume` 為 0.3 並觸發 `play`                                                                                      |
| 背景開啟（`active: false`） | `hasBeenActive === false`；試聽回 `blocked`，設定頁顯示「瀏覽器擋下了音效」，連線頁顯示被擋提示                                                        |
| 解除                        | 以真實滑鼠點擊提示後，提示消失並播放一次。原本用 `click` 觸發試聽會落空（`pointerdown` 時解除監聽就讓提示消失），已改為 `pointerdown` / Enter / 空白鍵 |
| 重新載入主控台              | 重新載入後 `hasBeenActive` 仍為 true（同一分頁已互動過），不會被擋                                                                                     |
| 真實結果觸發                | 未實測（需要有實際命中的連線）；由 `tests/live-search-primary-runtime.test.ts` 的訊號測試與 notifier 單元測試涵蓋                                      |

台服、騰訊服與 Firefox 未測。

## 下一步（另行規劃）

- 每條連線各自的音效或靜音：播放來源改成自己的 `Audio`，觸發與合併沿用；存放位置要另外決定（Resume Plan 存的是啟用意圖，不是呈現方式）。
- 評估 offscreen document（`AUDIO_PLAYBACK`）避開背景開啟時的自動播放限制。
- 桌面通知、標題未讀數、favicon badge。
