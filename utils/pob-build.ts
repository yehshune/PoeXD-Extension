/**
 * Path of Building build XML 解析：只取購物清單需要的部分（角色摘要、目前裝備組的裝備、
 * 天賦樹上的珠寶、目前技能組的寶石）。
 *
 * XML 來自使用者貼上的代碼，視為不可信輸入：只讀屬性與文字、限制筆數，不執行任何內容。
 * 結構依 PoB Community（PoE 1）與 PoB PoE 2 的實際匯出檔，兩者只有根元素名稱不同
 * （`PathOfBuilding` 與 `PathOfBuilding2`），以此區分遊戲版本。
 */
import type { PoeVersion } from './trade-context';

export type PobItemRarity = 'NORMAL' | 'MAGIC' | 'RARE' | 'UNIQUE' | 'RELIC';

export interface PobBuildItem {
  /** PoB 的部位名稱（英文，例如 `Body Armour`、`Ring 1`）；天賦樹珠寶為 `Jewel` */
  slot: string;
  rarity: PobItemRarity;
  /** 稀有與傳奇是物品名稱；魔法與普通是含詞綴的完整名稱 */
  name: string;
  /** 稀有與傳奇才有；魔法與普通物品的基底要從名稱比對 */
  baseType?: string;
}

export interface PobBuildGem {
  name: string;
  level: number;
  quality: number;
  support: boolean;
}

export interface PobBuild {
  gameVersion: PoeVersion;
  className: string;
  ascendancy: string;
  level: number;
  items: PobBuildItem[];
  gems: PobBuildGem[];
}

export type PobBuildErrorCode = 'invalid-xml' | 'not-a-build';

export class PobBuildError extends Error {
  constructor(readonly code: PobBuildErrorCode) {
    super(`PoB build: ${code}`);
    this.name = 'PobBuildError';
  }
}

/** 根元素名稱決定遊戲版本：PoB Community 與 PoB PoE 2 的匯出檔不同 */
const GAME_VERSION_BY_ROOT: Readonly<Record<string, PoeVersion>> = {
  PathOfBuilding: 'poe1',
  PathOfBuilding2: 'poe2',
};
const MAX_ITEMS = 200;
const MAX_GEMS = 300;
const MAX_TEXT_LENGTH = 120;
const JEWEL_SLOT = 'Jewel';
const RARITIES: readonly PobItemRarity[] = ['NORMAL', 'MAGIC', 'RARE', 'UNIQUE', 'RELIC'];
const RARITY_LINE = /^Rarity:\s*(\w+)/i;
/** 物品名稱之後的屬性行（`Unique ID: …`、`Item Level: …`）或狀態行，不是基底名稱 */
const SPEC_LINE = /^[A-Za-z ]+:\s/;

const clip = (value: string | null | undefined): string =>
  (value ?? '').trim().slice(0, MAX_TEXT_LENGTH);

const toCount = (value: string | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const children = (parent: Element | null | undefined, tag: string): Element[] =>
  parent ? Array.from(parent.children).filter((child) => child.tagName === tag) : [];

/** 取 `activeAttr` 指定的那一組；找不到就用第一組 */
function activeChild(parent: Element | null, tag: string, activeAttr: string): Element | undefined {
  const candidates = children(parent, tag);
  const activeId = parent?.getAttribute(activeAttr);
  return candidates.find((child) => child.getAttribute('id') === activeId) ?? candidates[0];
}

/** `<Item>` 的物品文字是直屬文字節點，子元素（`<ModRange>`）不算 */
function itemTextLines(item: Element): string[] {
  return Array.from(item.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseItem(item: Element, slot: string): PobBuildItem | undefined {
  const lines = itemTextLines(item);
  const rarityIndex = lines.findIndex((line) => RARITY_LINE.test(line));
  if (rarityIndex < 0) return undefined;
  const rarity = RARITY_LINE.exec(lines[rarityIndex])?.[1].toUpperCase() as PobItemRarity;
  const name = clip(lines[rarityIndex + 1]);
  if (!RARITIES.includes(rarity) || !name) return undefined;

  const next = lines[rarityIndex + 2] ?? '';
  const hasBaseLine = (rarity === 'RARE' || rarity === 'UNIQUE' || rarity === 'RELIC') && next;
  return {
    slot,
    rarity,
    name,
    ...(hasBaseLine && !SPEC_LINE.test(next) ? { baseType: clip(next) } : {}),
  };
}

function parseItems(root: Element): PobBuildItem[] {
  const itemsElement = children(root, 'Items')[0] ?? null;
  const itemById = new Map(
    children(itemsElement, 'Item').map((item) => [item.getAttribute('id') ?? '', item] as const),
  );
  const treeSpec = activeChild(children(root, 'Tree')[0] ?? null, 'Spec', 'activeSpec');
  const placements: Array<readonly [slot: string, itemId: string]> = [
    ...children(activeChild(itemsElement, 'ItemSet', 'activeItemSet'), 'Slot').map(
      (slot) => [clip(slot.getAttribute('name')), slot.getAttribute('itemId') ?? ''] as const,
    ),
    ...children(children(treeSpec, 'Sockets')[0], 'Socket').map(
      (socket) => [JEWEL_SLOT, socket.getAttribute('itemId') ?? ''] as const,
    ),
  ];

  const items: PobBuildItem[] = [];
  for (const [slot, itemId] of placements) {
    const element = itemId && itemId !== '0' ? itemById.get(itemId) : undefined;
    const item = element && slot ? parseItem(element, slot) : undefined;
    if (item) items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function parseGems(root: Element): PobBuildGem[] {
  const skillSet = activeChild(children(root, 'Skills')[0] ?? null, 'SkillSet', 'activeSkillSet');
  const gems = new Map<string, PobBuildGem>();
  for (const skill of children(skillSet, 'Skill')) {
    if (skill.getAttribute('enabled') === 'false') continue;
    for (const gem of children(skill, 'Gem')) {
      const gemId = gem.getAttribute('gemId') ?? '';
      const name = clip(gem.getAttribute('nameSpec'));
      // 沒有 gemId 的是裝備或天賦給的技能，不是可以買的寶石
      if (!gemId || !name || gem.getAttribute('enabled') === 'false') continue;
      const entry: PobBuildGem = {
        name,
        level: toCount(gem.getAttribute('level'), 1),
        quality: toCount(gem.getAttribute('quality'), 0),
        support: /SupportGem/.test(gemId),
      };
      gems.set(`${entry.name}\u0000${entry.level}\u0000${entry.quality}`, entry);
      if (gems.size >= MAX_GEMS) return [...gems.values()];
    }
  }
  return [...gems.values()];
}

export function parsePobBuildXml(xml: string): PobBuild {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  if (!root || document.getElementsByTagName('parsererror').length > 0) {
    throw new PobBuildError('invalid-xml');
  }
  const build = Object.hasOwn(GAME_VERSION_BY_ROOT, root.tagName)
    ? children(root, 'Build')[0]
    : undefined;
  if (!build) throw new PobBuildError('not-a-build');

  return {
    gameVersion: GAME_VERSION_BY_ROOT[root.tagName],
    className: clip(build.getAttribute('className')),
    ascendancy: clip(build.getAttribute('ascendClassName')),
    level: toCount(build.getAttribute('level'), 0),
    items: parseItems(root),
    gems: parseGems(root),
  };
}
