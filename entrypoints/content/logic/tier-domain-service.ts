import { type PoeVersion } from '@/utils/trade-context';
import { getAffinityProfile, commonAffinityProfile } from '@/utils/affinity-registry';
import {
  ensureAffixLexiconLoaded,
  findModTiersByStatId as findModTiersFromLexicon,
  getCandidateStatIds,
  isModsTiersArtifact,
  setAffixLexiconMockData,
} from '@/utils/affix-lexicon';

export interface TierParsedValues {
  rangeText: string;
  valMin: string;
  valMax: string;
  isRange: boolean;
}

export interface TierModEligibility {
  isEligible: boolean;
  normalTiers: any[];
  availableTypes: string[];
}

export interface TierDomainService {
  loadModsData(
    generation: number,
    isCurrentGeneration: (gen: number) => boolean,
  ): Promise<any | null>;
  findModTiersByStatId(statId: string, rawMods?: any): any[] | null;
  parseTierValues(tier: any, statId?: string | null): TierParsedValues;
  resolveTierModEligibility(
    tiers: any[] | null | undefined,
    statId?: string | null,
  ): TierModEligibility;
  filterTiersByCategory(normalTiers: any[], category: string | null | undefined): any[];
  groupTiersByMod(filteredTiers: any[]): TierModGroup[];
  getRawModsData(): any | null;
  reset(): void;
}

export interface LexiconVersionHandle {
  readonly __lexiconVersion: PoeVersion;
}

function isLexiconVersionHandle(value: unknown): value is LexiconVersionHandle {
  return Boolean(value && typeof value === 'object' && '__lexiconVersion' in value);
}

/**
 * 依 statId 查詢對應的 Tier 清單，支援 fractured / desecrated / enchant / rune / crafted / veiled 到 explicit 的 fallback
 */
export function findModTiersByStatId(statId: string, rawMods: any): any[] | null {
  if (!rawMods) return null;

  if (isLexiconVersionHandle(rawMods)) {
    return findModTiersFromLexicon(statId, rawMods.__lexiconVersion);
  }

  for (const candidate of getCandidateStatIds(statId)) {
    if (rawMods[candidate]) {
      return rawMods[candidate];
    }
  }
  return null;
}

export interface TierModGroup {
  id: string;
  label: string;
  templateZh: string;
  isPure: boolean;
  tiers: any[];
}

/**
 * 依詞綴（displayTemplate 或 key）將該類別的 tiers 進行分組，純粹詞綴優先排在首位
 */
export function groupTiersByMod(filteredTiers: any[]): TierModGroup[] {
  if (!Array.isArray(filteredTiers) || filteredTiers.length === 0) return [];
  const groupsMap = new Map<string, any[]>();
  for (const tier of filteredTiers) {
    const key = (tier && (tier.displayTemplate || tier.displayKey || tier.key)) || '';
    if (!groupsMap.has(key)) {
      groupsMap.set(key, []);
    }
    groupsMap.get(key)!.push(tier);
  }

  const groups: TierModGroup[] = [];
  for (const [key, tiers] of groupsMap.entries()) {
    const isPure = !key.includes('|||||');
    const label = key.replace(/\|\|\|\|\|/g, '\n');
    groups.push({
      id: key,
      label,
      templateZh: key,
      isPure,
      tiers,
    });
  }

  groups.sort((a, b) => {
    if (a.isPure && !b.isPure) return -1;
    if (!a.isPure && b.isPure) return 1;
    return 0;
  });

  return groups;
}

/**
 * 解析 Tier 數值區間，複合詞綴依 statId 精確對應其數值索引
 */
export function parseTierValues(tier: any, statId?: string | null): TierParsedValues {
  let rangeText = '';
  let isRange = false;
  let valMin = '';
  let valMax = '';

  if (tier && tier.values && tier.values.length > 0) {
    let targetRange: any = null;

    // 若為複合詞綴 (ids.length > 1)，必須依 statId 找出對應之數值區間
    if (Array.isArray(tier.ids) && tier.ids.length > 1 && statId) {
      let targetIdx = tier.ids.indexOf(statId);
      if (targetIdx === -1) {
        const rawStat = statId.includes('.') ? statId.split('.').pop()! : statId;
        targetIdx = tier.ids.findIndex(
          (id: string) => id === rawStat || id.endsWith(`.${rawStat}`),
        );
      }
      if (targetIdx !== -1 && tier.values[targetIdx]) {
        targetRange = tier.values[targetIdx];
      }
    }

    if (!targetRange) {
      if (tier.values.length === 2 && (!tier.ids || tier.ids.length <= 1)) {
        // 點數傷害 (flat damage: min damage roll & max damage roll)
        const range1 = tier.values[0];
        const range2 = tier.values[1];
        const min1 = Number(range1[0]);
        const max1 = range1.length === 2 ? Number(range1[1]) : Number(range1[0]);
        const min2 = Number(range2[0]);
        const max2 = range2.length === 2 ? Number(range2[1]) : Number(range2[0]);

        isRange = true;
        valMin = String((min1 + min2) / 2);
        valMax = String((max1 + max2) / 2);
        rangeText = ` (${valMin} ~ ${valMax})`;
        return { rangeText, valMin, valMax, isRange };
      }
      targetRange = tier.values[0];
    }

    if (targetRange && Array.isArray(targetRange)) {
      if (targetRange.length === 2) {
        isRange = true;
        valMin = String(targetRange[0]);
        valMax = String(targetRange[1]);
        rangeText = ` (${valMin} ~ ${valMax})`;
      } else if (targetRange.length === 1) {
        isRange = true;
        valMin = String(targetRange[0]);
        valMax = String(targetRange[0]);
        rangeText = ` (${valMin} ~ ${valMax})`;
      }
    }
  }

  // 若無數值，智慧識別隱性單一數值 1 (如 loads an additional bolt / 裝填額外1發弩箭 / has 1 socket)
  if (!valMin && !valMax && tier) {
    const en = typeof tier.key === 'string' ? tier.key : '';
    const zh = typeof tier.displayKey === 'string' ? tier.displayKey : '';
    const isSingleOne =
      /\b(?:an?)\s+additional\b/i.test(en) ||
      /\bhas\s+1\s+(?:abyssal\s+)?socket\b/i.test(en) ||
      /(?:額外.*?[1一個]|(?:1|一個)\s*個?額外)/.test(zh) ||
      /有\s*1\s*個.*插槽/.test(zh);

    if (isSingleOne) {
      valMin = '1';
      valMax = '1';
      isRange = true;
      rangeText = ` (${valMin} ~ ${valMax})`;
    }
  }

  return { rangeText, valMin, valMax, isRange };
}

/**
 * 依 statId 前綴對應目標 affinity：
 * - enchant. -> ['corrupted', 'enchant']
 * - rune. -> ['socketable', 'bonded']
 * - desecrated. -> ['desecrated']
 * - explicit. / 其他 -> ['normal']
 */
export function resolveTargetAffinitiesByStatId(
  statId?: string | null,
  version?: PoeVersion,
): string[] {
  return version
    ? getAffinityProfile(version).resolveTargetAffinities(statId)
    : commonAffinityProfile.resolveTargetAffinities(statId);
}

function hasTierValues(tier: any, statId?: string | null): boolean {
  if (Array.isArray(tier?.values) && tier.values.length > 0) return true;
  const parsed = parseTierValues(tier, statId);
  return Boolean(parsed.valMin || parsed.valMax);
}

/**
 * 依 Tier domain 規則收斂詞綴可用性：
 * 1. 單一 tier：只要有數值區間（包含非 normal 如 corrupted/desecrated 等），均視為具備 T 階資格，以支援單一數值填入
 * 2. 多個 tiers：依 statId 前綴對應目標 affinities 篩選候選 tiers（預設 normal），若為 desecrated 且找不到專屬階級則安全 fallback normal
 * 3. 若無有效 types 或單一 tier 且無數值區間，則不具備 T 階資格 (isEligible: false)
 */
export function resolveTierModEligibility(
  tiers: any[] | null | undefined,
  statId?: string | null,
  version?: PoeVersion,
): TierModEligibility {
  if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
    return { isEligible: false, normalTiers: [], availableTypes: [] };
  }

  // 1. 單一 tier：只要有數值區間，不論其 affinity 為何（包含非 normal 如 corrupted/desecrated 等），均視為具備 T 階資格，以支援單一數值填入
  if (tiers.length === 1) {
    const tier = tiers[0];
    const hasValue = hasTierValues(tier, statId);
    if (!hasValue) {
      return { isEligible: false, normalTiers: [], availableTypes: [] };
    }

    const availableTypeSet = new Set<string>();
    if (Array.isArray(tier?.types)) {
      for (const type of tier.types) {
        if (typeof type === 'string' && type.trim()) {
          availableTypeSet.add(type.trim());
        }
      }
    }

    const availableTypes = Array.from(availableTypeSet);
    if (availableTypes.length === 0) {
      return { isEligible: false, normalTiers: [tier], availableTypes: [] };
    }

    return {
      isEligible: true,
      normalTiers: [tier],
      availableTypes,
    };
  }

  // 2. 多個 tiers：依 statId 對應目標 affinities 篩選候選 tiers
  const targetAffinities = resolveTargetAffinitiesByStatId(statId, version);
  let candidateTiers = tiers.filter(
    (t) =>
      t &&
      Array.isArray(t.affinities) &&
      t.affinities.some((a: string) => targetAffinities.includes(a)),
  );
  if (candidateTiers.length === 0 && targetAffinities.includes('desecrated')) {
    candidateTiers = tiers.filter(
      (t) => t && Array.isArray(t.affinities) && t.affinities.includes('normal'),
    );
  } else if (candidateTiers.length === 0 && targetAffinities.includes('normal')) {
    // 若為明確詞綴 (explicit) 且無 normal 階級，但為特殊專屬詞綴，允許納入候選
    const specialAffinities = version
      ? getAffinityProfile(version).specialExplicitAffinities
      : commonAffinityProfile.specialExplicitAffinities;
    candidateTiers = tiers.filter(
      (t) =>
        t &&
        Array.isArray(t.affinities) &&
        t.affinities.some((a: string) => specialAffinities.has(a)),
    );
  }

  if (candidateTiers.length === 0) {
    return { isEligible: false, normalTiers: [], availableTypes: [] };
  }

  // 若候選只有 1 階，仍需具備數值區間
  if (candidateTiers.length === 1) {
    const tier = candidateTiers[0];
    const hasValue = hasTierValues(tier, statId);
    if (!hasValue) {
      return { isEligible: false, normalTiers: [], availableTypes: [] };
    }
  }

  const availableTypeSet = new Set<string>();
  for (const t of candidateTiers) {
    if (Array.isArray(t.types)) {
      for (const type of t.types) {
        if (typeof type === 'string' && type.trim()) {
          availableTypeSet.add(type.trim());
        }
      }
    }
  }

  const availableTypes = Array.from(availableTypeSet);
  if (availableTypes.length === 0) {
    return { isEligible: false, normalTiers: candidateTiers, availableTypes: [] };
  }

  return {
    isEligible: true,
    normalTiers: candidateTiers,
    availableTypes,
  };
}

/**
 * 依 category 過濾符合該物品類別的 normal tiers
 */
export function filterTiersByCategory(
  normalTiers: any[],
  category: string | null | undefined,
): any[] {
  if (!category || !Array.isArray(normalTiers)) return [];
  return normalTiers.filter((t) => t && Array.isArray(t.types) && t.types.includes(category));
}

export function createTierDomainService(version: PoeVersion): TierDomainService {
  let rawModsData: LexiconVersionHandle | null = null;

  return {
    async loadModsData(generation: number, isCurrentGeneration: (gen: number) => boolean) {
      try {
        await ensureAffixLexiconLoaded(version);
        if (!isCurrentGeneration(generation)) return null;
        rawModsData = { __lexiconVersion: version };
      } catch (e) {
        console.error('[PoeXD] 載入 content 詞綴資料失敗:', e);
      }
      return rawModsData;
    },

    findModTiersByStatId(statId: string, customRawMods?: any) {
      if (customRawMods !== undefined) {
        if (isModsTiersArtifact(customRawMods)) {
          setAffixLexiconMockData(version, customRawMods);
          return findModTiersFromLexicon(statId, version);
        }
        return findModTiersByStatId(statId, customRawMods);
      }
      if (rawModsData) {
        return findModTiersByStatId(statId, rawModsData);
      }
      return findModTiersFromLexicon(statId, version);
    },

    parseTierValues,

    resolveTierModEligibility(tiers, statId) {
      return resolveTierModEligibility(tiers, statId, version);
    },

    filterTiersByCategory,

    groupTiersByMod,

    getRawModsData() {
      return rawModsData;
    },

    reset() {
      rawModsData = null;
    },
  };
}
