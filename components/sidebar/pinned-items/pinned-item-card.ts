/**
 * 以官方結果卡片的 class 組出釘選物品卡片，樣式交給官方市集 CSS。
 *
 * 快照內容來自官方 fetch（不可信輸入），只用 `textContent` 與固定的 class / style 組 DOM，
 * 不使用 `innerHTML`，也不把輸入內容寫進 class 或 style。寫進屬性的只有官方 CDN 圖示網址，
 * 以及通過格式驗證的詞綴代碼（`data-field`）。
 * 標記結構與官方結果列相同（`data-field="stat.…"`、`.item-property`、`.item-mod > span.lc`），
 * 市集漢化的結果列翻譯器才能翻譯卡片。官方改 class 名稱時需要跟進（與既有結果增強相同的依賴）。
 */
import type { PinnedItemSnapshot } from '@/utils/pinned-items';
import { readTradeItemModLines, unwrapItemMarkup } from '@/utils/trade-item-mods';

/** 官方市集頁載入的樣式檔（檔名帶 hash，不能寫死，執行時從頁面取得） */
export function collectOfficialStylesheetHrefs(doc: Document = document): string[] {
  const hrefs = Array.from(doc.styleSheets)
    .map((sheet) => sheet.href)
    .filter((href): href is string => typeof href === 'string');
  return hrefs.filter((href) => {
    try {
      const url = new URL(href);
      return url.protocol === 'https:' && /(^|\.)poecdn\.(com|game\.qq\.com)$/.test(url.hostname);
    } catch {
      return false;
    }
  });
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const RARITY_BY_FRAME_TYPE: Readonly<Record<number, string>> = {
  0: 'normal',
  1: 'magic',
  2: 'rare',
  3: 'unique',
  4: 'gem',
  5: 'currency',
  6: 'divination',
  9: 'unique',
};

/** 官方物品名稱的稀有度顏色（以 CSS 語意變數驅動，自動隨明暗配色切換高對比色票） */
export const RARITY_COLOURS: Readonly<Record<string, string>> = {
  normal: 'var(--foreground)',
  magic: 'var(--pxd-rarity-magic, oklch(0.68 0.13 258))',
  rare: 'var(--pxd-rarity-rare, oklch(0.76 0.13 92))',
  unique: 'var(--pxd-rarity-unique, oklch(0.68 0.15 50))',
  gem: 'var(--pxd-rarity-gem, oklch(0.7 0.1 190))',
  currency: 'var(--pxd-rarity-currency, oklch(0.74 0.06 82))',
  divination: 'var(--pxd-rarity-divination, oklch(0.72 0.12 225))',
};

export function resolveRarityClass(item: Json): string {
  const byName = text(item.rarity).toLowerCase();
  if (['normal', 'magic', 'rare', 'unique'].includes(byName)) return byName;
  return typeof item.frameType === 'number'
    ? (RARITY_BY_FRAME_TYPE[item.frameType] ?? 'normal')
    : 'normal';
}

/** 官方數值顏色（`values` 的第二個元素）；未知類型用預設顏色 */
const VALUE_COLOURS: Readonly<Record<number, string>> = {
  0: 'var(--colour-value-default)',
  1: 'var(--colour-augmented)',
};

/** 卡片上各詞綴區段的顯示順序（與官方市集卡片一致） */
const MOD_SECTION_ORDER = [
  'enchant',
  'implicit',
  'fractured',
  'explicit',
  'crafted',
  'desecrated',
  'rune',
] as const;
const MOD_SECTION_SET = new Set<string>(MOD_SECTION_ORDER);

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function valueSpan(doc: Document, value: unknown): HTMLSpanElement | undefined {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return undefined;
  const span = el(doc, 'span', undefined, unwrapItemMarkup(value[0]));
  const colour = typeof value[1] === 'number' ? VALUE_COLOURS[value[1]] : undefined;
  span.style.color = colour ?? VALUE_COLOURS[0]!;
  return span;
}

/** 官方 property：`displayMode 3` 以 `{0}` 佔位，其餘為「名稱: 數值」 */
function renderProperty(
  doc: Document,
  property: unknown,
  className: string,
): HTMLElement | undefined {
  if (!isRecord(property)) return undefined;
  const name = unwrapItemMarkup(text(property.name));
  const values = Array.isArray(property.values) ? property.values : [];
  const line = el(doc, 'span', 'lc');
  if (property.displayMode === 3) {
    name.split(/(\{\d+\})/).forEach((part) => {
      const index = /^\{(\d+)\}$/.exec(part)?.[1];
      const span = index === undefined ? undefined : valueSpan(doc, values[Number(index)]);
      line.appendChild(span ?? doc.createTextNode(part));
    });
  } else {
    if (name) line.appendChild(el(doc, 'span', undefined, name));
    const spans = values.map((value) => valueSpan(doc, value)).filter((s) => s !== undefined);
    if (name && spans.length > 0) line.appendChild(doc.createTextNode(': '));
    spans.forEach((span, index) => {
      if (index > 0) line.appendChild(doc.createTextNode(', '));
      line.appendChild(span);
    });
  }
  if (!line.textContent) return undefined;
  const row = el(doc, 'div', className);
  row.appendChild(line);
  return row;
}

/** 一條詞綴：多行詞綴在同一個節點內以 `<br>` 分行（與官方相同，翻譯器以整條比對） */
function renderMod(doc: Document, modifier: string, line: string, statField?: string): HTMLElement {
  const row = el(doc, 'div', `item-mod item-mod--${modifier}`);
  const span = el(doc, 'span', statField ? 's lc' : 'lc');
  if (statField) span.setAttribute('data-field', statField);
  unwrapItemMarkup(line)
    .split('\n')
    .forEach((part, index) => {
      if (index > 0) span.appendChild(doc.createElement('br'));
      span.appendChild(statField ? el(doc, 'span', undefined, part) : doc.createTextNode(part));
    });
  row.appendChild(span);
  return row;
}

/** 已汙染、未鑑定：官方是沒有 class 的 `div > span.lc`（翻譯器以此結構比對），顏色寫在行內 */
function renderFlag(doc: Document, label: string): HTMLElement {
  const row = el(doc, 'div');
  row.style.color = 'var(--colour-corrupted)';
  row.appendChild(el(doc, 'span', 'lc', label));
  return row;
}

function separator(doc: Document): HTMLHRElement {
  return el(doc, 'hr', 'item-popup__separator');
}

function renderHeader(doc: Document, item: Json, rarity: string): HTMLElement {
  const header = el(
    doc,
    'div',
    `item-popup__header item-popup__header--item item-popup__header--${rarity}`,
  );
  const name = unwrapItemMarkup(text(item.name));
  const typeLine = unwrapItemMarkup(text(item.typeLine) || text(item.baseType));
  const lines = [name, typeLine].filter(Boolean);
  // 兩行標題（稀有、傳奇）要用官方的雙行標題背景
  if (lines.length > 1) header.classList.add('item-popup__header--double');
  for (const line of lines) {
    header.appendChild(el(doc, 'div', 'item-popup__header-line', line));
  }
  return header;
}

function renderContent(doc: Document, item: Json): HTMLElement {
  const content = el(doc, 'div', 'item-popup__content');
  const sections: HTMLElement[][] = [];

  const properties = (Array.isArray(item.properties) ? item.properties : [])
    .map((p) => renderProperty(doc, p, 'item-property item-popup__property'))
    .filter((node) => node !== undefined);
  if (properties.length) sections.push(properties);

  const meta: HTMLElement[] = [];
  if (typeof item.ilvl === 'number' && item.ilvl > 0) {
    const ilvl = renderProperty(
      doc,
      { name: 'Item Level', values: [[String(item.ilvl), 0]] },
      'item-property item-popup__property',
    );
    if (ilvl) meta.push(ilvl);
  }
  const requirements = (Array.isArray(item.requirements) ? item.requirements : [])
    .map((r) =>
      renderProperty(
        doc,
        r,
        'item-property item-popup__property item-popup__property--requirements',
      ),
    )
    .filter((node) => node !== undefined);
  meta.push(...requirements);
  if (meta.length) sections.push(meta);

  const modsBySection = new Map<string, HTMLElement[]>();
  for (const modLine of readTradeItemModLines(item)) {
    const section = MOD_SECTION_SET.has(modLine.category)
      ? modLine.category
      : MOD_SECTION_SET.has(modLine.fieldCategory)
        ? modLine.fieldCategory
        : undefined;
    if (!section) continue;
    const node = renderMod(doc, section, modLine.text, modLine.statField);
    const bucket = modsBySection.get(section);
    if (bucket) bucket.push(node);
    else modsBySection.set(section, [node]);
  }
  for (const section of MOD_SECTION_ORDER) {
    const lines = modsBySection.get(section);
    if (lines?.length) sections.push(lines);
  }

  const flags: HTMLElement[] = [];
  if (item.identified === false) flags.push(renderFlag(doc, 'Unidentified'));
  if (item.corrupted === true) flags.push(renderFlag(doc, 'Corrupted'));
  if (flags.length) sections.push(flags);

  const note = text(item.note);
  if (note) {
    const noteRow = el(doc, 'div', undefined, note);
    noteRow.style.color = 'var(--colour-currency)';
    sections.push([noteRow]);
  }

  sections.forEach((nodes, index) => {
    if (index > 0) content.appendChild(separator(doc));
    nodes.forEach((node) => content.appendChild(node));
  });
  return content;
}

/** 依物品 JSON 繪製 `.left` 圖示節點（無快照時供卡片與展開圖片框共用） */
export function renderPinnedItemIcon(
  snapshot: PinnedItemSnapshot,
  doc: Document = document,
): HTMLElement {
  const item = snapshot.item as Json;
  const left = el(doc, 'div', 'left');
  const w = typeof item.w === 'number' && item.w >= 1 && item.w <= 4 ? Math.round(item.w) : 1;
  const h = typeof item.h === 'number' && item.h >= 1 && item.h <= 6 ? Math.round(item.h) : 1;
  const container = el(doc, 'div', `newItemContainer itemPlaced iW${w} iH${h} ipW${w} ipH${h}`);
  container.style.background = 'none';
  const iconContainer = el(doc, 'div', 'iconContainer');
  const icon = el(doc, 'div', 'icon');
  // icon 網址在建立快照時已驗證為官方 CDN
  if (typeof item.icon === 'string') {
    const img = el(doc, 'img');
    img.src = item.icon;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    icon.appendChild(img);
  }
  iconContainer.appendChild(icon);
  container.appendChild(iconContainer);
  left.appendChild(container);
  return left;
}

/**
 * 以物品 JSON 自繪的釘選物品卡片（`.row` 的 `.left` 圖示與 `.middle` 物品框，不含官方按鈕）。
 * 只在沒有官方卡片快照（舊的釘選）時使用。
 */
export function renderPinnedItemCard(
  snapshot: PinnedItemSnapshot,
  doc: Document = document,
): HTMLElement {
  const item = snapshot.item as Json;
  const rarity = resolveRarityClass(item);
  const row = el(doc, 'div', 'row');
  row.appendChild(renderPinnedItemIcon(snapshot, doc));
  const middle = el(doc, 'div', 'middle');
  const popup = el(doc, 'div', `item-popup item-popup--${rarity}`);
  popup.appendChild(renderHeader(doc, item, rarity));
  popup.appendChild(renderContent(doc, item));
  middle.appendChild(popup);
  row.appendChild(middle);
  return row;
}
