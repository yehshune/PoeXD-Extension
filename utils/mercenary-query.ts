/**
 * 傭兵技能群組（官方 stat 群組 type `mercenary`）的純領域邏輯。
 *
 * 官方語意：一個 mercenary 群組描述「同一個技能」與連在它身上的輔助，`value.min` 為至少要符合的條目數。
 * 同家族的輔助（例如 Lesser Chain / Chain）同一技能只會出現一個，所以把「某家族 T2 以上」
 * 展開成該家族所有符合階級的 id 放進同一群組，仍只會計 1 次。
 *
 * 本模組不碰 DOM、Vuex 或 chrome.*。
 */
import type { CriteriaOverlayStatFilter, CriteriaOverlayStatGroup } from './criteria-overlay';
import type {
  MercenaryBuild,
  MercenaryCatalog,
  MercenarySkill,
  MercenarySupport,
  MercenarySupportSlots,
} from './mercenary-data';

export const MERCENARY_GROUP_TYPE = 'mercenary';
export const MERCENARY_WARRANT_DISC = 'mercenary_warrant';

export type MercenaryTier = 1 | 2 | 3;
export const MERCENARY_TIERS: readonly MercenaryTier[] = [1, 2, 3];

/**
 * 連結等級對應的輔助數範圍（不含技能本身）：高 5–6 連、中 3–4 連、低 2–3 連。
 */
export const MERCENARY_SUPPORT_RANGE: Readonly<
  Record<MercenarySupportSlots, readonly [min: number, max: number]>
> = {
  high: [4, 5],
  medium: [2, 3],
  low: [1, 2],
  none: [0, 0],
};

/** 某技能可連的一個輔助家族；專屬輔助（family 為 null）自成一族。 */
export interface MercenarySupportFamily {
  key: string;
  name: string;
  maxTier: number;
  /** 依階級由低到高排序。 */
  members: MercenarySupport[];
}

export interface MercenarySupportPick {
  family: string;
  minTier: MercenaryTier;
}

export interface MercenarySkillSelection {
  skill: number;
  supports: MercenarySupportPick[];
  /** 勾選的輔助中至少要符合幾個（0 表示只要求技能）。 */
  minSupports: number;
}

export type MercenarySkillRole = 'core' | 'main' | 'utility';

/**
 * 社群公認較差、會拉低價值的技能（參考 Awakened PoE Trade 的規則）。
 * key 為 Build 的 trade type（不含 Infamous 的 Noble 後綴），value 為技能 trade id。
 */
const WEAK_SKILLS_BY_BUILD: Readonly<Record<string, readonly string[]>> = {
  MiscScionWandAttacks: ['mercenary.skill_12583'], // Kineticist: Kinetic Bolt
  EleBowRangerClones: ['mercenary.skill_24409'], // Manyshot: Icicle Rain
  MeleeAOEStrikeDuelistRangeStrikes: ['mercenary.skill_40957', 'mercenary.skill_37916'], // Combatant: Wild Strike, Spectral Helix
};

export function isWeakMercenarySkill(build: MercenaryBuild | null, skill: MercenarySkill): boolean {
  if (!build) return false;
  const base = build.tradeType.replace(/Noble$/, '');
  return WEAK_SKILLS_BY_BUILD[base]?.includes(skill.tradeId) ?? false;
}

const familyKeyOf = (support: MercenarySupport) => support.family ?? `#${support.index}`;

/** 列出技能可連的輔助家族，依名稱排序。 */
export function listSkillSupportFamilies(
  catalog: MercenaryCatalog,
  skill: MercenarySkill,
): MercenarySupportFamily[] {
  const byKey = new Map<string, MercenarySupport[]>();
  for (const index of skill.supports) {
    const support = catalog.supports[index];
    if (!support) continue;
    const key = familyKeyOf(support);
    byKey.set(key, [...(byKey.get(key) ?? []), support]);
  }
  return [...byKey.entries()]
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => a.tier - b.tier);
      const maxTier = sorted[sorted.length - 1].tier;
      // 去掉 Lesser/Greater 修飾在各語系不可靠，改用沒有修飾的 T2 成員代表家族；沒有 T2 時用最低階
      const representative = sorted.find((m) => m.tier === 2) ?? sorted[0];
      return { key, name: representative.name, maxTier, members: sorted };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 家族中階級 ≥ minTier 的輔助；minTier 高於家族最高階時退回最高階。 */
export function familyMembersAtLeast(
  family: MercenarySupportFamily,
  minTier: number,
): MercenarySupport[] {
  const tier = Math.min(minTier, family.maxTier);
  return family.members.filter((m) => m.tier >= tier);
}

/** 家族實際存在的階級（給階級切換按鈕用）。 */
export function familyTiers(family: MercenarySupportFamily): MercenaryTier[] {
  return MERCENARY_TIERS.filter((tier) => family.members.some((m) => m.tier === tier));
}

/** 依選擇組出一個官方 mercenary 群組。 */
export function buildMercenaryStatGroup(
  catalog: MercenaryCatalog,
  selection: MercenarySkillSelection,
): CriteriaOverlayStatGroup {
  const skill = catalog.skills[selection.skill];
  if (!skill) throw new Error(`unknown mercenary skill ${selection.skill}`);
  const families = new Map(listSkillSupportFamilies(catalog, skill).map((f) => [f.key, f]));
  const picks = selection.supports.filter((p) => families.has(p.family));
  const supportIds = picks.flatMap((p) =>
    familyMembersAtLeast(families.get(p.family)!, p.minTier).map((m) => m.tradeId),
  );
  const minSupports = Math.max(0, Math.min(selection.minSupports, picks.length));
  return {
    type: MERCENARY_GROUP_TYPE,
    value: { min: 1 + minSupports },
    filters: [skill.tradeId, ...new Set(supportIds)].map((id) => ({ id })),
  };
}

/** 批次新增時可選的群組類型：傭兵技能群組（含輔助）或以技能為條件的官方群組。 */
export type MercenaryGroupKind = 'mercenary' | 'and' | 'not' | 'count';

const skillFilters = (skills: readonly MercenarySkill[]) => skills.map((s) => ({ id: s.tradeId }));

/** 排除群組（官方 `not`）：列出的技能都不能出現在傭兵身上。 */
export function buildMercenaryExcludeGroup(
  skills: readonly MercenarySkill[],
): CriteriaOverlayStatGroup {
  return { type: 'not', filters: skillFilters(skills) };
}

/** 必須群組（官方 `and`）：列出的技能都要出現在傭兵身上。 */
export function buildMercenaryRequireGroup(
  skills: readonly MercenarySkill[],
): CriteriaOverlayStatGroup {
  return { type: 'and', filters: skillFilters(skills) };
}

/** 計數群組（官方 `count`）：列出的技能至少出現 min 個（限制在 1 到技能數之間）。 */
export function buildMercenaryCountGroup(
  skills: readonly MercenarySkill[],
  min: number,
): CriteriaOverlayStatGroup {
  const clamped = Math.max(1, Math.min(Math.floor(min), skills.length));
  return { type: 'count', value: { min: clamped }, filters: skillFilters(skills) };
}

/**
 * 把勾選的傭兵技能寫進一般條件群組的條件清單：
 * 保留非傭兵技能的條件與已存在技能的原本設定（例如停用狀態），移除取消勾選的技能，新技能附加在後。
 */
export function mergeMercenarySkillFilters(
  catalog: MercenaryCatalog,
  filters: readonly CriteriaOverlayStatFilter[],
  skills: readonly MercenarySkill[],
): CriteriaOverlayStatFilter[] {
  const wanted = new Set(skills.map((s) => s.tradeId));
  const kept = filters.filter((f) => !catalog.skillByTradeId.has(f.id) || wanted.has(f.id));
  const present = new Set(kept.map((f) => f.id));
  return [
    ...kept.map((f) => ({ ...f })),
    ...skills.filter((s) => !present.has(s.tradeId)).map((s) => ({ id: s.tradeId })),
  ];
}

/**
 * 官方 mercenary 群組只計算命中數，技能本身不是必要條件。
 * 勾選的輔助多於要求數時，其他技能身上的輔助可能湊滿 min，結果就不一定有這個技能；
 * 全部輔助都要求時不會發生（同家族輔助不並存，其他技能最多只命中勾選數個）。
 */
export function mercenarySkillNotGuaranteed(
  selection: Pick<MercenarySkillSelection, 'supports' | 'minSupports'>,
): boolean {
  return selection.supports.length > Math.max(0, selection.minSupports);
}

/**
 * 把頁面上的 mercenary 群組解析回選擇，供選擇器預填。
 * 群組中沒有可辨識的技能時回傳 null。
 */
export function parseMercenaryStatGroup(
  catalog: MercenaryCatalog,
  group: Pick<CriteriaOverlayStatGroup, 'filters' | 'value'>,
): MercenarySkillSelection | null {
  const ids = group.filters.filter((f) => !f.disabled).map((f) => f.id);
  const skill = ids.map((id) => catalog.skillByTradeId.get(id)).find((s) => s !== undefined);
  if (!skill) return null;

  const families = listSkillSupportFamilies(catalog, skill);
  const present = new Set(ids);
  const supports: MercenarySupportPick[] = families.flatMap((family) => {
    const tiers = family.members.filter((m) => present.has(m.tradeId)).map((m) => m.tier);
    if (tiers.length === 0) return [];
    const minTier = Math.min(...tiers);
    return [{ family: family.key, minTier: Math.max(1, Math.min(3, minTier)) as MercenaryTier }];
  });

  const min = typeof group.value?.min === 'number' ? group.value.min : 1 + supports.length;
  return {
    skill: skill.index,
    supports,
    minSupports: Math.max(0, Math.min(supports.length, min - 1)),
  };
}

export type MercenarySelectionHint =
  | { kind: 'range'; min: number; max: number }
  | { kind: 'exceeds-max'; max: number }
  | { kind: 'any-of'; picked: number; min: number }
  | { kind: 'max-links-t3' };

/**
 * 依技能連結等級、勾選數與「至少符合」數量給提示：
 * - range：這個技能一般會連幾個輔助。
 * - exceeds-max：要求的數量超過技能最多能連的輔助數，不可能符合。
 * - any-of：勾選數多於要求數，代表從勾選中任選。
 * - max-links-t3：要求滿連且每個勾選都只接受 T3。
 */
export function mercenarySelectionHints(
  skill: MercenarySkill,
  families: readonly MercenarySupportFamily[],
  selection: Pick<MercenarySkillSelection, 'supports' | 'minSupports'>,
): MercenarySelectionHint[] {
  const [rangeMin, rangeMax] = MERCENARY_SUPPORT_RANGE[skill.slots];
  const hints: MercenarySelectionHint[] = [];
  if (rangeMax > 0) hints.push({ kind: 'range', min: rangeMin, max: rangeMax });
  const picked = selection.supports.length;
  const min = Math.min(selection.minSupports, picked);
  if (min > rangeMax) {
    hints.push({ kind: 'exceeds-max', max: rangeMax });
  } else if (picked > min && min > 0) {
    hints.push({ kind: 'any-of', picked, min });
  }
  const byKey = new Map(families.map((f) => [f.key, f]));
  const allT3 =
    picked > 0 &&
    selection.supports.every((p) => Math.min(p.minTier, byKey.get(p.family)?.maxTier ?? 3) >= 3);
  if (rangeMax > 0 && min === rangeMax && allT3) hints.push({ kind: 'max-links-t3' });
  return hints;
}

export interface MercenaryBuildSkill {
  skill: MercenarySkill;
  role: MercenarySkillRole;
  weak: boolean;
}

/** Build 的全部技能（固定、主技能池、輔助技能池），去除重複。 */
export function listBuildSkills(
  catalog: MercenaryCatalog,
  build: MercenaryBuild,
): MercenaryBuildSkill[] {
  const seen = new Set<number>();
  const out: MercenaryBuildSkill[] = [];
  const push = (indices: number[], role: MercenarySkillRole) => {
    for (const index of indices) {
      const skill = catalog.skills[index];
      if (!skill || seen.has(index)) continue;
      seen.add(index);
      out.push({ skill, role, weak: isWeakMercenarySkill(build, skill) });
    }
  };
  push(build.core, 'core');
  push(build.main, 'main');
  push(build.utility, 'utility');
  return out;
}
