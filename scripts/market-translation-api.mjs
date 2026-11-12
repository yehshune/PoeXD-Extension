/**
 * 市集漢化（ADR-0012）的資料產物：從台服、國服官方來源產生國際服頁面要替換的中文。
 *
 * - 介面字串：官方 `translate.zh_TW.js` / `translate.zh_CN.js`（全域 `__` 字典），只當資料解析、不 eval。
 * - stats / static：各服 `/api/{trade,trade2}/data/{stats,static}`，以 API 的 id 對接，不做位置對位。
 *
 * 中文產物只保留國際服（en）存在的條目：執行期只會替換國際服回應裡的條目。
 */
import { LOCALE_REALM_HOSTS } from './trade-filter-api.mjs';

export const MARKET_SCHEMA_VERSION = 1;

/** 市集漢化的目標語系（國際服頁面要翻成的語言） */
export const MARKET_LOCALES = Object.freeze(['zh-TW', 'zh-CN']);

/** 各目標語系的官方介面字典（免登入的公開靜態檔） */
export const UI_DICTIONARY_SOURCES = Object.freeze({
  'zh-TW': 'https://webtw.poecdn.com/js/translate.zh_TW.js',
  'zh-CN': 'https://poecdn.game.qq.com/js/translate.zh_CN.js',
});

/** 內容相同的備援網址：騰訊 CDN 從海外連線時好時壞 */
const UI_DICTIONARY_MIRRORS = Object.freeze({
  'zh-CN': ['https://poe.game.qq.com/js/translate.zh_CN.js'],
});

/** 依序嘗試的介面字典網址（主網址在前）；產物的 `source` 一律記主網址 */
export const getUiDictionaryUrls = (locale) => {
  const primary = UI_DICTIONARY_SOURCES[locale];
  if (!primary) throw new Error(`不支援的市集漢化語系：${locale}`);
  return [primary, ...(UI_DICTIONARY_MIRRORS[locale] ?? [])];
};

const MIN_UI_STRING_COUNT = 1000;
const MIN_STATS_COUNT = 500;
const MIN_STATIC_COUNT = 300;
/** 中文產物與 en 相同的比例超過此值，代表網域回傳了英文（例如被導回國際服） */
const MAX_SAME_AS_ENGLISH_RATIO = 0.5;

// ── 介面字串 ──────────────────────────────────────────────

/** 單引號字串內容：一般字元或 `\` 跳脫序列 */
const QUOTED = String.raw`'((?:[^'\\]|\\.)*)'`;
const ASSIGNMENT_LINE = new RegExp(String.raw`^__\[${QUOTED}\]\s*=\s*${QUOTED};?$`);
const IGNORED_LINE = /^(?:var __ = \{\};|\/\/.*)?$/;

const unescapeQuoted = (text) =>
  text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, seq) => {
    if (seq === 'n') return '\n';
    if (seq === 't') return '\t';
    if (seq === 'r') return '\r';
    if (seq.length > 1) return String.fromCharCode(parseInt(seq.slice(1), 16));
    return seq;
  });

/**
 * 解析官方 translate.*.js；只接受 `__['鍵'] = '值';` 與檔頭宣告，其他任何內容都拒絕。
 * 官方未翻譯（值與鍵相同）或空值的條目略過，執行期自然保留英文。
 * @param {string} source
 * @returns {Record<string, string>}
 */
export const parseUiDictionary = (source) => {
  const strings = {};
  const lines = String(source).replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (IGNORED_LINE.test(line)) return;
    const match = ASSIGNMENT_LINE.exec(line);
    if (!match) throw new Error(`介面字典第 ${index + 1} 行無法辨識：${line.slice(0, 80)}`);
    const key = unescapeQuoted(match[1]);
    const value = unescapeQuoted(match[2]);
    if (value && value !== key) strings[key] = value;
  });
  return strings;
};

export const buildUiArtifact = (source, { locale }) => {
  const url = UI_DICTIONARY_SOURCES[locale];
  if (!url) throw new Error(`不支援的市集漢化語系：${locale}`);
  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    locale,
    source: url,
    strings: parseUiDictionary(source),
  };
};

export const validateUiArtifact = (artifact) => {
  const count = Object.keys(artifact.strings).length;
  if (count < MIN_UI_STRING_COUNT) {
    throw new Error(`${artifact.locale} 介面字串只有 ${count} 個，少於 ${MIN_UI_STRING_COUNT}`);
  }
  return artifact;
};

// ── 共用 ─────────────────────────────────────────────────

const requireResult = (response, label) => {
  if (!Array.isArray(response?.result)) throw new Error(`${label} API 回應缺少 result 陣列`);
  return response.result;
};

const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

const ratioSameAsEnglish = (pairs) => {
  if (pairs.length === 0) return 0;
  return pairs.filter(([text, englishText]) => text === englishText).length / pairs.length;
};

const assertNotEnglish = (artifact, pairs) => {
  if (artifact.locale === 'en') return;
  const ratio = ratioSameAsEnglish(pairs);
  if (ratio > MAX_SAME_AS_ENGLISH_RATIO) {
    throw new Error(
      `${artifact.locale} 有 ${Math.round(ratio * 100)}% 條目與 en 相同，網域可能回傳英文`,
    );
  }
};

// ── stats ────────────────────────────────────────────────

/** 依 API 出現順序收集每個 id 的文字；同 id 可能多次出現（例如 Area / Map 兩種說法） */
const collectStatOccurrences = (response, label) => {
  const labels = {};
  const occurrences = new Map();
  const options = {};
  for (const group of requireResult(response, label)) {
    if (typeof group?.id !== 'string') throw new Error(`${label} API 群組缺少 id`);
    const groupLabel = textOf(group.label);
    if (groupLabel) labels[group.id] = groupLabel;
    for (const entry of group.entries ?? []) {
      const text = textOf(entry?.text);
      if (typeof entry?.id !== 'string' || !text) continue;
      occurrences.set(entry.id, [...(occurrences.get(entry.id) ?? []), text]);
      const entryOptions = {};
      for (const option of entry.option?.options ?? []) {
        const optionText = textOf(option?.text);
        if (option?.id !== null && option?.id !== undefined && optionText) {
          entryOptions[String(option.id)] = optionText;
        }
      }
      if (Object.keys(entryOptions).length > 0) options[entry.id] = entryOptions;
    }
  }
  return { labels, occurrences, options };
};

const packOccurrences = (texts) => (texts.length === 1 ? texts[0] : texts);

/**
 * stats API → `{ labels, stats, options }`。
 * 中文產物需要 en 回應：只保留國際服存在的 id，且同 id 出現次數必須與 en 一致才收（否則無法確定對應）。
 */
export const buildStatsArtifact = (response, { gameVersion, locale, englishResponse }) => {
  const own = collectStatOccurrences(response, 'stats');
  const english = englishResponse ? collectStatOccurrences(englishResponse, 'stats(en)') : null;

  const stats = {};
  for (const [id, texts] of own.occurrences) {
    if (english) {
      const englishTexts = english.occurrences.get(id);
      if (!englishTexts || englishTexts.length !== texts.length) continue;
    }
    stats[id] = packOccurrences(texts);
  }

  const options = {};
  for (const [id, entryOptions] of Object.entries(own.options)) {
    if (!(id in stats)) continue;
    const englishOptions = english?.options[id];
    options[id] = englishOptions
      ? Object.fromEntries(Object.entries(entryOptions).filter(([key]) => key in englishOptions))
      : entryOptions;
  }

  const labels = english
    ? Object.fromEntries(Object.entries(own.labels).filter(([id]) => id in english.labels))
    : own.labels;

  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    gameVersion,
    locale,
    source: LOCALE_REALM_HOSTS[locale],
    labels,
    stats,
    options,
  };
};

const flattenStats = (stats) =>
  Object.entries(stats).flatMap(([id, value]) =>
    (Array.isArray(value) ? value : [value]).map((text, index) => [`${id}#${index}`, text]),
  );

export const validateStatsArtifact = (artifact, englishArtifact) => {
  const count = Object.keys(artifact.stats).length;
  if (count < MIN_STATS_COUNT) {
    throw new Error(`${artifact.locale} stats 只有 ${count} 筆，少於 ${MIN_STATS_COUNT}`);
  }
  if (englishArtifact) {
    const englishTexts = new Map(flattenStats(englishArtifact.stats));
    const pairs = flattenStats(artifact.stats)
      .filter(([key]) => englishTexts.has(key))
      .map(([key, text]) => [text, englishTexts.get(key)]);
    assertNotEnglish(artifact, pairs);
  }
  return artifact;
};

// ── static ───────────────────────────────────────────────

/** static API → `{ labels, entries: { [groupId]: { [entryId]: text } } }`；id 跨群組可能重複，所以依群組分層 */
export const buildStaticArtifact = (response, { gameVersion, locale, englishResponse }) => {
  const englishGroups = englishResponse
    ? new Map(
        requireResult(englishResponse, 'static(en)').map((group) => [
          group.id,
          new Set((group.entries ?? []).map((entry) => entry?.id)),
        ]),
      )
    : null;

  const labels = {};
  const entries = {};
  for (const group of requireResult(response, 'static')) {
    if (typeof group?.id !== 'string') throw new Error('static API 群組缺少 id');
    const englishIds = englishGroups?.get(group.id);
    if (englishGroups && !englishIds) continue;
    const groupLabel = textOf(group.label);
    if (groupLabel) labels[group.id] = groupLabel;
    const groupEntries = {};
    for (const entry of group.entries ?? []) {
      const text = textOf(entry?.text);
      if (typeof entry?.id !== 'string' || !text) continue;
      if (englishIds && !englishIds.has(entry.id)) continue;
      groupEntries[entry.id] = text;
    }
    if (Object.keys(groupEntries).length > 0) entries[group.id] = groupEntries;
  }

  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    gameVersion,
    locale,
    source: LOCALE_REALM_HOSTS[locale],
    labels,
    entries,
  };
};

const flattenStatic = (entries) =>
  Object.entries(entries).flatMap(([groupId, group]) =>
    Object.entries(group).map(([id, text]) => [`${groupId}/${id}`, text]),
  );

export const validateStaticArtifact = (artifact, englishArtifact) => {
  const flat = flattenStatic(artifact.entries);
  if (flat.length < MIN_STATIC_COUNT) {
    throw new Error(`${artifact.locale} static 只有 ${flat.length} 筆，少於 ${MIN_STATIC_COUNT}`);
  }
  if (englishArtifact) {
    const englishTexts = new Map(flattenStatic(englishArtifact.entries));
    const pairs = flat
      .filter(([key]) => englishTexts.has(key))
      .map(([key, text]) => [text, englishTexts.get(key)]);
    assertNotEnglish(artifact, pairs);
  }
  return artifact;
};
