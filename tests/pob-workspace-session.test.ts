import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import type { BuildView, ShoppingRow } from '@/components/sidebar/pob-build/usePobBuild';
import {
  HOVER_OPEN_DELAY_MS,
  HOVER_WARM_WINDOW_MS,
  usePobWorkspaceSession,
  type PobWorkspaceTimer,
} from '@/components/sidebar/pob-build/usePobWorkspaceSession';

interface FakeTimers extends PobWorkspaceTimer {
  advanceBy: (ms: number) => void;
  pendingCount: () => number;
}

function createFakeTimers(): FakeTimers {
  let now = 0;
  let nextId = 1;
  const tasks = new Map<number, { runAt: number; callback: () => void }>();

  return {
    setTimeout(callback, ms) {
      const id = nextId++;
      tasks.set(id, { runAt: now + ms, callback });
      return id;
    },
    clearTimeout(handle) {
      if (typeof handle === 'number') tasks.delete(handle);
    },
    advanceBy(ms) {
      now += ms;
      while (true) {
        let earliestId: number | undefined;
        let earliestRunAt = Number.POSITIVE_INFINITY;
        for (const [id, task] of tasks) {
          if (task.runAt <= now && task.runAt < earliestRunAt) {
            earliestId = id;
            earliestRunAt = task.runAt;
          }
        }
        if (earliestId === undefined) break;
        const task = tasks.get(earliestId)!;
        tasks.delete(earliestId);
        task.callback();
      }
    },
    pendingCount: () => tasks.size,
  };
}

function makeRareGloves(overrides: Partial<ShoppingRow> = {}): ShoppingRow {
  return {
    key: 'k-gloves',
    kind: 'equipment',
    label: '巨獸護手',
    englishName: 'Leviathan Gauntlets',
    slot: 'Gloves',
    rarity: 'RARE',
    mods: [
      {
        text: '+100 to maximum Life',
        kind: 'explicit',
        searched: true,
        stat: {
          id: 'explicit.stat_life',
          value: 100,
          defaultEnabled: true,
          pseudo: [{ id: 'pseudo.pseudo_total_life', weight: 1 }],
        },
      },
      {
        text: '+40% to Fire Resistance',
        kind: 'explicit',
        searched: true,
        stat: {
          id: 'explicit.stat_fire_res',
          value: 40,
          defaultEnabled: true,
        },
      },
    ],
    count: 1,
    searchBase: { type: 'Leviathan Gauntlets' },
    query: { type: 'Leviathan Gauntlets' },
    done: false,
    filters: [
      {
        id: 'explicit.stat_life',
        key: 'explicit.stat_life',
        value: 100,
        enabled: true,
        min: 80,
        customized: false,
      },
      {
        id: 'explicit.stat_fire_res',
        key: 'explicit.stat_fire_res',
        value: 40,
        enabled: true,
        min: 32,
        customized: false,
      },
    ],
    pseudo: false,
    searchCustomized: false,
    searchOverride: false,
    ...overrides,
  };
}

function makeUniqueShield(overrides: Partial<ShoppingRow> = {}): ShoppingRow {
  return {
    key: 'k-shield',
    kind: 'unique',
    label: '鳳凰的崛起',
    englishName: 'Rise of the Phoenix',
    slot: 'Weapon 2',
    rarity: 'UNIQUE',
    mods: [],
    count: 1,
    searchBase: { name: 'Rise of the Phoenix' },
    query: { name: 'Rise of the Phoenix' },
    done: false,
    filters: [],
    pseudo: false,
    searchCustomized: false,
    searchOverride: false,
    ...overrides,
  };
}

function makeFlaskRow(overrides: Partial<ShoppingRow> = {}): ShoppingRow {
  return {
    key: 'k-flask',
    kind: 'equipment',
    label: '紅玉藥劑',
    englishName: 'Ruby Flask',
    slot: 'Flask 1',
    rarity: 'MAGIC',
    mods: [{ text: '20% increased Duration', kind: 'explicit', searched: false }],
    count: 1,
    searchBase: { type: 'Ruby Flask' },
    query: { type: 'Ruby Flask' },
    done: false,
    filters: [],
    pseudo: false,
    searchCustomized: false,
    searchOverride: false,
    ...overrides,
  };
}

function makeJewelRow(overrides: Partial<ShoppingRow> = {}): ShoppingRow {
  return {
    key: 'k-jewel',
    kind: 'equipment',
    label: '三相珠寶',
    englishName: "Watcher's Eye",
    slot: 'Jewel 1',
    rarity: 'UNIQUE',
    mods: [{ text: '+5% to maximum Life', kind: 'explicit', searched: false }],
    count: 1,
    searchBase: { name: "Watcher's Eye" },
    query: { name: "Watcher's Eye" },
    done: false,
    filters: [],
    pseudo: false,
    searchCustomized: false,
    searchOverride: false,
    ...overrides,
  };
}

function makeGemRow(overrides: Partial<ShoppingRow> = {}): ShoppingRow {
  return {
    key: 'k-gem',
    kind: 'gem',
    label: '懲戒',
    englishName: 'Punishment',
    level: 20,
    quality: 20,
    gemLevelMin: 20,
    gemQualityMin: 20,
    count: 1,
    searchBase: { type: 'Punishment' },
    query: { type: 'Punishment' },
    done: false,
    filters: [],
    pseudo: false,
    searchCustomized: false,
    searchOverride: false,
    ...overrides,
  };
}

function makeBuild(overrides: Partial<BuildView> = {}): BuildView {
  return {
    id: 'b1',
    name: 'RF Chieftain',
    collapsed: false,
    itemSetOptions: [{ id: '1', title: 'Endgame', position: 1 }],
    skillSetOptions: [{ id: '1', title: 'Endgame', position: 1 }],
    itemSetId: '1',
    skillSetId: '1',
    groups: [
      {
        id: 'equipment',
        kind: 'equipment',
        rows: [makeUniqueShield(), makeRareGloves(), makeFlaskRow(), makeJewelRow()],
      },
      {
        id: 'gem:Body Armour',
        kind: 'gem',
        slot: 'Body Armour',
        rows: [makeGemRow()],
      },
    ],
    progress: { done: 0, total: 5 },
    hideDone: false,
    removedCount: 0,
    searchDefaults: {},
    ...overrides,
  };
}

const formatRowDetail = (entry: {
  kind: string;
  level?: number;
  quality?: number;
  slot?: string;
}) =>
  entry.kind === 'gem' ? `Lv.${entry.level ?? 1} / ${entry.quality ?? 0}%` : (entry.slot ?? '');

describe('usePobWorkspaceSession', () => {
  describe('workspace projection', () => {
    it('filters builds by localized label, English name, or formatted detail and drops empty builds', () => {
      const builds = ref<BuildView[]>([
        makeBuild(),
        makeBuild({
          id: 'b2',
          name: 'Other',
          groups: [
            {
              id: 'gem:Boots',
              kind: 'gem',
              slot: 'Boots',
              rows: [
                makeGemRow({
                  key: 'k-other',
                  label: '火球',
                  englishName: 'Fireball',
                  level: 1,
                  quality: 0,
                }),
              ],
            },
          ],
        }),
      ]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
      });

      expect(session.isFiltering.value).toBe(false);
      expect(session.visibleBuilds.value).toHaveLength(2);

      // Localized label
      searchQuery.value = '巨獸';
      expect(session.isFiltering.value).toBe(true);
      expect(session.visibleBuilds.value.map((b) => b.id)).toEqual(['b1']);
      expect(
        session.visibleBuilds.value[0].groups.flatMap((g) => g.rows.map((r) => r.key)),
      ).toEqual(['k-gloves']);

      // English name (case-insensitive)
      searchQuery.value = '  punishment  ';
      expect(session.visibleBuilds.value.map((b) => b.id)).toEqual(['b1']);
      expect(session.visibleBuilds.value[0].groups[0].rows.map((r) => r.key)).toEqual(['k-gem']);

      // Formatted detail
      searchQuery.value = 'Lv.1 / 0%';
      expect(session.visibleBuilds.value.map((b) => b.id)).toEqual(['b2']);

      session.dispose();
    });

    it('derives categories in canonical order, falls back invalid selection to all, and bypasses category during search', () => {
      const abyssJewel = makeJewelRow({ key: 'k-abyss', slot: 'Belt Abyssal Socket 1' });
      const build = makeBuild({
        groups: [
          {
            id: 'equipment',
            kind: 'equipment',
            rows: [makeRareGloves(), makeFlaskRow(), abyssJewel],
          },
          { id: 'gem:Body Armour', kind: 'gem', slot: 'Body Armour', rows: [makeGemRow()] },
        ],
      });
      const builds = ref<BuildView[]>([build]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
      });

      expect(session.buildCategories(build)).toEqual(['gear', 'flask', 'jewel', 'gem']);
      expect(session.activeCategory(build)).toBe('all');

      session.setViewMode('b1', 'list');
      session.setActiveCategory('b1', 'jewel');
      expect(session.activeCategory(build)).toBe('jewel');
      expect(session.listGroups(build).flatMap((g) => g.rows.map((r) => r.key))).toEqual([
        'k-abyss',
      ]);

      // Unavailable category falls back to 'all'
      const noFlaskBuild = makeBuild({
        groups: [{ id: 'gem:Body Armour', kind: 'gem', slot: 'Body Armour', rows: [makeGemRow()] }],
      });
      session.setActiveCategory('b1', 'flask');
      expect(session.activeCategory(noFlaskBuild)).toBe('all');

      // Search bypasses active category filter
      session.setActiveCategory('b1', 'flask');
      searchQuery.value = 'Punishment';
      const visible = session.visibleBuilds.value[0];
      expect(session.filteredGroups(visible).flatMap((g) => g.rows.map((r) => r.key))).toEqual([
        'k-gem',
      ]);

      session.dispose();
    });

    it('enforces gear-vs-list view mode rules and bypasses group collapse when searching or category-filtering', () => {
      const buildWithEquip = makeBuild();
      const gemsOnlyBuild = makeBuild({
        id: 'b-gems',
        groups: [{ id: 'gem:Body Armour', kind: 'gem', slot: 'Body Armour', rows: [makeGemRow()] }],
      });
      const builds = ref<BuildView[]>([buildWithEquip, gemsOnlyBuild]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
      });

      // Default gear view when equipment exists; list view when no equipment
      expect(session.hasEquipment(buildWithEquip)).toBe(true);
      expect(session.viewMode(buildWithEquip)).toBe('gear');
      expect(session.isGearView(buildWithEquip)).toBe(true);
      expect(session.listGroups(buildWithEquip).map((g) => g.kind)).toEqual(['gem']);

      expect(session.hasEquipment(gemsOnlyBuild)).toBe(false);
      expect(session.viewMode(gemsOnlyBuild)).toBe('list');
      expect(session.isGearView(gemsOnlyBuild)).toBe(false);

      // Switch to list view
      session.setViewMode('b1', 'list');
      expect(session.viewMode(buildWithEquip)).toBe('list');
      expect(session.listGroups(buildWithEquip).map((g) => g.kind)).toEqual(['equipment', 'gem']);

      // Group collapse is respected in default state, bypassed on category filter or search
      session.toggleGroupCollapsed('b1', 'gem:Body Armour');
      expect(session.isGroupCollapsed(buildWithEquip, 'gem:Body Armour')).toBe(true);

      session.setActiveCategory('b1', 'gem');
      expect(session.isGroupCollapsed(buildWithEquip, 'gem:Body Armour')).toBe(false);

      session.setActiveCategory('b1', 'all');
      expect(session.isGroupCollapsed(buildWithEquip, 'gem:Body Armour')).toBe(true);

      // Search forces list presentation and bypasses collapse
      session.setViewMode('b1', 'gear');
      searchQuery.value = 'Punishment';
      expect(session.isGearView(buildWithEquip)).toBe(false);
      expect(session.isGroupCollapsed(buildWithEquip, 'gem:Body Armour')).toBe(false);

      session.dispose();
    });
  });

  describe('preview hover, pin, socket, and auto-close state machine', () => {
    it('opens after 150ms hover, closes immediately on leave, and opens next item immediately within 300ms warm window', () => {
      const timers = createFakeTimers();
      const builds = ref<BuildView[]>([makeBuild()]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
        timers,
      });

      const gloves = builds.value[0].groups[0].rows[1];
      const flask = builds.value[0].groups[0].rows[2];
      const shield = builds.value[0].groups[0].rows[0]; // no mods, no searchOverride -> not previewable

      // Non-previewable or null anchor does nothing
      session.hoverPreview('b1', shield, 'anchor-shield');
      session.hoverPreview('b1', gloves, null);
      timers.advanceBy(500);
      expect(session.isPreviewOpen.value).toBe(false);

      // Leaving before open delay cancels opening and does NOT start warm window
      session.hoverPreview('b1', gloves, 'anchor-gloves');
      timers.advanceBy(HOVER_OPEN_DELAY_MS - 1);
      session.leavePreviewTrigger();
      expect(session.isPreviewOpen.value).toBe(false);
      session.hoverPreview('b1', flask, 'anchor-flask');
      expect(session.isPreviewOpen.value).toBe(false);
      session.leavePreviewTrigger();

      // Cold hover opens at exact delay
      session.hoverPreview('b1', gloves, 'anchor-gloves');
      timers.advanceBy(HOVER_OPEN_DELAY_MS - 1);
      expect(session.isPreviewOpen.value).toBe(false);

      timers.advanceBy(1);
      expect(session.isPreviewOpen.value).toBe(true);
      expect(session.previewPinned.value).toBe(false);
      expect(session.previewAnchor.value).toBe('anchor-gloves');
      expect(session.isPreviewActive('b1', 'k-gloves')).toBe(true);

      // Leaving trigger closes unpinned preview immediately (no grace delay)
      session.leavePreviewTrigger();
      expect(session.isPreviewOpen.value).toBe(false);
      expect(session.previewAnchor.value).toBeNull();

      // Hovering next item within warm window opens immediately (0ms)
      timers.advanceBy(HOVER_WARM_WINDOW_MS - 1);
      session.hoverPreview('b1', flask, 'anchor-flask');
      expect(session.isPreviewOpen.value).toBe(true);
      expect(session.previewPinned.value).toBe(false);
      expect(session.isPreviewActive('b1', 'k-flask')).toBe(true);
      expect(session.previewAnchor.value).toBe('anchor-flask');

      // After warm window expires, next hover returns to cold 150ms delay
      session.leavePreviewTrigger();
      expect(session.isPreviewOpen.value).toBe(false);
      timers.advanceBy(HOVER_WARM_WINDOW_MS);
      session.hoverPreview('b1', gloves, 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(false);
      timers.advanceBy(HOVER_OPEN_DELAY_MS - 1);
      expect(session.isPreviewOpen.value).toBe(false);
      timers.advanceBy(1);
      expect(session.isPreviewOpen.value).toBe(true);

      session.dispose();
    });

    it('pins on toggle of hovered item, blocks hover switches while pinned, and closes on second toggle', () => {
      const timers = createFakeTimers();
      const builds = ref<BuildView[]>([makeBuild()]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
        timers,
      });

      const gloves = builds.value[0].groups[0].rows[1];
      const flask = builds.value[0].groups[0].rows[2];

      // Open via hover
      session.hoverPreview('b1', gloves, 'anchor-gloves');
      timers.advanceBy(HOVER_OPEN_DELAY_MS);
      expect(session.isPreviewActive('b1', 'k-gloves')).toBe(true);
      expect(session.previewPinned.value).toBe(false);
      expect(session.isPreviewPinned('b1', 'k-gloves')).toBe(false);
      expect(session.pinnedPreviewKey('b1')).toBeUndefined();

      // Toggle while hovered -> pins instead of closing
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.previewPinned.value).toBe(true);
      expect(session.isPreviewActive('b1', 'k-gloves')).toBe(true);
      expect(session.isPreviewPinned('b1', 'k-gloves')).toBe(true);
      expect(session.pinnedPreviewKey('b1')).toBe('k-gloves');
      expect(session.pinnedPreviewKey('b2')).toBeUndefined();

      // Leaving trigger or hovering another item does not replace or close pinned preview
      session.leavePreviewTrigger();
      session.hoverPreview('b1', flask, 'anchor-flask');
      timers.advanceBy(1000);
      expect(session.isPreviewActive('b1', 'k-gloves')).toBe(true);
      expect(session.previewAnchor.value).toBe('anchor-gloves');

      // Second toggle closes pinned preview
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(false);
      expect(session.previewPinned.value).toBe(false);

      // pinPreview() keeps preview open across subsequent leavePreviewTrigger
      session.hoverPreview('b1', gloves, 'anchor-gloves');
      timers.advanceBy(HOVER_OPEN_DELAY_MS);
      session.pinPreview();
      session.leavePreviewTrigger();
      expect(session.isPreviewOpen.value).toBe(true);
      expect(session.previewPinned.value).toBe(true);

      session.dispose();
    });

    it('opens socketed gem preview even when parent gem group is collapsed and upgrades hovered gem to fromSocket', async () => {
      const timers = createFakeTimers();
      const builds = ref<BuildView[]>([makeBuild()]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
        timers,
      });

      // Hover gem in expanded list, then click its socket overlay -> pins with fromSocket = true
      const gem = builds.value[0].groups[1].rows[0];
      session.hoverPreview('b1', gem, 'anchor-gem-row');
      timers.advanceBy(HOVER_OPEN_DELAY_MS);
      expect(session.activePreviewTarget.value?.fromSocket).toBeUndefined();

      session.selectSocketContent(
        builds.value[0],
        { kind: 'gem', label: '懲戒', rowKey: 'k-gem' },
        'anchor-gloves-tile',
      );
      expect(session.previewPinned.value).toBe(true);
      expect(session.activePreviewTarget.value?.fromSocket).toBe(true);

      // Collapsing the parent gem group keeps a fromSocket preview open
      session.toggleGroupCollapsed('b1', 'gem:Body Armour');
      await nextTick();
      expect(session.isGroupCollapsed(builds.value[0], 'gem:Body Armour')).toBe(true);
      expect(session.isPreviewOpen.value).toBe(true);
      expect(session.isPreviewActive('b1', 'k-gem')).toBe(true);

      // Closing and reopening directly from socket while group is collapsed works
      session.closePreview();
      session.selectSocketContent(
        builds.value[0],
        { kind: 'gem', label: '懲戒', rowKey: 'k-gem' },
        'anchor-gloves-tile',
      );
      await nextTick();
      expect(session.isPreviewOpen.value).toBe(true);
      expect(session.previewPinned.value).toBe(true);
      expect(session.activePreviewTarget.value?.fromSocket).toBe(true);
      expect(session.previewAnchor.value).toBe('anchor-gloves-tile');

      session.dispose();
    });

    it('auto-closes when target row disappears, view mode changes on active build, or search filtering toggles', async () => {
      const builds = ref<BuildView[]>([makeBuild(), makeBuild({ id: 'b2', name: 'Second Build' })]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
      });

      // 1. View mode change on different build keeps preview open; on same build closes it
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(true);
      session.setViewMode('b2', 'list');
      expect(session.isPreviewOpen.value).toBe(true);
      session.setViewMode('b1', 'list');
      expect(session.isPreviewOpen.value).toBe(false);

      // 2. Collapsing parent gem group closes non-socket preview
      session.togglePreview('b1', 'k-gem', 'anchor-gem');
      expect(session.isPreviewOpen.value).toBe(true);
      session.toggleGroupCollapsed('b1', 'gem:Body Armour');
      await nextTick();
      expect(session.isPreviewOpen.value).toBe(false);
      expect(session.activePreviewTarget.value).toBeNull();

      // Expand again and test entering search filtering
      session.toggleGroupCollapsed('b1', 'gem:Body Armour');
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(true);
      searchQuery.value = 'Leviathan';
      await nextTick();
      expect(session.isPreviewOpen.value).toBe(false);

      // 3. Open while filtering, then leave filtering -> closes preview
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(true);
      searchQuery.value = '';
      await nextTick();
      expect(session.isPreviewOpen.value).toBe(false);

      // 4. Collapsing the build closes preview and clears anchor
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(true);
      builds.value = [{ ...builds.value[0], collapsed: true }, builds.value[1]];
      await nextTick();
      expect(session.isPreviewOpen.value).toBe(false);
      expect(session.activePreviewTarget.value).toBeNull();
      expect(session.previewAnchor.value).toBeNull();

      // Restore build expanded, then switch from open preview to a non-visible key -> anchor cleared
      builds.value = [{ ...builds.value[0], collapsed: false }, builds.value[1]];
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(true);
      session.togglePreview('b1', 'k-missing', 'anchor-missing');
      expect(session.isPreviewOpen.value).toBe(false);
      expect(session.previewAnchor.value).toBeNull();

      // 5. Build deletion closes preview
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isPreviewOpen.value).toBe(true);
      builds.value = [builds.value[1]];
      await nextTick();
      expect(session.isPreviewOpen.value).toBe(false);
      expect(session.activePreviewTarget.value).toBeNull();

      session.dispose();
    });
  });

  describe('instance-scoped per-entry draft store', () => {
    it('retains drafts across close/reopen, derives live effective row and modified state, and normalizes on save', () => {
      const builds = ref<BuildView[]>([makeBuild({ searchDefaults: { statPercent: 80 } })]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
      });

      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.activePreviewDefaults.value).toEqual({ statPercent: 80 });
      expect(session.isActiveDraftModified.value).toBe(false);
      expect(session.saveActiveDraft()).toBeNull();

      // Mutate active draft
      session.updateActiveDraft((draft) => ({
        ...draft,
        pseudo: true,
        stats: {
          ...draft.stats,
          'explicit.stat_life': { ...draft.stats?.['explicit.stat_life'], min: 95 },
        },
      }));

      expect(session.isActiveDraftModified.value).toBe(true);
      expect(session.activeEffectiveRow.value?.pseudo).toBe(true);
      expect(
        session.activeEffectiveRow.value?.filters.find((f) => f.key === 'explicit.stat_life')?.min,
      ).toBe(95);

      // Close and reopen preserves unsaved draft
      session.closePreview();
      expect(session.activeEffectiveRow.value).toBeNull();
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      expect(session.isActiveDraftModified.value).toBe(true);
      expect(session.activeEffectiveRow.value?.pseudo).toBe(true);

      // Save normalizes and clears draft
      const saved = session.saveActiveDraft();
      expect(saved).toEqual({
        buildId: 'b1',
        rowKey: 'k-gloves',
        selection: {
          pseudo: true,
          stats: { 'explicit.stat_life': { min: 95 } },
        },
      });
      expect(session.isActiveDraftModified.value).toBe(false);
      expect(session.activeEffectiveRow.value?.pseudo).toBe(false);

      session.dispose();
    });

    it('clears drafts on discardActiveDraft and clearDraft, and isolates two session instances', () => {
      const buildsA = ref<BuildView[]>([makeBuild()]);
      const buildsB = ref<BuildView[]>([makeBuild()]);
      const queryA = ref('');
      const queryB = ref('');

      const sessionA = usePobWorkspaceSession<string>({
        builds: buildsA,
        searchQuery: queryA,
        formatRowDetail,
      });
      const sessionB = usePobWorkspaceSession<string>({
        builds: buildsB,
        searchQuery: queryB,
        formatRowDetail,
      });

      sessionA.togglePreview('b1', 'k-gloves', 'anchor-a');
      sessionB.togglePreview('b1', 'k-gloves', 'anchor-b');

      sessionA.updateActiveDraft((draft) => ({ ...draft, pseudo: true }));
      expect(sessionA.isActiveDraftModified.value).toBe(true);
      expect(sessionB.isActiveDraftModified.value).toBe(false);

      // discardActiveDraft clears active draft
      sessionA.discardActiveDraft();
      expect(sessionA.isActiveDraftModified.value).toBe(false);

      // clearDraft clears draft even when closed (resetSearch / saveCurrentSearch flows)
      sessionA.updateActiveDraft((draft) => ({ ...draft, pseudo: true }));
      sessionA.closePreview();
      sessionA.clearDraft('b1', 'k-gloves');
      sessionA.togglePreview('b1', 'k-gloves', 'anchor-a');
      expect(sessionA.isActiveDraftModified.value).toBe(false);

      sessionA.dispose();
      sessionB.dispose();
    });

    it('dispose cancels pending hover timers and clears drafts', () => {
      const timers = createFakeTimers();
      const builds = ref<BuildView[]>([makeBuild()]);
      const searchQuery = ref('');
      const session = usePobWorkspaceSession<string>({
        builds,
        searchQuery,
        formatRowDetail,
        timers,
      });

      const gloves = builds.value[0].groups[0].rows[1];
      session.togglePreview('b1', 'k-gloves', 'anchor-gloves');
      session.updateActiveDraft((draft) => ({ ...draft, pseudo: true }));
      session.closePreview();

      session.hoverPreview('b1', gloves, 'anchor-gloves');
      expect(timers.pendingCount()).toBe(1);

      session.dispose();
      expect(timers.pendingCount()).toBe(0);

      timers.advanceBy(1000);
      expect(session.isPreviewOpen.value).toBe(false);
    });
  });
});
