/**
 * 把 PoB 物品文字裡的英文詞綴對應到官方市集的 stat 代碼與數值，用來組出「類似裝備」的搜尋。
 *
 * 資料沿用既有的兩份分片：`mod-lines.json` 每個 stat hash 的英文句型（遊戲寫法），以及國際服
 * `trade-stats.json` 的 stat 代碼清單。句型以「數字換成 #」的骨架比對，不需要逐一跑正規式。
 *
 * 同一句話可能對到兩個代碼（裝備本身的數值與角色的全域數值，市集上前者標 `(Local)`），
 * 由呼叫端依部位告知偏好；對不到或無法判斷的詞綴回傳 undefined，不會用猜的代碼去搜。
 */
import type { ModLinePairs } from './market-mod-lines';
import {
  getLocaleModLinesAssetPath,
  getLocaleTradeStatsAssetPath,
  type PoeVersion,
} from './trade-context';

export interface StatMatch {
  /** 例如 `explicit.stat_3299347043` */
  statId: string;
  /** 詞綴的數值；兩個數值的詞綴（附加 X 至 Y）取平均，與市集的比對方式相同 */
  value?: number;
}

export interface StatMatcher {
  match(line: string, options: { preferLocal: boolean }): StatMatch | undefined;
}

type TradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

interface Template {
  hash: string;
  /** 句型中每個數字位置：佔位符（取值）或寫死的數字（略過） */
  slots: ReadonlyArray<'value' | 'negated' | 'literal'>;
}

const STAT_DOMAIN = 'explicit';
const LOCAL_MARKER = '(Local)';
const NUMBER = /[+-]?\d+(?:\.\d+)?/g;
/** 佔位符 `{0:d}`、`{0:+d}`、`{0:n}`（n 表示描述檔取負，顯示值是絕對值），或寫死的數字 */
const TEMPLATE_TOKEN = /\{\d+:\+?([dn])\}|[+-]?\d+(?:\.\d+)?/g;
/** 英文句型分片：任何有 mod-lines 的語系都含英文句型，固定讀這一份 */
const MOD_LINES_SOURCE_LOCALE = 'zh-TW';

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** 詞綴句子的骨架：數字換成 #，忽略大小寫與多餘空白 */
export const modLineSkeleton = (line: string): string => normalize(line.replace(NUMBER, '#'));

/** 英文句型（`{0:d}` 佔位符格式）的骨架，與 modLineSkeleton 的結果可直接比對 */
export const modTemplateSkeleton = (english: string): string =>
  normalize(english.replace(TEMPLATE_TOKEN, '#'));

function compileTemplate(hash: string, english: string): { skeleton: string; template: Template } {
  const slots: Array<'value' | 'negated' | 'literal'> = [];
  const skeleton = english.replace(TEMPLATE_TOKEN, (_token, kind: string | undefined) => {
    slots.push(kind === 'd' ? 'value' : kind === 'n' ? 'negated' : 'literal');
    return '#';
  });
  return { skeleton: normalize(skeleton), template: { hash, slots } };
}

function extractValue(line: string, template: Template): number | undefined {
  const numbers = line.match(NUMBER) ?? [];
  const values = template.slots.flatMap((slot, index) => {
    if (slot === 'literal') return [];
    const value = Math.abs(Number(numbers[index]));
    return [slot === 'negated' ? -value : value];
  });
  if (values.length === 0 || values.length > 2 || values.some((value) => !Number.isFinite(value))) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const tradeText = (texts: TradeStatTexts, statId: string): string => {
  const text = texts[statId];
  return typeof text === 'string' ? text : (text?.[0] ?? '');
};

export function createStatMatcher(data: {
  modLines: Readonly<Record<string, ModLinePairs>>;
  tradeStats: TradeStatTexts;
}): StatMatcher {
  const templates = new Map<string, Template[]>();
  for (const [hash, pairs] of Object.entries(data.modLines)) {
    const statId = `${STAT_DOMAIN}.stat_${hash}`;
    if (!Object.hasOwn(data.tradeStats, statId) || !Array.isArray(pairs)) continue;
    for (const [english] of pairs) {
      // 多行詞綴在 PoB 的物品文字裡是分開的兩行，無法以單行比對
      if (typeof english !== 'string' || english.includes('\\n')) continue;
      const { skeleton, template } = compileTemplate(hash, english);
      templates.set(skeleton, [...(templates.get(skeleton) ?? []), template]);
    }
  }

  return {
    match(line, { preferLocal }) {
      const candidates = templates.get(modLineSkeleton(line));
      if (!candidates?.length) return undefined;
      const isLocal = (template: Template) =>
        tradeText(data.tradeStats, `${STAT_DOMAIN}.stat_${template.hash}`).includes(LOCAL_MARKER);
      const chosen =
        candidates.find((template) => isLocal(template) === preferLocal) ?? candidates[0];
      const value = extractValue(line, chosen);
      return {
        statId: `${STAT_DOMAIN}.stat_${chosen.hash}`,
        ...(value !== undefined ? { value } : {}),
      };
    },
  };
}

export async function loadStatMatcher(
  loadJson: (path: string) => Promise<unknown>,
  version: PoeVersion,
): Promise<StatMatcher> {
  const [modLines, tradeStats] = await Promise.all([
    loadJson(getLocaleModLinesAssetPath(version, MOD_LINES_SOURCE_LOCALE)),
    loadJson(getLocaleTradeStatsAssetPath(version, 'en')),
  ]);
  const lines =
    typeof modLines === 'object' && modLines !== null ? (modLines as { lines?: unknown }).lines : 0;
  const stats =
    typeof tradeStats === 'object' && tradeStats !== null
      ? (tradeStats as { stats?: unknown }).stats
      : 0;
  if (typeof lines !== 'object' || lines === null || typeof stats !== 'object' || stats === null) {
    throw new Error('mod-lines.json 或 trade-stats.json 格式錯誤');
  }
  return createStatMatcher({
    modLines: lines as Record<string, ModLinePairs>,
    tradeStats: stats as TradeStatTexts,
  });
}
