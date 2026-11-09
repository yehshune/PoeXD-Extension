import type { SupportedUiLocale } from './preferences-contract';
import { createActiveUiLocaleProxy } from './i18n';
import type { PoeVersion } from './trade-context';

export interface AffinityProfile {
  version: PoeVersion;
  resolveTargetAffinities: (statId?: string | null) => string[];
  specialExplicitAffinities: Set<string>;
  categoryNames: Record<string, string>;
  categoryPriorities: Record<string, number>;
}

const POE1_AFFINITY_NAMES_BY_LOCALE: Readonly<Record<SupportedUiLocale, Record<string, string>>> = {
  'zh-TW': {
    normal: '一般',
    cluster: '星團',
    searing: '灼烙總督',
    eater: '吞噬天地',
    shaper: '塑界者',
    elder: '異界尊師',
    crusader: '聖戰軍王',
    redeemer: '救贖者',
    hunter: '狩獵者',
    warlord: '總督軍',
    essence: '精髓',
    delve: '掘獄',
    incursion: '穿越',
    veiled: '隱匿',
    master: '工藝',
    bestiary: '獸獵',
    synthesis: '追憶',
    synthesis_corrupted: '追憶已汙染',
    sentinel: '重組裝置',
    scourgeup: '災魘',
    scourgedown: '災魘 (負面)',
    haunted: '糾纏',
    infamous: '傭兵',
    corrupted: '已汙染',
    enchant: '附魔',
    heist: '劫盜',
  },
  'zh-CN': {
    normal: '一般',
    cluster: '星团',
    searing: '灼烙总督',
    eater: '吞噬天地',
    shaper: '塑界者',
    elder: '异界尊师',
    crusader: '圣战军王',
    redeemer: '救赎者',
    hunter: '狩猎者',
    warlord: '总督军',
    essence: '精华',
    delve: '掘狱',
    incursion: '穿越',
    veiled: '隐匿',
    master: '工艺',
    bestiary: '魔物',
    synthesis: '忆境',
    synthesis_corrupted: '忆境已腐化',
    sentinel: '重组器',
    scourgeup: '天灾',
    scourgedown: '天灾 (负面)',
    haunted: '纠缠',
    infamous: '雇佣兵',
    corrupted: '已腐化',
    enchant: '附魔',
    heist: '夺宝',
  },
  en: {
    normal: 'Normal',
    cluster: 'Cluster',
    searing: 'Searing Exarch',
    eater: 'Eater of Worlds',
    shaper: 'Shaper',
    elder: 'Elder',
    crusader: 'Crusader',
    redeemer: 'Redeemer',
    hunter: 'Hunter',
    warlord: 'Warlord',
    essence: 'Essence',
    delve: 'Delve',
    incursion: 'Incursion',
    veiled: 'Veiled',
    master: 'Crafted',
    bestiary: 'Bestiary',
    synthesis: 'Synthesis',
    synthesis_corrupted: 'Synthesis Corrupted',
    sentinel: 'Recombinator',
    scourgeup: 'Scourge',
    scourgedown: 'Scourge (Detrimental)',
    haunted: 'Haunted',
    infamous: 'Mercenary',
    corrupted: 'Corrupted',
    enchant: 'Enchant',
    heist: 'Heist',
  },
};

const POE2_AFFINITY_NAMES_BY_LOCALE: Readonly<Record<SupportedUiLocale, Record<string, string>>> = {
  'zh-TW': {
    normal: '一般',
    essence: '精髓',
    perfect_essence: '完美精髓',
    bonded: '命定詞綴',
    socketable: '增幅',
    desecrated: '褻瀆',
    destruction: '毀滅',
    berserking: '狂戰',
    soul: '靈魂',
    liquid: '液態情感',
    decay: '衰敗',
    marksman: '射手',
    chronomancy: '時空術士',
    breach_otherworldly: '裂痕 (異界)',
    breach_minion: '裂痕 (召喚物)',
    breach_caster: '裂痕 (施法者)',
    corrupted: '已汙染',
    enchant: '附魔',
  },
  'zh-CN': {
    normal: '一般',
    essence: '精华',
    perfect_essence: '完美精华',
    bonded: '命定词缀',
    socketable: '增幅',
    desecrated: '亵渎',
    destruction: '毁灭',
    berserking: '狂战',
    soul: '灵魂',
    liquid: '液态情感',
    decay: '衰败',
    marksman: '射手',
    chronomancy: '时空术士',
    breach_otherworldly: '裂隙 (异界)',
    breach_minion: '裂隙 (召唤物)',
    breach_caster: '裂隙 (施法者)',
    corrupted: '已腐化',
    enchant: '附魔',
  },
  en: {
    normal: 'Normal',
    essence: 'Essence',
    perfect_essence: 'Perfect Essence',
    bonded: 'Bonded',
    socketable: 'Augment',
    desecrated: 'Desecrated',
    destruction: 'Destruction',
    berserking: 'Berserking',
    soul: 'Soul',
    liquid: 'Distilled',
    decay: 'Decay',
    marksman: 'Marksman',
    chronomancy: 'Chronomancy',
    breach_otherworldly: 'Breach (Otherworldly)',
    breach_minion: 'Breach (Minion)',
    breach_caster: 'Breach (Caster)',
    corrupted: 'Corrupted',
    enchant: 'Enchant',
  },
};

export const poe1AffinityProfile: AffinityProfile = {
  version: 'poe1',
  resolveTargetAffinities(statId?: string | null): string[] {
    if (!statId) return ['normal'];
    if (statId.startsWith('enchant.')) {
      return ['corrupted', 'enchant'];
    }
    if (statId.startsWith('crafted.')) {
      return ['master', 'veiled'];
    }
    if (statId.startsWith('veiled.')) {
      return ['veiled'];
    }
    if (statId.startsWith('implicit.')) {
      return ['normal', 'corrupted'];
    }
    return ['normal'];
  },
  specialExplicitAffinities: new Set([
    'shaper',
    'elder',
    'crusader',
    'redeemer',
    'hunter',
    'warlord',
    'bestiary',
    'infamous',
    'delve',
    'essence',
    'sentinel',
  ]),
  categoryNames: createActiveUiLocaleProxy(POE1_AFFINITY_NAMES_BY_LOCALE),
  categoryPriorities: {
    normal: 1,
    cluster: 2,
    searing: 5,
    eater: 6,
    shaper: 10,
    elder: 11,
    crusader: 12,
    redeemer: 13,
    hunter: 14,
    warlord: 15,
    essence: 20,
    delve: 22,
    incursion: 23,
    veiled: 24,
    master: 25,
    bestiary: 26,
    synthesis: 27,
    synthesis_corrupted: 28,
    sentinel: 29,
    scourgeup: 30,
    scourgedown: 31,
    haunted: 32,
    infamous: 33,
    corrupted: 40,
    enchant: 41,
    heist: 42,
  },
};

export const poe2AffinityProfile: AffinityProfile = {
  version: 'poe2',
  resolveTargetAffinities(statId?: string | null): string[] {
    if (!statId) return ['normal'];
    if (statId.startsWith('enchant.')) {
      return ['corrupted', 'enchant'];
    }
    if (statId.startsWith('rune.')) {
      return ['socketable', 'bonded'];
    }
    if (statId.startsWith('desecrated.')) {
      return ['desecrated'];
    }
    if (statId.startsWith('crafted.')) {
      return ['essence', 'perfect_essence', 'crafted', 'liquid'];
    }
    if (statId.startsWith('implicit.')) {
      return ['normal', 'corrupted'];
    }
    return ['normal'];
  },
  specialExplicitAffinities: new Set([
    'desecrated',
    'bonded',
    'socketable',
    'liquid',
    'essence',
    'perfect_essence',
  ]),
  categoryNames: createActiveUiLocaleProxy(POE2_AFFINITY_NAMES_BY_LOCALE),
  categoryPriorities: {
    normal: 1,
    essence: 10,
    perfect_essence: 11,
    bonded: 20,
    socketable: 21,
    desecrated: 30,
    destruction: 31,
    berserking: 32,
    soul: 33,
    liquid: 34,
    decay: 35,
    marksman: 36,
    chronomancy: 37,
    breach_otherworldly: 40,
    breach_minion: 41,
    breach_caster: 42,
    corrupted: 50,
    enchant: 51,
  },
};

export const affinityProfiles: Record<PoeVersion, AffinityProfile> = {
  poe1: poe1AffinityProfile,
  poe2: poe2AffinityProfile,
};

export function getAffinityProfile(version: PoeVersion): AffinityProfile {
  return affinityProfiles[version];
}

export interface CommonAffinityProfile {
  resolveTargetAffinities: (statId?: string | null) => string[];
  specialExplicitAffinities: Set<string>;
}

export const commonAffinityProfile: CommonAffinityProfile = {
  resolveTargetAffinities(statId?: string | null): string[] {
    if (!statId) return ['normal'];
    if (statId.startsWith('enchant.')) {
      return ['corrupted', 'enchant'];
    }
    if (statId.startsWith('rune.')) {
      return ['socketable', 'bonded'];
    }
    if (statId.startsWith('desecrated.')) {
      return ['desecrated'];
    }
    if (statId.startsWith('crafted.')) {
      return ['master', 'veiled', 'essence', 'perfect_essence', 'crafted', 'liquid'];
    }
    if (statId.startsWith('veiled.')) {
      return ['veiled'];
    }
    if (statId.startsWith('implicit.')) {
      return ['normal', 'corrupted'];
    }
    return ['normal'];
  },
  specialExplicitAffinities: new Set([
    ...poe1AffinityProfile.specialExplicitAffinities,
    ...poe2AffinityProfile.specialExplicitAffinities,
  ]),
};
