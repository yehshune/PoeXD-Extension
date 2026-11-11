import { describe, expect, it } from 'vitest';
import {
  captureOverlayCriteria,
  isEmptyOverlayCriteria,
  listCriteriaOverlayParts,
  pickCriteriaOverlayParts,
  criteriaFromTradeQuery,
  sliceOverlayCriteria,
  parseCriteriaOverlayOps,
  planCriteriaOverlayApplication,
  planStatGroupFiltersUpdate,
  planStatGroupReplacement,
  type OverlayCriteria,
  type CriteriaOverlayFormSnapshot,
} from '@/utils/criteria-overlay';

const pageSnapshot = (): CriteriaOverlayFormSnapshot => ({
  name: null,
  type: 'Vaal Regalia',
  disc: null,
  term: null,
  status: 'securable',
  filters: {
    type_filters: { filters: { rarity: { option: 'nonunique' }, category: { option: null } } },
    trade_filters: { disabled: true, filters: { price: { max: 10, option: 'divine' } } },
    misc_filters: { filters: {} },
  },
  stats: [
    {
      type: 'and',
      filters: [
        { id: 'explicit.stat_3299347043', value: { min: 80 }, disabled: false },
        { id: 'explicit.stat_1671376347', value: {}, disabled: true },
      ],
    },
    { type: 'count', value: { min: 2 }, filters: [{ id: 'explicit.stat_4220027924' }] },
    { type: 'and', filters: [] },
  ],
});

describe('captureOverlayCriteria', () => {
  it('normalizes the live form into item, status, stat groups and non-empty fields', () => {
    const criteria = captureOverlayCriteria(pageSnapshot());

    expect(criteria.item).toEqual({ name: null, type: 'Vaal Regalia', disc: null, term: null });
    expect(criteria.status).toBe('securable');
    expect(criteria.statGroups).toEqual([
      {
        type: 'and',
        filters: [
          { id: 'explicit.stat_3299347043', value: { min: 80 } },
          { id: 'explicit.stat_1671376347', disabled: true },
        ],
      },
      { type: 'count', value: { min: 2 }, filters: [{ id: 'explicit.stat_4220027924' }] },
    ]);
    expect(criteria.fields).toEqual([
      { section: 'type_filters', field: 'rarity', value: { option: 'nonunique' } },
      { section: 'trade_filters', field: 'price', value: { max: 10, option: 'divine' } },
    ]);
    expect(criteria.sectionDisabled).toEqual({ type_filters: false, trade_filters: true });
  });

  it('accepts a legacy { option } status and omits an empty item', () => {
    const criteria = captureOverlayCriteria({ status: { option: 'online' } });
    expect(criteria.status).toBe('online');
    expect(criteria.item).toBeUndefined();
    expect(isEmptyOverlayCriteria(criteria)).toBe(false);
  });

  it('drops extension metadata that is not part of the official structure', () => {
    const filter = { id: 'explicit.stat_1', value: { min: 1 } };
    Object.defineProperty(filter, 'poexdCategory', { value: 'ring', enumerable: false });
    const criteria = captureOverlayCriteria(
      JSON.parse(JSON.stringify({ stats: [{ type: 'and', filters: [filter] }] })),
    );
    expect(criteria.statGroups[0].filters[0]).toEqual({ id: 'explicit.stat_1', value: { min: 1 } });
  });

  it('reports an empty form as empty', () => {
    expect(isEmptyOverlayCriteria(captureOverlayCriteria({}))).toBe(true);
  });
});

describe('listCriteriaOverlayParts / pickCriteriaOverlayParts', () => {
  it('lists every selectable part and picks the chosen subset', () => {
    const criteria = captureOverlayCriteria(pageSnapshot());
    expect(listCriteriaOverlayParts(criteria).map((p) => p.key)).toEqual([
      'item',
      'status',
      'stat:0',
      'stat:1',
      'field:type_filters.rarity',
      'field:trade_filters.price',
    ]);

    const picked = pickCriteriaOverlayParts(
      criteria,
      new Set(['stat:1', 'field:type_filters.rarity']),
    );
    expect(picked.item).toBeUndefined();
    expect(picked.status).toBeUndefined();
    expect(picked.statGroups).toEqual([criteria.statGroups[1]]);
    expect(picked.fields).toEqual([criteria.fields[0]]);
    expect(picked.sectionDisabled).toEqual({ type_filters: false });
  });
});

describe('criteriaFromTradeQuery', () => {
  it('reads the official query JSON, including option-style name/type and discriminator', () => {
    const criteria = criteriaFromTradeQuery({
      query: {
        status: { option: 'securable' },
        name: { option: "Kaom's Heart", discriminator: 'legacy' },
        type: 'Glorious Plate',
        stats: [
          { type: 'and', filters: [{ id: 'explicit.a', value: { min: 1 } }] },
          { type: 'count', value: { min: 1 }, filters: [{ id: 'explicit.b' }] },
        ],
        filters: {
          type_filters: { filters: { rarity: { option: 'unique' } } },
          socket_filters: { disabled: true, filters: { links: { min: 5 } } },
        },
      },
      sort: { price: 'asc' },
    });
    expect(criteria.status).toBe('securable');
    expect(criteria.item).toEqual({
      name: "Kaom's Heart",
      type: 'Glorious Plate',
      disc: 'legacy',
      term: null,
    });
    expect(criteria.statGroups.map((g) => g.type)).toEqual(['and', 'count']);
    expect(criteria.fields.map((f) => `${f.section}.${f.field}`)).toEqual([
      'type_filters.rarity',
      'socket_filters.links',
    ]);
    expect(criteria.sectionDisabled).toEqual({ type_filters: false, socket_filters: true });
  });

  it('ignores a disabled name/type and tolerates an empty payload', () => {
    expect(
      criteriaFromTradeQuery({ query: { type: { option: 'X', disabled: true } } }).item,
    ).toBeUndefined();
    expect(isEmptyOverlayCriteria(criteriaFromTradeQuery(null))).toBe(true);
  });
});

describe('sliceOverlayCriteria', () => {
  const criteria = (): OverlayCriteria => captureOverlayCriteria(pageSnapshot());

  it('slices one stat group or every stat group', () => {
    const full = criteria();
    const one = sliceOverlayCriteria(full, { kind: 'stat-group', index: 1 });
    expect(one.statGroups).toEqual([full.statGroups[1]]);
    expect(one.fields).toEqual([]);
    expect(one.item).toBeUndefined();

    const all = sliceOverlayCriteria(full, { kind: 'stats' });
    expect(all.statGroups).toEqual(full.statGroups);
    expect(all.status).toBeUndefined();
  });

  it('slices a filter section with its disabled flag, or item / status', () => {
    const full = criteria();
    const section = sliceOverlayCriteria(full, { kind: 'section', section: 'type_filters' });
    expect(section.fields.map((f) => f.field)).toEqual(['rarity']);
    expect(section.sectionDisabled).toEqual({ type_filters: false });
    expect(section.statGroups).toEqual([]);

    expect(sliceOverlayCriteria(full, { kind: 'item' }).item).toEqual(full.item);
    expect(sliceOverlayCriteria(full, { kind: 'status' }).status).toBe(full.status);
  });

  it('returns everything for the whole target', () => {
    const full = criteria();
    expect(sliceOverlayCriteria(full, { kind: 'all' })).toEqual(full);
  });
});

describe('planCriteriaOverlayApplication', () => {
  const preset: OverlayCriteria = {
    status: 'online',
    statGroups: [
      { type: 'and', filters: [{ id: 'explicit.stat_resist', value: { min: 30 } }] },
      {
        type: 'weight',
        value: { min: 100 },
        disabled: true,
        filters: [{ id: 'explicit.stat_life' }],
      },
    ],
    fields: [{ section: 'misc_filters', field: 'corrupted', value: { option: 'false' } }],
    sectionDisabled: { misc_filters: false },
  };

  it('overlays fields, status and appends stat groups after the existing ones', () => {
    const plan = planCriteriaOverlayApplication(preset, pageSnapshot(), null);

    expect(plan.ops).toEqual([
      { kind: 'setStatus', status: 'online' },
      {
        kind: 'setPropertyFilter',
        group: 'misc_filters',
        index: 'corrupted',
        value: { option: 'false' },
      },
      { kind: 'setPropertyFilterGroupDisabled', group: 'misc_filters', disable: false },
      {
        kind: 'pushStatGroup',
        type: 'and',
        filters: [{ id: 'explicit.stat_resist', value: { min: 30 } }],
      },
      { kind: 'pushStatGroup', type: 'weight', filters: [{ id: 'explicit.stat_life' }] },
      { kind: 'setStatGroupValue', group: 4, value: { min: 100 } },
      { kind: 'setStatGroupDisabled', group: 4, disable: true },
    ]);
    expect(plan.report).toEqual({
      addedStatGroups: 2,
      skippedDuplicateStatGroups: 0,
      skippedUnknownStatFilters: 0,
      changedFields: 1,
      changedItem: false,
      changedStatus: true,
    });
  });

  it('never touches the item name/base when the preset does not define it', () => {
    const plan = planCriteriaOverlayApplication(preset, pageSnapshot(), null);
    expect(plan.ops.some((op) => op.kind === 'setItem')).toBe(false);
    expect(plan.undoOps.some((op) => op.kind === 'setItem')).toBe(false);
  });

  it('builds undo ops in reverse order that restore the previous page state', () => {
    const plan = planCriteriaOverlayApplication(
      { ...preset, item: { name: null, type: 'Gold Ring', disc: null, term: null } },
      pageSnapshot(),
      null,
    );
    expect(plan.undoOps).toEqual([
      { kind: 'removeStatGroup', group: 4 },
      { kind: 'removeStatGroup', group: 3 },
      { kind: 'setPropertyFilterGroupDisabled', group: 'misc_filters', disable: false },
      { kind: 'setPropertyFilter', group: 'misc_filters', index: 'corrupted', value: null },
      { kind: 'setStatus', status: 'securable' },
      { kind: 'setItem', item: { name: null, type: 'Vaal Regalia', disc: null, term: null } },
    ]);
  });

  it('skips stat groups identical to one already on the page', () => {
    const current = pageSnapshot();
    const duplicate = captureOverlayCriteria(current).statGroups[1];
    const plan = planCriteriaOverlayApplication(
      { statGroups: [duplicate, duplicate], fields: [], sectionDisabled: {} },
      current,
      null,
    );
    expect(plan.ops).toEqual([]);
    expect(plan.report.skippedDuplicateStatGroups).toBe(2);
  });

  it('drops unknown stat ids and skips groups left empty', () => {
    const plan = planCriteriaOverlayApplication(
      {
        statGroups: [
          { type: 'and', filters: [{ id: 'gone.stat' }] },
          { type: 'and', filters: [{ id: 'gone.stat' }, { id: 'explicit.stat_resist' }] },
        ],
        fields: [],
        sectionDisabled: {},
      },
      pageSnapshot(),
      new Set(['explicit.stat_resist']),
    );
    expect(plan.ops).toEqual([
      { kind: 'pushStatGroup', type: 'and', filters: [{ id: 'explicit.stat_resist' }] },
    ]);
    expect(plan.report.skippedUnknownStatFilters).toBe(2);
    expect(plan.report.addedStatGroups).toBe(1);
  });

  it('restores a previously set field value on undo', () => {
    const plan = planCriteriaOverlayApplication(
      {
        statGroups: [],
        fields: [
          { section: 'trade_filters', field: 'price', value: { max: 1, option: 'exalted' } },
        ],
        sectionDisabled: { trade_filters: false },
      },
      pageSnapshot(),
      null,
    );
    expect(plan.undoOps).toEqual([
      { kind: 'setPropertyFilterGroupDisabled', group: 'trade_filters', disable: true },
      {
        kind: 'setPropertyFilter',
        group: 'trade_filters',
        index: 'price',
        value: { max: 10, option: 'divine' },
      },
    ]);
  });
});

describe('parseCriteriaOverlayOps', () => {
  it('accepts every op produced by the planner', () => {
    const plan = planCriteriaOverlayApplication(
      {
        item: { name: null, type: 'Gold Ring', disc: null, term: null },
        status: 'online',
        statGroups: [{ type: 'count', value: { min: 1 }, disabled: true, filters: [{ id: 'a' }] }],
        fields: [{ section: 'misc_filters', field: 'corrupted', value: { option: 'false' } }],
        sectionDisabled: { misc_filters: true },
      },
      pageSnapshot(),
      null,
    );
    expect(parseCriteriaOverlayOps(JSON.parse(JSON.stringify(plan.ops)))).toEqual(plan.ops);
    expect(parseCriteriaOverlayOps(JSON.parse(JSON.stringify(plan.undoOps)))).toEqual(plan.undoOps);
  });

  it('rejects the whole batch when any op is unknown or malformed', () => {
    expect(
      parseCriteriaOverlayOps([
        { kind: 'setStatus', status: 'online' },
        { kind: 'clearSearchForm' },
      ]),
    ).toBeUndefined();
    expect(parseCriteriaOverlayOps([{ kind: 'removeStatGroup', group: -1 }])).toBeUndefined();
    expect(
      parseCriteriaOverlayOps([{ kind: 'pushStatGroup', type: 'and', filters: [{ id: 1 }] }]),
    ).toBeUndefined();
    expect(parseCriteriaOverlayOps('nope')).toBeUndefined();
  });
});

describe('planStatGroupReplacement', () => {
  const merc = {
    type: 'mercenary',
    value: { min: 3 },
    filters: [{ id: 'mercenary.skill_1' }, { id: 'mercenary.support_2' }],
  };
  const item = { name: null, type: 'WarrantNoble', disc: 'mercenary_warrant', term: null };

  it('removes the target group, appends the new one and restores both on undo', () => {
    const plan = planStatGroupReplacement(pageSnapshot(), 1, [merc], item);
    expect(plan.ops).toEqual([
      { kind: 'setItem', item },
      { kind: 'removeStatGroup', group: 1 },
      { kind: 'pushStatGroup', type: 'mercenary', filters: merc.filters },
      { kind: 'setStatGroupValue', group: 2, value: { min: 3 } },
    ]);
    expect(plan.undoOps).toEqual([
      { kind: 'removeStatGroup', group: 2 },
      { kind: 'pushStatGroup', type: 'count', filters: [{ id: 'explicit.stat_4220027924' }] },
      { kind: 'setStatGroupValue', group: 2, value: { min: 2 } },
      {
        kind: 'setItem',
        item: { name: null, type: 'Vaal Regalia', disc: null, term: null },
      },
    ]);
    expect(parseCriteriaOverlayOps([...plan.ops, ...plan.undoOps])).toBeDefined();
  });

  it('re-adds an empty target group on undo and appends when the index is out of range', () => {
    const replaced = planStatGroupReplacement(pageSnapshot(), 2, [merc]);
    expect(replaced.undoOps).toEqual([
      { kind: 'removeStatGroup', group: 2 },
      { kind: 'pushStatGroup', type: 'and', filters: [] },
    ]);
    const appended = planStatGroupReplacement(pageSnapshot(), 9, [merc]);
    expect(appended.ops[0]).toEqual({
      kind: 'pushStatGroup',
      type: 'mercenary',
      filters: merc.filters,
    });
    expect(appended.undoOps).toEqual([{ kind: 'removeStatGroup', group: 3 }]);
  });

  it('appends extra groups after the replacement and removes them back to front on undo', () => {
    const required = { type: 'and', filters: [{ id: 'mercenary.skill_1' }] };
    const plan = planStatGroupReplacement(pageSnapshot(), 2, [merc, required]);
    expect(plan.ops).toEqual([
      { kind: 'removeStatGroup', group: 2 },
      { kind: 'pushStatGroup', type: 'mercenary', filters: merc.filters },
      { kind: 'setStatGroupValue', group: 2, value: { min: 3 } },
      { kind: 'pushStatGroup', type: 'and', filters: required.filters },
    ]);
    expect(plan.undoOps).toEqual([
      { kind: 'removeStatGroup', group: 3 },
      { kind: 'removeStatGroup', group: 2 },
      { kind: 'pushStatGroup', type: 'and', filters: [] },
    ]);
    expect(plan.report.addedStatGroups).toBe(2);
  });
});

describe('planStatGroupFiltersUpdate', () => {
  it('rewrites the group in place and restores filters and value on undo', () => {
    const filters = [{ id: 'explicit.stat_4220027924' }, { id: 'mercenary.skill_1' }];
    const plan = planStatGroupFiltersUpdate(pageSnapshot(), 1, filters, { min: 1 });
    expect(plan?.ops).toEqual([
      { kind: 'setStatGroupFilters', group: 1, filters },
      { kind: 'setStatGroupValue', group: 1, value: { min: 1 } },
    ]);
    expect(plan?.undoOps).toEqual([
      { kind: 'setStatGroupFilters', group: 1, filters: [{ id: 'explicit.stat_4220027924' }] },
      { kind: 'setStatGroupValue', group: 1, value: { min: 2 } },
    ]);
    expect(plan?.report.updatedStatGroups).toBe(1);
    expect(parseCriteriaOverlayOps([...plan!.ops, ...plan!.undoOps])).toBeDefined();
  });

  it('leaves value alone when not given and rejects missing groups', () => {
    const plan = planStatGroupFiltersUpdate(pageSnapshot(), 2, [{ id: 'mercenary.skill_1' }]);
    expect(plan?.ops).toHaveLength(1);
    expect(plan?.undoOps).toEqual([{ kind: 'setStatGroupFilters', group: 2, filters: [] }]);
    expect(planStatGroupFiltersUpdate(pageSnapshot(), 9, [])).toBeUndefined();
  });

  it('rejects malformed filter ops on the wire', () => {
    expect(
      parseCriteriaOverlayOps([{ kind: 'setStatGroupFilters', group: 0, filters: [{ id: '' }] }]),
    ).toBeUndefined();
  });
});
