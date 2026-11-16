/**
 * pobb.in 分享頁翻譯：在使用者已授權 `https://pobb.in/*` 選用權限、且開啟市集漢化（繁中／簡中）時，
 * 直接以擴充現有的官方資料（`items.json`、`mod-lines.json`、`stat-text-items.json`、
 * `stat-aliases.json`、`trade-stats.json`、`result-labels.json`、`trade-ui.json`）翻譯頁面上的
 * 裝備與藥劑懸浮框、技能寶石清單、天賦預覽（關鍵天賦、專精與天賦樹圓點懸浮框）及角色屬性標籤。
 *
 * 只改既有文字節點的內容、不增刪節點，不碰 build code `<textarea>` 與 `<pre>` 筆記區。
 */
import { detectBrowserLocale, resolveDisplayLocale } from './locale-resolution';
import { type ModLinePairs } from './market-mod-lines';
import {
  createLabelLookup,
  type LabelLookup,
  type LabelTemplates,
  type NameParts,
} from './market-result-labels';
import {
  getMarketUiAssetPath,
  isMarketTranslationLocale,
  type MarketTranslationLocale,
} from './market-translation';
import { MARKET_TRANSLATION_STORAGE_KEYS, parseMarketUiAsset } from './market-translation-bridge';
import {
  createModLineTranslator,
  type ModLineTranslator,
  type TradeStatTexts,
} from './pob-mod-translator';
import { createTradeNameCatalog, type TradeNameCatalog } from './pob-shopping-list';
import { resolveStoredDisplayLocale } from './preferences-contract';
import {
  getLocaleItemsAssetPath,
  getLocaleModLinesAssetPath,
  getLocaleResultLabelsAssetPath,
  getLocaleStatTextAssetPath,
  getLocaleTradeFiltersAssetPath,
  getLocaleTradeStatsAssetPath,
  getStatAliasesAssetPath,
  type PoeVersion,
} from './trade-context';

export interface PobbinTranslationConfig {
  locale: MarketTranslationLocale;
  bilingual: boolean;
}

export interface PobbinTranslatorData {
  modTranslator: ModLineTranslator;
  labelLookup: LabelLookup;
  catalog: TradeNameCatalog;
  /** 英文物品／寶石／關鍵天賦名（小寫）→ 譯名 */
  items: Readonly<Record<string, string>>;
  /** 英文核心／昇華／星團天賦名（小寫）→ 譯名 */
  passives?: Readonly<Record<string, string>>;
  bilingual: boolean;
}

export interface PobbinTranslator {
  translate(root: ParentNode): void;
  observe(root: Node): () => void;
}

const SUPPORT_SUFFIX = ' support';
const TIMELESS_HEADER = /^(.+?)(\s+\d+;.*)$/;
const FOULBORN_HEADER = /^Foulborn\s+(.+)$/i;
const QUALITY_MODIFIER_LABEL = /^Quality\s*\(([^)]+)\)\s*(:?)$/;
const DECIMAL_COMMA = /(\d),(\d)/g;

const SKIP_SELECTOR = 'textarea, pre, script, style, select, code, [data-marker-content]';
const POB_ITEM_SELECTOR = '.pob-item';
const GEM_ROW_SELECTOR = '[data-gem-id]';
const GEM_TOOLTIP_NAME_SELECTOR = '.min-w-48 > div';
const NODE_HEADER_SELECTOR = 'div[data-node-id] > span';
const MASTERY_LINE_SELECTOR = 'li[data-node-id]';
const INLINE_TOOLTIP_SELECTOR = '.pointer-events-none .whitespace-pre-line';
const SUMMARY_LABEL_SELECTOR = 'main [data-route] .inline-block > span:first-child';

const TARGET_SELECTOR = [
  POB_ITEM_SELECTOR,
  GEM_ROW_SELECTOR,
  GEM_TOOLTIP_NAME_SELECTOR,
  NODE_HEADER_SELECTOR,
  MASTERY_LINE_SELECTOR,
  INLINE_TOOLTIP_SELECTOR,
  SUMMARY_LABEL_SELECTOR,
].join(', ');

/** 依市集漢化開關、顯示語言與雙語偏好決定 pobb.in 是否啟用翻譯與目標語系 */
export function resolvePobbinTranslationConfig(input: {
  stored: Readonly<Record<string, unknown>> | undefined | null;
  browserLocale?: string;
  browserLanguages?: readonly string[];
}): PobbinTranslationConfig | null {
  const stored = input.stored ?? {};
  if (stored.marketTranslation !== true) return null;
  const resolved = resolveDisplayLocale(resolveStoredDisplayLocale(stored), {
    hostname: 'www.pathofexile.com',
    browserLocale: input.browserLocale,
    browserLanguages: input.browserLanguages,
  });
  if (!isMarketTranslationLocale(resolved)) return null;
  return {
    locale: resolved,
    bilingual: stored.marketTranslationBilingual !== false,
  };
}

const ALLOCATES_FORBIDDEN_EN =
  /^Allocates (.+?) if you have the matching modifier on Forbidden (?:Flesh|Flame)$/;
const ALLOCATES_EN = /^Allocates (.+)$/;
const ALLOCATES_ZH = /配置\s*(.+)$/;
const ADDED_PASSIVE_EN = /^1 Added Passive Skill is (.+)$/;
const ADDED_PASSIVE_ZH = /(?:天賦|天赋)[為为]\s*(.+)$/;

/** 從官方 `trade-stats` 與 `mod-lines`／`stat-text-items` 抽出天賦名稱（小寫英文 → 譯名） */
export function extractPassiveNameMap(sources: {
  tradeStats?: { english: TradeStatTexts; localized: TradeStatTexts };
  modLines?: ReadonlyArray<Readonly<Record<string, ModLinePairs>>>;
}): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (english: string, localized: string) => {
    const key = english.trim().toLowerCase();
    const val = localized.trim();
    if (key && val && !(key in map)) map[key] = val;
  };

  if (sources.tradeStats) {
    const { english, localized } = sources.tradeStats;
    for (const [id, enVal] of Object.entries(english)) {
      const zhVal = localized[id];
      if (typeof enVal !== 'string' || typeof zhVal !== 'string') continue;
      const enMatch = ALLOCATES_FORBIDDEN_EN.exec(enVal) ?? ALLOCATES_EN.exec(enVal);
      const zhMatch = ALLOCATES_ZH.exec(zhVal);
      if (enMatch && zhMatch) put(enMatch[1], zhMatch[1]);
    }
  }

  for (const record of sources.modLines ?? []) {
    for (const pairs of Object.values(record)) {
      if (!Array.isArray(pairs)) continue;
      for (const pair of pairs) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
          continue;
        }
        const enMatch = ADDED_PASSIVE_EN.exec(pair[0]);
        const zhMatch = ADDED_PASSIVE_ZH.exec(pair[1]);
        if (enMatch && zhMatch) put(enMatch[1], zhMatch[1]);
      }
    }
  }

  return map;
}

function formatName(
  localized: string | undefined,
  english: string,
  bilingual: boolean,
): string | null {
  if (!localized || localized === english) return null;
  return bilingual ? `${localized} (${english})` : localized;
}

function keepPadding(text: string, translate: (core: string) => string | null): string | null {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return null;
  const translated = translate(match[2]);
  return translated ? `${match[1]}${translated}${match[3]}` : null;
}

function isSkippedElement(element: Element): boolean {
  return element.closest(SKIP_SELECTOR) !== null;
}

function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && (node as Node).nodeType === 1;
}

function textNodesOf(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.trim() && !isSkippedElement((node as Text).parentElement ?? element)) {
      nodes.push(node as Text);
    }
  }
  return nodes;
}

export function createPobbinTranslator(data: PobbinTranslatorData): PobbinTranslator {
  const written = new WeakMap<Text, string>();
  const passives = data.passives ?? {};

  const isCurrent = (node: Text) => written.get(node) === node.data;

  const setText = (node: Text, text: string) => {
    if (node.data !== text) node.data = text;
    written.set(node, text);
  };

  const replaceNode = (node: Text, compute: (core: string) => string | null) => {
    if (isCurrent(node)) return;
    const translated = keepPadding(node.data, compute);
    if (translated === null || translated === node.data) return;
    setText(node, translated);
  };

  const lookupItemOrPassive = (name: string): string | undefined => {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    const direct = data.items[key] ?? passives[key];
    if (direct) return direct;
    if (!/\d/.test(trimmed)) {
      return data.modTranslator.translate(trimmed);
    }
    return undefined;
  };

  const lookupGemName = (name: string): string | undefined => {
    const key = name.trim().toLowerCase();
    return (
      data.items[key] ??
      data.items[`${key}${SUPPORT_SUFFIX}`] ??
      (key.startsWith('vaal ') ? data.items[key.slice(5)] : undefined)
    );
  };

  const translateHeaderText = (raw: string, rarity: string | undefined): string | null => {
    const direct = lookupItemOrPassive(raw);
    if (direct) return formatName(direct, raw, data.bilingual);

    const timeless = TIMELESS_HEADER.exec(raw);
    if (timeless) {
      const base = lookupItemOrPassive(timeless[1]);
      const formatted = formatName(base, timeless[1], data.bilingual);
      return formatted ? `${formatted}${timeless[2]}` : null;
    }

    const foulborn = FOULBORN_HEADER.exec(raw);
    if (foulborn) {
      const base = lookupItemOrPassive(foulborn[1]);
      if (base) return formatName(base, raw, data.bilingual);
    }

    if (rarity === 'Magic') {
      const baseType = data.catalog.findBaseType(raw);
      const localizedBase = baseType ? data.catalog.toTradeName(baseType) : undefined;
      if (baseType && localizedBase && localizedBase !== baseType) {
        return data.bilingual ? `${localizedBase} (${raw})` : raw.replace(baseType, localizedBase);
      }
    }

    return null;
  };

  const translatePropertyLabel = (raw: string): string | null => {
    const direct = data.labelLookup.translateText(raw);
    if (direct) return direct;
    const qualityMatch = QUALITY_MODIFIER_LABEL.exec(raw);
    if (qualityMatch) {
      const qualityText = data.labelLookup.translateText('Quality') ?? 'Quality';
      const innerText = data.labelLookup.translateText(qualityMatch[1]) ?? qualityMatch[1];
      const result = `${qualityText} (${innerText})${qualityMatch[2]}`;
      return result !== raw ? result : null;
    }
    return null;
  };

  const translateSingleLine = (line: string): string | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(DECIMAL_COMMA, '$1.$2');
    const mod =
      data.modTranslator.translate(trimmed) ??
      (normalized !== trimmed ? data.modTranslator.translate(normalized) : undefined);
    if (mod) return mod;
    return (
      translatePropertyLabel(trimmed) ??
      (normalized !== trimmed ? translatePropertyLabel(normalized) : null)
    );
  };

  const translateMultiline = (raw: string): string | null => {
    const lines = raw.split('\n');
    let changed = false;
    const translatedLines = lines.map((line) => {
      const replaced = keepPadding(line, translateSingleLine);
      if (replaced && replaced !== line) {
        changed = true;
        return replaced;
      }
      return line;
    });
    return changed ? translatedLines.join('\n') : null;
  };

  const translatePobItem = (itemEl: Element) => {
    const rarity = (itemEl as HTMLElement).dataset?.rarity;
    const headerContainer = itemEl.children[0];
    if (headerContainer) {
      for (const div of Array.from(headerContainer.querySelectorAll('div'))) {
        for (const node of textNodesOf(div)) {
          replaceNode(node, (core) => translateHeaderText(core, rarity));
        }
      }
    }

    const bodyContainer = itemEl.children[1];
    if (!bodyContainer) return;

    const listItems = Array.from(bodyContainer.querySelectorAll('ul > li'));
    if (listItems.length > 0) {
      for (const li of listItems) {
        if (li.children.length > 0) {
          for (const node of textNodesOf(li)) {
            replaceNode(node, translatePropertyLabel);
          }
        } else {
          for (const node of textNodesOf(li)) {
            replaceNode(node, translateMultiline);
          }
        }
      }
      return;
    }

    // 天賦樹懸浮框：body 底下直接是 div（可能含多行詞綴）
    for (const node of textNodesOf(bodyContainer)) {
      replaceNode(node, translateMultiline);
    }
  };

  const translateGemRow = (gemEl: Element) => {
    for (const node of textNodesOf(gemEl)) {
      if (isCurrent(node)) continue;
      const raw = node.data.trim();
      const localized = lookupGemName(raw);
      const formatted = formatName(localized, raw, data.bilingual);
      if (!formatted) continue;
      const fullTitle = formatName(localized, raw, true);
      if (fullTitle && !gemEl.getAttribute('title')) {
        gemEl.setAttribute('title', fullTitle);
      }
      replaceNode(node, () => formatted);
    }
  };

  const translateGemTooltipDiv = (divEl: Element) => {
    const parent = divEl.parentElement;
    if (!parent) return;
    const isNameLine = parent.firstElementChild === divEl;
    for (const node of textNodesOf(divEl)) {
      if (isNameLine) {
        replaceNode(node, (core) => formatName(lookupGemName(core), core, data.bilingual));
      } else {
        replaceNode(node, translatePropertyLabel);
      }
    }
  };

  const translateNodeHeader = (spanEl: Element) => {
    for (const node of textNodesOf(spanEl)) {
      replaceNode(node, (core) => {
        const direct =
          lookupItemOrPassive(core) ?? data.labelLookup.translateText(core) ?? undefined;
        return formatName(direct, core, data.bilingual);
      });
    }
  };

  const translateInlineTooltip = (tooltipEl: Element) => {
    if (tooltipEl.closest(POB_ITEM_SELECTOR)) return;
    if (tooltipEl.children.length > 0) {
      for (const node of textNodesOf(tooltipEl)) {
        replaceNode(node, translatePropertyLabel);
      }
    } else {
      for (const node of textNodesOf(tooltipEl)) {
        replaceNode(node, translateMultiline);
      }
    }
  };

  const translateElement = (element: Element) => {
    if (isSkippedElement(element)) return;
    if (element.matches(POB_ITEM_SELECTOR)) {
      translatePobItem(element);
    } else if (element.matches(GEM_ROW_SELECTOR)) {
      translateGemRow(element);
    } else if (element.matches(GEM_TOOLTIP_NAME_SELECTOR)) {
      translateGemTooltipDiv(element);
    } else if (element.matches(NODE_HEADER_SELECTOR)) {
      translateNodeHeader(element);
    } else if (element.matches(MASTERY_LINE_SELECTOR)) {
      for (const node of textNodesOf(element)) {
        replaceNode(node, translateMultiline);
      }
    } else if (element.matches(INLINE_TOOLTIP_SELECTOR)) {
      translateInlineTooltip(element);
    } else if (element.matches(SUMMARY_LABEL_SELECTOR)) {
      for (const node of textNodesOf(element)) {
        replaceNode(node, translatePropertyLabel);
      }
    }
  };

  const translate = (root: ParentNode) => {
    if (isElement(root)) {
      const enclosingItem = root.closest(POB_ITEM_SELECTOR);
      if (enclosingItem) {
        translatePobItem(enclosingItem);
        return;
      }
      if (root.matches(TARGET_SELECTOR)) translateElement(root);
    }
    root.querySelectorAll(TARGET_SELECTOR).forEach(translateElement);
  };

  const observe = (root: Node) => {
    const pending = new Set<Element>();
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const targets = Array.from(pending);
      pending.clear();
      for (const target of targets) {
        if (target.isConnected) translate(target);
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          const target = record.target.parentElement;
          if (target) pending.add(target);
        } else {
          record.addedNodes.forEach((node) => {
            if (isElement(node)) pending.add(node);
            else if (node.parentElement) pending.add(node.parentElement);
          });
        }
      }
      if (pending.size > 0 && !scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    if ('querySelectorAll' in root) translate(root as ParentNode);
    return () => observer.disconnect();
  };

  return { translate, observe };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function readItemsArray(data: unknown): string[] {
  const items = isRecord(data) ? data.items : undefined;
  return isStringArray(items) ? items : [];
}

function readTradeStatsRecord(data: unknown): TradeStatTexts | undefined {
  const stats = isRecord(data) ? data.stats : undefined;
  if (!isRecord(stats)) return undefined;
  return Object.fromEntries(
    Object.entries(stats).filter(
      (entry): entry is [string, string | string[]] =>
        typeof entry[1] === 'string' || isStringArray(entry[1]),
    ),
  );
}

function readModLinesRecord(data: unknown): Record<string, ModLinePairs> | undefined {
  const lines = isRecord(data) ? data.lines : undefined;
  return isRecord(lines) ? (lines as Record<string, ModLinePairs>) : undefined;
}

function readAliasesRecord(
  data: unknown,
): Record<string, ReadonlyArray<readonly [string, string]>> | undefined {
  const aliases = isRecord(data) ? data.aliases : undefined;
  return isRecord(aliases)
    ? (aliases as Record<string, ReadonlyArray<readonly [string, string]>>)
    : undefined;
}

function readResultLabelsData(data: unknown): {
  labels: Record<string, string>;
  templates: LabelTemplates;
  names?: NameParts;
} {
  if (!isRecord(data)) return { labels: {}, templates: [] };
  const rawLabels = isRecord(data.labels) ? data.labels : {};
  const labels = Object.fromEntries(
    Object.entries(rawLabels).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const templates = Array.isArray(data.templates)
    ? data.templates.filter(
        (pair): pair is [string, string] =>
          Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string',
      )
    : [];
  const names =
    isRecord(data.names) && isRecord(data.names.first) && isRecord(data.names.suffix)
      ? {
          first: data.names.first as Record<string, string>,
          suffix: data.names.suffix as Record<string, string>,
        }
      : undefined;
  return { labels, templates, names };
}

function readFieldLabels(english: unknown, localized: unknown): Record<string, string> {
  const enFields = isRecord(english) && isRecord(english.fields) ? english.fields : {};
  const zhFields = isRecord(localized) && isRecord(localized.fields) ? localized.fields : {};
  const labels: Record<string, string> = {};
  for (const [id, enText] of Object.entries(enFields)) {
    const zhText = zhFields[id];
    if (typeof enText === 'string' && typeof zhText === 'string') {
      labels[enText] = zhText;
    }
  }
  return labels;
}

export async function loadPobbinTranslatorData(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: MarketTranslationLocale; bilingual: boolean },
): Promise<PobbinTranslatorData> {
  const { version, locale, bilingual } = options;
  const optional = (path: string) => loadJson(path).catch(() => undefined);

  const [
    modLinesRaw,
    enItemsRaw,
    zhItemsRaw,
    resultLabelsRaw,
    enStatsRaw,
    zhStatsRaw,
    statTextRaw,
    aliasesRaw,
    uiRaw,
    enFiltersRaw,
    zhFiltersRaw,
  ] = await Promise.all([
    loadJson(getLocaleModLinesAssetPath(version, locale)),
    loadJson(getLocaleItemsAssetPath(version, 'en')),
    loadJson(getLocaleItemsAssetPath(version, locale)),
    optional(getLocaleResultLabelsAssetPath(version, locale)),
    optional(getLocaleTradeStatsAssetPath(version, 'en')),
    optional(getLocaleTradeStatsAssetPath(version, locale)),
    optional(getLocaleStatTextAssetPath(version, locale)),
    optional(getStatAliasesAssetPath(version)),
    optional(getMarketUiAssetPath(locale)),
    optional(getLocaleTradeFiltersAssetPath(version, 'en')),
    optional(getLocaleTradeFiltersAssetPath(version, locale)),
  ]);

  const modLines = readModLinesRecord(modLinesRaw);
  if (!modLines) throw new Error('mod-lines.json 格式錯誤');

  const englishItems = readItemsArray(enItemsRaw);
  const localizedItems = readItemsArray(zhItemsRaw);
  if (englishItems.length === 0 || englishItems.length !== localizedItems.length) {
    throw new Error('items.json 索引無法對齊');
  }

  const items: Record<string, string> = {};
  const exactItems = new Map<string, string>();
  englishItems.forEach((en, index) => {
    const zh = localizedItems[index];
    if (!en || !zh) return;
    if (!exactItems.has(en)) exactItems.set(en, zh);
    const lower = en.toLowerCase();
    if (!(lower in items)) items[lower] = zh;
  });

  const catalog = createTradeNameCatalog({ englishItems, localizedItems });
  const resultLabels = readResultLabelsData(resultLabelsRaw);
  const uiStrings = uiRaw ? parseMarketUiAsset(uiRaw, locale) : {};
  const filterLabels = readFieldLabels(enFiltersRaw, zhFiltersRaw);
  const mergedLabels: Record<string, string> = {
    ...resultLabels.labels,
    ...filterLabels,
    ...uiStrings,
  };

  const enStats = readTradeStatsRecord(enStatsRaw);
  const zhStats = readTradeStatsRecord(zhStatsRaw);
  const tradeStats = enStats && zhStats ? { english: enStats, localized: zhStats } : undefined;
  const statText = readModLinesRecord(statTextRaw);
  const aliases = readAliasesRecord(aliasesRaw);

  const modTranslator = createModLineTranslator(modLines, {
    toLocalizedName: (en) => exactItems.get(en) ?? items[en.toLowerCase()],
    labels: mergedLabels,
    tradeStats,
    statText,
    aliases,
  });

  const passives = extractPassiveNameMap({
    tradeStats,
    modLines: [modLines, ...(statText ? [statText] : [])],
  });

  const labelLookup = createLabelLookup(
    mergedLabels,
    resultLabels.templates,
    items,
    resultLabels.names,
  );

  return {
    modTranslator,
    labelLookup,
    catalog,
    items,
    passives,
    bilingual,
  };
}

export async function startPobbinTranslation(deps: {
  doc: Document;
  browserLocale?: string;
  readStorage: (keys: readonly string[]) => Promise<Record<string, unknown>>;
  loadJson: (path: string) => Promise<unknown>;
  version?: PoeVersion;
}): Promise<(() => void) | null> {
  const stored = await deps.readStorage(MARKET_TRANSLATION_STORAGE_KEYS);
  const config = resolvePobbinTranslationConfig({
    stored,
    browserLocale: deps.browserLocale ?? detectBrowserLocale(),
  });
  if (!config) return null;

  const data = await loadPobbinTranslatorData(deps.loadJson, {
    version: deps.version ?? 'poe1',
    locale: config.locale,
    bilingual: config.bilingual,
  });

  return createPobbinTranslator(data).observe(deps.doc);
}
