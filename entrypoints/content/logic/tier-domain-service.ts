import { getTradeMapping } from '@/components/sidebar/mapping-registry';
import { type PoeVersion } from '@/utils/trade-context';
import {
  formatSubtypeModGroupId,
  resolveSubTypeLabelsMap,
  resolveVirtualContainerSubKeys,
} from '@/utils/item-category-hierarchy';
import {
  getAffinityProfile,
  commonAffinityProfile,
  resolveTierPrimaryAffinity,
  formatAffinityModGroupId,
  getAffinityDisplayName,
  getAffinityPriority,
} from '@/utils/affinity-registry';
import {
  ensureAffixLexiconLoaded,
  findModTiersByStatId as findModTiersFromLexicon,
  formatAffixDisplayText,
  getCandidateStatIds,
  isModsTiersArtifact,
  setAffixLexiconMockData,
} from '@/utils/affix-lexicon';
import { negateBounds } from '@/utils/trade-value-sign';

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
  groupTiersByMod(filteredTiers: any[], category?: string | null): TierModGroup[];
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
  affinity?: string;
  affinityLabel?: string;
  tiers: any[];
}

function shouldSplitSubtypeBuckets(
  buckets: ReadonlyArray<{ matchedKeys: readonly string[]; tiers: readonly any[] }>,
): boolean {
  const nonEmpty = buckets.filter((b) => b.matchedKeys.length > 0);
  if (nonEmpty.length < 2) return false;
  // 僅在子類別集合彼此互斥，或同組內存在重複等級（不同子類各有獨立階級池）時才拆組
  const hasDisjointPair = nonEmpty.some((a, i) =>
    nonEmpty.slice(i + 1).some((b) => a.matchedKeys.every((k) => !b.matchedKeys.includes(k))),
  );
  if (hasDisjointPair) return true;
  const allLevels = buckets.flatMap((b) =>
    b.tiers.map((t) => (t?.level != null ? String(t.level) : null)).filter(Boolean),
  );
  return new Set(allLevels).size < allLevels.length;
}

/**
 * 依詞綴（displayTemplate 或 key）、來源類別 (affinity) 與互斥子類別池將 tiers 進行分組，純粹詞綴優先排在首位
 */
export function groupTiersByMod(
  filteredTiers: any[],
  version?: PoeVersion,
  category?: string | null,
): TierModGroup[] {
  if (!Array.isArray(filteredTiers) || filteredTiers.length === 0) return [];

  const distinctAffinities = new Set<string>();
  for (const tier of filteredTiers) {
    distinctAffinities.add(resolveTierPrimaryAffinity(tier?.affinities));
  }
  const splitByAffinity = distinctAffinities.size > 1;
  const mapping = getTradeMapping(version ?? 'poe1');
  const subTypeInfo = resolveSubTypeLabelsMap(mapping.typeRowConfigs, mapping.typeNames, category);
  const subLabelsMap = subTypeInfo?.subLabels ?? null;
  const subKeyOrder = subLabelsMap ? Object.keys(subLabelsMap) : [];

  const groupsMap = new Map<string, { templateKey: string; affinity?: string; tiers: any[] }>();
  for (const tier of filteredTiers) {
    const templateKey = (tier && (tier.displayTemplate || tier.displayKey || tier.key)) || '';
    const affinity = splitByAffinity ? resolveTierPrimaryAffinity(tier?.affinities) : undefined;
    const mapKey = affinity ? formatAffinityModGroupId(affinity, templateKey) : templateKey;
    if (!groupsMap.has(mapKey)) {
      groupsMap.set(mapKey, { templateKey, affinity, tiers: [] });
    }
    groupsMap.get(mapKey)!.tiers.push(tier);
  }

  const sortableGroups: Array<{ group: TierModGroup; subOrder: number }> = [];
  for (const [mapKey, entry] of groupsMap.entries()) {
    const { templateKey, affinity, tiers } = entry;
    const isPure = !templateKey.includes('|||||');
    const label = formatAffixDisplayText(templateKey);
    const affName = affinity ? getAffinityDisplayName(affinity, version) : undefined;

    if (subKeyOrder.length > 0 && tiers.length > 1) {
      const subBuckets = new Map<
        string,
        { matchedKeys: string[]; subOrder: number; tiers: any[] }
      >();

      for (const tier of tiers) {
        const matchedKeys = subKeyOrder.filter(
          (sk) => Array.isArray(tier?.types) && tier.types.includes(sk),
        );
        const sig = matchedKeys.join('|');
        if (!subBuckets.has(sig)) {
          subBuckets.set(sig, {
            matchedKeys,
            subOrder: matchedKeys.length > 0 ? subKeyOrder.indexOf(matchedKeys[0]) : 999,
            tiers: [],
          });
        }
        subBuckets.get(sig)!.tiers.push(tier);
      }

      if (shouldSplitSubtypeBuckets(Array.from(subBuckets.values()))) {
        for (const [sig, bucket] of subBuckets.entries()) {
          const subtypeLabel =
            bucket.matchedKeys.length > 0
              ? bucket.matchedKeys.map((sk) => subLabelsMap![sk]).join(' / ')
              : subTypeInfo?.parentLabel;
          const badge =
            affName && subtypeLabel ? `${affName} · ${subtypeLabel}` : subtypeLabel || affName;
          sortableGroups.push({
            group: {
              id: formatSubtypeModGroupId(mapKey, sig),
              label,
              templateZh: templateKey,
              isPure,
              ...(affinity ? { affinity } : {}),
              ...(badge ? { affinityLabel: badge } : {}),
              tiers: bucket.tiers,
            },
            subOrder: bucket.subOrder,
          });
        }
        continue;
      }
    }

    sortableGroups.push({
      group: {
        id: mapKey,
        label,
        templateZh: templateKey,
        isPure,
        ...(affinity ? { affinity, affinityLabel: affName } : {}),
        tiers,
      },
      subOrder: 0,
    });
  }

  sortableGroups.sort((a, b) => {
    if (a.group.isPure && !b.group.isPure) return -1;
    if (!a.group.isPure && b.group.isPure) return 1;
    if (a.group.affinity && b.group.affinity && a.group.affinity !== b.group.affinity) {
      return (
        getAffinityPriority(a.group.affinity, version) -
        getAffinityPriority(b.group.affinity, version)
      );
    }
    if (a.subOrder !== b.subOrder) {
      return a.subOrder - b.subOrder;
    }
    return 0;
  });

  return sortableGroups.map((entry) => entry.group);
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

  if (tier?.tradeNegated && (valMin || valMax)) {
    const signed = negateBounds(valMin, valMax);
    valMin = signed.min;
    valMax = signed.max;
    rangeText = ` (${valMin} ~ ${valMax})`;
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
  const primaryTiers = tiers.filter(
    (t) =>
      t &&
      Array.isArray(t.affinities) &&
      t.affinities.some((a: string) => targetAffinities.includes(a)),
  );
  let candidateTiers = primaryTiers;
  if (candidateTiers.length === 0 && targetAffinities.includes('enchant')) {
    // 市集以附魔篩選星團珠寶詞綴，沒有專屬附魔階級時沿用星團階級
    candidateTiers = tiers.filter(
      (t) => t && Array.isArray(t.affinities) && t.affinities.includes('cluster'),
    );
  } else if (candidateTiers.length === 0 && targetAffinities.includes('desecrated')) {
    candidateTiers = tiers.filter(
      (t) => t && Array.isArray(t.affinities) && t.affinities.includes('normal'),
    );
  } else if (targetAffinities.includes('normal') && !statId?.startsWith('implicit.')) {
    // 若為明確詞綴 (explicit)，針對無 normal 階級或僅部分物品類別有 normal、其餘類別為特殊專屬詞綴者納入候選
    const specialAffinities = version
      ? getAffinityProfile(version).specialExplicitAffinities
      : commonAffinityProfile.specialExplicitAffinities;
    if (candidateTiers.length === 0) {
      candidateTiers = tiers.filter(
        (t) =>
          t &&
          Array.isArray(t.affinities) &&
          t.affinities.some((a: string) => specialAffinities.has(a)),
      );
    } else {
      const coveredTypes = new Set<string>();
      for (const t of primaryTiers) {
        if (Array.isArray(t.types)) {
          for (const type of t.types) {
            if (typeof type === 'string' && type.trim()) {
              coveredTypes.add(type.trim());
            }
          }
        }
      }
      const extraTiers: any[] = [];
      for (const t of tiers) {
        if (
          !t ||
          primaryTiers.includes(t) ||
          !Array.isArray(t.affinities) ||
          !t.affinities.some((a: string) => specialAffinities.has(a)) ||
          !Array.isArray(t.types)
        ) {
          continue;
        }
        const uncoveredTypes = t.types.filter(
          (type: string) =>
            typeof type === 'string' && type.trim() && !coveredTypes.has(type.trim()),
        );
        if (uncoveredTypes.length === 0) continue;
        extraTiers.push(
          uncoveredTypes.length === t.types.length ? t : { ...t, types: uncoveredTypes },
        );
      }
      if (extraTiers.length > 0) {
        candidateTiers = [...primaryTiers, ...extraTiers];
      }
    }
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
 * 依 category 過濾符合該物品類別的 normal tiers。
 * 虛擬容器父類（如「任何單手劍」）在資料裡沒有對應鍵，給定版本時改以其子類別展開比對。
 */
export function filterTiersByCategory(
  normalTiers: any[],
  category: string | null | undefined,
  version?: PoeVersion,
): any[] {
  if (!category || !Array.isArray(normalTiers)) return [];
  const virtualSubKeys = version
    ? resolveVirtualContainerSubKeys(getTradeMapping(version).typeRowConfigs, category)
    : [];
  const matchKeys = virtualSubKeys.length > 0 ? virtualSubKeys : [category];
  return normalTiers.filter(
    (t) => t && Array.isArray(t.types) && matchKeys.some((key) => t.types.includes(key)),
  );
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

    filterTiersByCategory(normalTiers, category) {
      return filterTiersByCategory(normalTiers, category, version);
    },

    groupTiersByMod(filteredTiers, category) {
      return groupTiersByMod(filteredTiers, version, category);
    },

    getRawModsData() {
      return rawModsData;
    },

    reset() {
      rawModsData = null;
    },
  };
}
