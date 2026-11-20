<template>
  <SidebarPane data-pane="settings" class="pxd-settings-pane">
    <template #fixed>
      <!-- 搜尋框與備份選單：固定於捲動區上方（與書籤、歷史、PoB 分頁相同） -->
      <div
        data-settings-toolbar
        class="mb-[var(--pxd-space-md)] flex w-full min-w-0 items-center gap-[var(--pxd-space-sm)] border-b border-border pb-[var(--pxd-space-md)]"
      >
        <div class="relative flex min-w-0 flex-1 items-center">
          <Search
            class="pointer-events-none absolute left-[var(--input-padding-x-sm)] size-[var(--control-icon-sm,14px)] text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            v-model="searchQuery"
            type="search"
            size="sm"
            data-settings-search
            class="w-full pl-[calc(var(--input-padding-x-sm)+var(--control-icon-sm,14px)+var(--pxd-space-sm))] pr-[calc(var(--control-height-sm)+var(--pxd-space-xs))] [&::-webkit-search-cancel-button]:appearance-none"
            :placeholder="t('settings.search.placeholder')"
            :aria-label="t('settings.search.placeholder')"
            @keydown.esc.stop.prevent="clearSearch"
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
        <SettingsBackupMenu :preferences="preferences" :version="version" />
      </div>
    </template>

    <template #scroll>
      <div ref="sectionsRef" class="flex flex-col gap-[calc(var(--pxd-section-gap)*2.4)]">
        <!-- 0. 側邊欄模組 -->
        <SettingsSection
          section-id="modules"
          :title="t('settings.section.modules')"
          :icon="LayoutGrid"
          :highlighted="highlightedSection === 'modules'"
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
            @open-section="openSection"
          />
        </SettingsSection>

        <!-- 1. 外觀與版面 -->
        <SettingsSection
          section-id="appearance"
          :title="t('settings.section.appearance')"
          :icon="Palette"
          :highlighted="highlightedSection === 'appearance'"
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
            <!-- 中英並列：同一個概念套用在篩選下拉與搜尋結果兩處 -->
            <div
              data-settings-group="market-translation-bilingual"
              class="ml-[7px] flex flex-col gap-[var(--pxd-space-md)] border-l border-border/70 pl-[var(--pxd-space-md)]"
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
            <span>{{ t('common.reloadToApply') }}</span>
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
            :label="t('settings.collapsedTabPosition.label')"
            :details="t('settings.collapsedTabPosition.tooltip')"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="shrink-0"
              data-test="reset-collapsed-tab-position"
              :disabled="isCollapsedTabTopDefault"
              @click="resetCollapsedTabPosition"
            >
              {{ t('settings.collapsedTabPosition.reset') }}
            </Button>
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

        <!-- 3. 搜尋欄與快捷鍵 -->
        <SettingsSection
          section-id="searchHotkeys"
          :title="t('settings.section.searchHotkeys')"
          :icon="Keyboard"
          :highlighted="highlightedSection === 'searchHotkeys'"
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
          :highlighted="highlightedSection === 'resultDisplay'"
        >
          <SettingsRow
            v-for="row in resultToggleRows"
            :key="row.id"
            :label="t(row.labelKey)"
            :details="t(row.detailsKey)"
            :keywords="row.keywordsKey ? [t(row.keywordsKey)] : []"
            :guide-target="row.guideTarget"
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
          :highlighted="highlightedSection === 'bookmarks'"
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
import { Bookmark, Keyboard, LayoutGrid, ListChecks, Palette, Search, X } from '@lucide/vue';
import SidebarPane from './layout/SidebarPane.vue';
import SettingsHotkeyInput from './settings/SettingsHotkeyInput.vue';
import FontSizeScaleControl from './settings/FontSizeScaleControl.vue';
import SettingsRow from './settings/SettingsRow.vue';
import SettingsSection from './settings/SettingsSection.vue';
import SettingsBackupMenu from './settings/SettingsBackupMenu.vue';
import SidebarModuleSettings from './settings/SidebarModuleSettings.vue';
import { provideSettingsSearch } from './settings/settings-search';
import {
  RESULT_TOGGLE_ROWS,
  SEARCH_TOGGLE_ROWS,
  filterRowsForVersion,
  type SettingsToggleRow,
} from './settings/settings-toggle-rows';
import { scrollToSettingsSection } from './settings/settings-scroll';
import {
  SIDEBAR_MODULES,
  SIDEBAR_MODULE_PREFERENCE_KEYS,
  countEnabledSidebarModules,
  type SettingsSectionId,
  type SidebarModulePreferenceKey,
} from '@/utils/sidebar-modules';
import { DEFAULT_PREFERENCES, type Preferences } from '@/utils/preferences-contract';
import {
  BOOKMARK_BUTTON_POSITION_OPTIONS,
  DISPLAY_LOCALE_LABELS,
  DISPLAY_LOCALE_OPTIONS,
  SEARCH_ENTRY_CLICK_ACTION_LABELS,
  SEARCH_ENTRY_CLICK_ACTION_OPTIONS,
  SIDEBAR_POSITION_OPTIONS,
  THEME_LABELS,
  THEME_OPTIONS,
} from './settings/settings-ui-metadata';
import { setActiveDisplayLocalePreference, t } from '@/utils/i18n';
import { clampFontSizeScale } from '@/utils/appearance-preferences';
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
    FontSizeScaleControl,
    SettingsRow,
    SettingsSection,
    SettingsBackupMenu,
    SidebarModuleSettings,
    SidebarPane,
    ToggleGroup,
    ToggleGroupItem,
    Search,
    X,
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

    const preferences = ref<PreferencesModule | null>(null);
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
      preferences.value = outcome.value;
      stopPreferences = outcome.value.subscribe(applyPreferences);

      emit('ready');
    });

    onUnmounted(() => {
      stopPreferences?.();
      clearTimeout(highlightTimer);
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

    const isCollapsedTabTopDefault = computed(
      () => preferenceState.collapsedTabTop === DEFAULT_PREFERENCES.collapsedTabTop,
    );
    const resetCollapsedTabPosition = () => {
      void updatePreferences({ collapsedTabTop: DEFAULT_PREFERENCES.collapsedTabTop });
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

    // 設定搜尋：預設顯示輸入框，搜尋時跨區塊列出符合的設定
    const searchQuery = ref('');
    const { isSearching, hasResults: hasSearchResults } = provideSettingsSearch(searchQuery);
    const clearSearch = () => {
      searchQuery.value = '';
    };

    // 模組列的「相關設定」：捲到對應區塊並短暫高亮提示
    const sectionsRef = ref<HTMLElement | null>(null);
    const highlightedSection = ref<SettingsSectionId | null>(null);
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    const triggerSectionHighlight = (section: SettingsSectionId) => {
      clearTimeout(highlightTimer);
      highlightedSection.value = section;
      highlightTimer = setTimeout(() => {
        if (highlightedSection.value === section) highlightedSection.value = null;
      }, 1600);
    };
    const openSection = (section: SettingsSectionId) => {
      const wasSearching = isSearching.value;
      clearSearch();
      const scrollAndHighlight = () => {
        scrollToSettingsSection(sectionsRef.value, section);
        triggerSectionHighlight(section);
      };
      // 清除搜尋會讓所有區塊重新顯示，等版面更新後再捲
      if (wasSearching) void nextTick(scrollAndHighlight);
      else scrollAndHighlight();
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
      openPobSharePermissionPage,
      preferenceState,
      SEARCH_TOGGLE_ROWS,
      resultToggleRows,
      setToggle,
      SIDEBAR_MODULES,
      moduleValues,
      enabledModuleCount,
      toggleModule,
      searchQuery,
      isSearching,
      hasSearchResults,
      clearSearch,
      sectionsRef,
      highlightedSection,
      openSection,
      LayoutGrid,
      Palette,
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
      fontSizeScale,
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
      savePreference,
      handleSidebarPositionChange,
      isCollapsedTabTopDefault,
      resetCollapsedTabPosition,
      handleAddBookmarkBtnPositionChange,
      handleFontSizeScaleChange,
      handleDensityChange,
      isCompactDensity,
      fuzzySearchEnabled,
    };
  },
});
</script>
