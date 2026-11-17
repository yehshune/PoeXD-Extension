import { describe, expect, it } from 'vitest';
import {
  buildStatDomainIndex,
  statDomainOf,
  statDomainsOf,
  withStatDomain,
} from '@/utils/stat-domain-order';

describe('stat-domain-order', () => {
  const index = buildStatDomainIndex([
    'fractured.stat_1',
    'explicit.stat_1',
    'scourge.stat_1',
    'crafted.stat_1',
    'implicit.stat_1',
    'enchant.stat_2|8',
    'explicit.stat_2',
    'pseudo.pseudo_total_life',
    'explicit.pseudo_total_life',
  ]);

  it('依常用程度排序同一個後綴的前綴，選項型代碼以後綴合併', () => {
    expect(statDomainsOf(index, 'fractured.stat_1')).toEqual([
      'explicit',
      'implicit',
      'crafted',
      'fractured',
      'scourge',
    ]);
    expect(statDomainsOf(index, 'explicit.stat_2')).toEqual(['explicit', 'enchant']);
  });

  it('總和代碼與不認得的代碼不提供切換', () => {
    expect(statDomainsOf(index, 'pseudo.pseudo_total_life')).toEqual([]);
    expect(statDomainsOf(index, 'explicit.pseudo_total_life')).toEqual(['explicit']);
    expect(statDomainsOf(index, 'explicit.stat_404')).toEqual([]);
    expect(statDomainsOf(index, 'not a stat')).toEqual([]);
  });

  it('取出與替換網域前綴', () => {
    expect(statDomainOf('fractured.stat_1')).toBe('fractured');
    expect(withStatDomain('explicit.stat_1', 'crafted')).toBe('crafted.stat_1');
    expect(withStatDomain('explicit.stat_1', undefined)).toBe('explicit.stat_1');
    // 沒有網域前綴的代碼不拆、不換
    expect(statDomainOf('stat_1')).toBe('');
    expect(statDomainOf('.stat_1')).toBe('');
    expect(withStatDomain('stat_1', 'crafted')).toBe('stat_1');
  });
});
