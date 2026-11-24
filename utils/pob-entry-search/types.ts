/**
 * PoB 單筆條目搜尋解析與草稿調整的共用型別與常數。
 */
import type { PobDefence } from '../pob-build';

/** 防禦條件在市集 query 裡的區塊：PoE 1 是護甲過濾，PoE 2 是裝備過濾 */
export type DefenceSection = 'armour_filters' | 'equipment_filters';

export interface EntryCategory {
  /** 市集的物品類別（`armour.helmet`、`accessory.ring`…） */
  id: string;
  /** 基底的防禦類型；飾品沒有 */
  defences?: PobDefence[];
  defenceSection?: DefenceSection;
}

/** 基底有的防禦與 PoB 算好的數值，供「防禦數值下限」使用 */
export interface EntryDefences {
  section: DefenceSection;
  values: Partial<Record<PobDefence, number>>;
}

/** build 整體設定與單件的稀有裝搜尋方式：基底（預設）或類別＋防禦類型 */
export type RareSearchMode = 'base' | 'category';
export const RARE_SEARCH_MODES: readonly RareSearchMode[] = ['base', 'category'];
export const DEFAULT_RARE_SEARCH: RareSearchMode = 'base';
/** 市集稀有度條件的「非傳奇」選項 */
export const NON_UNIQUE_RARITY = 'nonunique';
export const OFF_HAND_SLOT = /^Weapon 2(?: Swap)?$/;

export type ShoppingEntryKind = 'unique' | 'equipment' | 'gem';
export type ShoppingModKind = 'implicit' | 'enchant' | 'explicit' | 'crafted';

/** 一行詞綴對到的總和條件（pseudo）與它在總和裡的倍數（全抗算三次） */
export interface PseudoContribution {
  id: string;
  weight: number;
}

/** 一行詞綴對到的市集條件 */
export interface ShoppingStat {
  id: string;
  /** 這一行的數值（保留正負號） */
  value?: number;
  /** 選項型代碼的選項 */
  option?: number;
  /** 數值必須完全相同（永恆珠寶的種子編號、附魔） */
  exact?: boolean;
  /** 預設是否帶入搜尋 */
  defaultEnabled: boolean;
  pseudo?: readonly PseudoContribution[];
  /** 可以切換的網域前綴（含目前的；市集上這個代碼後綴有兩種以上前綴時才有） */
  domains?: readonly string[];
}

export interface ShoppingMod {
  /** PoB 的英文詞綴（或已翻成顯示語言的文字） */
  text: string;
  kind: ShoppingModKind;
  /** 對得到市集代碼時才有；沒有的行不能勾選 */
  stat?: ShoppingStat;
  /** 這一行目前有帶入搜尋條件（套用使用者的選擇後） */
  searched: boolean;
}

/** 寶石品質在市集 query 裡的區塊：PoE 1 是雜項過濾，PoE 2 是類型過濾 */
export type GemQualitySection = 'misc_filters' | 'type_filters';

/** 寶石實際帶入搜尋的下限；不限的欄位省略 */
export interface GemFilters {
  level?: number;
  quality?: number;
  /** PoE 2 寶石的輔助寶石插槽數 */
  sockets?: number;
}

/** 使用者對單一條件的調整；min / max 為 null 表示清掉該邊界 */
export interface StatSelection {
  enabled?: boolean;
  /** 改用的網域前綴（例如把 `explicit.stat_1` 換成 `fractured.stat_1`） */
  domain?: string;
  min?: number | null;
  max?: number | null;
}

/** 使用者對一個項目的搜尋調整，存在本機 */
export interface EntrySearchSelection {
  /** 以 PoB 對到的市集代碼為鍵（切換網域後仍用原代碼）：同一個代碼的多行是同一個條件 */
  stats?: Readonly<Record<string, StatSelection>>;
  /** 設定時改為「至少符合 N 項」 */
  countMin?: number;
  /** 抗性、生命、能力值合併成總和條件；省略時依 build 整體設定 */
  pseudo?: boolean;
  /** 單件的連結條件：數字為連結數下限，null 為不限；省略時依 build 整體設定 */
  links?: number | null;
  /** 單件的稀有裝搜尋方式；省略時依 build 整體設定 */
  searchBy?: RareSearchMode;
  /** 寶石的等級／品質下限：數字為下限，null 為不限；省略時用 PoB 的數值 */
  gemLevel?: number | null;
  gemQuality?: number | null;
  /** PoE 2 寶石的插槽數下限：數字為下限，null 為不限；省略時用 PoB 連結的輔助寶石數 */
  gemSockets?: number | null;
}

/** 寶石等級與品質下限可以設定的範圍 */
export const MAX_GEM_LEVEL = 40;
export const MAX_GEM_QUALITY = 100;
/** PoE 2 技能寶石最多的輔助寶石插槽數 */
export const MAX_GEM_SOCKETS = 6;

/** build 整體設定的連結條件：照 PoB（五連以上）、只帶六連、一律不帶 */
export type LinkPolicy = 'pob' | 'six' | 'none';
export const LINK_POLICIES: readonly LinkPolicy[] = ['pob', 'six', 'none'];
/** 詞綴數值下限可選的比例（原數值的百分比） */
export const STAT_PERCENT_OPTIONS: readonly number[] = [100, 90, 80, 70, 60, 50];
export const DEFAULT_STAT_PERCENT = 80;
export const DEFAULT_LINK_POLICY: LinkPolicy = 'pob';
/** 單件可以選的連結數下限 */
export const LINK_OPTIONS: readonly number[] = [5, 6];
/** 臟器合成項目預設「至少符合 1 項」 */
export const VISCERA_BUNDLE_COUNT_MIN = 1;

/** 一份 build 的整體搜尋設定；只存和預設不同的欄位，單件調整優先 */
export interface BuildSearchDefaults {
  /** 沒調整過的詞綴下限取原數值的幾 %（預設 80） */
  statPercent?: number;
  links?: LinkPolicy;
  /** 稀有裝（非傳奇）以基底或類別＋防禦類型搜尋 */
  rareSearch?: RareSearchMode;
  /** 防具帶入基底防禦的數值下限（依詞綴數值比例） */
  defenceMin?: boolean;
  /** 抗性、生命、能力值預設改用總和條件 */
  pseudo?: boolean;
}

/** 介面顯示的一個條件：同一個代碼的多行已合併 */
export interface ShoppingStatFilter {
  /** 搜尋用的代碼（套用使用者切換的網域） */
  id: string;
  /** PoB 對到的原代碼，也是使用者調整的鍵 */
  key: string;
  /** 可以切換的網域前綴；只有一種時省略 */
  domains?: readonly string[];
  /** 合併後的數值；選項型與沒有數值的條件省略 */
  value?: number;
  option?: number;
  enabled: boolean;
  min?: number;
  max?: number;
  /** 使用者改過這個條件 */
  customized: boolean;
}

/** `resolveEntrySearch` 所需的條目欄位子集 */
export interface EntrySearchTarget {
  kind?: ShoppingEntryKind;
  mods?: readonly ShoppingMod[];
  searchBase: Record<string, unknown> | null;
  visceraBundle?: true;
  visceraPart?: string;
  links?: number;
  category?: EntryCategory;
  defences?: EntryDefences;
  level?: number;
  quality?: number;
  gemSockets?: number;
  gemQualitySection?: GemQualitySection;
}

/** `resolveEntrySearch` 一次解析出的完整搜尋狀態 */
export interface ResolvedEntrySearch {
  /** 套用選擇後的詞綴清單（只更新 `searched`，保留原文字）；項目無詞綴時省略 */
  mods?: ShoppingMod[];
  /** 合併同代碼多行並套用選擇後的條件清單 */
  filters: ShoppingStatFilter[];
  /** 參與「至少符合 N 項」的已啟用條件數（已涵蓋合成臟器例外） */
  countableFilterCount: number;
  /** 實際套用的「至少符合 N 項」；未設定時為全部符合 */
  countMin?: number;
  /** 是否改用總和條件 */
  pseudo: boolean;
  /** 實際帶入搜尋的連結數下限；不限時省略 */
  linksMin?: number;
  /** 實際的搜尋方式（沒有類別的項目一律是基底） */
  searchBy: RareSearchMode;
  /** 寶石實際帶入搜尋的等級／品質／插槽數下限；不限時省略 */
  gemLevelMin?: number;
  gemQualityMin?: number;
  gemSocketsMin?: number;
  /** 官方市集的 query 物件；無法搜尋時為 null */
  query: Record<string, unknown> | null;
}

export interface SelectionRowSnapshot extends EntrySearchTarget {
  filters?: readonly ShoppingStatFilter[];
  countMin?: number;
  pseudo?: boolean;
  /** 實際帶入搜尋的連結數下限 */
  linksMin?: number;
  /** 實際的搜尋方式 */
  searchBy?: RareSearchMode;
  /** 寶石實際帶入的等級／品質／插槽數下限 */
  gemLevelMin?: number;
  gemQualityMin?: number;
  gemSocketsMin?: number;
  searchSelection?: EntrySearchSelection;
}
