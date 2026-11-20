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

/** PoE 2 的 `[標籤|顯示文字]` 或 `[標籤]` 標記只顯示文字 */
const unwrapMarkup = (value: string): string => value.replace(/\[(?:[^\]|]*\|)?([^\]]*)\]/g, '$1');

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

const MOD_SECTIONS: readonly (readonly [key: string, modifier: string])[] = [
  ['enchantMods', 'enchant'],
  ['implicitMods', 'implicit'],
  ['fracturedMods', 'fractured'],
  ['explicitMods', 'explicit'],
  ['craftedMods', 'crafted'],
  ['desecratedMods', 'desecrated'],
  ['runeMods', 'rune'],
];

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
  const span = el(doc, 'span', undefined, unwrapMarkup(value[0]));
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
  const name = unwrapMarkup(text(property.name));
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

/** 官方詞綴代碼，例如 `stat.explicit.stat_3261801346`；格式不符的一律不寫進屬性 */
const STAT_FIELD_PATTERN = /^stat\.[a-z_]+\.[A-Za-z0-9_|.+-]{1,120}$/;

/** 詞綴所屬的 `extended.hashes` 分類（`explicitMods` → `explicit`） */
function readHashList(item: Json, modifier: string): unknown[] {
  const hashes = isRecord(item.extended) ? item.extended.hashes : undefined;
  const list = isRecord(hashes) ? hashes[modifier] : undefined;
  return Array.isArray(list) ? list : [];
}

/** 詞綴的官方代碼：物件詞綴帶 `hash`；字串詞綴依序對應 `extended.hashes` */
function resolveStatField(entry: unknown, hashEntry: unknown): string | undefined {
  const raw = isRecord(entry)
    ? text(entry.hash)
    : Array.isArray(hashEntry) && typeof hashEntry[0] === 'string'
      ? `stat.${hashEntry[0]}`
      : '';
  return STAT_FIELD_PATTERN.test(raw) ? raw : undefined;
}

/** 一條詞綴：多行詞綴在同一個節點內以 `<br>` 分行（與官方相同，翻譯器以整條比對） */
function renderMod(doc: Document, modifier: string, line: string, statField?: string): HTMLElement {
  const row = el(doc, 'div', `item-mod item-mod--${modifier}`);
  const span = el(doc, 'span', statField ? 's lc' : 'lc');
  if (statField) span.setAttribute('data-field', statField);
  unwrapMarkup(line)
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
  const name = unwrapMarkup(text(item.name));
  const typeLine = unwrapMarkup(text(item.typeLine) || text(item.baseType));
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

  for (const [key, modifier] of MOD_SECTIONS) {
    // 官方詞綴可能是字串，或是 `{ description, hash, mods }` 物件
    const hashList = readHashList(item, modifier);
    const lines = (Array.isArray(item[key]) ? item[key] : []).flatMap((entry, index) => {
      const line = isRecord(entry) ? text(entry.description) : text(entry);
      return line ? [renderMod(doc, modifier, line, resolveStatField(entry, hashList[index]))] : [];
    });
    if (lines.length) sections.push(lines);
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
