/**
 * 釘選物品的官方卡片快照（ADR-0017）。
 *
 * 釘選時複製官方結果列的物品圖示區（`.left .newItemContainer`）與物品框（`.middle` 的子節點），
 * 存成清理過的 JSON 節點樹；Sidebar 以 `createElement` / `textContent` / 驗證過的屬性重建，
 * 不經過 HTML 解析。這樣插槽、勢力符號、詞綴範圍與 PoE 1 / PoE 2 的差異都與官方一致，
 * 不必自己維護一份結果卡片。
 *
 * 官方 DOM 是頁面內容（物品名、備註可由玩家輸入），一律視為不可信：
 * - 只保留白名單標籤；其他元素（按鈕、連結、svg 等）連同子節點整個丟掉。
 * - class 只留合法 token，並移除我們自己加的 `poexd-*`；只有 `poexd-*` class 的節點是我們注入的，整個丟掉。
 * - 屬性只留 `data-field`、`title`；`img` 只允許官方 CDN 網址；`style` 只留 `color`。
 * - 節點數、深度與序列化大小都有上限，超過就不保存快照（改用自繪卡片）。
 * 建立快照與從儲存讀回都走同一套驗證（`sanitizePinnedCardDom`）。
 */
import { isValidPoeCdnImageUrl } from './poe-cdn-url';

export type PinnedCardNode = string | PinnedCardElement;

export interface PinnedCardElement {
  /** 標籤 */
  t: PinnedCardTag;
  /** class */
  c?: string;
  /** data-field */
  f?: string;
  /** title */
  ti?: string;
  /** 文字顏色（style color） */
  co?: string;
  /** img src（官方 CDN） */
  src?: string;
  /** img alt */
  alt?: string;
  /** 子節點 */
  k?: PinnedCardNode[];
}

export interface PinnedCardDom {
  /** `.newItemContainer`（物品圖示與插槽） */
  icon?: PinnedCardElement;
  /** `.middle` 的子節點（`.item-popup` 等） */
  popup: PinnedCardNode[];
}

const ALLOWED_TAGS = [
  'div',
  'span',
  'br',
  'hr',
  'img',
  'small',
  'b',
  'i',
  'em',
  'strong',
  'sup',
  'sub',
] as const;
export type PinnedCardTag = (typeof ALLOWED_TAGS)[number];

const VOID_TAGS: ReadonlySet<PinnedCardTag> = new Set(['br', 'hr', 'img']);
/** 官方節點中不屬於物品本身的部分（刊登狀態） */
const DROPPED_OFFICIAL_CLASSES: ReadonlySet<string> = new Set(['verifiedStatus']);

const MAX_NODES = 3000;
const MAX_DEPTH = 32;
const MAX_TEXT_LENGTH = 2000;
const MAX_CLASS_TOKENS = 16;
/** 序列化後的上限；一般物品約 5–15 KB */
export const PINNED_CARD_MAX_JSON_LENGTH = 64 * 1024;

const CLASS_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DATA_FIELD = /^[A-Za-z0-9_.|+-]{1,160}$/;
/** `var(--x)`、hex，以及瀏覽器正規化後的 `rgb()` / `rgba()` */
const COLOR_VALUE =
  /^(?:var\(--[A-Za-z0-9-]{1,64}\)|#[0-9A-Fa-f]{3,8}|rgba?\(\d{1,3}, \d{1,3}, \d{1,3}(?:, (?:0|1|0?\.\d{1,4}))?\))$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAllowedTag = (value: unknown): value is PinnedCardTag =>
  typeof value === 'string' && (ALLOWED_TAGS as readonly string[]).includes(value);

const boundedText = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const isOwnToken = (token: string) => token.startsWith('poexd');

/** 合法的官方 class token；全部都是我們自己的 token 時回傳 null（代表整個節點要丟掉） */
function sanitizeClass(value: unknown): string | null | undefined {
  if (typeof value !== 'string') return undefined;
  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  if (tokens.every(isOwnToken)) return null;
  if (tokens.some((token) => DROPPED_OFFICIAL_CLASSES.has(token))) return null;
  const kept = [
    ...new Set(tokens.filter((token) => !isOwnToken(token) && CLASS_TOKEN.test(token))),
  ];
  return kept.length > 0 ? kept.slice(0, MAX_CLASS_TOKENS).join(' ') : undefined;
}

interface Budget {
  nodes: number;
}

function sanitizeNode(raw: unknown, depth: number, budget: Budget): PinnedCardNode | undefined {
  if (++budget.nodes > MAX_NODES) throw new RangeError('too many nodes');
  if (typeof raw === 'string') return raw.length <= MAX_TEXT_LENGTH ? raw : undefined;
  if (!isRecord(raw) || !isAllowedTag(raw.t)) return undefined;
  if (depth > MAX_DEPTH) throw new RangeError('too deep');

  const node: PinnedCardElement = { t: raw.t };
  const cls = sanitizeClass(raw.c);
  if (cls === null) return undefined;
  if (cls) node.c = cls;
  if (typeof raw.f === 'string' && DATA_FIELD.test(raw.f)) node.f = raw.f;
  const title = boundedText(raw.ti, 200);
  if (title) node.ti = title;
  if (typeof raw.co === 'string' && COLOR_VALUE.test(raw.co)) node.co = raw.co;

  if (node.t === 'img') {
    if (!isValidPoeCdnImageUrl(raw.src)) return undefined;
    node.src = raw.src;
    const alt = boundedText(raw.alt, 100);
    if (alt) node.alt = alt;
    return node;
  }
  if (VOID_TAGS.has(node.t)) return node;

  if (Array.isArray(raw.k)) {
    const children = raw.k
      .map((child) => sanitizeNode(child, depth + 1, budget))
      .filter((child): child is PinnedCardNode => child !== undefined);
    if (children.length > 0) node.k = children;
  }
  return node;
}

/** 驗證卡片快照（建立快照與讀回儲存共用）；不合格回傳 undefined */
export function sanitizePinnedCardDom(raw: unknown): PinnedCardDom | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.popup)) return undefined;
  try {
    const budget: Budget = { nodes: 0 };
    const icon = raw.icon === undefined ? undefined : sanitizeNode(raw.icon, 0, budget);
    const popup = raw.popup
      .map((node) => sanitizeNode(node, 0, budget))
      .filter((node): node is PinnedCardElement => typeof node === 'object');
    if (popup.length === 0) return undefined;
    const dom: PinnedCardDom = {
      ...(icon && typeof icon === 'object' ? { icon } : {}),
      popup,
    };
    return JSON.stringify(dom).length <= PINNED_CARD_MAX_JSON_LENGTH ? dom : undefined;
  } catch {
    return undefined;
  }
}

/** 把畫面上的元素轉成節點樹（尚未驗證，交給 sanitizePinnedCardDom） */
function toRawNode(node: Node): unknown {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data;
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (!isAllowedTag(tag)) return undefined;
  const color = (element as HTMLElement).style?.color || undefined;
  return {
    t: tag,
    c: element.getAttribute('class') ?? undefined,
    f: element.getAttribute('data-field') ?? undefined,
    ti: element.getAttribute('title') ?? undefined,
    co: color,
    src: tag === 'img' ? (element as HTMLImageElement).src : undefined,
    alt: tag === 'img' ? (element.getAttribute('alt') ?? undefined) : undefined,
    k: Array.from(element.childNodes)
      .map(toRawNode)
      .filter((child) => child !== undefined),
  };
}

/** 從官方結果列擷取卡片快照；找不到物品框或超過上限時回傳 undefined */
export function capturePinnedCardDom(row: Element): PinnedCardDom | undefined {
  const middle = row.querySelector(':scope > .middle');
  if (!middle?.querySelector('.item-popup')) return undefined;
  const icon = row.querySelector(':scope > .left .newItemContainer');
  return sanitizePinnedCardDom({
    icon: icon ? toRawNode(icon) : undefined,
    popup: Array.from(middle.childNodes)
      .map(toRawNode)
      .filter((child) => child !== undefined),
  });
}

/** 以驗證過的節點樹重建 DOM（不使用 innerHTML） */
export function buildPinnedCardNode(node: PinnedCardNode, doc: Document): Node {
  if (typeof node === 'string') return doc.createTextNode(node);
  const element = doc.createElement(node.t);
  if (node.c) element.className = node.c;
  if (node.f) element.setAttribute('data-field', node.f);
  if (node.ti) element.setAttribute('title', node.ti);
  if (node.co) element.style.color = node.co;
  if (node.t === 'img' && node.src) {
    const img = element as HTMLImageElement;
    img.src = node.src;
    img.alt = node.alt ?? '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
  }
  node.k?.forEach((child) => element.appendChild(buildPinnedCardNode(child, doc)));
  return element;
}
