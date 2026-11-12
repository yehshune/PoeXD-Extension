<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { listenPoeEvent } from '@/utils/event-contracts';
import { t, type I18nKey } from '@/utils/i18n';
import type { MercenarySupportSlots } from '@/utils/mercenary-data';
import type { MercenaryGroupKind } from '@/utils/mercenary-query';
import { activeStatGroupTemplateSlots } from '@/utils/stat-group-template-slot-registry';
import { useCriteriaOverlayManager } from '../criteria-overlay-manager';
import MercenaryBuildCombobox from './MercenaryBuildCombobox.vue';
import MercenarySupportPanel from './MercenarySupportPanel.vue';
import { useMercenaryPicker } from './useMercenaryPicker';

const ROLE_TITLE_KEYS = {
  core: 'mercenaryPicker.role.core',
  main: 'mercenaryPicker.role.main',
  utility: 'mercenaryPicker.role.utility',
  all: 'mercenaryPicker.role.all',
} as const satisfies Record<string, I18nKey>;
const SLOT_KEYS = {
  high: 'mercenaryPicker.slots.high',
  medium: 'mercenaryPicker.slots.medium',
  low: 'mercenaryPicker.slots.low',
  none: 'mercenaryPicker.slots.none',
} as const satisfies Record<MercenarySupportSlots, I18nKey>;
const GROUP_KINDS = [
  'mercenary',
  'and',
  'not',
  'count',
] as const satisfies readonly MercenaryGroupKind[];
const GROUP_KIND_KEYS = {
  mercenary: 'mercenaryPicker.groupKinds.mercenary',
  and: 'mercenaryPicker.groupKinds.and',
  not: 'mercenaryPicker.groupKinds.not',
  count: 'mercenaryPicker.groupKinds.count',
} as const satisfies Record<MercenaryGroupKind, I18nKey>;
const GROUP_KIND_HINT_KEYS = {
  mercenary: 'mercenaryPicker.groupKindHint.and',
  and: 'mercenaryPicker.groupKindHint.and',
  not: 'mercenaryPicker.groupKindHint.not',
  count: 'mercenaryPicker.groupKindHint.count',
} as const satisfies Record<MercenaryGroupKind, I18nKey>;

/** 字級與列結構比照詞綴選擇器（FilterPane 的欄標題、ModItem 的詞綴列）。 */
const fieldLabelClass = 'text-[length:var(--pxd-font-secondary)] font-semibold text-foreground';
const checkLabelClass =
  'flex cursor-pointer items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] text-foreground';
const columnTitleClass =
  'm-0 shrink-0 border-b border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] text-[length:var(--pxd-font-secondary)] font-semibold tracking-[0.5px] text-muted-foreground';

const manager = useCriteriaOverlayManager();
const picker = useMercenaryPicker({ manager });
const {
  loading,
  loadFailed,
  mode,
  build,
  buildIndex,
  buildOptions,
  applyBuildType,
  groupKind,
  isMercenaryKind,
  multiSelect,
  targetGroupType,
  groupFilters,
  countLimit,
  countMin,
  requireSkill,
  unguaranteedSkills,
  selectedSkills,
  excludeWeak,
  excludableWeakSkills,
  pageItemType,
  skillQuery,
  skillSections,
  drafts,
  activeSkillIndex,
  resultGroups,
  canApply,
} = picker;

const open = ref(false);
const applying = ref(false);
const isBatch = computed(() => mode.value === 'batch');
const isGroup = computed(() => mode.value === 'group');

const stop = listenPoeEvent('poexd-open-mercenary-picker', (detail) => {
  open.value = true;
  void picker.open({
    mode: detail.condition ? 'group' : 'edit',
    groupIndex: detail.groupIndex,
  });
});

const TARGET_GROUP_HINT_KEYS = {
  and: 'mercenaryPicker.targetGroupHint.and',
  not: 'mercenaryPicker.targetGroupHint.not',
  count: 'mercenaryPicker.targetGroupHint.count',
  if: 'mercenaryPicker.targetGroupHint.if',
} as const satisfies Record<string, I18nKey>;

const conditionHint = computed(() => {
  if (!isGroup.value) return t(GROUP_KIND_HINT_KEYS[groupKind.value]);
  const type = targetGroupType.value ?? '';
  const key = TARGET_GROUP_HINT_KEYS[type as keyof typeof TARGET_GROUP_HINT_KEYS];
  return t('mercenaryPicker.targetGroupPrefix', { type }) + (key ? t(key) : '');
});
const showCountMin = computed(() =>
  isGroup.value ? targetGroupType.value === 'count' : groupKind.value === 'count',
);
const dialogTitle = computed(() =>
  isGroup.value
    ? t('mercenaryPicker.groupTitle')
    : isBatch.value
      ? t('mercenaryPicker.batchTitle')
      : t('mercenaryPicker.title'),
);
const dialogDescription = computed(() =>
  isGroup.value
    ? t('mercenaryPicker.groupDescription')
    : isBatch.value
      ? t('mercenaryPicker.batchDescription')
      : t('mercenaryPicker.description'),
);
onBeforeUnmount(stop);

function openBatch() {
  open.value = true;
  void picker.open({ mode: 'batch' });
}

function onGroupKindChange(value: unknown) {
  const kind = GROUP_KINDS.find((k) => k === value);
  if (kind) picker.setGroupKind(kind);
}

const countOptions = computed(() => Array.from({ length: countLimit.value }, (_, i) => i + 1));
const countValue = computed(() => Math.max(1, Math.min(countMin.value, countLimit.value)));

function onCountMinChange(value: unknown) {
  const count = Number(value);
  if (Number.isInteger(count) && count > 0) countMin.value = count;
}

const sectionTitle = (role: keyof typeof ROLE_TITLE_KEYS, count: number) =>
  t(ROLE_TITLE_KEYS[role], { count });

const summary = computed(() => {
  if (!canApply.value) return '';
  if (isGroup.value) {
    return t('mercenaryPicker.summaryGroup', {
      count: selectedSkills.value.length,
      total: groupFilters.value.length,
    });
  }
  if (isBatch.value)
    return t('mercenaryPicker.summaryBatch', {
      count: resultGroups.value.length,
    });
  const min = Number(resultGroups.value[0]?.value?.min ?? 1);
  return t('mercenaryPicker.summaryEdit', { min: Math.max(0, min - 1) });
});

const weakNames = computed(() => excludableWeakSkills.value.map((s) => s.name).join('、'));
const unguaranteedNames = computed(() => unguaranteedSkills.value.map((s) => s.name).join('、'));
const selectedNames = computed(() => selectedSkills.value.map((s) => s.name).join('、'));

async function submit() {
  if (applying.value || !canApply.value) return;
  applying.value = true;
  try {
    if (await picker.apply()) open.value = false;
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <!-- 「新增詞綴群組」旁的批次新增入口 -->
  <template v-for="(slotEl, slotIndex) in activeStatGroupTemplateSlots" :key="slotIndex">
    <Teleport v-if="slotEl.isConnected" :to="slotEl">
      <button
        type="button"
        class="btn poexd-stat-group-template-btn"
        style="
          height: 100%;
          margin: 0 0 0 4px;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
        "
        data-test="mercenary-batch-trigger"
        :title="t('mercenaryPicker.batchTriggerTitle')"
        @click="openBatch"
      >
        <span>{{ t('mercenaryPicker.batchTrigger') }}</span>
      </button>
    </Teleport>
  </template>

  <!-- 版面比照詞綴選擇器：inset 尺寸、固定標題列、可捲動的雙欄內容、固定動作列 -->
  <Dialog v-model:open="open">
    <DialogContent
      layer="system"
      placement="inset"
      data-test="mercenary-picker"
      :data-mode="mode"
      class="inset-x-[5vw] inset-y-[5vh] flex h-auto max-h-none w-auto max-w-none flex-col gap-0 p-0"
      close-class="right-[var(--pxd-pane-padding)] top-[calc((var(--pxd-sidebar-affix-dialog-header-height)-var(--control-height-sm))/2)]"
    >
      <DialogHeader
        data-test="mercenary-header"
        class="h-[var(--pxd-sidebar-affix-dialog-header-height)] shrink-0 flex-row items-center justify-between gap-0 border-b border-border bg-background px-[var(--pxd-pane-padding)] py-0 text-left"
      >
        <DialogTitle class="text-[length:var(--pxd-font-body)] font-bold tracking-[0.5px]">
          {{ dialogTitle }}
        </DialogTitle>
      </DialogHeader>

      <!-- 工具列：說明、Build 與群組類型 -->
      <div
        data-test="mercenary-toolbar"
        class="flex shrink-0 flex-col gap-[var(--pxd-space-md)] border-b border-border px-[var(--pxd-pane-padding)] py-[var(--pxd-space-md)]"
      >
        <DialogDescription
          class="m-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
        >
          {{ dialogDescription }}
        </DialogDescription>
        <div
          v-if="!loading && !loadFailed"
          class="flex flex-wrap items-center gap-x-[var(--pxd-space-xl)] gap-y-[var(--pxd-space-sm)]"
        >
          <div class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]">
            <span :class="fieldLabelClass">{{ t('mercenaryPicker.build') }}</span>
            <MercenaryBuildCombobox
              :options="buildOptions"
              :model-value="buildIndex"
              @update:model-value="picker.selectBuild($event)"
            />
            <label v-if="build && build.tradeType !== pageItemType" :class="checkLabelClass">
              <Checkbox
                :model-value="applyBuildType"
                data-test="mercenary-apply-build"
                @update:model-value="applyBuildType = $event === true"
              />
              {{ t('mercenaryPicker.applyBuildType') }}
            </label>
          </div>

          <div
            v-if="isBatch"
            class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]"
            data-test="mercenary-group-kind"
          >
            <span :class="fieldLabelClass">{{ t('mercenaryPicker.groupKind') }}</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              :model-value="groupKind"
              @update:model-value="onGroupKindChange"
            >
              <ToggleGroupItem v-for="kind in GROUP_KINDS" :key="kind" :value="kind">
                {{ t(GROUP_KIND_KEYS[kind]) }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </div>

      <div
        data-test="mercenary-body"
        class="relative flex min-h-0 flex-1 flex-col p-[var(--pxd-pane-padding)]"
      >
        <p v-if="loading" class="m-0 text-[length:var(--pxd-font-body)] text-muted-foreground">
          {{ t('mercenaryPicker.loading') }}
        </p>
        <p v-else-if="loadFailed" class="m-0 text-[length:var(--pxd-font-body)] text-destructive">
          {{ t('mercenaryPicker.loadFailed') }}
        </p>

        <div
          v-else
          class="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-[var(--pxd-space-xl)]"
        >
          <section class="flex min-h-0 flex-col gap-[var(--pxd-space-sm)]">
            <Input
              v-if="!build"
              v-model="skillQuery"
              size="default"
              class="shrink-0"
              data-test="mercenary-skill-search"
              :placeholder="t('mercenaryPicker.skillSearch')"
            />
            <div
              data-test="mercenary-skill-list"
              class="flex min-h-0 flex-1 flex-col gap-[var(--pxd-space-lg)] overflow-y-auto pxd-scrollbar pr-[var(--pxd-space-xs)]"
            >
              <div v-for="section in skillSections" :key="section.role" class="flex flex-col">
                <h3 :class="columnTitleClass">
                  {{ sectionTitle(section.role, section.count) }}
                </h3>
                <div
                  v-for="entry in section.skills"
                  :key="entry.skill.index"
                  :data-skill-trade-id="entry.skill.tradeId"
                  class="flex items-center gap-[var(--pxd-space-sm)] border-b border-border px-[var(--pxd-space-sm)] transition-colors duration-100"
                  :class="
                    activeSkillIndex === entry.skill.index
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent hover:text-accent-foreground'
                  "
                >
                  <Checkbox
                    v-if="multiSelect"
                    :model-value="entry.skill.index in drafts"
                    @update:model-value="picker.toggleSkill(entry.skill.index, $event === true)"
                  />
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center justify-between gap-[var(--pxd-space-sm)] py-[var(--pxd-space-sm)] text-left text-[length:var(--pxd-font-body)] leading-[1.25] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    @click="picker.focusSkill(entry.skill.index)"
                  >
                    <span class="min-w-0 truncate">{{ entry.skill.name }}</span>
                    <span
                      class="flex shrink-0 items-center gap-[var(--pxd-space-xs)] text-[length:var(--pxd-font-caption)]"
                    >
                      <span
                        v-if="entry.weak"
                        class="rounded-sm bg-destructive/15 px-[var(--pxd-space-xs)] text-destructive"
                        :title="t('mercenaryPicker.weakTitle')"
                      >
                        {{ t('mercenaryPicker.weak') }}
                      </span>
                      <span class="text-muted-foreground">
                        {{ t(SLOT_KEYS[entry.skill.slots]) }}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </section>

          <MercenarySupportPanel v-if="isMercenaryKind" :picker="picker" />
          <section
            v-else
            class="flex min-h-0 flex-col gap-[var(--pxd-space-md)]"
            data-test="mercenary-condition"
          >
            <h3 :class="columnTitleClass">{{ conditionHint }}</h3>
            <p
              v-if="selectedSkills.length === 0"
              class="m-0 text-[length:var(--pxd-font-body)] text-muted-foreground"
            >
              {{ t('mercenaryPicker.conditionEmpty') }}
            </p>
            <template v-if="selectedSkills.length > 0 || isGroup">
              <p
                v-if="selectedSkills.length > 0"
                class="m-0 text-[length:var(--pxd-font-body)] leading-[1.5] text-foreground"
              >
                {{
                  t('mercenaryPicker.conditionSelected', {
                    count: selectedSkills.length,
                  })
                }}
                {{ selectedNames }}
              </p>
              <div
                v-if="showCountMin"
                class="flex flex-wrap items-center gap-[var(--pxd-space-sm)]"
              >
                <span :class="fieldLabelClass">
                  {{ isGroup ? t('mercenaryPicker.groupCountMin') : t('mercenaryPicker.countMin') }}
                </span>
                <Select :model-value="String(countValue)" @update:model-value="onCountMinChange">
                  <SelectTrigger size="sm" data-test="mercenary-count-min">
                    <SelectValue>
                      {{
                        t('mercenaryPicker.minSupportsOption', {
                          count: countValue,
                        })
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="n in countOptions" :key="n" :value="String(n)">
                      {{ t('mercenaryPicker.minSupportsOption', { count: n }) }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </template>
          </section>
        </div>
      </div>

      <!-- 固定動作列：附加選項、摘要與按鈕 -->
      <div
        data-test="mercenary-footer"
        class="flex shrink-0 flex-col gap-[var(--pxd-space-sm)] border-t border-border bg-background px-[var(--pxd-pane-padding)] py-[var(--pxd-space-md)]"
      >
        <template v-if="!loading && !loadFailed">
          <label
            v-if="isMercenaryKind && unguaranteedSkills.length > 0"
            :class="checkLabelClass"
            :title="t('mercenaryPicker.requireSkillTitle')"
          >
            <Checkbox
              :model-value="requireSkill"
              data-test="mercenary-require-skill"
              @update:model-value="requireSkill = $event === true"
            />
            {{ t('mercenaryPicker.requireSkill', { names: unguaranteedNames }) }}
          </label>
          <label
            v-if="isBatch && isMercenaryKind && excludableWeakSkills.length > 0"
            :class="checkLabelClass"
          >
            <Checkbox
              :model-value="excludeWeak"
              data-test="mercenary-exclude-weak"
              @update:model-value="excludeWeak = $event === true"
            />
            {{ t('mercenaryPicker.excludeWeak', { names: weakNames }) }}
          </label>
        </template>
        <DialogFooter class="flex-row items-center justify-between gap-[var(--pxd-space-sm)]">
          <span
            class="mr-auto min-w-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
            data-test="mercenary-summary"
          >
            {{ summary }}
          </span>
          <Button type="button" variant="outline" size="sm" @click="open = false">
            {{ t('common.cancel') }}
          </Button>
          <Button
            type="button"
            size="sm"
            data-test="mercenary-apply"
            :disabled="!canApply || applying || loading"
            @click="submit"
          >
            {{
              isGroup
                ? t('mercenaryPicker.applyGroup')
                : isBatch
                  ? t('mercenaryPicker.applyBatch')
                  : t('mercenaryPicker.apply')
            }}
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>
