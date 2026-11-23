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
  /** 固定詞綴（含附魔），英文、數值已依 PoB 的範圍設定算好；附魔在 PoB 標為 crafted */
  implicitMods: PobItemMod[];
  explicitMods: PobItemMod[];
  /** 最大的連結插槽數（PoE 1 的 `Sockets:` 行）；沒有插槽時省略 */
  maxLinks?: number;
  /** PoB 的插槽文字，例如 `R-R-G B`（大寫、單一空白）；沒有插槽時省略 */
  sockets?: string;
  /** PoE 2 插在插槽裡的符文、靈魂核心等（`Rune:` 行，依插槽順序）；沒有時省略 */
  socketed?: string[];
  /** 已汙染（含二次汙染） */
  corrupted?: true;
  /** 穢生傳奇（名稱前綴 `Foulborn`） */
  foulborn?: true;
  /** 基底帶有的防禦類型（依 PoB 的 `…BasePercentile` 行）；沒有防禦時省略 */
  baseDefences?: PobDefence[];
  /** PoB 算好的防禦數值（含品質與詞綴）；沒有防禦時省略 */
  defenceValues?: Partial<Record<PobDefence, number>>;
}

/** 護甲、閃避、能量護盾、結界 */
export type PobDefence = 'ar' | 'ev' | 'es' | 'ward';

export interface PobItemMod {
  text: string;
  /** PoB 的 `{crafted}` 標記：一般詞綴是工藝台詞綴（可以自己做），固定詞綴是附魔 */
  crafted: boolean;
  /** Searing Exarch／Eater of Worlds 的固定詞綴（很難剛好對到，搜尋時預設不帶入） */
  eldritch?: true;
}

export interface PobBuildGem {
  name: string;
  level: number;
  quality: number;
  support: boolean;
  /** 插在哪個部位（PoB 的部位名稱）；沒有指定部位時為空字串 */
  slot: string;
  /** 所屬連線的名稱：PoB 的技能標籤，沒有時為該連線第一顆主動寶石 */
  skill: string;
  /** PoE 2 技能寶石：連結的輔助寶石數（需要的插槽數，可為 0）；PoE 1 與輔助寶石省略 */
  sockets?: number;
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
/** `Sockets: R-R-G B`：`-` 是連結，空白分開不同組 */
const SOCKETS_LINE = /^Sockets:\s*([A-Za-z\- ]+)$/;
/** 主變體與替代變體（看守之眼一顆有三條光環詞綴，各是一個變體）；PoB 最多到 Alt Variant Five */
const SELECTED_VARIANT_LINE =
  /^Selected (?:Alt Variant(?: Two| Three| Four| Five)?|Variant):\s*(\d+)/;
/** 傳奇資料庫的物品會列出所有變體詞綴（看守之眼上百行），篩選前最多讀這麼多行 */
const MAX_SCANNED_MOD_LINES = 1000;
/** 行首的 PoB 標記，例如 `{crafted}`、`{range:0.5}`、`{variant:1,2}` */
const MOD_TAG = /^\{([^}]*)\}/;
/** PoB 以 `(10-20)` 表示可變數值，實際值由 `{range:x}` 決定 */
const VALUE_RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
/** 詞綴區之後的狀態行，不是詞綴 */
const STATUS_LINES = new Set([
  'Corrupted',
  'Twice Corrupted',
  'Mirrored',
  'Split',
  'Unidentified',
  'Fractured Item',
  'Synthesised Item',
  // 勢力行通常寫在 Implicits 之前；手動編輯過的物品可能出現在詞綴區
  'Shaper Item',
  'Elder Item',
  'Crusader Item',
  'Redeemer Item',
  'Hunter Item',
  'Warlord Item',
  'Searing Exarch Item',
  'Eater of Worlds Item',
]);
const JEWEL_SLOT = 'Jewel';
const CORRUPTED_LINES = new Set(['Corrupted', 'Twice Corrupted']);
const FOULBORN_NAME = /^Foulborn\s+/;
/** PoE 2 插槽內容物：`Rune: Thrud's Might`（靈魂核心、護符偶像也用同一個欄位） */
const RUNE_LINE = /^Rune:\s*(.+)$/;
const MAX_SOCKETED = 6;
/**
 * 身外 Wickerman（3.30）的臟器。新版 PoB 放在 `Wickerman Head` 等四個部位，跟一般裝備一樣；
 * 還沒有這些部位的 PoB（例如從角色匯入的 build）把四件臟器的詞綴合併寫成標題為 `Viscera`
 * 的自訂詞綴區塊，這時拿不到各件的名稱，只能合成一個代表全部臟器的項目。
 */
export const VISCERA_BUNDLE_SLOT = 'Wickerman';
export const VISCERA_BUNDLE_NAME = 'Viscera';
const WICKERMAN_SLOT = /^Wickerman\b/;
const VISCERA_BLOCK_TITLE = /^viscera$/i;
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
  /** PoB 的 `{exarch}`／`{eater}` 標記 */
  eldritch: boolean;
  /** 不屬於目前選用的變體（傳奇的不同版本），不列出 */
  inactiveVariant: boolean;
}

function parseModLine(
  raw: string,
  selectedVariants: ReadonlySet<string> | undefined,
): ParsedModLine {
  let text = raw;
  let crafted = false;
  let eldritch = false;
  let range = 0.5;
  let inactiveVariant = false;
  for (let tag = MOD_TAG.exec(text); tag; tag = MOD_TAG.exec(text)) {
    const [name, value = ''] = tag[1].split(':');
    if (name === 'crafted') crafted = true;
    if (name === 'exarch' || name === 'eater') eldritch = true;
    if (name === 'range' && Number.isFinite(Number(value))) range = Number(value);
    if (name === 'variant' && selectedVariants !== undefined) {
      inactiveVariant = !value.split(',').some((variant) => selectedVariants.has(variant));
    }
    text = text.slice(tag[0].length);
  }
  const resolved = text.replace(VALUE_RANGE, (_match, low: string, high: string) => {
    const value = Number(low) + (Number(high) - Number(low)) * range;
    const isInteger = Number.isInteger(Number(low)) && Number.isInteger(Number(high));
    return String(isInteger ? Math.round(value) : Math.round(value * 100) / 100);
  });
  return { text: resolved.trim().slice(0, MAX_MOD_LENGTH), crafted, eldritch, inactiveVariant };
}

const ELDRITCH_ITEM_LINE = /^(?:Searing Exarch|Eater of Worlds) Item$/;

/** `Implicits: N` 之後的 N 行是固定詞綴，其餘到狀態行為止是一般詞綴 */
function parseMods(lines: readonly string[]): Pick<PobBuildItem, 'implicitMods' | 'explicitMods'> {
  const implicitsIndex = lines.findIndex((line) => IMPLICITS_LINE.test(line));
  if (implicitsIndex < 0) return { implicitMods: [], explicitMods: [] };
  const implicitCount = Number(IMPLICITS_LINE.exec(lines[implicitsIndex])?.[1] ?? 0);
  const variants = lines
    .slice(0, implicitsIndex)
    .flatMap((line) => SELECTED_VARIANT_LINE.exec(line)?.[1] ?? []);
  const selectedVariants = variants.length ? new Set(variants) : undefined;
  // 舊版匯出沒有 {exarch}／{eater} 標記，只在屬性區寫「Searing Exarch Item」：此時非附魔的固定詞綴都是
  const eldritchItem = lines.slice(0, implicitsIndex).some((line) => ELDRITCH_ITEM_LINE.test(line));

  const implicitMods: PobItemMod[] = [];
  const explicitMods: PobItemMod[] = [];
  // 先篩掉沒選用的變體再限制行數：選到的變體詞綴可能排在上百行之後
  lines
    .slice(implicitsIndex + 1, implicitsIndex + 1 + MAX_SCANNED_MOD_LINES)
    .forEach((raw, index) => {
      if (STATUS_LINES.has(raw)) return;
      if (implicitMods.length + explicitMods.length >= MAX_MODS_PER_ITEM) return;
      const mod = parseModLine(raw, selectedVariants);
      if (!mod.text || mod.inactiveVariant) return;
      const entry = { text: mod.text, crafted: mod.crafted };
      if (index >= implicitCount) {
        explicitMods.push(entry);
        return;
      }
      const eldritch = mod.eldritch || (eldritchItem && !mod.crafted);
      implicitMods.push(eldritch ? { ...entry, eldritch: true } : entry);
    });
  return { implicitMods, explicitMods };
}

/** 物品屬性區的 `Sockets:` 行，整理成大寫、單一空白 */
function parseSockets(lines: readonly string[]): string | undefined {
  const sockets = lines.map((line) => SOCKETS_LINE.exec(line)?.[1]).find(Boolean);
  const normalized = sockets?.trim().toUpperCase().replace(/\s+/g, ' ');
  return normalized ? normalized : undefined;
}

/** 插槽文字算出最大連結數 */
function parseMaxLinks(sockets: string | undefined): number | undefined {
  if (!sockets) return undefined;
  const largest = Math.max(
    ...sockets
      .trim()
      .split(/\s+/)
      .map((group) => group.split('-').filter(Boolean).length),
  );
  return largest > 0 ? largest : undefined;
}

const DEFENCE_LINES: readonly { defence: PobDefence; percentile: RegExp; value: RegExp }[] = [
  { defence: 'ar', percentile: /^ArmourBasePercentile:/, value: /^Armour:\s*(\d+)/ },
  { defence: 'ev', percentile: /^EvasionBasePercentile:/, value: /^Evasion(?: Rating)?:\s*(\d+)/ },
  {
    defence: 'es',
    percentile: /^EnergyShieldBasePercentile:/,
    value: /^Energy Shield:\s*(\d+)/,
  },
  { defence: 'ward', percentile: /^WardBasePercentile:/, value: /^Ward:\s*(\d+)/ },
];

/**
 * 基底防禦類型：PoB 只替基底有的防禦寫 `…BasePercentile` 行（詞綴加上的防禦不會有），
 * 舊版匯出沒有這些行時退回防禦數值行
 */
function parseBaseDefences(lines: readonly string[]): PobDefence[] | undefined {
  const byPercentile = DEFENCE_LINES.filter(({ percentile }) =>
    lines.some((line) => percentile.test(line)),
  );
  const found = byPercentile.length
    ? byPercentile
    : DEFENCE_LINES.filter(({ value }) =>
        lines.some((line) => Number(value.exec(line)?.[1] ?? 0) > 0),
      );
  return found.length ? found.map(({ defence }) => defence) : undefined;
}

/** 物品屬性區的防禦數值行（`Armour: 553`）；沒有任何防禦時為 undefined */
function parseDefenceValues(
  lines: readonly string[],
): Partial<Record<PobDefence, number>> | undefined {
  const entries = DEFENCE_LINES.flatMap(({ defence, value }) => {
    const amount = lines.map((line) => Number(value.exec(line)?.[1] ?? 0)).find((n) => n > 0);
    return amount ? [[defence, amount] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
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
  const implicitsIndex = lines.findIndex((line) => IMPLICITS_LINE.test(line));
  const properties = lines.slice(0, implicitsIndex < 0 ? undefined : implicitsIndex);
  const sockets = parseSockets(properties);
  const maxLinks = parseMaxLinks(sockets);
  const baseDefences = parseBaseDefences(properties);
  const defenceValues = parseDefenceValues(properties);
  const socketed = properties
    .flatMap((line) => clip(RUNE_LINE.exec(line)?.[1]) || [])
    .slice(0, MAX_SOCKETED);
  const corrupted = lines.some((line) => CORRUPTED_LINES.has(line));
  const foulborn = (rarity === 'UNIQUE' || rarity === 'RELIC') && FOULBORN_NAME.test(name);
  return {
    slot,
    rarity,
    name,
    ...(hasBaseLine && !SPEC_LINE.test(next) ? { baseType: clip(next) } : {}),
    ...parseMods(lines),
    ...(maxLinks !== undefined ? { maxLinks } : {}),
    ...(sockets ? { sockets } : {}),
    ...(baseDefences ? { baseDefences } : {}),
    ...(defenceValues ? { defenceValues } : {}),
    ...(socketed.length > 0 ? { socketed } : {}),
    ...(corrupted ? { corrupted: true as const } : {}),
    ...(foulborn ? { foulborn: true as const } : {}),
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

/** 匯出當下選用的配置組合裡、標題為 `Viscera` 的自訂詞綴區塊；沒有或已停用時回傳 undefined */
function parseVisceraBundle(config: Element | null): PobBuildItem | undefined {
  const sets = children(config, 'ConfigSet');
  const activeId = config?.getAttribute('activeConfigSet');
  const active = sets.find((set) => set.getAttribute('id') === activeId) ?? sets[0] ?? config;
  const block = children(active, 'CustomModifierBlock').find(
    (element) =>
      VISCERA_BLOCK_TITLE.test(clip(element.getAttribute('title'))) &&
      element.getAttribute('enabled') !== 'false',
  );
  if (!block) return undefined;
  const implicitMods = itemTextLines(block)
    .slice(0, MAX_MODS_PER_ITEM)
    .map((raw) => parseModLine(raw, undefined).text)
    .filter(Boolean)
    .map((text) => ({ text, crafted: false }));
  if (implicitMods.length === 0) return undefined;
  return {
    slot: VISCERA_BUNDLE_SLOT,
    rarity: 'NORMAL',
    name: VISCERA_BUNDLE_NAME,
    implicitMods,
    explicitMods: [],
  };
}

/** 套裝裡沒有放在 Wickerman 部位的臟器時，補上從自訂詞綴合成的臟器項目 */
function withVisceraBundle(sets: PobItemSet[], bundle: PobBuildItem | undefined): PobItemSet[] {
  if (!bundle) return sets;
  return sets.map((set) =>
    set.items.some((item) => WICKERMAN_SLOT.test(item.slot))
      ? set
      : { ...set, items: [...set.items, bundle] },
  );
}

/** PoE 2 武器給的預設技能（`SkillGemPlayerDefault…`）與昇華技能（`SkillGemAscendancy…`） */
const NOT_AN_ITEM_GEM = /\/SkillGem(?:PlayerDefault|Ascendancy)/;

/** 連線裡第一顆主動技能的名稱（含武器預設技能這類不列入清單的技能） */
function activeSkillName(skill: Element): string {
  const active = children(skill, 'Gem').find((gem) => {
    const gemId = gem.getAttribute('gemId') ?? '';
    return /\/SkillGem/.test(gemId) && !/Ascendancy/.test(gemId);
  });
  return clip(active?.getAttribute('nameSpec'));
}

/**
 * 每一顆啟用的寶石都列出（不同連結各用一顆相同的寶石時要買兩顆），由購物清單合併計數。
 * 插在裝備上的寶石即使在 PoB 停用（例如手動施放、不想算進 DPS）也實際佔著插槽，一樣列出
 */
function parseGems(skillSet: Element, version: PoeVersion): PobBuildGem[] {
  const gems: PobBuildGem[] = [];
  for (const skill of children(skillSet, 'Skill')) {
    const slot = clip(skill.getAttribute('slot'));
    if (!slot && skill.getAttribute('enabled') === 'false') continue;
    const linked = children(skill, 'Gem').flatMap((gem) => {
      const gemId = gem.getAttribute('gemId') ?? '';
      const name = clip(gem.getAttribute('nameSpec'));
      // 沒有 gemId 的是裝備或天賦給的技能；PoE 2 的武器預設技能、昇華技能也有 gemId，但不是道具
      if (
        !gemId ||
        NOT_AN_ITEM_GEM.test(gemId) ||
        !name ||
        (!slot && gem.getAttribute('enabled') === 'false')
      )
        return [];
      return [
        {
          name,
          level: toCount(gem.getAttribute('level'), 1),
          quality: toCount(gem.getAttribute('quality'), 0),
          support: /SupportGem/.test(gemId),
        },
      ];
    });
    // 主動技能是武器預設技能（不列入）時，連線仍以它命名，不改用輔助寶石的名字
    const skillName =
      clip(skill.getAttribute('label')) ||
      activeSkillName(skill) ||
      (linked.find((gem) => !gem.support) ?? linked[0])?.name ||
      '';
    // PoE 2 的輔助寶石插在技能寶石上：連了幾顆，技能寶石就至少要有幾個插槽
    const supportCount = linked.filter((gem) => gem.support).length;
    const sockets = version === 'poe2' ? { sockets: supportCount } : {};
    for (const gem of linked) {
      gems.push({ ...gem, ...(gem.support ? {} : sockets), slot, skill: skillName });
      if (gems.length >= MAX_GEMS_PER_SET) return gems;
    }
  }
  return gems;
}

function parseSkillSets(skills: Element | null, version: PoeVersion): PobSkillSet[] {
  return children(skills, 'SkillSet')
    .slice(0, MAX_SETS)
    .map((set, index) => ({
      id: set.getAttribute('id') || String(index + 1),
      title: clip(set.getAttribute('title')),
      gems: parseGems(set, version),
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
  const itemSets = withVisceraBundle(
    parseItemSets(itemsElement, itemById),
    parseVisceraBundle(children(root, 'Config')[0] ?? null),
  );
  const skillSets = parseSkillSets(skillsElement, GAME_VERSION_BY_ROOT[root.tagName]);
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
