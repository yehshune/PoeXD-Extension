/**
 * 結果卡片的外部連結：PoEDB 物品頁。
 *
 * PoEDB 的頁面名稱是英文物品名去掉撇號、空白換成底線（例如 `Atziris_Acuity`），語系放在
 * 路徑第一段。
 */
import type { PoeVersion } from './trade-context';

const POEDB_ORIGINS: Readonly<Record<PoeVersion, string>> = {
  poe1: 'https://poedb.tw',
  poe2: 'https://poe2db.tw',
};
const POEDB_LANGUAGE_BY_UI_LOCALE: Readonly<Record<string, string>> = {
  'zh-TW': 'tw',
  'zh-CN': 'cn',
};
const POEDB_DEFAULT_LANGUAGE = 'us';

export function buildPoedbUrl(
  englishName: string,
  options: { version: PoeVersion; uiLocale: string },
): string {
  const language = POEDB_LANGUAGE_BY_UI_LOCALE[options.uiLocale] ?? POEDB_DEFAULT_LANGUAGE;
  const page = englishName.trim().replace(/['’]/g, '').replace(/\s+/g, '_');
  return `${POEDB_ORIGINS[options.version]}/${language}/${encodeURIComponent(page)}`;
}
