// @vitest-environment happy-dom
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { ConfigProvider } from 'reka-ui';
import TierDropdownHost from '@/components/injected/TierDropdownHost.vue';
import {
  syncTierSlots,
  clearTierSlots,
  registerTierSlotRefresher,
  refreshTierSlot,
  refreshAndReopenTierSlot,
  upsertTierSlot,
  activeTierSlots,
  type TierDropdownItemSpec,
} from '@/utils/tier-slot-registry';
import { createFilterDomEnhancements } from '@/entrypoints/content/logic/common';
import { setAffixLexiconMockData } from '@/utils/affix-lexicon';
import {
  removeTierSlotArtifacts,
  cleanAllTierSlotArtifacts,
} from '@/entrypoints/content/logic/injected-controls';

describe('TierDropdownHost (Native Reka + Vue Teleport & Foundation Compliance)', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let uiContainer: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let slotEl1: HTMLElement;
  let slotEl2: HTMLElement;
  let app: any;

  beforeEach(() => {
    // 1. 建立 Light DOM slot 容器
    slotEl1 = document.createElement('span');
    slotEl1.className = 'poexd-tier-trigger-slot';
    slotEl1.setAttribute('data-poexd-slot-key', 'slot-1');
    document.body.appendChild(slotEl1);

    slotEl2 = document.createElement('span');
    slotEl2.className = 'poexd-tier-trigger-slot';
    slotEl2.setAttribute('data-poexd-slot-key', 'slot-2');
    document.body.appendChild(slotEl2);

    // 2. 建立 Shadow UI 與單一 portalRoot
    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-sidebar-container';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    uiContainer = document.createElement('div');
    shadowRoot.appendChild(uiContainer);

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    uiContainer.appendChild(appRoot);

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    uiContainer.appendChild(portalRoot);

    const RootComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(TierDropdownHost),
          ]);
      },
    });

    app = createApp(RootComponent);
    app.mount(appRoot);
  });

  afterEach(() => {
    clearTierSlots();
    app?.unmount();
    shadowHost?.remove();
    slotEl1?.remove();
    slotEl2?.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('teleports DropdownMenuTrigger into Light DOM slots while keeping DropdownMenuContent inside ShadowRoot portalRoot', async () => {
    const items: TierDropdownItemSpec[] = [
      {
        id: 't1',
        type: 'tier',
        label: 'T1 (Lv.84) (10 ~ 20)',
        valMin: '10',
        valMax: '20',
        isRange: true,
      },
      {
        id: 't2',
        type: 'tier',
        label: 'T2 (Lv.70) (5 ~ 9)',
        valMin: '5',
        valMax: '9',
        isRange: true,
      },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    // 1. 驗證 Trigger 實體 DOM 位於 Light DOM slot 內，且符合 native host button ownership contract
    const trigger1 = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    expect(trigger1).not.toBeNull();
    expect(trigger1?.tagName).toBe('BUTTON');
    expect(trigger1?.textContent?.trim()).toBe('T');
    expect(trigger1?.className).toContain('btn');
    expect(trigger1?.className).toContain('poexd-tier-trigger');
    expect(trigger1?.className).not.toContain('poexd-inline-btn');
    expect(trigger1?.className).not.toContain('h-[var(--control-height-sm');
    expect(trigger1?.className).not.toContain('px-[var(--button-padding-x-sm');

    // 2. 驗證未開啟時 portalRoot 與 body 均無 DropdownMenuContent
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
    expect(document.body.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    // 3. 點擊 Trigger 1 開啟選單
    trigger1?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // 4. 驗證 Content 實體 DOM 位於 ShadowRoot portalRoot
    const content = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain('T1 (Lv.84)');
    expect(content?.textContent).toContain('T2 (Lv.70)');

    // 5. 驗證 Light DOM 或 document.body 絕無 Content 殘留
    expect(document.body.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('supports native mouse click toggle (click opens, click same trigger closes)', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 't1', type: 'tier', label: 'T1', valMin: '10', valMax: '20', isRange: true },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger1 = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    expect(trigger1).not.toBeNull();

    // 1. 第一次點擊：開啟
    trigger1?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // 2. 同一 Trigger 再次點擊：關閉
    trigger1?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('switches trigger cleanly when opening with a different trigger', async () => {
    const items1: TierDropdownItemSpec[] = [
      { id: 'btn1-t1', type: 'tier', label: 'Button 1 Tier' },
    ];
    const items2: TierDropdownItemSpec[] = [
      { id: 'btn2-t1', type: 'tier', label: 'Button 2 Tier' },
    ];

    syncTierSlots([
      { key: 'slot-1', targetEl: slotEl1, items: items1, onSelect: vi.fn() },
      { key: 'slot-2', targetEl: slotEl2, items: items2, onSelect: vi.fn() },
    ]);
    await nextTick();

    const trigger1 = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    const trigger2 = slotEl2.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');

    // 1. 開啟 trigger 1
    trigger1?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(portalRoot.textContent).toContain('Button 1 Tier');

    // 2. 切換至 trigger 2 (trigger 1 自動關閉，trigger 2 開啟)
    trigger2?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(portalRoot.textContent).toContain('Button 2 Tier');
    expect(portalRoot.textContent).not.toContain('Button 1 Tier');
  });

  it('invokes onSelect with min mode when clicking tier item row', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 't1', type: 'tier', label: 'T1 (10 ~ 20)', valMin: '10', valMax: '20', isRange: true },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const minBtn = portalRoot.querySelector<HTMLElement>('[data-tier-action="min"]');
    expect(minBtn).not.toBeNull();

    minBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[0], 'min');
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('invokes onSelect with both mode when selecting "~" DropdownMenuItem', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 't1', type: 'tier', label: 'T1 (10 ~ 20)', valMin: '10', valMax: '20', isRange: true },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const bothItem = portalRoot.querySelector<HTMLElement>('[data-tier-action="both"]');
    expect(bothItem).not.toBeNull();

    bothItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[0], 'both');
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('invokes onSelect with max mode when selecting max value DropdownMenuItem', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 't1', type: 'tier', label: 'T1 (10 ~ 20)', valMin: '10', valMax: '20', isRange: true },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const maxItem = portalRoot.querySelector<HTMLElement>('[data-tier-action="max"]');
    expect(maxItem).not.toBeNull();

    maxItem?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[0], 'max');
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('invokes onSelect for switch_category and trigger_modal', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 'switch_category', type: 'switch_category', label: '頭盔 (點選切換)' },
      { id: 'trigger_modal', type: 'trigger_modal', label: '選擇物品類別' },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const menuItems = portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]');
    expect(menuItems).toHaveLength(2);

    // Click switch_category
    menuItems[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('supports native keyboard open (Enter, Space, ArrowDown) and Escape dismissal with native focus restoration', async () => {
    const items: TierDropdownItemSpec[] = [{ id: 't1', type: 'tier', label: 'T1' }];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    expect(trigger).not.toBeNull();

    // 1. Focus trigger 並按 Enter 開啟
    trigger?.focus();
    expect(document.activeElement).toBe(trigger);

    trigger?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    let content = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    // 2. 按 Escape 關閉選單 -> 驗證焦點自動返回 Light DOM Trigger（Reka 原生 focus restoration）
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    // 3. 按 Space 開啟
    trigger?.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    content = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    // 關閉
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();

    // 4. 按 ArrowDown 開啟
    trigger?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    content = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();
  });

  it('supports native outside dismissal without stealing focus from the outside clicked element', async () => {
    const items: TierDropdownItemSpec[] = [{ id: 't1', type: 'tier', label: 'T1' }];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // 建立外部 Input 並聚焦
    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    outsideInput.focus();
    expect(document.activeElement).toBe(outsideInput);

    // 觸發 outside pointerdown
    const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    document.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    // 驗證焦點仍停留在 outsideInput（不反搶焦點）
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
    expect(document.activeElement).toBe(outsideInput);
    outsideInput.remove();
  });

  it('maintains ARIA ownership attributes across the ShadowRoot DOM boundary', async () => {
    const items: TierDropdownItemSpec[] = [{ id: 't1', type: 'tier', label: 'T1' }];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    expect(trigger).not.toBeNull();

    // 初始狀態
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');

    // 開啟後
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // 關閉後
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('handles rapid close and immediate reopen cleanly without stale close race conditions', async () => {
    const items: TierDropdownItemSpec[] = [{ id: 't1', type: 'tier', label: 'T1' }];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');

    trigger?.click(); // open
    await nextTick();
    trigger?.click(); // close
    await nextTick();
    trigger?.click(); // reopen
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    const content = portalRoot.querySelector('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
  });

  it('removes teleported triggers and closes overlay when slots are dynamically cleared or removed', async () => {
    const items: TierDropdownItemSpec[] = [{ id: 't1', type: 'tier', label: 'T1' }];

    syncTierSlots([
      { key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() },
      { key: 'slot-2', targetEl: slotEl2, items, onSelect: vi.fn() },
    ]);
    await nextTick();

    expect(slotEl1.querySelector('button.poexd-tier-trigger')).not.toBeNull();
    expect(slotEl2.querySelector('button.poexd-tier-trigger')).not.toBeNull();

    // 模擬動態移除 slot-2
    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    expect(slotEl1.querySelector('button.poexd-tier-trigger')).not.toBeNull();
    expect(slotEl2.querySelector('button.poexd-tier-trigger')).toBeNull();

    // 清空所有 slots
    clearTierSlots();
    await nextTick();

    expect(slotEl1.querySelector('button.poexd-tier-trigger')).toBeNull();
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });

  it('automatically cleans up all Teleported triggers from Light DOM on Vue app unmount', async () => {
    syncTierSlots([
      {
        key: 'slot-1',
        targetEl: slotEl1,
        items: [{ id: 't1', type: 'tier', label: 'T1' }],
        onSelect: vi.fn(),
      },
      {
        key: 'slot-2',
        targetEl: slotEl2,
        items: [{ id: 't2', type: 'tier', label: 'T2' }],
        onSelect: vi.fn(),
      },
    ]);
    await nextTick();

    expect(slotEl1.querySelector('button.poexd-tier-trigger')).not.toBeNull();
    expect(slotEl2.querySelector('button.poexd-tier-trigger')).not.toBeNull();

    app.unmount();
    await nextTick();

    expect(slotEl1.querySelector('button.poexd-tier-trigger')).toBeNull();
    expect(slotEl2.querySelector('button.poexd-tier-trigger')).toBeNull();
  });

  it('uses Foundation runtime tokens for scaling without hardcoded 18px/10px or raw spacing overrides', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 'cat', type: 'switch_category', label: '頭盔 (點選切換)' },
      { id: 't1', type: 'tier', label: 'T1 (10 ~ 20)', valMin: '10', valMax: '20', isRange: true },
    ];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();
    // Ensure no hardcoded legacy geometry overrides
    expect(content?.className).not.toContain('min-w-[260px]');
    expect(content?.className).not.toContain('max-h-[300px]');
    expect(content?.className).not.toContain('max-w-[340px]');
    expect(content?.className).not.toContain('gap-0.5');
    expect(content?.className).toContain('gap-[var(--pxd-space-xs)]');

    const tierRow = content?.querySelector('[data-slot="tier-row"]');
    expect(tierRow?.className).not.toContain('gap-1');
    expect(tierRow?.className).toContain('gap-[var(--pxd-space-xs)]');

    const menuItems = portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]');
    expect(menuItems.length).toBeGreaterThan(0);
    for (const item of Array.from(menuItems)) {
      expect(item.className).not.toContain('h-[18px]');
      expect(item.className).not.toContain('text-[10px]');
      expect(item.className).not.toMatch(/\bpx-2\b/);
      expect(item.className).toContain('min-h-[var(--control-height-sm');
      expect(item.className).toContain('text-[length:var(--control-font-sm');
    }
  });

  it('statically protects Foundation spacing and geometry: no px-* overrides and no raw gap-* classes in TierDropdownHost', () => {
    const filePath = path.resolve(__dirname, '../components/injected/TierDropdownHost.vue');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).not.toMatch(/<DropdownMenuItem[^>]*\bpx-\d+/);
    expect(source).not.toMatch(/\bgap-(?:0\.5|1|2|3|4)\b/);
    expect(source).toContain('gap-[var(--pxd-space-xs)]');
  });

  it('strictly shares existing portalRoot without creating duplicate portals or shadow roots', async () => {
    expect(document.querySelectorAll('#poexd-sidebar-container')).toHaveLength(1);
    expect(shadowRoot.querySelectorAll('#poexd-portal-root')).toHaveLength(1);
    expect(document.querySelectorAll('#poexd-portal-root')).toHaveLength(0);
  });

  it('correctly renders multi-line mod group options with shrink-0, h-auto, border separators, and alternating zebra backgrounds', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 'back', type: 'back_to_tiers', label: '← 返回階級清單' },
      {
        id: 'g0',
        type: 'mod_group_option',
        label: '增加#%能量護盾',
        groupId: 'g0',
        groupIndex: 0,
        isActive: true,
      },
      {
        id: 'g1',
        type: 'mod_group_option',
        label: '增加#%能量護盾\n#最大生命',
        groupId: 'g1',
        groupIndex: 1,
        isActive: false,
      },
    ];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    const menuItems = portalRoot.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]');
    expect(menuItems).toHaveLength(3);

    // Option 0 (active, even)
    const opt0 = menuItems[1];
    expect(opt0.className).toContain('shrink-0');
    expect(opt0.className).toContain('h-auto');
    expect(opt0.className).toContain('border-b');
    expect(opt0.className).toContain('bg-primary/15');

    // Option 1 (inactive, odd -> zebra bg-muted/30)
    const opt1 = menuItems[2];
    expect(opt1.className).toContain('shrink-0');
    expect(opt1.className).toContain('h-auto');
    expect(opt1.className).toContain('border-b');
    expect(opt1.className).toContain('bg-muted/30');
    expect(opt1.textContent).toContain('增加#%能量護盾\n#最大生命');
  });

  it('isolates scroll container for tier items while keeping top category/mod group controls pinned and applies 420px max height', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 'cat', type: 'switch_category', label: '胸甲' },
      { id: 'mod', type: 'switch_mod_group', label: '增加#%能量護盾' },
      { id: 't1', type: 'tier', label: 'T1 (100 ~ 120)' },
      { id: 't2', type: 'tier', label: 'T2 (80 ~ 99)' },
    ];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect: vi.fn() }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();
    // 驗證外層設定 420px 最大高度與 overflow-hidden
    expect(content?.className).toContain('overflow-hidden');
    expect(content?.className).toContain(
      'max-h-[min(var(--pxd-tier-menu-max-height,420px),var(--reka-dropdown-menu-content-available-height,calc(100vh-32px)))]',
    );

    // 驗證第一層 div 為頂部固定區 (shrink-0)
    const fixedTopSection = content?.children[0] as HTMLElement;
    expect(fixedTopSection).toBeDefined();
    expect(fixedTopSection.className).toContain('shrink-0');
    expect(fixedTopSection.querySelectorAll('[data-slot="dropdown-menu-item"]')).toHaveLength(2);

    // 驗證第二層 div 為獨立滾動區 (flex-1 min-h-0 overflow-y-auto pxd-scrollbar)
    const scrollSection = content?.children[1] as HTMLElement;
    expect(scrollSection).toBeDefined();
    expect(scrollSection.className).toContain('flex-1');
    expect(scrollSection.className).toContain('min-h-0');
    expect(scrollSection.className).toContain('overflow-y-auto');
    expect(scrollSection.className).toContain('pxd-scrollbar');
    expect(scrollSection.querySelectorAll('[data-slot="tier-row"]')).toHaveLength(2);
  });

  it('correctly splits tier rows into unclickable tier/level tag, clickable range (min), between, and max buttons', async () => {
    const items: TierDropdownItemSpec[] = [
      {
        id: 't1',
        type: 'tier',
        label: 'T1 (Lv.85) (100 ~ 120)',
        tierName: 'T1',
        tierLevel: 85,
        rangeText: '(100 ~ 120)',
        valMin: '100',
        valMax: '120',
        isRange: true,
      },
      {
        id: 't2',
        type: 'tier',
        label: 'T2 (Lv.70) (50)',
        tierName: 'T2',
        tierLevel: 70,
        rangeText: '(50)',
        valMin: '50',
        isRange: false,
      },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    const tierRows = content?.querySelectorAll<HTMLElement>('[data-slot="tier-row"]');
    expect(tierRows).toHaveLength(2);

    // 檢查 T1 (區間詞綴) 結構
    const row1 = tierRows![0];
    expect(row1.className).toContain('hover:bg-accent/50');
    // 1. 階級與等級 (整行左半部為點擊熱區，可點選填入上方輸入框，懸停具備主題樣式)
    const tag1 = row1.querySelector<HTMLElement>('[data-tier-action="tune"]');
    expect(tag1).not.toBeNull();
    expect(tag1?.textContent?.trim()).toBe('T1 (Lv.85)');
    expect(tag1?.getAttribute('data-slot')).toBeNull(); // 不是 DropdownMenuItem
    expect(tag1?.className).toContain('text-muted-foreground');

    // 2. 三段式數值按鈕組: [min] [~] [max] (無外層括號，固定最小寬度)
    const pill1 = row1.children[1] as HTMLElement;
    const minBtn1 = pill1.querySelector<HTMLElement>('[data-tier-action="min"]');
    const bothBtn1 = pill1.querySelector<HTMLElement>('[data-tier-action="both"]');
    const maxBtn1 = pill1.querySelector<HTMLElement>('[data-tier-action="max"]');
    expect(minBtn1?.textContent?.trim()).toBe('100');
    expect(minBtn1?.className).toContain('min-w-[46px]');
    expect(bothBtn1?.textContent?.trim()).toBe('~');
    expect(bothBtn1?.className).toContain('w-[32px]');
    expect(maxBtn1?.textContent?.trim()).toBe('120');
    expect(maxBtn1?.className).toContain('min-w-[46px]');

    // 檢查 T2 (單值詞綴) 結構: 同樣顯示為 [50] [~] [50]
    const row2 = tierRows![1];
    const tag2 = row2.querySelector<HTMLElement>('[data-tier-action="tune"]');
    expect(tag2).not.toBeNull();
    expect(tag2?.textContent?.trim()).toBe('T2 (Lv.70)');
    expect(tag2?.getAttribute('data-slot')).toBeNull();

    const pill2 = row2.children[1] as HTMLElement;
    const minBtn2 = pill2.querySelector<HTMLElement>('[data-tier-action="min"]');
    const bothBtn2 = pill2.querySelector<HTMLElement>('[data-tier-action="both"]');
    const maxBtn2 = pill2.querySelector<HTMLElement>('[data-tier-action="max"]');
    expect(minBtn2?.textContent?.trim()).toBe('50');
    expect(bothBtn2?.textContent?.trim()).toBe('~');
    expect(maxBtn2?.textContent?.trim()).toBe('50');

    // 點擊 T2 階級標籤，驗證填入上方微調輸入框
    const inputs = content?.querySelectorAll<HTMLInputElement>(
      '[data-slot="tier-tuning-bar"] input',
    );
    expect(inputs).toBeDefined();
    tag2?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(inputs![0].value).toBe('50');
    expect(inputs![1].value).toBe('50');

    // 點擊詞綴範圍驗證觸發 min mode
    minBtn1?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onSelect).toHaveBeenCalledWith(items[0], 'min');
  });

  it('supports custom numeric tuning bar and multi-tier range selection', async () => {
    const items: TierDropdownItemSpec[] = [
      {
        id: 't1',
        type: 'tier',
        label: 'T1 (Lv.85) (10 ~ 20)',
        valMin: '10',
        valMax: '20',
        isRange: true,
      },
      {
        id: 't2',
        type: 'tier',
        label: 'T2 (Lv.75) (7 ~ 12)',
        valMin: '7',
        valMax: '12',
        isRange: true,
      },
      {
        id: 't3',
        type: 'tier',
        label: 'T3 (Lv.65) (3 ~ 8)',
        valMin: '3',
        valMax: '8',
        isRange: true,
      },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    const tuningBar = content?.querySelector<HTMLElement>('[data-slot="tier-tuning-bar"]');
    expect(tuningBar).not.toBeNull();
    // 還原按鈕已被移除
    expect(tuningBar?.querySelector('[data-slot="tuning-reset-btn"]')).toBeNull();

    const inputs = tuningBar?.querySelectorAll<HTMLInputElement>('input');
    expect(inputs).toHaveLength(2);
    const minInput = inputs![0];
    const maxInput = inputs![1];

    const tierRows = content?.querySelectorAll<HTMLElement>('[data-slot="tier-row"]');
    expect(tierRows).toHaveLength(3);

    const tag1 = tierRows![0].querySelector<HTMLButtonElement>('[data-tier-action="tune"]');
    const tag2 = tierRows![1].querySelector<HTMLButtonElement>('[data-tier-action="tune"]');
    const tag3 = tierRows![2].querySelector<HTMLButtonElement>('[data-tier-action="tune"]');

    // 1. 點選第 1 個 T 階級 (T1): T1 亮起，填入 T1 數值 (10 ~ 20)，即時連動 onSelect，選單保持開啟
    tag1?.click();
    await nextTick();
    expect(tierRows![0].className).toContain('bg-primary/15');
    expect(tierRows![1].className).not.toContain('bg-primary/15');
    expect(minInput.value).toBe('10');
    expect(maxInput.value).toBe('20');
    expect(onSelect).toHaveBeenCalledWith(items[0], 'both');
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // 2. 點選第 2 個 T 階級 (T3): T1~T3 區間全亮，填入跨區間最小值 (3) 與最大值 (20)，即時連動
    tag3?.click();
    await nextTick();
    expect(tierRows![0].className).toContain('bg-primary/15');
    expect(tierRows![1].className).toContain('bg-primary/15');
    expect(tierRows![2].className).toContain('bg-primary/15');
    expect(minInput.value).toBe('3');
    expect(maxInput.value).toBe('20');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        valMin: '3',
        valMax: '20',
      }),
      'both',
    );
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // 3. 點選第 3 個 T 階級 (T2): 重新單選 T2，僅 T2 亮起，填入 (7 ~ 12)，即時連動
    tag2?.click();
    await nextTick();
    expect(tierRows![0].className).not.toContain('bg-primary/15');
    expect(tierRows![1].className).toContain('bg-primary/15');
    expect(tierRows![2].className).not.toContain('bg-primary/15');
    expect(minInput.value).toBe('7');
    expect(maxInput.value).toBe('12');
    expect(onSelect).toHaveBeenCalledWith(items[1], 'both');
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).not.toBeNull();

    // 4. 修改 input 自訂數值並點擊套用按鈕：套用並關閉選單
    minInput.value = '15';
    minInput.dispatchEvent(new Event('input', { bubbles: true }));
    maxInput.value = '25';
    maxInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    const applyBtn = tuningBar?.querySelector<HTMLElement>('[data-slot="tuning-apply-btn"]');
    expect(applyBtn).not.toBeNull();
    applyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        valMin: '15',
        valMax: '25',
      }),
      'both',
    );
    expect(portalRoot.querySelector('[data-slot="dropdown-menu-content"]')).toBeNull();
  });
});

describe('Tier Slot Host DOM Ownership & Separator Cleanup Regression', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let uiContainer: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let app: any;

  beforeEach(() => {
    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-sidebar-container';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    uiContainer = document.createElement('div');
    shadowRoot.appendChild(uiContainer);

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    uiContainer.appendChild(appRoot);

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    uiContainer.appendChild(portalRoot);

    const RootComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(TierDropdownHost),
          ]);
      },
    });

    app = createApp(RootComponent);
    app.mount(appRoot);
  });

  afterEach(() => {
    cleanAllTierSlotArtifacts();
    app?.unmount();
    shadowHost?.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('removeTierSlotArtifacts cleans up slot and PoeXD-owned separator while strictly preserving official PoE separator', () => {
    const row = document.createElement('div');
    row.className = 'filter';

    const poeOfficialSep = document.createElement('span');
    poeOfficialSep.className = 'sep poe-official';
    row.appendChild(poeOfficialSep);

    const slotEl = document.createElement('span');
    slotEl.className = 'poexd-tier-trigger-slot';
    slotEl.setAttribute('data-poexd-slot-key', 'slot-key-1');
    row.appendChild(slotEl);

    const poexdSep = document.createElement('span');
    poexdSep.className = 'sep';
    poexdSep.setAttribute('data-poexd-tier-sep', 'slot-key-1');
    row.appendChild(poexdSep);

    const minInput = document.createElement('input');
    minInput.className = 'min-input';
    row.appendChild(minInput);

    document.body.appendChild(row);

    expect(row.querySelectorAll('.sep')).toHaveLength(2);
    expect(row.querySelector('.poexd-tier-trigger-slot')).not.toBeNull();

    removeTierSlotArtifacts(slotEl);

    // slot removed
    expect(row.querySelector('.poexd-tier-trigger-slot')).toBeNull();
    // PoeXD separator removed
    expect(row.querySelector('[data-poexd-tier-sep]')).toBeNull();
    // Official PoE separator remains
    expect(row.querySelector('.poe-official')).not.toBeNull();
    expect(row.querySelectorAll('.sep')).toHaveLength(1);
    expect(row.querySelector('.min-input')).not.toBeNull();
  });

  it('removeTierSlotArtifacts cleans up both left and right separators when slot has no pre-existing separator', () => {
    const row = document.createElement('div');
    row.className = 'filter';

    const sepLeft = document.createElement('span');
    sepLeft.className = 'sep';
    sepLeft.setAttribute('data-poexd-tier-sep', 'slot-key-2');
    row.appendChild(sepLeft);

    const slotEl = document.createElement('span');
    slotEl.className = 'poexd-tier-trigger-slot';
    slotEl.setAttribute('data-poexd-slot-key', 'slot-key-2');
    row.appendChild(slotEl);

    const sepRight = document.createElement('span');
    sepRight.className = 'sep';
    sepRight.setAttribute('data-poexd-tier-sep', 'slot-key-2');
    row.appendChild(sepRight);

    const minInput = document.createElement('input');
    row.appendChild(minInput);
    document.body.appendChild(row);

    expect(row.querySelectorAll('.sep')).toHaveLength(2);

    removeTierSlotArtifacts(slotEl);

    expect(row.querySelector('.poexd-tier-trigger-slot')).toBeNull();
    expect(row.querySelectorAll('.sep')).toHaveLength(0);
  });

  it('handles full lifecycle: valid tier -> invalid tier (cleanup) -> re-valid tier without accumulating separators', () => {
    const row = document.createElement('div');
    row.className = 'filter';

    const poeOfficialSep = document.createElement('span');
    poeOfficialSep.className = 'sep poe-official';
    row.appendChild(poeOfficialSep);

    const minInput = document.createElement('input');
    row.appendChild(minInput);
    document.body.appendChild(row);

    // Initial state: 1 PoE official sep
    expect(row.querySelectorAll('.sep')).toHaveLength(1);

    // 1. Valid tier -> inject slot + sep
    const slotKeyA = 'tier-slot-1-statA';
    const slotElA = document.createElement('span');
    slotElA.className = 'poexd-tier-trigger-slot';
    slotElA.setAttribute('data-poexd-slot-key', slotKeyA);

    const sepSpanA = document.createElement('span');
    sepSpanA.className = 'sep';
    sepSpanA.setAttribute('data-poexd-tier-sep', slotKeyA);

    minInput.parentNode?.insertBefore(sepSpanA, minInput);
    minInput.parentNode?.insertBefore(slotElA, sepSpanA);

    expect(row.querySelectorAll('.sep')).toHaveLength(2);
    expect(row.querySelectorAll('.poexd-tier-trigger-slot')).toHaveLength(1);

    // 2. Tier becomes invalid -> invalidation path calls removeTierSlotArtifacts
    const existingSlot = row.querySelector<HTMLElement>('.poexd-tier-trigger-slot');
    expect(existingSlot).toBe(slotElA);
    removeTierSlotArtifacts(existingSlot);

    // All PoeXD artifacts gone, official sep preserved
    expect(row.querySelector('.poexd-tier-trigger-slot')).toBeNull();
    expect(row.querySelector('[data-poexd-tier-sep]')).toBeNull();
    expect(row.querySelectorAll('.sep')).toHaveLength(1);
    expect(row.querySelector('.poe-official')).not.toBeNull();

    // 3. Tier becomes valid again -> re-inject
    const slotKeyB = 'tier-slot-2-statA';
    const slotElB = document.createElement('span');
    slotElB.className = 'poexd-tier-trigger-slot';
    slotElB.setAttribute('data-poexd-slot-key', slotKeyB);

    const prevSep = minInput.previousElementSibling;
    expect(prevSep?.classList.contains('sep')).toBe(true); // Official sep detected
    const sepSpanB = document.createElement('span');
    sepSpanB.className = 'sep';
    sepSpanB.setAttribute('data-poexd-tier-sep', slotKeyB);

    minInput.parentNode?.insertBefore(sepSpanB, minInput);
    minInput.parentNode?.insertBefore(slotElB, sepSpanB);

    // Exactly 1 slot, exactly 2 seps (1 official + 1 PoeXD-owned), NO accumulation!
    expect(row.querySelectorAll('.poexd-tier-trigger-slot')).toHaveLength(1);
    expect(row.querySelectorAll('.sep')).toHaveLength(2);
    expect(row.querySelectorAll('[data-poexd-tier-sep]')).toHaveLength(1);
    expect(row.querySelector(`[data-poexd-tier-sep="${slotKeyB}"]`)).not.toBeNull();
    expect(row.querySelector('.poe-official')).not.toBeNull();
  });

  it('cleanAllTierSlotArtifacts clears registry, unmounts triggers, and removes all host slots and PoeXD separators', async () => {
    const row1 = document.createElement('div');
    const poeOfficialSep = document.createElement('span');
    poeOfficialSep.className = 'sep poe-official';
    row1.appendChild(poeOfficialSep);

    const slotEl1 = document.createElement('span');
    slotEl1.className = 'poexd-tier-trigger-slot';
    slotEl1.setAttribute('data-poexd-slot-key', 'slot-1');
    row1.appendChild(slotEl1);

    const sep1 = document.createElement('span');
    sep1.className = 'sep';
    sep1.setAttribute('data-poexd-tier-sep', 'slot-1');
    row1.appendChild(sep1);
    document.body.appendChild(row1);

    const row2 = document.createElement('div');
    const slotEl2 = document.createElement('span');
    slotEl2.className = 'poexd-tier-trigger-slot';
    slotEl2.setAttribute('data-poexd-slot-key', 'slot-2');
    row2.appendChild(slotEl2);

    const sep2 = document.createElement('span');
    sep2.className = 'sep';
    sep2.setAttribute('data-poexd-tier-sep', 'slot-2');
    row2.appendChild(sep2);
    document.body.appendChild(row2);

    // Register slots into Vue
    syncTierSlots([
      {
        key: 'slot-1',
        targetEl: slotEl1,
        items: [{ id: 't1', type: 'tier', label: 'T1' }],
        onSelect: vi.fn(),
      },
      {
        key: 'slot-2',
        targetEl: slotEl2,
        items: [{ id: 't2', type: 'tier', label: 'T2' }],
        onSelect: vi.fn(),
      },
    ]);
    await nextTick();

    // Verify Teleported T buttons rendered
    expect(slotEl1.querySelector('button.poexd-tier-trigger')).not.toBeNull();
    expect(slotEl2.querySelector('button.poexd-tier-trigger')).not.toBeNull();

    // Perform global reset / teardown
    cleanAllTierSlotArtifacts();
    await nextTick();

    // 1. Host slots removed
    expect(document.querySelectorAll('.poexd-tier-trigger-slot')).toHaveLength(0);
    // 2. PoeXD separators removed
    expect(document.querySelectorAll('[data-poexd-tier-sep]')).toHaveLength(0);
    // 3. Teleported triggers unmounted and gone
    expect(document.querySelectorAll('button.poexd-tier-trigger')).toHaveLength(0);
    // 4. Official PoE separator preserved
    expect(document.querySelectorAll('.poe-official')).toHaveLength(1);
    // 5. Portal root clean
    expect(portalRoot.querySelectorAll('[data-slot="dropdown-menu-content"]')).toHaveLength(0);
  });
});

describe('Chromium Regressions (Native Reka + Vue Teleport Phase 3)', () => {
  let shadowHost: HTMLElement;
  let shadowRoot: ShadowRoot;
  let uiContainer: HTMLElement;
  let appRoot: HTMLElement;
  let portalRoot: HTMLElement;
  let slotEl1: HTMLElement;
  let app: any;

  beforeEach(() => {
    slotEl1 = document.createElement('span');
    slotEl1.className = 'poexd-tier-trigger-slot';
    slotEl1.setAttribute('data-poexd-slot-key', 'slot-1');
    document.body.appendChild(slotEl1);

    shadowHost = document.createElement('div');
    shadowHost.id = 'poexd-sidebar-container';
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    uiContainer = document.createElement('div');
    shadowRoot.appendChild(uiContainer);

    appRoot = document.createElement('div');
    appRoot.id = 'poexd-app-root';
    uiContainer.appendChild(appRoot);

    portalRoot = document.createElement('div');
    portalRoot.id = 'poexd-portal-root';
    uiContainer.appendChild(portalRoot);

    const RootComponent = defineComponent({
      setup() {
        return () =>
          h(ConfigProvider, { teleportTo: portalRoot, scrollBody: false }, () => [
            h(TierDropdownHost),
          ]);
      },
    });

    app = createApp(RootComponent);
    app.mount(appRoot);
  });

  afterEach(() => {
    cleanAllTierSlotArtifacts();
    app?.unmount();
    shadowHost?.remove();
    slotEl1?.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('regression (Issue 1): injectCustomStyles ensures .poexd-tier-trigger-slot has display: table-cell and vertical-align: middle for PoE host table layout', () => {
    const enhancements = createFilterDomEnhancements('poe1');
    enhancements.initialize();

    const styleEl = document.getElementById('poexd-custom-style') as HTMLStyleElement;
    expect(styleEl).not.toBeNull();
    const css = styleEl.textContent || '';
    expect(css).toContain('.poexd-tier-trigger-slot');
    expect(css).toMatch(/\.poexd-tier-trigger-slot\s*\{[^}]*display:\s*table-cell\s*!important/);
    expect(css).toMatch(/\.poexd-tier-trigger-slot\s*\{[^}]*position:\s*relative\s*!important/);
    expect(css).toMatch(/\.poexd-tier-trigger-slot\s*\{[^}]*vertical-align:\s*middle\s*!important/);
    expect(css).toMatch(/\.poexd-tier-trigger-slot\s*\{[^}]*white-space:\s*nowrap\s*!important/);
    expect(css).toMatch(/\.poexd-tier-trigger-slot\s*\{[^}]*width:\s*20px\s*!important/);

    enhancements.cleanup();
  });

  it('upsertTierSlot replaces activeTierSlots with a new array reference for shallowRef reactivity', () => {
    clearTierSlots();
    const initialDesc = {
      key: 'slot-1',
      targetEl: slotEl1,
      items: [{ id: 't1', type: 'tier' as const, label: 'T1' }],
      onSelect: vi.fn(),
    };
    syncTierSlots([initialDesc]);
    const prevArray = activeTierSlots.value;

    const updatedDesc = {
      ...initialDesc,
      items: [{ id: 't2', type: 'tier' as const, label: 'T2' }],
    };
    upsertTierSlot(updatedDesc);

    // Array reference must be different (immutable replacement)
    expect(activeTierSlots.value).not.toBe(prevArray);
    expect(activeTierSlots.value[0].items[0].label).toBe('T2');
  });

  it('regression (Issue 2): refreshAndReopenTierSlot coordinates category update and native trigger reopening via production refreshTierSlotDomain and immutable upsertTierSlot', async () => {
    const origChrome = (globalThis as any).chrome;
    const origFetch = globalThis.fetch;

    const sampleMods = {
      'stat.test': [
        { affinities: ['normal'], level: 84, types: ['bow'], values: [[10, 20]] },
        { affinities: ['normal'], level: 84, types: ['helmet'], values: [[30, 40]] },
      ],
    };
    (globalThis as any).chrome = {
      runtime: {
        getURL: (p: string) => p,
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => sampleMods,
    }) as any;
    setAffixLexiconMockData('poe1', sampleMods as never);

    try {
      const enhancements = createFilterDomEnhancements('poe1');
      enhancements.initialize();

      // 1. 建立真實 PoE Filter DOM 結構，包住 slotEl1
      const filterRow = document.createElement('div');
      filterRow.className = 'filter';
      filterRow.setAttribute('data-poexd-stat-id', 'stat.test');
      filterRow.setAttribute('data-poexd-category', 'bow');

      const minContainer = document.createElement('div');
      minContainer.className = 'min';
      const minInput = document.createElement('input');
      minContainer.appendChild(minInput);
      filterRow.appendChild(minContainer);
      filterRow.appendChild(slotEl1);
      document.body.appendChild(filterRow);

      // 初始載入並同步 slot-1
      await refreshTierSlot('slot-1');
      await nextTick();

      const triggerBtn = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
      expect(triggerBtn).not.toBeNull();
      const clickSpy = vi.spyOn(triggerBtn!, 'click');

      // 2. 模擬使用者透過 Type Modal 切換類別為 helmet (更新 live DOM 屬性)
      filterRow.setAttribute('data-poexd-category', 'helmet');

      // 3. 呼叫 refreshAndReopenTierSlot 走真正的 production path (refreshTierSlotDomain -> upsertTierSlot -> nextTick -> click)
      const success = await refreshAndReopenTierSlot('slot-1');
      expect(success).toBe(true);

      // 驗證 trigger click 被確定性觸發
      expect(clickSpy).toHaveBeenCalledTimes(1);

      // 4. 驗證 Tier Dropdown Content 確實呈現 category B (頭盔) 的資料，證明 shallowRef 成功響應更新
      await nextTick();
      triggerBtn?.click();
      await nextTick();

      const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      expect(content).not.toBeNull();
      expect(content?.textContent).not.toContain('目前類別：');
      expect(content?.textContent).toContain('頭盔');
      expect(content?.textContent).toContain('點選切換');
      expect(content?.textContent).toContain('30 ~ 40');

      enhancements.cleanup();
    } finally {
      (globalThis as any).chrome = origChrome;
      globalThis.fetch = origFetch;
      setAffixLexiconMockData('poe1', null);
    }
  });

  it('regression (Issue 3): "此詞綴無可用的物品類別 T 階" renders as disabled DropdownMenuItem size="sm" complying with UI Foundation Collection profile', async () => {
    const items: TierDropdownItemSpec[] = [
      { id: 'no-types', type: 'header', label: '此詞綴無可用的物品類別 T 階' },
    ];
    const onSelect = vi.fn();

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    expect(trigger).not.toBeNull();
    trigger?.click();
    await nextTick();

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    // 1. Must NOT render as legacy DropdownMenuLabel
    const labelEl = content?.querySelector('[data-slot="dropdown-menu-label"]');
    expect(labelEl).toBeNull();

    // 2. Must render as DropdownMenuItem with disabled attribute and Collection sm profile classes
    const itemEl = content?.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]');
    expect(itemEl).not.toBeNull();
    expect(itemEl?.textContent).toContain('此詞綴無可用的物品類別 T 階');
    expect(itemEl?.getAttribute('data-disabled')).toBe('');
    expect(itemEl?.className).toContain('cursor-default');
    expect(itemEl?.className).toContain('text-muted-foreground');
    // Collection item profile sm sizing tokens
    expect(itemEl?.className).toContain('min-h-[var(--control-height-sm');
    expect(itemEl?.className).toContain('px-[var(--control-padding-x-sm');
  });

  it('regression (BUG 2): per-filter category isolation and non-destructive category switching', async () => {
    const origChrome = (globalThis as any).chrome;
    const origFetch = globalThis.fetch;

    const sampleMods = {
      'stat.test': [
        { affinities: ['normal'], level: 84, types: ['bow'], values: [[10, 20]] },
        { affinities: ['normal'], level: 84, types: ['helmet'], values: [[30, 40]] },
      ],
    };
    (globalThis as any).chrome = {
      runtime: {
        getURL: (p: string) => p,
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => sampleMods,
    }) as any;
    setAffixLexiconMockData('poe1', sampleMods as never);

    try {
      const enhancements = createFilterDomEnhancements('poe1');
      enhancements.initialize();

      // 1. 建立 Filter A (bow) 與 Filter B (helmet) DOM
      const filterGroup = document.createElement('div');
      filterGroup.className = 'filter-group';
      filterGroup.setAttribute('data-poexd-group-idx', '0');

      const filterA = document.createElement('div');
      filterA.className = 'filter';
      filterA.setAttribute('data-poexd-filter-idx', '0');
      filterA.setAttribute('data-poexd-stat-id', 'stat.test');
      filterA.setAttribute('data-poexd-category', 'bow');
      const minContainerA = document.createElement('div');
      minContainerA.className = 'min';
      filterA.appendChild(minContainerA);
      filterA.appendChild(slotEl1);
      filterGroup.appendChild(filterA);

      const filterB = document.createElement('div');
      filterB.className = 'filter';
      filterB.setAttribute('data-poexd-filter-idx', '1');
      filterB.setAttribute('data-poexd-stat-id', 'stat.test');
      filterB.setAttribute('data-poexd-category', 'helmet');
      const minContainerB = document.createElement('div');
      minContainerB.className = 'min';
      filterB.appendChild(minContainerB);

      const slotEl2 = document.createElement('span');
      slotEl2.className = 'poexd-tier-trigger-slot';
      slotEl2.setAttribute('data-poexd-slot-key', 'slot-2');
      filterB.appendChild(slotEl2);
      filterGroup.appendChild(filterB);

      document.body.appendChild(filterGroup);

      // 初始同步兩個 slots
      await refreshTierSlot('slot-1');
      await refreshTierSlot('slot-2');
      await nextTick();

      // 2. 開啟 A 的 Tier Dropdown -> 驗證顯示「弓 (點選切換)」
      const triggerA = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
      expect(triggerA).not.toBeNull();
      triggerA?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      let content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      expect(content?.textContent).not.toContain('目前類別：');
      expect(content?.textContent).toContain('弓');
      expect(content?.textContent).toContain('點選切換');

      // 3. 點選「切換類別」
      const switchItem = content?.querySelector<HTMLElement>('[data-slot="dropdown-menu-item"]');
      expect(switchItem?.textContent).toContain('點選切換');
      switchItem?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      // 驗證 A: 切換操作不應先清空 Filter A 的原 category (仍然保留 bow)
      expect(filterA.getAttribute('data-poexd-category')).toBe('bow');

      // 驗證 B: selecting target snapshot 攜帶 currentCategory
      const selectingTarget = (window as any).__poexd_selecting_target__;
      expect(selectingTarget).toBeTruthy();
      expect(selectingTarget.slotKey).toBe('slot-1');
      expect(selectingTarget.currentCategory).toBe('bow');

      // 4. 模擬使用者取消/關閉 Dialog -> 再次點開 A 的 Tier trigger，A 仍為「弓 (點選切換)」
      (window as any).__poexd_selecting_target__ = null;
      await refreshTierSlot('slot-1');
      await nextTick();
      triggerA?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      expect(content?.textContent).not.toContain('目前類別：');
      expect(content?.textContent).toContain('弓');
      expect(content?.textContent).toContain('點選切換');

      // 5. 操作 Filter B 的 Tier trigger -> B 顯示「頭盔 (點選切換)」
      const triggerB = slotEl2.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
      expect(triggerB).not.toBeNull();
      triggerB?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));

      content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      expect(content?.textContent).not.toContain('目前類別：');
      expect(content?.textContent).toContain('頭盔');
      expect(content?.textContent).toContain('點選切換');

      // 6. 再次回到 Filter A，A 必須仍為「弓 (點選切換)」，未被 B 污染
      triggerA?.click();
      await nextTick();
      await new Promise((r) => setTimeout(r, 50));
      content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
      expect(content?.textContent).not.toContain('目前類別：');
      expect(content?.textContent).toContain('弓');
      expect(content?.textContent).toContain('點選切換');

      enhancements.cleanup();
    } finally {
      (globalThis as any).chrome = origChrome;
      globalThis.fetch = origFetch;
      setAffixLexiconMockData('poe1', null);
    }
  });

  it('無數值之定性階級右側不顯示按鈕且無重複文字，整行可點選選取，且無數值時頂部微調列不顯示', async () => {
    const onSelect = vi.fn();
    const items: TierDropdownItemSpec[] = [
      {
        id: 't1',
        type: 'tier',
        label: 'T1 (Lv.55)',
        tierName: 'T1',
        tierLevel: 55,
        valMin: '',
        valMax: '',
      },
    ];

    syncTierSlots([{ key: 'slot-1', targetEl: slotEl1, items, onSelect }]);
    await nextTick();

    const trigger = slotEl1.querySelector<HTMLButtonElement>('button.poexd-tier-trigger');
    trigger?.click();
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const content = portalRoot.querySelector<HTMLElement>('[data-slot="dropdown-menu-content"]');
    expect(content).not.toBeNull();

    // 1. 全無數值時，頂部自訂微調列不顯示
    expect(content?.querySelector('[data-slot="tier-tuning-bar"]')).toBeNull();

    // 2. 右側三段式數值按鈕組與任何 data-tier-action 按鈕不顯示
    expect(content?.querySelector('[data-tier-action="min"]')).toBeNull();
    expect(content?.querySelector('[data-tier-action="both"]')).toBeNull();
    expect(content?.querySelector('[data-tier-action="max"]')).toBeNull();

    // 3. 階級整行存在，左側正確顯示 T1 (Lv.55)，且無任何重複的 T1 文字或按鈕
    const tierRow = content?.querySelector<HTMLElement>('[data-slot="tier-row"]');
    expect(tierRow).not.toBeNull();
    expect(tierRow?.textContent?.trim()).toBe('T1 (Lv.55)');

    // 4. 點選該行，可正常觸發 onSelect 且整行亮起
    tierRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    await new Promise((r) => setTimeout(r, 60));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1', valMin: '', valMax: '' }),
      'both',
    );
    expect(tierRow?.classList.contains('bg-primary/15')).toBe(true);
  });
});
