// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import {
  ADD_STAT_GROUP_SELECTOR,
  cleanStatGroupTemplateSlots,
  injectStatGroupTemplateSlots,
  STAT_GROUP_TEMPLATE_SLOT_CLASS,
} from '@/entrypoints/content/logic/stat-group-template-slots';
import { activeStatGroupTemplateSlots } from '@/utils/stat-group-template-slot-registry';
import StatGroupTemplateSaveDialog from '@/components/injected/StatGroupTemplateSaveDialog.vue';
import {
  groupCriteriaOverlayPartLabels,
  labelCriteriaOverlayParts,
  summarizeOverlayCriteria,
} from '@/components/injected/criteria-overlay-labels';
import type { OverlayCriteria } from '@/utils/criteria-overlay';

/** 依官方實際 DOM（漢化頁面）建立詞綴區結構。 */
function renderTradePage() {
  document.body.innerHTML = `
    <div class="search-advanced-pane brown">
      <div class="filter-group expanded">
        <div class="multiselect filter-select filter-select-mutate"></div>
      </div>
      <div class="filter filter-padded">
        <span class="filter-body" style="width: 50%; margin-left: 50%;">
          <div class="multiselect filter-select filter-group-select">
            <input class="multiselect__input" placeholder="+ 新增屬性組合" />
          </div>
        </span>
      </div>
    </div>`;
  return document.querySelector<HTMLElement>('.filter-group-select')!;
}

const flush = async (ms = 50) => {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, ms));
  await nextTick();
};

afterEach(() => {
  cleanStatGroupTemplateSlots();
  document.body.innerHTML = '';
  document.body.removeAttribute('data-poexd-page-role');
});

describe('injectStatGroupTemplateSlots', () => {
  it('adds one slot on the left of each official add-stat-group control', () => {
    const control = renderTradePage();
    expect(document.querySelectorAll(ADD_STAT_GROUP_SELECTOR)).toHaveLength(1);
    injectStatGroupTemplateSlots();
    injectStatGroupTemplateSlots();

    const slots = document.querySelectorAll<HTMLElement>(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`);
    expect(slots).toHaveLength(1);
    const row = control.closest('.filter-body')!;
    expect(row.previousElementSibling).toBe(slots[0]);
    expect(slots[0].style.float).toBe('left');
    expect(slots[0].style.width).toBe('50%');
    expect(activeStatGroupTemplateSlots.value).toEqual(Array.from(slots));
  });

  it('keeps the slot as tall as the official control so the button lines up', () => {
    const control = renderTradePage();
    control.getBoundingClientRect = () => ({ height: 39.6 }) as DOMRect;
    injectStatGroupTemplateSlots();
    const slot = document.querySelector<HTMLElement>(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`)!;
    expect(slot.style.height).toBe('40px');

    control.getBoundingClientRect = () => ({ height: 44 }) as DOMRect;
    injectStatGroupTemplateSlots();
    expect(slot.style.height).toBe('44px');
    expect(document.querySelectorAll(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`)).toHaveLength(1);
  });

  it('does not inject on the LiveSearch console page', () => {
    renderTradePage();
    document.body.setAttribute('data-poexd-page-role', 'live-search-primary');
    injectStatGroupTemplateSlots();
    expect(document.querySelectorAll(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`)).toHaveLength(0);
    expect(activeStatGroupTemplateSlots.value).toEqual([]);
  });

  it('cleans every slot and clears the registry', () => {
    renderTradePage();
    injectStatGroupTemplateSlots();
    cleanStatGroupTemplateSlots();
    expect(document.querySelectorAll(`.${STAT_GROUP_TEMPLATE_SLOT_CLASS}`)).toHaveLength(0);
    expect(activeStatGroupTemplateSlots.value).toEqual([]);
  });
});

describe('labelCriteriaOverlayParts', () => {
  it('labels item, status, stat groups and fields in part order', () => {
    const criteria: OverlayCriteria = {
      item: { name: null, type: 'Gold Ring', disc: null, term: null },
      status: 'online',
      statGroups: [
        { type: 'count', value: { min: 2 }, filters: [{ id: 'x.unknown', value: { min: 5 } }] },
      ],
      fields: [{ section: 'misc_filters', field: 'corrupted', value: { option: 'false' } }],
      sectionDisabled: {},
    };
    const labels = labelCriteriaOverlayParts(criteria, 'poe1');
    expect(labels.map((l) => l.key)).toEqual([
      'item',
      'status',
      'stat:0',
      'field:misc_filters.corrupted',
    ]);
    expect(labels[1].detail).toBe('僅限線上');
    expect(labels[2].label).toBe('計數 (COUNT) ≥ 2 · 1 條');
    expect(labels[3].detail).toBe('否');
    expect(labels.map((l) => l.target)).toEqual([
      { kind: 'item' },
      { kind: 'status' },
      { kind: 'stat-group', index: 0 },
      { kind: 'section', section: 'misc_filters' },
    ]);
  });

  it('groups labels into overlay blocks, with every stat group under one stats block', () => {
    const labels = labelCriteriaOverlayParts(
      {
        status: 'online',
        statGroups: [
          { type: 'and', filters: [{ id: 'x.a' }] },
          { type: 'not', filters: [{ id: 'x.b' }] },
        ],
        fields: [
          { section: 'type_filters', field: 'rarity', value: { option: 'rare' } },
          { section: 'type_filters', field: 'ilvl', value: { min: 80 } },
        ],
        sectionDisabled: {},
      },
      'poe1',
    );
    const groups = groupCriteriaOverlayPartLabels(labels);
    expect(groups.map((g) => [g.target, g.parts.length])).toEqual([
      [{ kind: 'status' }, 1],
      [{ kind: 'stats' }, 2],
      [{ kind: 'section', section: 'type_filters' }, 2],
    ]);
  });
});

describe('summarizeOverlayCriteria', () => {
  it('lists only the kinds of parts the preset defines', () => {
    expect(
      summarizeOverlayCriteria({
        status: 'online',
        statGroups: [
          { type: 'and', filters: [] },
          { type: 'not', filters: [] },
        ],
        fields: [],
        sectionDisabled: {},
      }),
    ).toBe('2 個詞綴群組 · 上架狀態');
  });
});

describe('StatGroupTemplateSaveDialog', () => {
  it('pre-checks every part and emits only the parts left checked', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const saved: Array<{ name: string; keys: string[] }> = [];
    const open = ref(true);
    const app = createApp({
      render: () =>
        h(StatGroupTemplateSaveDialog, {
          open: open.value,
          defaultName: '',
          parts: [
            {
              key: 'stat:0',
              group: '詞綴群組',
              label: '且 (AND) · 1 條',
              target: { kind: 'stat-group', index: 0 },
            },
            {
              key: 'stat:1',
              group: '詞綴群組',
              label: '非 (NOT) · 1 條',
              target: { kind: 'stat-group', index: 1 },
            },
          ],
          onSave: (payload: { name: string; keys: string[] }) => saved.push(payload),
          'onUpdate:open': (value: boolean) => (open.value = value),
        }),
    });
    app.mount(container);
    await flush();

    const dialog = document
      .querySelector('[data-test="stat-group-template-name"]')!
      .closest('form')!;
    const saveButton = dialog.querySelector<HTMLButtonElement>(
      '[data-test="stat-group-template-save"]',
    )!;
    expect(saveButton.disabled).toBe(true); // 名稱為空

    const nameInput = dialog.querySelector<HTMLInputElement>(
      '[data-test="stat-group-template-name"]',
    )!;
    nameInput.value = '生命抗性';
    nameInput.dispatchEvent(new Event('input'));
    await nextTick();

    const statusCheckbox = dialog.querySelector<HTMLElement>(
      '[data-part-key="stat:1"] [data-slot="checkbox"]',
    )!;
    statusCheckbox.click();
    await nextTick();

    dialog.dispatchEvent(new Event('submit'));
    await flush();

    expect(saved.at(-1)).toEqual({ name: '生命抗性', keys: ['stat:0'] });
    app.unmount();
    container.remove();
  });
});
