// 詞綴與前端狀態共享型別宣告

export interface ModTier {
  affinities: string[];
  generation_type: string;
  key: string;
  displayKey?: string;
  displayTemplate?: string;
  level: string;
  values: string[][];
  types: string[];
  id?: string;
  ids?: string[];
  officialId?: string;
  /** 市集數值與遊戲顯示正負相反（遊戲「減少 18%」、市集「增加 #%」填 -18） */
  tradeNegated?: boolean;
}

export interface ModGroup {
  id: string;
  officialId?: string;
  ids?: string[];
  key: string;
  displayKey?: string;
  displayTemplate?: string;
  details: string;
  tiers: ModTier[];
  generation_type: string;
  affinities: string[];
}

export interface CategoryGroup {
  affinity: string;
  label: string;
  prefixes: ModGroup[];
  suffixes: ModGroup[];
  all: ModGroup[];
  hasSplit: boolean;
  hasBothSplit?: boolean;
  hasOnlyPrefix?: boolean;
  hasOnlySuffix?: boolean;
  priority: number;
}

export interface SelectedModInfo {
  id: string;
  officialId?: string;
  ids?: string[];
  key: string;
  displayKey?: string;
  displayTemplate?: string;
  affinities: string[];
  min?: string;
  max?: string;
  mins?: string[];
  maxs?: string[];
  selectedTierIndex?: number;
}

export interface StatFilterModPayload {
  key: string;
  displayKey?: string;
  displayTemplate?: string;
  modGroup?: string;
  affinities?: string[];
  officialId?: string;
  id?: string;
  ids?: string[];
  tiers?: ModTier[];
}
