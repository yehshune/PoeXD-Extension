import { describe, expect, it } from 'vitest';
import { moveTemplateId } from '@/components/sidebar/stat-group-templates/template-order';

describe('moveTemplateId', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves an id down or up without mutating the input', () => {
    expect(moveTemplateId(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTemplateId(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the order for no-op or out-of-range moves', () => {
    expect(moveTemplateId(ids, 1, 1)).toEqual(ids);
    expect(moveTemplateId(ids, -1, 2)).toEqual(ids);
    expect(moveTemplateId(ids, 0, 9)).toEqual(ids);
  });
});
