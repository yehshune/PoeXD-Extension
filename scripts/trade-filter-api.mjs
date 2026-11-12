/**
 * 從官方市集 API（/api/{trade,trade2}/data/filters 與 /data/stats）產生各語系的篩選翻譯。
 *
 * 每個語系取自對應語言的官方市集網域，內容即玩家在該語言市集頁看到的文字；
 * 欄位以 API 的穩定 id 為 key，不依賴索引對齊。
 */

export const SCHEMA_VERSION = 3;

/** 各語系的官方市集網域 */
export const LOCALE_REALM_HOSTS = Object.freeze({
  en: 'www.pathofexile.com',
  'zh-TW': 'pathofexile.tw',
  'zh-CN': 'poe.game.qq.com',
  ja: 'jp.pathofexile.com',
  ko: 'poe.game.daum.net',
  ru: 'ru.pathofexile.com',
  de: 'de.pathofexile.com',
  fr: 'fr.pathofexile.com',
  es: 'es.pathofexile.com',
  pt: 'br.pathofexile.com',
  th: 'th.pathofexile.com',
});

export const GAME_VERSION_ROUTES = Object.freeze({ poe1: 'trade', poe2: 'trade2' });

/** en 是執行期的內建後備語系，必須成功產生 */
export const REQUIRED_LOCALES = Object.freeze(['en']);

/**
 * API 以 id: null 表示預設選項；部分預設值在查詢 JSON 中有明確的 option 值，需保留其翻譯。
 * 其餘 null 選項（例如「任何」）不會出現在查詢中，直接略過。
 */
const NULL_OPTION_IDS = Object.freeze({ sale_type: 'priced' });

const MIN_FIELD_COUNT = 10;

const buildDataUrl = (locale, gameVersion, resource) => {
  const host = LOCALE_REALM_HOSTS[locale];
  const route = GAME_VERSION_ROUTES[gameVersion];
  if (!host) throw new Error(`不支援的語系: ${locale}`);
  if (!route) throw new Error(`不支援的遊戲版本: ${gameVersion}`);
  return `https://${host}/api/${route}/data/${resource}`;
};

export const buildFiltersUrl = (locale, gameVersion) =>
  buildDataUrl(locale, gameVersion, 'filters');

export const buildStatsUrl = (locale, gameVersion) => buildDataUrl(locale, gameVersion, 'stats');

export const buildStaticUrl = (locale, gameVersion) => buildDataUrl(locale, gameVersion, 'static');

const cleanText = (text) =>
  typeof text === 'string' ? text.split('​')[0].replace(/\s+/g, ' ').trim() : '';

const assignUnique = (target, key, value, label) => {
  if (key in target && target[key] !== value) {
    throw new Error(`${label} 重複 id「${key}」且文字不同：${target[key]} / ${value}`);
  }
  target[key] = value;
};

const collectOptions = (filter) => {
  const options = {};
  const nullTexts = [];
  for (const option of filter.option?.options ?? []) {
    const text = cleanText(option?.text);
    if (!text) continue;
    if (option.id === null || option.id === undefined) nullTexts.push(text);
    else assignUnique(options, String(option.id), text, `${filter.id} 選項`);
  }
  // 各網域的預設選項不一致（例如國服 POE1 的 null 是「任何」、priced 另有明確選項），
  // 只有在沒有明確選項時才把 null 對應到查詢值
  const nullId = NULL_OPTION_IDS[filter.id];
  if (nullId && !(nullId in options) && nullTexts.length === 1) options[nullId] = nullTexts[0];
  return options;
};

/**
 * 從 stats API 回應取出 pseudo 偽屬性文字（詞綴字典只涵蓋實際詞綴，沒有 pseudo）。
 * 只收 pseudo 類別：完整 stats 清單每個語系超過 1MB，打包成本太高。
 * @param {{ result: Array<{ id: string, entries?: Array<{ id: string, text?: string }> }> }} response
 */
export const extractPseudoStats = (response) => {
  const group = Array.isArray(response?.result)
    ? response.result.find((entry) => entry?.id === 'pseudo')
    : undefined;
  if (!group || !Array.isArray(group.entries)) throw new Error('stats API 回應缺少 pseudo 群組');
  const stats = {};
  for (const entry of group.entries) {
    const text = cleanText(entry?.text);
    if (typeof entry?.id === 'string' && text) assignUnique(stats, entry.id, text, 'pseudo stat');
  }
  return stats;
};

/**
 * 將 filters API（與可選的 stats API）回應轉成擴充功能使用的篩選翻譯檔。
 * @param {{ result: Array<{ id: string, title?: string, filters?: any[] }> }} response
 */
export const buildArtifactFromApi = (response, { gameVersion, locale, statsResponse }) => {
  if (!Array.isArray(response?.result)) throw new Error('filters API 回應缺少 result 陣列');

  const groups = {};
  const fields = {};
  const options = {};
  for (const group of response.result) {
    if (typeof group?.id !== 'string') throw new Error('filters API 群組缺少 id');
    const title = cleanText(group.title);
    if (title) assignUnique(groups, group.id, title, '群組');

    for (const filter of group.filters ?? []) {
      if (typeof filter?.id !== 'string') throw new Error(`${group.id} 的欄位缺少 id`);
      const text = cleanText(filter.text);
      if (text) assignUnique(fields, filter.id, text, '欄位');
      const filterOptions = collectOptions(filter);
      if (Object.keys(filterOptions).length > 0) options[filter.id] = filterOptions;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    gameVersion,
    locale,
    source: LOCALE_REALM_HOSTS[locale],
    groups,
    fields,
    options,
    ...(statsResponse ? { pseudoStats: extractPseudoStats(statsResponse) } : {}),
  };
};

/**
 * 確認產物足以使用，並檢查回應語系：非 en 語系若與 en 文字完全相同，代表網域回傳了英文（例如被導回國際服）。
 */
export const validateArtifact = (artifact, englishArtifact) => {
  const groupCount = Object.keys(artifact.groups).length;
  const fieldCount = Object.keys(artifact.fields).length;
  if (groupCount === 0) throw new Error(`${artifact.locale} 沒有任何群組標題`);
  if (fieldCount < MIN_FIELD_COUNT) {
    throw new Error(`${artifact.locale} 欄位只有 ${fieldCount} 個，少於 ${MIN_FIELD_COUNT}`);
  }
  if (englishArtifact && artifact.locale !== 'en') {
    const sameAsEnglish =
      JSON.stringify(artifact.groups) === JSON.stringify(englishArtifact.groups) &&
      JSON.stringify(artifact.fields) === JSON.stringify(englishArtifact.fields);
    if (sameAsEnglish) throw new Error(`${artifact.locale} 的內容與 en 完全相同，網域可能回傳英文`);
  }
  return artifact;
};

export const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
