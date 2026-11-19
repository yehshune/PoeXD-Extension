<template>
  <div class="pxd-settings-pane flex flex-col" data-settings-pane>
    <!-- 分頁與搜尋：固定在捲動區頂端；搜尋展開時取代分頁列，與書籤、釘選分頁相同 -->
    <div
      data-settings-toolbar
      class="sticky top-[calc(var(--pxd-pane-padding)*-1)] z-(--pxd-z-sticky) -mx-[var(--pxd-pane-padding)] -mt-[var(--pxd-pane-padding)] mb-[var(--pxd-space-lg)] flex items-center gap-[var(--pxd-space-sm)] border-b border-border bg-background px-[var(--pxd-pane-padding)] pt-[var(--pxd-pane-padding)] pb-[var(--pxd-space-md)]"
    >
      <div
        v-if="!isSearchOpen"
        role="tablist"
        data-settings-tablist
        :aria-label="t('settings.tabs.aria')"
        class="pxd-settings-tabs flex min-w-0 flex-1 gap-[2px] overflow-x-auto rounded-md border border-border p-[2px]"
        @keydown="handleTabKeydown"
      >
        <button
          v-for="section in SETTINGS_SECTION_IDS"
          :id="`pxd-settings-tab-${section}`"
          :key="section"
          type="button"
          role="tab"
          :data-settings-tab="section"
          :aria-selected="activeSection === section"
          :tabindex="activeSection === section ? 0 : -1"
          class="h-[var(--control-height-sm,1.75rem)] min-w-0 flex-1 shrink-0 cursor-pointer whitespace-nowrap rounded-sm border-0 px-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          :class="
            activeSection === section
              ? 'bg-primary font-medium text-primary-foreground'
              : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          "
          @click="selectSection(section)"
        >
          {{ t(`settings.sectionShort.${section}`) }}
        </button>
      </div>
      <div v-else class="relative flex min-w-0 flex-1 items-center">
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
          :title="t('settings.search.clear')"
          :aria-label="t('settings.search.clear')"
          @click="clearSearch"
        >
          <X />
        </Button>
      </div>
      <Button
        type="button"
        :variant="isSearchOpen ? 'default' : 'secondary'"
        size="icon-sm"
        class="shrink-0"
        data-settings-search-toggle
        :aria-expanded="isSearchOpen"
        :title="isSearchOpen ? t('settings.search.close') : t('settings.search.placeholder')"
        :aria-label="isSearchOpen ? t('settings.search.close') : t('settings.search.placeholder')"
        @click="toggleSearch"
      >
        <Search />
      </Button>
    </div>

    <div
      ref="sectionsRef"
      role="tabpanel"
      :aria-labelledby="isSearching ? undefined : `pxd-settings-tab-${activeSection}`"
      class="flex flex-col gap-[calc(var(--pxd-section-gap)*1.6)]"
    >
      <!-- 0. 側邊欄模組 -->
      <SettingsSection
        section-id="modules"
        :title="t('settings.section.modules')"
        :icon="LayoutGrid"
        :active="activeSection === 'modules'"
        header-mode="search"
      >
        <SidebarModuleSettings
          :values="moduleValues"
          :summary="
            t('settings.modules.enabledCount', {
              count: enabledModuleCount,
              total: SIDEBAR_MODULES.length,
            })
          "
          @toggle="toggleModule"
          @open-section="openSection"
        />
      </SettingsSection>

      <!-- 1. 外觀與介面 -->
      <SettingsSection
        section-id="appearance"
        :title="t('settings.section.appearance')"
        :icon="Palette"
        :active="activeSection === 'appearance'"
        header-mode="search"
      >
        <SettingsRow :label="t('settings.theme.label')">
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
        </SettingsRow>

        <SettingsRow
          :label="t('settings.displayLocale.label')"
          :description="t('settings.displayLocale.hint')"
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
              <SelectItem v-for="opt in DISPLAY_LOCALE_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          :label="t('settings.marketTranslation.label')"
          :description="t('popup.module.marketTranslation.description')"
          :details="t('settings.marketTranslation.tooltip')"
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
          <SettingsRow
            nested
            :label="t('settings.marketTranslationBilingual.label')"
            :description="t('settings.marketTranslationBilingual.description')"
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
            nested
            :label="t('settings.marketTranslationResultBilingual.label')"
            :description="t('settings.marketTranslationResultBilingual.description')"
            :details="t('settings.marketTranslationResultBilingual.tooltip')"
            :keywords="[t('settings.marketTranslation.bilingualGroup')]"
            control-id="enable-market-translation-result-bilingual"
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
          v-if="marketTranslationReloadRequired"
          data-test="market-translation-reload"
          role="status"
          class="flex items-center justify-between gap-[var(--pxd-space-sm)] rounded-md border border-primary/40 bg-primary/10 px-[var(--pxd-space-md)] py-[var(--pxd-space-sm)] text-[length:var(--pxd-font-caption)] text-foreground"
        >
          <span>{{ t('onboarding.welcome.reloadHint') }}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            data-test="market-translation-reload-btn"
            @click="reloadPage"
          >
            {{ t('onboarding.welcome.reload') }}
          </Button>
        </div>

        <SettingsRow
          :label="t('settings.pureBackground.label')"
          :description="t('popup.module.enablePureBackground.description')"
          :details="t('settings.pureBackground.tooltip')"
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
          :description="t('popup.module.enableAutoTitle.description')"
          :details="t('settings.autoTitle.tooltip')"
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

      <!-- 2. 側邊欄版面 -->
      <SettingsSection
        section-id="panel"
        :title="t('settings.section.panel')"
        :icon="PanelLeft"
        :active="activeSection === 'panel'"
        header-mode="search"
      >
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

        <SettingsRow
          :label="t('settings.sidebarSize.label')"
          :description="sidebarSize === 'custom' ? t('settings.sidebarSize.customHint') : undefined"
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
        </SettingsRow>

        <SettingsRow
          :label="t('settings.fontSize.label', { percent: Math.round(fontSizeScale * 100) })"
        >
          <div class="flex flex-col items-end gap-[var(--pxd-space-sm)]">
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
            <div
              v-if="fontSizeMode === 'custom'"
              class="relative flex w-[140px] shrink-0 items-center"
            >
              <Input
                type="number"
                v-model="customFontSizePercent"
                :min="fontSizePercentBounds.min"
                :max="fontSizePercentBounds.max"
                size="default"
                :aria-label="t('settings.fontSize.option.custom')"
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
        </SettingsRow>

        <SettingsRow :label="t('settings.density.compactLabel')" control-id="density-compact">
          <Switch id="density-compact" v-model="isCompactDensity" />
        </SettingsRow>
      </SettingsSection>

      <!-- 3. 搜尋欄與快捷鍵 -->
      <SettingsSection
        section-id="searchHotkeys"
        :title="t('settings.section.searchHotkeys')"
        :icon="Keyboard"
        :active="activeSection === 'searchHotkeys'"
        header-mode="search"
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
              v-model="hotkeyFocus"
              :aria-label="t('settings.hotkeys.focusLabel')"
              @update:model-value="savePreference('hotkeyFocus')"
            />
          </SettingsRow>
          <SettingsRow nested :label="t('settings.hotkeys.clearLabel')">
            <SettingsHotkeyInput
              v-model="hotkeyClear"
              :aria-label="t('settings.hotkeys.clearLabel')"
              @update:model-value="savePreference('hotkeyClear')"
            />
          </SettingsRow>
        </template>

        <SettingsRow
          v-for="row in SEARCH_TOGGLE_ROWS"
          :key="row.id"
          :label="t(row.labelKey)"
          :description="t(row.descriptionKey)"
          :details="t(row.detailsKey)"
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

      <!-- 4. 搜尋結果顯示 -->
      <SettingsSection
        section-id="resultDisplay"
        :title="t('settings.section.resultDisplay')"
        :icon="ListChecks"
        :active="activeSection === 'resultDisplay'"
        header-mode="search"
      >
        <SettingsRow
          v-for="row in resultToggleRows"
          :key="row.id"
          :label="t(row.labelKey)"
          :description="t(row.descriptionKey)"
          :details="t(row.detailsKey)"
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

      <!-- 5. 書籤與歷史 -->
      <SettingsSection
        section-id="bookmarks"
        :title="t('settings.section.bookmarks')"
        :icon="Bookmark"
        :active="activeSection === 'bookmarks'"
        header-mode="search"
      >
        <SettingsRow :label="t('settings.bookmarkBtnPosition.label')">
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
        </SettingsRow>

        <SettingsRow :label="t('settings.searchEntryClickAction.label')">
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
        </SettingsRow>

        <SettingsRow
          :label="t('settings.bookmarkTooltip.label')"
          control-id="enable-bookmark-tooltip"
        >
          <Switch
            id="enable-bookmark-tooltip"
            v-model="enableBookmarkTooltip"
            @update:model-value="savePreference('enableBookmarkTooltip')"
          />
        </SettingsRow>

        <!-- PoB 分享網址的選用權限（授權只能在擴充頁面進行） -->
        <SettingsRow :label="t('pobShare.settings.label')">
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            data-test="pob-share-permission"
            @click="openPobSharePermissionPage"
          >
            {{ t('pobShare.settings.manageBtn') }}
          </Button>
        </SettingsRow>
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
          {{ t('settings.search.clear') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pxd-settings-tabs {
  scrollbar-width: none;
}
.pxd-settings-tabs::-webkit-scrollbar {
  display: none;
}
</style>

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
  Bookmark,
  Keyboard,
  LayoutGrid,
  ListChecks,
  Palette,
  PanelLeft,
  Search,
  X,
} from '@lucide/vue';
import SettingsHotkeyInput from './settings/SettingsHotkeyInput.vue';
import SettingsRow from './settings/SettingsRow.vue';
import SettingsSection from './settings/SettingsSection.vue';
import SidebarModuleSettings from './settings/SidebarModuleSettings.vue';
import { provideSettingsSearch } from './settings/settings-search';
import {
  RESULT_TOGGLE_ROWS,
  SEARCH_TOGGLE_ROWS,
  filterRowsForVersion,
  type SettingsToggleRow,
} from './settings/settings-toggle-rows';
import { useSettingsTabs } from './settings/useSettingsTabs';
import {
  SETTINGS_SECTION_IDS,
  SIDEBAR_MODULES,
  SIDEBAR_MODULE_PREFERENCE_KEYS,
  countEnabledSidebarModules,
  type SettingsSectionId,
  type SidebarModulePreferenceKey,
} from '@/utils/sidebar-modules';
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
import { resolvePreferredChineseLocale } from '@/utils/locale-resolution';
import {
  isMarketTranslationDisplayLocale,
  resolveMarketTranslationLocale,
} from '@/utils/market-translation';
import { getPreferences, type PreferencesModule } from '@/utils/preferences';
import { getPoeVersion } from '@/utils/trade-context';
import { getPageLoadPreferences } from '@/utils/page-load-preferences';
import { extensionMessaging } from '@/utils/extension-protocol';

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
    SettingsRow,
    SettingsSection,
    SidebarModuleSettings,
    ToggleGroup,
    ToggleGroupItem,
    Search,
    X,
  },
  props: {
    /** 從其他分頁跳轉過來時要捲到的設定區塊 */
    focusSection: {
      type: String as PropType<SettingsSectionId | null>,
      default: null,
    },
    /** 每次跳轉遞增，讓重複跳到同一區塊也會觸發 */
    focusToken: {
      type: Number,
      default: 0,
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
      enableResultPobCopy,
      enableResultExternalLinks,
      enablePureBackground,
      marketTranslation,
      marketTranslationBilingual,
      marketTranslationResultBilingual,
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
    const marketTranslationLocaleMismatch = computed(
      () => marketTranslation.value && !isMarketTranslationDisplayLocale(displayLocale.value),
    );

    let pageLoadMarketState: { locale: string | null; bilingual: boolean } | null = null;
    const marketTranslationReloadRequired = ref(false);

    const computeEffectiveMarketState = (snapshot: Readonly<Preferences>) => {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
      const locale = resolveMarketTranslationLocale({
        enabled: snapshot.marketTranslation === true,
        displayLocale: snapshot.displayLocale,
        hostname,
      });
      return {
        locale,
        bilingual: locale !== null && snapshot.marketTranslationBilingual === true,
      };
    };

    const reloadPage = () => {
      window.location.reload();
    };

    let preferences: PreferencesModule | undefined;
    let stopPreferences: (() => void) | undefined;
    const applyPreferences = (snapshot: Readonly<Preferences>) => {
      Object.assign(preferenceState, snapshot);
      setActiveDisplayLocalePreference(snapshot.displayLocale);
      const currentMarketState = computeEffectiveMarketState(snapshot);
      if (pageLoadMarketState === null) {
        // 設定分頁第一次打開才掛載：基準要用開頁時的偏好，不是掛載當下的
        const pageLoad = getPageLoadPreferences();
        pageLoadMarketState = pageLoad ? computeEffectiveMarketState(pageLoad) : currentMarketState;
      }
      marketTranslationReloadRequired.value =
        currentMarketState.locale !== pageLoadMarketState.locale ||
        currentMarketState.bilingual !== pageLoadMarketState.bilingual;
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
      if (
        key === 'marketTranslation' &&
        preferenceState.marketTranslation &&
        !isMarketTranslationDisplayLocale(preferenceState.displayLocale)
      ) {
        const fallbackLocale = resolvePreferredChineseLocale();
        preferenceState.displayLocale = fallbackLocale;
        void updatePreferences({
          marketTranslation: true,
          displayLocale: fallbackLocale,
        });
        return;
      }
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

    /** 開關列：模糊搜尋兩個設定沿用一起儲存的舊行為 */
    const setToggle = (key: SettingsToggleRow['key'], value: boolean | 'indeterminate') => {
      (preferenceState[key] as boolean) = value === true;
      if (key === 'enableSearchTilde' || key === 'enableFilterTilde') {
        saveTildeSettings();
        return;
      }
      savePreference(key);
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

    // 設定搜尋：按鈕展開輸入框，搜尋時跨分頁列出符合的設定
    const searchQuery = ref('');
    const isSearchOpen = ref(false);
    const searchInputRef = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);
    const { isSearching, hasResults: hasSearchResults } = provideSettingsSearch(searchQuery);
    const clearSearch = () => {
      searchQuery.value = '';
    };
    const focusSearchInput = () => {
      void nextTick(() => {
        const target = searchInputRef.value;
        const el = target instanceof HTMLElement ? target : target?.$el;
        (el instanceof HTMLInputElement ? el : el?.querySelector?.('input'))?.focus();
      });
    };
    const closeSearch = () => {
      clearSearch();
      isSearchOpen.value = false;
    };
    const toggleSearch = () => {
      if (isSearchOpen.value) {
        closeSearch();
        return;
      }
      isSearchOpen.value = true;
      focusSearchInput();
    };

    // 分頁：一次顯示一個區塊
    const sectionsRef = ref<HTMLElement | null>(null);
    const { activeSection, selectSection, handleTabKeydown } = useSettingsTabs(sectionsRef);
    const openSection = (section: SettingsSectionId) => {
      closeSearch();
      selectSection(section);
    };
    watch(
      () => props.focusToken,
      () => {
        if (props.focusSection) openSection(props.focusSection);
      },
      { immediate: true },
    );

    const openPobSharePermissionPage = () => {
      void extensionMessaging.sendMessage('pobShare:openPermissionPage').catch((error: unknown) => {
        console.error('[Settings] 無法開啟 PoB 分享網址授權頁:', error);
      });
    };

    return {
      t,
      openPobSharePermissionPage,
      preferenceState,
      SEARCH_TOGGLE_ROWS,
      resultToggleRows,
      setToggle,
      SIDEBAR_MODULES,
      SETTINGS_SECTION_IDS,
      moduleValues,
      enabledModuleCount,
      toggleModule,
      searchQuery,
      isSearching,
      hasSearchResults,
      clearSearch,
      sectionsRef,
      isSearchOpen,
      searchInputRef,
      closeSearch,
      toggleSearch,
      activeSection,
      selectSection,
      handleTabKeydown,
      openSection,
      LayoutGrid,
      Palette,
      PanelLeft,
      Keyboard,
      ListChecks,
      Bookmark,
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
      enableResultPobCopy,
      enableResultExternalLinks,
      enablePureBackground,
      marketTranslation,
      marketTranslationBilingual,
      marketTranslationResultBilingual,
      marketTranslationLocaleMismatch,
      marketTranslationReloadRequired,
      reloadPage,
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
