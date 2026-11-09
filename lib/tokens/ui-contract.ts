/**
 * PoeXD Unified UI Contract: Scale / Density / Component Size / Layout Tokens
 *
 * 核心原則：
 * 1. UI Scale: 視覺尺寸倍率 (基準 default = 1.0，不使用 CSS transform: scale())
 * 2. UI Density: 排版緊湊度 (控制留白 padding / gap / row spacing，不縮放字級與圖標)
 * 3. Component Size: Primitive 控制項規格 ('sm' | 'default' | 'lg')，由 COMPONENT_SIZE_SPECS 統一派生
 * 4. Layout Baseline: 標準 Sidebar / 選單基準寬度 = 380px (Preferences 存 baseline，render 使用 effective width)
 * 5. Component Geometry: Final Component Geometry = Component Baseline × UI Scale (無 floor clamp，Density 僅影響排版留白)
 */

// --- 1. UI Scale ---
export const UI_SCALE_PRESETS = ['sm', 'default', 'lg'] as const;
export type UiScalePreset = (typeof UI_SCALE_PRESETS)[number];
export type UiScaleFactor = number;

export const UI_SCALE_FACTORS: Readonly<Record<UiScalePreset, UiScaleFactor>> = Object.freeze({
  sm: 0.85,
  default: 1.0,
  lg: 1.2,
});

export const UI_SCALE_CSS_VAR = '--pxd-ui-scale';

// --- 2. UI Density ---
export const UI_DENSITY_PRESETS = ['compact', 'default', 'comfortable'] as const;
export type UiDensityPreset = (typeof UI_DENSITY_PRESETS)[number];
export type UiDensityFactor = number;

export const UI_DENSITY_FACTORS: Readonly<Record<UiDensityPreset, UiDensityFactor>> = Object.freeze(
  {
    compact: 0.8,
    default: 1.0,
    comfortable: 1.2,
  },
);

export const UI_DENSITY_CSS_VAR = '--pxd-ui-density';

/**
 * 目前 Preferences / Settings UI 實際暴露之選項 (與 Foundation 支援的 Preset 清楚切分)
 * 歷史/現行 Preferences 僅提供 density 1.0 (default) 與 0.8 (compact)
 */
export const SETTINGS_EXPOSED_DENSITY_PRESETS = ['compact', 'default'] as const;

/**
 * 嚴禁跟著 Density 任意縮放的不可變維度 (Non-negotiable Invariants)
 */
export const NON_DENSITY_INVARIANTS = Object.freeze([
  'font-readability',
  'focus-ring',
  'border-width',
  'scrollbar-usability',
  'overlay-positioning',
  'tooltip-positioning',
  'popover-positioning',
  'dialog-positioning',
  'drag-handle-usability',
  'icon-stroke-and-box',
  'shadow-root-portal-isolation',
  'pane-scroll-end-space',
] as const);

export type NonDensityInvariant = (typeof NON_DENSITY_INVARIANTS)[number];

// --- 2.5 Semantic Typography System ---
export const SEMANTIC_TYPOGRAPHY_ROLES = [
  'micro',
  'caption',
  'secondary',
  'body',
  'control',
  'section-title',
  'heading',
] as const;
export type SemanticTypographyRole = (typeof SEMANTIC_TYPOGRAPHY_ROLES)[number];

export const SEMANTIC_TYPOGRAPHY_TOKENS = Object.freeze({
  microPx: 10,
  microVar: '--pxd-font-micro',
  captionPx: 11,
  captionVar: '--pxd-font-caption',
  secondaryPx: 12,
  secondaryVar: '--pxd-font-secondary',
  bodyPx: 13,
  bodyVar: '--pxd-font-body',
  controlPx: 13,
  controlVar: '--pxd-font-control',
  sectionTitlePx: 14,
  sectionTitleVar: '--pxd-font-section-title',
  headingPx: 16,
  headingVar: '--pxd-font-heading',
} as const);

// --- 3. Layout Baseline & Controls Geometry ---
export const LAYOUT_TOKENS = Object.freeze({
  sidebarDefaultWidthPx: 380,
  sidebarWidthVar: '--pxd-sidebar-width',
  controlHeightSmVar: '--control-height-sm',
  controlHeightDefaultVar: '--control-height-default',
  controlHeightLgVar: '--control-height-lg',
  filterNavWidthPx: 85,
  filterNavWidthVar: '--pxd-filter-nav-width',
  filterAnchorMinHeightPx: 34,
  filterAnchorMinHeightVar: '--pxd-filter-anchor-min-height',
  settingsHotkeyWidthPx: 130,
  settingsHotkeyWidthVar: '--pxd-settings-hotkey-width',
  modTierLevelWidthPx: 38,
  modTierLevelWidthVar: '--pxd-mod-tier-level-width',
  sidebarCollapsedWidthPx: 64,
  sidebarCollapsedWidthVar: '--pxd-sidebar-collapsed-width',
  sidebarCollapsedPaddingXPx: 8,
  sidebarCollapsedPaddingXVar: '--pxd-sidebar-collapsed-padding-x',
  brandIconExpandedPx: 28,
  brandIconExpandedVar: '--pxd-brand-icon-expanded-size',
  brandIconCollapsedPx: 24,
  brandIconCollapsedVar: '--pxd-brand-icon-collapsed-size',
  sidebarNavWidthPx: 50,
  sidebarNavWidthVar: '--pxd-sidebar-nav-width',
  sidebarHeaderHeightPx: 50,
  sidebarHeaderHeightVar: '--pxd-sidebar-header-height',
  sidebarAffixDialogHeaderHeightPx: 45,
  sidebarAffixDialogHeaderHeightVar: '--pxd-sidebar-affix-dialog-header-height',
  sidebarSharedDialogWidthPx: 340,
  sidebarSharedDialogWidthVar: '--pxd-sidebar-shared-dialog-width',
  sidebarSharedDialogMaxHeightPx: 250,
  sidebarSharedDialogMaxHeightVar: '--pxd-sidebar-shared-dialog-max-height',
  // Dropdown & Menu Semantic Geometry (Scale-aware, Density invariant)
  menuMinWidthPx: 128,
  menuMinWidthVar: '--pxd-menu-min-width',
  menuSubPreferredWidthPx: 192,
  menuSubPreferredWidthVar: '--pxd-menu-sub-width',
  menuMaxHeightPx: 240,
  menuMaxHeightVar: '--pxd-menu-max-height',
  menuSubMaxHeightPx: 180,
  menuSubMaxHeightVar: '--pxd-menu-sub-max-height',
  coverPickerItemSizePx: 56,
  coverPickerItemSizeVar: '--pxd-cover-picker-item-size',
  coverPickerWidthPx: 272,
  coverPickerWidthVar: '--pxd-cover-picker-width',
  coverPickerMaxHeightPx: 240,
  coverPickerMaxHeightVar: '--pxd-cover-picker-max-height',
  // Overlay & Floating UI Semantic Geometry (Scale-aware, Density invariant)
  overlayInspectWidthPx: 300,
  overlayInspectWidthVar: '--pxd-overlay-inspect-width',
  overlayInspectMaxHeightPx: 220,
  overlayInspectMaxHeightVar: '--pxd-overlay-inspect-max-height',
  searchPreviewWidthPx: 340,
  searchPreviewWidthVar: '--pxd-search-preview-width',
  temporarySearchDialogWidthPx: 420,
  temporarySearchDialogWidthVar: '--pxd-temporary-search-dialog-width',
  temporarySearchDialogMaxHeightPx: 520,
  temporarySearchDialogMaxHeightVar: '--pxd-temporary-search-dialog-max-height',
} as const);

// --- 4. Spacing System (Density & Scale Aware) ---
// Generic spacing scale: xs(4), sm(6), md(8), lg(12), xl(16), 2xl(24)
export const SPACING_TOKENS = Object.freeze({
  spaceXsPx: 4,
  spaceSmPx: 6,
  spaceMdPx: 8,
  spaceLgPx: 12,
  spaceXlPx: 16,
  space2xlPx: 24,

  // Semantic Layout Baseline: Generic spacing != Semantic layout spacing (基準留白 15px)
  panePaddingPx: 15,
  fieldGapPx: 15,
  sectionGapPx: 15,

  // Scroll End Reading Space: 最後內容後方的閱讀呼吸空間 (基準 72px, Scale-aware, Density invariant)
  paneScrollEndSpacePx: 72,

  spaceXsVar: '--pxd-space-xs',
  spaceSmVar: '--pxd-space-sm',
  spaceMdVar: '--pxd-space-md',
  spaceLgVar: '--pxd-space-lg',
  spaceXlVar: '--pxd-space-xl',
  space2xlVar: '--pxd-space-2xl',

  rowGapVar: '--pxd-row-gap',
  sectionGapVar: '--pxd-section-gap',
  panePaddingVar: '--pxd-pane-padding',
  fieldGapVar: '--pxd-field-gap',
  paneScrollEndSpaceVar: '--pxd-pane-scroll-end-space',

  // Bookmark Semantic Layout Spacings (Single SSOT: Scale & Density aware)
  bookmarkFolderHeaderPaddingYVar: '--pxd-bookmark-folder-header-padding-y',
  bookmarkRowPaddingYVar: '--pxd-bookmark-row-padding-y',
  bookmarkFolderBodyPaddingYVar: '--pxd-bookmark-folder-body-padding-y',
  bookmarkTreeGapVar: '--pxd-bookmark-tree-gap',
} as const);

/**
 * 計算 Density 與 Scale 共同作用後的有效間距
 * 公式：basePx * densityFactor * scaleFactor
 */
export function calcEffectiveSpacing(
  basePx: number,
  densityFactor: number,
  scaleFactor: number,
): number {
  return Number((basePx * densityFactor * scaleFactor).toFixed(2));
}

// --- 5. Component Size: Single Source of Truth ---
export const COMPONENT_SIZES = ['sm', 'default', 'lg'] as const;
export type ComponentSize = (typeof COMPONENT_SIZES)[number];

export interface ComponentSizeSpec {
  // 1. 垂直高度 (Scale-aware)
  heightClass: string; // 固定高度類別
  minHeightClass: string; // 彈性高度下限類別
  widthClass: string; // 固定寬度類別
  minWidthClass: string; // 彈性寬度下限類別
  heightVar: string;
  heightPx: number;
  iconButtonSizeClass: string; // 正方形尺寸類別

  // 2. 字級大小 (Scale-aware)
  fontSizeClass: string;
  fontVar: string;
  fontPx: number;

  // 3. 圖示規格與內部間距 (Scale-aware)
  iconSizeClass: string;
  iconVar: string;
  iconPx: number;
  iconSvgClass: string; // 穿透宣告 SVG 圖示尺寸類別
  iconGapClass: string; // 圖文 gap
  gapVar: string;
  gapPx: number;

  // 4. 水平留白 (Padding X, Scale-aware)
  paddingXClass: string; // 標準通用留白
  paddingXVar: string;
  paddingXPx: number;
  buttonPaddingXClass: string; // 按鈕明確語意 override (點擊平衡)
  buttonPaddingXVar: string;
  buttonPaddingXPx: number;
  inputPaddingXClass: string; // 輸入框 / 下拉明確語意 override (文字容納)
  inputPaddingXVar: string;
  inputPaddingXPx: number;
}

export const COMPONENT_SIZE_SPECS: Readonly<Record<ComponentSize, ComponentSizeSpec>> =
  Object.freeze({
    sm: Object.freeze({
      heightClass: 'h-[var(--control-height-sm,1.75rem)]',
      minHeightClass: 'min-h-[var(--control-height-sm,1.75rem)]',
      widthClass: 'w-[var(--control-height-sm,1.75rem)]',
      minWidthClass: 'min-w-[var(--control-height-sm,1.75rem)]',
      heightVar: LAYOUT_TOKENS.controlHeightSmVar,
      heightPx: 28,
      iconButtonSizeClass: 'size-[var(--control-height-sm)]',
      fontSizeClass: 'text-[length:var(--control-font-sm,12px)]',
      fontVar: '--control-font-sm',
      fontPx: 12,
      iconSizeClass: 'size-[var(--control-icon-sm,14px)]',
      iconVar: '--control-icon-sm',
      iconPx: 14,
      iconSvgClass: '[&_svg]:size-[var(--control-icon-sm,14px)]',
      iconGapClass: 'gap-[var(--control-gap-sm,6px)]',
      gapVar: '--control-gap-sm',
      gapPx: 6,
      paddingXClass: 'px-[var(--control-padding-x-sm,10px)]',
      paddingXVar: '--control-padding-x-sm',
      paddingXPx: 10,
      buttonPaddingXClass: 'px-[var(--button-padding-x-sm,12px)]',
      buttonPaddingXVar: '--button-padding-x-sm',
      buttonPaddingXPx: 12,
      inputPaddingXClass: 'px-[var(--input-padding-x-sm,8px)]',
      inputPaddingXVar: '--input-padding-x-sm',
      inputPaddingXPx: 8,
    }),
    default: Object.freeze({
      heightClass: 'h-[var(--control-height-default,2rem)]',
      minHeightClass: 'min-h-[var(--control-height-default,2rem)]',
      widthClass: 'w-[var(--control-height-default,2rem)]',
      minWidthClass: 'min-w-[var(--control-height-default,2rem)]',
      heightVar: LAYOUT_TOKENS.controlHeightDefaultVar,
      heightPx: 32,
      iconButtonSizeClass: 'size-[var(--control-height-default)]',
      fontSizeClass: 'text-[length:var(--control-font-default,13px)]',
      fontVar: '--control-font-default',
      fontPx: 13,
      iconSizeClass: 'size-[var(--control-icon-default,16px)]',
      iconVar: '--control-icon-default',
      iconPx: 16,
      iconSvgClass: '[&_svg]:size-[var(--control-icon-default,16px)]',
      iconGapClass: 'gap-[var(--control-gap-default,8px)]',
      gapVar: '--control-gap-default',
      gapPx: 8,
      paddingXClass: 'px-[var(--control-padding-x-default,12px)]',
      paddingXVar: '--control-padding-x-default',
      paddingXPx: 12,
      buttonPaddingXClass: 'px-[var(--button-padding-x-default,16px)]',
      buttonPaddingXVar: '--button-padding-x-default',
      buttonPaddingXPx: 16,
      inputPaddingXClass: 'px-[var(--input-padding-x-default,10px)]',
      inputPaddingXVar: '--input-padding-x-default',
      inputPaddingXPx: 10,
    }),
    lg: Object.freeze({
      heightClass: 'h-[var(--control-height-lg,2.5rem)]',
      minHeightClass: 'min-h-[var(--control-height-lg,2.5rem)]',
      widthClass: 'w-[var(--control-height-lg,2.5rem)]',
      minWidthClass: 'min-w-[var(--control-height-lg,2.5rem)]',
      heightVar: LAYOUT_TOKENS.controlHeightLgVar,
      heightPx: 40,
      iconButtonSizeClass: 'size-[var(--control-height-lg)]',
      fontSizeClass: 'text-[length:var(--control-font-lg,14px)]',
      fontVar: '--control-font-lg',
      fontPx: 14,
      iconSizeClass: 'size-[var(--control-icon-lg,20px)]',
      iconVar: '--control-icon-lg',
      iconPx: 20,
      iconSvgClass: '[&_svg]:size-[var(--control-icon-lg,20px)]',
      iconGapClass: 'gap-[var(--control-gap-lg,10px)]',
      gapVar: '--control-gap-lg',
      gapPx: 10,
      paddingXClass: 'px-[var(--control-padding-x-lg,16px)]',
      paddingXVar: '--control-padding-x-lg',
      paddingXPx: 16,
      buttonPaddingXClass: 'px-[var(--button-padding-x-lg,24px)]',
      buttonPaddingXVar: '--button-padding-x-lg',
      buttonPaddingXPx: 24,
      inputPaddingXClass: 'px-[var(--input-padding-x-lg,12px)]',
      inputPaddingXVar: '--input-padding-x-lg',
      inputPaddingXPx: 12,
    }),
  });

// --- 5.5 Form Indicator Profile (Checkbox / Radio) ---
export const FORM_INDICATOR_SPECS = Object.freeze({
  checkbox: Object.freeze({
    sizePx: 18,
    indicatorPx: 12,
    sizeVar: '--checkbox-size',
    indicatorVar: '--checkbox-indicator-size',
    sizeClass: 'size-[var(--checkbox-size,18px)]',
    indicatorClass: 'size-[var(--checkbox-indicator-size,12px)]',
  }),
  radio: Object.freeze({
    sizePx: 18,
    indicatorPx: 8,
    sizeVar: '--radio-size',
    indicatorVar: '--radio-indicator-size',
    sizeClass: 'size-[var(--radio-size,18px)]',
    indicatorClass: 'size-[var(--radio-indicator-size,8px)]',
  }),
} as const);

// --- 5.6 Collection Profile (SelectItem / DropdownMenuItem / ScrollButtons) ---
export const COLLECTION_SIZES = ['sm', 'default'] as const;
export type CollectionSize = (typeof COLLECTION_SIZES)[number];

export interface CollectionItemSpec {
  indicatorReservePx: number;
  indicatorReserveVar: string;
  indicatorReserveClass: string;
  indicatorLeftPx: number;
  indicatorLeftVar: string;
  indicatorLeftClass: string;
  radioDotPx: number;
  radioDotVar: string;
  radioDotClass: string;
}

export const COLLECTION_ITEM_SPECS: Readonly<Record<CollectionSize, CollectionItemSpec>> =
  Object.freeze({
    sm: Object.freeze({
      indicatorReservePx: 28,
      indicatorReserveVar: '--collection-indicator-reserve-sm',
      indicatorReserveClass: 'pl-[var(--collection-indicator-reserve-sm,28px)]',
      indicatorLeftPx: 8,
      indicatorLeftVar: '--collection-indicator-left-sm',
      indicatorLeftClass: 'left-[var(--collection-indicator-left-sm,8px)]',
      radioDotPx: 6,
      radioDotVar: '--collection-radio-dot-sm',
      radioDotClass: '!size-[var(--collection-radio-dot-sm,6px)]',
    }),
    default: Object.freeze({
      indicatorReservePx: 32,
      indicatorReserveVar: '--collection-indicator-reserve-default',
      indicatorReserveClass: 'pl-[var(--collection-indicator-reserve-default,32px)]',
      indicatorLeftPx: 8,
      indicatorLeftVar: '--collection-indicator-left-default',
      indicatorLeftClass: 'left-[var(--collection-indicator-left-default,8px)]',
      radioDotPx: 8,
      radioDotVar: '--collection-radio-dot-default',
      radioDotClass: '!size-[var(--collection-radio-dot-default,8px)]',
    }),
  });

// --- 5.7 Host Injected Controls Specs (Phase 4) ---

/**
 * PoE Host Tier Trigger 幾何規格
 * 核心約束：
 * 1. Scale invariant: 不受 fontSizeScale 影響
 * 2. Density invariant: 不受 densityScale 影響
 * 3. Outer height: 由 PoE 宿主列 (.filter-body table row / cell) rendered height ownership (via slot positioning container + trigger absolute inset stretch)
 */
export interface HostTierTriggerSpec {
  readonly widthPx: number;
  readonly fontPx: number;
  readonly lineHeightPx: number;
  readonly paddingXPx: number;
  readonly fontWeight: number;
}

export const HOST_TIER_TRIGGER_SPEC: Readonly<HostTierTriggerSpec> = Object.freeze({
  widthPx: 20,
  fontPx: 11,
  lineHeightPx: 14,
  paddingXPx: 4,
  fontWeight: 600,
});

/**
 * PoE Host Filter Select Button 規格 (Host Integration Geometry Exception)
 * 固定 Host geometry，Scale invariant、Density invariant
 */
export interface HostFilterSelectButtonSpec {
  readonly sizePx: number;
  readonly iconSizePx: number;
}

export const HOST_FILTER_SELECT_BUTTON_SPEC: Readonly<HostFilterSelectButtonSpec> = Object.freeze({
  sizePx: 28,
  iconSizePx: 14,
});

/**
 * PoE Host Category Select Button 規格 (Host Integration Geometry Exception)
 * 固定 Host geometry，Scale invariant、Density invariant
 */
export interface HostCategoryButtonSpec {
  readonly heightPx: number;
  readonly fontPx: number;
  readonly lineHeightPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly marginLeftPx: number;
}

export const HOST_CATEGORY_BUTTON_SPEC: Readonly<HostCategoryButtonSpec> = Object.freeze({
  heightPx: 20,
  fontPx: 11,
  lineHeightPx: 18,
  paddingXPx: 8,
  paddingYPx: 2,
  marginLeftPx: 8,
});

export type ComponentKind =
  | 'base'
  | 'button'
  | 'input'
  | 'select'
  | 'icon-button'
  | 'collection-item';

/**
 * 取得指定元件與尺寸規格的標準 class 組合
 * 為 Button / Input / SelectTrigger / Toggle / Collection Item 等 Primitive 的 Single Source of Truth
 */
export function getComponentSizeClasses(
  size: ComponentSize = 'default',
  kind: ComponentKind = 'base',
): string {
  const spec = COMPONENT_SIZE_SPECS[size];

  if (kind === 'icon-button') {
    return [spec.iconButtonSizeClass, 'p-0', spec.iconSvgClass, 'gap-0'].join(' ');
  }

  if (kind === 'collection-item') {
    return [
      spec.minHeightClass,
      spec.paddingXClass,
      spec.fontSizeClass,
      spec.iconSvgClass,
      spec.iconGapClass,
    ].join(' ');
  }

  const paddingClass =
    kind === 'button'
      ? spec.buttonPaddingXClass
      : kind === 'input' || kind === 'select'
        ? spec.inputPaddingXClass
        : spec.paddingXClass;

  if (kind === 'button') {
    return [
      spec.heightClass,
      paddingClass,
      spec.fontSizeClass,
      spec.iconSvgClass,
      spec.iconGapClass,
    ].join(' ');
  }

  if (kind === 'input' || kind === 'select') {
    return [spec.heightClass, paddingClass, spec.fontSizeClass].join(' ');
  }

  return [
    spec.heightClass,
    paddingClass,
    spec.fontSizeClass,
    spec.iconSvgClass,
    spec.iconGapClass,
  ].join(' ');
}

function formatPx(val: number): string {
  const rounded = Number(val.toFixed(2));
  return `${rounded}px`;
}

export interface UiRuntimeTokenOptions {
  scale?: number;
  density?: number;
  fontSizeScale?: number;
  densityScale?: number;
  sidebarWidth?: number;
}

/**
 * 集中計算 Scale 與 Density 作用後的最終實際 px 值
 * CSS variables 直接儲存最終數值，徹底移除 CSS typed arithmetic
 */
export function createUiRuntimeTokenValues(
  options: UiRuntimeTokenOptions = {},
): Record<string, string> {
  const scale = options.scale ?? options.fontSizeScale ?? 1.0;
  const density = options.density ?? options.densityScale ?? 1.0;
  const sidebarWidth = options.sidebarWidth ?? LAYOUT_TOKENS.sidebarDefaultWidthPx;

  const tokens: Record<string, string> = {
    // 1. Scale & Density factor tokens
    [UI_SCALE_CSS_VAR]: String(scale),
    [UI_DENSITY_CSS_VAR]: String(density),

    // Legacy compatibility tokens
    '--poexd-font-size-scale': String(scale),
    '--poexd-density-scale': String(density),

    // 2. Sidebar width token (反映實際使用者設定寬度，不乘 scale)
    [LAYOUT_TOKENS.sidebarWidthVar]: `${sidebarWidth}px`,

    // 2.5 FilterPane semantic layout tokens (baseline * scale, Density invariant)
    [LAYOUT_TOKENS.filterNavWidthVar]: formatPx(LAYOUT_TOKENS.filterNavWidthPx * scale),
    [LAYOUT_TOKENS.filterAnchorMinHeightVar]: formatPx(
      LAYOUT_TOKENS.filterAnchorMinHeightPx * scale,
    ),

    // 2.6 SettingsPane semantic layout tokens (baseline * scale, Density invariant)
    [LAYOUT_TOKENS.settingsHotkeyWidthVar]: formatPx(LAYOUT_TOKENS.settingsHotkeyWidthPx * scale),

    // 2.7 ModItem semantic layout tokens (baseline * scale, Density invariant)
    [LAYOUT_TOKENS.modTierLevelWidthVar]: formatPx(LAYOUT_TOKENS.modTierLevelWidthPx * scale),

    // 2.8 Sidebar shell & dialog semantic layout tokens (baseline * scale, Density invariant)
    [LAYOUT_TOKENS.sidebarCollapsedWidthVar]: formatPx(
      LAYOUT_TOKENS.sidebarCollapsedWidthPx * scale,
    ),
    [LAYOUT_TOKENS.sidebarCollapsedPaddingXVar]: formatPx(
      LAYOUT_TOKENS.sidebarCollapsedPaddingXPx * scale,
    ),
    [LAYOUT_TOKENS.brandIconExpandedVar]: formatPx(LAYOUT_TOKENS.brandIconExpandedPx * scale),
    [LAYOUT_TOKENS.brandIconCollapsedVar]: formatPx(LAYOUT_TOKENS.brandIconCollapsedPx * scale),
    [LAYOUT_TOKENS.sidebarNavWidthVar]: formatPx(LAYOUT_TOKENS.sidebarNavWidthPx * scale),
    [LAYOUT_TOKENS.sidebarHeaderHeightVar]: formatPx(LAYOUT_TOKENS.sidebarHeaderHeightPx * scale),
    [LAYOUT_TOKENS.sidebarAffixDialogHeaderHeightVar]: formatPx(
      LAYOUT_TOKENS.sidebarAffixDialogHeaderHeightPx * scale,
    ),
    [LAYOUT_TOKENS.sidebarSharedDialogWidthVar]: formatPx(
      LAYOUT_TOKENS.sidebarSharedDialogWidthPx * scale,
    ),
    [LAYOUT_TOKENS.sidebarSharedDialogMaxHeightVar]: formatPx(
      LAYOUT_TOKENS.sidebarSharedDialogMaxHeightPx * scale,
    ),

    // 2.9 Dropdown & Menu semantic visual layout tokens (baseline * scale, Density invariant)
    [LAYOUT_TOKENS.menuMinWidthVar]: formatPx(LAYOUT_TOKENS.menuMinWidthPx * scale),
    [LAYOUT_TOKENS.menuSubPreferredWidthVar]: formatPx(
      LAYOUT_TOKENS.menuSubPreferredWidthPx * scale,
    ),
    [LAYOUT_TOKENS.menuMaxHeightVar]: formatPx(LAYOUT_TOKENS.menuMaxHeightPx * scale),
    [LAYOUT_TOKENS.menuSubMaxHeightVar]: formatPx(LAYOUT_TOKENS.menuSubMaxHeightPx * scale),
    [LAYOUT_TOKENS.coverPickerItemSizeVar]: formatPx(LAYOUT_TOKENS.coverPickerItemSizePx * scale),
    [LAYOUT_TOKENS.coverPickerWidthVar]: formatPx(LAYOUT_TOKENS.coverPickerWidthPx * scale),
    [LAYOUT_TOKENS.coverPickerMaxHeightVar]: formatPx(LAYOUT_TOKENS.coverPickerMaxHeightPx * scale),

    // 2.10 Overlay & Floating UI semantic geometry tokens (baseline * scale, Density invariant)
    [LAYOUT_TOKENS.overlayInspectWidthVar]: formatPx(LAYOUT_TOKENS.overlayInspectWidthPx * scale),
    [LAYOUT_TOKENS.overlayInspectMaxHeightVar]: formatPx(
      LAYOUT_TOKENS.overlayInspectMaxHeightPx * scale,
    ),
    [LAYOUT_TOKENS.searchPreviewWidthVar]: formatPx(LAYOUT_TOKENS.searchPreviewWidthPx * scale),
    [LAYOUT_TOKENS.temporarySearchDialogWidthVar]: formatPx(
      LAYOUT_TOKENS.temporarySearchDialogWidthPx * scale,
    ),
    [LAYOUT_TOKENS.temporarySearchDialogMaxHeightVar]: formatPx(
      LAYOUT_TOKENS.temporarySearchDialogMaxHeightPx * scale,
    ),

    // 3. Scale-aware Control Heights (直接依照 Scale 縮放，無 floor clamp)
    [LAYOUT_TOKENS.controlHeightSmVar]: formatPx(COMPONENT_SIZE_SPECS.sm.heightPx * scale),
    [LAYOUT_TOKENS.controlHeightDefaultVar]: formatPx(
      COMPONENT_SIZE_SPECS.default.heightPx * scale,
    ),
    [LAYOUT_TOKENS.controlHeightLgVar]: formatPx(COMPONENT_SIZE_SPECS.lg.heightPx * scale),

    // 3.5 Form Indicator Tokens (Checkbox / Radio)
    [FORM_INDICATOR_SPECS.checkbox.sizeVar]: formatPx(FORM_INDICATOR_SPECS.checkbox.sizePx * scale),
    [FORM_INDICATOR_SPECS.checkbox.indicatorVar]: formatPx(
      FORM_INDICATOR_SPECS.checkbox.indicatorPx * scale,
    ),
    [FORM_INDICATOR_SPECS.radio.sizeVar]: formatPx(FORM_INDICATOR_SPECS.radio.sizePx * scale),
    [FORM_INDICATOR_SPECS.radio.indicatorVar]: formatPx(
      FORM_INDICATOR_SPECS.radio.indicatorPx * scale,
    ),

    // 3.6 Collection Profile Tokens (Indicator reserve, indicator position, radio dot)
    // Scale-aware only, Density does NOT affect collection geometry
    [COLLECTION_ITEM_SPECS.sm.indicatorReserveVar]: formatPx(
      COLLECTION_ITEM_SPECS.sm.indicatorReservePx * scale,
    ),
    [COLLECTION_ITEM_SPECS.default.indicatorReserveVar]: formatPx(
      COLLECTION_ITEM_SPECS.default.indicatorReservePx * scale,
    ),
    [COLLECTION_ITEM_SPECS.sm.indicatorLeftVar]: formatPx(
      COLLECTION_ITEM_SPECS.sm.indicatorLeftPx * scale,
    ),
    [COLLECTION_ITEM_SPECS.default.indicatorLeftVar]: formatPx(
      COLLECTION_ITEM_SPECS.default.indicatorLeftPx * scale,
    ),
    [COLLECTION_ITEM_SPECS.sm.radioDotVar]: formatPx(COLLECTION_ITEM_SPECS.sm.radioDotPx * scale),
    [COLLECTION_ITEM_SPECS.default.radioDotVar]: formatPx(
      COLLECTION_ITEM_SPECS.default.radioDotPx * scale,
    ),

    // 5. Scale-aware Control Fonts
    [COMPONENT_SIZE_SPECS.sm.fontVar]: formatPx(COMPONENT_SIZE_SPECS.sm.fontPx * scale),
    [COMPONENT_SIZE_SPECS.default.fontVar]: formatPx(COMPONENT_SIZE_SPECS.default.fontPx * scale),
    [COMPONENT_SIZE_SPECS.lg.fontVar]: formatPx(COMPONENT_SIZE_SPECS.lg.fontPx * scale),

    // 5.5 Semantic Typography Contract (final px = baseline * scale, 集中計算無 CSS arithmetic)
    [SEMANTIC_TYPOGRAPHY_TOKENS.microVar]: formatPx(SEMANTIC_TYPOGRAPHY_TOKENS.microPx * scale),
    [SEMANTIC_TYPOGRAPHY_TOKENS.captionVar]: formatPx(SEMANTIC_TYPOGRAPHY_TOKENS.captionPx * scale),
    [SEMANTIC_TYPOGRAPHY_TOKENS.secondaryVar]: formatPx(
      SEMANTIC_TYPOGRAPHY_TOKENS.secondaryPx * scale,
    ),
    [SEMANTIC_TYPOGRAPHY_TOKENS.bodyVar]: formatPx(SEMANTIC_TYPOGRAPHY_TOKENS.bodyPx * scale),
    [SEMANTIC_TYPOGRAPHY_TOKENS.controlVar]: formatPx(SEMANTIC_TYPOGRAPHY_TOKENS.controlPx * scale),
    [SEMANTIC_TYPOGRAPHY_TOKENS.sectionTitleVar]: formatPx(
      SEMANTIC_TYPOGRAPHY_TOKENS.sectionTitlePx * scale,
    ),
    [SEMANTIC_TYPOGRAPHY_TOKENS.headingVar]: formatPx(SEMANTIC_TYPOGRAPHY_TOKENS.headingPx * scale),

    // 6. Scale-aware Icons
    [COMPONENT_SIZE_SPECS.sm.iconVar]: formatPx(COMPONENT_SIZE_SPECS.sm.iconPx * scale),
    [COMPONENT_SIZE_SPECS.default.iconVar]: formatPx(COMPONENT_SIZE_SPECS.default.iconPx * scale),
    [COMPONENT_SIZE_SPECS.lg.iconVar]: formatPx(COMPONENT_SIZE_SPECS.lg.iconPx * scale),

    // 7. Scale-aware Gaps
    [COMPONENT_SIZE_SPECS.sm.gapVar]: formatPx(COMPONENT_SIZE_SPECS.sm.gapPx * scale),
    [COMPONENT_SIZE_SPECS.default.gapVar]: formatPx(COMPONENT_SIZE_SPECS.default.gapPx * scale),
    [COMPONENT_SIZE_SPECS.lg.gapVar]: formatPx(COMPONENT_SIZE_SPECS.lg.gapPx * scale),

    // 8. Scale-aware Paddings
    [COMPONENT_SIZE_SPECS.sm.buttonPaddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.sm.buttonPaddingXPx * scale,
    ),
    [COMPONENT_SIZE_SPECS.default.buttonPaddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.default.buttonPaddingXPx * scale,
    ),
    [COMPONENT_SIZE_SPECS.lg.buttonPaddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.lg.buttonPaddingXPx * scale,
    ),

    [COMPONENT_SIZE_SPECS.sm.inputPaddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.sm.inputPaddingXPx * scale,
    ),
    [COMPONENT_SIZE_SPECS.default.inputPaddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.default.inputPaddingXPx * scale,
    ),
    [COMPONENT_SIZE_SPECS.lg.inputPaddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.lg.inputPaddingXPx * scale,
    ),

    [COMPONENT_SIZE_SPECS.sm.paddingXVar]: formatPx(COMPONENT_SIZE_SPECS.sm.paddingXPx * scale),
    [COMPONENT_SIZE_SPECS.default.paddingXVar]: formatPx(
      COMPONENT_SIZE_SPECS.default.paddingXPx * scale,
    ),
    [COMPONENT_SIZE_SPECS.lg.paddingXVar]: formatPx(COMPONENT_SIZE_SPECS.lg.paddingXPx * scale),

    // 9. Generic Spacings (Density & Scale aware: basePx * density * scale)
    // Scale: xs(4), sm(6), md(8), lg(12), xl(16), 2xl(24)
    [SPACING_TOKENS.spaceXsVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.spaceXsPx, density, scale),
    ),
    [SPACING_TOKENS.spaceSmVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.spaceSmPx, density, scale),
    ),
    [SPACING_TOKENS.spaceMdVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.spaceMdPx, density, scale),
    ),
    [SPACING_TOKENS.spaceLgVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.spaceLgPx, density, scale),
    ),
    [SPACING_TOKENS.spaceXlVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.spaceXlPx, density, scale),
    ),
    [SPACING_TOKENS.space2xlVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.space2xlPx, density, scale),
    ),

    // 10. Semantic Layout Spacings (Generic spacing != Semantic layout spacing)
    // 基準為 15px (pane, field, section) 與 8px (row)
    [SPACING_TOKENS.rowGapVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.spaceMdPx, density, scale),
    ),
    [SPACING_TOKENS.sectionGapVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.sectionGapPx, density, scale),
    ),
    [SPACING_TOKENS.panePaddingVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.panePaddingPx, density, scale),
    ),
    [SPACING_TOKENS.fieldGapVar]: formatPx(
      calcEffectiveSpacing(SPACING_TOKENS.fieldGapPx, density, scale),
    ),

    // 10.5 Bookmark Semantic Layout Spacings (Single SSOT: Scale & Density aware)
    // Default (density >= 1.0): 100% matches pre-convergence baseline (header: 12px, row: 6px, body: 6px, tree gap: 8px)
    // Compact (density < 1.0): selective spacing convergence (header: space-md 6.4px, row: space-xs 3.2px, body: space-xs 3.2px, tree gap: space-sm 4.8px)
    // Comfortable (density > 1.0): default baseline scaled proportionally without distortion
    ...(() => {
      const isCompact = density < 1.0;
      const bookmarkHeaderPadYBase = isCompact
        ? SPACING_TOKENS.spaceMdPx
        : SPACING_TOKENS.spaceLgPx;
      const bookmarkRowPadYBase = isCompact ? SPACING_TOKENS.spaceXsPx : SPACING_TOKENS.spaceSmPx;
      const bookmarkBodyPadYBase = isCompact ? SPACING_TOKENS.spaceXsPx : SPACING_TOKENS.spaceSmPx;
      const bookmarkTreeGapBase = isCompact ? SPACING_TOKENS.spaceSmPx : SPACING_TOKENS.spaceMdPx;

      return {
        [SPACING_TOKENS.bookmarkFolderHeaderPaddingYVar]: formatPx(
          calcEffectiveSpacing(bookmarkHeaderPadYBase, density, scale),
        ),
        [SPACING_TOKENS.bookmarkRowPaddingYVar]: formatPx(
          calcEffectiveSpacing(bookmarkRowPadYBase, density, scale),
        ),
        [SPACING_TOKENS.bookmarkFolderBodyPaddingYVar]: formatPx(
          calcEffectiveSpacing(bookmarkBodyPadYBase, density, scale),
        ),
        [SPACING_TOKENS.bookmarkTreeGapVar]: formatPx(
          calcEffectiveSpacing(bookmarkTreeGapBase, density, scale),
        ),
      };
    })(),

    // 10.5 Scroll End Reading Space (Scale-aware, Density invariant)
    [SPACING_TOKENS.paneScrollEndSpaceVar]: formatPx(SPACING_TOKENS.paneScrollEndSpacePx * scale),
  };

  return tokens;
}

/**
 * 將計算後的 UI Runtime Tokens 批量寫入 DOM 節點之 style
 */
export function syncUiRuntimeTokens(
  target: { style?: { setProperty: (name: string, val: string) => void } } | null | undefined,
  options: UiRuntimeTokenOptions = {},
): Record<string, string> {
  const tokens = createUiRuntimeTokenValues(options);
  if (target && target.style && typeof target.style.setProperty === 'function') {
    for (const [key, value] of Object.entries(tokens)) {
      target.style.setProperty(key, value);
    }
  }
  return tokens;
}
