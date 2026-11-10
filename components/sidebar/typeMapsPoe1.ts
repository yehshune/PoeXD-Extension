import type { SupportedUiLocale } from '@/utils/preferences-contract';
import { createActiveUiLocaleProxy } from '@/utils/i18n';
import type { CategoryGroup, TypeInfo, TypeRowConfig } from './typeMaps';

/**
 * PoE 1 物品類別定義。
 *
 * - 類別鍵與 poexd-data 的 PoE 1 gear-type 鍵一一對應。
 * - 名稱以三地區官方市集分類用語為準（國際服、台服、國服）。
 * - 魔符（保護）防具是獨立基底，不屬於頭部／手套／鞋子大類，因此獨立成類別。
 */

type Localized = Readonly<Record<SupportedUiLocale, string>>;

const L = (zhTW: string, zhCN: string, en: string): Localized => ({
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  en,
});

// === 防具（依屬性細分） ===

const ARMOUR_SLOTS = [
  { main: 'body-armour', prefix: 'body_armours', name: L('胸甲', '胸甲', 'Body Armour') },
  { main: 'helmet', prefix: 'helmets', name: L('頭盔', '头盔', 'Helmet') },
  { main: 'gloves', prefix: 'gloves', name: L('手套', '手套', 'Gloves') },
  { main: 'boots', prefix: 'boots', name: L('鞋子', '鞋子', 'Boots') },
  { main: 'shield', prefix: 'shields', name: L('盾牌', '盾牌', 'Shield') },
] as const;

const ARMOUR_CAT: Readonly<Record<string, string[]>> = {
  'body-armour': ['胸甲', 'Body Armour'],
  helmet: ['頭部', '头盔', 'Helmet'],
  gloves: ['手套', 'Gloves'],
  boots: ['鞋子', '靴子', 'Boots'],
  shield: ['盾', '盾牌', 'Shield'],
};

const ATTRIBUTES = [
  {
    suffix: 'str',
    sub: ['力量', 'Strength'],
    name: L('力量', '力量', 'STR'),
    short: L('力', '力', 'STR'),
  },
  {
    suffix: 'dex',
    sub: ['敏捷', 'Dexterity'],
    name: L('敏捷', '敏捷', 'DEX'),
    short: L('敏', '敏', 'DEX'),
  },
  {
    suffix: 'int',
    sub: ['智慧', 'Intelligence'],
    name: L('智慧', '智慧', 'INT'),
    short: L('智', '智', 'INT'),
  },
  {
    suffix: 'str_dex',
    sub: ['力量／敏捷', 'Str/Dex'],
    name: L('力敏', '力敏', 'STR/DEX'),
    short: L('力敏', '力敏', 'S/D'),
  },
  {
    suffix: 'str_int',
    sub: ['力量／智慧', 'Str/Int'],
    name: L('力智', '力智', 'STR/INT'),
    short: L('力智', '力智', 'S/I'),
  },
  {
    suffix: 'dex_int',
    sub: ['敏捷／智慧', 'Dex/Int'],
    name: L('敏智', '敏智', 'DEX/INT'),
    short: L('敏智', '敏智', 'D/I'),
  },
] as const;

/** 魔符基底只有頭部、手套、鞋子三種 */
const WARD_ARMOUR = [
  { key: 'helmets_ward', slot: 'helmet', name: L('保護頭盔', '结界头盔', 'Ward Helmet') },
  { key: 'gloves_ward', slot: 'gloves', name: L('保護手套', '结界手套', 'Ward Gloves') },
  { key: 'boots_ward', slot: 'boots', name: L('保護鞋子', '结界鞋子', 'Ward Boots') },
] as const;

const SHIELD_SHORT = L('盾', '盾', 'Shield');

function armourSubName(
  slotPrefix: string,
  attrName: string,
  slotName: string,
  locale: SupportedUiLocale,
) {
  if (slotPrefix === 'shields' && locale !== 'en') return `${attrName}${SHIELD_SHORT[locale]}`;
  return locale === 'en' ? `${attrName} ${slotName}` : `${attrName}${slotName}`;
}

// === 其他類別：鍵 → 解析標籤（cat/sub）與三語名稱 ===

interface CategoryDef {
  readonly info: TypeInfo;
  readonly name: Localized;
}

const D = (cat: string[], name: Localized, sub?: string[]): CategoryDef => ({
  info: sub ? { cat, sub } : { cat },
  name,
});

const WEAPON_DEFS: Readonly<Record<string, CategoryDef>> = {
  claw: D(['爪', 'Claw'], L('爪', '爪', 'Claw')),
  dagger: D(['匕首', 'Dagger'], L('匕首', '匕首', 'Dagger')),
  'rune-dagger': D(
    ['符紋匕首', '符文匕首', 'Rune Dagger'],
    L('符紋匕首', '符文匕首', 'Rune Dagger'),
  ),
  wand: D(['法杖', 'Wand'], L('法杖', '法杖', 'Wand')),
  wands_minion: D(['法杖', 'Wand'], L('召喚法杖', '召唤法杖', 'Minion Wand'), [
    '召喚',
    '召唤',
    'Minion',
  ]),
  'one-hand-sword': D(
    ['單手劍', '单手剑', 'One-Handed Sword'],
    L('單手劍', '单手剑', 'One-Handed Sword'),
  ),
  'thrusting-one-hand-sword': D(
    ['細劍', '细剑', 'Thrusting One-Handed Sword'],
    L('細劍', '细剑', 'Thrusting One-Handed Sword'),
  ),
  'two-hand-sword': D(
    ['雙手劍', '双手剑', 'Two-Handed Sword'],
    L('雙手劍', '双手剑', 'Two-Handed Sword'),
  ),
  'one-hand-axe': D(
    ['單手斧', '单手斧', 'One-Handed Axe'],
    L('單手斧', '单手斧', 'One-Handed Axe'),
  ),
  'two-hand-axe': D(
    ['雙手斧', '双手斧', 'Two-Handed Axe'],
    L('雙手斧', '双手斧', 'Two-Handed Axe'),
  ),
  'one-hand-mace': D(
    ['單手錘', '单手锤', 'One-Handed Mace'],
    L('單手錘', '单手锤', 'One-Handed Mace'),
  ),
  'two-hand-mace': D(
    ['雙手錘', '双手锤', 'Two-Handed Mace'],
    L('雙手錘', '双手锤', 'Two-Handed Mace'),
  ),
  sceptre: D(['權杖', '短杖', 'Sceptre'], L('權杖', '短杖', 'Sceptre')),
  bow: D(['弓', 'Bow'], L('弓', '弓', 'Bow')),
  staff: D(['長杖', '长杖', 'Staff'], L('長杖', '长杖', 'Staff')),
  warstaff: D(['征戰長杖', '战争长杖', 'Warstaff'], L('征戰長杖', '战争长杖', 'Warstaff')),
  'fishing-rod': D(['釣竿', '魚竿', '鱼竿', 'Fishing Rod'], L('釣竿', '鱼竿', 'Fishing Rod')),
};

const ACCESSORY_DEFS: Readonly<Record<string, CategoryDef>> = {
  amulet: D(['項鍊', '项链', '護身符', '护身符', 'Amulet'], L('項鍊', '项链', 'Amulet')),
  ring: D(['戒指', 'Ring'], L('戒指', '戒指', 'Ring')),
  rings_minion: D(['戒指', 'Ring'], L('召喚戒指', '召唤戒指', 'Minion Ring'), [
    '召喚',
    '召唤',
    'Minion',
  ]),
  unset_ring: D(['戒指', 'Ring'], L('潛能之戒', '潜能之戒', 'Unset Ring'), [
    '潛能',
    '潜能',
    'Unset',
  ]),
  belt: D(['腰帶', '腰带', 'Belt'], L('腰帶', '腰带', 'Belt')),
  quiver: D(['箭袋', 'Quiver'], L('箭袋', '箭袋', 'Quiver')),
};

const JEWEL_CAT = ['珠寶', '珠宝', 'Jewel'];
const CLUSTER_CAT = ['星團珠寶', '星团珠宝', 'Cluster Jewel'];
const ABYSS_CAT = ['深淵珠寶', '深渊珠宝', 'Abyss Jewel'];

const JEWEL_DEFS: Readonly<Record<string, CategoryDef>> = {
  jewel: D(JEWEL_CAT, L('珠寶', '珠宝', 'Jewel')),
  crimson_jewel: D(JEWEL_CAT, L('赤紅珠寶', '赤红珠宝', 'Crimson Jewel'), [
    '赤紅珠寶',
    '赤红珠宝',
    'Crimson Jewel',
  ]),
  viridian_jewel: D(JEWEL_CAT, L('翠綠珠寶', '翠绿珠宝', 'Viridian Jewel'), [
    '翠綠珠寶',
    '翠绿珠宝',
    'Viridian Jewel',
  ]),
  cobalt_jewel: D(JEWEL_CAT, L('鈷藍珠寶', '钴蓝珠宝', 'Cobalt Jewel'), [
    '鈷藍珠寶',
    '钴蓝珠宝',
    'Cobalt Jewel',
  ]),
  prismatic_jewel: D(JEWEL_CAT, L('三相珠寶', '三相珠宝', 'Prismatic Jewel'), [
    '三相珠寶',
    '三相珠宝',
    'Prismatic Jewel',
  ]),
  cluster_jewel: D(CLUSTER_CAT, L('星團珠寶', '星团珠宝', 'Cluster Jewel')),
  large_cluster_jewel: D(CLUSTER_CAT, L('巨型星團珠寶', '大型星团珠宝', 'Large Cluster Jewel'), [
    '巨型星團珠寶',
    '大型星团珠宝',
    'Large Cluster Jewel',
  ]),
  medium_cluster_jewel: D(CLUSTER_CAT, L('中型星團珠寶', '中型星团珠宝', 'Medium Cluster Jewel'), [
    '中型星團珠寶',
    '中型星团珠宝',
    'Medium Cluster Jewel',
  ]),
  small_cluster_jewel: D(CLUSTER_CAT, L('小型星團珠寶', '小型星团珠宝', 'Small Cluster Jewel'), [
    '小型星團珠寶',
    '小型星团珠宝',
    'Small Cluster Jewel',
  ]),
  abyss_jewel: D(ABYSS_CAT, L('深淵珠寶', '深渊珠宝', 'Abyss Jewel')),
  murderous_eye_jewel: D(ABYSS_CAT, L('殺戮之眼珠寶', '凶残之凝珠宝', 'Murderous Eye Jewel'), [
    '殺戮之眼珠寶',
    '凶残之凝珠宝',
    'Murderous Eye Jewel',
  ]),
  searching_eye_jewel: D(ABYSS_CAT, L('勘查之眼珠寶', '锐利之凝珠宝', 'Searching Eye Jewel'), [
    '勘查之眼珠寶',
    '锐利之凝珠宝',
    'Searching Eye Jewel',
  ]),
  hypnotic_eye_jewel: D(ABYSS_CAT, L('催眠之眼珠寶', '安睡之凝珠宝', 'Hypnotic Eye Jewel'), [
    '催眠之眼珠寶',
    '安睡之凝珠宝',
    'Hypnotic Eye Jewel',
  ]),
  ghastly_eye_jewel: D(ABYSS_CAT, L('極懼之眼珠寶', '苍白之凝珠宝', 'Ghastly Eye Jewel'), [
    '極懼之眼珠寶',
    '苍白之凝珠宝',
    'Ghastly Eye Jewel',
  ]),
};

const FLASK_DEFS: Readonly<Record<string, CategoryDef>> = {
  flask: D(['藥劑', '药剂', 'Flask'], L('藥劑', '药剂', 'Flask')),
  'life-flask': D(['生命藥劑', '生命药剂', 'Life Flask'], L('生命藥劑', '生命药剂', 'Life Flask')),
  'mana-flask': D(['魔力藥劑', '魔力药剂', 'Mana Flask'], L('魔力藥劑', '魔力药剂', 'Mana Flask')),
  'hybrid-flask': D(
    ['複合藥劑', '复合药剂', 'Hybrid Flask'],
    L('複合藥劑', '复合药剂', 'Hybrid Flask'),
  ),
  'utility-flask': D(
    ['功能藥劑', '功能药剂', 'Utility Flask'],
    L('功能藥劑', '功能药剂', 'Utility Flask'),
  ),
  'iron-flask': D(['鋼鐵藥劑', '坚铁药剂', 'Iron Flask'], L('鋼鐵藥劑', '坚铁药剂', 'Iron Flask')),
  tincture: D(['萃取物', '酊剂', 'Tincture'], L('萃取物', '酊剂', 'Tincture')),
};

const HEIST_CAT = ['劫盜裝備', '赏金猎人装备', 'Heist Equipment'];

const ENDGAME_DEFS: Readonly<Record<string, CategoryDef>> = {
  map: D(['地圖', '異界地圖', '地图', 'Map'], L('地圖', '地图', 'Map')),
  relic: D(
    ['聖域聖物', '聖物', '禁域遗物', 'Sanctum Relic', 'Relic'],
    L('聖域聖物', '禁域遗物', 'Sanctum Relic'),
  ),
  contract: D(
    [
      '劫盜契約書',
      '契約書',
      '劫盜藍圖',
      '赏金契约',
      '赏金蓝图',
      'Heist Contract',
      'Heist Blueprint',
    ],
    L('劫盜契約書', '赏金契约', 'Heist Contract'),
  ),
  heist_equipment: D(HEIST_CAT, L('劫盜裝備', '赏金物品', 'Heist Equipment')),
  heist_gear: D(HEIST_CAT, L('劫盜武器', '赏金猎人装备', 'Heist Gear'), ['武器', '装备', 'Gear']),
  heist_tool: D(HEIST_CAT, L('劫盜工具', '赏金猎人工具', 'Heist Tool'), ['工具', 'Tool']),
  heist_cloak: D(HEIST_CAT, L('劫盜披風', '赏金猎人披风', 'Heist Cloak'), [
    '披風',
    '披风',
    'Cloak',
  ]),
  heist_brooch: D(HEIST_CAT, L('劫盜胸針', '赏金猎人胸针', 'Heist Brooch'), [
    '胸針',
    '胸针',
    'Brooch',
  ]),
  trinket: D(['飾品', '饰品', 'Trinket'], L('飾品', '饰品', 'Trinket')),
};

const SIMPLE_DEFS: Readonly<Record<string, CategoryDef>> = {
  ...WEAPON_DEFS,
  ...ACCESSORY_DEFS,
  ...JEWEL_DEFS,
  ...FLASK_DEFS,
  ...ENDGAME_DEFS,
};

// === 組裝 typeMap 與名稱表 ===

function buildArmourDefs(): Record<string, CategoryDef> {
  const defs: Record<string, CategoryDef> = {};
  for (const slot of ARMOUR_SLOTS) {
    const cat = ARMOUR_CAT[slot.main];
    defs[slot.main] = { info: { cat }, name: slot.name };
    for (const attr of ATTRIBUTES) {
      const name = {
        'zh-TW': armourSubName(slot.prefix, attr.name['zh-TW'], slot.name['zh-TW'], 'zh-TW'),
        'zh-CN': armourSubName(slot.prefix, attr.name['zh-CN'], slot.name['zh-CN'], 'zh-CN'),
        en: armourSubName(slot.prefix, attr.name.en, slot.name.en, 'en'),
      };
      defs[`${slot.prefix}_${attr.suffix}`] = { info: { cat, sub: [...attr.sub] }, name };
    }
  }
  defs.shields_minion = {
    info: { cat: ARMOUR_CAT.shield, sub: ['召喚', '召唤', 'Minion'] },
    name: L('召喚魔盾', '召唤魔盾', 'Minion Spirit Shield'),
  };
  for (const ward of WARD_ARMOUR) {
    defs[ward.key] = {
      info: { cat: ARMOUR_CAT[ward.slot], sub: ['保護', '结界', 'Ward'] },
      name: ward.name,
    };
  }
  return defs;
}

const ALL_DEFS: Readonly<Record<string, CategoryDef>> = { ...buildArmourDefs(), ...SIMPLE_DEFS };

export const typeMapPoe1: Record<string, TypeInfo> = Object.fromEntries(
  Object.entries(ALL_DEFS).map(([key, def]) => [key, def.info]),
);

function namesFor(locale: SupportedUiLocale): Record<string, string> {
  return Object.fromEntries(Object.entries(ALL_DEFS).map(([key, def]) => [key, def.name[locale]]));
}

const TYPE_NAMES_POE1_BY_LOCALE: Readonly<Record<SupportedUiLocale, Record<string, string>>> = {
  'zh-TW': namesFor('zh-TW'),
  'zh-CN': namesFor('zh-CN'),
  en: namesFor('en'),
};

export const typeNamesPoe1: Record<string, string> =
  createActiveUiLocaleProxy(TYPE_NAMES_POE1_BY_LOCALE);

// === 分組 ===

const armourKeys = (prefix: string, main: string) => [
  main,
  ...ATTRIBUTES.map((a) => `${prefix}_${a.suffix}`),
];

const POE1_WEAPON_KEYS = Object.keys(WEAPON_DEFS);
const POE1_ARMOUR_KEYS = [
  ...ARMOUR_SLOTS.flatMap((slot) => armourKeys(slot.prefix, slot.main)),
  'shields_minion',
  ...WARD_ARMOUR.map((w) => w.key),
];
const POE1_ACCESSORY_KEYS = Object.keys(ACCESSORY_DEFS);
const POE1_JEWEL_KEYS = Object.keys(JEWEL_DEFS);
const POE1_FLASK_KEYS = Object.keys(FLASK_DEFS);
const POE1_MAP_KEYS = ['map'];
const POE1_SANCTUM_KEYS = ['relic'];
const POE1_HEIST_KEYS = [
  'contract',
  'heist_equipment',
  'heist_gear',
  'heist_tool',
  'heist_cloak',
  'heist_brooch',
  'trinket',
];

const GROUP_DEFS: ReadonlyArray<{ readonly label: Localized; readonly keys: string[] }> = [
  { label: L('武器', '武器', 'Weapons'), keys: POE1_WEAPON_KEYS },
  { label: L('防具', '防具', 'Armour'), keys: POE1_ARMOUR_KEYS },
  { label: L('配件', '配件', 'Accessories'), keys: POE1_ACCESSORY_KEYS },
  { label: L('珠寶', '珠宝', 'Jewels'), keys: POE1_JEWEL_KEYS },
  { label: L('藥劑與萃取物', '药剂与酊剂', 'Flasks & Tinctures'), keys: POE1_FLASK_KEYS },
  { label: L('地圖', '地图', 'Maps'), keys: POE1_MAP_KEYS },
  { label: L('聖域', '禁域', 'Sanctum'), keys: POE1_SANCTUM_KEYS },
  { label: L('劫盜', '赏金', 'Heist'), keys: POE1_HEIST_KEYS },
];

function groupsFor(locale: SupportedUiLocale): CategoryGroup[] {
  return GROUP_DEFS.map((g) => ({ groupLabel: g.label[locale], keys: g.keys }));
}

const POE1_GROUPS_BY_LOCALE: Readonly<Record<SupportedUiLocale, CategoryGroup[]>> = {
  'zh-TW': groupsFor('zh-TW'),
  'zh-CN': groupsFor('zh-CN'),
  en: groupsFor('en'),
};

export const poe1Groups: CategoryGroup[] = createActiveUiLocaleProxy(POE1_GROUPS_BY_LOCALE);

// === 子類別列（主按鈕 + 子類別短標籤） ===

const ROW_DEFS: ReadonlyArray<{
  readonly mainKey: string;
  readonly subKeys: Readonly<Record<string, Localized>>;
}> = [
  ...ARMOUR_SLOTS.map((slot) => ({
    mainKey: slot.main,
    subKeys: {
      ...Object.fromEntries(ATTRIBUTES.map((a) => [`${slot.prefix}_${a.suffix}`, a.short])),
      ...(slot.main === 'shield' ? { shields_minion: L('召喚', '召唤', 'Minion') } : {}),
    },
  })),
  {
    mainKey: 'jewel',
    subKeys: {
      crimson_jewel: L('赤紅', '赤红', 'Crimson'),
      viridian_jewel: L('翠綠', '翠绿', 'Viridian'),
      cobalt_jewel: L('鈷藍', '钴蓝', 'Cobalt'),
      prismatic_jewel: L('三相', '三相', 'Prismatic'),
    },
  },
  {
    mainKey: 'cluster_jewel',
    subKeys: {
      large_cluster_jewel: L('巨型', '大型', 'Large'),
      medium_cluster_jewel: L('中型', '中型', 'Medium'),
      small_cluster_jewel: L('小型', '小型', 'Small'),
    },
  },
  {
    mainKey: 'abyss_jewel',
    subKeys: {
      murderous_eye_jewel: L('殺戮', '凶残', 'Murderous'),
      searching_eye_jewel: L('勘查', '锐利', 'Searching'),
      hypnotic_eye_jewel: L('催眠', '安睡', 'Hypnotic'),
      ghastly_eye_jewel: L('極懼', '苍白', 'Ghastly'),
    },
  },
  {
    mainKey: 'flask',
    subKeys: {
      'life-flask': L('生命', '生命', 'Life'),
      'mana-flask': L('魔力', '魔力', 'Mana'),
      'hybrid-flask': L('複合', '复合', 'Hybrid'),
      'utility-flask': L('功能', '功能', 'Utility'),
      'iron-flask': L('鋼鐵', '坚铁', 'Iron'),
    },
  },
  {
    mainKey: 'heist_equipment',
    subKeys: {
      heist_gear: L('武器', '装备', 'Gear'),
      heist_tool: L('工具', '工具', 'Tool'),
      heist_cloak: L('披風', '披风', 'Cloak'),
      heist_brooch: L('胸針', '胸针', 'Brooch'),
    },
  },
];

function rowsFor(locale: SupportedUiLocale): TypeRowConfig[] {
  return ROW_DEFS.map((row) => ({
    mainKey: row.mainKey,
    subKeys: Object.fromEntries(
      Object.entries(row.subKeys).map(([key, label]) => [key, label[locale]]),
    ),
  }));
}

const TYPE_ROW_CONFIGS_POE1_BY_LOCALE: Readonly<Record<SupportedUiLocale, TypeRowConfig[]>> = {
  'zh-TW': rowsFor('zh-TW'),
  'zh-CN': rowsFor('zh-CN'),
  en: rowsFor('en'),
};

export const typeRowConfigsPoe1: TypeRowConfig[] = createActiveUiLocaleProxy(
  TYPE_ROW_CONFIGS_POE1_BY_LOCALE,
);

// === 官方市集類別 → 類別鍵 ===

export const officialCategoryMapPoe1: Record<string, string> = {
  'weapon.claw': 'claw',
  'weapon.runedagger': 'rune-dagger',
  'weapon.wand': 'wand',
  'weapon.rapier': 'thrusting-one-hand-sword',
  'weapon.oneaxe': 'one-hand-axe',
  'weapon.sceptre': 'sceptre',
  'weapon.bow': 'bow',
  'weapon.warstaff': 'warstaff',
  'weapon.twosword': 'two-hand-sword',
  'weapon.twoaxe': 'two-hand-axe',
  'weapon.twomace': 'two-hand-mace',
  'weapon.rod': 'fishing-rod',

  'armour.chest': 'body-armour',
  'armour.helmet': 'helmet',
  'armour.gloves': 'gloves',
  'armour.boots': 'boots',
  'armour.shield': 'shield',
  'armour.quiver': 'quiver',

  'accessory.amulet': 'amulet',
  'accessory.ring': 'ring',
  'accessory.belt': 'belt',
  'accessory.trinket': 'trinket',

  'jewel.base': 'jewel',
  'jewel.abyss': 'abyss_jewel',
  'jewel.cluster': 'cluster_jewel',

  flask: 'flask',
  tincture: 'tincture',

  map: 'map',
  sanctum: 'relic',
  'sanctum.relic': 'relic',
  'heistmission.contract': 'contract',
  'heistmission.blueprint': 'contract',
  heist_equipment: 'heist_equipment',
  'heistequipment.heistweapon': 'heist_gear',
  'heistequipment.heisttool': 'heist_tool',
  'heistequipment.heistutility': 'heist_cloak',
  'heistequipment.heistreward': 'heist_brooch',
};
