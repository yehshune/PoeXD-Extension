# Visual Class Reset Contract (shadcn-first Theme Foundation)

> **狀態**：Approved Baseline Contract (Unique Visual SSOT)  
> **核心定位**：以 `shadcn-vue primitives` + `Tailwind Theme infrastructure` 作為 PoeXD 唯一的通用視覺基礎設施。PoeXD 不建立第二套平行通用 Visual Theme System。  
> **重要聲明**：**本規範為純架構合約、職責邊界與遷移規劃，不修改任何生產端程式碼。**

---

## 1. 核心願景與三軸獨立架構 (Core Vision & Three-Axis Architecture)

### 1.1 最終目標：靜態結構，動態主題 (Static Structure, Dynamic Theme)

未來任何視覺主題切換，必須能達到：

```text
Theme A (現代圓潤)
Button = 圓角 (rounded-md) / 無陰影 (shadow-none) / 弱邊框 (border-border: transparent 或低對比色)

Theme B (經典復古)
Button = 方角 (rounded-none) / 深度陰影 (shadow-md) / 明顯外框 (border-border: 具體色)
```

且切換時保證：

- **Business Vue Template 零修改**
- **Business Vue Class 零修改**
- **Primitive API 零修改**
- **Scale Contract 零修改**
- **Density Contract 零修改**

視覺呈現的切換**完全且僅透過** shadcn / Tailwind Theme values（CSS Variables）來改變。

### 1.2 三軸完全獨立 (Theme × Scale × Density)

PoeXD 介面由三個互不越權的維度正交驅動：

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Theme (視覺主題維度)                                       │
│    管轄：色彩 (Colors)、圓角 (Radius)、陰影 (Shadow)、邊框色彩與可見度 │
│    載體：CSS Variables (--background, --primary, --radius...)   │
├─────────────────────────────────────────────────────────────┤
│ 2. Scale (視覺尺寸維度 - 控制項與內部幾何縮放)                    │
│    管轄：控制項高度、字級、圖示、內部 Padding、內部 Gap、            │
│          Sidebar internal/control geometry (導覽列/摺疊按鈕/Header)│
│    計算：Baseline × Scale (由 TS Runtime 注入具體 px)         │
│    禁忌：嚴禁使用 transform: scale() 污染排版與清晰度          │
│    注意：使用者設定之側邊欄面寬 (Sidebar workspace width)       │
│          由獨立 Preferences 管轄 (340/380/420/Custom)，不受 Scale 影響│
├─────────────────────────────────────────────────────────────┤
│ 3. Density (排版緊湊維度 - 保持既有產品能力)                    │
│    管轄：版面間距 (Layout Spacing)、Pane 留白、Section Gap、Row Gap│
│    計算：Base × Density × Scale (僅影響 whitespace)         │
│    禁忌：絕對不得影響顏色、圓角、陰影、邊框外觀、字體、圖標、控制項幾何│
└─────────────────────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Sidebar Width 與 UI Scale 所有權切分（對齊 [size-scale-density-contract.md](./size-scale-density-contract.md)）**：
>
> - **Scale 管轄**：
>   - 控制項高度
>   - 字級
>   - 圖示
>   - 內部 padding / gap
>   - Sidebar internal/control geometry（導覽列寬度 `--pxd-sidebar-nav-width`、收合展開按鈕與容器 `--pxd-sidebar-collapsed-width`、Header 高度 `--pxd-sidebar-header-height`、Dialog 語意幾何）
> - **獨立 Sidebar Width preference 管轄**：
>   - Sidebar workspace width（工作區實際面寬 `--pxd-sidebar-width`）
>   - 340 (small) / 380 (medium) / 420 (large) / Custom 實際 px
>   - 不受 UI Scale 影響（完全解耦，`actual sidebar width = sidebarWidth`）

系統必須無條件支援下列任意矩陣組合，且三者互不干擾、互不修改彼此所有權：

- `Theme A + Scale 85% + Compact`
- `Theme A + Scale 120% + Comfortable`
- `Theme B + Scale 85% + Compact`
- `Theme B + Scale 120% + Comfortable`

---

## 2. 職責所有權矩陣 (Ownership Matrix)

| 屬性分類 (Property)                             | 管轄所有者 (Owner)              | 標準載體 / 範例                                                                           | 業務頁面是否可持有 (Business Vue Page)           |
| :---------------------------------------------- | :------------------------------ | :---------------------------------------------------------------------------------------- | :----------------------------------------------- |
| **Colors (通用色彩)**                           | **Theme**                       | `--background`, `--foreground`, `--primary`, `--border`, `--muted`, `--accent`            | **嚴格禁止**自行覆蓋控制項底色與狀態色           |
| **Radius (形狀圓角)**                           | **Theme**                       | `--radius`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-full`                      | **嚴格禁止**手寫 `rounded-none`, `rounded-[2px]` |
| **Shadow (陰影層次)**                           | **Theme**                       | Tailwind shadow theme values (`shadow-sm`, `shadow-md`, `shadow-lg`)                      | **嚴格禁止**手寫 `shadow-[...]` 或 `shadow-none` |
| **Border Visual (邊框視覺)**                    | **Theme**                       | `border-border` 顏色與視覺能見度 (Visibility)                                             | **嚴格禁止**自訂控制項邊框色彩與通用線條         |
| **Control Size (控制項幾何)**                   | **Scale (UI Foundation)**       | `COMPONENT_SIZE_SPECS` (Height, Font, Icon, Gap, Padding X)                               | **受保護**（透過 `size="sm"` prop 使用）         |
| **Sidebar Control Geometry (側邊欄控制項幾何)** | **Scale (UI Foundation)**       | `--pxd-sidebar-nav-width`, `--pxd-sidebar-collapsed-width`, `--pxd-sidebar-header-height` | **受保護**（隨 Scale 縮放以容納控制項）          |
| **Sidebar Workspace Width (側邊欄工作區寬度)**  | **Preferences (Sidebar Width)** | `--pxd-sidebar-width` (340/380/420/Custom px)                                             | **使用者偏好**（獨立於 UI Scale）                |
| **Layout Spacing (版面間距)**                   | **Density / Scale**             | `--pxd-space-*`, `--pxd-pane-padding`, `--pxd-field-gap`, `--pxd-row-gap`                 | **允許**（管理版面留白節奏）                     |
| **Geometry & Flow (佈局流向)**                  | **Layout**                      | `flex`, `grid`, `w-full`, `min-w-0`, `relative`, `absolute`, `overflow-y-auto`            | **完全開放**（由業務頁面自主排版）               |
| **PoE Domain (遊戲領域語意)**                   | **PoE Domain**                  | `.prefix-color`, `.suffix-color`, `#38b0f8`, `#f59e0b`, 詞綴搜尋高亮                      | **完全開放**（Theme 絕對不得覆蓋）               |

### 2.1 命名空間所有權契約 (Prefix Ownership Contract)

| Namespace     | 範圍與職責邊界                                                                            | 具體項目 / 範例                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 規範與禁忌                                                                                                                                                      |
| :------------ | :---------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`pxd-*`**   | **PoeXD 內部 Shadow UI / UI Foundation presentation namespace**                           | • `--pxd-*` UI runtime / layout / typography / spacing tokens<br>• `.pxd-scrollbar`<br>• PoeXD Shadow UI 內部純視覺 / layout classes（如 `.pxd-sidebar-wrapper`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 僅用於 Shadow DOM 內部視覺與版面基礎設施；不得跨越 ShadowHost boundary 注入宿主頁面 light DOM。                                                                 |
| **`poexd-*`** | **Extension 跨邊界 (Host / Protocol / Bridge / Persistence / ShadowRoot Hook) namespace** | • **Host-page injected selectors (Light DOM)**：`.poexd-tier-trigger`, `.poexd-tier-trigger-slot`, `.poexd-inline-btn`, `.poexd-category-select-btn`, `.poexd-filter-select-btn`, `.poexd-sortable-ghost`, `.poexd-sortable-drag`, `.poexd-filter-mod-highlight`, `.poexd-price-comparison`, `body.poexd-pure-bg`<br>• **ShadowRoot / Injected UI Hooks**：`[data-poexd-toast]` (Toast container hook), `poexd-app-root`, `poexd-portal-root`, `poexd-toast-container`<br>• **Typed CustomEvent protocol**：`poexd-sidebar-width-preview`, `poexd-modal-active-changed`, `poexd-open-affix-modal`, `poexd-trigger-dialog`, `poexd-result-images`, `poexd-update-stat-category`, `source: 'poexd'`<br>• **Window/global bridge**：`poexdAlert`, `poexdConfirm`, `poexdPrompt`, `poexdCustomDialog`, `__poexd_selecting_target__`, `__poexd_sortable__`<br>• **ShadowHost private runtime layout bridge**：`--poexd-host-*`, `poexd-layout-style`, `poexd-sidebar-container`<br>• **Storage / Serialized contracts**：`poexdKnownStats`, `poexdBookmarkCollectionStateV2`, `poexdSearchRecordStateV1`, `poexd-bookmarks`, `poexd-search-records`, `poexd-bm1:`<br>• **Desktop / Extension URL protocol**：`poexd_sync` | 保留完整跨邊界契約名稱；`poexd-*` 不等於全部都是 Host Light DOM；不得與 Shadow UI 內部的 `pxd-*` 混用；不得將 window globals / storage / event 誤改為 `pxd-*`。 |
| **`poe-*`**   | **歷史遺留前綴 / 外部領域專用**                                                           | • `poe1` / `poe2` 等真實 Path of Exile domain / version 名稱                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **不得作為 PoeXD 自己的新 UI namespace**（歷史 legacy class 如 `poe-sidebar-wrapper`, `poe-scrollbar`, `poe-btn`, `poe-input` 等已全面清除廢棄）。              |

### 2.2 PoE Host-integrated Control Shape Exception (宿主整合控制項形狀例外)

直接插入 PoE 官方 panel / row 的 PoeXD controls（`.poexd-tier-trigger`、`.poexd-filter-select-btn`、`.poexd-category-select-btn`，以及 shared base `.poexd-inline-btn`）：

- **Shape 屬於 Host Integration Geometry Exception**：PoE 官方控制項視覺為方角，所有上述 Host-integrated buttons 固定 `border-radius: 0 !important;`。
- **不受 Theme radius 影響**：不 consume `--radius`，即使切換圓角主題，Host-integrated controls 仍維持與 PoE 官方面板協調的固定方角。
- **不受 UI Scale / Density 影響**：按鈕幾何與間距由專屬 Host Spec 定義（`HOST_TIER_TRIGGER_SPEC`, `HOST_FILTER_SELECT_BUTTON_SPEC`, `HOST_CATEGORY_BUTTON_SPEC`，Scale-invariant, Density-invariant）。
- **Theme 仍持有表面色彩**：Theme 仍提供 `background`, `foreground`, `border color`, `hover color`, `focus ring`, `shadow`。
- **邊界保護**：這**不是**一般 Business Vue / Primitive 的例外。PoeXD Shadow UI（含 Tier DropdownMenuContent、Sidebar、Dialogs、Buttons 等）仍完全遵守：
  - Radius = Theme
  - Scale = UI Foundation
  - Density = Layout Spacing

#### 搜尋結果原生融合控制項例外 (Result-Native PoE Controls Exception)

直接嵌入官方搜尋結果列（`.results`）及工具列、刻意模擬 PoE 官方商品卡視覺語言以達成「原生融入」之宿主控件，亦屬於 Host-Native 視覺例外：

1. **Result Mod Quick Filter** (`.poexd-result-mod-host`, `.poexd-result-mod-actions`, `.poexd-result-mod-btn`)
2. **Rune Item Normalizer / Tryout** (`.poexd-total-controls`, `.poexd-icon-btn`, `.poexd-popover`, `.poexd-stat-badges`)

上述控件不進入 `Page Theme Bridge`（不隨 PoeXD 側邊欄主題變色），統一採用固定方角 (`0px`)、`FontinSmallcaps` / `Verdana` 與對齊官方暗黑／深海藍／暗紅／暖金／增強藍語意的 PoE 原生色階，使商品卡片維持官網原生視覺一致性。

#### 宿主整合按鈕幾何規格與 Slot 契約 (Host Buttons Spec SSOT)

1. **Tier Trigger (`HOST_TIER_TRIGGER_SPEC`)**：
   - 寬度 20px、字級 11px、行高 14px、水平 padding 4px、字重 600。
   - Slot (`.poexd-tier-trigger-slot`)：PoE 官方 table-cell + relative 容器 (`width: 20px !important; display: table-cell !important; position: relative !important; vertical-align: middle !important;`)。
   - Trigger (`.poexd-tier-trigger`)：absolute inset stretch (`position: absolute !important; inset: 0 !important; width: auto !important; height: auto !important;`)，外層高度隨 PoE 官方 table-cell rendered height 自適應。
2. **Filter Select Button (`HOST_FILTER_SELECT_BUTTON_SPEC`)**：
   - 正方形尺寸 28px × 28px、圖示 14px，固定方角。
3. **Category Select Button (`HOST_CATEGORY_BUTTON_SPEC`)**：
   - 高度 20px、字級 11px、行高 18px、水平 padding 8px、垂直 padding 2px、外部間距 `margin-left: 8px`，固定方角。

---

## 3. Theme 所有權與禁止平行 API (Theme Ownership)

Theme 唯一使用 shadcn / Tailwind 現有的語意基礎設施：

- **核心色彩**：`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`
- **形狀基線**：`--radius` 及其衍生 Tailwind radius token
- **陰影基線**：Tailwind shadow theme values (`--shadow-sm`, `--shadow`, `--shadow-md`, `--shadow-lg`)

### 嚴格禁令：禁止建立平行 Visual Theme API

嚴禁建立如下以 PoeXD 為前綴的自製平行視覺變數體系：

- ❌ `--pxd-shadow-*`
- ❌ `--pxd-border-*`
- ❌ `--pxd-radius-*`
- ❌ `--pxd-surface-*`

所有通用視覺外觀必須直接對齊 shadcn / Tailwind 標準語意。

### 3.1 語意表面配對原則 (Semantic Surface Pairing Contract)

- **Semantic surface pair**：
  當互動狀態完整切換至 `bg-primary` / `secondary` / `accent` / `destructive` 等 semantic surface 時，文字應使用其對應 `*-foreground`（如 `bg-accent` 必須搭配 `text-accent-foreground`），除非該 consumer 明確採用 translucent surface、不接管文字 ownership。
  - **禁止錯誤配對**：嚴格禁止 `hover:bg-accent hover:text-foreground`（在亮青色 accent 主題如 Catppuccin 下會導致極低對比度）。
  - **複合組件層次**：複合組件（如 `ModItem`、`FilterPane` group-header）在 row 處於 full accent hover 狀態時，子項目（標題、展開箭頭、階級文字等）必須透過 group 同步切換至 `text-accent-foreground`，normal state 則保留原有領域視覺層次。
  - **宿主文字 Ownership**：宿主頁注入 UI 若不接管宿主文字 ownership（如 Result Mod Highlight），應使用半透明主題色（如 `color-mix(in srgb, var(--accent) 20%, transparent)`）而非不透明 accent surface。

---

## 4. 主題執行期所有權 (Theme Runtime Ownership)

本系統之 Theme 執行期狀態完全依循以下合約，絕不建立第二套偏好或主題系統：

- **正式 Theme 定義 (Theme SSOT)**：
  ```text
  ThemeId
  ├─ modern-dark (default / dark)
  ├─ caffeine    (dark)
  └─ catppuccin  (dark)
  ```
- **Theme 架構準則 (Theme Architecture Rules)**：
  - `Theme = semantic values`：主題僅定義與覆寫語意變數（顏色、基本 radius、shadow），不為各主題發明第二套命名。
  - `Business class 保持穩定`：業務組件（如 Sidebar、Panes、ModItem）嚴禁因為第二/第三主題編寫主題特化 class。
  - `Primitive class 保持穩定`：基礎組件（Button、Input、Select、Dialog 等）class 與 API 完全保持通用。
  - `Theme 完全不影響 Scale / Density / Geometry`：UI Scale、Density、各類 Pane 與控制項高度、間距等完全獨立於 Theme。
  - `Page Theme Bridge 跟隨 active Theme`：宿主頁注入 UI 透過 Bridge 自動從 shadowHost 讀取計算後語意數值，無須為各主題建立第二套注入樣式。
- **唯一 DOM Owner**：WXT `ui.shadowHost`（`wrapper`），設定屬性 `data-poexd-theme="modern-dark"`、`data-poexd-theme="caffeine"` 或 `data-poexd-theme="catppuccin"`。絕對不污染 `document.documentElement`、`document.body` 或 PoE 官方網站 DOM。
- **唯一 Theme 屬性**：`data-poexd-theme`。
- **自然繼承架構**：`appRoot` 與 `portalRoot` 不各自持有 theme attribute，完全自 `shadowHost` 自然繼承 CSS 變數。Dialog、DropdownMenu、Tooltip 等 Teleport 到 `portalRoot` 的浮層元件自然繼承相同主題。
- **無 FOUC 時序保證**：在 `ui.mount()` 執行前即透過 `applyThemeToHost` 套用主題，避免初始渲染樣式閃爍。偏好變更時直接更新 host 屬性，不 remount Vue、不重新載入頁面。
- **偏好管理**：共用既有 `PreferencesModule` 與 `PreferencesStorage`。
- **全域偏好範疇**：`theme` 為全域偏好（`GLOBAL_PREFERENCE_NAMES`），儲存 key 固定為 `"theme"`；**嚴格禁止** `"theme_poe1"` 或 `"theme_poe2"`。
- **零多餘系統**：不建立第二套 Preference 或 Theme Runtime 體系。

### 4.1 浮層層疊與 Portal 所有權合約 (Overlay Stacking & Portal Ownership Contract)

為確保擴充功能在 Shadow DOM 下浮層永遠正常顯示，且與宿主 PoE 頁面和平共存，系統建立單一 Stacking Context 與 Portal 所有權契約：

```text
PoE host
└─ shadowHost = 2147483647
   ├─ appRoot = 0
   └─ portalRoot = 1
      ├─ generic floating primitives = z-50
      └─ Dialog semantic stacking:
          base   = z-50
          nested = z-[60]
          system = z-[70]
```

- **層疊所有權 SSOT (Stacking Ownership SSOT)**：
  - `shadowHost` (`z-index: 2147483647`)：PoeXD 相對 PoE 官方 host page 的唯一 page-level top stacking owner（使用 32-bit signed int 最大值，不在 Theme 或 CSS 建立變數）。
  - `appRoot` (`position: relative; z-index: 0;`)：一般 application UI layer，側邊欄本體的一切內部層疊限制在 `appRoot` 內部。
  - `portalRoot` (`position: relative; z-index: 1;`)：所有 portalled overlay layer，確保所有浮層永遠位於 PoeXD application canvas 上方。**Single portalRoot 仍是全系統唯一 SSOT**。
  - `generic floating primitives` (`z-index: 50`)：Tooltip / DropdownMenu / Select / Popover 等一般浮動元件一律維持標準 shadcn `z-50`。
  - `Dialog semantic stacking` (`base = z-50` / `nested = z-[60]` / `system = z-[70]`)：
    - **Primitive-Owned Semantic Layer**：Dialog 因支援嵌套對話框（Nested Modal），由 `DialogContent.vue` primitive 唯一持有 typed prop `layer?: 'base' | 'nested' | 'system'`（預設 `base`），內部將 `DialogOverlay` 與 `DialogContent` 映射至成對相同的 z-index。
    - **業務層邊界**：業務組件（如 `Sidebar.vue`、`FilterPane.vue`）只能宣告語意化 `layer="base" | "nested" | "system"`，嚴格禁止手寫任何數字型 z-index（如 `z-50`、`z-[60]`、`z-[70]`、overlay class z-index 或 arbitrary number）。
    - **非 Theme / Scale / Density 變數**：Dialog stacking 屬於 Overlay infrastructure semantic，非 Theme 色彩或尺寸合約，嚴格禁止建立 CSS 變數（如 `--pxd-z-dialog-*`）。
    - **DOM Order 不是 Visual Priority SSOT**：經實測證明，Vue 3 `<Teleport>` 錨點依組件初始 mount 順序鎖定（深層插槽 FilterPane 比父層 Sidebar 的 Shared Dialog 更晚 mount，實際 DOM 順序為 `Affix → Shared → Type`），且 `:unmount-on-hide="false"` 無法重排錨點。因此視覺優先級（`Shared > Type > Affix`）必須由 semantic layer 承擔，不得以 DOM order 作為 SSOT。
  - **單一 Portal Target SSOT**：DropdownMenu / Select / Tooltip / Popover / Dialog 一律透過根節點 `<ConfigProvider :teleport-to="portalTarget">` 使用同一 `portalRoot`，業務組件不應自行 query DOM 或指定 portal target。不得建立 `systemPortalRoot` 或第二個 portal。
  - **Generic Floating Positioning SSOT**：Generic floating positioning 完全由 Reka primitive / Popper (Floating UI) 負責；業務層組件或 composable（如 `BookmarkPane`、`useBookmarkPreview`）嚴禁自行計算 Tooltip/Dropdown/Select/Popover 的 viewport geometry（如手寫 `getBoundingClientRect()`、`window.innerHeight`、`position: fixed` 等），碰撞（collision）、翻轉（flip）與位移（shift）完全交給 Reka 處理。
  - **禁止業務層手寫巨大 Z-index**：業務組件嚴格禁止手寫超大 z-index（如 `z-[10000000]` 或 inline `zIndex: '100000'`）；所有浮層一律透過 Primitive 統一持有合約規定之層級。
  - **浮層通用外觀與 Theme 對齊**：所有浮層容器外觀（如 Bookmark Preview）統一由 `TooltipContent` 等 Foundation primitive 提供 Theme-derived token（`var(--shadow-md)`、`var(--radius)`、`var(--muted)`、`var(--border)`）；業務層僅負責內部內容排版，且在無 typed domain semantic 支撐下，Preview metadata 一律全面使用 Theme semantic（`var(--foreground)`、`var(--muted-foreground)`、`var(--secondary)`、`var(--border)` 等）。
  - **Theme 自然繼承**：不複製 Theme attribute 至 `portalRoot`，浮層自然繼承 `shadowHost` 的 Theme CSS 變數。

- **WXT ShadowHost Cascade 與 Host Layout Bridge (Critical)**：
  - **WXT Reset 覆蓋**：WXT `createShadowRootUi()` 預設注入 `:host { all: initial !important }`，一般 outer inline style declarations（如 `wrapper.style.position` 或 `wrapper.style.zIndex`）會被其 important 宣告壓過，導致 host computed style 降為 `position: static; z-index: auto`。
  - **Shadow Tree `:host` 唯一持有 Layout Contract**：因此 ShadowHost actual layout properties 必須在 Shadow tree `:host` contract 中明確以 `!important` 重建：
    ```css
    :host {
      display: block !important;
      position: fixed !important;
      overflow: visible !important;
      z-index: 2147483647 !important;
      top: var(--poexd-host-top, 0px) !important;
      left: var(--poexd-host-left, auto) !important;
      right: var(--poexd-host-right, auto) !important;
      width: var(--poexd-host-width, 380px) !important;
      height: var(--poexd-host-height, 100vh) !important;
    }
    ```
  - **Runtime Dynamic Geometry 透過 Custom Properties 橋接**：CSS `all: initial` 不會重設 custom properties，因此動態幾何（expanded / collapsed / left / right / modal active）改由 private CSS variables 傳遞（`--poexd-host-width`, `--poexd-host-height`, `--poexd-host-top`, `--poexd-host-left`, `--poexd-host-right`），嚴禁依賴普通 inline declarations。這些變數僅為 ShadowHost runtime layout bridge，不是 Theme token，不加入 `lib/tokens`。

- **嵌入式擴充功能浮層控制政策 (Embedded Floating-Control Policy)**：
  - **DropdownMenu**：`modal = false`（允許點擊宿主頁面與側邊欄其他區域）。
  - **Select**：Primitive 預設收斂為 `bodyLock = false` 與 `disableOutsidePointerEvents = false`，不鎖死宿主頁面捲軸與指標事件；保留 consumer 顯式覆寫能力。
  - **Dialog**：保持標準 `modal` 語意（具備標準遮罩與焦點管理）。
  - **無自製平行 API**：以上均為 Primitive 與 Overlay Foundation 契約，絕不建立新的 PoeXD 自製 overlay API。

### 4.2 宿主頁面注入元件主題合約 (Host-page Injected UI Theme Contract)

PoeXD 有少數 UI 直接注入 PoE 官方 document DOM，無法透過 Shadow DOM 自然繼承 Theme。

這些 UI：

- **必須透過 `Page Theme Bridge` 取得同一組 shadcn semantic CSS variables**：由 `lib/theme/page-theme-bridge.ts` 讀取 ShadowHost computed style，並以 scoped selectors 注入同名 CSS 變數，Theme 切換時動態同步。
- **不得建立第二套 palette**：通用視覺呈現（background, foreground, border, radius, shadow, accent, primary, destructive）一律直接使用 shadcn 語意變數，嚴格禁止硬編碼顏色或自訂色彩字典。
- **generic presentation 仍屬 Theme ownership**：外觀樣式直接對齊主題系統。
- **host-page placement / geometry / stacking 屬 integration concern**：注入宿主頁面的定位（`position: fixed`、`getBoundingClientRect()` 錨定等）與 host-page stacking（如 `zIndex = '999999'`）屬於官方網頁 DOM 整合邊界，不等同 Shadow DOM 內部 `portalRoot` 的 Dialog semantic stacking contract。
- **絕非第二個 Theme system**：Page Theme Bridge 僅是向官方宿主 DOM 投影 ShadowHost 主題變數的唯讀橋樑，宿主注入 UI 本身也是純粹的 Theme 消費者。
- **嚴禁輸出 Scale / Density tokens**：Page Theme Bridge 僅向 Light DOM 投影色彩、陰影與邊框可見度等 Theme 語意變數，絕不得輸出 `--control-height-*`、`--control-font-*` 或 `--pxd-space-*`（維持 Host-integrated buttons 之 Scale/Density Invariant 契約）。
- **純 DOM Enhancement 與獨立例外**：純標記或背景裝飾（如 `body.poexd-pure-bg` 獨立色值 `#060607`、`.content` 佈局讓位）以及 §2.2 所列 **Result-Native PoE Controls**（`.poexd-result-mod-btn`、符文覆寫試算 `.poexd-total-controls` / `.poexd-stat-badges`）為原生融入例外，不透過 Theme Bridge 處理。

**目前 Page Theme Bridge Consumers 清單 (Light DOM)**：

1. **Tier controls** (`.poexd-tier-trigger`, `.poexd-inline-btn`)
2. **Category / Filter controls** (`.poexd-category-select-btn`, `.poexd-filter-select-btn`)
3. **Sortable drag feedback** (`.poexd-sortable-ghost`, `.poexd-sortable-drag`)
4. **Result mod highlight** (`.poexd-filter-mod-highlight`)
5. **Price comparison** (`.poexd-price-comparison`)

> [!NOTE]
>
> - **Tier Dropdown**：已移入現有 Shadow UI 唯一 `portalRoot`（`TierDropdownHost.vue`），自然繼承 Theme，不在此 Bridge 範圍內。
> - **Global Toast Host (`[data-poexd-toast]`)**：位於獨立 ShadowRoot（`poexd-toast-container`），透過 `applyThemeToHost` 繼承主題，不在此 Light DOM Bridge 範圍內。
> - **`.poexd-theme-bridge`**：確認無任何 runtime producer / consumer，已自 Bridge 移除。

---

## 5. Primitive 是固定 Theme Consumer (Fixed Theme Consumer)

`components/ui/*` 是穩定的 Theme 消費者，應**固定使用標準 shadcn / Tailwind semantic classes**：

- `Button`: 固定使用 `bg-primary text-primary-foreground border border-border rounded-md shadow-sm` 等標準 class。
- `Input`: 固定使用 `border border-input bg-background rounded-md` 等標準 class。
- `Dialog`: 固定使用 `bg-background border border-border rounded-lg shadow-lg`。
- `DropdownMenu` / `Tooltip` / `Popover`: 固定使用 `bg-popover border border-border rounded-md shadow-md`。

### 核心原則：追求 Class 穩定，而非無 Class

- **錯誤目標**：追求 Primitive 內部「完全沒有 visual class」。
- **正確目標**：**Primitive 內部的 visual class 保持穩定，由 Theme 切換背後的 values**。
  - 例如 `rounded-md` 在 Theme A 下解析為 `0.375rem`，在 Theme B 下解析為 `0rem`（方角）。
  - 例如 `shadow-sm` 在 Theme A 下解析為 `none`，在 Theme B 下解析為 `0 2px 4px rgba(...)`。
  - 元件結構與 class 永久固定，外觀隨 Theme values 自由切換。

---

## 6. 業務頁面職責與邊界 (Business Vue Page Boundaries)

### 6.1 業務頁面允許持有的能力

- **版面與幾何**：`flex`, `grid`, `relative`, `absolute`, `w-full`, `min-w-0`, `overflow-y-auto`。
- **排版間距**：`gap-[var(--pxd-space-md)]`, `p-[var(--pxd-pane-padding)]`。
- **業務幾何避讓**：`pr-7`（搜尋框清除鈕避讓）、`pl-8`、更名輸入框固定寬度 `w-[120px]`。
- **內容層級之 shadcn 語意工具**：業務頁面可直接在**內容文字與容器**使用 shadcn 語意工具（如 `text-foreground`, `text-muted-foreground`, `bg-card`）以維護內容的語意階層。
- **PoE 領域專用語意**：完整持有遊戲領域色彩與標籤。

### 6.2 嚴格禁止：業務頁面不得重新設計 Primitive

業務頁面**嚴格禁止**在 Primitive 標籤上追加覆蓋通用視覺外觀：

```vue
<!-- ❌ 嚴格禁止：業務層覆蓋 Primitive 外觀 -->
<Input
  class="bg-surface-sunken border-border rounded-none shadow-none focus-visible:border-highlight"
/>
<Button class="bg-secondary border-border hover:border-highlight rounded-none shadow-none" />

<!-- ✅ 正確做法：直接使用 Primitive 契約與 variant -->
<Input size="sm" placeholder="搜尋詞綴關鍵字..." class="w-full pr-7" />
<Button variant="secondary" size="sm" class="shrink-0" />
```

---

## 7. 全面移除 PoeXD Generic Visual Layer

過去為了像素級相容歷史介面而建立的龐大 Layer 2 微 Token 體系**全部不預設保留，全數列為遷移與刪除候選項目 (Deletion Candidates)**：

- **表面色系**：`--surface-sunken`, `--surface-canvas`, `--surface-panel`, `--surface-overlay`, `--surface-subtle`, `--surface-interactive`, `--surface-focus`, `--surface-hover`, `--surface-selected`, `--surface-group-header`, `--surface-column-header`, `--surface-row-hover`, `--surface-tier-selected`, `--surface-interactive-subtle`
- **過度細分的邊框與文字**：`--border-strong`, `--border-subtle`, `--foreground-secondary`, `--foreground-faint*`, `--foreground-disabled`
- **特定功能專用 Token**：`--surface-picker`, `--border-picker`, `--highlight-picker`, `--surface-preview`, `--border-preview`, `--foreground-preview*`
- **衍生狀態色**：`--destructive-*` 衍生微 Token、`--success-*` 衍生微 Token
- **品牌強調色別名**：`--pxd-gold`, `--highlight`（評估回歸 shadcn `primary` / `accent` 或精簡全域單一 Accent）

**處置原則**：凡能以 shadcn semantic vocabulary（`background`, `card`, `popover`, `muted`, `accent`, `primary`, `secondary`, `border`, `input`, `ring`）表達者，一律回歸 shadcn；不得為了歷史舊畫面的特定色碼而保留專屬 Token。

---

## 8. PoE 領域獨立例外 (PoE Domain — Immutable Data Semantics)

> **領域色彩判定規則**：PoE domain color 必須有明確資料/契約語意作為依據；Business presentation 不得僅依 class 名稱、文字內容或視覺偏好推測 domain semantic。沒有 typed domain semantic 的 Preview metadata 一律使用 Theme semantic。

真正 PoE domain exception 必須有資料語意且顏色本身承載產品資訊：

- **Affinity 類別**：Affinity 名稱為 PoE domain data（文字標籤由資料層提供）；但 FilterPane 左側 anchor（`.anchor-btn-inline`）之 presentation visual 完全為 Theme-owned（由 Theme 的 `primary`、`accent` 與 `muted-foreground` 決定，不使用 raw PoE color rules）。
- **搜尋文字高亮**：`<mark class="mod-search-highlight">` 為 generic UI interaction state，其 highlight presentation 亦為 Theme-owned（使用 `color-mix(var(--primary))` 與 `var(--foreground)`），不再宣告為 immutable gold exception。
- （註：Bookmark Preview 數值因目前資料契約未提供 typed rarity/category 等 metadata，一律使用 Theme semantic；未來若資料層提供明確 typed semantic 時才依領域語意引入 domain color）。

---

## 9. 圓角、陰影與邊框收斂規範 (Shape, Shadow & Border Convergence)

### 9.1 圓角與形狀 (Shape / Radius)

- **尺寸合約解耦**：自 `ComponentSizeSpec` 與 `COMPONENT_SIZE_SPECS` 中徹底移除 `borderRadiusClass`。尺寸合約不得決定形狀。
- **Primitive 穩定語意圓角**：
  - Controls (`Button`, `Input`, `SelectTrigger`, `Toggle`, `ToggleGroupItem`): `rounded-md`
  - Checkbox: `rounded-sm`
  - Radio / Loading Spinner: `rounded-full` (功能性合法特例)
  - Overlays & Dialogs (`DialogContent`, `DialogScrollContent`): `rounded-lg`
  - Popovers & Menus (`DropdownMenuContent`, `TooltipContent`, `SelectContent`): `rounded-md`
- 實際像素由 Theme 的 `--radius` 與 Tailwind 衍生變數決定。

### 9.2 陰影 (Shadow)

- Primitive 固定宣告語意層級（`shadow-sm`, `shadow-md`, `shadow-lg`）。
- 具體陰影數值由 Tailwind Theme 決定（可於方角/扁平主題中宣告 `shadow-sm: none`）。
- 業務頁面嚴格禁止手寫 `shadow-[...]` 或 `shadow-none`。

### 9.3 邊框 (Border)

- Primitive 固定保留 `border border-border`。
- **邊框主題能力邊界**：目前 Foundation 僅保證 Theme values（CSS 變數）可控制 **Border color 與視覺能見度 (Visibility)**：
  - Theme A 可令 `border-border: transparent` 或低對比色，呈現無框/弱框視覺；
  - Theme B 可賦予 `border-border` 具體清晰色彩，呈現明顯外框。
- **邊框寬度與樣式**：不承諾只改 Theme values 即可動態切換 1px → 2px/3px 或 solid → dashed/dotted。若未來產品確有動態控制邊框寬度或樣式需求，再另案使用 Tailwind 通用基礎設施，絕不修改 Business Vue class。
- **嚴格禁止**：目前不得預先建立 `--pxd-border-*` 平行變數或 `--button-border`、`--input-border` 等元件專屬變數。

---

## 10. 禁止建立薄視覺包裝 (Anti Thin Visual Wrapper Rule)

嚴禁建立以下僅為包裹一組 shadcn classes 的無實質語意薄元件：

- ❌ `PxdSurface`
- ❌ `PxdPanel`
- ❌ `PxdThemeBox`
- ❌ `PxdVisualContainer`

只有在真正同時共享**結構骨架 (Structure)**、**互動行為 (Behavior)** 與**業務領域語意 (Business Semantics)** 時（例如既有之 `SidebarPane`），才允許建立共用元件。

---

## 11. 後續遷移分刀計畫 (Revised Migration Slices)

將 Phase 2 遷移重整為五個乾淨俐落的執行階段，移除固定的 Shared Visual Component phase：

```text
Phase 2A: 移除 Size / Foundation 中的 Visual ownership
  - 移除 ComponentSizeSpec.borderRadiusClass 介面定義
  - 移除 COMPONENT_SIZE_SPECS 各尺寸中的 borderRadiusClass: 'rounded-none'
  - getComponentSizeClasses() 不再輸出 radius class
  - 驗收：相關 Foundation regression tests、pnpm test、pnpm compile、pnpm build

Phase 2B: components/ui/* 回歸 shadcn visual baseline
  - 各 Primitive 補上標準語意圓角 (rounded-md, rounded-lg, rounded-sm)
  - 移除 Primitive 內部對 Layer 2 歷史 Token 的依賴 (如 Checkbox 的 bg-surface-sunken)
  - 確保 Variant 具備完整的預設外觀與狀態樣式
  - 驗收：Primitive 測試綠燈、UI 元件狀態展示正常

Phase 2C: Business Vue 移除 legacy / custom visual overrides
  - 盤點並清理 BookmarkPane, FilterPane, HistoryPane, SettingsPane, ModItem, Sidebar
  - 移除所有在 Primitive 標籤上的 bg-surface-*, border-*, rounded-none, shadow-none 覆蓋
  - 改用標準 Primitive variant，保留 PoE Domain 與業務幾何避讓
  - 驗收：全量業務功能測試通過，業務頁面 class 大幅精簡

Phase 2D: 刪除不再使用的 PoeXD generic visual tokens / legacy CSS
  - 自 assets/main.css 刪除 Category C 之歷史微 Token (surface-*, border-strong 等)
  - 重新整理為純粹的 shadcn / Tailwind theme tokens
  - 驗收：測試套件綠燈，CSS 體積極小化

Phase 2E: Repo-wide residual audit + runtime regression
  - 全專案反向掃描，驗證通用視覺所有權徹底離開 business pages
  - 確認合法特例 (Radio rounded-full, PoE Domain 色彩等) 未被誤刪
  - 執行全量 Runtime / E2E 回歸測試
  - 驗收：達成最終架構驗收標準
```

---

## 12. 最終架構驗收標準 (Final Architecture Gate)

全部遷移完成後，必須通過以下終極檢驗：

> **只修改 Theme values (CSS 變數)**  
> 　　↓  
> **即可自由改變全系統之：**
>
> - Color (背景、文字、元件底色)
> - Radius / Shape (方角 vs 圓角)
> - Shadow / Elevation (無陰影 vs 深度陰影)
> - Border color / visibility (有框色 vs 視覺透明)
> - Generic visual states (hover, focus, active, disabled)
>
> **且在切換過程中絕對不需要修改任何：**
>
> 1. Business Vue template
> 2. Business Vue class
> 3. Primitive API
> 4. Scale contract
> 5. Density contract

---

## 13. 測試策略 (Testing Strategy)

測試僅保護高價值之執行期行為與架構防線，堅決拒絕過度測試：

- **高價值保護項目**：
  - Scale runtime 計算行為（px 隨 scale 等比放大，無 calc arithmetic）
  - Density runtime 行為（僅影響 whitespace 與 layout spacing）
  - Scale 與 Density 獨立性驗證
  - Theme host 屬性注入與 Shadow Root / Portal 自然繼承
  - Primitive 核心互動行為
  - 主要業務流程（Bookmark, Filter, Settings, History）
- **禁止新增之低價值測試**：
  - ❌ 禁止為每個 class、token、radius、shadow、selector 建立靜態測試
  - ❌ 禁止維護龐大的 source string allow/deny list
