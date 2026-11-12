/**
 * 市集漢化結果列標籤：屬性名稱、物品類別、寶石標籤與說明、介面字樣與帶數值的句型。
 *
 * 標籤來自官方介面字典、篩選器欄位名稱與遊戲資料表（poexd-data result-labels.json）；
 * 句型模板的佔位符為 `{n}`，英文整句比對後把數值依譯文順序填回。
 */
export type TextMap = Readonly<Record<string, string>>;
export type LabelTemplates = ReadonlyArray<readonly [string, string]>;

/** 傭兵名字的兩段：名（Velessa）與稱號（, the Bardiyan-Born），譯文直接相接 */
export interface NameParts {
  first: TextMap;
  suffix: TextMap;
}

export interface TemplateMatch {
  /** 依佔位符編號的數值 */
  values: string[];
  /** 英文句中佔位符出現順序 */
  englishOrder: number[];
  /** 譯文中佔位符出現順序 */
  localizedOrder: number[];
  /** 譯文的文字段（長度 = 佔位符數 + 1） */
  localizedLiterals: string[];
  translated: string;
}

interface CompiledTemplate {
  regex: RegExp;
  englishOrder: number[];
  localizedOrder: number[];
  localizedLiterals: string[];
  weight: number;
  /** 英文字母很少的模板（如 `{0}s`）只接受數值，避免吃掉一般英文單字 */
  numericOnly: boolean;
}

const PLACEHOLDER = /\{(\d+)\}/;
const NUMBER_WITH_LABEL = /^([+-]?\d[\d.,]*%?)\s+(.+)$/;
const NUMERIC_VALUE = /^[+-]?\d[\d.,]*%?$/;
const MIN_FREE_TEXT_LETTERS = 4;
const TRAILING_COLON = /^(.*?)\s*([:：︰])$/;

export const normalizeSpace = (text: string) => text.replace(/\s+/g, ' ').trim();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const firstWord = (text: string) => text.split(' ', 1)[0].toLowerCase();

/** `a {0} b {1}` → literals ['a ', ' b ', '']、order [0, 1] */
function splitTemplate(template: string) {
  const parts = template.split(PLACEHOLDER);
  return {
    literals: parts.filter((_, i) => i % 2 === 0),
    order: parts.filter((_, i) => i % 2 === 1).map(Number),
  };
}

function compileTemplate([english, localized]: readonly [string, string]): CompiledTemplate | null {
  const en = splitTemplate(normalizeSpace(english));
  const zh = splitTemplate(localized);
  if (!en.order.length || !/[A-Za-z]/.test(en.literals.join(''))) return null;
  // 兩個佔位符之間只有空白時無法切出數值
  if (en.literals.slice(1, -1).some((literal) => !literal.trim())) return null;
  if ([...en.order].sort().join() !== [...zh.order].sort().join()) return null;
  return {
    regex: new RegExp(`^${en.literals.map(escapeRegex).join('(.+?)')}$`),
    englishOrder: en.order,
    localizedOrder: zh.order,
    localizedLiterals: zh.literals,
    weight: en.literals.join('').length,
    numericOnly: en.literals.join('').replace(/[^A-Za-z]/g, '').length < MIN_FREE_TEXT_LETTERS,
  };
}

export interface LabelLookup {
  /** 單一文字（已去前後空白）的譯文；查不到回傳 null */
  translateText(text: string): string | null;
  /** 整句比對模板 */
  matchTemplate(text: string): TemplateMatch | null;
}

/** 「名, the 稱號」→ 名的譯文接稱號的譯文；任一段查不到回傳 undefined */
function composeName(key: string, names: NameParts | undefined): string | undefined {
  if (!names) return undefined;
  for (let at = key.indexOf(', '); at > 0; at = key.indexOf(', ', at + 1)) {
    const first = names.first[key.slice(0, at)];
    const suffix = names.suffix[key.slice(at)];
    if (first && suffix) return `${first}${suffix}`;
  }
  return undefined;
}

/**
 * @param items 英文物品名（小寫）→ 譯名；標籤查不到時的備援（寶石、符文等名稱）
 * @param names 傭兵名字的名與稱號
 */
export function createLabelLookup(
  labels: TextMap,
  templates: LabelTemplates = [],
  items: TextMap = {},
  names?: NameParts,
): LabelLookup {
  const label = (key: string): string | undefined =>
    labels[key] ?? items[key.toLowerCase()] ?? composeName(key, names);
  // 依英文第一個字分桶；開頭是佔位符的放在 '' 桶。同桶內文字較多（較具體）的先比
  const buckets = new Map<string, CompiledTemplate[]>();
  for (const pair of templates) {
    const compiled = compileTemplate(pair);
    if (!compiled) continue;
    const key = pair[0].trimStart().startsWith('{') ? '' : firstWord(normalizeSpace(pair[0]));
    const bucket = buckets.get(key) ?? [];
    bucket.push(compiled);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => b.weight - a.weight);

  const matchTemplate = (text: string): TemplateMatch | null => {
    const normalized = normalizeSpace(text);
    if (!normalized) return null;
    const candidates = [...(buckets.get(firstWord(normalized)) ?? []), ...(buckets.get('') ?? [])];
    for (const template of candidates) {
      const match = normalized.match(template.regex);
      if (!match) continue;
      if (template.numericOnly && match.slice(1).some((value) => !NUMERIC_VALUE.test(value))) {
        continue;
      }
      const values: string[] = [];
      template.englishOrder.forEach((index, i) => {
        values[index] = match[i + 1];
      });
      const translated = template.localizedLiterals
        .map((literal, i) =>
          i < template.localizedOrder.length
            ? literal + values[template.localizedOrder[i]]
            : literal,
        )
        .join('');
      return {
        values,
        englishOrder: template.englishOrder,
        localizedOrder: template.localizedOrder,
        localizedLiterals: template.localizedLiterals,
        translated,
      };
    }
    return null;
  };

  const translateText = (text: string): string | null => {
    const key = normalizeSpace(text);
    if (!key || !/[A-Za-z]/.test(key)) return null;
    const direct = label(key);
    if (direct) return direct;
    const colon = key.match(TRAILING_COLON);
    const colonLabel = colon && label(colon[1]);
    if (colonLabel) return `${colonLabel}${colon[2]}`;
    const template = matchTemplate(key);
    if (template) return template.translated;
    const numbered = key.match(NUMBER_WITH_LABEL);
    const numberedLabel = numbered && label(numbered[2]);
    if (numberedLabel) return `${numbered[1]} ${numberedLabel}`;
    if (key.includes(', ')) {
      const parts = key.split(', ').map(label);
      if (parts.every(Boolean)) return parts.join(', ');
    }
    return null;
  };

  return { translateText, matchTemplate };
}

const RELATIVE_TIME =
  /^listed (?:(\d+|an?) (second|minute|hour|day|week|month|year)s? ago|(yesterday)|last (week|month|year)|(just now|a few seconds ago))$/i;

/** 「listed 4 years ago」→ 目標語系的相對時間；格式不符回傳 null */
export function translateListedTime(text: string, locale: string): string | null {
  const match = normalizeSpace(text).match(RELATIVE_TIME);
  if (!match) return null;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const [, amount, unit, yesterday, lastUnit, now] = match;
  if (yesterday) return format.format(-1, 'day');
  if (lastUnit) return format.format(-1, lastUnit.toLowerCase() as Intl.RelativeTimeFormatUnit);
  if (now) return format.format(0, 'second');
  const value = /^an?$/i.test(amount) ? 1 : Number(amount);
  return format.format(-value, unit.toLowerCase() as Intl.RelativeTimeFormatUnit);
}
