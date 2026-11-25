export const POE_CDN_IMAGE_URL_MAX_LENGTH = 4096;

/** 官方 CDN 上的金幣圖示（即時直購手續費顯示用） */
export const GOLD_COIN_ICON_URL =
  'https://web.poecdn.com/image/Art/2DItems/Currency/Ruthless/CoinPileTier2.png';

export const ALLOWED_POE_CDN_HOSTNAMES = Object.freeze([
  'web.poecdn.com',
  'webtw.poecdn.com',
  // 騰訊服交易市集的物品圖片 CDN
  'poecdn.game.qq.com',
] as const);

export function isValidPoeCdnImageUrl(urlValue: unknown): urlValue is string {
  if (
    typeof urlValue !== 'string' ||
    urlValue.length === 0 ||
    urlValue.length > POE_CDN_IMAGE_URL_MAX_LENGTH
  ) {
    return false;
  }
  try {
    const url = new URL(urlValue);
    return url.protocol === 'https:' && ALLOWED_POE_CDN_HOSTNAMES.includes(url.hostname as any);
  } catch {
    return false;
  }
}
