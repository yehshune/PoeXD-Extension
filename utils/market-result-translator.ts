/**
 * 市集漢化結果列 DOM 層（ADR-0012）。
 *
 * - 詞綴行（`[data-field="stat.<category>.stat_<hash>"]`）用遊戲寫法：先查 `mod-lines.json`，
 *   描述檔查不到的代碼再以市集寫法（中英 trade-stats）備援，都查不到保留英文。
 *   沒有 stat 代碼的詞綴行（藥劑、寶石效果）以英文句型在所有遊戲寫法中比對。
 * - 物品名（標題列）查 `items.json`。
 * - 屬性行先整行比對句型模板（如 `Consumes {0} of {1} Charges on use`），再逐節點查標籤；
 *   寶石說明、旗標、DPS、價格標籤、賣家狀態與按鈕逐節點查標籤；刊登時間改成相對時間。
 *
 * 只改既有文字節點的內容、不增刪節點，Vue 的節點對應不受影響。官網重繪把文字換回英文時，
 * MutationObserver 會再翻一次。
 */
import { tradeTextToModTemplate, translateModLine, type ModLinePairs } from './market-mod-lines';
import { modLineSkeleton, modTemplateSkeleton } from './pob-stat-matcher';
import { PAGE_GUIDE_MOCK_ATTR } from './trade-results-root';
import {
  createLabelLookup,
  normalizeSpace,
  translateListedTime,
  type LabelTemplates,
  type NameParts,
  type TemplateMatch,
  type TextMap,
} from './market-result-labels';

type TradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

export interface ResultTranslatorData {
  /** stat hash → [英文模板, 譯文模板]（mod-lines.json） */
  modLines: Readonly<Record<string, ModLinePairs>>;
  /** 無 stat 代碼詞綴與星團天賦說明的額外遊戲寫法（stat-text-items.json + stat-text-passives.json） */
  extraModLines?: Readonly<Record<string, ModLinePairs>>;
  /** 按需懶載入的技能寶石詞綴（stat-text-skills.json）；首次遇到無 data-field 且未命中的詞綴時才呼叫 */
  loadSkillModLines?: () => Promise<Readonly<Record<string, ModLinePairs>> | undefined>;
  /** 市集寫法備援：國際服英文與目標語系的 trade-stats（stat id → 文字） */
  tradeStats?: { en: TradeStatTexts; localized: TradeStatTexts };
  /** 英文物品名（小寫）→ 譯名 */
  items: TextMap;
  /** 英文天賦名（小寫）→ 譯名（星團珠寶底部天賦說明） */
  passives?: TextMap;
  /** 標籤（英文 → 譯文） */
  labels: TextMap;
  /** 帶 `{n}` 佔位符的句型（英文, 譯文） */
  templates?: LabelTemplates;
  /** 相對時間的輸出語系 */
  locale?: string;
  /** 傭兵名字的名與稱號 */
  names?: NameParts;
}

const STAT_SELECTOR = '[data-field^="stat."]';
const HEADER_SELECTOR = '.item-popup__header-line, .gem-popup__header-line';
/** 整行先比對句型、再逐節點查標籤的行：屬性行與傭兵技能、輔助的每一段 */
const PROPERTY_SELECTOR = '.item-property, .item-mod--mercenary > div > span';
const MOD_SELECTOR = '.item-mod > span.lc:not([data-field]):not(.l):not(.r)';
const TIME_SELECTOR = '[data-field="indexed"] small';
/** 物品與技能寶石說明（PoE 2 內嵌 `<span class="keyword">` 時需先合併整句比對） */
const DESC_SELECTOR = [
  '.item-popup__desc-text',
  '.item-popup__sec-desc-text',
  '.gem-popup__desc-text',
  '.gem-popup__sec-desc-text',
].join(', ');
const LABEL_SELECTOR = [
  '.item-popup__mod--logbook',
  '.item-popup__content > div:not([class]) > .lc',
  '.gem-popup__content > div:not([class]) > .lc',
  '.gem-popup__primary-tag',
  '.gem-popup__tags',
  '.gem-popup__tab',
  '.itemPopupAdditional [data-field]',
  '.price-label',
  '.verifiedStatus',
  '.btns .status',
  '.btns button',
].join(', ');
/** 星團珠寶底部天賦說明（官方 notableProperties 渲染的無 class／style div，含天賦名 span 與 <br> 分隔的效果行） */
const NOTABLE_SELECTOR = '.item-popup__content > div:not([class]):not([style])';
const TARGET_SELECTOR = [
  STAT_SELECTOR,
  HEADER_SELECTOR,
  PROPERTY_SELECTOR,
  MOD_SELECTOR,
  TIME_SELECTOR,
  DESC_SELECTOR,
  LABEL_SELECTOR,
  NOTABLE_SELECTOR,
].join(', ');
const OWN_NODE_SELECTOR = `[class*="poexd"], [${PAGE_GUIDE_MOCK_ATTR}]`;
/** 我們自己插入的節點（價格比較等）不翻譯 */
const SKIP_SELECTOR = `${STAT_SELECTOR}, ${OWN_NODE_SELECTOR}`;
const MOD_SUBTITLE_TARGET_SELECTOR = `${STAT_SELECTOR}, ${MOD_SELECTOR}`;
const MOD_MARKER_SELECTOR = '.lc.l, .lc.r';
export const RESULT_MOD_ENGLISH_SUBTITLE_CLASS = 'poexd-result-mod-en';
const RESULT_MOD_ENGLISH_STYLE_ID = 'poexd-result-mod-en-style';
const RESULT_MOD_ENGLISH_STYLE_CSS = `
  .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS} {
    display: block;
    font-size: 0.92em;
    line-height: 1.25;
    color: oklch(0.76 0.015 260 / 0.72);
    font-weight: 400;
    white-space: pre-line !important;
    margin-top: 1px;
    margin-bottom: 2px;
  }
`;
/** `stat.<category>.<id>`；id 可能是 `stat_<hash>`、`stat_<hash>|<option>` 或技能代碼 */
const STAT_FIELD = /^stat\.([a-z_]+\.(\S+))$/;
const STAT_HASH = /^stat_(\d+)$/;
/** 只有標點與空白的節點（如「: 」），多節點詞綴以它切段 */
const SEPARATOR_NODE = /^[^\p{L}\p{N}]+$/u;
const LINE_BREAK = /\\n|\n/;
const TRAILING_PAREN = /\s*\([^()]*\)\s*$/;

/** 節點在 root 內部是否屬於要略過的區塊（root 外層的祖先不算） */
/** target（含）到 root（含）之間有我們自己插入的節點；root 外層不看 */
function isInsideOwnNode(target: Element, root: Element): boolean {
  for (let el: Element | null = target; el && el !== root.parentElement; el = el.parentElement) {
    if (el.matches(OWN_NODE_SELECTOR)) return true;
  }
  return false;
}

function isSkipped(node: Text, root: Element): boolean {
  for (let el = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
    if (el.matches(SKIP_SELECTOR)) return true;
  }
  return false;
}

const asList = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

function textNodesOf(element: Element, includeBlank = false): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (includeBlank || (node as Text).data.trim()) nodes.push(node as Text);
  }
  return nodes;
}

/** 保留前後空白，只換中間的文字 */
function keepPadding(text: string, translate: (core: string) => string | null): string | null {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return null;
  const translated = translate(match[2]);
  return translated ? `${match[1]}${translated}${match[3]}` : null;
}

/** 標題只有一行（普通、魔法、寶石、通貨、未鑑定）；稀有、傳奇的第一行是名稱、第二行才是基底 */
function isSingleLineHeader(line: Element): boolean {
  const parent = line.parentElement;
  if (!parent) return true;
  return Array.from(parent.children).filter((el) => el.matches(HEADER_SELECTOR)).length === 1;
}

/**
 * 物品名查 `items`：整行查不到且允許部分比對時（單行標題），找最長的連續單字段落。
 * 魔法物品的 typeLine 是「前綴 基底 後綴」（如 `Thirsty Vaal Regalia of the Whale`），
 * 品質普通物品帶 `Superior`；基底一定是其中連續的單字。前後綴沒有譯名資料，保留英文。
 * 稀有名稱（雙行標題第一行）不做部分比對，避免隨機名字的單字被誤翻。
 */
export function translateResultItemName(
  name: string,
  items: TextMap,
  partial: boolean,
): string | null {
  const exact = items[name.toLowerCase()];
  if (exact || !partial) return exact ?? null;
  const words = name.split(' ');
  for (let size = words.length - 1; size > 0; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const translated =
        items[
          words
            .slice(start, start + size)
            .join(' ')
            .toLowerCase()
        ];
      if (!translated) continue;
      return [...words.slice(0, start), translated, ...words.slice(start + size)].join(' ');
    }
  }
  return null;
}

export interface ResultTranslatorOptions {
  /** 結果列詞綴在譯文下方以淡色副標顯示英文原文 */
  resultBilingual?: boolean;
}

export interface ResultTranslator {
  /** 翻譯 root 底下（含 root 本身）所有結果列節點 */
  translate(root: ParentNode): void;
  /** 監看 root 的新增與文字變更；回傳停止函式 */
  observe(root: Node): () => void;
  /** 即時切換結果列詞綴的英文原文副標 */
  setResultBilingual(enabled: boolean): void;
}

/** 官方 .lc.l / .lc.r 採 position: absolute 且未設 top，須把 block 副標插在它們之後才不會把 P/S 往下擠 */
function findSubtitleAnchor(element: Element, subtitle: Element): Element {
  let anchor = element;
  for (let next = element.nextElementSibling; next; next = next.nextElementSibling) {
    if (next === subtitle) continue;
    if (!next.matches(MOD_MARKER_SELECTOR)) break;
    anchor = next;
  }
  return anchor;
}

function ensureSubtitleStyle(element: Element): void {
  const rootNode = element.getRootNode();
  const doc = element.ownerDocument;
  if (typeof ShadowRoot !== 'undefined' && rootNode instanceof ShadowRoot) {
    if (rootNode.querySelector(`#${RESULT_MOD_ENGLISH_STYLE_ID}`)) return;
    const style = doc.createElement('style');
    style.id = RESULT_MOD_ENGLISH_STYLE_ID;
    style.textContent = RESULT_MOD_ENGLISH_STYLE_CSS;
    rootNode.appendChild(style);
    return;
  }
  if (doc.getElementById(RESULT_MOD_ENGLISH_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = RESULT_MOD_ENGLISH_STYLE_ID;
  style.textContent = RESULT_MOD_ENGLISH_STYLE_CSS;
  (doc.head || doc.documentElement)?.appendChild(style);
}

export function createResultTranslator(
  data: ResultTranslatorData,
  options: ResultTranslatorOptions = {},
): ResultTranslator {
  // 我們寫進去的譯文：節點內容仍等於它時代表已翻譯，不同時代表官網換回了英文
  const written = new WeakMap<Text, string>();
  // 已翻譯詞綴元素 → 英文原文，用於即時切換結果列中英並列副標
  const originalEnglish = new WeakMap<Element, string>();
  const subtitles = new WeakMap<Element, HTMLSpanElement>();
  const observedRoots = new Set<WeakRef<Node>>();
  let resultBilingual = options.resultBilingual === true;
  const fallbackPairs = new Map<string, ModLinePairs>();
  const lookup = createLabelLookup(data.labels, data.templates, data.items, data.names);
  let skeletonIndex: Map<string, Array<readonly [string, string]>> | null = null;
  let maxMultilineSpan = 1;
  let skillModLinesState: 'idle' | 'loading' | 'loaded' = 'idle';
  let loadedSkillModLines: Readonly<Record<string, ModLinePairs>> | undefined;
  const pendingSkillElements = new Set<WeakRef<Element>>();

  const pairsFor = (statId: string, hash: string | undefined): ModLinePairs[] => {
    const result: ModLinePairs[] = [];
    const lines = hash ? data.modLines[hash] : undefined;
    if (lines) result.push(lines);
    if (!data.tradeStats) return result;
    let fallback = fallbackPairs.get(statId);
    if (!fallback) {
      const en = asList(data.tradeStats.en[statId]);
      const localized = asList(data.tradeStats.localized[statId]);
      fallback =
        en.length === localized.length
          ? en.flatMap((text, i): Array<readonly [string, string]> => {
              const zh = localized[i];
              const exact = [
                tradeTextToModTemplate(text, { stripTrailingParen: false }),
                tradeTextToModTemplate(zh, { stripTrailingParen: false }),
              ] as const;
              return TRAILING_PAREN.test(text)
                ? [exact, [tradeTextToModTemplate(text), tradeTextToModTemplate(zh)] as const]
                : [exact];
            })
          : [];
      fallbackPairs.set(statId, fallback);
    }
    if (fallback.length) result.push(fallback);
    return result;
  };

  /** 英文句型骨架（數值換成 #）→ 所有遊戲寫法變體（modLines 優先於 extraModLines）；第一次用到時才建立 */
  const ensureSentenceIndex = (): Map<string, Array<readonly [string, string]>> => {
    if (skeletonIndex) return skeletonIndex;
    skeletonIndex = new Map();
    const expanded: Array<readonly [string, string]> = [];
    const add = (pair: readonly [string, string]) => {
      const key = modTemplateSkeleton(pair[0]);
      if (!key) return;
      const bucket = skeletonIndex!.get(key);
      if (bucket) bucket.push(pair);
      else skeletonIndex!.set(key, [pair]);
    };
    const sources = [
      data.modLines,
      ...(data.extraModLines ? [data.extraModLines] : []),
      ...(loadedSkillModLines ? [loadedSkillModLines] : []),
    ];
    for (const source of sources) {
      for (const pairs of Object.values(source)) {
        for (const pair of pairs) {
          add(pair);
          const englishLines = pair[0].split(LINE_BREAK);
          if (englishLines.length > maxMultilineSpan) maxMultilineSpan = englishLines.length;
          if (englishLines.length >= 2) {
            const localizedLines = pair[1].split(LINE_BREAK);
            if (englishLines.length === localizedLines.length) {
              englishLines.forEach((line, index) => {
                expanded.push([line, localizedLines[index]] as const);
              });
            }
          }
        }
      }
    }
    for (const pair of expanded) add(pair);
    return skeletonIndex;
  };

  const pairsForSentence = (english: string): ModLinePairs | undefined =>
    ensureSentenceIndex().get(modLineSkeleton(english));

  /**
   * 物品名套句型（如異變傳奇 `Foulborn {0}` → `穢生 {0}`）。每個佔位值都要是查得到的物品名，
   * 避免隨機稀有名稱誤套其他句型。
   */
  const translateNameTemplate = (name: string): string | null => {
    const match = lookup.matchTemplate(name);
    if (!match) return null;
    const values = match.values.map((value) => data.items[value.toLowerCase()]);
    if (values.some((value) => !value)) return null;
    return match.localizedLiterals
      .map((literal, i) =>
        i < match.localizedOrder.length ? literal + values[match.localizedOrder[i]] : literal,
      )
      .join('');
  };

  const isCurrent = (node: Text) => written.get(node) === node.data;

  const setText = (node: Text, text: string) => {
    if (node.data !== text) node.data = text;
    written.set(node, text);
  };

  const replace = (node: Text, compute: (english: string) => string | null) => {
    if (isCurrent(node)) return;
    const translated = compute(node.data);
    if (translated === null || translated === node.data) return;
    setText(node, translated);
  };

  const translateNodes = (element: Element) => {
    for (const node of textNodesOf(element)) {
      if (isSkipped(node, element)) continue;
      replace(node, (text) => keepPadding(text, lookup.translateText));
    }
  };

  /** 數值的滑鼠提示（例如 DPS 數值的「at max Quality」）；譯文不含英文字母，重跑不會再寫 */
  const translateTitles = (element: Element) => {
    const targets = [element, ...Array.from(element.querySelectorAll('[title]'))];
    for (const target of targets) {
      const title = target.getAttribute('title');
      if (!title || isInsideOwnNode(target, element)) continue;
      const translated = keepPadding(title, lookup.translateText);
      if (translated && translated !== title) target.setAttribute('title', translated);
    }
  };

  /**
   * 把整句譯文分回多個文字節點：以 <br> 分行的逐行寫回；以「: 」這類分隔節點相連的，
   * 在譯文中找同一個分隔符切段；都對不上時整句寫進第一個節點、其餘清空。
   */
  const distribute = (nodes: Text[], translated: string, byLine: boolean): string[] => {
    if (nodes.length === 1) return [translated];
    if (byLine) {
      const lines = translated.split('\n');
      if (lines.length === nodes.length) return lines;
    } else {
      const pieces: string[] = [];
      let rest = translated;
      let pending = -1;
      let ok = true;
      nodes.forEach((node, i) => {
        if (!ok) return;
        const separator = node.data.trim();
        if (!SEPARATOR_NODE.test(separator)) {
          pending = i;
          return;
        }
        const at = rest.indexOf(separator);
        if (pending < 0 || at < 0) {
          ok = false;
          return;
        }
        pieces[pending] = rest.slice(0, at).trim();
        pieces[i] = node.data;
        rest = rest.slice(at + separator.length);
        pending = -1;
      });
      if (ok && pending >= 0) {
        pieces[pending] = rest.trim();
        if (nodes.every((_, i) => pieces[i] !== undefined)) return pieces;
      }
    }
    return nodes.map((_, i) => (i === 0 ? translated : ''));
  };

  const removeSubtitle = (element: Element) => {
    const existing = subtitles.get(element);
    if (!existing) return;
    existing.remove();
    subtitles.delete(element);
  };

  const syncSubtitle = (element: Element) => {
    if (!resultBilingual) {
      removeSubtitle(element);
      return;
    }
    const english = originalEnglish.get(element);
    if (!english || !element.parentElement) {
      removeSubtitle(element);
      return;
    }
    ensureSubtitleStyle(element);
    let subtitle = subtitles.get(element);
    if (!subtitle) {
      subtitle = element.ownerDocument.createElement('span');
      subtitle.className = RESULT_MOD_ENGLISH_SUBTITLE_CLASS;
      subtitles.set(element, subtitle);
    }
    if (subtitle.textContent !== english) subtitle.textContent = english;
    const anchor = findSubtitleAnchor(element, subtitle);
    if (subtitle.previousElementSibling !== anchor) anchor.after(subtitle);
  };

  const translateStat = (element: Element) => {
    const field = element.getAttribute('data-field')?.match(STAT_FIELD);
    if (!field) {
      originalEnglish.delete(element);
      removeSubtitle(element);
      return;
    }
    const candidates = pairsFor(field[1], field[2].match(STAT_HASH)?.[1]);
    if (!candidates.length) {
      originalEnglish.delete(element);
      removeSubtitle(element);
      return;
    }
    const nodes = textNodesOf(element);
    if (!nodes.length || nodes.every(isCurrent)) {
      syncSubtitle(element);
      return;
    }
    const byLine = element.querySelector('br') !== null;
    const english = nodes.map((node) => node.data).join(byLine ? '\n' : '');
    for (const pairs of candidates) {
      const translated = translateModLine(english, pairs);
      if (translated === null) continue;
      distribute(nodes, translated, byLine).forEach((text, i) => setText(nodes[i], text));
      const trimmedEnglish = english.trim();
      if (trimmedEnglish && translated.trim() !== trimmedEnglish) {
        originalEnglish.set(element, trimmedEnglish);
        syncSubtitle(element);
      } else {
        originalEnglish.delete(element);
        removeSubtitle(element);
      }
      return;
    }
    originalEnglish.delete(element);
    removeSubtitle(element);
  };

  /** 把元素內被 `<br>` 分隔的文字節點分組（處理 PoE 2 內嵌 `<span class="keyword">` 的多節點詞綴） */
  const splitModLinesByBr = (element: Element): Text[][] => {
    const groups: Text[][] = [[]];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        if (!isSkipped(text, element)) groups[groups.length - 1].push(text);
        return;
      }
      if (!(node instanceof Element)) return;
      if (isInsideOwnNode(node, element)) return;
      if (node.tagName === 'BR') {
        groups.push([]);
        return;
      }
      for (const child of Array.from(node.childNodes)) walk(child);
    };
    for (const child of Array.from(element.childNodes)) walk(child);
    return groups.filter((group) => group.some((node) => node.data.trim()));
  };

  const requestSkillModLines = (element: Element) => {
    if (!data.loadSkillModLines || skillModLinesState === 'loaded') return;
    pendingSkillElements.add(new WeakRef(element));
    if (skillModLinesState === 'loading') return;
    skillModLinesState = 'loading';
    void data
      .loadSkillModLines()
      .then((lines) => {
        skillModLinesState = 'loaded';
        if (!lines || Object.keys(lines).length === 0) {
          pendingSkillElements.clear();
          return;
        }
        loadedSkillModLines = lines;
        skeletonIndex = null;
        const targets = new Set<Element>();
        for (const ref of pendingSkillElements) {
          const el = ref.deref();
          if (el?.isConnected) targets.add(el);
        }
        pendingSkillElements.clear();
        for (const ref of Array.from(observedRoots)) {
          const root = ref.deref();
          if (!root) {
            observedRoots.delete(ref);
            continue;
          }
          if (
            root instanceof Element ||
            root instanceof Document ||
            (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
          ) {
            if (root instanceof Element && root.matches(MOD_SELECTOR)) targets.add(root);
            root.querySelectorAll(MOD_SELECTOR).forEach((el) => targets.add(el));
          }
        }
        for (const el of targets) {
          if (el.isConnected && !el.closest(`[${PAGE_GUIDE_MOCK_ATTR}]`)) translateMod(el);
        }
      })
      .catch(() => {
        skillModLinesState = 'loaded';
        pendingSkillElements.clear();
      });
  };

  const translateMod = (element: Element) => {
    const groups = splitModLinesByBr(element);
    const allNodes = groups.flat();
    const nonBlank = allNodes.filter((node) => node.data.trim());
    if (!nonBlank.length || nonBlank.every(isCurrent)) {
      syncSubtitle(element);
      return;
    }
    const english = groups
      .map((group) =>
        group
          .map((node) => node.data)
          .join('')
          .trim(),
      )
      .filter(Boolean)
      .join('\n');

    // 先試整段多行句型（例如有 <br> 分行的寶石效果）
    if (groups.length > 1) {
      const wholeTranslated = translateModLine(english, pairsForSentence(english));
      if (wholeTranslated !== null && wholeTranslated.trim() !== english) {
        const lines = wholeTranslated.split('\n');
        if (lines.length === groups.length) {
          groups.forEach((group, i) =>
            group.forEach((node, j) => setText(node, j === 0 ? lines[i] : '')),
          );
        } else {
          groups.forEach((group, i) =>
            group.forEach((node, j) => setText(node, i === 0 && j === 0 ? wholeTranslated : '')),
          );
        }
        originalEnglish.set(element, english);
        syncSubtitle(element);
        return;
      }
    }

    let anyTranslated = false;
    let anyMissed = false;
    for (const group of groups) {
      if (group.every(isCurrent)) continue;
      const raw = group.map((node) => node.data).join('');
      const translated = keepPadding(raw, (core) => translateModLine(core, pairsForSentence(core)));
      if (translated === null || translated === raw) {
        anyMissed = true;
        continue;
      }
      group.forEach((node, i) => setText(node, i === 0 ? translated : ''));
      anyTranslated = true;
    }
    if (anyMissed) requestSkillModLines(element);
    if (anyTranslated && english) {
      originalEnglish.set(element, english);
      syncSubtitle(element);
    } else if (!allNodes.some(isCurrent)) {
      originalEnglish.delete(element);
      removeSubtitle(element);
    }
  };

  /**
   * 整行套用模板。每個數值都要對得到自己的節點（避免開頭是佔位符的模板吞掉標籤），
   * 整行只有一個文字節點時例外。佔位順序與英文相同且每段文字都有節點可放時，只換文字段、
   * 保留數值節點（數值的顏色樣式不變）；否則整行寫進第一個節點、其餘清空。
   */
  const applyLine = (nodes: Text[], match: TemplateMatch): boolean => {
    const slots: number[] = [];
    nodes.forEach((node, i) => {
      const next = match.englishOrder[slots.length];
      if (next !== undefined && normalizeSpace(node.data) === match.values[next]) slots.push(i);
    });
    const complete = slots.length === match.englishOrder.length;
    if (!complete) {
      if (nodes.filter((node) => node.data.trim()).length > 1) return false;
      nodes.forEach((node, i) => setText(node, i === 0 ? match.translated : ''));
      return true;
    }
    const gaps: Text[][] = [];
    let previous = -1;
    for (const slot of [...slots, nodes.length]) {
      gaps.push(nodes.slice(previous + 1, slot));
      previous = slot;
    }
    if (
      match.localizedOrder.join() === match.englishOrder.join() &&
      gaps.every((gap, i) => gap.length > 0 || !match.localizedLiterals[i].trim())
    ) {
      gaps.forEach((gap, i) =>
        gap.forEach((node, j) => setText(node, j === 0 ? match.localizedLiterals[i] : '')),
      );
      // 數值節點本身可能是「5 Mana」這類數值加標籤
      slots.forEach((slot) => {
        written.delete(nodes[slot]);
        replace(nodes[slot], (text) => keepPadding(text, lookup.translateText));
        if (!written.has(nodes[slot])) written.set(nodes[slot], nodes[slot].data);
      });
    } else {
      nodes.forEach((node, i) => setText(node, i === 0 ? match.translated : ''));
    }
    return true;
  };

  const translateProperty = (element: Element) => {
    const nodes = textNodesOf(element, true).filter((node) => !isSkipped(node, element));
    if (!nodes.length || nodes.every(isCurrent)) return;
    const match = lookup.matchTemplate(nodes.map((node) => node.data).join(''));
    if (!match || !applyLine(nodes, match)) translateNodes(element);
  };

  const translateTime = (element: Element) => {
    if (!data.locale) return;
    const locale = data.locale;
    for (const node of textNodesOf(element)) {
      replace(node, (text) => keepPadding(text, (core) => translateListedTime(core, locale)));
    }
  };

  /**
   * 辨識官方 ItemPopup 的 `notableProperties` 區塊：
   * `.item-popup__content` 下無 class/style 的 `<div>`，首個子元素是不帶 `.lc` 的 `<span>`（天賦名），
   * 其後以 `<br>` 分隔純文字或 `<em>` 效果行。旗標（內含 `span.lc`）與備註（帶 `style`）皆不匹配。
   */
  const findNotableTitleSpan = (element: Element): Element | null => {
    const first = element.firstElementChild;
    if (
      !first ||
      first.tagName !== 'SPAN' ||
      first.classList.contains('lc') ||
      !element.querySelector('br')
    ) {
      return null;
    }
    return first;
  };

  const collectNotableLines = (
    element: Element,
    titleSpan: Element,
  ): Array<{ node: Text; isEm: boolean }> => {
    const lines: Array<{ node: Text; isEm: boolean }> = [];
    let pastTitle = false;
    for (const child of Array.from(element.childNodes)) {
      if (child === titleSpan) {
        pastTitle = true;
        continue;
      }
      if (!pastTitle) continue;
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child as Text;
        if (text.data.trim() || written.has(text)) lines.push({ node: text, isEm: false });
      } else if (
        child instanceof Element &&
        child.tagName === 'EM' &&
        !isInsideOwnNode(child, element)
      ) {
        for (const text of textNodesOf(child, true)) {
          if (text.data.trim() || written.has(text)) lines.push({ node: text, isEm: true });
        }
      }
    }
    return lines;
  };

  const translateNotable = (element: Element) => {
    const titleSpan = findNotableTitleSpan(element);
    if (!titleSpan) return;

    const passives = data.passives;
    if (passives) {
      for (const node of textNodesOf(titleSpan)) {
        replace(node, (text) => keepPadding(text, (core) => passives[core.toLowerCase()] ?? null));
      }
    }

    const lines = collectNotableLines(element, titleSpan);
    if (!lines.length || lines.every((line) => isCurrent(line.node))) return;

    ensureSentenceIndex();

    for (let i = 0; i < lines.length;) {
      if (isCurrent(lines[i].node)) {
        i += 1;
        continue;
      }
      let maxSpan = 1;
      const limit = Math.min(maxMultilineSpan, lines.length - i);
      while (
        maxSpan < limit &&
        lines[i + maxSpan].isEm === lines[i].isEm &&
        !isCurrent(lines[i + maxSpan].node)
      ) {
        maxSpan += 1;
      }

      let matchedSpan = 0;
      for (let span = maxSpan; span >= 2; span -= 1) {
        const joined = lines
          .slice(i, i + span)
          .map((line) => line.node.data.trim())
          .join('\n');
        const translated = translateModLine(joined, pairsForSentence(joined));
        if (translated === null) continue;
        const translatedLines = translated.split('\n');
        if (translatedLines.length === span) {
          for (let k = 0; k < span; k += 1) setText(lines[i + k].node, translatedLines[k]);
        } else if (translatedLines.length < span) {
          for (let k = 0; k < span; k += 1) setText(lines[i + k].node, translatedLines[k] ?? '');
        } else {
          for (let k = 0; k < span - 1; k += 1) setText(lines[i + k].node, translatedLines[k]);
          setText(lines[i + span - 1].node, translatedLines.slice(span - 1).join('\n'));
        }
        matchedSpan = span;
        break;
      }
      if (matchedSpan > 0) {
        i += matchedSpan;
        continue;
      }

      const { node } = lines[i];
      replace(node, (text) =>
        keepPadding(
          text,
          (core) => translateModLine(core, pairsForSentence(core)) ?? lookup.translateText(core),
        ),
      );
      i += 1;
    }
  };

  /** 物品與寶石說明：多節點（PoE 2 `<span class="keyword">`）先合併整句查表，查不到再逐節點翻 */
  const translateDesc = (element: Element) => {
    const nodes = textNodesOf(element, true).filter((node) => !isSkipped(node, element));
    const nonBlank = nodes.filter((node) => node.data.trim());
    if (!nonBlank.length || nonBlank.every(isCurrent)) return;
    if (nonBlank.length > 1) {
      const joined = nodes.map((node) => node.data).join('');
      const translated = keepPadding(joined, lookup.translateText);
      if (translated && translated !== joined) {
        nodes.forEach((node, i) => setText(node, i === 0 ? translated : ''));
        return;
      }
    }
    translateNodes(element);
    translateTitles(element);
  };

  const translateElement = (element: Element) => {
    if (element.closest(`[${PAGE_GUIDE_MOCK_ATTR}]`)) return;
    if (element.matches(STAT_SELECTOR)) {
      translateStat(element);
    } else if (element.matches(HEADER_SELECTOR)) {
      const partial = isSingleLineHeader(element);
      for (const node of textNodesOf(element)) {
        replace(node, (text) =>
          keepPadding(
            text,
            (name) =>
              translateResultItemName(name, data.items, partial) ?? translateNameTemplate(name),
          ),
        );
      }
    } else if (element.matches(PROPERTY_SELECTOR)) {
      translateProperty(element);
    } else if (element.matches(MOD_SELECTOR)) {
      translateMod(element);
    } else if (element.matches(TIME_SELECTOR)) {
      translateTime(element);
    } else if (element.matches(DESC_SELECTOR)) {
      translateDesc(element);
    } else if (element.matches(LABEL_SELECTOR)) {
      translateNodes(element);
      translateTitles(element);
    } else if (element.matches(NOTABLE_SELECTOR)) {
      translateNotable(element);
    }
  };

  const translate = (root: ParentNode) => {
    if (root instanceof Element && root.closest(`[${PAGE_GUIDE_MOCK_ATTR}]`)) return;
    if (root instanceof Element && root.matches(TARGET_SELECTOR)) translateElement(root);
    root.querySelectorAll(TARGET_SELECTOR).forEach(translateElement);
  };

  const observe = (root: Node) => {
    const pending = new Set<Element>();
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const targets = Array.from(pending);
      pending.clear();
      for (const target of targets) if (target.isConnected) translate(target);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          const target = record.target.parentElement?.closest(TARGET_SELECTOR);
          if (target) pending.add(target);
        } else if (record.type === 'attributes') {
          // 官網重繪把 title 換回英文
          const target = (record.target as Element).closest?.(TARGET_SELECTOR);
          if (target) pending.add(target);
        } else {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) {
              if (!node.matches(OWN_NODE_SELECTOR)) {
                pending.add(node);
                if (node.matches(MOD_MARKER_SELECTOR) && record.target instanceof Element) {
                  pending.add(record.target);
                }
              }
            } else if (node.parentElement && !node.parentElement.closest(OWN_NODE_SELECTOR)) {
              pending.add(node.parentElement.closest(TARGET_SELECTOR) ?? node.parentElement);
            }
          });
          // 屬性行內部重繪時要整行重比
          const line = (record.target as Element).closest?.(PROPERTY_SELECTOR);
          if (line) pending.add(line);
        }
      }
      if (pending.size && !scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title'],
    });
    const rootRef = new WeakRef(root);
    observedRoots.add(rootRef);
    if (
      root instanceof Element ||
      root instanceof Document ||
      (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
    ) {
      translate(root);
    }
    return () => {
      observer.disconnect();
      observedRoots.delete(rootRef);
    };
  };

  const setResultBilingual = (enabled: boolean) => {
    if (enabled === resultBilingual) return;
    resultBilingual = enabled;
    for (const ref of Array.from(observedRoots)) {
      const root = ref.deref();
      if (!root) {
        observedRoots.delete(ref);
        continue;
      }
      if (
        !(
          root instanceof Element ||
          root instanceof Document ||
          (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot)
        )
      ) {
        continue;
      }
      if (enabled) {
        if (
          root instanceof Element &&
          root.matches(MOD_SUBTITLE_TARGET_SELECTOR) &&
          !root.closest(`[${PAGE_GUIDE_MOCK_ATTR}]`)
        ) {
          syncSubtitle(root);
        }
        root.querySelectorAll(MOD_SUBTITLE_TARGET_SELECTOR).forEach((el) => {
          if (!el.closest(`[${PAGE_GUIDE_MOCK_ATTR}]`)) syncSubtitle(el);
        });
      } else {
        root.querySelectorAll(MOD_SUBTITLE_TARGET_SELECTOR).forEach(removeSubtitle);
        root.querySelectorAll(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`).forEach((el) => el.remove());
      }
    }
  };

  return { translate, observe, setResultBilingual };
}
