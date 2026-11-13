<template>
  <div class="flex flex-col">
    <!-- 1. 外觀與面板 -->
    <Collapsible v-model:open="sectionOpen.appearance" class="flex flex-col">
      <CollapsibleTrigger
        class="flex w-full items-center justify-between py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-bold text-foreground hover:text-primary transition-colors select-none"
      >
        <span>{{ t('settings.section.appearance') }}</span>
        <ChevronDown
          class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-200"
          :class="{ '-rotate-90': !sectionOpen.appearance }"
        />
      </CollapsibleTrigger>
      <CollapsibleContent class="flex flex-col gap-[var(--pxd-field-gap)] pt-[var(--pxd-space-sm)]">
        <!-- 主題 -->
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <span class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground">{{
            t('settings.theme.label')
          }}</span>
          <Select v-model="theme" @update:model-value="savePreference('theme')">
            <SelectTrigger size="default" class="w-[140px] shrink-0">
              <SelectValue>{{ THEME_LABELS[theme] }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in THEME_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 語言 -->
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <span
              class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground"
              >{{ t('settings.displayLocale.label') }}</span
            >
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.displayLocale.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.displayLocale.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            v-model="displayLocale"
            data-test="display-locale"
            @update:model-value="savePreference('displayLocale')"
          >
            <SelectTrigger size="default" class="w-[140px] shrink-0">
              <SelectValue>{{ DISPLAY_LOCALE_LABELS[displayLocale] }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="opt in DISPLAY_LOCALE_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 面板位置 -->
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <span class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground">{{
            t('settings.sidebarPosition.label')
          }}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            :model-value="sidebarPosition"
            class="w-[140px] shrink-0"
            @update:model-value="handleSidebarPositionChange"
          >
            <ToggleGroupItem
              v-for="opt in SIDEBAR_POSITION_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              :aria-label="opt.label"
              size="sm"
              class="flex-1"
            >
              {{ opt.label }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <!-- 選單寬度 -->
        <div class="flex flex-col gap-[var(--pxd-space-sm)]">
          <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
            <span
              class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground"
              >{{ t('settings.sidebarSize.label') }}</span
            >
            <Select v-model="sidebarSize" @update:model-value="handleSizeChange">
              <SelectTrigger size="default" class="w-[140px] shrink-0">
                <SelectValue>{{ SIDEBAR_SIZE_LABELS[sidebarSize] }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="opt in SIDEBAR_SIZE_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="sidebarSize === 'custom'" class="flex flex-col gap-[var(--pxd-space-sm)]">
            <span class="text-[length:var(--pxd-font-caption)] text-muted-foreground">{{
              t('settings.sidebarSize.customHint')
            }}</span>
          </div>
        </div>

        <!-- 介面縮放比例 -->
        <div class="flex flex-col gap-[var(--pxd-space-sm)]">
          <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
            <span class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground">
              {{
                t('settings.fontSize.label', {
                  percent: Math.round(fontSizeScale * 100),
                })
              }}
            </span>
            <Select v-model="fontSizeMode" @update:model-value="handleFontSizeModeChange">
              <SelectTrigger size="default" class="w-[140px] shrink-0">
                <SelectValue>{{ FONT_SIZE_MODE_LABELS[fontSizeMode] }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in FONT_SIZE_MODE_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="fontSizeMode === 'custom'" class="flex justify-end">
            <div class="relative flex w-[140px] shrink-0 items-center">
              <Input
                type="number"
                v-model="customFontSizePercent"
                :min="fontSizePercentBounds.min"
                :max="fontSizePercentBounds.max"
                size="default"
                class="w-full pr-[var(--control-height-default)] [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none text-right"
                @input="handleCustomFontSizeInput"
                @blur="handleCustomFontSizeBlur"
              />
              <span
                class="pointer-events-none absolute right-[var(--input-padding-x-default)] select-none text-[length:var(--pxd-font-caption)] text-muted-foreground"
                >%</span
              >
            </div>
          </div>
        </div>

        <!-- 介面緊湊度 -->
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox id="density-compact" v-model="isCompactDensity" />
          <label
            for="density-compact"
            class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
          >
            {{ t('settings.density.compactLabel') }}
          </label>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <Separator class="my-[var(--pxd-section-gap)]" />

    <!-- 2. 搜尋與快捷鍵 -->
    <Collapsible v-model:open="sectionOpen.searchHotkeys" class="flex flex-col">
      <CollapsibleTrigger
        class="flex w-full items-center justify-between py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-bold text-foreground hover:text-primary transition-colors select-none"
      >
        <span>{{ t('settings.section.searchHotkeys') }}</span>
        <ChevronDown
          class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-200"
          :class="{ '-rotate-90': !sectionOpen.searchHotkeys }"
        />
      </CollapsibleTrigger>
      <CollapsibleContent class="flex flex-col gap-[var(--pxd-field-gap)] pt-[var(--pxd-space-sm)]">
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-hotkeys"
            v-model="enableHotkeys"
            @update:model-value="savePreference('enableHotkeys')"
          />
          <label
            for="enable-hotkeys"
            class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
          >
            {{ t('settings.hotkeys.enable') }}
          </label>
        </div>
        <div
          v-if="enableHotkeys"
          class="flex items-center justify-between gap-[var(--pxd-space-lg)]"
        >
          <span class="text-[length:var(--pxd-font-secondary)] text-foreground">{{
            t('settings.hotkeys.focusLabel')
          }}</span>
          <SettingsHotkeyInput
            v-model="hotkeyFocus"
            :aria-label="t('settings.hotkeys.focusLabel')"
            @update:model-value="savePreference('hotkeyFocus')"
          />
        </div>
        <div
          v-if="enableHotkeys"
          class="flex items-center justify-between gap-[var(--pxd-space-lg)]"
        >
          <span class="text-[length:var(--pxd-font-secondary)] text-foreground">{{
            t('settings.hotkeys.clearLabel')
          }}</span>
          <SettingsHotkeyInput
            v-model="hotkeyClear"
            :aria-label="t('settings.hotkeys.clearLabel')"
            @update:model-value="savePreference('hotkeyClear')"
          />
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-search-tilde"
            v-model="enableSearchTilde"
            @update:model-value="saveTildeSettings"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-search-tilde"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.searchTilde.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.searchTilde.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.searchTilde.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-filter-tilde"
            v-model="enableFilterTilde"
            @update:model-value="saveTildeSettings"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-filter-tilde"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.filterTilde.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.filterTilde.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.filterTilde.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <Separator class="my-[var(--pxd-section-gap)]" />

    <!-- 3. 交易頁功能 -->
    <Collapsible v-model:open="sectionOpen.tradeFeatures" class="flex flex-col">
      <CollapsibleTrigger
        class="flex w-full items-center justify-between py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-bold text-foreground hover:text-primary transition-colors select-none"
      >
        <span>{{ t('settings.section.tradeFeatures') }}</span>
        <ChevronDown
          class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-200"
          :class="{ '-rotate-90': !sectionOpen.tradeFeatures }"
        />
      </CollapsibleTrigger>
      <CollapsibleContent class="flex flex-col gap-[var(--pxd-field-gap)] pt-[var(--pxd-space-sm)]">
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-tier-helper"
            v-model="enableTierHelper"
            @update:model-value="savePreference('enableTierHelper')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-tier-helper"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.tierHelper.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.tierHelper.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.tierHelper.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-affix-selector"
            v-model="enableAffixSelector"
            @update:model-value="savePreference('enableAffixSelector')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-affix-selector"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.affixSelector.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.affixSelector.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.affixSelector.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-auto-title"
            v-model="enableAutoTitle"
            @update:model-value="savePreference('enableAutoTitle')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-auto-title"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.autoTitle.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.autoTitle.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.autoTitle.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-price-comparison"
            v-model="enablePriceComparison"
            @update:model-value="savePreference('enablePriceComparison')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-price-comparison"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.priceComparison.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.priceComparison.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.priceComparison.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-result-mod-highlight"
            v-model="enableResultModHighlight"
            @update:model-value="savePreference('enableResultModHighlight')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-result-mod-highlight"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.resultModHighlight.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.resultModHighlight.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.resultModHighlight.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-result-mod-quick-filter"
            v-model="enableResultModQuickFilter"
            @update:model-value="savePreference('enableResultModQuickFilter')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-result-mod-quick-filter"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.resultModQuickFilter.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.resultModQuickFilter.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.resultModQuickFilter.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-pure-background"
            v-model="enablePureBackground"
            @update:model-value="savePreference('enablePureBackground')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-pure-background"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.pureBackground.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.pureBackground.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.pureBackground.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-market-translation"
            v-model="marketTranslation"
            @update:model-value="savePreference('marketTranslation')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-market-translation"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.marketTranslation.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.marketTranslation.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.marketTranslation.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div
          v-if="marketTranslation"
          class="flex items-center gap-[var(--pxd-space-md)] pl-[var(--pxd-space-lg)]"
        >
          <Checkbox
            id="enable-market-translation-bilingual"
            v-model="marketTranslationBilingual"
            @update:model-value="savePreference('marketTranslationBilingual')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-market-translation-bilingual"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.marketTranslationBilingual.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.marketTranslationBilingual.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.marketTranslationBilingual.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div v-if="isPoe2" class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-item-normalizer"
            v-model="enableItemNormalizer"
            @update:model-value="savePreference('enableItemNormalizer')"
          />
          <div class="inline-flex items-center gap-[var(--pxd-space-xs)] min-w-0">
            <label
              for="enable-item-normalizer"
              class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
            >
              {{ t('settings.itemNormalizer.label') }}
            </label>
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="inline-flex items-center text-muted-foreground/60 hover:text-foreground cursor-help"
                  tabindex="-1"
                  :aria-label="t('settings.itemNormalizer.infoAria')"
                >
                  <Info class="size-[var(--control-icon-sm,14px)] shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {{ t('settings.itemNormalizer.tooltip') }}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>

    <Separator class="my-[var(--pxd-section-gap)]" />

    <!-- 4. 書籤 -->
    <Collapsible v-model:open="sectionOpen.bookmarks" class="flex flex-col">
      <CollapsibleTrigger
        class="flex w-full items-center justify-between py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-bold text-foreground hover:text-primary transition-colors select-none"
      >
        <span>{{ t('settings.section.bookmarks') }}</span>
        <ChevronDown
          class="size-[var(--control-icon-sm,14px)] text-muted-foreground transition-transform duration-200"
          :class="{ '-rotate-90': !sectionOpen.bookmarks }"
        />
      </CollapsibleTrigger>
      <CollapsibleContent class="flex flex-col gap-[var(--pxd-field-gap)] pt-[var(--pxd-space-sm)]">
        <!-- 加入書籤按鈕位置 -->
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <span class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground">{{
            t('settings.bookmarkBtnPosition.label')
          }}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            :model-value="addBookmarkBtnPosition"
            class="w-[140px] shrink-0"
            @update:model-value="handleAddBookmarkBtnPositionChange"
          >
            <ToggleGroupItem
              v-for="opt in BOOKMARK_BUTTON_POSITION_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              :aria-label="opt.label"
              size="sm"
              class="flex-1"
            >
              {{ opt.label }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <!-- 左鍵點選書籤／搜尋歷史的行為 -->
        <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
          <span class="min-w-0 truncate text-[length:var(--pxd-font-secondary)] text-foreground">{{
            t('settings.searchEntryClickAction.label')
          }}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            data-test="search-entry-click-action"
            :model-value="searchEntryClickAction"
            class="w-[140px] shrink-0"
            @update:model-value="handleSearchEntryClickActionChange"
          >
            <ToggleGroupItem
              v-for="opt in SEARCH_ENTRY_CLICK_ACTION_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              :aria-label="opt.label"
              size="sm"
              class="flex-1 px-1 whitespace-nowrap overflow-hidden"
              :title="opt.label"
            >
              <span class="truncate block w-full text-center">{{ opt.label }}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <!-- 顯示書籤物品資訊預覽 -->
        <div class="flex items-center gap-[var(--pxd-space-md)]">
          <Checkbox
            id="enable-bookmark-tooltip"
            v-model="enableBookmarkTooltip"
            @update:model-value="savePreference('enableBookmarkTooltip')"
          />
          <label
            for="enable-bookmark-tooltip"
            class="cursor-pointer select-none text-[length:var(--pxd-font-secondary)] text-foreground"
          >
            {{ t('settings.bookmarkTooltip.label') }}
          </label>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, reactive, ref, toRefs } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, Info } from '@lucide/vue';
import SettingsHotkeyInput from './settings/SettingsHotkeyInput.vue';
import {
  DEFAULT_PREFERENCES,
  FONT_SIZE_PRESETS,
  FONT_SIZE_SCALE_BOUNDS,
  SIDEBAR_SIZE_PRESETS,
  SIDEBAR_WIDTH_BOUNDS,
  type FontSizePresetMode,
  type FontSizeMode,
  type Preferences,
  type SidebarSize,
} from '@/utils/preferences-contract';
import {
  BOOKMARK_BUTTON_POSITION_OPTIONS,
  DISPLAY_LOCALE_LABELS,
  DISPLAY_LOCALE_OPTIONS,
  SEARCH_ENTRY_CLICK_ACTION_LABELS,
  SEARCH_ENTRY_CLICK_ACTION_OPTIONS,
  FONT_SIZE_MODE_LABELS,
  FONT_SIZE_MODE_OPTIONS,
  SIDEBAR_POSITION_OPTIONS,
  SIDEBAR_SIZE_LABELS,
  SIDEBAR_SIZE_OPTIONS,
  THEME_LABELS,
  THEME_OPTIONS,
} from './settings/settings-ui-metadata';
import { setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { getPreferences, type PreferencesModule } from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';

export default defineComponent({
  name: 'SettingsPane',
  components: {
    Button,
    Checkbox,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Separator,
    SettingsHotkeyInput,
    ToggleGroup,
    ToggleGroupItem,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    ChevronDown,
    Info,
  },
  emits: ['ready'],
  setup(_props, { emit }) {
    const version = getPoeVersion();

    const preferenceState = reactive<Preferences>({
      ...DEFAULT_PREFERENCES,
    });

    const {
      theme,
      displayLocale,
      sidebarPosition,
      sidebarSize,
      sidebarWidth,
      fontSizeScale,
      fontSizeMode,
      densityScale,
      hotkeyFocus,
      hotkeyClear,
      enableHotkeys,
      enableItemNormalizer,
      enableSearchTilde,
      enableFilterTilde,
      enableTierHelper,
      enableAffixSelector,
      enableAutoTitle,
      enablePriceComparison,
      enableResultModHighlight,
      enableResultModQuickFilter,
      enablePureBackground,
      marketTranslation,
      marketTranslationBilingual,
      addBookmarkBtnPosition,
      enableBookmarkTooltip,
      searchEntryClickAction,
    } = toRefs(preferenceState);

    const fontSizePercentBounds = {
      min: Math.round(FONT_SIZE_SCALE_BOUNDS.min * 100),
      max: Math.round(FONT_SIZE_SCALE_BOUNDS.max * 100),
    };

    const customFontSizePercent = ref<number>(
      Math.round((preferenceState.customFontSizeScale ?? preferenceState.fontSizeScale) * 100),
    );
    let preferences: PreferencesModule | undefined;
    let stopPreferences: (() => void) | undefined;
    const applyPreferences = (snapshot: Readonly<Preferences>) => {
      Object.assign(preferenceState, snapshot);
      setActiveDisplayLocalePreference(snapshot.displayLocale);
      if (snapshot.customFontSizeScale !== null) {
        customFontSizePercent.value = Math.round(snapshot.customFontSizeScale * 100);
      } else if (snapshot.fontSizeMode === 'custom') {
        customFontSizePercent.value = Math.round(snapshot.fontSizeScale * 100);
      }
    };

    const updatePreferences = async (changes: Partial<Preferences>) => {
      if (!preferences) return;
      const outcome = await preferences.update(changes);
      if (outcome.ok) return;
      applyPreferences(preferences.read());
      const alert = (window as any).poexdAlert;
      if (typeof alert === 'function') {
        await alert(
          t('settings.alert.saveFailedMessage', { message: outcome.error.message }),
          t('settings.alert.saveFailedTitle'),
        );
      }
    };

    onMounted(async () => {
      const outcome = await getPreferences(version);
      if (!outcome.ok) {
        const alert = (window as any).poexdAlert;
        if (typeof alert === 'function') {
          await alert(
            t('settings.alert.loadFailedMessage', { message: outcome.error.message }),
            t('settings.alert.loadFailedTitle'),
          );
        }
        return;
      }
      preferences = outcome.value;
      stopPreferences = preferences.subscribe(applyPreferences);

      emit('ready');
    });

    onUnmounted(() => {
      stopPreferences?.();
    });

    const handleFontSizeModeChange = (mode?: FontSizeMode | any) => {
      if (!mode) return;
      fontSizeMode.value = mode as FontSizeMode;
      if (mode === 'custom') {
        let scale: number;
        if (preferenceState.customFontSizeScale === null) {
          scale = preferenceState.fontSizeScale;
          customFontSizePercent.value = Math.round(scale * 100);
          void updatePreferences({
            fontSizeMode: 'custom',
            fontSizeScale: scale,
            customFontSizeScale: scale,
          });
        } else {
          scale = preferenceState.customFontSizeScale;
          if (scale < FONT_SIZE_SCALE_BOUNDS.min) scale = FONT_SIZE_SCALE_BOUNDS.min;
          if (scale > FONT_SIZE_SCALE_BOUNDS.max) scale = FONT_SIZE_SCALE_BOUNDS.max;
          customFontSizePercent.value = Math.round(scale * 100);
          fontSizeScale.value = scale;
          void updatePreferences({
            fontSizeMode: 'custom',
            fontSizeScale: scale,
          });
        }
      } else {
        const scale = FONT_SIZE_PRESETS[mode as FontSizePresetMode];
        fontSizeScale.value = scale;
        void updatePreferences({
          fontSizeMode: mode as FontSizeMode,
          fontSizeScale: scale,
        });
      }
    };

    const handleCustomFontSizeInput = (event?: Event) => {
      const targetVal = event?.target ? (event.target as HTMLInputElement).value : undefined;
      const raw =
        targetVal !== undefined && targetVal !== '' ? targetVal : customFontSizePercent.value;
      let pct = Number(raw);
      if (isNaN(pct)) return;

      if (pct >= fontSizePercentBounds.min && pct <= fontSizePercentBounds.max) {
        customFontSizePercent.value = pct;
        const scale = pct / 100;
        fontSizeScale.value = scale;
        fontSizeMode.value = 'custom';
        void updatePreferences({
          fontSizeMode: 'custom',
          fontSizeScale: scale,
          customFontSizeScale: scale,
        });
      }
    };

    const handleCustomFontSizeBlur = (event?: Event) => {
      const targetVal = event?.target ? (event.target as HTMLInputElement).value : undefined;
      const raw =
        targetVal !== undefined && targetVal !== '' ? targetVal : customFontSizePercent.value;
      let pct = Number(raw);
      if (isNaN(pct) || pct < fontSizePercentBounds.min) {
        pct = fontSizePercentBounds.min;
      } else if (pct > fontSizePercentBounds.max) {
        pct = fontSizePercentBounds.max;
      }
      customFontSizePercent.value = pct;
      const scale = pct / 100;
      fontSizeScale.value = scale;
      fontSizeMode.value = 'custom';
      void updatePreferences({
        fontSizeMode: 'custom',
        fontSizeScale: scale,
        customFontSizeScale: scale,
      });
    };

    const sectionOpen = reactive({
      appearance: true,
      searchHotkeys: true,
      tradeFeatures: true,
      bookmarks: true,
    });

    const handleSidebarPositionChange = (val?: any) => {
      const pos = Array.isArray(val) ? val[0] : val;
      if (pos === 'left' || pos === 'right') {
        sidebarPosition.value = pos;
        savePreference('sidebarPosition');
      }
    };

    const handleAddBookmarkBtnPositionChange = (val?: any) => {
      const pos = Array.isArray(val) ? val[0] : val;
      if (pos === 'top' || pos === 'bottom') {
        addBookmarkBtnPosition.value = pos;
        savePreference('addBookmarkBtnPosition');
      }
    };

    const handleSearchEntryClickActionChange = (val?: any) => {
      const action = Array.isArray(val) ? val[0] : val;
      if (action === 'open' || action === 'preview') {
        searchEntryClickAction.value = action;
        savePreference('searchEntryClickAction');
      }
    };

    const handleDensityChange = (val?: number | string | any) => {
      const numVal = typeof val === 'number' ? val : Number(val);
      if (!Number.isNaN(numVal)) {
        densityScale.value = numVal;
      }
      void updatePreferences({ densityScale: Number(densityScale.value) });
    };

    const isCompactDensity = computed({
      get: () => densityScale.value === 0.8,
      set: (checked: boolean) => {
        handleDensityChange(checked ? 0.8 : 1);
      },
    });

    const handleSizeChange = (val?: SidebarSize | any) => {
      if (val) {
        sidebarSize.value = val as SidebarSize;
      }
      if (sidebarSize.value === 'custom') {
        let width: number;
        if (preferenceState.customSidebarWidth === null) {
          width = preferenceState.sidebarWidth;
          void updatePreferences({
            sidebarSize: 'custom',
            sidebarWidth: width,
            customSidebarWidth: width,
          });
        } else {
          width = preferenceState.customSidebarWidth;
          if (width < SIDEBAR_WIDTH_BOUNDS.min) width = SIDEBAR_WIDTH_BOUNDS.min;
          if (width > SIDEBAR_WIDTH_BOUNDS.max) width = SIDEBAR_WIDTH_BOUNDS.max;
          void updatePreferences({
            sidebarSize: 'custom',
            sidebarWidth: width,
          });
        }
      } else {
        const width = SIDEBAR_SIZE_PRESETS[sidebarSize.value];
        void updatePreferences({
          sidebarSize: sidebarSize.value,
          sidebarWidth: width,
        });
      }
    };

    const savePreference = (key: keyof Preferences) => {
      void updatePreferences({
        [key]: preferenceState[key],
      } as Partial<Preferences>);
    };

    const saveTildeSettings = () => {
      void updatePreferences({
        enableSearchTilde: enableSearchTilde.value,
        enableFilterTilde: enableFilterTilde.value,
      });
    };

    return {
      t,
      sectionOpen,
      theme,
      THEME_LABELS,
      THEME_OPTIONS,
      displayLocale,
      DISPLAY_LOCALE_LABELS,
      DISPLAY_LOCALE_OPTIONS,
      sidebarPosition,
      SIDEBAR_POSITION_OPTIONS,
      sidebarSize,
      SIDEBAR_SIZE_LABELS,
      SIDEBAR_SIZE_OPTIONS,
      fontSizeScale,
      fontSizeMode,
      customFontSizePercent,
      fontSizePercentBounds,
      FONT_SIZE_MODE_LABELS,
      FONT_SIZE_MODE_OPTIONS,
      densityScale,
      BOOKMARK_BUTTON_POSITION_OPTIONS,
      SEARCH_ENTRY_CLICK_ACTION_LABELS,
      SEARCH_ENTRY_CLICK_ACTION_OPTIONS,
      searchEntryClickAction,
      handleSearchEntryClickActionChange,
      hotkeyFocus,
      hotkeyClear,
      enableHotkeys,
      enableItemNormalizer,
      enableSearchTilde,
      enableFilterTilde,
      enableTierHelper,
      enableAffixSelector,
      enableAutoTitle,
      enablePriceComparison,
      enableResultModHighlight,
      enableResultModQuickFilter,
      enablePureBackground,
      marketTranslation,
      marketTranslationBilingual,
      isPoe2: version === 'poe2',
      addBookmarkBtnPosition,
      enableBookmarkTooltip,
      SIDEBAR_WIDTH_BOUNDS,
      savePreference,
      handleSidebarPositionChange,
      handleAddBookmarkBtnPositionChange,
      handleSizeChange,
      handleFontSizeModeChange,
      handleCustomFontSizeInput,
      handleCustomFontSizeBlur,
      handleDensityChange,
      isCompactDensity,
      saveTildeSettings,
    };
  },
});
</script>
