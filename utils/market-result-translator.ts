/**
 * 市集漢化第 4 階段：結果列 DOM 層（ADR-0012）。
 *
 * - 詞綴行（`[data-field="stat.<category>.stat_<hash>"]`）用遊戲寫法：先查 `mod-lines.json`，
 *   描述檔查不到的代碼再以市集寫法（中英 trade-stats）備援，都查不到保留英文。
 * - 物品名（標題列）查 `items.json`；屬性行標籤查官方介面字典與篩選器欄位名稱。
 *
 * 只改既有文字節點的內容、不增刪節點，Vue 的節點對應不受影響。官網重繪把文字換回英文時，
 * MutationObserver 會再翻一次。
 */
import { tradeTextToModTemplate, translateModLine, type ModLinePairs } from './market-mod-lines';

type TextMap = Readonly<Record<string, string>>;
type TradeStatTexts = Readonly<Record<string, string | readonly string[]>>;

export interface ResultTranslatorData {
  /** stat hash → [英文模板, 譯文模板]（mod-lines.json） */
  modLines: Readonly<Record<string, ModLinePairs>>;
  /** 市集寫法備援：國際服英文與目標語系的 trade-stats（stat id → 文字） */
  tradeStats?: { en: TradeStatTexts; localized: TradeStatTexts };
  /** 英文物品名（小寫）→ 譯名 */
  items: TextMap;
  /** 屬性行標籤（英文 → 譯文） */
  labels: TextMap;
}

const STAT_SELECTOR = '[data-field^="stat."]';
const HEADER_SELECTOR = '.item-popup__header-line';
const PROPERTY_SELECTOR = '.item-property';
const TARGET_SELECTOR = `${STAT_SELECTOR}, ${HEADER_SELECTOR}, ${PROPERTY_SELECTOR}`;
const STAT_FIELD = /^stat\.([a-z_]+\.stat_(\d+))$/;

const asList = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

function textNodesOf(element: Element): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.trim()) nodes.push(node as Text);
  }
  return nodes;
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

  const replace = (node: Text, compute: (english: string) => string | null) => {
    if (written.get(node) === node.data) return;
    const translated = compute(node.data);
    if (translated === null || translated === node.data) return;
    node.data = translated;
    written.set(node, translated);
  };

  /** 保留前後空白與結尾冒號，只換中間的標籤文字 */
  const swapLabel = (text: string, lookup: (key: string) => string | undefined) => {
    const match = text.match(/^(\s*)(.*?)(:?\s*)$/s);
    if (!match) return null;
    const translated = lookup(match[2]);
    return translated ? `${match[1]}${translated}${match[3]}` : null;
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

  const translateElement = (element: Element) => {
    if (element.matches(STAT_SELECTOR)) {
      translateStat(element);
    } else if (element.matches(HEADER_SELECTOR)) {
      for (const node of textNodesOf(element)) {
        replace(node, (text) => swapLabel(text, (key) => data.items[key.toLowerCase()]));
      }
    } else if (element.matches(PROPERTY_SELECTOR)) {
      for (const node of textNodesOf(element)) {
        if (node.parentElement?.closest(STAT_SELECTOR)) continue;
        replace(node, (text) => swapLabel(text, (key) => data.labels[key]));
      }
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
        }
      }
      if (pending.size && !scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    if (root instanceof Element || root instanceof Document) translate(root);
    return () => observer.disconnect();
  };

  return { translate, observe };
}
