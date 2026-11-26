import {
  computed,
  inject,
  onUnmounted,
  provide,
  ref,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue';

/** 設定搜尋比對前的正規化：去頭尾空白、轉小寫、合併連續空白。 */
export function normalizeSettingsQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 任一段文字包含查詢字串即算符合；空查詢一律符合。 */
export function matchesSettingsQuery(
  query: string,
  texts: readonly (string | null | undefined)[],
): boolean {
  const normalized = normalizeSettingsQuery(query);
  if (!normalized) return true;
  return texts.some((text) => typeof text === 'string' && text.toLowerCase().includes(normalized));
}

interface MatchRegistry {
  register(matches: ComputedRef<boolean>): void;
}

function createMatchRegistry() {
  const entries = ref<ReadonlySet<ComputedRef<boolean>>>(new Set());
  const register = (matches: ComputedRef<boolean>) => {
    entries.value = new Set([...entries.value, matches]);
    onUnmounted(() => {
      entries.value = new Set([...entries.value].filter((entry) => entry !== matches));
    });
  };
  const anyMatches = computed(() => [...entries.value].some((entry) => entry.value));
  return { register, anyMatches };
}

interface SettingsSearchContext extends MatchRegistry {
  query: Readonly<Ref<string>>;
}

interface SettingsSectionContext extends MatchRegistry {
  /** 區塊標題本身符合時，整個區塊的列都顯示 */
  titleMatches: ComputedRef<boolean>;
}

const SEARCH_KEY: InjectionKey<SettingsSearchContext> = Symbol('pxd-settings-search');
const SECTION_KEY: InjectionKey<SettingsSectionContext> = Symbol('pxd-settings-section');

/** 設定分頁根元件呼叫：提供查詢字串，並彙總是否還有任何區塊符合。 */
export function provideSettingsSearch(query: Readonly<Ref<string>>) {
  const registry = createMatchRegistry();
  provide(SEARCH_KEY, { query, register: registry.register });
  const isSearching = computed(() => normalizeSettingsQuery(query.value) !== '');
  return { isSearching, hasResults: registry.anyMatches };
}

/** 設定區塊呼叫：回傳區塊在目前查詢下是否該顯示。 */
export function useSettingsSection(getTitle: () => string) {
  const search = inject(SEARCH_KEY, null);
  const query = computed(() => search?.query.value ?? '');
  const titleMatches = computed(
    () =>
      normalizeSettingsQuery(query.value) !== '' && matchesSettingsQuery(query.value, [getTitle()]),
  );
  const rows = createMatchRegistry();
  provide(SECTION_KEY, { titleMatches, register: rows.register });
  const visible = computed(
    () => normalizeSettingsQuery(query.value) === '' || titleMatches.value || rows.anyMatches.value,
  );
  search?.register(visible);
  return { visible, query };
}

/** 讀取目前的設定搜尋狀態（供可收合子設定群組在搜尋命中時自動展開）。 */
export function useSettingsSearchQuery() {
  const search = inject(SEARCH_KEY, null);
  const section = inject(SECTION_KEY, null);
  const query = computed(() => search?.query.value ?? '');
  const isSearching = computed(() => normalizeSettingsQuery(query.value) !== '');
  const sectionTitleMatches = computed(() => section?.titleMatches.value === true);
  return { query, isSearching, sectionTitleMatches };
}

/** 設定列呼叫：回傳此列在目前查詢下是否顯示，並登記到所屬區塊。 */
export function useSettingsRow(getTexts: () => readonly (string | null | undefined)[]) {
  const search = inject(SEARCH_KEY, null);
  const section = inject(SECTION_KEY, null);
  const matches = computed(() => matchesSettingsQuery(search?.query.value ?? '', getTexts()));
  section?.register(matches);
  const visible = computed(() => matches.value || section?.titleMatches.value === true);
  return { visible };
}
