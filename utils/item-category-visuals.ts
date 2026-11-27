/**
 * 物品類別選擇器的視覺與雙欄排版輔助：
 * - 為防具屬性、珠寶顏色、藥劑類型等子選項提供語意色點（PoE 紅力／綠敏／藍智／青保護／紫召喚）。
 * - 將分組依估算視覺高度平衡分配到左右雙欄，縮短長清單捲動距離。
 */

export type CategoryDotTone = 'str' | 'dex' | 'int' | 'ward' | 'minion' | 'prismatic' | 'amber';

const DOT_TONE_CLASSES: Readonly<Record<CategoryDotTone, string>> = {
  str: 'bg-red-500 ring-1 ring-red-950/30',
  dex: 'bg-emerald-500 ring-1 ring-emerald-950/30',
  int: 'bg-blue-500 ring-1 ring-blue-950/30',
  ward: 'bg-cyan-400 ring-1 ring-cyan-950/30',
  minion: 'bg-purple-400 ring-1 ring-purple-950/30',
  prismatic: 'bg-gradient-to-tr from-red-400 via-amber-200 to-sky-400 ring-1 ring-black/25',
  amber: 'bg-amber-400 ring-1 ring-amber-950/30',
};

export function getCategoryDotToneClass(tone: CategoryDotTone): string {
  return DOT_TONE_CLASSES[tone];
}

const EXACT_SUB_DOTS: Readonly<Record<string, readonly CategoryDotTone[]>> = {
  // PoE 1 珠寶
  crimson_jewel: ['str'],
  viridian_jewel: ['dex'],
  cobalt_jewel: ['int'],
  prismatic_jewel: ['prismatic'],
  // PoE 2 珠寶
  ruby: ['str'],
  emerald: ['dex'],
  sapphire: ['int'],
  diamond: ['prismatic'],
  time_lost_ruby: ['str'],
  time_lost_emerald: ['dex'],
  time_lost_sapphire: ['int'],
  time_lost_diamond: ['prismatic'],
  // 藥劑
  'life-flask': ['str'],
  'mana-flask': ['int'],
  'hybrid-flask': ['str', 'int'],
  'utility-flask': ['ward'],
  'iron-flask': ['amber'],
};

/**
 * 依子類別鍵回傳語意色點（PoE 紅力／綠敏／藍智／青保護／紫召喚）。
 */
export function getCategoryColorDots(key: string): readonly CategoryDotTone[] {
  const exact = EXACT_SUB_DOTS[key];
  if (exact) return exact;

  if (key.endsWith('_str_dex_int')) return ['str', 'dex', 'int'];
  if (key.endsWith('_str_dex')) return ['str', 'dex'];
  if (key.endsWith('_str_int')) return ['str', 'int'];
  if (key.endsWith('_dex_int')) return ['dex', 'int'];
  if (key.endsWith('_str')) return ['str'];
  if (key.endsWith('_dex')) return ['dex'];
  if (key.endsWith('_int')) return ['int'];
  if (key.endsWith('_ward')) return ['ward'];
  if (key.endsWith('_minion')) return ['minion'];

  return [];
}

export interface GroupLayoutMeasurable {
  rows?: readonly unknown[];
  singleOptions?: readonly unknown[];
}

function estimateGroupVisualWeight(group: GroupLayoutMeasurable): number {
  const rowCount = group.rows?.length ?? 0;
  const singleCount = group.singleOptions?.length ?? 0;
  const singleRows = singleCount > 0 ? Math.ceil(singleCount / 3) : 0;
  return 1.2 + rowCount * 1.35 + singleRows * 1.1;
}

/**
 * 將物品類別分組依視覺高度權重平衡分配到左右兩欄，維持原本大致閱讀順序並最大化一屏可見度。
 */
export function splitTypeGroupsIntoColumns<T extends GroupLayoutMeasurable>(
  groups: readonly T[],
): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  let leftWeight = 0;
  let rightWeight = 0;

  for (const group of groups) {
    const weight = estimateGroupVisualWeight(group);
    if (leftWeight <= rightWeight) {
      left.push(group);
      leftWeight += weight;
    } else {
      right.push(group);
      rightWeight += weight;
    }
  }

  return [left, right];
}
