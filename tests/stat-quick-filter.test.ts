import { describe, expect, it } from 'vitest';
import {
  parseCriteriaOverlayOps,
  type CriteriaOverlayFormSnapshot,
} from '@/utils/criteria-overlay';
import { planAddStatToGroupKind } from '@/utils/stat-quick-filter';

const pageSnapshot = (): CriteriaOverlayFormSnapshot => ({
  name: null,
  type: 'Vaal Regalia',
  disc: null,
  term: null,
  status: 'securable',
  filters: {
    type_filters: { filters: { rarity: { option: 'nonunique' }, category: { option: null } } },
  },
  stats: [
    {
      type: 'and',
      filters: [{ id: 'explicit.stat_3299347043', value: { min: 70 }, disabled: false }],
    },
  ],
});

describe('planAddStatToGroupKind', () => {
  it('appends a new filter without numeric values into the first active and group', () => {
    const plan = planAddStatToGroupKind(pageSnapshot(), 'and', ' explicit.stat_999 ');
    expect(plan).toEqual({
      status: 'added',
      groupIndex: 0,
      ops: [
        {
          kind: 'setStatFilter',
          group: 0,
          filter: { id: 'explicit.stat_999', disabled: false },
        },
      ],
    });
    expect(parseCriteriaOverlayOps(plan.ops)).toEqual(plan.ops);
  });

  it('skips disabled groups and pushes a new not group when none is active', () => {
    const snapshot: CriteriaOverlayFormSnapshot = {
      stats: [{ type: 'not', disabled: true, filters: [{ id: 'explicit.stat_1' }] }],
    };
    const plan = planAddStatToGroupKind(snapshot, 'not', 'explicit.stat_2');
    expect(plan).toEqual({
      status: 'added',
      groupIndex: 1,
      ops: [
        {
          kind: 'pushStatGroup',
          type: 'not',
          filters: [{ id: 'explicit.stat_2', disabled: false }],
        },
      ],
    });
    expect(parseCriteriaOverlayOps(plan.ops)).toEqual(plan.ops);
  });

  it('returns already-exists when the stat is active in the target group', () => {
    const snapshot: CriteriaOverlayFormSnapshot = {
      stats: [{ type: 'and', filters: [{ id: 'explicit.stat_3299347043', value: { min: 50 } }] }],
    };
    expect(planAddStatToGroupKind(snapshot, 'and', 'explicit.stat_3299347043')).toEqual({
      status: 'already-exists',
      groupIndex: 0,
      ops: [],
    });
  });

  it('re-enables a disabled matching filter in place via setStatFilter with index', () => {
    const snapshot: CriteriaOverlayFormSnapshot = {
      stats: [
        {
          type: 'not',
          filters: [{ id: 'explicit.stat_1', value: { min: 10 }, disabled: true }],
        },
      ],
    };
    const plan = planAddStatToGroupKind(snapshot, 'not', 'explicit.stat_1');
    expect(plan).toEqual({
      status: 'enabled',
      groupIndex: 0,
      ops: [
        {
          kind: 'setStatFilter',
          group: 0,
          index: 0,
          filter: { id: 'explicit.stat_1', value: { min: 10 }, disabled: false },
        },
      ],
    });
    expect(parseCriteriaOverlayOps(plan.ops)).toEqual(plan.ops);
  });

  it('returns unknown when statId is missing or absent from knownStatIds', () => {
    expect(planAddStatToGroupKind(pageSnapshot(), 'and', '   ')).toEqual({
      status: 'unknown',
      ops: [],
    });
    expect(
      planAddStatToGroupKind(
        pageSnapshot(),
        'not',
        'explicit.unknown',
        new Set(['explicit.known']),
      ),
    ).toEqual({
      status: 'unknown',
      ops: [],
    });
  });
});
