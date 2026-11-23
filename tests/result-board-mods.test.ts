import { describe, expect, it } from 'vitest';
import { toBoardEntry } from '@/utils/result-board/board-entry';
import {
  aggregateBoardModOptions,
  filterModOptions,
  matchesModConditions,
  parseTierCode,
} from '@/utils/result-board/board-mods';
import { filterEntries } from '@/utils/result-board/board-query';
import { rawResult } from './helpers/result-board-fixtures';

const PHYS_HASH = 'explicit.stat_1509134228';
const ACC_HASH = 'explicit.stat_691932474';
const IMPALE_HASH = 'explicit.stat_3377888098';
const ASPD_HASH = 'explicit.stat_210067635';

const STAT_LABELS: Record<string, string> = {
  [PHYS_HASH]: '增加 #% 物理傷害',
  [ACC_HASH]: '+# 命中值',
  [IMPALE_HASH]: '攻擊擊中時有 #% 機率穿刺敵人',
  [ASPD_HASH]: '增加 #% 攻擊速度',
};

const resolveLabel = (hash: string) => STAT_LABELS[hash] ?? hash;

describe('board-mods independent mod parsing, aggregation & filtering', () => {
  it('parses prefix/suffix tier codes accurately', () => {
    expect(parseTierCode('P1')).toEqual({ affixKind: 'prefix', tierNumber: 1 });
    expect(parseTierCode('s3')).toEqual({ affixKind: 'suffix', tierNumber: 3 });
    expect(parseTierCode('P10')).toEqual({ affixKind: 'prefix', tierNumber: 10 });
    expect(parseTierCode('C1')).toBeUndefined();
    expect(parseTierCode('')).toBeUndefined();
    expect(parseTierCode(undefined)).toBeUndefined();
  });

  it('distinguishes pure T1 %phys from hybrid %phys+accuracy and hybrid %phys+impale', () => {
    const entries = [
      // #1: Pure T1 %phys (Merciless) + T1 Attack Speed
      toBoardEntry(
        rawResult({
          id: 'pure-t1',
          extendedMods: {
            explicit: [
              { name: 'Merciless', tier: 'P1', magnitudes: [{ hash: PHYS_HASH, min: '170', max: '179' }] },
              { name: 'of Celebration', tier: 'S1', magnitudes: [{ hash: ASPD_HASH, min: '17', max: '19' }] },
            ],
          },
        }),
        0,
      )!,
      // #2: Pure T1 %phys + Hybrid P8 %phys/acc (still has true pure T1!)
      toBoardEntry(
        rawResult({
          id: 'pure-t1-plus-hybrid',
          extendedMods: {
            explicit: [
              { name: 'Merciless', tier: 'P1', magnitudes: [{ hash: PHYS_HASH, min: '170', max: '179' }] },
              {
                name: 'Squire',
                tier: 'P8',
                magnitudes: [
                  { hash: PHYS_HASH, min: '15', max: '19' },
                  { hash: ACC_HASH, min: '16', max: '20' },
                ],
              },
            ],
          },
        }),
        1,
      )!,
      // #3: Fake T1 summed from Pure P3 + Hybrid P4
      toBoardEntry(
        rawResult({
          id: 'fake-t1-p3-p4',
          extendedMods: {
            explicit: [
              { name: 'Cruel', tier: 'P3', magnitudes: [{ hash: PHYS_HASH, min: '135', max: '154' }] },
              {
                name: 'Champion',
                tier: 'P4',
                magnitudes: [
                  { hash: PHYS_HASH, min: '45', max: '54' },
                  { hash: ACC_HASH, min: '98', max: '123' },
                ],
              },
            ],
          },
        }),
        2,
      )!,
      // #4: Hybrid T1 %phys+impale (P1, but hybrid — NOT pure %phys!)
      toBoardEntry(
        rawResult({
          id: 'hybrid-t1-impale',
          extendedMods: {
            explicit: [
              {
                name: 'Transfixing',
                tier: 'P1',
                magnitudes: [
                  { hash: PHYS_HASH, min: '115', max: '129' },
                  { hash: IMPALE_HASH, min: '21', max: '25' },
                ],
              },
            ],
          },
        }),
        3,
      )!,
    ];

    const options = aggregateBoardModOptions(entries, resolveLabel);
    const purePhys = options.find((opt) => !opt.isHybrid && opt.hashes[0] === PHYS_HASH)!;
    const hybridAcc = options.find(
      (opt) => opt.isHybrid && opt.hashes.includes(PHYS_HASH) && opt.hashes.includes(ACC_HASH),
    )!;
    const hybridImpale = options.find(
      (opt) => opt.isHybrid && opt.hashes.includes(PHYS_HASH) && opt.hashes.includes(IMPALE_HASH),
    )!;

    expect(purePhys).toBeDefined();
    expect(purePhys.label).toBe('增加 #% 物理傷害');
    expect(purePhys.itemCount).toBe(3);
    expect(purePhys.hasTiers).toBe(true);
    expect(purePhys.tierCounts).toEqual({ 1: 2, 2: 2, 3: 3 });

    expect(hybridAcc.isHybrid).toBe(true);
    expect(hybridAcc.itemCount).toBe(2);
    expect(hybridAcc.tierCounts).toEqual({ 1: 0, 2: 0, 3: 0 });

    expect(hybridImpale.isHybrid).toBe(true);
    expect(hybridImpale.tierCounts).toEqual({ 1: 1, 2: 1, 3: 1 });

    // Require pure %phys T1 -> matches ONLY pure-t1 and pure-t1-plus-hybrid
    const matchedT1 = filterEntries(
      entries,
      {
        instantBuyoutOnly: false,
        keyword: '',
        hiddenAccounts: new Set(),
        modConditions: [{ key: purePhys.key, maxTier: 1 }],
      },
      undefined,
    ).map((e) => e.id);
    expect(matchedT1).toEqual(['pure-t1', 'pure-t1-plus-hybrid']);

    // Require pure %phys <=T3 -> adds fake-t1-p3-p4 (has pure P3), still excludes hybrid-t1-impale
    const matchedT3 = entries
      .filter((e) => matchesModConditions(e, [{ key: purePhys.key, maxTier: 3 }]))
      .map((e) => e.id);
    expect(matchedT3).toEqual(['pure-t1', 'pure-t1-plus-hybrid', 'fake-t1-p3-p4']);

    // Multiple required independent mods (AND): pure %phys T1 AND Attack Speed T1
    const aspdOpt = options.find((opt) => opt.hashes[0] === ASPD_HASH)!;
    const matchedBoth = entries
      .filter((e) =>
        matchesModConditions(e, [
          { key: purePhys.key, maxTier: 1 },
          { key: aspdOpt.key, maxTier: 1 },
        ]),
      )
      .map((e) => e.id);
    expect(matchedBoth).toEqual(['pure-t1']);

    // Picker fuzzy & hybrid/pure keyword search
    expect(filterModOptions(options, '物理傷 純詞').map((o) => o.key)).toEqual([purePhys.key]);
    expect(filterModOptions(options, '物理傷 複合').map((o) => o.key)).toEqual([
      hybridAcc.key,
      hybridImpale.key,
    ]);
  });
});
