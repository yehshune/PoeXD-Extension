import { computed, ref, shallowRef } from 'vue';
import {
  readSnapshotItem,
  readSnapshotStatGroup,
  type CriteriaOverlayFormSnapshot,
  type CriteriaOverlayItem,
} from '@/utils/criteria-overlay';
import { getMercenaryCatalog, type MercenaryCatalog } from '@/utils/mercenary-data';
import {
  buildMercenaryCountGroup,
  buildMercenaryExcludeGroup,
  buildMercenaryRequireGroup,
  buildMercenaryStatGroup,
  listBuildSkills,
  listSkillSupportFamilies,
  MERCENARY_GROUP_TYPE,
  MERCENARY_SUPPORT_RANGE,
  MERCENARY_WARRANT_DISC,
  mercenarySelectionHints,
  mercenarySkillNotGuaranteed,
  parseMercenaryStatGroup,
  type MercenaryBuildSkill,
  type MercenaryGroupKind,
  type MercenarySkillRole,
  type MercenaryTier,
} from '@/utils/mercenary-query';
import type { CriteriaOverlayManager } from '../criteria-overlay-manager';

/** edit：改寫被點擊的那個群組（單一技能）；batch：一次新增多個群組。 */
export type MercenaryPickerMode = 'edit' | 'batch';

export interface MercenaryPickerDeps {
  manager: Pick<CriteriaOverlayManager, 'readFormSnapshot' | 'replaceStatGroup' | 'overlay'>;
  loadCatalog?: () => Promise<MercenaryCatalog>;
  /** 英文名稱目錄，讓 Build 搜尋也能比對英文；未提供且有自訂 loadCatalog 時不載入。 */
  loadEnglishCatalog?: () => Promise<MercenaryCatalog>;
}

export interface MercenaryBuildOption {
  index: number;
  name: string;
  /** 搜尋比對用的小寫字串（目前語系名稱、英文名稱、trade type）。 */
  keywords: string[];
}

/** 單一技能的選擇狀態；minTouched 為 false 時「至少符合」隨勾選自動調整。 */
export interface MercenarySkillDraft {
  picks: Record<string, MercenaryTier>;
  minSupports: number;
  minTouched: boolean;
}

const ROLE_ORDER: readonly MercenarySkillRole[] = ['core', 'main', 'utility'];

/** 傭兵技能選擇器的狀態與操作；對話框只負責呈現。 */
export function useMercenaryPicker(deps: MercenaryPickerDeps) {
  const loadCatalog = deps.loadCatalog ?? (() => getMercenaryCatalog());
  const loadEnglishCatalog =
    deps.loadEnglishCatalog ?? (deps.loadCatalog ? null : () => getMercenaryCatalog(['en']));

  const catalog = shallowRef<MercenaryCatalog | null>(null);
  const englishCatalog = shallowRef<MercenaryCatalog | null>(null);
  const loading = ref(false);
  const loadFailed = ref(false);
  const mode = ref<MercenaryPickerMode>('edit');
  const groupIndex = ref(0);
  const pageItemType = ref<string | null>(null);

  const buildIndex = ref<number | null>(null);
  const applyBuildType = ref(true);
  const excludeWeak = ref(true);
  /** batch 模式產生的群組類型；edit 模式固定為 mercenary。 */
  const groupKind = ref<MercenaryGroupKind>('mercenary');
  /** count 群組至少要有幾個技能。 */
  const countMin = ref(1);
  /** 任選輔助時另加 `and` 群組確保有此技能。 */
  const requireSkill = ref(true);
  /** 頁面上啟用中的 `and` 群組已要求的 id，避免重複加入。 */
  const pageRequiredIds = shallowRef<ReadonlySet<string>>(new Set());
  const skillQuery = ref('');
  const drafts = ref<Record<number, MercenarySkillDraft>>({});
  const activeSkillIndex = ref<number | null>(null);

  const build = computed(() =>
    catalog.value && buildIndex.value !== null
      ? (catalog.value.builds[buildIndex.value] ?? null)
      : null,
  );
  const activeSkill = computed(() =>
    catalog.value && activeSkillIndex.value !== null
      ? (catalog.value.skills[activeSkillIndex.value] ?? null)
      : null,
  );
  const activeDraft = computed(() =>
    activeSkillIndex.value !== null ? (drafts.value[activeSkillIndex.value] ?? null) : null,
  );
  const selectedSkillIndices = computed(() => Object.keys(drafts.value).map(Number));

  const sortedBuilds = computed(() =>
    [...(catalog.value?.builds ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
  );

  const buildOptions = computed<MercenaryBuildOption[]>(() =>
    sortedBuilds.value.map((b) => ({
      index: b.index,
      name: b.name,
      keywords: [b.name, englishCatalog.value?.builds[b.index]?.name ?? '', b.tradeType]
        .filter((text) => text !== '')
        .map((text) => text.toLowerCase()),
    })),
  );

  const buildSkills = computed(() =>
    catalog.value && build.value ? listBuildSkills(catalog.value, build.value) : [],
  );

  /** 已選 Build 時依角色分組列出技能；未選 Build 時依搜尋字串列出全部技能。 */
  const skillSections = computed<
    Array<{ role: MercenarySkillRole | 'all'; count: number; skills: MercenaryBuildSkill[] }>
  >(() => {
    const current = catalog.value;
    if (!current) return [];
    const currentBuild = build.value;
    if (currentBuild) {
      const counts: Record<MercenarySkillRole, number> = {
        core: currentBuild.core.length,
        main: currentBuild.mainCount,
        utility: currentBuild.utilityCount,
      };
      return ROLE_ORDER.map((role) => ({
        role,
        count: counts[role],
        skills: buildSkills.value.filter((s) => s.role === role),
      })).filter((section) => section.skills.length > 0);
    }
    const query = skillQuery.value.trim().toLowerCase();
    const skills = current.skills
      .filter((s) => !query || s.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ skill: s, role: 'main' as const, weak: false }));
    return [{ role: 'all', count: skills.length, skills }];
  });

  const families = computed(() =>
    catalog.value && activeSkill.value
      ? listSkillSupportFamilies(catalog.value, activeSkill.value)
      : [],
  );

  const supportRange = computed(() =>
    activeSkill.value ? MERCENARY_SUPPORT_RANGE[activeSkill.value.slots] : ([0, 0] as const),
  );

  const pickedCount = computed(() => Object.keys(activeDraft.value?.picks ?? {}).length);

  function selectionOf(draft: MercenarySkillDraft) {
    return {
      supports: Object.entries(draft.picks).map(([family, minTier]) => ({ family, minTier })),
      minSupports: draft.minSupports,
    };
  }

  const hints = computed(() => {
    if (!activeSkill.value || !activeDraft.value) return [];
    return mercenarySelectionHints(
      activeSkill.value,
      families.value,
      selectionOf(activeDraft.value),
    );
  });

  /** 未勾選、但屬於此 Build 的較差技能（batch 模式可一併排除）。 */
  const excludableWeakSkills = computed(() =>
    buildSkills.value.filter((s) => s.weak && !(s.skill.index in drafts.value)).map((s) => s.skill),
  );

  const isMercenaryKind = computed(() => mode.value === 'edit' || groupKind.value === 'mercenary');

  const selectedSkills = computed(() =>
    selectedSkillIndices.value
      .map((index) => catalog.value?.skills[index])
      .filter((skill) => skill !== undefined),
  );

  /** 任選輔助、結果不一定有該技能的已選技能（不含頁面 `and` 群組已要求的）。 */
  const unguaranteedSkills = computed(() =>
    selectedSkills.value.filter(
      (skill) =>
        mercenarySkillNotGuaranteed(selectionOf(drafts.value[skill.index])) &&
        !pageRequiredIds.value.has(skill.tradeId),
    ),
  );

  const resultGroups = computed(() => {
    const current = catalog.value;
    if (!current) return [];
    const skills = selectedSkills.value;
    if (!isMercenaryKind.value) {
      if (skills.length === 0) return [];
      if (groupKind.value === 'and') return [buildMercenaryRequireGroup(skills)];
      if (groupKind.value === 'not') return [buildMercenaryExcludeGroup(skills)];
      return [buildMercenaryCountGroup(skills, countMin.value)];
    }
    const groups = skills.map((skill) =>
      buildMercenaryStatGroup(current, {
        skill: skill.index,
        ...selectionOf(drafts.value[skill.index]),
      }),
    );
    if (requireSkill.value && unguaranteedSkills.value.length > 0) {
      groups.push(buildMercenaryRequireGroup(unguaranteedSkills.value));
    }
    if (mode.value === 'batch' && excludeWeak.value && excludableWeakSkills.value.length > 0) {
      groups.push(buildMercenaryExcludeGroup(excludableWeakSkills.value));
    }
    return groups;
  });

  const canApply = computed(() => selectedSkillIndices.value.length > 0);

  const itemToApply = computed<CriteriaOverlayItem | undefined>(() => {
    if (!build.value || !applyBuildType.value || build.value.tradeType === pageItemType.value) {
      return undefined;
    }
    return { name: null, type: build.value.tradeType, disc: MERCENARY_WARRANT_DISC, term: null };
  });

  const maxSupportsOf = (skillIndex: number) => {
    const skill = catalog.value?.skills[skillIndex];
    return skill ? MERCENARY_SUPPORT_RANGE[skill.slots][1] : 0;
  };

  function writeDraft(skillIndex: number, next: MercenarySkillDraft) {
    const picked = Object.keys(next.picks).length;
    const minSupports = next.minTouched
      ? Math.min(next.minSupports, picked)
      : Math.min(picked, maxSupportsOf(skillIndex));
    drafts.value = { ...drafts.value, [skillIndex]: { ...next, minSupports } };
  }

  function resetSelection() {
    drafts.value = {};
    activeSkillIndex.value = null;
  }

  function prefill(form: CriteriaOverlayFormSnapshot | null, current: MercenaryCatalog) {
    if (!form) return;
    const item = readSnapshotItem(form);
    const pageBuild =
      item.disc === MERCENARY_WARRANT_DISC && item.type
        ? current.buildByTradeType.get(item.type)
        : undefined;
    pageItemType.value = pageBuild ? pageBuild.tradeType : null;
    pageRequiredIds.value = new Set(
      (Array.isArray(form.stats) ? form.stats : []).flatMap((_, index) => {
        const group = readSnapshotStatGroup(form, index);
        return group && group.type === 'and' && !group.disabled
          ? group.filters.filter((f) => !f.disabled).map((f) => f.id)
          : [];
      }),
    );
    buildIndex.value = pageBuild?.index ?? null;

    if (mode.value !== 'edit') return;
    const group = readSnapshotStatGroup(form, groupIndex.value);
    const parsed =
      group && group.type === MERCENARY_GROUP_TYPE ? parseMercenaryStatGroup(current, group) : null;
    if (!parsed) return;
    drafts.value = {
      [parsed.skill]: {
        picks: Object.fromEntries(parsed.supports.map((p) => [p.family, p.minTier])),
        minSupports: parsed.minSupports,
        minTouched: true,
      },
    };
    activeSkillIndex.value = parsed.skill;
  }

  async function open(target: { mode: 'edit'; groupIndex: number } | { mode: 'batch' }) {
    mode.value = target.mode;
    groupIndex.value = target.mode === 'edit' ? target.groupIndex : 0;
    resetSelection();
    skillQuery.value = '';
    applyBuildType.value = true;
    excludeWeak.value = true;
    groupKind.value = 'mercenary';
    countMin.value = 1;
    requireSkill.value = true;
    pageRequiredIds.value = new Set();
    loadFailed.value = false;
    loading.value = true;
    try {
      const [current, form] = await Promise.all([
        // 每次開啟都依當前語系取目錄（已依語系快取），切換語言後名稱立即更新
        loadCatalog(),
        deps.manager.readFormSnapshot(),
      ]);
      catalog.value = current;
      prefill(form, current);
      if (loadEnglishCatalog && !englishCatalog.value) {
        loadEnglishCatalog().then(
          (english) => (englishCatalog.value = english),
          () => undefined,
        );
      }
    } catch {
      loadFailed.value = true;
    } finally {
      loading.value = false;
    }
  }

  function selectBuild(index: number | null) {
    if (buildIndex.value === index) return;
    buildIndex.value = index;
    if (index === null) return;
    // 換 Build 時移除不屬於新 Build 的技能
    const allowed = new Set(buildSkills.value.map((s) => s.skill.index));
    drafts.value = Object.fromEntries(
      Object.entries(drafts.value).filter(([key]) => allowed.has(Number(key))),
    );
    if (activeSkillIndex.value !== null && !allowed.has(activeSkillIndex.value)) {
      activeSkillIndex.value = null;
    }
  }

  /** 點擊技能：edit 模式改選這個技能；batch 模式加入並切換到它。 */
  function focusSkill(index: number) {
    if (mode.value === 'edit') {
      if (activeSkillIndex.value === index) return;
      drafts.value = {};
    }
    if (!(index in drafts.value)) {
      writeDraft(index, { picks: {}, minSupports: 0, minTouched: false });
    }
    activeSkillIndex.value = index;
  }

  /** batch 模式的技能勾選框。 */
  function toggleSkill(index: number, checked: boolean) {
    if (checked) {
      focusSkill(index);
      return;
    }
    const next = { ...drafts.value };
    delete next[index];
    drafts.value = next;
    if (activeSkillIndex.value === index) {
      const remaining = Object.keys(next).map(Number);
      activeSkillIndex.value = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }

  function updateActive(update: (draft: MercenarySkillDraft) => MercenarySkillDraft) {
    const index = activeSkillIndex.value;
    const draft = activeDraft.value;
    if (index === null || !draft) return;
    writeDraft(index, update(draft));
  }

  const defaultTierOf = (key: string): MercenaryTier => {
    const family = families.value.find((f) => f.key === key);
    return Math.min(3, family?.maxTier ?? 3) as MercenaryTier;
  };

  function toggleFamily(key: string, checked: boolean) {
    updateActive((draft) => {
      const picks = { ...draft.picks };
      if (checked) picks[key] = defaultTierOf(key);
      else delete picks[key];
      return { ...draft, picks };
    });
  }

  function setFamilyTier(key: string, tier: MercenaryTier) {
    updateActive((draft) =>
      key in draft.picks ? { ...draft, picks: { ...draft.picks, [key]: tier } } : draft,
    );
  }

  function selectAllFamilies(checked: boolean) {
    updateActive((draft) => ({
      ...draft,
      picks: checked
        ? Object.fromEntries(
            families.value.map((f) => [f.key, draft.picks[f.key] ?? defaultTierOf(f.key)]),
          )
        : {},
    }));
  }

  /** 把已勾選的輔助一起改成「至少 T{tier}」（家族沒有該階級時取其最高階）。 */
  function setAllTiers(tier: MercenaryTier) {
    updateActive((draft) => ({
      ...draft,
      picks: Object.fromEntries(Object.keys(draft.picks).map((key) => [key, tier])),
    }));
  }

  /** 切換 batch 群組類型；切到「排除」且尚未勾選時預先勾選此 Build 的較差技能。 */
  function setGroupKind(kind: MercenaryGroupKind) {
    groupKind.value = kind;
    if (kind === 'not' && selectedSkillIndices.value.length === 0) {
      const weak = buildSkills.value.filter((s) => s.weak).map((s) => s.skill.index);
      for (const index of weak) focusSkill(index);
    }
    countMin.value = Math.max(1, Math.min(countMin.value, selectedSkillIndices.value.length));
  }

  function setMinSupports(value: number) {
    updateActive((draft) => ({ ...draft, minSupports: value, minTouched: true }));
  }

  /** 快捷：全選、全部 T3、至少符合滿連數。 */
  function applyMaxLinksT3() {
    const max = supportRange.value[1];
    updateActive(() => ({
      picks: Object.fromEntries(families.value.map((f) => [f.key, 3 as MercenaryTier])),
      minSupports: max,
      minTouched: true,
    }));
  }

  async function apply(): Promise<boolean> {
    const current = catalog.value;
    if (!current || !canApply.value) return false;
    const groups = resultGroups.value;
    if (mode.value === 'edit') {
      const skill = activeSkill.value ?? current.skills[selectedSkillIndices.value[0]];
      return deps.manager.replaceStatGroup(groupIndex.value, groups, skill.name, itemToApply.value);
    }
    const sourceName = build.value?.name ?? selectedSkills.value[0].name;
    return deps.manager.overlay(
      {
        ...(itemToApply.value ? { item: itemToApply.value } : {}),
        statGroups: groups,
        fields: [],
        sectionDisabled: {},
      },
      sourceName,
    );
  }

  return {
    catalog,
    loading,
    loadFailed,
    mode,
    groupIndex,
    pageItemType,
    buildIndex,
    build,
    sortedBuilds,
    buildOptions,
    applyBuildType,
    groupKind,
    isMercenaryKind,
    countMin,
    requireSkill,
    unguaranteedSkills,
    selectedSkills,
    excludeWeak,
    excludableWeakSkills,
    skillQuery,
    skillSections,
    drafts,
    selectedSkillIndices,
    activeSkillIndex,
    activeSkill,
    activeDraft,
    families,
    supportRange,
    pickedCount,
    hints,
    resultGroups,
    canApply,
    itemToApply,
    open,
    selectBuild,
    focusSkill,
    toggleSkill,
    toggleFamily,
    setFamilyTier,
    selectAllFamilies,
    setAllTiers,
    setMinSupports,
    setGroupKind,
    applyMaxLinksT3,
    apply,
  };
}

export type MercenaryPicker = ReturnType<typeof useMercenaryPicker>;
