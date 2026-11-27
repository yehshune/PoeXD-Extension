<script setup lang="ts">
import { computed, type PropType } from 'vue';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import PreviewStatRow, {
  type PreviewStatBound,
} from '@/components/sidebar/item-preview/PreviewStatRow.vue';
import { t, type I18nKey } from '@/utils/i18n';
import {
  SIMILAR_SEARCH_SCOPES,
  SIMILAR_TOLERANCE_BOUNDS,
  WEAPON_MODES,
  setPropertyEnabled,
  setPropertyThreshold,
  setScope,
  setStatDomain,
  setStatRole,
  setStatThreshold,
  setTolerance,
  setWeaponMode,
  type DraftProperty,
  type DraftStat,
  type SimilarSearchDraft,
  type WeaponMode,
} from '@/utils/similar-item-search';
import type { PoeVersion } from '@/utils/trade-context';
import { boundsOf, domainChoiceOf, statDomainProps, thresholdFromBound } from './draft-rows';

/** 找相似面板的草稿編輯：詞綴（帶入、必要、型態、門檻）、屬性、容忍度、範圍、武器比較方式 */
const props = defineProps({
  draft: { type: Object as PropType<SimilarSearchDraft>, required: true },
  version: { type: String as PropType<PoeVersion>, default: 'poe1' },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits<{ update: [update: (draft: SimilarSearchDraft) => SimilarSearchDraft] }>();

const weaponModes = computed(() =>
  WEAPON_MODES.filter((mode) => props.draft.properties.some((property) => property.id === mode)),
);

const propertyLabel = (property: DraftProperty): string =>
  t(`similarSearch.property.${property.id}` as I18nKey);

function toggleStat(stat: DraftStat, checked: boolean): void {
  emit('update', (draft) => setStatRole(draft, stat.key, checked ? 'reference' : 'ignored'));
}

function toggleRequired(stat: DraftStat): void {
  const role = stat.role === 'required' ? 'reference' : 'required';
  emit('update', (draft) => setStatRole(draft, stat.key, role));
}

function selectDomain(stat: DraftStat, prefix: string): void {
  const choice = domainChoiceOf(stat, prefix);
  if (choice) emit('update', (draft) => setStatDomain(draft, stat.key, choice));
}

function commitStatBound(stat: DraftStat, bound: PreviewStatBound, value: number | null): void {
  const next = thresholdFromBound(stat.threshold, bound, value);
  if (next !== 'unchanged') emit('update', (draft) => setStatThreshold(draft, stat.key, next));
}

function numberOf(value: string | number): number | undefined {
  const text = String(value).trim();
  if (text === '') return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function commitTolerance(value: string | number): void {
  const tolerance = numberOf(value);
  if (tolerance !== undefined) emit('update', (draft) => setTolerance(draft, tolerance));
}

function commitPropertyMin(property: DraftProperty, value: string | number): void {
  emit('update', (draft) => setPropertyThreshold(draft, property.id, numberOf(value)));
}

function selectWeaponMode(mode: WeaponMode): void {
  emit('update', (draft) => setWeaponMode(draft, mode));
}
</script>

<template>
  <div class="flex flex-col gap-[var(--pxd-space-sm)]" data-similar-draft>
    <div class="flex flex-wrap items-center gap-[var(--pxd-space-sm)] text-xs">
      <label class="inline-flex items-center gap-[var(--pxd-space-xs)]">
        <span class="text-muted-foreground">{{ t('similarSearch.tolerance') }}</span>
        <Input
          size="sm"
          type="number"
          class="w-20"
          data-similar-tolerance
          :min="SIMILAR_TOLERANCE_BOUNDS.min"
          :max="SIMILAR_TOLERANCE_BOUNDS.max"
          :model-value="draft.tolerance"
          :disabled="disabled"
          @change="commitTolerance(($event.target as HTMLInputElement).value)"
        />
        <span class="text-muted-foreground">%</span>
      </label>
      <span class="inline-flex items-center gap-[var(--pxd-space-xs)]">
        <span class="text-muted-foreground">{{ t('similarSearch.scope') }}</span>
        <Button
          v-for="scope in SIMILAR_SEARCH_SCOPES"
          :key="scope"
          size="sm"
          variant="ghost"
          :data-similar-scope="scope"
          :aria-pressed="draft.scope === scope"
          :disabled="disabled"
          @click="emit('update', (current) => setScope(current, scope))"
          >{{ t(`similarSearch.scope.${scope}`) }}</Button
        >
      </span>
      <span
        v-if="draft.weaponMode && weaponModes.length > 1"
        class="inline-flex items-center gap-[var(--pxd-space-xs)]"
      >
        <span class="text-muted-foreground">{{ t('similarSearch.weaponMode') }}</span>
        <Button
          v-for="mode in weaponModes"
          :key="mode"
          size="sm"
          variant="ghost"
          :data-similar-weapon-mode="mode"
          :aria-pressed="draft.weaponMode === mode"
          :disabled="disabled"
          @click="selectWeaponMode(mode)"
          >{{ t(`similarSearch.property.${mode}`) }}</Button
        >
      </span>
    </div>

    <section class="flex flex-col gap-[var(--pxd-space-xs)]">
      <h3 class="m-0 text-xs font-bold text-muted-foreground">{{ t('similarSearch.stats') }}</h3>
      <div
        v-for="stat in draft.stats"
        :key="stat.key"
        class="flex items-center gap-[var(--pxd-space-xs)]"
        :data-similar-stat="stat.key"
      >
        <PreviewStatRow
          class="min-w-0 flex-1"
          v-bind="statDomainProps(stat)"
          :version="version"
          :lines="stat.text.split(' / ')"
          :title="stat.id"
          :checked="stat.role !== 'ignored'"
          :toggle-disabled="disabled"
          :domain-disabled="disabled"
          :bounds="boundsOf(stat.threshold)"
          :bounds-disabled="disabled || stat.role === 'ignored'"
          :dimmed="stat.role === 'ignored'"
          @toggle="(checked) => toggleStat(stat, checked)"
          @select-domain="(prefix) => selectDomain(stat, prefix)"
          @commit-bound="(bound, value) => commitStatBound(stat, bound, value)"
        />
        <Button
          size="sm"
          variant="ghost"
          data-similar-required
          :title="t('similarSearch.requiredTitle')"
          :aria-pressed="stat.role === 'required'"
          :disabled="disabled || stat.role === 'ignored'"
          @click="toggleRequired(stat)"
          >{{ t('similarSearch.required') }}</Button
        >
      </div>
    </section>

    <section v-if="draft.properties.length > 0" class="flex flex-col gap-[var(--pxd-space-xs)]">
      <h3 class="m-0 text-xs font-bold text-muted-foreground">
        {{ t('similarSearch.properties') }}
      </h3>
      <label
        v-for="property in draft.properties"
        :key="property.id"
        class="flex items-center gap-[var(--pxd-space-sm)] text-sm"
        :data-similar-property="property.id"
      >
        <Checkbox
          :model-value="property.enabled"
          :disabled="disabled"
          @update:model-value="
            (value) =>
              emit('update', (current) => setPropertyEnabled(current, property.id, value === true))
          "
        />
        <span class="min-w-0 flex-1 truncate text-foreground">{{ propertyLabel(property) }}</span>
        <span class="font-mono text-muted-foreground">{{ property.value }}</span>
        <Input
          size="sm"
          type="number"
          class="w-20"
          :placeholder="t('tierDropdown.minPlaceholder')"
          :model-value="property.threshold ?? ''"
          :disabled="disabled || !property.enabled"
          @change="commitPropertyMin(property, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </section>
  </div>
</template>
