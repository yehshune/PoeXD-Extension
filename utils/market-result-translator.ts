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
import {
  createLabelLookup,
  normalizeSpace,
  translateListedTime,
  type LabelTemplates,
  type TemplateMatch,
  type TextMap,
} from './market-result-labels';

type TradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

export interface ResultTranslatorData {
  /** stat hash → [英文模板, 譯文模板]（mod-lines.json） */
  modLines: Readonly<Record<string, ModLinePairs>>;
  /** 市集寫法備援：國際服英文與目標語系的 trade-stats（stat id → 文字） */
  tradeStats?: { en: TradeStatTexts; localized: TradeStatTexts };
  /** 英文物品名（小寫）→ 譯名 */
  items: TextMap;
  /** 標籤（英文 → 譯文） */
  labels: TextMap;
  /** 帶 `{n}` 佔位符的句型（英文, 譯文） */
  templates?: LabelTemplates;
  /** 相對時間的輸出語系 */
  locale?: string;
}

const STAT_SELECTOR = '[data-field^="stat."]';
const HEADER_SELECTOR = '.item-popup__header-line';
const PROPERTY_SELECTOR = '.item-property';
const MOD_SELECTOR = '.item-mod > span.lc:not([data-field]):not(.l):not(.r)';
const TIME_SELECTOR = '[data-field="indexed"] small';
const LABEL_SELECTOR = [
  '.item-popup__sec-desc-text',
  '.item-popup__content > div:not([class]) > .lc',
  '.itemPopupAdditional [data-field]',
  '.price-label',
  '.verifiedStatus',
  '.btns .status',
  '.btns button',
].join(', ');
const TARGET_SELECTOR = [
  STAT_SELECTOR,
  HEADER_SELECTOR,
  PROPERTY_SELECTOR,
  MOD_SELECTOR,
  TIME_SELECTOR,
  LABEL_SELECTOR,
].join(', ');
/** 我們自己插入的節點（價格比較等）不翻譯 */
const SKIP_SELECTOR = `${STAT_SELECTOR}, [class*="poexd"]`;
const STAT_FIELD = /^stat\.([a-z_]+\.stat_(\d+))$/;
const MOD_PLACEHOLDER = /\{\d+:\+?[dn]\}/g;
const MOD_NUMBER = /[+-]?\d+(?:\.\d+)?/g;

/** 節點在 root 內部是否屬於要略過的區塊（root 外層的祖先不算） */
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

export interface ResultTranslator {
  /** 翻譯 root 底下（含 root 本身）所有結果列節點 */
  translate(root: ParentNode): void;
  /** 監看 root 的新增與文字變更；回傳停止函式 */
  observe(root: Node): () => void;
}

export function createResultTranslator(data: ResultTranslatorData): ResultTranslator {
  // 我們寫進去的譯文：節點內容仍等於它時代表已翻譯，不同時代表官網換回了英文
  const written = new WeakMap<Text, string>();
  const fallbackPairs = new Map<string, ModLinePairs>();
  const lookup = createLabelLookup(data.labels, data.templates, data.items);
  let skeletonIndex: Map<string, ModLinePairs> | null = null;

  const pairsFor = (statId: string, hash: string): ModLinePairs[] => {
    const result: ModLinePairs[] = [];
    const lines = data.modLines[hash];
    if (lines) result.push(lines);
    if (!data.tradeStats) return result;
    let fallback = fallbackPairs.get(statId);
    if (!fallback) {
      const en = asList(data.tradeStats.en[statId]);
      const localized = asList(data.tradeStats.localized[statId]);
      fallback =
        en.length === localized.length
          ? en.map((text, i) => [
              tradeTextToModTemplate(text),
              tradeTextToModTemplate(localized[i]),
            ])
          : [];
      fallbackPairs.set(statId, fallback);
    }
    if (fallback.length) result.push(fallback);
    return result;
  };

  /** 英文句型骨架（數值換成 #）→ 所有遊戲寫法變體；第一次用到時才建立 */
  const pairsForSentence = (english: string): ModLinePairs | undefined => {
    if (!skeletonIndex) {
      skeletonIndex = new Map();
      for (const pairs of Object.values(data.modLines)) {
        for (const pair of pairs) {
          if (pair[0].includes('\\n')) continue;
          const key = pair[0].replace(MOD_PLACEHOLDER, '#');
          skeletonIndex.set(key, [...(skeletonIndex.get(key) ?? []), pair]);
        }
      }
    }
    return skeletonIndex.get(english.replace(MOD_NUMBER, '#'));
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

  const translateStat = (element: Element) => {
    const field = element.getAttribute('data-field')?.match(STAT_FIELD);
    if (!field) return;
    const candidates = pairsFor(field[1], field[2]);
    if (!candidates.length) return;
    const nodes = textNodesOf(element);
    if (nodes.length !== 1) return;
    replace(nodes[0], (english) => {
      for (const pairs of candidates) {
        const translated = translateModLine(english, pairs);
        if (translated !== null) return translated;
      }
      return null;
    });
  };

  const translateMod = (element: Element) => {
    for (const node of textNodesOf(element)) {
      replace(node, (text) =>
        keepPadding(text, (core) => translateModLine(core, pairsForSentence(core))),
      );
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

  const translateElement = (element: Element) => {
    if (element.matches(STAT_SELECTOR)) {
      translateStat(element);
    } else if (element.matches(HEADER_SELECTOR)) {
      for (const node of textNodesOf(element)) {
        replace(node, (text) => keepPadding(text, (key) => data.items[key.toLowerCase()] ?? null));
      }
    } else if (element.matches(PROPERTY_SELECTOR)) {
      translateProperty(element);
    } else if (element.matches(MOD_SELECTOR)) {
      translateMod(element);
    } else if (element.matches(TIME_SELECTOR)) {
      translateTime(element);
    } else if (element.matches(LABEL_SELECTOR)) {
      translateNodes(element);
    }
  };

  const translate = (root: ParentNode) => {
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
        } else {
          record.addedNodes.forEach((node) => {
            if (node instanceof Element) pending.add(node);
            else node.parentElement && pending.add(node.parentElement);
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
    });
    if (root instanceof Element || root instanceof Document) translate(root);
    return () => observer.disconnect();
  };

  return { translate, observe };
}
