/**
 * Source Item 的詞綴 → 草稿 stat：型態正規化、pseudo 合併、預設角色與門檻。
 */
import type { PoeVersion } from '../trade-context';
import { pseudoContributions } from '../pob-shopping-list';
import { readSourceLines, type SourceLine } from './source-lines';
import { thresholdFor } from './threshold';
import type { DraftStat, StatDomainChoice } from './types';

/** 預設當參考的最差階級（含） */
const REFERENCE_TIER_LIMIT: Readonly<Record<PoeVersion, number>> = { poe1: 3, poe2: 3 };

/** 以 `explicit.` 搜尋即可涵蓋的型態（ADR-0020 實測：破裂、工藝與 PoE 2 褻瀆） */
const NARROWABLE = new Set<StatDomainChoice>(['fractured', 'crafted', 'desecrated']);
const EXPLICIT_LIKE = new Set(['explicit', ...NARROWABLE]);
const PSEUDO_SOURCES = new Set([...EXPLICIT_LIKE, 'implicit']);

interface Contribution {
  key: string;
  line: SourceLine;
  value: number;
  pseudo: boolean;
  qualifies: boolean;
}

const statNumberOf = (statId: string): string => statId.slice(statId.indexOf('.') + 1);

function qualifiesAsReference(line: SourceLine, version: PoeVersion): boolean {
  if (!EXPLICIT_LIKE.has(line.category)) return false;
  if (line.category === 'crafted') return true;
  return line.tier !== undefined && line.tier <= REFERENCE_TIER_LIMIT[version];
}

function searchIdOf(line: SourceLine): string {
  return EXPLICIT_LIKE.has(line.category) ? `explicit.${statNumberOf(line.statId)}` : line.statId;
}

/** 英文市集寫法換成一般詞綴文字後，交給 PoB 清單同一套 pseudo 對照 */
function pseudoOf(line: SourceLine, englishStatText: (statId: string) => string | undefined) {
  if (!PSEUDO_SOURCES.has(line.category)) return undefined;
  const lookupId = line.category === 'implicit' ? line.statId : searchIdOf(line);
  const template = englishStatText(lookupId);
  if (!template) return undefined;
  const contributions = pseudoContributions(template.replace(/[+-]?#/g, '1'));
  return contributions && contributions.length > 0 ? contributions : undefined;
}

function contributionsOf(
  line: SourceLine,
  version: PoeVersion,
  englishStatText: (statId: string) => string | undefined,
): Contribution[] {
  const qualifies = qualifiesAsReference(line, version);
  const pseudo = pseudoOf(line, englishStatText);
  if (pseudo) {
    return pseudo.map(({ id, weight }) => ({
      key: id,
      line,
      value: line.value * weight,
      pseudo: true,
      qualifies,
    }));
  }
  return [{ key: searchIdOf(line), line, value: line.value, pseudo: false, qualifies }];
}

function domainsOf(parts: readonly Contribution[]): readonly StatDomainChoice[] | undefined {
  const narrow = [
    ...new Set(
      parts
        .map((part) => part.line.category as StatDomainChoice)
        .filter((category) => NARROWABLE.has(category)),
    ),
  ];
  return narrow.length > 0 ? ['any', ...narrow] : undefined;
}

const roundValue = (value: number): number => Math.round(value * 100) / 100;

function toDraftStat(key: string, parts: readonly Contribution[], tolerance: number): DraftStat {
  const value = roundValue(parts.reduce((sum, part) => sum + part.value, 0));
  const tiers = parts.flatMap((part) => (part.line.tier !== undefined ? [part.line.tier] : []));
  const pseudo = parts[0].pseudo;
  const domains = pseudo ? undefined : domainsOf(parts);
  return {
    key,
    id: key,
    text: parts.map((part) => part.line.text).join(' / '),
    value,
    ...(tiers.length > 0 ? { tier: Math.min(...tiers) } : {}),
    role: parts.some((part) => part.qualifies) ? 'reference' : 'ignored',
    domain: 'any',
    ...(domains ? { domains } : {}),
    threshold: thresholdFor(value, tolerance),
    customized: false,
    pseudo,
  };
}

export function deriveDraftStats(
  item: Record<string, unknown>,
  options: {
    version: PoeVersion;
    tolerance: number;
    englishStatText: (statId: string) => string | undefined;
  },
): DraftStat[] {
  const groups = new Map<string, Contribution[]>();
  for (const line of readSourceLines(item)) {
    for (const part of contributionsOf(line, options.version, options.englishStatText)) {
      groups.set(part.key, [...(groups.get(part.key) ?? []), part]);
    }
  }
  return [...groups].map(([key, parts]) => toDraftStat(key, parts, options.tolerance));
}
