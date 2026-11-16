/**
 * 市集漢化第 4 階段：把結果列的英文詞綴整句換成遊戲寫法的譯文（ADR-0012）。
 *
 * 資料是 poexd-data 的 `mod-lines.json`：每個 stat hash 一組 `[英文模板, 譯文模板]`，
 * 佔位符格式為 `{i:d}`、`{i:+d}`、`{i:n}`、`{i:+n}`（n 表示描述檔取負，顯示值已是絕對值）。
 * 英文句子本身已經決定了用哪個變體（單複數、正負向），所以只要找到相符的英文模板，
 * 再把擷取到的數值填入同一個變體的譯文模板即可，不需要判斷條件。
 *
 * 兩邊佔位符的取負與否不同時（例如舊英文別名 `{0:n}% reduced …` 對到現行的 `{0:+d}% to …`），
 * 先換回實際數值再依譯文的格式輸出，所以 `22% reduced` 會填成 `-22%`。
 */

export type ModLinePairs = ReadonlyArray<readonly [string, string]>;

const PLACEHOLDER = /\{(\d+):(\+?)([dn])\}/g;
const ESCAPED_NEWLINE = '\\n';
const NUMBER_CAPTURE = '([+-]?\\d+(?:\\.\\d+)?)';

interface CompiledTemplate {
  pattern: RegExp;
  /** 第 k 個擷取群組對應的佔位符索引 */
  order: number[];
  /** 第 k 個擷取群組的佔位符是否取負（`n`：顯示值是實際值的相反數） */
  negated: boolean[];
}

const compiled = new Map<string, CompiledTemplate>();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 文字片段轉成正規式：空白（含換行）彈性比對 */
const literalPattern = (text: string) =>
  text
    .split(ESCAPED_NEWLINE)
    .map((line) => escapeRegExp(line).replace(/\s+/g, '\\s+'))
    .join('\\s*\\n?\\s*');

function compile(template: string): CompiledTemplate {
  const cached = compiled.get(template);
  if (cached) return cached;
  const order: number[] = [];
  const negated: boolean[] = [];
  let source = '';
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    source += literalPattern(template.slice(last, match.index)) + NUMBER_CAPTURE;
    order.push(Number(match[1]));
    negated.push(match[3] === 'n');
    last = (match.index ?? 0) + match[0].length;
  }
  source += literalPattern(template.slice(last));
  const result = { pattern: new RegExp(`^\\s*${source}\\s*$`), order, negated };
  compiled.set(template, result);
  return result;
}

/** 依譯文佔位符的格式輸出數值：`+` 格式補上正號，否則去掉正號 */
function formatValue(raw: string, signed: boolean): string {
  const unsigned = raw.startsWith('+') ? raw.slice(1) : raw;
  if (!signed) return unsigned;
  return unsigned.startsWith('-') ? unsigned : `+${unsigned}`;
}

/** 數值字串取相反數：`22` → `-22`、`-5` → `5`、`+3` → `-3` */
function negateValue(raw: string): string {
  const unsigned = raw.replace(/^[+-]/, '');
  return raw.startsWith('-') ? unsigned : `-${unsigned}`;
}

interface CapturedValue {
  raw: string;
  negated: boolean;
}

function fill(template: string, values: ReadonlyMap<number, CapturedValue>): string | null {
  let missing = false;
  const text = template.replace(
    PLACEHOLDER,
    (_match, index: string, plus: string, kind: string) => {
      const value = values.get(Number(index));
      if (value === undefined) {
        missing = true;
        return '';
      }
      const raw = value.negated === (kind === 'n') ? value.raw : negateValue(value.raw);
      return formatValue(raw, plus === '+');
    },
  );
  return missing ? null : text.split(ESCAPED_NEWLINE).join('\n');
}

/** 找到相符的英文模板就回傳譯文；任一步失敗回傳 null（保留英文） */
export function translateModLine(
  englishLine: string,
  pairs: ModLinePairs | undefined,
): string | null {
  if (!englishLine || !pairs) return null;
  for (const [english, localized] of pairs) {
    const { pattern, order, negated } = compile(english);
    const match = pattern.exec(englishLine);
    if (!match) continue;
    const values = new Map(
      order.map((index, k) => [index, { raw: match[k + 1], negated: negated[k] }] as const),
    );
    const text = fill(localized, values);
    if (text !== null) return text;
  }
  return null;
}

/**
 * 市集寫法（`#` 佔位符）轉成同格式模板，供描述檔查不到的代碼備援。
 * 結尾的市集專用括號（例如 `(Local)`、`(部分)`）不會出現在結果列，一併去掉。
 */
export function tradeTextToModTemplate(text: string): string {
  let index = 0;
  return text
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/(\+?)#/g, (_match, plus: string) => `{${index++}:${plus}d}`);
}
