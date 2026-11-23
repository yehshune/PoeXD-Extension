<script setup lang="ts">
import { computed, useId, type PropType } from 'vue';
import { SlidersHorizontal } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t, type I18nKey } from '@/utils/i18n';
import {
  DEFAULT_LINK_POLICY,
  DEFAULT_STAT_PERCENT,
  LINK_POLICIES,
  STAT_PERCENT_OPTIONS,
  type BuildSearchDefaults,
  type LinkPolicy,
} from '@/utils/pob-shopping-list';
import {
  DEFAULT_RARE_SEARCH,
  RARE_SEARCH_MODES,
  type RareSearchMode,
} from '@/utils/pob-category-search';

/** build 卡片標題的整體搜尋設定：詞綴數值比例、連結條件與稀有裝搜尋方式；單件預覽改過的條件不受影響 */
const props = defineProps({
  open: { type: Boolean, default: false },
  buildName: { type: String, default: '' },
  defaults: {
    type: Object as PropType<BuildSearchDefaults>,
    default: () => ({}),
  },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'change', defaults: BuildSearchDefaults): void;
}>();

const LINK_POLICY_LABELS: Readonly<Record<LinkPolicy, I18nKey>> = {
  pob: 'pobBuild.searchSettings.linksPob',
  six: 'pobBuild.searchSettings.linksSix',
  none: 'pobBuild.searchSettings.linksNone',
};

const RARE_SEARCH_LABELS: Readonly<Record<RareSearchMode, I18nKey>> = {
  base: 'pobBuild.searchSettings.rareSearchBase',
  category: 'pobBuild.searchSettings.rareSearchCategory',
};

const statPercent = computed(() => props.defaults.statPercent ?? DEFAULT_STAT_PERCENT);
const linkPolicy = computed(() => props.defaults.links ?? DEFAULT_LINK_POLICY);
const rareSearch = computed(() => props.defaults.rareSearch ?? DEFAULT_RARE_SEARCH);
const defenceMin = computed(() => props.defaults.defenceMin === true);
const pseudo = computed(() => props.defaults.pseudo === true);
const controlPrefix = useId();
const isCustomized = computed(() => Object.keys(props.defaults).length > 0);

function setStatPercent(value: unknown): void {
  const percent = Number(value);
  if (!STAT_PERCENT_OPTIONS.includes(percent)) return;
  emit('change', { ...props.defaults, statPercent: percent });
}

function setLinkPolicy(value: unknown): void {
  // ToggleGroup 再點一次已選的項目會送出空值，維持原選擇
  if (typeof value !== 'string' || !LINK_POLICIES.includes(value as LinkPolicy)) return;
  emit('change', { ...props.defaults, links: value as LinkPolicy });
}

function setRareSearch(value: unknown): void {
  if (typeof value !== 'string' || !RARE_SEARCH_MODES.includes(value as RareSearchMode)) return;
  emit('change', { ...props.defaults, rareSearch: value as RareSearchMode });
}

/** 開關型設定：關閉時交給 normalizeSearchDefaults 拿掉，不存多餘的欄位 */
function setFlag(field: 'defenceMin' | 'pseudo', value: boolean): void {
  emit('change', { ...props.defaults, [field]: value });
}

function resetDefaults(): void {
  emit('change', {});
}
</script>

<template>
  <Popover :open="open" @update:open="(value: boolean) => emit('update:open', value)">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        data-pob-build-search-settings
        :class="{ 'text-primary': isCustomized }"
        :title="t('pobBuild.searchSettings.title')"
        :aria-label="t('pobBuild.searchSettings.aria', { name: buildName })"
        @click.stop
      >
        <SlidersHorizontal />
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      :side-offset="6"
      :collision-padding="8"
      data-pob-build-search-settings-panel
      class="flex w-[min(var(--pxd-overlay-inspect-width,300px),calc(100vw-32px))] flex-col gap-[var(--pxd-space-md)] text-[length:var(--pxd-font-secondary)]"
      @click.stop
    >
      <div class="flex items-center justify-between gap-[var(--pxd-space-sm)]">
        <span class="font-semibold text-foreground">{{ t('pobBuild.searchSettings.title') }}</span>
        <Button
          v-if="isCustomized"
          variant="link"
          size="sm"
          data-pob-build-search-settings-reset
          class="h-auto p-0 text-[length:var(--pxd-font-caption)]"
          @click="resetDefaults"
        >
          {{ t('pobBuild.searchSettings.reset') }}
        </Button>
      </div>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <span class="text-muted-foreground">{{ t('pobBuild.searchSettings.statPercent') }}</span>
        <Select :model-value="String(statPercent)" @update:model-value="setStatPercent">
          <SelectTrigger size="sm" class="w-[45%] min-w-0" data-pob-build-stat-percent>
            <SelectValue>{{
              t('pobBuild.searchSettings.statPercentValue', {
                percent: statPercent,
              })
            }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="percent in STAT_PERCENT_OPTIONS"
              :key="percent"
              :value="String(percent)"
            >
              {{ t('pobBuild.searchSettings.statPercentValue', { percent }) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-col gap-[var(--pxd-space-xs)]">
        <span class="text-muted-foreground">{{ t('pobBuild.searchSettings.links') }}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="w-full"
          data-pob-build-link-policy
          :model-value="linkPolicy"
          @update:model-value="setLinkPolicy"
        >
          <ToggleGroupItem
            v-for="policy in LINK_POLICIES"
            :key="policy"
            :value="policy"
            class="flex-1"
            :data-pob-build-link-policy-option="policy"
          >
            {{ t(LINK_POLICY_LABELS[policy]) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div class="flex flex-col gap-[var(--pxd-space-xs)]">
        <span class="text-muted-foreground">{{ t('pobBuild.searchSettings.rareSearch') }}</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="w-full"
          data-pob-build-rare-search
          :model-value="rareSearch"
          @update:model-value="setRareSearch"
        >
          <ToggleGroupItem
            v-for="mode in RARE_SEARCH_MODES"
            :key="mode"
            :value="mode"
            class="flex-1"
            :data-pob-build-rare-search-option="mode"
          >
            {{ t(RARE_SEARCH_LABELS[mode]) }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <label :for="`${controlPrefix}-defence`" class="text-muted-foreground">
          {{ t('pobBuild.searchSettings.defenceMin') }}
        </label>
        <Switch
          :id="`${controlPrefix}-defence`"
          data-pob-build-defence-min
          :model-value="defenceMin"
          @update:model-value="(value: boolean) => setFlag('defenceMin', value)"
        />
      </div>

      <div class="flex items-center justify-between gap-[var(--pxd-space-md)]">
        <label :for="`${controlPrefix}-pseudo`" class="text-muted-foreground">
          {{ t('pobBuild.searchSettings.pseudo') }}
        </label>
        <Switch
          :id="`${controlPrefix}-pseudo`"
          data-pob-build-pseudo-default
          :model-value="pseudo"
          @update:model-value="(value: boolean) => setFlag('pseudo', value)"
        />
      </div>

      <p class="m-0 text-[length:var(--pxd-font-caption)] text-muted-foreground">
        {{ t('pobBuild.searchSettings.hint') }}
      </p>
    </PopoverContent>
  </Popover>
</template>
