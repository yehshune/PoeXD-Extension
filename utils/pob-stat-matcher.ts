/**
 * 把 PoB 物品文字裡的英文詞綴對應到官方市集的 stat 代碼與數值，用來組出「類似裝備」的搜尋。
 *
 * 資料沿用既有的兩份分片：`mod-lines.json` 每個 stat hash 的英文句型（遊戲寫法），以及國際服
 * `trade-stats.json` 的 stat 代碼清單。句型以「數字換成 #」的骨架比對，不需要逐一跑正規式。
 * mod-lines 對不到時，再以市集本身的英文寫法比對，補上沒有 hash 的代碼（永恆珠寶的種子編號）
 * 與選項型代碼（星團珠寶的「附加的小型天賦給予」，市集以 `代碼|選項` 列出每一種寫法）。
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
import { buildStatDomainIndex, statDomainsOf } from './stat-domain-order';

/** 市集 stat 代碼的網域：一般詞綴、固定詞綴、附魔、工藝詞綴 */
export type StatDomain = 'explicit' | 'implicit' | 'enchant' | 'crafted';

export interface StatMatch {
  /** 例如 `explicit.stat_3299347043` */
  statId: string;
  /** 詞綴的數值（保留正負號）；兩個數值的詞綴（附加 X 至 Y）取平均，與市集的比對方式相同 */
  value?: number;
  /** 選項型代碼的選項編號（搜尋條件寫成 `value: { option }`） */
  option?: number;
}

/**
 * 同一句話有全域與 `(Local)` 兩個代碼時選哪一個：`true` 優先 Local（武器）、`false` 優先全域、
 * `'defence'` 只有防禦類（護甲、閃避、能量護盾、結界、格擋）優先 Local（防具：攻擊速度、命中這類
 * Local 只存在於武器）
 */
export type LocalPreference = boolean | 'defence';

export interface StatMatchOptions {
  preferLocal: LocalPreference;
  /** 省略時為 explicit */
  domain?: StatDomain;
}

export interface StatMatcher {
  match(line: string, options: StatMatchOptions): StatMatch | undefined;
  /**
   * 同一個代碼後綴在市集上存在的所有網域前綴（例如 `explicit`、`fractured`、`crafted`），
   * 依常用程度排序；代碼不在市集資料裡時回傳空陣列。
   */
  domainsOf?(statId: string): string[];
}

type TradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

type Slot = 'value' | 'negated' | 'literal';

interface Template {
  statId: string;
  /** 句型中每個數字位置：佔位符（取值）或寫死的數字（略過） */
  slots: readonly Slot[];
  local: boolean;
  /** Local 代碼而且是防禦類數值 */
  localDefence: boolean;
  option?: number;
}

const DOMAINS: readonly StatDomain[] = ['explicit', 'implicit', 'enchant', 'crafted'];
const LOCAL_MARKER = '(Local)';
const DEFENCE_TEXT = /\b(?:Armour|Evasion|Energy Shield|Ward|Block)\b/;
const NUMBER = /[+-]?\d+(?:\.\d+)?/g;
/** 佔位符 `{0:d}`、`{0:+d}`、`{0:n}`（n 表示描述檔取負，顯示值是絕對值），或寫死的數字 */
const TEMPLATE_TOKEN = /\{\d+:\+?([dn])\}|[+-]?\d+(?:\.\d+)?/g;
/** 市集寫法的佔位符 `#`（前面可能有正負號），或寫死的數字 */
const TRADE_TOKEN = /[+-]?#|[+-]?\d+(?:\.\d+)?/g;
const TRADE_STAT_ID = /^(explicit|implicit|enchant|crafted)\.([^|]+)(?:\|(\d+))?$/;
/** 英文句型分片：任何有 mod-lines 的語系都含英文句型，固定讀這一份 */
const MOD_LINES_SOURCE_LOCALE = 'zh-TW';

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** 詞綴句子的骨架：數字換成 #，忽略大小寫與多餘空白 */
export const modLineSkeleton = (line: string): string => normalize(line.replace(NUMBER, '#'));

/**
 * 英文句型（`{0:d}` 佔位符格式）的骨架，與 modLineSkeleton 的結果可直接比對。
 * 多行句型以字面的 `\n` 分行，視同空白，才對得到頁面上合併起來的多行詞綴。
 */
export const modTemplateSkeleton = (english: string): string =>
  normalize(english.replace(/\\n/g, ' ').replace(TEMPLATE_TOKEN, '#'));

function compileTemplate(english: string): { skeleton: string; slots: Slot[] } {
  const slots: Slot[] = [];
  const skeleton = english.replace(TEMPLATE_TOKEN, (_token, kind: string | undefined) => {
    slots.push(kind === 'd' ? 'value' : kind === 'n' ? 'negated' : 'literal');
    return '#';
  });
  return { skeleton: normalize(skeleton), slots };
}

/** 市集寫法（`+#% to …`）轉成骨架；選項型寫法的數字是寫死的 */
function compileTradeText(text: string): { skeleton: string; slots: Slot[] } {
  const slots: Slot[] = [];
  const skeleton = text.replace(TRADE_TOKEN, (token) => {
    slots.push(token.endsWith('#') ? 'value' : 'literal');
    return '#';
  });
  return { skeleton: normalize(skeleton), slots };
}

function extractValue(line: string, slots: readonly Slot[]): number | undefined {
  const numbers = line.match(NUMBER) ?? [];
  const values = slots.flatMap((slot, index) => {
    if (slot === 'literal') return [];
    const value = Number(numbers[index]);
    return [slot === 'negated' ? -Math.abs(value) : value];
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

type TemplateIndex = Map<string, Template[]>;

const addTemplate = (index: TemplateIndex, skeleton: string, template: Template) => {
  index.set(skeleton, [...(index.get(skeleton) ?? []), template]);
};

function choose(candidates: readonly Template[] | undefined, preferLocal: LocalPreference) {
  if (!candidates?.length) return undefined;
  if (preferLocal === 'defence') {
    return (
      candidates.find((template) => template.localDefence) ??
      candidates.find((template) => !template.local) ??
      candidates[0]
    );
  }
  return candidates.find((template) => template.local === preferLocal) ?? candidates[0];
}

const localFlags = (text: string): Pick<Template, 'local' | 'localDefence'> => {
  const local = text.includes(LOCAL_MARKER);
  return { local, localDefence: local && DEFENCE_TEXT.test(text) };
};

export function createStatMatcher(data: {
  modLines: Readonly<Record<string, ModLinePairs>>;
  tradeStats: TradeStatTexts;
}): StatMatcher {
  const fromModLines = new Map<StatDomain, TemplateIndex>(DOMAINS.map((d) => [d, new Map()]));
  const fromTradeText = new Map<StatDomain, TemplateIndex>(DOMAINS.map((d) => [d, new Map()]));

  for (const [hash, pairs] of Object.entries(data.modLines)) {
    if (!Array.isArray(pairs)) continue;
    for (const domain of DOMAINS) {
      const statId = `${domain}.stat_${hash}`;
      if (!Object.hasOwn(data.tradeStats, statId)) continue;
      for (const [english] of pairs) {
        // 多行詞綴在 PoB 的物品文字裡是分開的兩行，無法以單行比對
        if (typeof english !== 'string' || english.includes('\\n')) continue;
        const { skeleton, slots } = compileTemplate(english);
        addTemplate(fromModLines.get(domain)!, skeleton, {
          statId,
          slots,
          ...localFlags(tradeText(data.tradeStats, statId)),
        });
      }
    }
  }

  for (const key of Object.keys(data.tradeStats)) {
    const parsed = TRADE_STAT_ID.exec(key);
    const text = tradeText(data.tradeStats, key);
    if (!parsed || !text || text.includes('\n')) continue;
    const [, domain, name, option] = parsed as unknown as [string, StatDomain, string, string?];
    const { skeleton, slots } = compileTradeText(text.replace(LOCAL_MARKER, ''));
    addTemplate(fromTradeText.get(domain)!, skeleton, {
      statId: `${domain}.${name}`,
      slots,
      ...localFlags(text),
      ...(option !== undefined ? { option: Number(option) } : {}),
    });
  }

  const domainIndex = buildStatDomainIndex(Object.keys(data.tradeStats));

  return {
    domainsOf: (statId) => statDomainsOf(domainIndex, statId),
    match(line, { preferLocal, domain = 'explicit' }) {
      const skeleton = modLineSkeleton(line);
      const chosen =
        choose(fromModLines.get(domain)?.get(skeleton), preferLocal) ??
        choose(
          // 選項型寫法的數字寫死，要整句相同才算
          fromTradeText
            .get(domain)
            ?.get(skeleton)
            ?.filter(
              (template) =>
                template.option === undefined ||
                normalize(tradeText(data.tradeStats, `${template.statId}|${template.option}`)) ===
                  normalize(line),
            ),
          preferLocal,
        );
      if (!chosen) return undefined;
      if (chosen.option !== undefined) return { statId: chosen.statId, option: chosen.option };
      const value = extractValue(line, chosen.slots);
      return { statId: chosen.statId, ...(value !== undefined ? { value } : {}) };
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
