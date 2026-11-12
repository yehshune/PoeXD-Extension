/**
 * 市集數值的正負號。
 *
 * 遊戲寫法與市集寫法各自決定是否取負：例如能力值需求在遊戲顯示「減少 18%」（佔位符 `{0:n}`），
 * 市集卻寫「增加 #%」（`{0:d}`），篩選時要填 -18。tier 的 values 是遊戲顯示的絕對值，
 * 兩邊取負方式不同時要翻號才是市集數值。
 */
const PLACEHOLDER = /\{(\d+)(?::([^}]*))?\}/g;

function negatedPlaceholders(template: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const [, index, format = ''] of template.matchAll(PLACEHOLDER)) {
    result.set(index, format.includes('n'));
  }
  return result;
}

/** 單行模板中，任一共同佔位符的取負方式不同時回傳 true */
export function isTradeValueNegated(
  tierTemplate: string,
  statTemplate: string | undefined,
): boolean {
  if (!statTemplate || tierTemplate.includes('|||||') || statTemplate.includes('|||||'))
    return false;
  const tier = negatedPlaceholders(tierTemplate);
  const trade = negatedPlaceholders(statTemplate);
  return [...tier].some(([index, negated]) => trade.has(index) && trade.get(index) !== negated);
}

const negate = (value: string) => {
  if (value === '') return '';
  const number = -Number(value);
  return Number.isNaN(number) ? value : String(number === 0 ? 0 : number);
};

/** `[min, max]` 取負並維持由小到大；單一數值回傳單一數值 */
export function negateRange(range: readonly string[]): string[] {
  return [...range].reverse().map(negate);
}

/** 上下限各自取負並交換（空字串維持空字串） */
export function negateBounds(min: string, max: string): { min: string; max: string } {
  return { min: negate(max), max: negate(min) };
}
