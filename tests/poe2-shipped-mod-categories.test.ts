import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModsTiersArtifact } from '@/utils/affix-lexicon';
import { typeMapPoe2 } from '@/components/sidebar/typeMaps';

const artifact = JSON.parse(
  readFileSync(resolve(__dirname, '../public/json/poe2/mods-tiers.json'), 'utf8'),
) as ModsTiersArtifact;

function countTiersFor(type: string): number {
  return artifact.tiers.filter((tier) => artifact.typeTable[tier.typeIdx]?.includes(type)).length;
}

describe('shipped PoE 2 mod categories', () => {
  it.each([
    'waystone',
    'waystone-t1',
    'waystone-t2',
    'waystone-t3',
    'tablet',
    'breach-tablet',
    'expedition-tablet',
    'delirium-tablet',
    'ritual-tablet',
    'abyss-tablet',
    'overseer-tablet',
    'temple-tablet',
  ])('ships affixes for %s', (type) => {
    expect(countTiersFor(type)).toBeGreaterThan(0);
  });

  it('only ships categories the sidebar knows how to label', () => {
    const shipped = new Set(artifact.typeTable.flat());
    const unknown = [...shipped].filter((type) => !(type in typeMapPoe2));
    expect(unknown).toEqual([]);
  });
});
