/**
 * 把 PoB 物品文字裡的英文詞綴翻成顯示語言，供購物清單顯示。
 *
 * 用的是市集漢化的同一份對照（ADR-0012 的 `mod-lines.json`：每個 stat hash 的英文句型與
 * 官方譯文句型），所以譯文就是該區服遊戲內的寫法。先以骨架找出可能的句型，再由
 * `translateModLine` 把數值填進同一個變體的譯文。
 *
 * 只有 zh-TW、zh-CN 有這份資料；其他語言沒有翻譯器，詞綴維持英文。翻不了的詞綴
 * （例如 PoB 把多行詞綴拆成兩行）回傳 undefined，由呼叫端顯示英文原文。
 */
import { translateModLine, type ModLinePairs } from './market-mod-lines';
import { modLineSkeleton, modTemplateSkeleton } from './pob-stat-matcher';
import { getLocaleModLinesAssetPath, type PoeVersion } from './trade-context';

export interface ModLineTranslator {
  translate(englishLine: string): string | undefined;
}

const TRANSLATED_LOCALES: readonly string[] = ['zh-TW', 'zh-CN'];

export function createModLineTranslator(
  modLines: Readonly<Record<string, ModLinePairs>>,
): ModLineTranslator {
  // 骨架 → 英文句型相符的 [英文, 譯文]；同一句英文在不同 hash 下譯文相同，留第一筆即可
  const pairsBySkeleton = new Map<string, Array<readonly [string, string]>>();
  for (const pairs of Object.values(modLines)) {
    if (!Array.isArray(pairs)) continue;
    for (const pair of pairs) {
      const [english, localized] = pair;
      if (typeof english !== 'string' || typeof localized !== 'string') continue;
      const skeleton = modTemplateSkeleton(english);
      const known = pairsBySkeleton.get(skeleton) ?? [];
      if (known.some(([knownEnglish]) => knownEnglish === english)) continue;
      pairsBySkeleton.set(skeleton, [...known, [english, localized]]);
    }
  }
  const cache = new Map<string, string | undefined>();

  return {
    translate(englishLine) {
      if (cache.has(englishLine)) return cache.get(englishLine);
      const pairs = pairsBySkeleton.get(modLineSkeleton(englishLine));
      const translated = (pairs && translateModLine(englishLine, pairs)) || undefined;
      cache.set(englishLine, translated);
      return translated;
    },
  };
}

/** 該語言沒有對照資料時回傳 undefined（不是錯誤） */
export async function loadModLineTranslator(
  loadJson: (path: string) => Promise<unknown>,
  options: { version: PoeVersion; locale: string },
): Promise<ModLineTranslator | undefined> {
  if (!TRANSLATED_LOCALES.includes(options.locale)) return undefined;
  const data = await loadJson(getLocaleModLinesAssetPath(options.version, options.locale));
  const lines =
    typeof data === 'object' && data !== null ? (data as { lines?: unknown }).lines : undefined;
  if (typeof lines !== 'object' || lines === null) throw new Error('mod-lines.json 格式錯誤');
  return createModLineTranslator(lines as Record<string, ModLinePairs>);
}
