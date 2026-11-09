import { type PoeVersion } from '@/utils/trade-context';
import { listenPoeEvent } from '@/utils/event-contracts';
import { registerTierSlotRefresher } from '@/utils/tier-slot-registry';
import { syncPageThemeBridge, cleanupPageThemeBridge } from '@/lib/theme/page-theme-bridge';
import { createTierDomainService } from './tier-domain-service';
import { createFilterDragDrop } from './filter-drag-drop';
import { createInjectedControls } from './injected-controls';
import { createFilterObserver } from './filter-observer';
import {
  cleanStatGroupTemplateSlots,
  injectStatGroupTemplateSlots,
} from './stat-group-template-slots';

export interface FilterDomEnhancements {
  initialize(): void;
  cleanup(): void;
  setEditorEnabled(enabled: boolean): void;
  setTierHelperEnabled(enabled: boolean): void;
  setAffixSelectorEnabled(enabled: boolean): void;
  updatePureBackgroundClass(enable: boolean): void;
  refreshAffixDisplayLocale(): void;
}

export function createFilterDomEnhancements(version: PoeVersion): FilterDomEnhancements {
  let generation = 0;
  let initialized = false;
  let editorEnabled = true;
  let tierHelperEnabled = true;
  let affixSelectorEnabled = true;
  let unregisterRefresher: (() => void) | undefined;
  let categoryUpdateListener: (() => void) | undefined;

  const isCurrentGeneration = (gen: number): boolean => gen === generation;

  const tierDomainService = createTierDomainService(version);
  const filterDragDrop = createFilterDragDrop();

  const injectedControls = createInjectedControls({
    version,
    tierDomainService,
    isCurrentGeneration,
    getCurrentGeneration: () => generation,
  });

  const filterObserver = createFilterObserver({
    isCurrentGeneration,
    onRefresh: (gen: number) => {
      if (affixSelectorEnabled) {
        injectedControls.injectFilterGroupButtons();
      }
      injectedControls.injectSendToConsoleButton();
      if (tierHelperEnabled) {
        void injectedControls.injectTierSelectorButtons(gen);
      }
      filterDragDrop.sync();
      injectStatGroupTemplateSlots();
    },
  });

  const reset = (): void => {
    filterObserver.stop();
    injectedControls.cleanAllTierSlotArtifacts();
    injectedControls.cleanFilterGroupButtons();
    injectedControls.cleanSendToConsoleButtons();
    filterDragDrop.cleanup();
    cleanStatGroupTemplateSlots();
  };

  return {
    initialize(): void {
      if (initialized) return;
      initialized = true;

      injectedControls.injectCustomStyles();
      syncPageThemeBridge();

      unregisterRefresher = registerTierSlotRefresher((slotKey) =>
        injectedControls.refreshTierSlotDomain(slotKey),
      );

      if (editorEnabled) {
        filterObserver.start(generation);
      }
    },

    cleanup(): void {
      if (!initialized) return;
      initialized = false;
      generation += 1;

      reset();

      if (unregisterRefresher) {
        unregisterRefresher();
        unregisterRefresher = undefined;
      }

      tierDomainService.reset();
      cleanupPageThemeBridge();
    },

    setEditorEnabled(enabled: boolean): void {
      if (enabled === editorEnabled) return;
      editorEnabled = enabled;
      generation += 1;

      reset();

      if (enabled && initialized) {
        filterObserver.start(generation);
      }
    },

    setTierHelperEnabled(enabled: boolean): void {
      if (enabled === tierHelperEnabled) return;
      tierHelperEnabled = enabled;
      if (!enabled) {
        injectedControls.cleanAllTierSlotArtifacts();
      } else if (initialized && editorEnabled) {
        void injectedControls.injectTierSelectorButtons(generation);
      }
    },

    setAffixSelectorEnabled(enabled: boolean): void {
      if (enabled === affixSelectorEnabled) return;
      affixSelectorEnabled = enabled;
      if (!enabled) {
        injectedControls.cleanFilterGroupButtons();
      } else if (initialized && editorEnabled) {
        injectedControls.injectFilterGroupButtons();
      }
    },

    updatePureBackgroundClass(enable: boolean): void {
      injectedControls.updatePureBackgroundClass(enable);
    },

    refreshAffixDisplayLocale(): void {
      injectedControls.updateInjectedControlsLocale?.();
      if (initialized && editorEnabled && tierHelperEnabled) {
        void injectedControls.injectTierSelectorButtons(generation);
      }
    },
  };
}
