/**
 * PoB / pobb.in 遊戲統計與專用詞彙對照（繁中／簡中）：
 * - 縮寫別名（`POBBIN_OFFICIAL_LABEL_ALIASES`）：把 pobb.in 英文縮寫對應回官方資料表全稱，
 *   讓官方 `result-labels.json` 優先命中。
 * - PoB 獨有統計與狀態：僅作為官方資料查不到時的最後備援，不混入官方 `labelLookup`，
 *   也不碰 pobb.in 網站本身的操作 UI（按鈕、區塊標題、頁首／頁尾）。
 */
import type { MarketTranslationLocale } from './market-translation';

/** pobb.in 英文縮寫 → 官方遊戲資料全稱（命中官方資料時優先採用官方譯文） */
export const POBBIN_OFFICIAL_LABEL_ALIASES: Readonly<Record<string, string>> = {
  ES: 'Energy Shield',
  Resistances: 'Resistance',
  'Crit Chance': 'Critical Strike Chance',
  'Crit Multi': 'Critical Strike Multiplier',
  'Hit Chance': 'Chance to Hit',
};

/** 摘要標籤與 eHP 最大承傷懸浮框的 PoB 備援詞彙（官方資料查不到時才採用） */
const POB_SUMMARY_LABELS: Readonly<
  Record<MarketTranslationLocale, Readonly<Record<string, string>>>
> = {
  'zh-TW': {
    eHP: '有效血量',
    Resistances: '抗性',
    Speed: '速度',
    'Hit Rate': '擊中頻率',
    'Hit Chance': '命中率',
    'Crit Chance': '暴擊率',
    'Crit Multi': '暴擊加成',
    Config: '配置',
    Bandit: '盜賊',
    Pantheon: '眾神殿',
    ES: '能量護盾',
    'Energy Shield': '能量護盾',
    Evade: '閃避率',
    Evasion: '閃避值',
    Dodge: '躲避率',
    'Spell Dodge': '法術躲避',
    Ward: '結界',
    Block: '格擋',
    'Spell Block': '法術格擋',
    'Spell Suppression': '法術壓抑',
    'Spell Suppress': '法術壓抑',
    Suppression: '法術壓抑',
    Suppress: '法術壓抑',
    'Phys. Red.': '物理減傷',
    'Full DPS': '總 DPS',
    'Total DPS': '總 DPS',
    'Combined DPS': '合計 DPS',
    'DoT DPS': '持續傷害 DPS',
    'Ignite DPS': '點燃 DPS',
    'Bleed DPS': '流血 DPS',
    'Poison DPS': '中毒 DPS',
    'Impale DPS': '穿刺 DPS',
    'Minion DPS': '召喚物 DPS',
    'Average Hit': '平均擊中',
    'Avg. Hit': '平均擊中',
    'Effective Trigger Rate': '有效觸發頻率',
    'Trigger Rate': '觸發頻率',
    'Mana Cost': '魔力消耗',
    'Life Cost': '生命消耗',
    'Unreserved Mana': '未保留魔力',
    'Net Regen': '淨回復',
    Rage: '盛怒',
    Fortify: '護體',
    Impale: '穿刺',
    // eHP 最大承傷懸浮框
    'Phys Max Hit': '物理最大承傷',
    'Fire Max Hit': '火焰最大承傷',
    'Cold Max Hit': '冰冷最大承傷',
    'Lightning Max Hit': '閃電最大承傷',
    'Chaos Max Hit': '混沌最大承傷',
  },
  'zh-CN': {
    eHP: '有效血量',
    Resistances: '抗性',
    Speed: '速度',
    'Hit Rate': '击中频率',
    'Hit Chance': '命中率',
    'Crit Chance': '暴击率',
    'Crit Multi': '暴击加成',
    Config: '配置',
    Bandit: '盗贼',
    Pantheon: '万神殿',
    ES: '能量护盾',
    'Energy Shield': '能量护盾',
    Evade: '闪避率',
    Evasion: '闪避值',
    Dodge: '躲避率',
    'Spell Dodge': '法术躲避',
    Ward: '结界',
    Block: '格挡',
    'Spell Block': '法术格挡',
    'Spell Suppression': '法术压制',
    'Spell Suppress': '法术压制',
    Suppression: '法术压制',
    Suppress: '法术压制',
    'Phys. Red.': '物理减伤',
    'Full DPS': '总 DPS',
    'Total DPS': '总 DPS',
    'Combined DPS': '合计 DPS',
    'DoT DPS': '持续伤害 DPS',
    'Ignite DPS': '点燃 DPS',
    'Bleed DPS': '流血 DPS',
    'Poison DPS': '中毒 DPS',
    'Impale DPS': '穿刺 DPS',
    'Minion DPS': '召唤物 DPS',
    'Average Hit': '平均击中',
    'Avg. Hit': '平均击中',
    'Effective Trigger Rate': '有效触发频率',
    'Trigger Rate': '触发频率',
    'Mana Cost': '魔力消耗',
    'Life Cost': '生命消耗',
    'Unreserved Mana': '未保留魔力',
    'Net Regen': '净回复',
    Rage: '盛怒',
    Fortify: '护体',
    Impale: '穿刺',
    // eHP 最大承伤悬浮框
    'Phys Max Hit': '物理最大承伤',
    'Fire Max Hit': '火焰最大承伤',
    'Cold Max Hit': '冰冷最大承伤',
    'Lightning Max Hit': '闪电最大承伤',
    'Chaos Max Hit': '混沌最大承伤',
  },
};

/** 永恆珠寶征服詞綴（PoB 自組字串，不在官方描述檔內） */
const TIMELESS_CONQUERED_LINES: Readonly<
  Record<MarketTranslationLocale, Readonly<Record<string, string>>>
> = {
  'zh-TW': {
    'Passives in radius are Conquered by the Karui': '範圍內天賦被卡魯征服',
    'Passives in radius are Conquered by the Eternal Empire': '範圍內天賦被永恆帝國征服',
    'Passives in radius are Conquered by the Maraketh': '範圍內天賦被馬拉克斯征服',
    'Passives in radius are Conquered by the Templar': '範圍內天賦被聖堂武僧征服',
    'Passives in radius are Conquered by the Vaal': '範圍內天賦被瓦爾征服',
  },
  'zh-CN': {
    'Passives in radius are Conquered by the Karui': '范围内的天赋被卡鲁征服',
    'Passives in radius are Conquered by the Eternal Empire': '范围内的天赋被永恒帝国征服',
    'Passives in radius are Conquered by the Maraketh': '范围内的天赋被马拉克斯征服',
    'Passives in radius are Conquered by the Templar': '范围内的天赋被圣堂武僧征服',
    'Passives in radius are Conquered by the Vaal': '范围内的天赋被瓦尔征服',
  },
};

const SUMMARY_VALUE_TERMS: Readonly<
  Record<MarketTranslationLocale, Readonly<Record<string, string>>>
> = {
  'zh-TW': {
    // 盜賊
    'Kill All': '全部擊殺',
    'Help Alira': '幫助阿莉亞',
    'Help Kraityn': '幫助克雷頓',
    'Help Oak': '幫助歐克',
    Alira: '阿莉亞',
    Kraityn: '克雷頓',
    Oak: '歐克',
    // 常見 PoB Config 標籤
    Onslaught: '猛攻',
    Fortify: '護體',
    Intimidate: '威嚇',
    Unnerve: '神經脆弱',
    'Covered in Ash': '灰燼纏身',
    'Covered in Frost': '寒霜纏身',
    Maim: '癱瘓',
    Tailwind: '順風',
    Elusive: '靈巧',
    Adrenaline: '腎上腺素',
    'Consecrated Ground': '奉獻地面',
    'Pinnacle Boss': '巔峰頭目',
    'Guardian/Pinnacle': '守衛／巔峰頭目',
    'Uber Boss': '終極頭目',
    Shaper: '塑界者',
    Sirus: '賽勒斯',
    Taunt: '嘲諷',
    Blind: '致盲',
    Bleed: '流血',
    Ignite: '點燃',
    Poison: '中毒',
    Shock: '感電',
    Chill: '冰緩',
    Freeze: '冰凍',
    Scorch: '焦灼',
    Brittle: '易碎',
    Sap: '殘喘',
    Phasing: '迷蹤',
    'Unholy Might': '不潔之力',
    'Arcane Surge': '秘能波動',
    'Power Charges': '暴擊球',
    'Frenzy Charges': '狂怒球',
    'Endurance Charges': '耐力球',
    'Custom Mods': '自訂詞綴',
  },
  'zh-CN': {
    // 盗贼
    'Kill All': '全部击杀',
    'Help Alira': '帮助阿莉亚',
    'Help Kraityn': '帮助克雷顿',
    'Help Oak': '帮助欧克',
    Alira: '阿莉亚',
    Kraityn: '克雷顿',
    Oak: '欧克',
    // 常见 PoB Config 标签
    Onslaught: '猛攻',
    Fortify: '护体',
    Intimidate: '威吓',
    Unnerve: '神经脆弱',
    'Covered in Ash': '灰烬缠身',
    'Covered in Frost': '寒霜缠身',
    Maim: '瘫痪',
    Tailwind: '顺风',
    Elusive: '灵巧',
    Adrenaline: '肾上腺素',
    'Consecrated Ground': '奉献地面',
    'Pinnacle Boss': '巅峰首领',
    'Guardian/Pinnacle': '守卫／巅峰首领',
    'Uber Boss': '终极首领',
    Shaper: '塑界者',
    Sirus: '赛勒斯',
    Taunt: '嘲讽',
    Blind: '致盲',
    Bleed: '流血',
    Ignite: '点燃',
    Poison: '中毒',
    Shock: '感电',
    Chill: '冰缓',
    Freeze: '冰冻',
    Scorch: '焦灼',
    Brittle: '易碎',
    Sap: '残喘',
    Phasing: '迷踪',
    'Unholy Might': '不洁之力',
    'Arcane Surge': '秘能波动',
    'Power Charges': '暴击球',
    'Frenzy Charges': '狂怒球',
    'Endurance Charges': '耐力球',
    'Custom Mods': '自定义词缀',
  },
};

/** 可在 Config 裡接在百分比後的異常／效果名稱（譯文共用 `SUMMARY_VALUE_TERMS`） */
const PERCENT_EFFECT_KEYS: ReadonlySet<string> = new Set([
  'Shock',
  'Chill',
  'Scorch',
  'Brittle',
  'Sap',
  'Elusive',
]);

const STACK_EFFECT_TERMS: Readonly<
  Record<MarketTranslationLocale, Readonly<Record<string, string>>>
> = {
  'zh-TW': {
    Wither: '層凋零',
    Withered: '層凋零',
    Rage: '盛怒',
    Fortification: '層護體',
    Fortify: '層護體',
    Power: '暴擊球',
    Frenzy: '狂怒球',
    Endurance: '耐力球',
  },
  'zh-CN': {
    Wither: '层凋零',
    Withered: '层凋零',
    Rage: '盛怒',
    Fortification: '层护体',
    Fortify: '层护体',
    Power: '暴击球',
    Frenzy: '狂怒球',
    Endurance: '耐力球',
  },
};

const PERCENT_EFFECT_RE = /^(\d+(?:\.\d+)?)%\s+([A-Za-z]+)$/;
const STACK_EFFECT_RE = /^(\d+)\s+([A-Za-z]+)$/;

export function lookupPobSummaryLabel(raw: string, locale: MarketTranslationLocale): string | null {
  return POB_SUMMARY_LABELS[locale][raw] ?? null;
}

export function translateTimelessConqueredLine(
  line: string,
  locale: MarketTranslationLocale,
): string | null {
  return TIMELESS_CONQUERED_LINES[locale][line] ?? null;
}

/** 翻譯 PoB 摘要值單一項目（盜賊、Config 百分比／層數／旗標）；未命中回傳 null */
export function translatePobSummaryToken(
  token: string,
  locale: MarketTranslationLocale,
): string | null {
  const direct = SUMMARY_VALUE_TERMS[locale][token];
  if (direct) return direct;

  const pct = PERCENT_EFFECT_RE.exec(token);
  if (pct && PERCENT_EFFECT_KEYS.has(pct[2])) {
    const term = SUMMARY_VALUE_TERMS[locale][pct[2]];
    if (term) return `${pct[1]}% ${term}`;
  }

  const stack = STACK_EFFECT_RE.exec(token);
  if (stack) {
    const term = STACK_EFFECT_TERMS[locale][stack[2]];
    if (term) return `${stack[1]} ${term}`;
  }

  return null;
}
