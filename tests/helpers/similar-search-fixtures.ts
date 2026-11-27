import poe1Stats from '@/public/json/poe1/locales/en/trade-stats.json';
import type { DraftStat, SimilarSearchDraft } from '@/utils/similar-item-search';

const stats = poe1Stats.stats as Record<string, string | string[]>;

export const englishStatText = (statId: string): string | undefined => {
  const text = stats[statId];
  return Array.isArray(text) ? text[0] : text;
};

export function referenceStat(
  key: string,
  value: number,
  threshold = Math.floor(value * 0.8),
): DraftStat {
  return {
    key,
    id: key,
    text: key,
    value,
    tier: 1,
    role: 'reference',
    domain: 'any',
    threshold,
    customized: false,
    pseudo: key.startsWith('pseudo.'),
  };
}

/** 一件三個參考 stat 的胸甲草稿：生命 100、抗性總和 90、閃避增幅 50 */
export function chestDraft(overrides: Partial<SimilarSearchDraft> = {}): SimilarSearchDraft {
  return {
    version: 'poe1',
    category: 'armour.chest',
    baseType: 'Eelskin Tunic',
    scope: 'category',
    tolerance: 80,
    status: 'securable',
    stats: [
      referenceStat('pseudo.pseudo_total_life', 100),
      referenceStat('pseudo.pseudo_total_elemental_resistance', 90),
      referenceStat('explicit.stat_124859000', 50),
    ],
    properties: [],
    ...overrides,
  };
}

const ICON = `https://web.poecdn.com/gen/image/${Buffer.from(
  JSON.stringify([25, 14, { f: '2DItems/Armours/BodyArmours/BodyDex1', w: 2, h: 3, scale: 1 }]),
).toString('base64')}/x/icon.png`;

const LINE_TEMPLATES = {
  life: ['+# to maximum Life', 'explicit.stat_3299347043'],
  fire: ['+#% to Fire Resistance', 'explicit.stat_3372524247'],
  evasion: ['#% increased Evasion Rating', 'explicit.stat_124859000'],
} as const;

export type ChestLines = Partial<Record<keyof typeof LINE_TEMPLATES, number>>;

/** `/fetch` 結果的一筆 `{ id, item, listing }`，只帶指定的詞綴 */
export function chestResult(id: string, lines: ChestLines, extra: Record<string, unknown> = {}) {
  const explicitMods = Object.entries(lines).map(([name, value]) => {
    const [template, hash] = LINE_TEMPLATES[name as keyof typeof LINE_TEMPLATES];
    return {
      description: template.replace('#', String(value)),
      domain: 'explicit',
      hash: `stat.${hash}`,
      mods: [{ name: 'X', tier: 'P1', magnitudes: [{ min: '1', max: String(value) }] }],
    };
  });
  return {
    id,
    item: {
      id,
      icon: ICON,
      rarity: 'Rare',
      frameType: 2,
      baseType: 'Eelskin Tunic',
      explicitMods,
      extended: {},
      ...extra,
    },
    listing: { price: { amount: 1, currency: 'chaos' }, hideout_token: `token-${id}` },
  };
}
