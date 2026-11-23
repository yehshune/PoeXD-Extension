/**
 * PoB 購物清單的物品圖片：poexd-data 的 `item-art.json`（遊戲資料表的「名稱 → 美術路徑、背包尺寸」）
 * 接上官方 CDN 的圖片網址。不再需要先開過搜尋、從結果擷取圖片。
 *
 * 各區服的市集都能載入國際服 CDN 的圖片，所以一律使用 `web.poecdn.com`。
 */
import type { PoeVersion } from './trade-context';

type BaseArt = readonly [string, number, number];
type UniqueArt = readonly [string] | readonly [string, number, number];

export interface ItemArtData {
  bases: Readonly<Record<string, BaseArt>>;
  uniques: Readonly<Record<string, UniqueArt>>;
}

export interface ItemArtImage {
  url: string;
  /** 背包格數 */
  width: number;
  height: number;
  /**
   * 圖片是橫排三格的 sprite 時，由下往上要疊的格子（從 0 起算）。藥劑是「外殼、玻璃背面、液體」，
   * 疊成 背面 → 液體 → 外殼；寶石是「符號、白色遮罩、晶體」，疊成 晶體 → 符號。
   */
  layers?: readonly number[];
}

/** sprite 的格數（遊戲的藥劑與寶石圖都是三格） */
export const SPRITE_FRAMES = 3;
const SPRITE_LAYERS: readonly (readonly [RegExp, readonly number[]])[] = [
  [/^Flasks\//, [1, 2, 0]],
  [/^Gems\//, [2, 0]],
];

export interface ItemArtQuery {
  kind: 'equipment' | 'unique' | 'gem';
  englishName: string;
  /** 傳奇的英文底材名稱；傳奇圖片缺尺寸或查不到時用 */
  artBase?: string;
}

const ART_CDN = 'https://web.poecdn.com/image/Art/2DItems/';
/** 轉換寶石（`Absolution of Inspiring`）沒有自己的物品，圖片沿用原寶石 */
const TRANSFIGURED_SUFFIX = / of [A-Z][A-Za-z' ]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseItemArt(value: unknown): ItemArtData | undefined {
  if (!isRecord(value) || !isRecord(value.bases) || !isRecord(value.uniques)) return undefined;
  return {
    bases: value.bases as ItemArtData['bases'],
    uniques: value.uniques as ItemArtData['uniques'],
  };
}

function imageOf(path: unknown, width: unknown, height: unknown): ItemArtImage | undefined {
  if (typeof path !== 'string' || !path) return undefined;
  const layers = SPRITE_LAYERS.find(([pattern]) => pattern.test(path))?.[1];
  return {
    url: `${ART_CDN}${path}.png`,
    width: typeof width === 'number' && width > 0 ? width : 1,
    height: typeof height === 'number' && height > 0 ? height : 1,
    ...(layers ? { layers } : {}),
  };
}

const baseImage = (art: ItemArtData, name: string | undefined): ItemArtImage | undefined => {
  const base = name && Object.hasOwn(art.bases, name) ? art.bases[name] : undefined;
  return base ? imageOf(base[0], base[1], base[2]) : undefined;
};

export function itemArtFor(art: ItemArtData, query: ItemArtQuery): ItemArtImage | undefined {
  if (query.kind === 'gem') {
    return (
      baseImage(art, query.englishName) ??
      baseImage(art, query.englishName.replace(TRANSFIGURED_SUFFIX, ''))
    );
  }
  if (query.kind === 'unique') {
    const unique = Object.hasOwn(art.uniques, query.englishName)
      ? art.uniques[query.englishName]
      : undefined;
    const base = baseImage(art, query.artBase);
    if (!unique) return base;
    return unique.length === 3
      ? imageOf(unique[0], unique[1], unique[2])
      : imageOf(unique[0], base?.width, base?.height);
  }
  return baseImage(art, query.englishName);
}

export const getItemArtAssetPath = (version: PoeVersion): string => `json/${version}/item-art.json`;

/** 載不到或格式不符時回傳 undefined（清單照常顯示，只是沒有圖片） */
export async function loadItemArt(
  loadJson: (path: string) => Promise<unknown>,
  version: PoeVersion,
): Promise<ItemArtData | undefined> {
  try {
    return parseItemArt(await loadJson(getItemArtAssetPath(version)));
  } catch {
    return undefined;
  }
}
