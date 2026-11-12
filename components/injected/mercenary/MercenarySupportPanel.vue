<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '@/utils/i18n';
import {
  familyTiers,
  MERCENARY_TIERS,
  type MercenarySelectionHint,
  type MercenaryTier,
} from '@/utils/mercenary-query';
import type { MercenaryPicker } from './useMercenaryPicker';

const props = defineProps<{ picker: MercenaryPicker }>();

const activeSkill = computed(() => props.picker.activeSkill.value);
const draft = computed(() => props.picker.activeDraft.value);
const families = computed(() => props.picker.families.value);
const pickedCount = computed(() => props.picker.pickedCount.value);
const maxLinks = computed(() => props.picker.supportRange.value[1]);
const hints = computed(() => props.picker.hints.value);

const allChecked = computed(() =>
  families.value.length > 0 && pickedCount.value === families.value.length
    ? true
    : pickedCount.value > 0
      ? 'indeterminate'
      : false,
);
const minOptions = computed(() => Array.from({ length: pickedCount.value + 1 }, (_, i) => i));

const toTier = (value: unknown): MercenaryTier | null => {
  const tier = Number(value);
  return tier === 1 || tier === 2 || tier === 3 ? tier : null;
};

function onTierChange(key: string, value: unknown) {
  const tier = toTier(value);
  if (tier) props.picker.setFamilyTier(key, tier);
}

function onMinChange(value: unknown) {
  const count = Number(value);
  if (Number.isInteger(count)) props.picker.setMinSupports(count);
}

function hintText(hint: MercenarySelectionHint): string {
  switch (hint.kind) {
    case 'range':
      return t('mercenaryPicker.hint.range', { min: hint.min, max: hint.max });
    case 'exceeds-max':
      return t('mercenaryPicker.hint.exceedsMax', { max: hint.max });
    case 'any-of':
      return t('mercenaryPicker.hint.anyOf', {
        picked: hint.picked,
        min: hint.min,
      });
    case 'max-links-t3':
      return t('mercenaryPicker.hint.maxLinksT3');
  }
}
</script>

<template>
  <section class="flex min-h-0 flex-col gap-[var(--pxd-space-md)]" data-test="mercenary-supports">
    <p
      v-if="!activeSkill || !draft"
      class="m-0 text-[length:var(--pxd-font-body)] text-muted-foreground"
    >
      {{ t('mercenaryPicker.noSkill') }}
    </p>
    <p
      v-else-if="families.length === 0"
      class="m-0 text-[length:var(--pxd-font-body)] text-muted-foreground"
    >
      {{ t('mercenaryPicker.noSupports') }}
    </p>
    <template v-else>
      <div
        class="flex shrink-0 flex-wrap items-center justify-between gap-[var(--pxd-space-sm)] border-b border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)]"
      >
        <label
          class="flex min-w-0 cursor-pointer items-center gap-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] font-semibold tracking-[0.5px] text-muted-foreground"
        >
          <Checkbox
            :model-value="allChecked"
            data-test="mercenary-select-all"
            @update:model-value="picker.selectAllFamilies($event === true)"
          />
          <span class="min-w-0 truncate">
            {{
              t('mercenaryPicker.supports', {
                skill: activeSkill.name,
                count: pickedCount,
                total: families.length,
              })
            }}
          </span>
        </label>
        <Button
          v-if="maxLinks > 0"
          type="button"
          variant="outline"
          size="sm"
          data-test="mercenary-max-links-t3"
          :title="t('mercenaryPicker.maxLinksT3Title')"
          @click="picker.applyMaxLinksT3()"
        >
          {{ t('mercenaryPicker.maxLinksT3') }}
        </Button>
      </div>

      <div
        v-if="pickedCount > 0"
        class="flex shrink-0 flex-wrap items-center gap-[var(--pxd-space-sm)] px-[var(--pxd-space-sm)] text-[length:var(--pxd-font-secondary)] text-foreground"
      >
        <span class="font-semibold">{{ t('mercenaryPicker.setAllTiers') }}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          :model-value="''"
          data-test="mercenary-set-all-tiers"
          @update:model-value="(v) => toTier(v) && picker.setAllTiers(toTier(v)!)"
        >
          <ToggleGroupItem v-for="tier in MERCENARY_TIERS" :key="tier" :value="String(tier)">
            {{ t('mercenaryPicker.tierAtLeast', { tier }) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div
        data-test="mercenary-family-list"
        class="flex min-h-0 flex-1 flex-col overflow-y-auto pxd-scrollbar pr-[var(--pxd-space-xs)]"
      >
        <div
          v-for="family in families"
          :key="family.key"
          :data-family="family.key"
          class="flex items-center justify-between gap-[var(--pxd-space-sm)] border-b border-border px-[var(--pxd-space-sm)] py-[var(--pxd-space-xs)] transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
        >
          <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-[var(--pxd-space-sm)]">
            <Checkbox
              :model-value="family.key in draft.picks"
              @update:model-value="picker.toggleFamily(family.key, $event === true)"
            />
            <span class="min-w-0 truncate text-[length:var(--pxd-font-body)] leading-[1.25]">
              {{ family.name }}
            </span>
          </label>
          <ToggleGroup
            v-if="family.key in draft.picks && familyTiers(family).length > 1"
            type="single"
            variant="outline"
            size="sm"
            :model-value="String(Math.min(draft.picks[family.key], family.maxTier))"
            @update:model-value="onTierChange(family.key, $event)"
          >
            <ToggleGroupItem v-for="tier in familyTiers(family)" :key="tier" :value="String(tier)">
              {{ t('mercenaryPicker.tierAtLeast', { tier }) }}
            </ToggleGroupItem>
          </ToggleGroup>
          <span
            v-else
            class="shrink-0 text-[length:var(--pxd-font-secondary)] text-muted-foreground"
          >
            {{ t('mercenaryPicker.tierExact', { tier: family.maxTier }) }}
          </span>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-[var(--pxd-space-sm)]">
        <span class="text-[length:var(--pxd-font-secondary)] font-semibold text-foreground">
          {{ t('mercenaryPicker.minSupports') }}
        </span>
        <Select
          :model-value="String(draft.minSupports)"
          :disabled="pickedCount === 0"
          @update:model-value="onMinChange"
        >
          <SelectTrigger size="sm" data-test="mercenary-min-supports">
            <SelectValue>
              {{
                t('mercenaryPicker.minSupportsOption', {
                  count: draft.minSupports,
                })
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="n in minOptions" :key="n" :value="String(n)">
              {{ t('mercenaryPicker.minSupportsOption', { count: n }) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ul
        class="m-0 flex shrink-0 list-none flex-col gap-[var(--pxd-space-xs)] p-0"
        data-test="mercenary-hints"
      >
        <li
          v-for="hint in hints"
          :key="hint.kind"
          class="text-[length:var(--pxd-font-secondary)]"
          :class="hint.kind === 'exceeds-max' ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ hintText(hint) }}
        </li>
      </ul>
    </template>
  </section>
</template>
