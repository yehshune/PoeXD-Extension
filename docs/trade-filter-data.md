# 市集篩選翻譯資料

`public/json/{poe1,poe2}/locales/<locale>/trade-filters.json` 由官方市集 API（`/data/filters` 與 `/data/stats`）產生，內容即玩家在該語言市集頁看到的文字，以官方為準、不做人工校正。

## 更新

產生器在 [poexd-data](https://github.com/yehshune/poexd-data)（`src/trade/`）：每週一排程重抓、驗證後發布到 gh-pages。擴充端只同步發布結果，不直接連官方 API（ADR-0013）：

```powershell
pnpm data:sync                                   # 同步全部批次
pnpm data:sync -- --batch poe2/trade-filters     # 只同步一個批次
```

`.github/workflows/data-refresh.yml` 每天執行同步，有變動時開 PR。

poexd-data 依序請求各語言官方市集網域的 `/api/trade/data/{filters,stats}`（POE1）與 `/api/trade2/data/{filters,stats}`（POE2）：

| 語系                        | 網域                                |
| --------------------------- | ----------------------------------- |
| en                          | www.pathofexile.com                 |
| zh-TW                       | pathofexile.tw                      |
| zh-CN                       | poe.game.qq.com（騰訊國服）         |
| ja / ru / de / fr / es / th | {jp,ru,de,fr,es,th}.pathofexile.com |
| pt                          | br.pathofexile.com                  |
| ko                          | poe.game.daum.net（Kakao）          |

- `en` 一定會抓取：它是執行期的最終後備，也用來偵測其他網域是否誤回傳英文；`en` 失敗時整批不發布。
- 其他語系失敗（例如 Kakao 連不上）時沿用上一版檔案，並記在 `batches.json` 的 `staleLocales`；同步 PR 會列出這些語系，執行期退回 UI 語系或 en。
- 同步時逐檔比對 manifest 的 sha256 並檢查批次一致性，任一檔不符就跳過整個批次；寫入失敗會回復已替換的檔案。

## 檔案格式

```json
{
  "schemaVersion": 3,
  "gameVersion": "poe1",
  "locale": "zh-TW",
  "source": "pathofexile.tw",
  "groups": { "req_filters": "物品需求" },
  "fields": { "ar": "護甲" },
  "options": { "sale_type": { "priced": "直購價或定價" } },
  "pseudoStats": { "pseudo.pseudo_total_life": "+# 總最大生命" }
}
```

- 所有 key 都是 API 的穩定 id，各語系獨立，不需要索引對齊。
- API 的欄位提示（`tip`）不會併入標籤。
- `pseudoStats` 只收 stats API 的 `pseudo` 類別：詞綴字典（`stats.json`）由實際詞綴產生，沒有偽屬性。完整 stats 清單每個語系超過 1MB，所以不整份打包；其他類別缺字時，執行期會先用同一個 `stat_N` 在字典裡的其他類別（例如 `rune.`）補上翻譯。
- `id: null` 的預設選項一般不會出現在查詢 JSON 中而被略過；唯一例外是 `sale_type` 的預設值對應查詢值 `priced`，且只在 API 沒有明確 `priced` 選項時才套用（騰訊 POE1 的 null 代表「任何」）。
- 官方各語系都未翻譯的文字（例如 POE1 的 `map_filters`「Map/Chart Filters」）會保留英文。

## 執行期載入

`utils/trade-filters-store.ts` 依目前**顯示語系**選擇篩選翻譯：

1. 顯示語系 → UI 語系 → en，逐一查找。
2. UI 語系（en、zh-TW、zh-CN）隨程式打包，同步可用；其他語系在第一次需要時才載入，完成後觸發重新渲染。
3. 檔案不存在的語系（例如尚未產生的 ko）只請求一次，之後直接退回。

## 市集漢化資料

市集漢化（ADR-0012）把國際服英文市集頁顯示成繁中或簡中，另有一組只給 `zh-TW`、`zh-CN` 的分片，同樣由 poexd-data 產生（`market` 批次），以 `pnpm data:sync -- --batch market` 同步：

| 檔案                                                       | 來源                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `public/json/locales/<locale>/trade-ui.json`               | 官方介面字典 `webtw.poecdn.com/js/translate.zh_TW.js`、`poecdn.game.qq.com/js/translate.zh_CN.js` |
| `public/json/<version>/locales/<locale>/trade-stats.json`  | 該服的 `/data/stats`；國際服另寫一份 `en`                                                         |
| `public/json/<version>/locales/<locale>/trade-static.json` | 該服的 `/data/static`                                                                             |

- 國際服（en）的 stats 也寫出 `en/trade-stats.json`，static 只用來篩選與驗證；中文分片只保留國際服存在的條目。
- `trade-stats.json` 也是擴充端「市集寫法」的來源（`utils/official-stat-text.ts`）：詞綴選擇器的單一詞綴標籤與市集篩選列的詞綴，優先用該語系市集的文字，正負向因此跟市集一致；中文市集回傳的仍是英文時視為沒有翻譯，改用 poexd-data 的 `statTemplates`。
- 介面字典只當資料解析（`__['鍵'] = '值';`），不執行；出現無法辨識的行就整份拒絕。官方未翻譯（值等於鍵）的條目略過。
- stats 的同一個 id 可能出現多次且文字不同，這時依 API 出現順序存成陣列，出現次數與國際服不同就略過該 id；static 的 id 跨群組會重複，所以依群組分層。
- 國服網域從海外連線時好時壞：介面字典會改試 `poe.game.qq.com`，stats / static 失敗時沿用上一版檔案。
- 欄位格式與涵蓋率見 `docs/architecture/market-translation-plan.md`。
