/**
 * pobb.in 分享頁翻譯：在使用者已授權 `https://pobb.in/*` 選用權限、且開啟市集漢化（繁中／簡中）時，
 * 直接以擴充現有的官方資料（`items.json`、`mod-lines.json`、`stat-text-items.json`、
 * `stat-text-passives.json`、`passive-names.json`、`stat-aliases.json`、`trade-stats.json`、
 * `result-labels.json`、`trade-ui.json`）翻譯頁面上的裝備與藥劑懸浮框、技能寶石清單、
 * 天賦預覽（關鍵天賦、專精與天賦樹圓點懸浮框）及角色屬性標籤。
 *
 * 只改既有文字節點的內容、不增刪節點（多行合併後清空的 `<li>` 只加上 hidden），
 * 不碰 build code `<textarea>` 與 `<pre>` 筆記區。
 */
import { detectBrowserLocale, resolveDisplayLocale } from './locale-resolution';
import { parsePobBuildXml } from './pob-build';
import { decodePobBuildCode } from './pob-build-code';
import { type ModLinePairs } from './market-mod-lines';
import { createLabelLookup, type LabelLookup } from './market-result-labels';
import {
  getMarketUiAssetPath,
  isMarketTranslationLocale,
  type MarketTranslationLocale,
} from './market-translation';
import { fieldLabels, parseResultLabels } from './market-translation-assets';
import { MARKET_TRANSLATION_STORAGE_KEYS, parseMarketUiAsset } from './market-translation-bridge';
import {
  createModLineTranslator,
  readAliases,
  readStatText,
  readTradeStats,
  type ModLineTranslator,
  type TradeStatTexts,
} from './pob-mod-translator';
import { loadPairedLineShard } from './paired-line-shards';
import { POB_SHARE_OPTIONAL_ORIGINS } from './pob-share-url';
import { createTradeNameCatalog, type TradeNameCatalog } from './pob-shopping-list';
import {
  lookupPobSummaryLabel,
  POBBIN_OFFICIAL_LABEL_ALIASES,
  translatePobSummaryToken,
  translateTimelessConqueredLine,
} from './pobbin-pob-terms';
import { resolveStoredDisplayLocale } from './preferences-contract';
import {
  getLocaleItemsAssetPath,
  getLocalePassiveNamesAssetPath,
  getLocaleResultLabelsAssetPath,
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
  /** 英文天賦／昇華名（小寫）→ 譯名：市集對得到的名稱優先，其餘取遊戲資料表的天賦名稱表 */
  passives?: Readonly<Record<string, string>>;
  locale?: MarketTranslationLocale;
  bilingual: boolean;
}

export interface PobbinTranslator {
  translate(root: ParentNode): void;
  observe(root: Node): () => void;
  setBilingual(enabled: boolean): void;
}

export const POBBIN_ENGLISH_SUBTITLE_CLASS = 'poexd-pobbin-en';
const POBBIN_ENGLISH_STYLE_ID = 'poexd-pobbin-en-style';
const POBBIN_ENGLISH_STYLE_CSS = `
  .${POBBIN_ENGLISH_SUBTITLE_CLASS} {
    display: block;
    font-size: 0.78em;
    line-height: 1.2;
    color: rgb(148 163 184 / 0.8);
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gem-middle > .${POBBIN_ENGLISH_SUBTITLE_CLASS},
  .gem-last > .${POBBIN_ENGLISH_SUBTITLE_CLASS} {
    padding-left: 10px;
  }
`;

const SUPPORT_SUFFIX = ' support';
const TIMELESS_HEADER = /^(.+?)(\s+\d+;.*)$/;
const FOULBORN_HEADER = /^Foulborn\s+(.+)$/i;
const QUALITY_MODIFIER_LABEL = /^Quality\s*\(([^)]+)\)\s*(:?)$/;
const DECIMAL_COMMA = /(\d),(\d)/g;
/** 多行詞綴合併翻譯時一次合併的行數，長的先試 */
const MULTILINE_SPANS: readonly number[] = [3, 2];
/** 標記因多行合併而被隱藏的 `<li>` */
const MERGED_LINE_ATTR = 'data-poexd-merged-line';

interface LineResult {
  /** 這一行的新文字；null 表示不動 */
  text: string | null;
  /** 併入前一行的譯文，這一行清空 */
  consumed: boolean;
}

const SKIP_SELECTOR = `textarea, pre, script, style, select, code, [data-marker-content], .${POBBIN_ENGLISH_SUBTITLE_CLASS}`;
const POB_ITEM_SELECTOR = '.pob-item';
const GEM_ROW_SELECTOR = '[data-gem-id]';
const GEM_TOOLTIP_NAME_SELECTOR = '.min-w-48 > div';
const NODE_HEADER_SELECTOR = 'div[data-node-id] > span, div[data-node-id] > div:first-child > span';
const NODE_BODY_SELECTOR = 'div[data-node-id] > .whitespace-pre-line';
const MASTERY_LINE_SELECTOR = 'li[data-node-id]';
const INLINE_TOOLTIP_SELECTOR = '.pointer-events-none .whitespace-pre-line';
const SUMMARY_BLOCK_SELECTOR = 'main [data-route] .inline-block';

const TARGET_SELECTOR = [
  POB_ITEM_SELECTOR,
  GEM_ROW_SELECTOR,
  GEM_TOOLTIP_NAME_SELECTOR,
  NODE_HEADER_SELECTOR,
  NODE_BODY_SELECTOR,
  MASTERY_LINE_SELECTOR,
  INLINE_TOOLTIP_SELECTOR,
  SUMMARY_BLOCK_SELECTOR,
].join(', ');

/** 依市集漢化開關、顯示語言與搜尋結果中英並列偏好決定 pobb.in 是否啟用翻譯與目標語系 */
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
    bilingual: stored.marketTranslationResultBilingual === true,
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

function ensureEnglishSubtitleStyle(doc: Document): void {
  if (doc.getElementById(POBBIN_ENGLISH_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = POBBIN_ENGLISH_STYLE_ID;
  style.textContent = POBBIN_ENGLISH_STYLE_CSS;
  (doc.head ?? doc.documentElement)?.appendChild(style);
}

export function createPobbinTranslator(data: PobbinTranslatorData): PobbinTranslator {
  const written = new WeakMap<Text, string>();
  const subtitles = new Map<Element, string>();
  const passives = data.passives ?? {};
  const locale: MarketTranslationLocale = data.locale ?? 'zh-TW';
  let bilingual = data.bilingual;

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

  /** 在寶石／裝備名稱下方管理淡色英文副標（保留原本 Text node，避免干擾 SolidJS） */
  const renderSubtitle = (host: Element, english: string | null) => {
    const existing = Array.from(host.children).find((child) =>
      child.classList.contains(POBBIN_ENGLISH_SUBTITLE_CLASS),
    );
    if (!bilingual || !english) {
      existing?.remove();
      return;
    }
    ensureEnglishSubtitleStyle(host.ownerDocument);
    if (existing) {
      if (existing.textContent !== english) existing.textContent = english;
      return;
    }
    const span = host.ownerDocument.createElement('span');
    span.className = POBBIN_ENGLISH_SUBTITLE_CLASS;
    span.textContent = english;
    host.appendChild(span);
  };

  const syncSubtitle = (host: Element, english: string | null) => {
    if (english) subtitles.set(host, english);
    else subtitles.delete(host);
    renderSubtitle(host, english);
  };

  const setBilingual = (enabled: boolean) => {
    if (bilingual === enabled) return;
    bilingual = enabled;
    for (const [host, english] of subtitles) {
      if (!host.isConnected) {
        subtitles.delete(host);
        continue;
      }
      renderSubtitle(host, english);
    }
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

  /** 回傳純中文譯名與（若需要）副標用的英文原文 */
  const translateHeaderEntry = (
    raw: string,
    rarity: string | undefined,
  ): { text: string; english: string } | null => {
    const direct = lookupItemOrPassive(raw);
    if (direct && direct !== raw) return { text: direct, english: raw };

    const timeless = TIMELESS_HEADER.exec(raw);
    if (timeless) {
      const base = lookupItemOrPassive(timeless[1]);
      if (base && base !== timeless[1]) {
        return { text: `${base}${timeless[2]}`, english: timeless[1] };
      }
    }

    const foulborn = FOULBORN_HEADER.exec(raw);
    if (foulborn) {
      const base = lookupItemOrPassive(foulborn[1]);
      if (base && base !== raw) return { text: base, english: raw };
    }

    if (rarity === 'Magic') {
      const baseType = data.catalog.findBaseType(raw);
      const localizedBase = baseType ? data.catalog.toTradeName(baseType) : undefined;
      if (baseType && localizedBase && localizedBase !== baseType) {
        return { text: raw.replace(baseType, localizedBase), english: raw };
      }
    }

    return null;
  };

  const translatePropertyLabel = (raw: string): string | null => {
    // 1. pobb.in 縮寫優先轉查官方全稱（例如 Crit Chance → Critical Strike Chance）
    const alias = POBBIN_OFFICIAL_LABEL_ALIASES[raw];
    if (alias) {
      const official = data.labelLookup.translateText(alias);
      if (official) return official;
    }
    // 2. 直接查官方資料（result-labels / trade-filters / trade-ui）
    const direct = data.labelLookup.translateText(raw);
    if (direct) return direct;
    // 3. 官方資料有時只收帶冒號的版本（例如 `Pantheon:` → `眾神殿：`），而 pobb.in 把冒號拆在隔壁 span
    if (!raw.endsWith(':')) {
      const withColon = data.labelLookup.translateText(`${raw}:`);
      if (withColon) return withColon.replace(/[：:]\s*$/, '');
    }
    const qualityMatch = QUALITY_MODIFIER_LABEL.exec(raw);
    if (qualityMatch) {
      const qualityText = data.labelLookup.translateText('Quality') ?? 'Quality';
      const innerText = data.labelLookup.translateText(qualityMatch[1]) ?? qualityMatch[1];
      const result = `${qualityText} (${innerText})${qualityMatch[2]}`;
      return result !== raw ? result : null;
    }
    // 4. 最後備援：官方資料表沒有的 PoB 摘要／Max Hit 統計標籤
    return lookupPobSummaryLabel(raw, locale);
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
      (normalized !== trimmed ? translatePropertyLabel(normalized) : null) ??
      translateTimelessConqueredLine(trimmed, locale)
    );
  };

  /**
   * 描述檔裡寫成多行的詞綴，pobb.in 會拆成相鄰的幾行（各自一個 `<li>`，或懸浮框裡以換行分隔）。
   * 先試著把相鄰 3、2 行合併成一句翻譯，對不到才逐行翻。合併翻譯的譯文行數與原文相同時逐行對應，
   * 不同時整句放在第一行、其餘行清空（`consumed`）。`null` 表示該行不能參與合併（已翻譯或非詞綴）。
   */
  const translateLineGroup = (lines: ReadonlyArray<string | null>): LineResult[] => {
    const results: LineResult[] = lines.map(() => ({ text: null, consumed: false }));
    let index = 0;
    while (index < lines.length) {
      const span = MULTILINE_SPANS.find((size) => {
        const window = lines.slice(index, index + size);
        if (window.length !== size || window.some((line) => !line?.trim())) return false;
        const sources = window.map((line) => (line as string).trim());
        const joined = sources.join('\n');
        // 與逐行翻譯相同：小數逗號（0,5）對不到時改成小數點再試一次
        const normalizedSources = sources.map((source) => source.replace(DECIMAL_COMMA, '$1.$2'));
        const normalizedJoined = normalizedSources.join('\n');
        const strict = { keepEnglishPrefix: false };
        const translated =
          data.modTranslator.translate(joined, strict) ??
          (normalizedJoined !== joined
            ? data.modTranslator.translate(normalizedJoined, strict)
            : undefined);
        // 譯文裡還留著任何一行英文原文，代表只翻到一部分，不算合併成功
        if (
          !translated ||
          [...sources, ...normalizedSources].some((source) => translated.includes(source))
        ) {
          return false;
        }
        const parts = translated.split('\n');
        const slots =
          parts.length === size ? parts : [parts.join(''), ...Array<string>(size - 1).fill('')];
        slots.forEach((text, offset) => {
          results[index + offset] = { text, consumed: text === '' };
        });
        return true;
      });
      if (span) {
        index += span;
        continue;
      }
      const line = lines[index];
      if (line) results[index] = { text: translateSingleLine(line), consumed: false };
      index += 1;
    }
    return results;
  };

  const translateMultiline = (raw: string): string | null => {
    const lines = raw.split('\n');
    const results = translateLineGroup(lines);
    if (results.every((result) => result.text === null)) return null;
    const output = lines.flatMap((line, i) => {
      const { text, consumed } = results[i];
      if (consumed) return [];
      if (text === null) return [line];
      return [keepPadding(line, () => text) ?? line];
    });
    const joined = output.join('\n');
    return joined === raw ? null : joined;
  };

  /** 隱藏（或取消隱藏）多行合併後清空的 `<li>`；只取消這裡自己隱藏的，不動網站原本的 hidden */
  const setMergedHidden = (li: Element, hide: boolean) => {
    if (!(li instanceof HTMLElement)) return;
    if (hide) {
      li.setAttribute(MERGED_LINE_ATTR, '');
      li.hidden = true;
    } else if (li.hasAttribute(MERGED_LINE_ATTR)) {
      li.removeAttribute(MERGED_LINE_ATTR);
      li.hidden = false;
    }
  };

  /** 一個 `<ul>` 裡只有文字的 `<li>` 依序當成可合併的多行 */
  const translateListLines = (listItems: readonly Element[]) => {
    const nodes = listItems.map((li) => {
      const textNodes = textNodesOf(li);
      const node = textNodes.length === 1 ? textNodes[0] : undefined;
      return node && !isCurrent(node) && !node.data.includes('\n') ? node : undefined;
    });
    const results = translateLineGroup(nodes.map((node) => node?.data ?? null));
    nodes.forEach((node, i) => {
      if (!node) return;
      const { text } = results[i];
      if (text === null) {
        setMergedHidden(listItems[i], false);
        return;
      }
      setText(node, text === '' ? '' : (keepPadding(node.data, () => text) ?? text));
      // 併入前一行的 <li> 已清空，隱藏起來，不留下空白列
      setMergedHidden(listItems[i], text === '');
    });
    listItems.forEach((li, i) => {
      if (nodes[i]) return;
      for (const node of textNodesOf(li)) replaceNode(node, translateMultiline);
    });
  };

  const translatePobItem = (itemEl: Element) => {
    const rarity = (itemEl as HTMLElement).dataset?.rarity;
    const headerContainer = itemEl.children[0];
    const bodyContainer = itemEl.children[1];
    const lists = bodyContainer ? Array.from(bodyContainer.querySelectorAll('ul')) : [];
    // 只有裝備／藥劑／珠寶（body 含 <ul>）才在名稱下方附英文副標；天賦節點懸浮框維持純中文
    const showHeaderSubtitle = lists.length > 0;

    if (headerContainer) {
      for (const div of Array.from(headerContainer.querySelectorAll('div'))) {
        const nodes = textNodesOf(div);
        if (nodes.length === 0) {
          syncSubtitle(div, null);
          continue;
        }
        for (const node of nodes) {
          if (isCurrent(node)) {
            if (!showHeaderSubtitle) syncSubtitle(div, null);
            continue;
          }
          const raw = node.data.trim();
          const entry = translateHeaderEntry(raw, rarity);
          if (!entry) {
            syncSubtitle(div, null);
            continue;
          }
          replaceNode(node, () => entry.text);
          syncSubtitle(div, showHeaderSubtitle ? entry.english : null);
        }
      }
    }

    if (!bodyContainer) return;

    if (lists.length > 0) {
      for (const list of lists) {
        const listItems = Array.from(list.children).filter((child) => child.tagName === 'LI');
        for (const li of listItems) {
          if (li.children.length === 0) continue;
          for (const node of textNodesOf(li)) {
            replaceNode(node, translatePropertyLabel);
          }
        }
        translateListLines(listItems.filter((li) => li.children.length === 0));
      }
      return;
    }

    // 天賦樹懸浮框：body 底下直接是 div（可能含多行詞綴）
    for (const node of textNodesOf(bodyContainer)) {
      replaceNode(node, translateMultiline);
    }
  };

  const translateGemNameNode = (host: Element, node: Text, withTitle = false) => {
    if (isCurrent(node)) return;
    const raw = node.data.trim();
    const localized = lookupGemName(raw);
    if (!localized || localized === raw) {
      syncSubtitle(host, null);
      return;
    }
    if (withTitle) host.setAttribute('title', `${localized} (${raw})`);
    replaceNode(node, () => localized);
    syncSubtitle(host, raw);
  };

  const translateGemRow = (gemEl: Element) => {
    for (const node of textNodesOf(gemEl)) {
      translateGemNameNode(gemEl, node, true);
    }
  };

  const translateGemTooltipDiv = (divEl: Element) => {
    const parent = divEl.parentElement;
    if (!parent) return;
    const isNameLine = parent.firstElementChild === divEl;
    for (const node of textNodesOf(divEl)) {
      if (isNameLine) translateGemNameNode(divEl, node);
      else replaceNode(node, translatePropertyLabel);
    }
    // 同張寶石懸浮框底下的取得清單（Act N、商人 NPC、任務名）皆由官方 result-labels.json 翻譯
    if (isNameLine) {
      const tooltipCard = divEl.closest('.absolute');
      if (tooltipCard) {
        for (const node of textNodesOf(tooltipCard)) {
          if (node.parentElement?.closest('.min-w-48')) continue;
          replaceNode(node, translatePropertyLabel);
        }
      }
    }
  };

  const translateNodeHeader = (spanEl: Element) => {
    for (const node of textNodesOf(spanEl)) {
      replaceNode(node, (core) => {
        const direct =
          lookupItemOrPassive(core) ?? data.labelLookup.translateText(core) ?? undefined;
        return direct && direct !== core ? direct : null;
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

  /** 摘要數值裡以逗號分隔的遊戲名詞（官方眾神殿優先，其次 PoB 盜賊與 Config 狀態） */
  const translateSummaryValue = (raw: string): string | null => {
    const parts = raw.split(/,\s*/);
    let changed = false;
    const translated = parts.map((part) => {
      const next = data.labelLookup.translateText(part) ?? translatePobSummaryToken(part, locale);
      if (!next) return part;
      changed = true;
      return next;
    });
    if (!changed) return null;
    const allTranslated = translated.every((part, index) => part !== parts[index]);
    return translated.join(allTranslated ? '、' : ', ');
  };

  const translateSummaryBlock = (blockEl: Element) => {
    const labelEl = blockEl.firstElementChild;
    if (labelEl?.tagName === 'SPAN') {
      for (const node of textNodesOf(labelEl)) {
        replaceNode(node, translatePropertyLabel);
      }
    }
    // 數值可能是直接的 <span>，也可能帶懸浮框時包在 <div class="contents"> 裡；略過懸浮框本身
    for (const child of Array.from(blockEl.children).slice(1)) {
      if (child.classList.contains('pointer-events-none')) continue;
      for (const node of textNodesOf(child)) {
        replaceNode(node, translateSummaryValue);
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
    } else if (element.matches(NODE_BODY_SELECTOR) || element.matches(MASTERY_LINE_SELECTOR)) {
      for (const node of textNodesOf(element)) {
        replaceNode(node, translateMultiline);
      }
    } else if (element.matches(INLINE_TOOLTIP_SELECTOR)) {
      translateInlineTooltip(element);
    } else if (element.matches(SUMMARY_BLOCK_SELECTOR)) {
      translateSummaryBlock(element);
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

  return { translate, observe, setBilingual };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/** 兩份 stat 文字（hash → 句型）合併；同一 hash 兩邊都有時依序串接 */
function mergeStatText(
  ...sources: ReadonlyArray<Readonly<Record<string, ModLinePairs>> | undefined>
): Record<string, ModLinePairs> | undefined {
  const present = sources.filter((source): source is Readonly<Record<string, ModLinePairs>> =>
    Boolean(source),
  );
  if (present.length === 0) return undefined;
  const merged: Record<string, ModLinePairs> = {};
  for (const source of present) {
    for (const [hash, pairs] of Object.entries(source)) {
      if (!Array.isArray(pairs)) continue;
      merged[hash] = merged[hash] ? [...merged[hash], ...pairs] : pairs;
    }
  }
  return merged;
}

/** `passive-names.json` 的 `names` 轉成「小寫英文 → 譯名」；格式不對時回傳空物件 */
export function readPassiveNames(data: unknown): Record<string, string> {
  const names = isRecord(data) ? data.names : undefined;
  if (!isRecord(names)) return {};
  const result: Record<string, string> = {};
  for (const [english, localized] of Object.entries(names)) {
    if (typeof localized !== 'string') continue;
    const key = english.trim().toLowerCase();
    const value = localized.trim();
    if (key && value && !(key in result)) result[key] = value;
  }
  return result;
}

function readItemsArray(data: unknown): string[] {
  const items = isRecord(data) ? data.items : undefined;
  return isStringArray(items) ? items : [];
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
    passiveStatTextRaw,
    passiveNamesRaw,
    aliasesRaw,
    uiRaw,
    enFiltersRaw,
    zhFiltersRaw,
  ] = await Promise.all([
    loadPairedLineShard(loadJson, 'mod-lines', version, locale),
    loadJson(getLocaleItemsAssetPath(version, 'en')),
    loadJson(getLocaleItemsAssetPath(version, locale)),
    optional(getLocaleResultLabelsAssetPath(version, locale)),
    optional(getLocaleTradeStatsAssetPath(version, 'en')),
    optional(getLocaleTradeStatsAssetPath(version, locale)),
    loadPairedLineShard(loadJson, 'stat-text-items', version, locale).catch(() => undefined),
    loadPairedLineShard(loadJson, 'stat-text-passives', version, locale).catch(() => undefined),
    // 天賦名稱表只有 zh-TW（官方 CDN 沒有簡中資料表），其他語系不要求
    locale === 'zh-TW' ? optional(getLocalePassiveNamesAssetPath(version, locale)) : undefined,
    optional(getStatAliasesAssetPath(version)),
    optional(getMarketUiAssetPath(locale)),
    optional(getLocaleTradeFiltersAssetPath(version, 'en')),
    optional(getLocaleTradeFiltersAssetPath(version, locale)),
  ]);

  const modLines = readStatText(modLinesRaw);
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
  const resultLabels = resultLabelsRaw
    ? parseResultLabels(resultLabelsRaw, locale)
    : { labels: {}, templates: [], names: undefined };
  const uiStrings = uiRaw ? parseMarketUiAsset(uiRaw, locale) : {};
  const zhFilterFields =
    isRecord(zhFiltersRaw) && isRecord(zhFiltersRaw.fields)
      ? (zhFiltersRaw.fields as Record<string, string>)
      : undefined;
  const mergedLabels: Record<string, string> = {
    ...resultLabels.labels,
    ...fieldLabels(enFiltersRaw, zhFilterFields),
    ...uiStrings,
  };

  const enStats = readTradeStats(enStatsRaw);
  const zhStats = readTradeStats(zhStatsRaw);
  const tradeStats = enStats && zhStats ? { english: enStats, localized: zhStats } : undefined;
  const statText = mergeStatText(readStatText(statTextRaw), readStatText(passiveStatTextRaw));
  const aliases = readAliases(aliasesRaw);

  const modTranslator = createModLineTranslator(modLines, {
    toLocalizedName: (en) => exactItems.get(en) ?? items[en.toLowerCase()],
    labels: mergedLabels,
    tradeStats,
    statText,
    aliases,
  });

  const passives = {
    ...readPassiveNames(passiveNamesRaw),
    ...extractPassiveNameMap({
      tradeStats,
      modLines: [modLines, ...(statText ? [statText] : [])],
    }),
  };

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
    locale,
    bilingual,
  };
}

/**
 * 從頁面上的 build code `<textarea>` 判斷是 PoE 1 還是 PoE 2 的 build；
 * 找不到或解不開時回傳 undefined（呼叫端退回 PoE 1）。
 */
export async function detectPobbinGameVersion(doc: Document): Promise<PoeVersion | undefined> {
  for (const textarea of Array.from(doc.querySelectorAll('textarea'))) {
    const code = textarea.value?.trim();
    if (!code) continue;
    try {
      return parsePobBuildXml(await decodePobBuildCode(code)).gameVersion;
    } catch {
      // 不是 PoB 代碼的 textarea，繼續找下一個
    }
  }
  return undefined;
}

/** pobb.in 啟動時需讀取的 storage key：除市集漢化設定外，另含搜尋結果中英並列旗標 */
const POBBIN_STORAGE_KEYS = [
  ...MARKET_TRANSLATION_STORAGE_KEYS,
  'marketTranslationResultBilingual',
] as const;

export async function startPobbinTranslation(deps: {
  doc: Document;
  browserLocale?: string;
  readStorage: (keys: readonly string[]) => Promise<Record<string, unknown>>;
  loadJson: (path: string) => Promise<unknown>;
  version?: PoeVersion;
  subscribeBilingual?: (onChange: (enabled: boolean) => void) => () => void;
}): Promise<(() => void) | null> {
  const stored = await deps.readStorage(POBBIN_STORAGE_KEYS);
  const config = resolvePobbinTranslationConfig({
    stored,
    browserLocale: deps.browserLocale ?? detectBrowserLocale(),
  });
  if (!config) return null;

  const version = deps.version ?? (await detectPobbinGameVersion(deps.doc)) ?? 'poe1';
  const data = await loadPobbinTranslatorData(deps.loadJson, {
    version,
    locale: config.locale,
    bilingual: config.bilingual,
  });

  const translator = createPobbinTranslator(data);
  const stopObserver = translator.observe(deps.doc);
  const stopBilingual = deps.subscribeBilingual?.((enabled) => translator.setBilingual(enabled));
  return () => {
    stopBilingual?.();
    stopObserver();
  };
}

export const POBBIN_ORIGIN = POB_SHARE_OPTIONAL_ORIGINS[0];

/**
 * pobb.in 翻譯腳本可以向 background 要的資料檔。資料改由 background 讀取後經訊息傳回，
 * 不把這些檔案列入 pobb.in 的 web_accessible_resources（否則網站能藉此偵測擴充是否安裝）。
 */
const POBBIN_ASSET_PATH =
  /^json\/(?:poe1|poe2)\/(?:locales\/(?:en|zh-TW|zh-CN)\/(?:items|mod-lines|stat-text-items|stat-text-passives|passive-names|result-labels|trade-stats|trade-filters)\.json|stat-aliases\.json)$|^json\/locales\/(?:zh-TW|zh-CN)\/trade-ui\.json$/;

export const isPobbinAssetPath = (value: unknown): value is string =>
  typeof value === 'string' && POBBIN_ASSET_PATH.test(value);

/** 訊息必須來自 pobb.in 分頁裡的翻譯腳本 */
export function isPobbinSenderUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).origin === 'https://pobb.in';
  } catch {
    return false;
  }
}
export const POBBIN_TRANSLATION_SCRIPT_ID = 'pobbin-translation';
export const POBBIN_TRANSLATION_SCRIPT_FILE = 'content-scripts/pobbin-translation.js';

export interface PobbinScriptingPort {
  getRegisteredContentScripts: (filter?: { ids?: string[] }) => Promise<Array<{ id: string }>>;
  registerContentScripts: (
    scripts: Array<{
      id: string;
      matches: string[];
      js: string[];
      runAt?: 'document_start' | 'document_end' | 'document_idle';
      persistAcrossSessions?: boolean;
    }>,
  ) => Promise<void>;
  unregisterContentScripts: (filter: { ids: string[] }) => Promise<void>;
}

/** 依 `https://pobb.in/*` 選用權限狀態，動態註冊或移除 pobb.in 翻譯腳本 */
export async function syncPobbinTranslationContentScript(deps: {
  hasPermission: (origin: string) => Promise<boolean>;
  scripting?: PobbinScriptingPort;
}): Promise<void> {
  const scripting = deps.scripting;
  if (!scripting) return;
  try {
    const [granted, registered] = await Promise.all([
      deps.hasPermission(POBBIN_ORIGIN).catch(() => false),
      scripting
        .getRegisteredContentScripts({ ids: [POBBIN_TRANSLATION_SCRIPT_ID] })
        .catch(() => []),
    ]);
    const isRegistered = registered.some((script) => script.id === POBBIN_TRANSLATION_SCRIPT_ID);
    if (granted && !isRegistered) {
      await scripting.registerContentScripts([
        {
          id: POBBIN_TRANSLATION_SCRIPT_ID,
          matches: [POBBIN_ORIGIN],
          js: [POBBIN_TRANSLATION_SCRIPT_FILE],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    } else if (!granted && isRegistered) {
      await scripting.unregisterContentScripts({ ids: [POBBIN_TRANSLATION_SCRIPT_ID] });
    }
  } catch (error) {
    console.warn('[PoeXD] 無法同步 pobb.in 翻譯腳本註冊狀態:', error);
  }
}

export function registerPobbinBackgroundHandlers(options?: {
  hasPermission?: (origin: string) => Promise<boolean>;
  scripting?: PobbinScriptingPort;
}): () => void {
  const chromeApi = (globalThis as { chrome?: typeof chrome }).chrome;
  const hasPermission =
    options?.hasPermission ??
    ((origin: string) =>
      chromeApi?.permissions?.contains({ origins: [origin] }) ?? Promise.resolve(false));
  const scripting = options?.scripting ?? chromeApi?.scripting;
  const syncScript = () => {
    void syncPobbinTranslationContentScript({
      hasPermission,
      scripting,
    });
  };

  syncScript();
  chromeApi?.permissions?.onAdded?.addListener(syncScript);
  chromeApi?.permissions?.onRemoved?.addListener(syncScript);
  return () => {
    chromeApi?.permissions?.onAdded?.removeListener(syncScript);
    chromeApi?.permissions?.onRemoved?.removeListener(syncScript);
  };
}
