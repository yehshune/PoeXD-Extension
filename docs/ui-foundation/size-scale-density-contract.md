# PoeXD UI 系統尺寸契約：Scale、Density 與 Component Size (Foundation Convergence)

本文檔為 PoeXD 擴充套件 Vue UI 的統一尺寸契約與基礎設施規範。
未來所有 PoeXD Vue 元件、版面與控制項皆必須遵循本契約。

---

### 核心設計概念與四大結構體系

PoeXD 的尺寸架構由**四大明確劃分、職責互不混淆**的層級組成：

```text
┌─────────────────────────────────────────────────────────────┐
│ 核心計算模型                                                  │
│ Final Component Geometry = Component Baseline × UI Scale    │
│ Density = only layout spacing                               │
└─────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│ 1. Control Profile (標準控制項體系)                            │
│    Single Source of Truth: COMPONENT_SIZE_SPECS 驅動         │
│    Button, Input, SelectTrigger, Toggle, ToggleGroupItem    │
│    Trigger & Action behavior (重用 Control Profile):         │
│      - Generic Trigger → sm button contract                 │
│      - DialogClose → sm icon-button contract                │
│    Baseline 高度: sm 28px / default 32px / lg 40px          │
├─────────────────────────────────────────────────────────────┤
│ 2. Form Indicator Profile (表單核取/單選指示器體系)            │
│    Single Source of Truth: FORM_INDICATOR_SPECS 驅動         │
│    Checkbox, RadioGroupItem (原子原語，無 size prop)         │
│    Baseline: Root 18px / Checkbox Indicator 12px / Radio 8px│
├─────────────────────────────────────────────────────────────┤
│ 3. Collection Profile (選單與列表集合項目體系)                  │
│    Single Source of Truth: COLLECTION_ITEM_SPECS 驅動        │
│    SelectItem, DropdownMenuItem, Checkbox/Radio Items,      │
│    SubTrigger, SelectScrollUp/DownButton                    │
│    Baseline 彈性下限: min-height sm 28px / default 32px     │
│    Scale-aware Indicator Reserve (sm 28px / default 32px)   │
├─────────────────────────────────────────────────────────────┤
│ 4. Layout Spacing (版面與容器留白排版體系)                     │
│    唯一受 UI Density 影響的維度 (`base × density × scale`)   │
│    Generic Spacings (4/6/8/12/16/24px)                      │
│    Semantic Layout Spacings (Pane 15px, Field 15px, etc.)   │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. UI Scale (視覺尺寸倍率)

### 契約定義

- **定義**：代表整個 PoeXD UI 的視覺放大/縮小倍率。
- **基準**：`default = 1.0`（以一般標準網頁 UI 的 100% 為基準）。
- **型別分離 (Preset vs Factor)**：
  ```ts
  type UiScalePreset = 'sm' | 'default' | 'lg';
  type UiScaleFactor = number; // 0.85, 1.0, 1.2, 或自訂數值
  ```
- **實作技術與 Runtime 流程**：
  ```text
  Preferences (fontSizeScale, densityScale)
         │
         ▼
  lib/tokens/ui-contract.ts (createUiRuntimeTokenValues / syncUiRuntimeTokens)
         │ (TypeScript Runtime 集中計算最終 px，完全移除 CSS calc(length * number) typed arithmetic)
         ▼
  wrapper.style / Sidebar.vue:style 注入具體數值
  --pxd-ui-scale: 1.2
  --pxd-ui-density: 0.8
  --control-height-default: 38.4px
  --control-font-default: 15.6px
  --control-icon-default: 19.2px
  --pxd-space-lg: 11.52px
  --pxd-pane-padding: 14.4px
         │
         ▼
  Button / Input / SelectTrigger / Layout 取得直接可用的具體尺寸，零跨瀏覽器計算風險
  ```
- **Scale-Aware 控制項尺寸矩陣**：
  - **高度**：sm = 28px (`--control-height-sm`), default = 32px (`--control-height-default`), lg = 40px (`--control-height-lg`)。
  - **控制項字級**：sm = 12px (`--control-font-sm`), **default = 13px** (`--control-font-default`), lg = 14px (`--control-font-lg`)。
  - **圖標**：sm = 14px (`--control-icon-sm`), default = 16px (`--control-icon-default`), lg = 20px (`--control-icon-lg`)。
  - **內部間距**：sm = 6px (`--control-gap-sm`), default = 8px (`--control-gap-default`), lg = 10px (`--control-gap-lg`)。
  - **按鈕水平留白**：sm = 12px (`--button-padding-x-sm`), default = 16px (`--button-padding-x-default`), lg = 24px (`--button-padding-x-lg`)。
  - **輸入水平留白**：sm = 8px (`--input-padding-x-sm`), default = 10px (`--input-padding-x-default`), lg = 12px (`--input-padding-x-lg`)。

### 1.1 Semantic Typography Contract (語意排版契約)

- **設計原則**：不隨意為每個 legacy 像素新增 token，而是收斂為語意角色，100% Scale 基準如下：
  - **micro** = 10px (`--pxd-font-micro`，微型標籤、統計數字)
  - **caption** = 11px (`--pxd-font-caption`，表單次要標籤、說明文字、選單項目)
  - **secondary** = 12px (`--pxd-font-secondary`，次要內文、小按鈕文字)
  - **body** = 13px (`--pxd-font-body`，一般內文文字)
  - **control** = 13px (`--pxd-font-control`，主要輸入框、預設按鈕文字)
  - **section-title** = 14px (`--pxd-font-section-title`，區塊標題、大控制項文字)
  - **heading** = 16px (`--pxd-font-heading`，主要面板標題)
- **Scale 行為**：`final px = baseline * scale`，由 TS Runtime 集中計算，零 CSS arithmetic。
- **Legacy 小數字級規則 (10.5px / 11.5px)**：不建立專屬 token，後續 migration 依語意 normalize 到 secondary (12px) 或 body/control (13px)。
- **9px 的處理**：不納入正式全域 scale；優先提升至 micro (10px)，極端情況視為 feature-specific exception。

---

## 2. UI Density (排版緊湊度)

### 契約定義

- **定義**：在不縮小文字與互動圖標的前提下，調整介面的**空間利用率與留白緊湊程度**。
- **正式職責邊界**：
  - **Density 可以影響**：pane padding, field gap, section gap, row gap, list spacing, toolbar spacing。
  - **Density 嚴禁影響**：font size, icon size, control height, border width, focus ring, sidebar width, overlay geometry。
- **型別分離 (Preset vs Factor)**：
  ```ts
  type UiDensityPreset = 'compact' | 'default' | 'comfortable';
  type UiDensityFactor = number; // 0.8, 1.0, 1.2
  ```
- **Generic Spacing Scale (TS 計算公式：`base * density * scale`，注入具體 px)**：
  - `--pxd-space-xs`: 基準 4px
  - `--pxd-space-sm`: 基準 6px
  - `--pxd-space-md`: 基準 8px
  - `--pxd-space-lg`: 基準 12px
  - `--pxd-space-xl`: 基準 16px
  - `--pxd-space-2xl`: 基準 24px
- **Semantic Layout Spacing (Generic spacing != Semantic layout spacing)**：
  - **原則**：通用間距（4/6/8/12/16/24px）提供標準幾何階梯；但語意版面保留真實 UX baseline（15px），絕不為了硬湊通用 scale 而改變 100% 預設外觀。
  - **語意留白基準 (15px)**：
    - `--pxd-pane-padding`: 基準 15px (一般容器四周留白)
    - `--pxd-field-gap`: 基準 15px
    - `--pxd-section-gap`: 基準 15px
    - `--pxd-row-gap`: 基準 8px (對齊 space-md)
  - **計算表現 (Scale 1.0, Density 1.0 = 15px; Compact 0.8 = 12px; Scale 1.2 = 18px; Scale 1.2 + Compact = 14.4px)**。
  - **Bookmark 樹狀清單語意留白契約 (Single SSOT in `ui-contract.ts`)**：
    - **Single Source of Truth**：所有 Bookmark 語意間距由 `lib/tokens/ui-contract.ts` 的 TS Runtime 集中派生，元件（`BookmarkPane.vue`、`BookmarkFolderNode.vue`）僅作為純消費者，**嚴格禁止在 scoped CSS 重複定義**以避免雙重 ownership。
    - **Default Baseline 保障 (density >= 1.0)**：100% 保持原有視覺 baseline，不因 Compact 收斂產生任何退化：
      - `--pxd-bookmark-folder-header-padding-y`: 12px (`--pxd-space-lg` baseline)
      - `--pxd-bookmark-row-padding-y`: 6px (`--pxd-space-sm` baseline)
      - `--pxd-bookmark-folder-body-padding-y`: 6px (`--pxd-space-sm` baseline)
      - `--pxd-bookmark-tree-gap`: 8px (`--pxd-row-gap` / `--pxd-space-md` baseline)
    - **Compact Mode 局部階梯收斂 (density < 1.0)**：在不縮小文字、封面 (28px)、圖標與控制項的前提下，有感提升資訊密度：
      - `--pxd-bookmark-folder-header-padding-y`: 6.4px (收緊一級對齊 space-md 規模，水平保留 space-lg 維護層次)
      - `--pxd-bookmark-row-padding-y`: 3.2px (收緊對齊 space-xs 規模，單列高度從 38.6px 降至 35.4px)
      - `--pxd-bookmark-folder-body-padding-y`: 3.2px (收緊對齊 space-xs 規模，左側層級縮排保留 space-lg)
      - `--pxd-bookmark-tree-gap`: 4.8px (收緊對齊 space-sm 規模，由 `resolveFolderRowGap` 優先解析)
    - **Comfortable Mode 契約 (density > 1.0)**：依 Default baseline 隨 density 等比放大（14.4px, 7.2px, 7.2px, 9.6px），不被意外破壞。

### 2.1 Scroll End Breathing Room / Content End Space (捲動底端閱讀留白契約)

- **核心差異 (Pane Padding vs Scroll End Space)**：
  - **Pane Padding (`--pxd-pane-padding`)**：一般容器四周的標準排版留白（基準 15px），受 UI Scale 與 UI Density 共同縮放 (`base * density * scale`)。
  - **Scroll End Space (`--pxd-pane-scroll-end-space`)**：專門用於主要滾動容器底部最後一筆內容後方的「閱讀呼吸空間（reading breathing room）」（基準 **72px**），確保滾動到最底部時內容不會緊貼視窗或被底緣遮擋。
- **計算契約 (Scale-aware, Density-invariant)**：
  - **UI Scale**：等比例縮放 (`final px = 72px * scale`，100% = 72px, 85% = 61.2px, 120% = 86.4px)。
  - **UI Density**：**嚴禁受 Density 影響**（Density-invariant），即使切換至 Compact 0.8，此閱讀空間仍保持 `72px * scale`，避免底端過度擁擠。
  - **無 DOM Spacer**：禁止新增空的 `<div>` spacer 元件，一律透過實際 scroll owner 的 `pb-[var(--pxd-pane-scroll-end-space)]` 達成。
  - **禁止使用 scroll-padding-bottom**：scroll-padding 僅影響 snap/捲動對齊，無法提供真實內容排版留白。
- **Scroll Ownership 涵蓋路徑**：
  1. **History (Internal Scroll)**：由 `SidebarPane` 的 internal scroll-content (`data-slot="sidebar-pane-scroll-content"`) 統一提供 `pb-[var(--pxd-pane-scroll-end-space)]`，使所有 internal scroll 頁面自動繼承。
  2. **Bookmark (External Scroll)**：Bookmark 使用 `scroll-mode="external"`，真正的 scroll viewport/content owner 為內部的 `.bookmark-accordion-list`，由其直接套用 `pb-[var(--pxd-pane-scroll-end-space)]`。
  3. **Settings / Tools (Outer Scroll)**：Settings 與 Tools 未使用 `SidebarPane`，實際 scroll owner 為 `Sidebar.vue` 的 `data-sidebar-outer-scroll` `ScrollAreaRoot` / `ScrollAreaViewport`，直接由該 outer viewport 套用 `pb-[var(--pxd-pane-scroll-end-space)]`；`.content-body` 自身作為 bounded flex container（`overflow-hidden`），不再作為 scroll owner。當切換至 `usesPaneScroll` 頁面時，outer scroll 隱藏且 `content-body` 保持 `p-0`，保證絕無 parent + child double bottom spacing。
  4. **LiveSearch Primary & Console Settings**：`LiveSearchPrimaryPane` 內部由 `[data-test="search-connections-list"]` ScrollArea 擁有捲動與 breathing room；`LiveSearchConsoleSettingsPane` 則由其根節點自身 `ScrollAreaViewport` 擁有捲動與 breathing room。

### 2.2 Scrollbar Foundation & Overlay Contract (滾動條覆蓋契約)

- **核心幾何契約 (Scrollbar 不參與內容 layout geometry)**：
  - **無 Scrollbar Gutter**：全面移除已遷移主視窗對 `scrollbar-gutter: stable` 的依賴，解決未 overflow 時永久保留右側留白壓縮內容可用寬度的問題。
  - **幾何不變性**：無論有無 overflow／滾動條是否出現，viewport width 與 content width 恆等，padding 不變，滾動條出現／消失絕不造成內容 layout shift 或 reflow。
  - **Overlay 最右側定位**：當需要滾動條時，滾動條直接以 absolute 方式覆蓋於 viewport 最右側邊緣。
- **技術架構 (Reka UI / shadcn-vue `ScrollArea`)**：
  - 採用 `components/ui/scroll-area`（由 Reka UI 的 `ScrollAreaRoot`、`ScrollAreaViewport`、`ScrollBar` / `ScrollAreaScrollbar`、`ScrollAreaThumb` 組成）。
  - 維持原生滾動機制（native wheel / keyboard / touch scrolling），禁止以 JS 模擬滾動。
  - 原生瀏覽器滾動條透過 `[data-reka-scroll-area-viewport]` CSS 進行 Cross-browser 隱藏（`scrollbar-width: none; ::-webkit-scrollbar: none;`）。
- **視覺規格 (Visual Tokens)**：
  - **尺寸**：垂直滾動條固定 4px（`w-[4px]`），Density-invariant 與 Scale-invariant，嚴禁隨 Density 改變抓取寬度。
  - **色彩**：軌道透明（`bg-transparent`），滑塊使用 Theme 語意 token `bg-border`，懸停使用 `hover:bg-muted-foreground`，圓角使用 Theme-owned `rounded-[var(--radius)]`（不受 Scale / Density 干擾）。
- **ScrollArea Foundation 遷移範圍**：
  1. `SidebarPane` internal scroll viewport (`ScrollAreaRoot` + `ScrollAreaViewport data-slot="sidebar-pane-scroll"`)
  2. Normal 模式下的 `ToolsPane` / `SettingsPane`（由 `Sidebar.vue` 外層 `data-sidebar-outer-scroll` 的 `ScrollAreaRoot` 統一擁有 scrolling）
  3. `LiveSearchConsoleSettingsPane`（元件根節點直接擁有 `ScrollAreaRoot` + `ScrollAreaViewport`，作為 `.content-body` 直屬 bounded-height 子節點）
  4. `BookmarkPane`（`.bookmark-accordion-list` 獨立作為 `ScrollAreaViewport`）
  5. `LiveSearchPrimaryPane`（`[data-test="search-connections-list"]` 獨立作為 `ScrollAreaViewport`）
  6. Shared Dialog 的 scroll body (`data-sidebar-dialog-body`)
- **保留 Native `.pxd-scrollbar` 的對象（嚴格限定，其餘嚴禁使用）**：
  目前僅允許以下元件保留原生 styled `.pxd-scrollbar`（與 production code 完全一致）：
  1. `components/injected/TierDropdownHost.vue`：注入於宿主交易頁面的詞綴層級下拉清單容器。
  2. `components/sidebar/FilterPane.vue`：內部滾動區（`modal-nav-anchors-inline` 類別導覽、`mods-scroll-container` 詞綴與 category/type 篩選清單、`selected-mods-list` 已選清單、selection list）。
  3. `components/sidebar/BookmarkPane.vue` 內的浮層集合（`DropdownMenuSubContent` 聯盟/資料夾選單、`cover-image-grid` 封面圖示選擇網格）。
  4. `components/sidebar/search-preview/TradeSearchPreviewTooltip.vue`：Bookmark / History 共用的 Trade Search Preview 懸停浮層（依 Reka available-height 自適應高度並支援 hoverable 完整預覽滾動）。

---

## 3. Component Profiles (Single Source of Truth)

PoeXD 控制項分為三大元件 Profile，加上 Layout Spacing 組成四大體系：

### 3.1 Control Profile (標準控制項體系)

- **Single Source of Truth**：`COMPONENT_SIZE_SPECS` 與 `getComponentSizeClasses(size, kind)`。
- **體系組成**：
  - **標準控制項**：`Button`、`Input`、`SelectTrigger`、`Toggle`、`ToggleGroupItem`。
  - **Trigger & Action 行為**：Trigger 與 Action 本身不另設獨立尺寸系統，而是全面重用 Control Profile 的標準按鈕與圖標按鈕合約：
    - Generic Trigger (`DialogTrigger`, `DropdownMenuTrigger`, `TooltipTrigger`) → `sm button contract`
    - Explicit Action (`DialogClose`) → `sm icon-button contract`
- **支援類型**：
  - `kind = 'button'`: 高度、按鈕留白、字級、圖標、內部間距。
  - `kind = 'input' | 'select'`: 高度、輸入留白、字級。
  - `kind = 'icon-button'`: 正方形尺寸（如 `size-[var(--control-height-default)]`），`p-0`，圖標尺寸隨 size 動態對齊。

| Size Variant | 高度 (Height Var)          | 基準高度 | 圖標尺寸 (SVG)    | 內部間距 (Gap)   | 字級 (Font)                         |
| :----------- | :------------------------- | :------- | :---------------- | :--------------- | :---------------------------------- |
| `sm`         | `--control-height-sm`      | **28px** | `size-3.5` (14px) | `gap-1.5` (6px)  | **12px** (`--control-font-sm`)      |
| `default`    | `--control-height-default` | **32px** | `size-4` (16px)   | `gap-2` (8px)    | **13px** (`--control-font-default`) |
| `lg`         | `--control-height-lg`      | **40px** | `size-5` (20px)   | `gap-2.5` (10px) | **14px** (`--control-font-lg`)      |

> [!IMPORTANT]
> **Component Size / Scale 職責與形狀解耦規範**：
> Component Size 與 UI Scale **只管理幾何尺寸**：高度 (height)、字級 (font size)、圖標尺寸 (icon size)、內部間距 (internal gap)、留白 (padding) 及相關幾何。
> **嚴格禁止管理**：色彩 (color)、圓角形狀 (radius / shape)、陰影 (shadow)、邊框視覺外觀 (border appearance) 與通用視覺狀態 (generic visual states)。
> 控制項圓角與形狀完全由 Theme 與 shadcn Primitive 自主管理，規格詳見 [visual-class-reset-contract.md](./visual-class-reset-contract.md)。

#### 3.1.1 Trigger & Action Behavior Contract (觸發與動作行為合約)

- **Single Source of Truth**：重用 `COMPONENT_SIZE_SPECS` 與 `getComponentSizeClasses()`，不建立獨立尺寸系統。
- **核心 asChild Contract**：
  - **`asChild=true`**：完全委派給子元素，Primitive 本體**零注入**任何幾何、尺寸、間距或背景樣式，Child 擁有完整幾何控制權。
  - **`asChild=false`**：Primitive 自己提供完整、可直接使用的標準互動合約與可見鍵盤焦點（`focus-visible:ring-1 focus-visible:ring-ring`，嚴禁使用裸 `outline-none`）。
- **規格區分**：
  - **Generic Triggers** (`DialogTrigger`, `DropdownMenuTrigger`, `TooltipTrigger`)：
    使用標準 **`sm button contract`** (`getComponentSizeClasses('sm', 'button')`)：
    - `height`: 28px × UI Scale
    - `font`: 12px × UI Scale
    - `icon`: 14px × UI Scale
    - `gap`: 6px × UI Scale
    - `button padding`: 12px × UI Scale
    - 無 28px floor clamp，隨 Scale 線性縮放。
  - **Explicit Icon Action** (`DialogClose`)：
    使用標準 **`sm icon-button contract`** (`getComponentSizeClasses('sm', 'icon-button')`)：
    - `size`: 28px × UI Scale
    - `icon`: 14px × UI Scale
    - `padding`: 0
    - 保持專屬關閉動作幾何，不混為通用按鈕。

### 3.2 Form Indicator Profile (表單核取/單選指示器體系)

- **Single Source of Truth**：`FORM_INDICATOR_SPECS`。
- **設計原則**：單層 18px 實體 Root，無 `size` prop，幾何直接遵從 `Baseline × Scale`，無 floor clamp。
- **Checkbox**：Root 18px (`--checkbox-size`), Indicator 12px (`--checkbox-indicator-size`)。
- **RadioGroupItem**：Root 18px (`--radio-size`), Indicator 8px (`--radio-indicator-size`)。

### 3.3 Collection Profile (選單與列表集合項目體系)

- **Single Source of Truth**：基礎尺寸幾何由 `COMPONENT_SIZE_SPECS` 與 `getComponentSizeClasses(size, 'collection-item')` 統一提供；Collection 專屬指示器規格（`indicatorReserve`, `indicatorLeft`, `radioDot`）由 `COLLECTION_ITEM_SPECS` 集中管理，兩套規格無重複欄位。
- **設計原則**：使用 `min-height`（非 fixed height），預設 `size="sm"`（對齊既有視覺）。
- **支援類型**：`SelectItem`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuSubTrigger`, `SelectScrollUp/DownButton`。
- **規格矩陣**：
  - `sm` (預設): `min-height 28px` (`--control-height-sm`), `font 12px`, `icon 14px`, `gap 6px`, `paddingX 10px`, `indicator reserve 28px` (`--collection-indicator-reserve-sm`)。
  - `default`: `min-height 32px` (`--control-height-default`), `font 13px`, `icon 16px`, `gap 8px`, `paddingX 12px`, `indicator reserve 32px` (`--collection-indicator-reserve-default`)。
- **Indicator Reserve 規範**：
  - Indicator reserve 屬於各集合項目自身 local responsibility，由 Scale-aware token (`COLLECTION_ITEM_SPECS[size].indicatorReserveClass`) 提供。
  - Indicator Reserve 不會覆蓋 min-height、font、icon、right padding。
  - Indicator icon / dot 尺寸必須隨 Scale 等比縮放，Density 嚴禁影響 indicator geometry。
- **SelectScrollUp/DownButton 規範**：
  - Full width，sm collection/action baseline，`min-height 28px × Scale`，`icon 14px × Scale`。無 `py-1`，無 `h-4/w-4`，無 hidden hit target。
- **Dropdown Viewport Safety, Scale Geometry & Shrink Contract (浮層幾何、寬度安全與收縮契約)**：
  - **四大核心幾何分工契約**：
    - `Dropdown positioning geometry = Scale invariant`（浮層定位、碰撞偏移、z-index、portal 隔離不受 UI Scale / Density 影響）。
    - `Dropdown visual geometry = Scale-aware / Density-invariant`（選單容器 minimum width `--pxd-menu-min-width`、preferred submenu width `--pxd-menu-sub-width`、preferred max-height `--pxd-menu-max-height`、Cover Picker `--pxd-cover-picker-item-size` / `--pxd-cover-picker-width` 由 UI Scale 等比縮放，Density 不影響）。
    - `Dropdown item geometry = Collection Profile`（項目高度、文字字級、圖標尺寸、Padding、Gap 統一由 `COMPONENT_SIZE_SPECS` 與 `COLLECTION_ITEM_SPECS` 之 sm collection-item profile 驅動）。
    - `Viewport available-width safety = Reka ownership`（浮層安全邊界永遠由 Reka Floating UI 計算的 `--reka-dropdown-menu-content-available-width` 決定）。
  - **Minimum Width 安全約束與 Available-Width 防護**：
    - `DropdownMenuContent` 與 `DropdownMenuSubContent` 統一配置：
      - `min-w-[min(var(--pxd-menu-min-width,128px),var(--reka-dropdown-menu-content-available-width,calc(100vw-32px)))]`
      - `max-w-[var(--reka-dropdown-menu-content-available-width,calc(100vw-32px))]`
      - `max-h-[min(var(--pxd-menu-max-height,240px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))]`
    - 徹底根絕 CSS 中 `min-width > max-width` 導致 min-width 突破視窗可用寬度的破版漏洞，保證 `actual width <= Reka available width`。
    - 嚴禁業務層以 JS 計算位置、`window.innerWidth` 或 `getBoundingClientRect()` 手動計算浮層幾何。
  - **Shrink Capability 屬於 Primitive Ownership，Truncation 屬於 Business Ownership**：
    - 集合項目 Primitives（`DropdownMenuItem`、`DropdownMenuSubTrigger`、`DropdownMenuCheckboxItem`、`DropdownMenuRadioItem`）統一配置 `min-w-0` 與 `[&_svg]:shrink-0`，提供收縮能力並防止圖標受壓變形。
    - Primitive **嚴禁自動 truncate arbitrary slots**（避免破壞 icon+label、shortcut、indicator、cover image 等複合排版）。
    - 業務層針對動態 runtime 來源之長文字（如 `folder.name`、`league.text`）自主宣告 `<span class="min-w-0 flex-1 truncate" :title="text">{{ text }}</span>`，保留完整 domain data，僅約束 presentation。

### 3.4 Floating Overlay & Inspect Popover Profile (浮層與彈窗面板幾何體系)

- **核心幾何分工契約**：
  - **Overlay Positioning Invariant**：浮層定位、碰撞偏移 (`side-offset`、`collision-padding`)、圖層等級 (`z-index`)、Portal 傳送策略為 **Scale-invariant 與 Density-invariant**，定位偏移與邊界不受 UI Scale / Density 干擾。
  - **Overlay Visual Geometry (Scale-aware / Density-invariant)**：浮層面寬與最大高度由 UI Scale 等比縮放 (`baseline * scale`)，由 TS Runtime 集中輸出具體 px；Density 嚴禁縮放面板幾何：
    - `--pxd-overlay-inspect-width`: 基準 300px (Resume Inspect Popover 面寬)
    - `--pxd-overlay-inspect-max-height`: 基準 220px (Inspect 內部列表最大高度)
    - `--pxd-search-preview-width`: 基準 380px (Trade Search Preview 浮層面寬，等同側欄基準寬)
    - `--pxd-mercenary-build-width`: 基準 300px (傭兵技能選擇器的 Build 下拉寬)
    - `--pxd-temporary-search-dialog-width`: 基準 420px (Temporary Search 對話框面寬)
    - `--pxd-temporary-search-dialog-max-height`: 520px (Temporary Search 對話框最大高度)
  - **Tooltip & Popover Primitive Padding Ownership**：
    - `TooltipContent` 預設字級由語意排版契約 (`--pxd-font-secondary`) 驅動，預設內距由語意間距契約 (`--pxd-space-lg` 12px, `--pxd-space-sm` 6px) 驅動，隨 Scale 等比縮放且留白依 Density 收斂。
    - `PopoverContent` 預設內距由 Primitive 提供 Scale/Density 驅動之 `--pxd-space-lg` (12px baseline)，Consumer 專注於業務排版，嚴禁在 Consumer 上重複宣告手寫 `p-3` 形成雙重 ownership。

---

## 4. Layout Tokens & Sidebar Scale Contract

### 側邊欄面寬與 UI Scale 解耦 (Workspace Width Decoupled from Scale)

User-configurable Sidebar workspace width is independent of UI Scale.

在已有 340 / 380 / 420 / Custom width preference 後，實際工作區寬度由使用者設定直接決定，不得再乘 `fontSizeScale`。

- **使用者設定面寬** (`--pxd-sidebar-width`)：
  - small = 340px
  - medium = 380px (預設標準寬度)
  - large = 420px
  - custom = 僅由 sidebar resize 拖曳調整的實際 px
  - 渲染寬度維持不變：例如 `sidebarWidth = 380`，在 Scale 85% 為 380px、Scale 100% 為 380px、Scale 120% 為 380px。
- **Page Layout 一致性**：
  `sidebar-layout.ts` 中 wrapper 的寬度與 page content margin 統一使用使用者設定寬度 `sidebarWidth`，不再計算 `effectiveWidth`。
- **Custom Resize 拖曳換算**：
  拖曳 resize 的 visual width 直接就是 Preferences `sidebarWidth`，不再透過 `visualWidth / scale` 反向換算。
- **Sidebar Internal/Control Geometry 依然保持 Scale-aware**：
  面寬解耦不影響側邊欄內部元件的正常 Scale 行為。以下項目仍隨 UI Scale 等比縮放：
  - Sidebar navigation buttons (`icon-lg` control geometry)
  - Sidebar navigation rail width (`--pxd-sidebar-nav-width`)
  - Collapsed expand control 與 collapsed container width (`--pxd-sidebar-collapsed-width`)
  - Sidebar header height (`--pxd-sidebar-header-height`)
  - Dialog / modal semantic layout geometry (`--pxd-sidebar-shared-dialog-width`, `--pxd-sidebar-shared-dialog-max-height`, header height)
  - 控制項內部 padding、gap、字級、圖標與留白

---

## 5. 尺寸影響權限分類矩陣

| 尺寸類別 / 維度項目                                                            |       允許受 Scale 影響？       | 允許受 Density 影響？ | 契約說明與保護理由                                                                                                                                                               |
| :----------------------------------------------------------------------------- | :-----------------------------: | :-------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Control 基準高度** (sm/default/lg)                                           |     是 (直接依 Scale 縮放)      |    ❌ **嚴格禁止**    | 高度由 Baseline × Scale 驅動，不做 floor clamp；Density 嚴禁改變高度                                                                                                             |
| **Control 內部留白** (Padding X)                                               |               是                |    ❌ **嚴格禁止**    | Component internal geometry 僅由 Component Size × Scale 決定，Density 不得改變按鈕/輸入留白                                                                                      |
| **Control 內部間距** (Internal Gap)                                            |               是                |    ❌ **嚴格禁止**    | 控制項內部圖標與文字間距由 Component Size × Scale 決定，Density 不得干涉                                                                                                         |
| **字體大小 (Font Size)**                                                       |               是                |    ❌ **嚴格禁止**    | 防止文字因緊湊排版縮小到低於可辨識極限 (Readability)                                                                                                                             |
| **圖標幾何尺寸 (SVG size)**                                                    |               是                |    ❌ **嚴格禁止**    | 圖標隨元件規格或 Scale 放大縮小，Density 嚴禁縮放圖標                                                                                                                            |
| **Form Indicator 基準尺寸** (Checkbox/Radio)                                   |     是 (直接依 Scale 縮放)      |    ❌ **嚴格禁止**    | 幾何由 18px Baseline × Scale 驅動，不做 floor clamp；Density 嚴禁改變尺寸                                                                                                        |
| **Collection Item 基準尺寸** (sm/default)                                      |     是 (直接依 Scale 縮放)      |    ❌ **嚴格禁止**    | 幾何由 min-height (sm 28/default 32) × Scale 驅動，內部 padding/gap/indicator 隨 Scale 縮放，Density 嚴禁改變                                                                    |
| **Trigger / Action 基準幾何** (Generic sm button / DialogClose sm icon-button) |     是 (直接依 Scale 縮放)      |    ❌ **嚴格禁止**    | asChild=false 遵從 Control Profile 規格 (28px × Scale，無 floor clamp)；asChild=true 零注入完全委派；Density 嚴禁改變                                                            |
| **Layout 留白間距** (Pane/Field/Section/Row/List/Toolbar)                      |               是                |          是           | 真正由 Density 管理的排版留白，計算公式為 `base * density * scale`                                                                                                               |
| **邊框寬度 (Border Width)**                                                    |              ❌ 否              |    ❌ **嚴格禁止**    | 1px 邊框必須保持實體 1px，避免 Subpixel 渲染失真或消失                                                                                                                           |
| **焦點環 (Focus Ring)**                                                        |              ❌ 否              |    ❌ **嚴格禁止**    | 鍵盤導航可存取性 (a11y) 指示環必須清晰可見                                                                                                                                       |
| **滾動條可操作尺寸**                                                           |              ❌ 否              |    ❌ **嚴格禁止**    | Native/Custom scrollbar 必須維持足夠 thumb 抓取寬度 (4px)                                                                                                                        |
| **Sidebar 內部控制項幾何 (Sidebar internal/control geometry)**                 |     是 (直接依 Scale 縮放)      |    ❌ **嚴格禁止**    | 包含導覽列寬度、摺疊按鈕、Header 高度、按鈕圖標等，隨 Scale 縮放以容納控制項；Density 嚴禁改變幾何                                                                               |
| **Sidebar 面寬工作區 (User-configurable Sidebar workspace width)**             |     ❌ 否 (獨立於 UI Scale)     |    ❌ **嚴格禁止**    | User-configurable Sidebar workspace width is independent of UI Scale。寬度由使用者偏好設定 (340/380/420/Custom px) 直接決定；Density 嚴禁壓縮側邊欄面寬                          |
| **Overlay / Modal 實體定位與圖層 (Positioning Invariant)**                     |              ❌ 否              |    ❌ **嚴格禁止**    | 螢幕固定座標、Portal 傳送策略、Popover/Dialog 浮動定位策略、z-index 屬性與 fixed/absolute 語意，不受 Scale 與 Density 影響                                                       |
| **Dialog / Modal 視覺幾何 (Visual Geometry)**                                  | 是 (依需求由 Layout Token 驅動) |    ❌ **嚴格禁止**    | 彈窗面寬 (width)、最大寬度、內容留白 (padding) 與排版字級，未來可依 UI Scale 與 Semantic Layout Token 處理；Density 嚴禁縮放                                                     |
| **圓角形狀 (Radius / Shape)**                                                  |              ❌ 否              |    ❌ **嚴格禁止**    | 形狀屬於 Theme / Primitive 管轄，Scale 與 Density 嚴禁干涉；詳見 [visual-class-reset-contract.md](./visual-class-reset-contract.md)                                              |
| **通用視覺外觀 (Color / Shadow / Border Visual)**                              |              ❌ 否              |    ❌ **嚴格禁止**    | 視覺外觀屬於 Theme 管轄，Scale 與 Density 嚴禁干涉；詳見 [visual-class-reset-contract.md](./visual-class-reset-contract.md)                                                      |
| **宿主整合控制項幾何 (Host-integrated Controls)**                              |              ❌ 否              |    ❌ **嚴格禁止**    | 直接嵌入 PoE 官方 Light DOM 排版流，尺寸固定由專屬 Host Spec 定義（Scale-invariant, Density-invariant）；詳見 [visual-class-reset-contract.md](./visual-class-reset-contract.md) |

---

## 6. Scroll Foundation & ScrollArea Contract (捲動基底與覆蓋契約)

### 6.1 Core Layout Contract (排版幾何零干涉)

- **Scrollbar 不參與內容 layout geometry**：
  - Viewport width 恆定：不論內容是否超出，viewport 可視寬度與可容納寬度保持不變。
  - Content width 恆定：有無 scrollbar 時，內容可用寬度與 padding 完全一致，scrollbar overlay 浮動於最右側，不佔用內容佈局寬度。
  - Overlay 顯示：scrollbar 絕對定位覆蓋於 viewport 最右側（寬度 4px，`z-10`），不產生 `scrollbar-gutter`，scrollbar 出現或消失絕不造成內容 reflow 或 layout shift。

### 6.2 Visibility Policy (可見性契約)

- **Single Source of Truth**：`components/ui/scroll-area/ScrollAreaRoot.vue` 作為唯一 `type: 'auto'` default owner；`ScrollArea.vue` 委派 local `ScrollAreaRoot` foundation，不再重複宣告 ownership。
- **Persistent-on-Overflow 規則**：
  - 只要 viewport 存在內容溢出（`scrollable`），scrollbar 持續保持可見（`data-state="visible"`、`opacity: 1`、`visibility: visible`）。
  - 非 `type="hover"`：滑鼠移出 viewport 或 sidebar 後，scrollbar 不可消失。
  - 非 `scrollHideDelay` 模擬常駐：使用者停止滾動或無滑鼠操作數秒後，scrollbar 持續保持可見。
  - 拖動 thumb 時（mousedown + mousemove）scrollbar 不可消失。
  - 無 overflow 時（內容未超出）：scrollbar 不可見（卸載或 `data-state="hidden"`），不佔用視覺焦點。

### 6.3 Ownership 分層與邊界收斂

- **Outer-scroll panes (外層共用捲動持有者)**：
  - Normal 模式下的 `ToolsPane` 與 `SettingsPane`：由 `Sidebar.vue` 外層 `data-sidebar-outer-scroll` 的 `ScrollAreaRoot` 統一持有捲動，享有完整可視寬度與 breathing room (`pb-[var(--pxd-pane-scroll-end-space)]`)。
- **Pane-level ScrollArea owners (元件自身持有獨立 ScrollArea Foundation)**：
  - `LiveSearchConsoleSettingsPane`：直接作為 `.content-body` 的直屬子元素，根節點自身即為 `ScrollAreaRoot`，內部封裝 `ScrollAreaViewport` + `ScrollBar`，保持 bounded-height (`flex-1 min-h-0 h-full`) 與 `v-show` 記憶體常駐。
  - `BookmarkPane`：作為 `.content-body` 直屬子元素，直接繼承 bounded-height，內部主列表 `.bookmark-accordion-list` 獨立作為 `ScrollAreaViewport`。
  - `LiveSearchPrimaryPane`：作為 `.content-body` 直屬子元素，直接繼承 bounded-height，內部搜尋連線清單 `[data-test="search-connections-list"]` 獨立作為 `ScrollAreaViewport`。
  - `HistoryPane`：直接繼承 bounded-height，依自身結構處理內部排版。
  - `SharedDialog` (`DialogScrollContent`)：彈窗捲動主體直接使用 ScrollArea Foundation。
  - 外層 ScrollBar 依 `usesPaneScroll(activeTab)` 或 `pageRole === 'live-search-primary'` 隱藏，零 nested scrollbars，固定標頭與工具列不隨列表滾動。
- **合法 Native `.pxd-scrollbar` 白名單（嚴格限定，其餘嚴禁使用）**：
  目前僅允許以下元件保留原生 styled `.pxd-scrollbar`（與 production code 完全一致）：
  1. `components/injected/TierDropdownHost.vue`：注入於宿主交易頁面的詞綴層級下拉清單容器。
  2. `components/sidebar/FilterPane.vue`：內部滾動區（`modal-nav-anchors-inline` 類別導覽、`mods-scroll-container` 詞綴與 category/type 篩選清單、`selected-mods-list` 已選清單、selection list）。
  3. `components/sidebar/BookmarkPane.vue` 內的浮層集合（`DropdownMenuSubContent` 聯盟/資料夾選單、`cover-image-grid` 封面圖示選擇網格）。
  4. `components/sidebar/search-preview/TradeSearchPreviewTooltip.vue`：Bookmark / History 共用的 Trade Search Preview 懸停浮層（依 Reka available-height 自適應高度並支援 hoverable 完整預覽滾動）。
  - 任何一般側邊欄 Pane、主版面或常駐容器**嚴禁**新增 native `.pxd-scrollbar`。
  - **白名單保留依據**：上述 4 類元件（FilterPane 內部導覽與詞綴容器、TierDropdownHost 詞綴下拉浮層、BookmarkPane 浮層集合、TradeSearchPreviewTooltip 預覽浮層）因與宿主 DOM/測試契約緊密綁定，或依賴 Reka Floating UI 暫態浮層與 available-height 自適應防護，且均處於寬彈窗或暫態浮層，無側邊欄常駐工作區可用寬度擠壓問題，經確認永久保留原生 styled 滾動條。其餘側邊欄主體、Pane、常駐工作區與對話框主體一律強制使用 ScrollArea Foundation，嚴禁任意新增 native `.pxd-scrollbar`。
