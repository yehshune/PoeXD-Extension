/**
 * 市集漢化第 3 階段：把國際服四份 data API 的回應改寫成中文（ADR-0012）。
 *
 * 只換顯示用的 `text`／`label`／`title`，`id`、`type`、`name` 等搜尋用欄位一律不動，
 * 所以送出的搜尋與英文頁完全相同。全部是純函式、不改動輸入物件；形狀不符就原樣回傳。
 * 這支會在頁面環境（MAIN world）執行，不能依賴擴充 API。
 */

export type TradeDataKind = 'items' | 'stats' | 'static' | 'filters';

type TextMap = Readonly<Record<string, string>>;
type NestedTextMap = Readonly<Record<string, TextMap>>;

/** isolated world 依目標語系組好的字典（各欄位格式同對應的分片） */
export interface MarketTradeDictionary {
  stats?: {
    labels: TextMap;
    stats: Readonly<Record<string, string | readonly string[]>>;
    options: NestedTextMap;
  };
  static?: { labels: TextMap; entries: NestedTextMap };
  filters?: { groups: TextMap; fields: TextMap; options: NestedTextMap };
  /** 英文物品名（小寫）→ 譯名 */
  items?: TextMap;
  /** 官方介面字典，補 filters 裡 id 為 null 的選項（例如「Any」） */
  ui?: TextMap;
}

export interface LocalizeOptions {
  /** 可搜尋的文字（詞綴、通貨、物品）顯示成「中文 (English)」，中英文都搜得到 */
  bilingual: boolean;
}

const DATA_PATH = /^\/api\/trade2?\/data\/(items|stats|static|filters)$/;

export function getTradeDataKind(pathname: string): TradeDataKind | null {
  return (pathname.match(DATA_PATH)?.[1] as TradeDataKind | undefined) ?? null;
}

type Json = Record<string, any>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasResultArray = (data: unknown): data is { result: Json[] } =>
  isRecord(data) && Array.isArray(data.result) && data.result.every(isRecord);

/** 查不到、空字串或與英文相同時保留英文；雙語時把英文放在括號內 */
function combine(translated: string | undefined, english: unknown, bilingual: boolean): unknown {
  if (typeof english !== 'string' || !translated || translated === english) return english;
  return bilingual ? `${translated} (${english})` : translated;
}

const pick = (map: TextMap | undefined, key: unknown): string | undefined =>
  map && (typeof key === 'string' || typeof key === 'number') ? map[String(key)] : undefined;

function localizeOptions(entry: Json, map: TextMap | undefined, ui?: TextMap): Json {
  const options = entry.option?.options;
  if (!Array.isArray(options)) return entry;
  return {
    ...entry,
    option: {
      ...entry.option,
      options: options.map((option: Json) => {
        const text =
          option?.id === null || option?.id === undefined
            ? pick(ui, option?.text)
            : pick(map, option.id);
        return isRecord(option) ? { ...option, text: combine(text, option.text, false) } : option;
      }),
    },
  };
}

function localizeStats(
  data: { result: Json[] },
  dict: NonNullable<MarketTradeDictionary['stats']>,
  bilingual: boolean,
) {
  // 同一 id 可能出現多次（例如 Area / Map 兩種說法），分片依 API 出現順序存成陣列
  const seen = new Map<string, number>();
  const textFor = (id: string): string | undefined => {
    const index = seen.get(id) ?? 0;
    seen.set(id, index + 1);
    const value = dict.stats[id];
    return Array.isArray(value) ? value[index] : index === 0 ? (value as string) : undefined;
  };
  return {
    ...data,
    result: data.result.map((group) => ({
      ...group,
      label: combine(pick(dict.labels, group.id), group.label, false),
      entries: Array.isArray(group.entries)
        ? group.entries.map((entry: Json) => {
            if (!isRecord(entry) || typeof entry.id !== 'string') return entry;
            const localized = { ...entry, text: combine(textFor(entry.id), entry.text, bilingual) };
            return localizeOptions(localized, dict.options[entry.id]);
          })
        : group.entries,
    })),
  };
}

function localizeStatic(
  data: { result: Json[] },
  dict: NonNullable<MarketTradeDictionary['static']>,
  bilingual: boolean,
) {
  return {
    ...data,
    result: data.result.map((group) => {
      const entries = typeof group.id === 'string' ? dict.entries[group.id] : undefined;
      return {
        ...group,
        label: combine(pick(dict.labels, group.id), group.label, false),
        entries: Array.isArray(group.entries)
          ? group.entries.map((entry: Json) =>
              isRecord(entry)
                ? { ...entry, text: combine(pick(entries, entry.id), entry.text, bilingual) }
                : entry,
            )
          : group.entries,
      };
    }),
  };
}

function localizeFilters(
  data: { result: Json[] },
  dict: NonNullable<MarketTradeDictionary['filters']>,
  ui: TextMap | undefined,
) {
  const withText = (target: Json, key: 'title' | 'text', translated: string | undefined) =>
    key in target ? { ...target, [key]: combine(translated, target[key], false) } : target;
  return {
    ...data,
    result: data.result.map((group) => {
      const titled = withText(group, 'title', pick(dict.groups, group.id));
      if (!Array.isArray(group.filters)) return titled;
      return {
        ...titled,
        filters: group.filters.map((filter: Json) => {
          if (!isRecord(filter)) return filter;
          const labelled = withText(filter, 'text', pick(dict.fields, filter.id));
          const options = typeof filter.id === 'string' ? dict.options[filter.id] : undefined;
          return localizeOptions(labelled, options, ui);
        }),
      };
    }),
  };
}

function itemText(entry: Json, items: TextMap): string | undefined {
  const lookup = (value: unknown) =>
    typeof value === 'string' ? items[value.toLowerCase()] : undefined;
  const type = lookup(entry.type);
  if (typeof entry.name !== 'string' || !entry.name) return type;
  const name = lookup(entry.name);
  return name && type ? `${name} ${type}` : undefined;
}

function localizeItems(data: { result: Json[] }, items: TextMap, bilingual: boolean) {
  return {
    ...data,
    result: data.result.map((group) => ({
      ...group,
      entries: Array.isArray(group.entries)
        ? group.entries.map((entry: Json) => {
            if (!isRecord(entry) || typeof entry.type !== 'string') return entry;
            const translated = itemText(entry, items);
            if (!translated) return entry;
            // 基底原本沒有 text：官網顯示時以 text 優先、沒有才用 type
            const english = typeof entry.text === 'string' ? entry.text : entry.type;
            return { ...entry, text: combine(translated, english, bilingual) };
          })
        : group.entries,
    })),
  };
}

export function localizeTradeData(
  kind: TradeDataKind,
  data: unknown,
  dictionary: MarketTradeDictionary,
  options: LocalizeOptions,
): unknown {
  if (!hasResultArray(data)) return data;
  switch (kind) {
    case 'stats':
      return dictionary.stats ? localizeStats(data, dictionary.stats, options.bilingual) : data;
    case 'static':
      return dictionary.static ? localizeStatic(data, dictionary.static, options.bilingual) : data;
    case 'filters':
      return dictionary.filters ? localizeFilters(data, dictionary.filters, dictionary.ui) : data;
    case 'items':
      return dictionary.items ? localizeItems(data, dictionary.items, options.bilingual) : data;
  }
}
