/**
 * Similar Item Search（找相似，ADR-0020）的 Similar Search Draft 型別。
 * 草稿從 Source Item 推導、只活在面板開著的期間，不寫進儲存（ADR-0008）。
 */
import type { PoeVersion } from '../trade-context';

/** 一個 stat 在草稿裡的角色：必要（and 群組）、參考（加權群組，計入 Similarity）、忽略 */
export type StatRole = 'required' | 'reference' | 'ignored';
export const STAT_ROLES: readonly StatRole[] = ['required', 'reference', 'ignored'];

/** 詞綴型態：預設不限（`explicit.` 涵蓋一般、破裂、工藝、褻瀆），可縮小到單一型態 */
export type StatDomainChoice = 'any' | 'fractured' | 'crafted' | 'desecrated';

/** 武器比較方式：總 DPS、物理 DPS、元素 DPS 或單次傷害 */
export type WeaponMode = 'dps' | 'pdps' | 'edps' | 'damage';
export const WEAPON_MODES: readonly WeaponMode[] = ['dps', 'pdps', 'edps', 'damage'];
export type WeaponModePreference = 'auto' | WeaponMode;

/** 以同基底或同類別搜尋 */
export type SimilarSearchScope = 'category' | 'base';
export const SIMILAR_SEARCH_SCOPES: readonly SimilarSearchScope[] = ['category', 'base'];

export type PropertyId = WeaponMode | 'aps' | 'crit' | 'ar' | 'ev' | 'es' | 'ward';

export const DEFAULT_SIMILAR_TOLERANCE = 80;
export const SIMILAR_TOLERANCE_BOUNDS = { min: 50, max: 100 } as const;

export interface DraftStat {
  /** 草稿內的穩定鍵：預設搜尋用的代碼（`explicit.stat_…`、`pseudo.…`、`implicit.stat_…`） */
  key: string;
  /** 實際搜尋用的代碼（套用型態縮小後） */
  id: string;
  /** 物品上的原文（多行合併時以 ` / ` 連接），供面板顯示 */
  text: string;
  /** Source Item 上的數值（合併時為加總）；負數代表越低越好 */
  value: number;
  /** 最好的階級（1 = T1）；沒有階級（工藝、固定詞綴）時省略 */
  tier?: number;
  role: StatRole;
  domain: StatDomainChoice;
  /** 可以選的型態；只有不限時省略 */
  domains?: readonly StatDomainChoice[];
  /** 依容忍度或使用者輸入的門檻：正數是下限、負數是上限；省略表示不設 */
  threshold?: number;
  /** 使用者改過門檻，容忍度變動時不再跟著調整 */
  customized: boolean;
  /** 合併成 pseudo 總和的條件 */
  pseudo: boolean;
}

export interface DraftProperty {
  id: PropertyId;
  value: number;
  enabled: boolean;
  threshold?: number;
  customized: boolean;
}

export interface SimilarSearchDraft {
  version: PoeVersion;
  /** 市集類別代碼（`armour.chest`、`weapon.onesword`…） */
  category: string;
  /** Source Item 的基底名稱（伺服器語言） */
  baseType: string;
  scope: SimilarSearchScope;
  /** 容忍度（百分比） */
  tolerance: number;
  /** 只有武器才有 */
  weaponMode?: WeaponMode;
  /** 販售狀態（`securable`、`available`…） */
  status: string;
  stats: DraftStat[];
  properties: DraftProperty[];
}

export interface SimilarSearchContext {
  version: PoeVersion;
  /** stat 代碼的英文市集寫法（`explicit.stat_…` → `+#% to Fire Resistance`），用來對 pseudo 總和 */
  englishStatText: (statId: string) => string | undefined;
  /** 目前頁面的販售狀態；省略時為直購 */
  status?: string;
  tolerance?: number;
  scope?: SimilarSearchScope;
  weaponMode?: WeaponModePreference;
}

export type SimilarSearchPhase = 'strict' | 'relaxed';

export interface SimilarSearchQueryOptions {
  phase: SimilarSearchPhase;
  /** 加權群組的總和下限（放寬搜尋時由執行流程調整） */
  weightMin?: number;
}

export interface SimilarSearchQuery {
  /** 官方 `/search` 的請求內容：`{ query, sort }` */
  body: Record<string, unknown>;
  /** 因複雜度上限而沒帶入的參考 stat 鍵 */
  dropped: string[];
}
