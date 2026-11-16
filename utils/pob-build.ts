/**
 * Path of Building build XML 解析：只取購物清單需要的部分（角色摘要、每一組裝備套裝的裝備、
 * 每一份天賦樹上的珠寶、每一組技能組的寶石）。
 *
 * 一份 build 可以有多組裝備套裝、技能組與天賦樹（例如練等各階段），三者各自獨立；
 * PoB 的「配置組合（Loadout）」是以相同標題把它們對在一起，這裡沿用同樣的慣例。
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
  /** 固定詞綴（含附魔），英文、數值已依 PoB 的範圍設定算好 */
  implicitMods: string[];
  explicitMods: PobItemMod[];
}

export interface PobItemMod {
  text: string;
  /** 工藝台詞綴：可以自己做，搜尋時不當成條件 */
  crafted: boolean;
}

export interface PobBuildGem {
  name: string;
  level: number;
  quality: number;
  support: boolean;
}

interface PobSet {
  /** PoB 的 id；天賦樹沒有 id，以順序（從 1 起算）代替 */
  id: string;
  /** 使用者取的標題；沒有取名時為空字串 */
  title: string;
}

export interface PobItemSet extends PobSet {
  items: PobBuildItem[];
}

export interface PobSkillSet extends PobSet {
  gems: PobBuildGem[];
}

export interface PobTreeSpec extends PobSet {
  jewels: PobBuildItem[];
}

export interface PobBuild {
  gameVersion: PoeVersion;
  className: string;
  ascendancy: string;
  level: number;
  itemSets: PobItemSet[];
  skillSets: PobSkillSet[];
  treeSpecs: PobTreeSpec[];
  /** PoB 匯出當下選用的那一組；對不到時為第一組的 id，完全沒有時為空字串 */
  activeItemSetId: string;
  activeSkillSetId: string;
  activeTreeSpecId: string;
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
const MAX_SETS = 50;
const MAX_ITEMS_PER_SET = 200;
const MAX_GEMS_PER_SET = 300;
const MAX_TEXT_LENGTH = 120;
const MAX_MODS_PER_ITEM = 40;
const MAX_MOD_LENGTH = 240;
const IMPLICITS_LINE = /^Implicits:\s*(\d+)/;
const SELECTED_VARIANT_LINE = /^Selected Variant:\s*(\d+)/;
/** 行首的 PoB 標記，例如 `{crafted}`、`{range:0.5}`、`{variant:1,2}` */
const MOD_TAG = /^\{([^}]*)\}/;
/** PoB 以 `(10-20)` 表示可變數值，實際值由 `{range:x}` 決定 */
const VALUE_RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
/** 詞綴區之後的狀態行，不是詞綴 */
const STATUS_LINES = new Set(['Corrupted', 'Mirrored', 'Split', 'Unidentified']);
const JEWEL_SLOT = 'Jewel';
const RARITIES: readonly PobItemRarity[] = ['NORMAL', 'MAGIC', 'RARE', 'UNIQUE', 'RELIC'];
const RARITY_LINE = /^Rarity:\s*(\w+)/i;
/** 物品名稱之後的屬性行（`Unique ID: …`、`Item Level: …`），不是基底名稱 */
const SPEC_LINE = /^[A-Za-z ]+:\s/;

const clip = (value: string | null | undefined): string =>
  (value ?? '').trim().slice(0, MAX_TEXT_LENGTH);

const toCount = (value: string | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

const children = (parent: Element | null | undefined, tag: string): Element[] =>
  parent ? Array.from(parent.children).filter((child) => child.tagName === tag) : [];

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

interface ParsedModLine {
  text: string;
  crafted: boolean;
  /** 不屬於目前選用的變體（傳奇的不同版本），不列出 */
  inactiveVariant: boolean;
}

function parseModLine(raw: string, selectedVariant: string | undefined): ParsedModLine {
  let text = raw;
  let crafted = false;
  let range = 0.5;
  let inactiveVariant = false;
  for (let tag = MOD_TAG.exec(text); tag; tag = MOD_TAG.exec(text)) {
    const [name, value = ''] = tag[1].split(':');
    if (name === 'crafted') crafted = true;
    if (name === 'range' && Number.isFinite(Number(value))) range = Number(value);
    if (name === 'variant' && selectedVariant !== undefined) {
      inactiveVariant = !value.split(',').includes(selectedVariant);
    }
    text = text.slice(tag[0].length);
  }
  const resolved = text.replace(VALUE_RANGE, (_match, low: string, high: string) => {
    const value = Number(low) + (Number(high) - Number(low)) * range;
    const isInteger = Number.isInteger(Number(low)) && Number.isInteger(Number(high));
    return String(isInteger ? Math.round(value) : Math.round(value * 100) / 100);
  });
  return { text: resolved.trim().slice(0, MAX_MOD_LENGTH), crafted, inactiveVariant };
}

/** `Implicits: N` 之後的 N 行是固定詞綴，其餘到狀態行為止是一般詞綴 */
function parseMods(lines: readonly string[]): Pick<PobBuildItem, 'implicitMods' | 'explicitMods'> {
  const implicitsIndex = lines.findIndex((line) => IMPLICITS_LINE.test(line));
  if (implicitsIndex < 0) return { implicitMods: [], explicitMods: [] };
  const implicitCount = Number(IMPLICITS_LINE.exec(lines[implicitsIndex])?.[1] ?? 0);
  const selectedVariant = lines
    .slice(0, implicitsIndex)
    .map((line) => SELECTED_VARIANT_LINE.exec(line)?.[1])
    .find(Boolean);

  const implicitMods: string[] = [];
  const explicitMods: PobItemMod[] = [];
  lines.slice(implicitsIndex + 1, implicitsIndex + 1 + MAX_MODS_PER_ITEM).forEach((raw, index) => {
    if (STATUS_LINES.has(raw)) return;
    const mod = parseModLine(raw, selectedVariant);
    if (!mod.text || mod.inactiveVariant) return;
    if (index < implicitCount) implicitMods.push(mod.text);
    else explicitMods.push({ text: mod.text, crafted: mod.crafted });
  });
  return { implicitMods, explicitMods };
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
    ...parseMods(lines),
  };
}

type ItemLookup = ReadonlyMap<string, Element>;

/** 把「部位 → 物品 id」的清單換成物品；空部位（id 為 0）與找不到的物品略過 */
function resolvePlacements(
  placements: ReadonlyArray<readonly [slot: string, itemId: string]>,
  itemById: ItemLookup,
): PobBuildItem[] {
  const items: PobBuildItem[] = [];
  for (const [slot, itemId] of placements) {
    const element = itemId && itemId !== '0' ? itemById.get(itemId) : undefined;
    const item = element && slot ? parseItem(element, slot) : undefined;
    if (item) items.push(item);
    if (items.length >= MAX_ITEMS_PER_SET) break;
  }
  return items;
}

function parseItemSets(itemsElement: Element | null, itemById: ItemLookup): PobItemSet[] {
  return children(itemsElement, 'ItemSet')
    .slice(0, MAX_SETS)
    .map((set, index) => ({
      id: set.getAttribute('id') || String(index + 1),
      title: clip(set.getAttribute('title')),
      items: resolvePlacements(
        children(set, 'Slot').map(
          (slot) => [clip(slot.getAttribute('name')), slot.getAttribute('itemId') ?? ''] as const,
        ),
        itemById,
      ),
    }));
}

function parseTreeSpecs(tree: Element | null, itemById: ItemLookup): PobTreeSpec[] {
  return children(tree, 'Spec')
    .slice(0, MAX_SETS)
    .map((spec, index) => ({
      id: String(index + 1),
      title: clip(spec.getAttribute('title')),
      jewels: resolvePlacements(
        children(children(spec, 'Sockets')[0], 'Socket').map(
          (socket) => [JEWEL_SLOT, socket.getAttribute('itemId') ?? ''] as const,
        ),
        itemById,
      ),
    }));
}

function parseGems(skillSet: Element): PobBuildGem[] {
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
      if (gems.size >= MAX_GEMS_PER_SET) return [...gems.values()];
    }
  }
  return [...gems.values()];
}

function parseSkillSets(skills: Element | null): PobSkillSet[] {
  return children(skills, 'SkillSet')
    .slice(0, MAX_SETS)
    .map((set, index) => ({
      id: set.getAttribute('id') || String(index + 1),
      title: clip(set.getAttribute('title')),
      gems: parseGems(set),
    }));
}

/** 匯出當下選用的那一組；屬性對不到任何一組時退回第一組 */
function resolveActiveId(sets: readonly PobSet[], activeId: string | null | undefined): string {
  return (sets.find((set) => set.id === activeId) ?? sets[0])?.id ?? '';
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

  const itemsElement = children(root, 'Items')[0] ?? null;
  const skillsElement = children(root, 'Skills')[0] ?? null;
  const treeElement = children(root, 'Tree')[0] ?? null;
  const itemById: ItemLookup = new Map(
    children(itemsElement, 'Item').map((item) => [item.getAttribute('id') ?? '', item] as const),
  );
  const itemSets = parseItemSets(itemsElement, itemById);
  const skillSets = parseSkillSets(skillsElement);
  const treeSpecs = parseTreeSpecs(treeElement, itemById);

  return {
    gameVersion: GAME_VERSION_BY_ROOT[root.tagName],
    className: clip(build.getAttribute('className')),
    ascendancy: clip(build.getAttribute('ascendClassName')),
    level: toCount(build.getAttribute('level'), 0),
    itemSets,
    skillSets,
    treeSpecs,
    activeItemSetId: resolveActiveId(itemSets, itemsElement?.getAttribute('activeItemSet')),
    activeSkillSetId: resolveActiveId(skillSets, skillsElement?.getAttribute('activeSkillSet')),
    activeTreeSpecId: resolveActiveId(treeSpecs, treeElement?.getAttribute('activeSpec')),
  };
}
