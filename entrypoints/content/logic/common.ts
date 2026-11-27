import { type PoeVersion } from '@/utils/trade-context';
import { registerTierSlotRefresher } from '@/utils/tier-slot-registry';
import { syncPageThemeBridge, cleanupPageThemeBridge } from '@/lib/theme/page-theme-bridge';
import { createTierDomainService } from './tier-domain-service';
import { createActiveFiltersBar } from './active-filters-bar';
import { createFilterDragDrop } from './filter-drag-drop';
import { createInjectedControls } from './injected-controls';
import { createFilterObserver } from './filter-observer';
import {
  cleanSendToConsoleButtons,
  injectSendToConsoleButton,
  updateSendToConsoleButtonsLocale,
} from './send-to-console';
import { createTierSlotController } from './tier-slot-controller';
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
  setSendToConsoleEnabled(enabled: boolean): void;
  updatePureBackgroundClass(enable: boolean): void;
  refreshAffixDisplayLocale(): void;
}

export function createFilterDomEnhancements(version: PoeVersion): FilterDomEnhancements {
  let generation = 0;
  let initialized = false;
  let editorEnabled = true;
  let tierHelperEnabled = true;
  let affixSelectorEnabled = true;
  let sendToConsoleEnabled = true;
  let unregisterRefresher: (() => void) | undefined;

  const isCurrentGeneration = (gen: number): boolean => gen === generation;

  const tierDomainService = createTierDomainService(version);
  const activeFiltersBar = createActiveFiltersBar();
  const filterDragDrop = createFilterDragDrop();
  const injectedControls = createInjectedControls({ version });
  const tierSlotController = createTierSlotController({
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
      if (sendToConsoleEnabled) {
        injectSendToConsoleButton(version);
      }
      if (tierHelperEnabled) {
        void tierSlotController.sync(gen);
      }
      filterDragDrop.sync();
      activeFiltersBar.sync();
      injectStatGroupTemplateSlots();
    },
  });

  const reset = (): void => {
    filterObserver.stop();
    tierSlotController.clear();
    injectedControls.cleanFilterGroupButtons();
    cleanSendToConsoleButtons();
    filterDragDrop.cleanup();
    activeFiltersBar.cleanup();
    cleanStatGroupTemplateSlots();
  };

  return {
    initialize(): void {
      if (initialized) return;
      initialized = true;

      injectedControls.injectCustomStyles();
      syncPageThemeBridge();

      unregisterRefresher = registerTierSlotRefresher((slotKey) =>
        tierSlotController.refreshSlot(slotKey),
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
        tierSlotController.clear();
      } else if (initialized && editorEnabled) {
        void tierSlotController.sync(generation);
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

    setSendToConsoleEnabled(enabled: boolean): void {
      if (enabled === sendToConsoleEnabled) return;
      sendToConsoleEnabled = enabled;
      if (!enabled) {
        cleanSendToConsoleButtons();
      } else if (initialized && editorEnabled) {
        injectSendToConsoleButton(version);
      }
    },

    updatePureBackgroundClass(enable: boolean): void {
      injectedControls.updatePureBackgroundClass(enable);
    },

    refreshAffixDisplayLocale(): void {
      injectedControls.updateInjectedControlsLocale();
      updateSendToConsoleButtonsLocale();
      activeFiltersBar.refreshLocale();
      if (initialized && editorEnabled && tierHelperEnabled) {
        void tierSlotController.sync(generation);
      }
    },
  };
}
