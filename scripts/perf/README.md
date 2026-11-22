# 效能量測腳本

在真實 Chrome 上量測官方交易頁載入時，擴充功能對首屏的影響。適合修改前後做 A/B 比對。

| 腳本                     | 用途                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `load-timing.mjs`        | 重複載入搜尋頁，量測結果列、篩選區、側邊欄出現時間的中位數，並偵測英文閃現、版面位移、console 錯誤 |
| `cpu-profile.mjs`        | 錄製一次重新載入的 CPU profile 與網路時序（`.cpuprofile` 可直接拖進 DevTools Performance）         |
| `cpu-profile-report.mjs` | 把 profile 依腳本與 content script 函式歸因                                                        |

## 前置條件

- Chrome 以 `--remote-debugging-port=9222` 啟動，並登入 pathofexile.com。
- 要比較的 build 先建好：`pnpm build` 產出 `.output/chrome-mv3`。比對舊版時可用 `git worktree add` 另建一份再 build。

## 注意

- **會打官方搜尋 API**：每輪載入都是一次真的搜尋。量測期間關掉其他交易分頁，也不要同時跑 `pnpm dev` 熱重載交易頁，否則容易被限流（預設每輪間隔 12 秒就是為此）。
- **用的是你真實的 Chrome profile**：腳本只開自己的分頁並在結束時關閉；`--ext` 會以 unpacked 方式載入指定 build，取代同 id 的現有版本，量完記得換回平常用的 build。
- 搜尋網址請自己準備，聯盟結束後舊網址會失效。

## 範例

```sh
# 首屏計時：4 倍 CPU 節流、5 輪，比較兩個 build
node scripts/perf/load-timing.mjs --url "<交易搜尋網址>" --throttle 4 --ext ../poexd-base/.output/chrome-mv3 --label base
node scripts/perf/load-timing.mjs --url "<交易搜尋網址>" --throttle 4 --ext .output/chrome-mv3 --label head

# CPU 歸因：導航後 3 秒內的時間花在哪
node scripts/perf/cpu-profile.mjs --url "<交易搜尋網址>" --out .perf/head --ext .output/chrome-mv3
node scripts/perf/cpu-profile-report.mjs .perf/head --window 3000
```

`load-timing.mjs` 最後一行 `SUMMARY {...}` 是彙整結果；`flags` 非空代表出現英文閃現或版面位移。所有時間都是相對於導航開始的毫秒數。

輸出建議放 `.perf/`（已列入 `.gitignore`）。
