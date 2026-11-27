<template>
  <SidebarPane data-pane="settings" class="pxd-settings-pane">
    <template #fixed>
      <!-- 頂部工具列：左側為區段跳轉按鈕（開啟搜尋時原地替換為搜尋框），右側固定為搜尋切換與備份選單 -->
      <div
        data-settings-toolbar
        class="mb-[var(--pxd-space-sm)] flex w-full min-w-0 items-start gap-[var(--pxd-space-sm)] border-b border-border pb-[var(--pxd-space-sm)]"
      >
        <div v-if="isSearchVisible" class="relative flex min-w-0 flex-1 items-center">
          <Search
            class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            size="sm"
            data-settings-search
            class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))] [&::-webkit-search-cancel-button]:appearance-none"
            :placeholder="t('settings.search.placeholder')"
            :aria-label="t('settings.search.placeholder')"
            @keydown.esc.stop.prevent="closeSearch"
          />
          <Button
            v-if="searchQuery"
            type="button"
            variant="ghost"
            size="icon-sm"
            class="absolute right-[var(--pxd-space-xs)]"
            data-settings-search-clear
            :title="t('common.clearSearch')"
            :aria-label="t('common.clearSearch')"
            @click="clearSearch"
          >
            <X />
          </Button>
        </div>

        <nav
          v-else
          data-settings-nav
          :aria-label="t('settings.nav.ariaLabel')"
          class="flex min-w-0 flex-1 flex-wrap items-center gap-[var(--pxd-space-xs)]"
        >
          <button
            v-for="item in SECTION_NAV_ITEMS"
            :key="item.id"
            type="button"
            :data-settings-nav-target="item.id"
            :data-active="activeSection === item.id ? 'true' : undefined"
            :class="[
              'inline-flex cursor-pointer items-center rounded-sm border px-[var(--pxd-space-xs)] py-[2px] text-[length:var(--pxd-font-caption)] leading-snug transition-colors',
              activeSection === item.id
                ? 'border-primary/50 bg-primary/15 font-medium text-foreground'
                : 'border-border/60 bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            ]"
            @click="openSection(item.id)"
          >
            {{ t(item.labelKey) }}
          </button>
        </nav>

        <div class="flex shrink-0 items-center gap-[var(--pxd-space-xs)]">
          <Button
            type="button"
            :variant="isSearchVisible ? 'default' : 'outline'"
            size="icon-sm"
            data-settings-search-toggle
            :aria-pressed="isSearchVisible"
            :title="
              isSearchVisible ? t('bookmark.search.closeTooltip') : t('settings.search.placeholder')
            "
            :aria-label="
              isSearchVisible ? t('bookmark.search.closeTooltip') : t('settings.search.placeholder')
            "
            @click="toggleSearch"
          >
            <Search />
          </Button>
          <SettingsBackupMenu :preferences="preferences" :version="version" />
        </div>
      </div>
    </template>

    <template #scroll>
      <div ref="sectionsRef" class="flex flex-col gap-[var(--pxd-section-gap)]">
        <!-- 群組一：官方交易頁 -->
        <div
          v-show="!isSearching"
          data-settings-group-heading="officialPage"
          class="flex items-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-xs)] pt-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] font-semibold tracking-wider text-muted-foreground"
        >
          <span class="shrink-0">{{ t('settings.group.officialPage') }}</span>
          <span class="h-px flex-1 bg-border/60" aria-hidden="true" />
        </div>

        <!-- 1. 語言與市集漢化 -->
        <SettingsSection
          section-id="localization"
          :title="t('settings.section.localization')"
          :icon="Languages"
          :highlighted="highlightedSection === 'localization'"
          :collapsed="collapsedSections.has('localization')"
          @toggle-collapse="toggleSectionCollapse('localization')"
        >
          <SettingsRow
            :label="t('settings.displayLocale.label')"
            :details="t('settings.displayLocale.tooltip')"
          >
            <Select
              v-model="displayLocale"
              data-test="display-locale"
              @update:model-value="savePreference('displayLocale')"
            >
              <SelectTrigger size="default" class="w-[140px] shrink-0">
                <SelectValue>{{ DISPLAY_LOCALE_LABELS[displayLocale] }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in DISPLAY_LOCALE_OPTIONS"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          <SettingsRow
            :label="t('settings.marketTranslation.label')"
            :details="t('settings.marketTranslation.tooltip')"
            :keywords="[
              t('popup.module.marketTranslation.description'),
              t('settings.marketTranslation.keywords'),
            ]"
            control-id="enable-market-translation"
          >
            <template #default="{ describedBy }">
              <Switch
                id="enable-market-translation"
                v-model="marketTranslation"
                :aria-describedby="describedBy"
                @update:model-value="savePreference('marketTranslation')"
              />
            </template>
          </SettingsRow>
          <template v-if="marketTranslation">
            <!-- 市集漢化子設定：中英並列、漢化資料快取與 pobb.in 漢化彼此平級，皆隸屬於市集漢化 -->
            <div class="flex flex-col gap-[var(--pxd-space-md)] pl-[var(--pxd-space-lg)]">
              <div
                v-show="!isSearching || marketTranslationBilingualMatchesSearch"
                data-settings-group="market-translation-bilingual"
                class="flex flex-col gap-[var(--pxd-space-sm)]"
              >
                <p
                  class="m-0 text-[length:var(--pxd-font-caption)] font-medium text-muted-foreground"
                >
                  {{ t('settings.marketTranslation.bilingualGroup') }}
                </p>
                <SettingsRow
                  :label="t('settings.marketTranslationBilingual.label')"
                  :details="t('settings.marketTranslationBilingual.tooltip')"
                  :keywords="[t('settings.marketTranslation.bilingualGroup')]"
                  control-id="enable-market-translation-bilingual"
                >
                  <template #default="{ describedBy }">
                    <Switch
                      id="enable-market-translation-bilingual"
                      v-model="marketTranslationBilingual"
                      :aria-describedby="describedBy"
                      @update:model-value="savePreference('marketTranslationBilingual')"
                    />
                  </template>
                </SettingsRow>
                <SettingsRow
                  :label="t('settings.marketTranslationResultBilingual.label')"
                  :details="t('settings.marketTranslationResultBilingual.tooltip')"
                  :keywords="[t('settings.marketTranslation.bilingualGroup')]"
                  control-id="enable-market-translation-result-bilingual"
                  guide-target="result-mod-en"
                  :guide-disabled="!marketTranslationResultBilingual"
                >
                  <template #default="{ describedBy }">
                    <Switch
                      id="enable-market-translation-result-bilingual"
                      v-model="marketTranslationResultBilingual"
                      :aria-describedby="describedBy"
                      @update:model-value="savePreference('marketTranslationResultBilingual')"
                    />
                  </template>
                </SettingsRow>
              </div>
              <div
                v-if="marketTranslationTargetLocale"
                class="flex flex-col gap-[var(--pxd-space-sm)] border-t border-border/50 pt-[var(--pxd-space-md)]"
              >
                <SettingsRow
                  :label="t('settings.marketTranslation.refresh.label')"
                  :details="t('settings.marketTranslation.refresh.tooltip')"
                  :keywords="[
                    t('settings.marketTranslation.label'),
                    t('settings.marketTranslation.keywords'),
                  ]"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    class="shrink-0"
                    data-test="market-translation-refresh-btn"
                    :disabled="marketTranslationRefreshing"
                    @click="refreshMarketTranslationCache"
                  >
                    {{ marketTranslationRefreshing ? t('common.updating') : t('common.updateNow') }}
                  </Button>
                </SettingsRow>
                <p
                  v-if="marketTranslationRefreshStatus === 'failed'"
                  data-test="market-translation-refresh-error"
                  role="status"
                  class="m-0 rounded-md border border-destructive/40 bg-destructive/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-destructive"
                >
                  {{ t('settings.marketTranslation.refresh.failed') }}
                </p>
              </div>
              <div
                class="flex flex-col gap-[var(--pxd-space-sm)] border-t border-border/50 pt-[var(--pxd-space-md)]"
              >
                <SettingsRow
                  :label="t('settings.marketTranslation.pobbin.label')"
                  :details="t('settings.marketTranslation.pobbin.tooltip')"
                  :keywords="[
                    'pobb.in',
                    'pob',
                    t('settings.marketTranslation.label'),
                    t('settings.marketTranslation.keywords'),
                  ]"
                >
                  <div class="flex shrink-0 items-center gap-[var(--pxd-space-sm)]">
                    <span
                      v-if="pobbinPermissionGranted !== null"
                      data-test="market-translation-pobbin-status"
                      class="text-[length:var(--pxd-font-caption)]"
                      :class="
                        pobbinPermissionGranted
                          ? 'text-primary font-medium'
                          : 'text-muted-foreground'
                      "
                    >
                      {{
                        pobbinPermissionGranted
                          ? t('settings.marketTranslation.pobbin.granted')
                          : t('settings.marketTranslation.pobbin.notGranted')
                      }}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="shrink-0"
                      data-test="market-translation-pobbin-permission"
                      @click="openPobSharePermissionPage"
                    >
                      {{ t('pobShare.settings.manageBtn') }}
                    </Button>
                  </div>
                </SettingsRow>
              </div>
            </div>
          </template>
          <p
            v-if="marketTranslationLocaleMismatch"
            data-test="market-translation-locale-hint"
            role="status"
            class="m-0 rounded-md border border-border bg-muted/50 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
          >
            {{ t('settings.marketTranslation.localeHint') }}
          </p>
          <div
            v-if="showMarketTranslationReload"
            data-test="market-translation-reload"
            role="status"
            class="flex items-center justify-between gap-[var(--pxd-space-sm)] rounded-md border border-primary/40 bg-primary/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-foreground"
          >
            <span>{{
              marketTranslationCacheUpdated && !marketTranslationReloadRequired
                ? t('settings.marketTranslation.refresh.updated')
                : t('common.reloadToApply')
            }}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="shrink-0"
              data-test="market-translation-reload-btn"
              @click="reloadPage"
            >
              {{ t('common.reload') }}
            </Button>
          </div>
        </SettingsSection>

        <!-- 2. 官網版面與頁面 -->
        <SettingsSection
          section-id="pageLayout"
          :title="t('settings.section.pageLayout')"
          :icon="PanelsTopLeft"
          :highlighted="highlightedSection === 'pageLayout'"
          :collapsed="collapsedSections.has('pageLayout')"
          @toggle-collapse="toggleSectionCollapse('pageLayout')"
        >
          <SettingsRow
            :label="t('settings.twoColumnLayout.label')"
            :details="t('settings.twoColumnLayout.tooltip')"
            :keywords="[t('settings.twoColumnLayout.keywords')]"
            control-id="enable-two-column-layout"
          >
            <template #default="{ describedBy }">
              <Switch
                id="enable-two-column-layout"
                v-model="enableTwoColumnLayout"
                :aria-describedby="describedBy"
                @update:model-value="savePreference('enableTwoColumnLayout')"
              />
            </template>
          </SettingsRow>
          <template v-if="enableTwoColumnLayout">
            <div
              v-show="!isSearching || twoColumnOptionsMatchSearch"
              data-settings-group="two-column-layout-options"
              class="flex flex-col gap-[var(--pxd-space-sm)] pl-[var(--pxd-space-lg)]"
            >
              <p
                v-if="twoColumnNarrowFallback"
                v-show="!isSearching || twoColumnHintMatchesSearch"
                data-test="two-column-narrow-hint"
                role="status"
                class="m-0 rounded-md border border-border bg-muted/50 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-muted-foreground"
              >
                {{ t('settings.twoColumnLayout.narrowHint') }}
              </p>
              <SettingsRow
                :label="t('settings.twoColumnMaxWidth.label')"
                :details="t('settings.twoColumnMaxWidth.tooltip')"
                :keywords="[t('settings.twoColumnLayout.keywords')]"
              >
                <Select
                  v-model="twoColumnMaxWidth"
                  data-test="two-column-max-width"
                  @update:model-value="savePreference('twoColumnMaxWidth')"
                >
                  <SelectTrigger size="default" class="w-[140px] shrink-0">
                    <SelectValue>{{ TWO_COLUMN_MAX_WIDTH_LABELS[twoColumnMaxWidth] }}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="opt in TWO_COLUMN_MAX_WIDTH_OPTIONS"
                      :key="opt.value"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </SettingsRow>
            </div>
          </template>

          <SettingsRow
            :label="t('settings.autoHideOfficialHeader.label')"
            :details="t('settings.autoHideOfficialHeader.tooltip')"
            :keywords="[t('settings.autoHideOfficialHeader.keywords')]"
            control-id="enable-auto-hide-official-header"
          >
            <template #default="{ describedBy }">
              <Switch
                id="enable-auto-hide-official-header"
                v-model="enableAutoHideOfficialHeader"
                :aria-describedby="describedBy"
                @update:model-value="savePreference('enableAutoHideOfficialHeader')"
              />
            </template>
          </SettingsRow>

          <SettingsRow
            :label="t('settings.pureBackground.label')"
            :details="t('settings.pureBackground.tooltip')"
            :keywords="[t('popup.module.enablePureBackground.description')]"
            control-id="enable-pure-background"
          >
            <template #default="{ describedBy }">
              <Switch
                id="enable-pure-background"
                v-model="enablePureBackground"
                :aria-describedby="describedBy"
                @update:model-value="savePreference('enablePureBackground')"
              />
            </template>
          </SettingsRow>

          <SettingsRow
            :label="t('settings.autoTitle.label')"
            :details="t('settings.autoTitle.tooltip')"
            :keywords="[t('popup.module.enableAutoTitle.description')]"
            control-id="enable-auto-title"
          >
            <template #default="{ describedBy }">
              <Switch
                id="enable-auto-title"
                v-model="enableAutoTitle"
                :aria-describedby="describedBy"
                @update:model-value="savePreference('enableAutoTitle')"
              />
            </template>
          </SettingsRow>
        </SettingsSection>

        <!-- 3. 搜尋表單與快捷鍵 -->
        <SettingsSection
          section-id="searchHotkeys"
          :title="t('settings.section.searchHotkeys')"
          :icon="Keyboard"
          :highlighted="highlightedSection === 'searchHotkeys'"
          :collapsed="collapsedSections.has('searchHotkeys')"
          @toggle-collapse="toggleSectionCollapse('searchHotkeys')"
        >
          <SettingsRow :label="t('settings.hotkeys.enable')" control-id="enable-hotkeys">
            <Switch
              id="enable-hotkeys"
              v-model="enableHotkeys"
              @update:model-value="savePreference('enableHotkeys')"
            />
          </SettingsRow>
          <template v-if="enableHotkeys">
            <SettingsRow nested :label="t('settings.hotkeys.focusLabel')">
              <SettingsHotkeyInput
                :model-value="hotkeyFocus"
                :aria-label="t('settings.hotkeys.focusLabel')"
                @update:model-value="handleHotkeyChange('hotkeyFocus', $event)"
              />
            </SettingsRow>
            <SettingsRow nested :label="t('settings.hotkeys.clearLabel')">
              <SettingsHotkeyInput
                :model-value="hotkeyClear"
                :aria-label="t('settings.hotkeys.clearLabel')"
                @update:model-value="handleHotkeyChange('hotkeyClear', $event)"
              />
            </SettingsRow>
          </template>

          <SettingsRow
            :label="t('settings.fuzzySearch.label')"
            :details="t('settings.fuzzySearch.tooltip')"
            :keywords="['~', t('settings.fuzzySearch.keywords')]"
            control-id="enable-fuzzy-search"
            guide-target="search-input"
          >
            <Switch id="enable-fuzzy-search" v-model="fuzzySearchEnabled" />
          </SettingsRow>

          <SettingsRow
            v-for="row in SEARCH_TOGGLE_ROWS"
            :key="row.id"
            :label="t(row.labelKey)"
            :details="t(row.detailsKey)"
            :keywords="row.keywordsKey ? [t(row.keywordsKey)] : []"
            :guide-target="row.guideTarget"
            :guide-disabled="!preferenceState[row.key]"
            :control-id="row.id"
          >
            <template #default="{ describedBy }">
              <Switch
                :id="row.id"
                :model-value="preferenceState[row.key]"
                :aria-describedby="describedBy"
                @update:model-value="setToggle(row.key, $event)"
              />
            </template>
          </SettingsRow>
        </SettingsSection>

        <!-- 4. 搜尋結果增強 -->
        <SettingsSection
          section-id="resultDisplay"
          :title="t('settings.section.resultDisplay')"
          :icon="ListChecks"
          :highlighted="highlightedSection === 'resultDisplay'"
          :collapsed="collapsedSections.has('resultDisplay')"
          @toggle-collapse="toggleSectionCollapse('resultDisplay')"
        >
          <template v-for="row in resultToggleRows" :key="row.id">
            <SettingsRow
              :label="t(row.labelKey)"
              :details="t(row.detailsKey)"
              :keywords="row.keywordsKey ? [t(row.keywordsKey)] : []"
              :guide-target="row.guideTarget"
              :guide-disabled="!preferenceState[row.key]"
              :control-id="row.id"
            >
              <template #default="{ describedBy }">
                <Switch
                  :id="row.id"
                  :model-value="preferenceState[row.key]"
                  :aria-describedby="describedBy"
                  @update:model-value="setToggle(row.key, $event)"
                />
              </template>
            </SettingsRow>
            <ResultModHighlightSettings
              v-if="row.key === 'enableResultModHighlight' && enableResultModHighlight"
              :highlight-style="resultModHighlightStyle"
              :highlight-color="resultModHighlightColor"
              @update:highlight-style="handleResultModHighlightStyleChange"
              @update:highlight-color="handleResultModHighlightColorChange"
            />
          </template>
        </SettingsSection>

        <!-- 群組二：PoeXD 側邊欄 -->
        <div
          v-show="!isSearching"
          data-settings-group-heading="sidebar"
          class="mt-[var(--pxd-space-sm)] flex items-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-xs)] pt-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)] font-semibold tracking-wider text-muted-foreground"
        >
          <span class="shrink-0">{{ t('settings.group.sidebar') }}</span>
          <span class="h-px flex-1 bg-border/60" aria-hidden="true" />
        </div>

        <!-- 5. 側邊欄外觀 -->
        <SettingsSection
          section-id="appearance"
          :title="t('settings.section.appearance')"
          :icon="Palette"
          :highlighted="highlightedSection === 'appearance'"
          :collapsed="collapsedSections.has('appearance')"
          @toggle-collapse="toggleSectionCollapse('appearance')"
        >
          <SettingsRow :label="t('settings.theme.label')" layout="stack">
            <div class="flex flex-wrap gap-[var(--pxd-space-xs)]" data-test="theme-preset-group">
              <Button
                v-for="themeId in THEME_IDS"
                :key="themeId"
                type="button"
                :variant="theme === themeId ? 'default' : 'outline'"
                size="sm"
                :aria-pressed="theme === themeId"
                :data-custom-preset="themeId"
                class="gap-[var(--control-gap-sm)] px-[var(--input-padding-x-sm)]"
                @click="selectThemePreset(themeId)"
              >
                <span
                  v-if="getThemeSwatchColors(themeId)"
                  class="inline-flex items-center -space-x-1 shrink-0"
                  aria-hidden="true"
                >
                  <span
                    class="size-2.5 rounded-full border border-border/80"
                    :style="{ backgroundColor: getThemeSwatchColors(themeId)!.background }"
                  />
                  <span
                    class="size-2.5 rounded-full border border-border/80"
                    :style="{ backgroundColor: getThemeSwatchColors(themeId)!.primary }"
                  />
                </span>
                <span>{{ THEME_LABELS[themeId] }}</span>
              </Button>
            </div>
          </SettingsRow>
          <div
            v-show="!isSearching || themeCustomMatchesSearch"
            data-settings-group="theme-custom-colors"
            :data-expanded="isThemeCustomExpanded ? 'true' : 'false'"
            class="flex flex-col gap-[var(--pxd-space-sm)]"
          >
            <button
              type="button"
              data-test="theme-custom-toggle"
              :aria-expanded="isThemeCustomExpanded"
              class="flex w-full cursor-pointer select-none items-center justify-between gap-[var(--pxd-space-sm)] rounded-md border-0 bg-transparent px-0 py-[var(--pxd-space-xs)] text-left text-[length:var(--pxd-font-secondary)] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              @click="toggleThemeCustom"
            >
              <span>{{ t('settings.theme.custom.toggle') }}</span>
              <ChevronDown
                :class="[
                  'size-[var(--control-icon-sm,14px)] shrink-0 transition-transform duration-200',
                  isThemeCustomExpanded ? '' : '-rotate-90',
                ]"
                aria-hidden="true"
              />
            </button>
            <div
              v-show="isThemeCustomExpanded"
              data-test="theme-custom-body"
              class="flex flex-col gap-[var(--pxd-space-sm)] pl-[var(--pxd-space-sm)]"
            >
              <p class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
                {{ t('settings.theme.custom.hint') }}
              </p>
              <SettingsRow
                v-for="row in themeCustomColorRows"
                :key="row.key"
                :label="t(row.labelKey)"
                :keywords="[t('settings.theme.label')]"
                :control-id="`theme-custom-${row.key}`"
              >
                <template #default="{ describedBy }">
                  <div class="flex items-center gap-[var(--pxd-space-sm)]">
                    <Input
                      type="text"
                      size="sm"
                      maxlength="7"
                      spellcheck="false"
                      autocomplete="off"
                      :data-custom-hex="row.key"
                      :aria-label="t('settings.theme.custom.hexAria', { label: t(row.labelKey) })"
                      :model-value="getThemeHexDisplayValue(row.key)"
                      class="w-[82px] text-center font-mono text-[length:var(--pxd-font-caption)] uppercase"
                      @input="handleThemeHexTextInput(row.key, $event)"
                      @blur="handleThemeHexTextBlur(row.key)"
                      @keydown.enter.prevent="handleThemeHexTextBlur(row.key)"
                    />
                    <input
                      :id="`theme-custom-${row.key}`"
                      type="color"
                      class="size-[var(--control-height-sm)] shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-border bg-transparent p-0"
                      :value="previewColors[row.key] ?? activeThemeValues[row.key]"
                      :aria-describedby="describedBy"
                      @input="handleThemeCustomColorInput(row.key, $event)"
                      @change="handleThemeCustomColorChange(row.key, $event)"
                    />
                  </div>
                </template>
              </SettingsRow>
              <SettingsRow
                :label="t('settings.theme.custom.radius')"
                :keywords="[t('settings.theme.label')]"
                layout="stack"
              >
                <div
                  role="group"
                  data-test="theme-custom-radius"
                  class="flex flex-wrap gap-[var(--pxd-space-xs)]"
                >
                  <Button
                    v-for="radius in THEME_CUSTOM_RADIUS_VALUES"
                    :key="radius"
                    type="button"
                    :variant="activeThemeValues.radius === radius ? 'default' : 'outline'"
                    size="sm"
                    :aria-pressed="activeThemeValues.radius === radius"
                    :data-custom-radius="radius"
                    class="flex-1"
                    @click="handleThemeCustomRadiusChange(radius)"
                  >
                    {{ t(`settings.theme.custom.radius.${radius}`) }}
                  </Button>
                </div>
              </SettingsRow>

              <!-- 即時元件與詞綴對比預覽 -->
              <div
                data-test="theme-live-preview"
                class="flex flex-col gap-[var(--pxd-space-sm)] rounded-md border border-border bg-background p-[var(--pxd-space-md)]"
              >
                <div class="flex items-center justify-between gap-[var(--pxd-space-xs)]">
                  <span class="text-[length:var(--pxd-font-micro)] text-muted-foreground">
                    {{ t('settings.theme.custom.preview') }}
                  </span>
                  <div class="flex items-center gap-[var(--pxd-space-xs)]">
                    <span
                      class="inline-flex items-center rounded-sm bg-primary px-1.5 py-0.5 text-[length:var(--pxd-font-micro)] font-medium text-primary-foreground"
                    >
                      {{ t('settings.theme.custom.previewPrimary') }}
                    </span>
                    <span
                      class="inline-flex items-center rounded-sm border border-border bg-secondary px-1.5 py-0.5 text-[length:var(--pxd-font-micro)] font-medium text-secondary-foreground"
                    >
                      {{ t('settings.theme.custom.previewSecondary') }}
                    </span>
                    <span
                      class="inline-flex items-center rounded-sm bg-destructive px-1.5 py-0.5 text-[length:var(--pxd-font-micro)] font-medium text-destructive-foreground"
                    >
                      {{ t('settings.theme.custom.previewDestructive') }}
                    </span>
                  </div>
                </div>
                <div
                  class="flex flex-wrap items-center gap-[var(--pxd-space-xs)] rounded-sm border border-border bg-card px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-micro)]"
                >
                  <span
                    class="pxd-stat-domain-badge rounded-sm px-1.5 py-0.5 font-medium"
                    data-stat-domain="implicit"
                    style="--pxd-stat-color: var(--pxd-stat-implicit)"
                  >
                    {{ t('settings.theme.custom.previewImplicit') }}
                  </span>
                  <span
                    class="pxd-stat-domain-badge rounded-sm px-1.5 py-0.5 font-medium"
                    data-stat-domain="crafted"
                    style="--pxd-stat-color: var(--pxd-stat-crafted)"
                  >
                    {{ t('settings.theme.custom.previewCrafted') }}
                  </span>
                  <span
                    class="pxd-stat-domain-badge rounded-sm px-1.5 py-0.5 font-medium"
                    data-stat-domain="fractured"
                    style="--pxd-stat-color: var(--pxd-stat-fractured)"
                  >
                    {{ t('settings.theme.custom.previewFractured') }}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-[var(--pxd-space-xs)]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="px-[var(--input-padding-x-sm)]"
                  data-test="theme-custom-copy"
                  @click="copyActiveThemeJson"
                >
                  {{
                    themeJsonCopied
                      ? t('settings.theme.custom.copiedJson')
                      : t('settings.theme.custom.copyJson')
                  }}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  class="px-[var(--input-padding-x-sm)]"
                  data-test="theme-custom-import"
                  @click="importCustomThemeJson"
                >
                  {{ t('settings.theme.custom.importJson') }}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="ml-auto px-[var(--input-padding-x-sm)]"
                  data-test="theme-custom-reset"
                  :disabled="!hasActiveThemeOverride"
                  @click="resetActiveThemeOverrides"
                >
                  {{ t('settings.theme.custom.reset') }}
                </Button>
              </div>
            </div>
          </div>

          <SettingsRow :label="t('settings.sidebarPosition.label')">
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
          </SettingsRow>

          <SettingsRow :label="t('settings.fontSize.label')">
            <FontSizeScaleControl
              :scale="fontSizeScale"
              @update:scale="handleFontSizeScaleChange"
            />
          </SettingsRow>

          <SettingsRow :label="t('settings.density.compactLabel')" control-id="density-compact">
            <Switch id="density-compact" v-model="isCompactDensity" />
          </SettingsRow>
        </SettingsSection>

        <!-- 6. 側邊欄模組 -->
        <SettingsSection
          section-id="modules"
          :title="t('settings.section.modules')"
          :icon="LayoutGrid"
          :highlighted="highlightedSection === 'modules'"
          :collapsed="collapsedSections.has('modules')"
          @toggle-collapse="toggleSectionCollapse('modules')"
        >
          <template #aside>
            <span
              data-settings-modules-count
              class="shrink-0 whitespace-nowrap text-[length:var(--pxd-font-caption)] tabular-nums text-muted-foreground"
            >
              {{
                t('settings.modules.enabledCount', {
                  count: enabledModuleCount,
                  total: SIDEBAR_MODULES.length,
                })
              }}
            </span>
          </template>
          <SidebarModuleSettings
            :values="moduleValues"
            @toggle="toggleModule"
            @open-pob-share-permission="openPobSharePermissionPage"
          />
        </SettingsSection>

        <!-- 搜尋無結果 -->
        <div
          v-if="isSearching && !hasSearchResults"
          data-settings-search-empty
          role="status"
          class="flex flex-col items-start gap-[var(--pxd-space-xs)] py-[var(--pxd-space-xl)]"
        >
          <p class="m-0 text-[length:var(--pxd-font-secondary)] font-medium text-foreground">
            {{ t('settings.search.empty', { query: searchQuery.trim() }) }}
          </p>
          <p class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
            {{ t('settings.search.emptyHint') }}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="mt-[var(--pxd-space-sm)]"
            @click="clearSearch"
          >
            {{ t('common.clearSearch') }}
          </Button>
        </div>
      </div>
    </template>
  </SidebarPane>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  toRefs,
  watch,
  type PropType,
} from 'vue';
import { useDebouncedRef } from './composables/useDebouncedSearch';
import type { SettingsFocusRequest } from '@/utils/release-highlights';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChevronDown,
  Keyboard,
  Languages,
  LayoutGrid,
  ListChecks,
  Palette,
  PanelsTopLeft,
  Search,
  X,
} from '@lucide/vue';
import SidebarPane from './layout/SidebarPane.vue';
import SettingsHotkeyInput from './settings/SettingsHotkeyInput.vue';
import FontSizeScaleControl from './settings/FontSizeScaleControl.vue';
import SettingsRow from './settings/SettingsRow.vue';
import SettingsSection from './settings/SettingsSection.vue';
import SettingsBackupMenu from './settings/SettingsBackupMenu.vue';
import SidebarModuleSettings from './settings/SidebarModuleSettings.vue';
import ResultModHighlightSettings from './settings/ResultModHighlightSettings.vue';
import { matchesSettingsQuery, provideSettingsSearch } from './settings/settings-search';
import {
  RESULT_TOGGLE_ROWS,
  SEARCH_TOGGLE_ROWS,
  filterRowsForVersion,
  type SettingsToggleRow,
} from './settings/settings-toggle-rows';
import { findSettingsScrollParent, scrollToSettingsSection } from './settings/settings-scroll';
import {
  SIDEBAR_MODULES,
  SIDEBAR_MODULE_PREFERENCE_KEYS,
  countEnabledSidebarModules,
  type SettingsSectionId,
  type SidebarModulePreferenceKey,
} from '@/utils/sidebar-modules';
import {
  DEFAULT_PREFERENCES,
  THEME_CUSTOM_RADIUS_VALUES,
  THEME_IDS,
  isValidHexColor,
  isValidThemeCustomRadius,
  type Preferences,
  type ResultModHighlightColor,
  type ResultModHighlightStyle,
  type ThemeCustomRadius,
  type ThemeId,
} from '@/utils/preferences-contract';
import {
  DEFAULT_THEME_OVERRIDES_JSON,
  THEME_PRESETS,
  isPresetThemeId,
  parseCustomThemeOverride,
  parseCustomThemeValues,
  parseThemeImportJson,
  resolveThemeEffectiveValues,
  serializeCustomThemeOverride,
  type ThemeCustomColorKey,
  type ThemeOverride,
} from '@/lib/theme/theme-contract';
import { previewThemeOverrideOnHost } from '@/lib/theme/theme-runtime';
import { findThemeHost } from '@/lib/theme/page-theme-bridge';
import {
  DISPLAY_LOCALE_LABELS,
  DISPLAY_LOCALE_OPTIONS,
  SIDEBAR_POSITION_OPTIONS,
  THEME_LABELS,
  TWO_COLUMN_MAX_WIDTH_LABELS,
  TWO_COLUMN_MAX_WIDTH_OPTIONS,
} from './settings/settings-ui-metadata';
import { setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { clampFontSizeScale } from '@/utils/appearance-preferences';
import { detectBrowserLocale } from '@/utils/locale-resolution';
import {
  buildMarketTranslationTogglePatch,
  isMarketTranslationDisplayLocale,
  isMarketTranslationReloadRequired,
  resolveMarketTranslationLocale,
} from '@/utils/market-translation';
import { getPreferences, type PreferencesModule } from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';
import { getPageLoadPreferences } from '@/utils/page-load-preferences';
import { TWO_COLUMN_NARROW_ATTR } from '@/utils/two-column-dom-contract';
import { extensionMessaging } from '@/utils/extension-protocol';
import { dispatchPoeEvent } from '@/utils/event-contracts';

export default defineComponent({
  name: 'SettingsPane',
  components: {
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    SettingsHotkeyInput,
    FontSizeScaleControl,
    SettingsRow,
    SettingsSection,
    SettingsBackupMenu,
    SidebarModuleSettings,
    ResultModHighlightSettings,
    SidebarPane,
    ToggleGroup,
    ToggleGroupItem,
    ChevronDown,
    Search,
    X,
  },
  props: {
    /** 由 Sidebar 發出的區塊跳轉請求（例如改版提示的新功能按鈕） */
    focusRequest: {
      type: Object as PropType<SettingsFocusRequest | null>,
      default: null,
    },
  },
  emits: ['ready'],
  setup(props, { emit }) {
    const version = getPoeVersion();

    const preferenceState = reactive<Preferences>({
      ...DEFAULT_PREFERENCES,
    });

    const {
      theme,
      displayLocale,
      sidebarPosition,
      sidebarWidth,
      fontSizeScale,
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
      resultModHighlightStyle,
      resultModHighlightColor,
      enableResultModQuickFilter,
      enableResultPobCopy,
      enableResultExternalLinks,
      enablePureBackground,
      enableTwoColumnLayout,
      enableAutoHideOfficialHeader,
      twoColumnMaxWidth,
      marketTranslation,
      marketTranslationBilingual,
      marketTranslationResultBilingual,
    } = toRefs(preferenceState);

    const marketTranslationLocaleMismatch = computed(
      () => marketTranslation.value && !isMarketTranslationDisplayLocale(displayLocale.value),
    );
    const marketTranslationTargetLocale = computed(() =>
      resolveMarketTranslationLocale({
        enabled: marketTranslation.value,
        displayLocale: displayLocale.value,
        hostname: 'www.pathofexile.com',
      }),
    );

    let pageLoadMarketBaseline: Readonly<Preferences> | null = null;
    const marketTranslationReloadRequired = ref(false);
    const marketTranslationRefreshing = ref(false);
    const marketTranslationRefreshStatus = ref<'idle' | 'updated' | 'failed'>('idle');
    const marketTranslationCacheUpdated = ref(false);
    const showMarketTranslationReload = computed(
      () => marketTranslationReloadRequired.value || marketTranslationCacheUpdated.value,
    );

    const refreshMarketTranslationCache = async () => {
      const locale = marketTranslationTargetLocale.value;
      if (!locale || marketTranslationRefreshing.value) return;
      marketTranslationRefreshing.value = true;
      marketTranslationRefreshStatus.value = 'idle';
      try {
        const outcome = await extensionMessaging.sendMessage('marketTranslation:refresh', {
          version,
          locale,
          force: true,
        });
        if (outcome.ok) {
          marketTranslationRefreshStatus.value = 'updated';
          marketTranslationCacheUpdated.value = true;
        } else {
          marketTranslationRefreshStatus.value = 'failed';
        }
      } catch (error: unknown) {
        console.error('[Settings] 無法強制更新市集漢化快取:', error);
        marketTranslationRefreshStatus.value = 'failed';
      } finally {
        marketTranslationRefreshing.value = false;
      }
    };

    const reloadPage = () => {
      window.location.reload();
    };

    // 拖動調色盤時的輕量預覽狀態：避免每幀反序列化 JSON、重繪整個設定頁與重寫宿主頁 <style>
    const previewColors = reactive<Partial<Record<ThemeCustomColorKey, string>>>({});
    let pendingPreviewPatch: ThemeOverride = {};
    let queuedRafPatch: ThemeOverride = {};
    let previewRafId: number | undefined;
    let pendingOverridesSaveTimer: ReturnType<typeof setTimeout> | undefined;

    const clearPreviewColors = () => {
      for (const key of Object.keys(previewColors) as ThemeCustomColorKey[]) {
        delete previewColors[key];
      }
    };

    const cancelPreviewRaf = () => {
      if (previewRafId !== undefined && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(previewRafId);
      }
      previewRafId = undefined;
      queuedRafPatch = {};
    };

    const clearPendingColorSave = () => {
      if (pendingOverridesSaveTimer !== undefined) {
        clearTimeout(pendingOverridesSaveTimer);
        pendingOverridesSaveTimer = undefined;
      }
      cancelPreviewRaf();
      pendingPreviewPatch = {};
      clearPreviewColors();
    };

    const commitThemeOverridePatch = (patch: ThemeOverride) => {
      const base =
        theme.value === 'custom'
          ? parseCustomThemeValues(preferenceState.themeCustomOverrides)
          : resolveThemeEffectiveValues(theme.value, preferenceState.themeCustomOverrides);
      const serialized = serializeCustomThemeOverride({ ...base, ...patch });
      preferenceState.theme = 'custom';
      preferenceState.themeCustomOverrides = serialized;
      void updatePreferences({ theme: 'custom', themeCustomOverrides: serialized });
    };

    const flushPendingColorSave = () => {
      if (pendingOverridesSaveTimer !== undefined) {
        clearTimeout(pendingOverridesSaveTimer);
        pendingOverridesSaveTimer = undefined;
      }
      cancelPreviewRaf();
      if (Object.keys(pendingPreviewPatch).length === 0) return;
      const patch = pendingPreviewPatch;
      pendingPreviewPatch = {};
      clearPreviewColors();
      commitThemeOverridePatch(patch);
    };

    const preferences = ref<PreferencesModule | null>(null);
    let stopPreferences: (() => void) | undefined;
    const applyPreferences = (snapshot: Readonly<Preferences>) => {
      Object.assign(preferenceState, snapshot);
      setActiveDisplayLocalePreference(snapshot.displayLocale);
      if (pageLoadMarketBaseline === null) {
        // 設定分頁第一次打開才掛載：基準要用開頁時的偏好，不是掛載當下的
        pageLoadMarketBaseline = getPageLoadPreferences() ?? snapshot;
      }
      marketTranslationReloadRequired.value = isMarketTranslationReloadRequired(
        pageLoadMarketBaseline,
        snapshot,
        {
          hostname: typeof window !== 'undefined' ? window.location.hostname : '',
          browserLocale: detectBrowserLocale(),
        },
      );
    };

    const updatePreferences = async (changes: Partial<Preferences>) => {
      if (!preferences.value) return;
      const outcome = await preferences.value.update(changes);
      if (outcome.ok) return;
      applyPreferences(preferences.value.read());
      const alert = (window as any).poexdAlert;
      if (typeof alert === 'function') {
        await alert(
          t('settings.alert.saveFailedMessage', { message: outcome.error.message }),
          t('common.saveFailed'),
        );
      }
    };

    const twoColumnNarrowFallback = ref(false);
    const syncTwoColumnNarrowState = () => {
      twoColumnNarrowFallback.value =
        typeof document !== 'undefined' &&
        document.documentElement.getAttribute(TWO_COLUMN_NARROW_ATTR) === 'true';
    };
    let twoColumnAttrObserver: MutationObserver | null = null;

    onMounted(async () => {
      void refreshPobbinPermission();
      window.addEventListener('focus', refreshPobbinPermission);
      syncTwoColumnNarrowState();
      if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        twoColumnAttrObserver = new MutationObserver(() => syncTwoColumnNarrowState());
        twoColumnAttrObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: [TWO_COLUMN_NARROW_ATTR],
        });
      }

      const scrollEl = findSettingsScrollParent(sectionsRef.value);
      if (scrollEl) {
        const onScroll = () => syncActiveSectionFromScroll();
        scrollEl.addEventListener('scroll', onScroll, { passive: true });
        stopScrollSpy = () => scrollEl.removeEventListener('scroll', onScroll);
        syncActiveSectionFromScroll();
      }

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
      preferences.value = outcome.value;
      stopPreferences = outcome.value.subscribe(applyPreferences);

      emit('ready');
    });

    onUnmounted(() => {
      window.removeEventListener('focus', refreshPobbinPermission);
      twoColumnAttrObserver?.disconnect();
      twoColumnAttrObserver = null;
      stopPreferences?.();
      stopScrollSpy?.();
      clearTimeout(highlightTimer);
      clearPendingColorSave();
      if (themeJsonCopiedTimer !== undefined) {
        clearTimeout(themeJsonCopiedTimer);
        themeJsonCopiedTimer = undefined;
      }
    });

    const handleFontSizeScaleChange = (scale: number) => {
      const clamped = clampFontSizeScale(scale);
      fontSizeScale.value = clamped;
      void updatePreferences({ fontSizeScale: clamped });
    };

    const handleSidebarPositionChange = (val?: any) => {
      const pos = Array.isArray(val) ? val[0] : val;
      if (pos === 'left' || pos === 'right') {
        sidebarPosition.value = pos;
        savePreference('sidebarPosition');
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

    // 每個主題皆可獨立微調五個核心色與圓角段位，其餘語意色依此自動推導
    const themeCustomColorRows = [
      { key: 'background', labelKey: 'settings.theme.custom.background' },
      { key: 'card', labelKey: 'settings.theme.custom.card' },
      { key: 'foreground', labelKey: 'settings.theme.custom.foreground' },
      { key: 'primary', labelKey: 'settings.theme.custom.primary' },
      { key: 'destructive', labelKey: 'settings.theme.custom.destructive' },
    ] as const satisfies ReadonlyArray<{ key: ThemeCustomColorKey; labelKey: string }>;

    const activeThemeValues = computed(() =>
      resolveThemeEffectiveValues(theme.value, preferenceState.themeCustomOverrides),
    );
    const hasActiveThemeOverride = computed(
      () =>
        theme.value === 'custom' &&
        Object.keys(parseCustomThemeOverride(preferenceState.themeCustomOverrides)).length > 0,
    );

    // 優先取設定頁所在的 ShadowRoot host，避免 toast-host 覆蓋 activeThemeHost 導致拖動色盤預覽打錯目標
    const resolveSettingsThemeHost = (): HTMLElement | null => {
      const root = sectionsRef.value?.getRootNode?.();
      if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host) {
        return root.host as HTMLElement;
      }
      return findThemeHost();
    };

    const applyPreviewPatchFrame = (patch: ThemeOverride) => {
      Object.assign(previewColors, patch);
      previewThemeOverrideOnHost(resolveSettingsThemeHost(), patch);
    };

    const schedulePreviewPatch = (patch: ThemeOverride) => {
      // 從內建主題開始拖動時，先把該內建主題色票當成自訂底色一併寫入，避免畫面跳色
      const firstFramePatch =
        theme.value !== 'custom' ? { ...activeThemeValues.value, ...patch } : patch;
      if (theme.value !== 'custom') {
        preferenceState.theme = 'custom';
      }
      if (typeof requestAnimationFrame !== 'function') {
        applyPreviewPatchFrame(firstFramePatch);
        return;
      }
      if (previewRafId === undefined) {
        // 首幀立即套用，同一 16ms 幀內的後續拖動合併到下一幀
        applyPreviewPatchFrame(firstFramePatch);
        previewRafId = requestAnimationFrame(() => {
          previewRafId = undefined;
          if (Object.keys(queuedRafPatch).length > 0) {
            const next = queuedRafPatch;
            queuedRafPatch = {};
            applyPreviewPatchFrame(next);
          }
        });
      } else {
        queuedRafPatch = { ...queuedRafPatch, ...firstFramePatch };
      }
    };

    const queueThemeColorPreview = (key: ThemeCustomColorKey, hex: string) => {
      // 若尚未進入 custom，將起點色票一併納入 pendingPreviewPatch，確保提交時完整保存
      if (theme.value !== 'custom' && Object.keys(pendingPreviewPatch).length === 0) {
        pendingPreviewPatch = { ...activeThemeValues.value, [key]: hex };
      } else {
        pendingPreviewPatch = { ...pendingPreviewPatch, [key]: hex };
      }
      schedulePreviewPatch({ [key]: hex });
      if (pendingOverridesSaveTimer !== undefined) clearTimeout(pendingOverridesSaveTimer);
      pendingOverridesSaveTimer = setTimeout(flushPendingColorSave, 250);
    };

    const handleThemeCustomColorInput = (key: ThemeCustomColorKey, event: Event) => {
      const value = (event.target as HTMLInputElement | null)?.value;
      if (!isValidHexColor(value)) return;
      queueThemeColorPreview(key, value.toLowerCase());
    };

    const handleThemeCustomColorChange = (key: ThemeCustomColorKey, event: Event) => {
      const value = (event.target as HTMLInputElement | null)?.value;
      if (!isValidHexColor(value)) return;
      pendingPreviewPatch = { ...pendingPreviewPatch, [key]: value.toLowerCase() };
      flushPendingColorSave();
    };

    const handleThemeCustomRadiusChange = (radius: ThemeCustomRadius) => {
      if (!isValidThemeCustomRadius(radius)) return;
      pendingPreviewPatch = { ...pendingPreviewPatch, radius };
      flushPendingColorSave();
    };

    const themeCustomExpanded = ref(false);
    const toggleThemeCustom = () => {
      themeCustomExpanded.value = !themeCustomExpanded.value;
    };

    const selectThemePreset = (themeId: ThemeId) => {
      flushPendingColorSave();
      clearHexTextDrafts();
      preferenceState.theme = themeId;
      if (themeId === 'custom') themeCustomExpanded.value = true;
      void updatePreferences({ theme: themeId });
    };

    const resetActiveThemeOverrides = () => {
      clearPendingColorSave();
      clearHexTextDrafts();
      preferenceState.themeCustomOverrides = DEFAULT_THEME_OVERRIDES_JSON;
      void updatePreferences({ themeCustomOverrides: DEFAULT_THEME_OVERRIDES_JSON });
    };

    const hexTextDrafts = reactive<Partial<Record<ThemeCustomColorKey, string>>>({});
    const clearHexTextDrafts = () => {
      for (const key of Object.keys(hexTextDrafts) as ThemeCustomColorKey[]) {
        delete hexTextDrafts[key];
      }
    };

    const getThemeHexDisplayValue = (key: ThemeCustomColorKey): string =>
      hexTextDrafts[key] ?? (previewColors[key] ?? activeThemeValues.value[key]).toUpperCase();

    const normalizeHexTextInput = (raw: string): string | null => {
      const trimmed = raw.trim();
      const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      return isValidHexColor(candidate) ? candidate.toLowerCase() : null;
    };

    const handleThemeHexTextInput = (key: ThemeCustomColorKey, event: Event) => {
      const raw = (event.target as HTMLInputElement | null)?.value ?? '';
      hexTextDrafts[key] = raw.toUpperCase();
      const normalized = normalizeHexTextInput(raw);
      if (!normalized) return;
      queueThemeColorPreview(key, normalized);
    };

    const handleThemeHexTextBlur = (key: ThemeCustomColorKey) => {
      const draft = hexTextDrafts[key];
      delete hexTextDrafts[key];
      if (draft === undefined) return;
      const normalized = normalizeHexTextInput(draft);
      if (!normalized) return;
      pendingPreviewPatch = { ...pendingPreviewPatch, [key]: normalized };
      flushPendingColorSave();
    };

    const getThemeSwatchColors = (
      themeId: ThemeId,
    ): { background: string; primary: string } | null => {
      if (isPresetThemeId(themeId)) {
        const preset = THEME_PRESETS[themeId];
        return { background: preset.background, primary: preset.primary };
      }
      return null;
    };

    const themeJsonCopied = ref(false);
    let themeJsonCopiedTimer: ReturnType<typeof setTimeout> | undefined;

    const copyActiveThemeJson = async () => {
      const payload = JSON.stringify(activeThemeValues.value, null, 2);
      try {
        await navigator.clipboard?.writeText?.(payload);
        themeJsonCopied.value = true;
        if (themeJsonCopiedTimer !== undefined) clearTimeout(themeJsonCopiedTimer);
        themeJsonCopiedTimer = setTimeout(() => {
          themeJsonCopied.value = false;
          themeJsonCopiedTimer = undefined;
        }, 1500);
      } catch {
        // Clipboard API unavailable in restricted contexts
      }
    };

    const importCustomThemeJson = async () => {
      const promptFn = (
        window as { poexdPrompt?: (msg: string, def?: string) => Promise<string | null> }
      ).poexdPrompt;
      const raw =
        typeof promptFn === 'function'
          ? await promptFn(t('settings.theme.custom.importPrompt'), '')
          : typeof window !== 'undefined' && typeof window.prompt === 'function'
            ? window.prompt(t('settings.theme.custom.importPrompt'), '')
            : null;
      if (!raw) return;
      const parsed = parseThemeImportJson(raw);
      if (!parsed) {
        const alertFn = (window as { poexdAlert?: (msg: string, title?: string) => Promise<void> })
          .poexdAlert;
        if (typeof alertFn === 'function') {
          await alertFn(
            t('settings.theme.custom.importInvalid'),
            t('settings.theme.custom.importJson'),
          );
        } else if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          window.alert(t('settings.theme.custom.importInvalid'));
        }
        return;
      }
      clearPendingColorSave();
      clearHexTextDrafts();
      const serialized = serializeCustomThemeOverride(parsed);
      preferenceState.theme = 'custom';
      preferenceState.themeCustomOverrides = serialized;
      void updatePreferences({ theme: 'custom', themeCustomOverrides: serialized });
    };

    const savePreference = (key: keyof Preferences) => {
      if (key === 'marketTranslation') {
        const patch = buildMarketTranslationTogglePatch(
          preferenceState.marketTranslation,
          preferenceState.displayLocale,
        );
        if (patch.displayLocale) preferenceState.displayLocale = patch.displayLocale;
        void updatePreferences(patch);
        return;
      }
      void updatePreferences({
        [key]: preferenceState[key],
      } as Partial<Preferences>);
    };

    const handleHotkeyChange = (key: 'hotkeyFocus' | 'hotkeyClear', value: string) => {
      const otherKey: 'hotkeyFocus' | 'hotkeyClear' =
        key === 'hotkeyFocus' ? 'hotkeyClear' : 'hotkeyFocus';
      preferenceState[key] = value;
      if (value && preferenceState[otherKey] === value) {
        preferenceState[otherKey] = '';
        void updatePreferences({ [key]: value, [otherKey]: '' });
        dispatchPoeEvent('poexd-toast', {
          message: t('settings.hotkeys.conflictCleared', {
            key: value,
            cleared: t(
              otherKey === 'hotkeyFocus'
                ? 'settings.hotkeys.focusLabel'
                : 'settings.hotkeys.clearLabel',
            ),
          }),
        });
        return;
      }
      savePreference(key);
    };

    /** 模糊搜尋：道具名稱與詞綴篩選兩處共用一個開關，偏好仍分兩個鍵儲存 */
    const fuzzySearchEnabled = computed({
      get: () => enableSearchTilde.value || enableFilterTilde.value,
      set: (enabled: boolean) => {
        enableSearchTilde.value = enabled;
        enableFilterTilde.value = enabled;
        void updatePreferences({ enableSearchTilde: enabled, enableFilterTilde: enabled });
      },
    });

    const setToggle = (key: SettingsToggleRow['key'], value: boolean | 'indeterminate') => {
      (preferenceState[key] as boolean) = value === true;
      savePreference(key);
    };
    const handleResultModHighlightStyleChange = (value: ResultModHighlightStyle) => {
      resultModHighlightStyle.value = value;
      savePreference('resultModHighlightStyle');
    };
    const handleResultModHighlightColorChange = (value: ResultModHighlightColor) => {
      resultModHighlightColor.value = value;
      savePreference('resultModHighlightColor');
    };
    const resultToggleRows = filterRowsForVersion(RESULT_TOGGLE_ROWS, version);

    // Sidebar Module 開關
    const moduleValues = computed(
      () =>
        Object.fromEntries(
          SIDEBAR_MODULE_PREFERENCE_KEYS.map((key) => [key, preferenceState[key]]),
        ) as Record<SidebarModulePreferenceKey, boolean>,
    );
    const enabledModuleCount = computed(() => countEnabledSidebarModules(preferenceState));
    const toggleModule = (key: SidebarModulePreferenceKey, value: boolean) => {
      preferenceState[key] = value;
      savePreference(key);
    };

    // 設定搜尋：點擊放大鏡按鈕展開輸入框（取代跳轉按鈕區），搜尋時跨區塊列出符合的設定
    const isSearchVisible = ref(false);
    const searchQuery = ref('');
    const debouncedSearchQuery = useDebouncedRef(searchQuery);
    const searchInputRef = ref<InstanceType<typeof Input> | null>(null);
    const { isSearching, hasResults: hasSearchResults } =
      provideSettingsSearch(debouncedSearchQuery);
    const marketTranslationBilingualMatchesSearch = computed(() => {
      if (!isSearching.value) return false;
      return matchesSettingsQuery(debouncedSearchQuery.value, [
        t('settings.section.localization'),
        t('settings.marketTranslation.bilingualGroup'),
        t('settings.marketTranslationBilingual.label'),
        t('settings.marketTranslationBilingual.tooltip'),
        t('settings.marketTranslationResultBilingual.label'),
        t('settings.marketTranslationResultBilingual.tooltip'),
      ]);
    });
    const twoColumnHintMatchesSearch = computed(() => {
      if (!isSearching.value) return false;
      return matchesSettingsQuery(debouncedSearchQuery.value, [
        t('settings.section.pageLayout'),
        t('settings.twoColumnLayout.label'),
        t('settings.twoColumnLayout.tooltip'),
        t('settings.twoColumnLayout.keywords'),
        t('settings.twoColumnLayout.narrowHint'),
      ]);
    });
    const twoColumnOptionsMatchSearch = computed(() => {
      if (!isSearching.value) return false;
      return (
        twoColumnHintMatchesSearch.value ||
        matchesSettingsQuery(debouncedSearchQuery.value, [
          t('settings.twoColumnMaxWidth.label'),
          t('settings.twoColumnMaxWidth.tooltip'),
        ])
      );
    });
    const themeCustomMatchesSearch = computed(() => {
      if (!isSearching.value) return false;
      return matchesSettingsQuery(debouncedSearchQuery.value, [
        t('settings.section.appearance'),
        t('settings.theme.label'),
        t('settings.theme.custom.toggle'),
        t('settings.theme.custom.radius'),
        ...themeCustomColorRows.map((row) => t(row.labelKey)),
      ]);
    });
    const isThemeCustomExpanded = computed(
      () => themeCustomExpanded.value || themeCustomMatchesSearch.value,
    );
    const clearSearch = () => {
      searchQuery.value = '';
    };
    const closeSearch = () => {
      isSearchVisible.value = false;
      searchQuery.value = '';
    };
    const toggleSearch = async () => {
      if (isSearchVisible.value) {
        closeSearch();
        return;
      }
      isSearchVisible.value = true;
      await nextTick();
      (searchInputRef.value?.$el as HTMLInputElement | undefined)?.focus?.();
    };

    const SECTION_NAV_ITEMS: readonly {
      id: SettingsSectionId;
      labelKey: `settings.nav.${SettingsSectionId}`;
    }[] = [
      { id: 'localization', labelKey: 'settings.nav.localization' },
      { id: 'pageLayout', labelKey: 'settings.nav.pageLayout' },
      { id: 'searchHotkeys', labelKey: 'settings.nav.searchHotkeys' },
      { id: 'resultDisplay', labelKey: 'settings.nav.resultDisplay' },
      { id: 'appearance', labelKey: 'settings.nav.appearance' },
      { id: 'modules', labelKey: 'settings.nav.modules' },
    ];

    // 預設只展開「語言與市集漢化」，其餘分類預設收合成目錄，避免一次攤開所有開關造成視覺雜訊
    const DEFAULT_COLLAPSED_SECTIONS: readonly SettingsSectionId[] = [
      'pageLayout',
      'searchHotkeys',
      'resultDisplay',
      'appearance',
      'modules',
    ];

    // 模組列的「相關設定」與分類快速跳轉：展開目標區、捲到對應區塊並短暫高亮提示
    const sectionsRef = ref<HTMLElement | null>(null);
    const activeSection = ref<SettingsSectionId>('localization');
    const highlightedSection = ref<SettingsSectionId | null>(null);
    const collapsedSections = ref<ReadonlySet<SettingsSectionId>>(
      new Set(DEFAULT_COLLAPSED_SECTIONS),
    );
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let stopScrollSpy: (() => void) | undefined;

    const toggleSectionCollapse = (section: SettingsSectionId) => {
      const next = new Set(collapsedSections.value);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      collapsedSections.value = next;
    };

    const expandSection = (section: SettingsSectionId) => {
      if (!collapsedSections.value.has(section)) return;
      const next = new Set(collapsedSections.value);
      next.delete(section);
      collapsedSections.value = next;
    };

    const syncActiveSectionFromScroll = () => {
      const root = sectionsRef.value;
      const scrollEl = findSettingsScrollParent(root);
      if (!root || !scrollEl) return;
      const scrollTop = scrollEl.getBoundingClientRect().top + 24;
      let current: SettingsSectionId = SECTION_NAV_ITEMS[0].id;
      for (const item of SECTION_NAV_ITEMS) {
        const el = root.querySelector<HTMLElement>(`[data-settings-section="${item.id}"]`);
        if (!el || el.offsetParent === null) continue;
        if (el.getBoundingClientRect().top <= scrollTop) current = item.id;
      }
      activeSection.value = current;
    };

    const triggerSectionHighlight = (section: SettingsSectionId) => {
      clearTimeout(highlightTimer);
      highlightedSection.value = section;
      highlightTimer = setTimeout(() => {
        if (highlightedSection.value === section) highlightedSection.value = null;
      }, 1600);
    };
    const openSection = (section: SettingsSectionId) => {
      const wasSearching = isSearching.value || isSearchVisible.value;
      const wasCollapsed = collapsedSections.value.has(section);
      closeSearch();
      expandSection(section);
      activeSection.value = section;
      triggerSectionHighlight(section);
      const scroll = () => scrollToSettingsSection(sectionsRef.value, section);
      // 清除搜尋或展開區塊會改變版面高度，等更新後再捲
      if (wasSearching || wasCollapsed) void nextTick(scroll);
      else scroll();
    };
    // 分頁可能剛掛載或剛由 v-show 顯示，等 DOM 更新後再捲動
    watch(
      () => props.focusRequest?.seq,
      () => {
        const section = props.focusRequest?.section;
        if (section) void nextTick(() => openSection(section));
      },
      { immediate: true, flush: 'post' },
    );

    const pobbinPermissionGranted = ref<boolean | null>(null);
    const refreshPobbinPermission = () => {
      void extensionMessaging
        .sendMessage('pobShare:hasPobbinPermission')
        .then((granted) => {
          pobbinPermissionGranted.value = Boolean(granted);
        })
        .catch(() => {
          pobbinPermissionGranted.value = null;
        });
    };

    const openPobSharePermissionPage = () => {
      void extensionMessaging.sendMessage('pobShare:openPermissionPage').catch((error: unknown) => {
        console.error('[Settings] 無法開啟 PoB 分享網址授權頁:', error);
      });
    };

    return {
      t,
      version,
      preferences,
      pobbinPermissionGranted,
      openPobSharePermissionPage,
      preferenceState,
      SEARCH_TOGGLE_ROWS,
      resultToggleRows,
      setToggle,
      SIDEBAR_MODULES,
      moduleValues,
      enabledModuleCount,
      toggleModule,
      isSearchVisible,
      searchQuery,
      searchInputRef,
      isSearching,
      hasSearchResults,
      clearSearch,
      closeSearch,
      toggleSearch,
      SECTION_NAV_ITEMS,
      sectionsRef,
      activeSection,
      highlightedSection,
      collapsedSections,
      toggleSectionCollapse,
      openSection,
      Languages,
      LayoutGrid,
      Palette,
      PanelsTopLeft,
      Keyboard,
      ListChecks,
      theme,
      THEME_IDS,
      THEME_LABELS,
      THEME_CUSTOM_RADIUS_VALUES,
      themeCustomColorRows,
      isThemeCustomExpanded,
      themeCustomMatchesSearch,
      marketTranslationBilingualMatchesSearch,
      twoColumnHintMatchesSearch,
      twoColumnOptionsMatchSearch,
      toggleThemeCustom,
      previewColors,
      activeThemeValues,
      hasActiveThemeOverride,
      handleThemeCustomColorInput,
      handleThemeCustomColorChange,
      handleThemeCustomRadiusChange,
      getThemeHexDisplayValue,
      handleThemeHexTextInput,
      handleThemeHexTextBlur,
      getThemeSwatchColors,
      themeJsonCopied,
      copyActiveThemeJson,
      importCustomThemeJson,
      selectThemePreset,
      resetActiveThemeOverrides,
      displayLocale,
      DISPLAY_LOCALE_LABELS,
      DISPLAY_LOCALE_OPTIONS,
      sidebarPosition,
      SIDEBAR_POSITION_OPTIONS,
      TWO_COLUMN_MAX_WIDTH_LABELS,
      TWO_COLUMN_MAX_WIDTH_OPTIONS,
      fontSizeScale,
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
      resultModHighlightStyle,
      resultModHighlightColor,
      enableResultModQuickFilter,
      enableResultPobCopy,
      enableResultExternalLinks,
      enablePureBackground,
      enableTwoColumnLayout,
      enableAutoHideOfficialHeader,
      twoColumnNarrowFallback,
      twoColumnMaxWidth,
      marketTranslation,
      marketTranslationBilingual,
      marketTranslationResultBilingual,
      marketTranslationLocaleMismatch,
      marketTranslationTargetLocale,
      marketTranslationReloadRequired,
      marketTranslationRefreshing,
      marketTranslationRefreshStatus,
      marketTranslationCacheUpdated,
      showMarketTranslationReload,
      refreshMarketTranslationCache,
      reloadPage,
      isPoe2: version === 'poe2',
      savePreference,
      handleHotkeyChange,
      handleSidebarPositionChange,
      handleFontSizeScaleChange,
      handleDensityChange,
      handleResultModHighlightStyleChange,
      handleResultModHighlightColorChange,
      isCompactDensity,
      fuzzySearchEnabled,
    };
  },
});
</script>
