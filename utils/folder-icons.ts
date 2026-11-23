import { browser } from 'wxt/browser';
import folderIconsManifest from '../public/json/folder-icons/index.json';
import type { PoeVersion } from './trade-context';

export type FolderIconCategory = 'class' | 'item' | 'atlas';
export type FolderIconPickerTab = 'class' | 'item' | 'atlas' | 'general';

export interface FolderIconLabels {
  en: string;
  'zh-TW': string;
  'zh-CN': string;
}

export interface FolderImageIconEntry {
  id: string;
  category: FolderIconCategory;
  file: string;
  wide: boolean;
  games: PoeVersion[];
  labels: FolderIconLabels;
  ascendancyName?: string;
}

export const FOLDER_LUCIDE_ICONS = [
  { id: 'lucide:star', iconKey: 'star', labels: { en: 'Star', 'zh-TW': '星號', 'zh-CN': '星号' } },
  {
    id: 'lucide:zap',
    iconKey: 'zap',
    labels: { en: 'Live / Fast', 'zh-TW': '即時／搶購', 'zh-CN': '实时／抢购' },
  },
  {
    id: 'lucide:flame',
    iconKey: 'flame',
    labels: { en: 'Hot / Build', 'zh-TW': '熱門／流派', 'zh-CN': '热门／流派' },
  },
  {
    id: 'lucide:crown',
    iconKey: 'crown',
    labels: { en: 'Endgame', 'zh-TW': '終局／畢業', 'zh-CN': '终局／毕业' },
  },
  {
    id: 'lucide:gem',
    iconKey: 'gem',
    labels: { en: 'Valuable', 'zh-TW': '高價／寶石', 'zh-CN': '高价／宝石' },
  },
  {
    id: 'lucide:sword',
    iconKey: 'sword',
    labels: { en: 'Offense', 'zh-TW': '攻擊／武器', 'zh-CN': '攻击／武器' },
  },
  {
    id: 'lucide:shield',
    iconKey: 'shield',
    labels: { en: 'Defense', 'zh-TW': '防禦／生存', 'zh-CN': '防御／生存' },
  },
  {
    id: 'lucide:sparkles',
    iconKey: 'sparkles',
    labels: { en: 'Crafting', 'zh-TW': '工藝／製作', 'zh-CN': '工艺／制作' },
  },
  {
    id: 'lucide:scroll',
    iconKey: 'scroll',
    labels: { en: 'Shopping List', 'zh-TW': '清單／計畫', 'zh-CN': '清单／计划' },
  },
  {
    id: 'lucide:target',
    iconKey: 'target',
    labels: { en: 'Target', 'zh-TW': '目標追蹤', 'zh-CN': '目标追踪' },
  },
  {
    id: 'lucide:tag',
    iconKey: 'tag',
    labels: { en: 'Tag', 'zh-TW': '標籤分類', 'zh-CN': '标签分类' },
  },
  {
    id: 'lucide:heart',
    iconKey: 'heart',
    labels: { en: 'Favorite', 'zh-TW': '最愛', 'zh-CN': '收藏' },
  },
] as const;

export type FolderLucideIconId = (typeof FOLDER_LUCIDE_ICONS)[number]['id'];
export type FolderLucideIconKey = (typeof FOLDER_LUCIDE_ICONS)[number]['iconKey'];

export const FOLDER_COLORS = [
  {
    id: 'amber',
    swatch: '#f59e0b',
    textClass: 'text-amber-400',
    labels: { en: 'Amber', 'zh-TW': '琥珀金', 'zh-CN': '琥珀金' },
  },
  {
    id: 'red',
    swatch: '#ef4444',
    textClass: 'text-red-400',
    labels: { en: 'Crimson', 'zh-TW': '緋紅', 'zh-CN': '绯红' },
  },
  {
    id: 'rose',
    swatch: '#f43f5e',
    textClass: 'text-rose-400',
    labels: { en: 'Rose', 'zh-TW': '玫瑰紅', 'zh-CN': '玫瑰红' },
  },
  {
    id: 'purple',
    swatch: '#a855f7',
    textClass: 'text-purple-400',
    labels: { en: 'Purple', 'zh-TW': '紫羅蘭', 'zh-CN': '紫罗兰' },
  },
  {
    id: 'blue',
    swatch: '#3b82f6',
    textClass: 'text-blue-400',
    labels: { en: 'Blue', 'zh-TW': '寶藍', 'zh-CN': '宝蓝' },
  },
  {
    id: 'cyan',
    swatch: '#06b6d4',
    textClass: 'text-cyan-400',
    labels: { en: 'Cyan', 'zh-TW': '青藍', 'zh-CN': '青蓝' },
  },
  {
    id: 'emerald',
    swatch: '#10b981',
    textClass: 'text-emerald-400',
    labels: { en: 'Emerald', 'zh-TW': '翡翠綠', 'zh-CN': '翡翠绿' },
  },
  {
    id: 'lime',
    swatch: '#84cc16',
    textClass: 'text-lime-400',
    labels: { en: 'Lime', 'zh-TW': '嫩綠', 'zh-CN': '嫩绿' },
  },
] as const;

export type FolderColorId = (typeof FOLDER_COLORS)[number]['id'];

const IMAGE_ICONS = folderIconsManifest.icons as FolderImageIconEntry[];
const IMAGE_ICON_BY_ID = new Map<string, FolderImageIconEntry>(
  IMAGE_ICONS.map((entry) => [entry.id, entry]),
);
const LUCIDE_ICON_BY_ID = new Map<string, (typeof FOLDER_LUCIDE_ICONS)[number]>(
  FOLDER_LUCIDE_ICONS.map((entry) => [entry.id, entry]),
);
const COLOR_BY_ID = new Map<string, (typeof FOLDER_COLORS)[number]>(
  FOLDER_COLORS.map((entry) => [entry.id, entry]),
);

const MAX_ICON_ID_LENGTH = 80;

export function normalizeFolderIcon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ICON_ID_LENGTH) return undefined;
  // 忽略舊版或 TFT 匯入預設值
  if (trimmed === 'TFT') return undefined;
  if (IMAGE_ICON_BY_ID.has(trimmed) || LUCIDE_ICON_BY_ID.has(trimmed)) {
    return trimmed;
  }
  return undefined;
}

export function normalizeFolderColor(value: unknown): FolderColorId | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return COLOR_BY_ID.has(trimmed) ? (trimmed as FolderColorId) : undefined;
}

export function getFolderImageIcons(
  category: FolderIconCategory,
  gameVersion: PoeVersion,
): FolderImageIconEntry[] {
  return IMAGE_ICONS.filter(
    (entry) => entry.category === category && entry.games.includes(gameVersion),
  );
}

export function resolveFolderImageUrl(file: string): string {
  const path = `/json/folder-icons/${file}`;
  try {
    if (typeof browser?.runtime?.getURL === 'function') {
      return browser.runtime.getURL(path as any);
    }
  } catch {
    // 測試或非擴充環境退回相對路徑
  }
  return path;
}

export type ResolvedFolderIcon =
  | { kind: 'image'; id: string; url: string; wide: boolean; labels: FolderIconLabels }
  | {
      kind: 'lucide';
      id: FolderLucideIconId;
      iconKey: FolderLucideIconKey;
      labels: FolderIconLabels;
    };

export function resolveFolderIcon(iconId: string | undefined): ResolvedFolderIcon | undefined {
  const normalized = normalizeFolderIcon(iconId);
  if (!normalized) return undefined;
  const image = IMAGE_ICON_BY_ID.get(normalized);
  if (image) {
    return {
      kind: 'image',
      id: image.id,
      url: resolveFolderImageUrl(image.file),
      wide: image.wide,
      labels: image.labels,
    };
  }
  const lucide = LUCIDE_ICON_BY_ID.get(normalized);
  if (lucide) {
    return {
      kind: 'lucide',
      id: lucide.id,
      iconKey: lucide.iconKey,
      labels: lucide.labels,
    };
  }
  return undefined;
}

export function getFolderColorSpec(colorId: string | undefined) {
  const normalized = normalizeFolderColor(colorId);
  return normalized ? COLOR_BY_ID.get(normalized) : undefined;
}

export function getFolderIconLabel(labels: FolderIconLabels, locale: string): string {
  if (locale === 'zh-TW') return labels['zh-TW'];
  if (locale === 'zh-CN') return labels['zh-CN'];
  return labels.en;
}

/**
 * 依遊戲版本與 PoB 解析出的昇華／職業名稱，尋找對應的資料夾圖示 ID。
 * 優先比對昇華（如 `Slayer`、`Invoker`），找不到時退回基礎職業（如 `Duelist`、`Monk`）。
 */
export function findAscendancyFolderIcon(
  gameVersion: PoeVersion,
  ascendancyName: string | undefined,
  className?: string,
): string | undefined {
  const candidates = getFolderImageIcons('class', gameVersion);
  const normalizeName = (name: string | undefined) =>
    (name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  const ascNorm = normalizeName(ascendancyName);
  const ascAlias = ascNorm === 'raider' ? 'warden' : ascNorm;
  if (ascAlias && ascAlias !== 'none') {
    const matched = candidates.find(
      (entry) => entry.id.includes(':asc:') && normalizeName(entry.ascendancyName) === ascAlias,
    );
    if (matched) return matched.id;
  }

  const classNorm = normalizeName(className);
  if (classNorm && classNorm !== 'none') {
    const matched = candidates.find(
      (entry) => entry.id.includes(':class:') && normalizeName(entry.ascendancyName) === classNorm,
    );
    if (matched) return matched.id;
  }

  return undefined;
}

/**
 * 將 PoB 的英文昇華或職業名稱翻譯為指定語系名稱（如 `Chieftain` → `酋長`）。
 * 若找不到對應項目則回傳原始名稱。
 */
export function localizeAscendancyOrClassName(
  gameVersion: PoeVersion,
  ascendancyName: string | undefined,
  className: string | undefined,
  locale: string,
): string {
  const iconId = findAscendancyFolderIcon(gameVersion, ascendancyName, className);
  if (iconId) {
    const entry = IMAGE_ICON_BY_ID.get(iconId);
    if (entry) return getFolderIconLabel(entry.labels, locale);
  }
  // PoE 1 舊版 PoB 可能仍寫 Raider，對應至新版昇華列或舊譯名
  return (ascendancyName || className || '').trim();
}
