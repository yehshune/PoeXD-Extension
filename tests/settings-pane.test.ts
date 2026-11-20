// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import SettingsPane from '@/components/sidebar/SettingsPane.vue';
import SettingsHotkeyInput from '@/components/sidebar/settings/SettingsHotkeyInput.vue';
import { COMPONENT_SIZE_SPECS, FORM_INDICATOR_SPECS } from '@/lib/tokens';
import { createUiRuntimeTokenValues } from '@/lib/tokens/ui-contract';
import { SIDEBAR_POSITION_OPTIONS } from '@/components/sidebar/settings/settings-ui-metadata';
import {
  createInMemoryPreferencesStorage,
  createPreferencesModule,
  type PreferencesModule,
} from '@/utils/preferences';
import { resetI18nStateForTests } from '@/utils/i18n';
import { DEFAULT_PREFERENCES } from '@/utils/preferences-contract';
import {
  rememberPageLoadPreferences,
  resetPageLoadPreferencesForTests,
} from '@/utils/page-load-preferences';
import { dispatchPoeEvent } from '@/utils/event-contracts';

let storage = createInMemoryPreferencesStorage();
let currentModule: PreferencesModule | undefined;

vi.mock('@/utils/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/preferences')>();
  return {
    ...actual,
    getPreferences: vi.fn(async (version: string) => {
      const outcome = await actual.createPreferencesModule(version as any, storage);
      if (outcome.ok) currentModule = outcome.value;
      return outcome;
    }),
  };
});

describe('SettingsHotkeyInput Unit & Recording Semantics', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    resetI18nStateForTests('zh-TW');
    app?.unmount();
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it('binds v-model, shows recording indicator on focus, records key combination, and clears via button', async () => {
    const hotkey = ref('/');
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(SettingsHotkeyInput, {
              modelValue: hotkey.value,
              ariaLabel: '測試快捷鍵',
              'onUpdate:modelValue': (val: string) => {
                hotkey.value = val;
              },
            });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('/');

    // 1. Focus shows '錄製中...'
    input.dispatchEvent(new Event('focus'));
    await nextTick();
    expect(input.value).toBe('錄製中...');

    // 2. Keydown records new combo
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(hotkey.value).toBe('Ctrl+k');
    expect(input.value).toBe('Ctrl+k');

    // 3. Clear button clears value and conforms to shadcn Button primitive
    const clearBtn = container.querySelector(
      'button[data-settings-hotkey-action="clear"]',
    ) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    expect(clearBtn.tagName).toBe('BUTTON');
    expect(clearBtn.type).toBe('button');
    expect(clearBtn.getAttribute('data-slot')).toBe('button');
    expect(clearBtn.getAttribute('aria-label')).toBe('清除測試快捷鍵');
    expect(clearBtn.getAttribute('title')).toBe('清除快捷鍵');

    clearBtn.click();
    await nextTick();
    expect(hotkey.value).toBe('');
    expect(input.value).toBe('');
    expect(container.querySelector('button[data-settings-hotkey-action="clear"]')).toBeNull();
  });

  it('manages clear button visibility through recording and cancellation lifecycle', async () => {
    const hotkey = ref('Ctrl+Alt+P');
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(SettingsHotkeyInput, {
              modelValue: hotkey.value,
              'onUpdate:modelValue': (val: string) => {
                hotkey.value = val;
              },
            });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const input = container.querySelector('input') as HTMLInputElement;

    // 1. Initial state: modelValue exists, clearable=true, recording=false, disabled=false -> clear Button exists
    let clearBtn = container.querySelector(
      'button[data-settings-hotkey-action="clear"]',
    ) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    expect(clearBtn.getAttribute('aria-label')).toBe('清除快捷鍵');

    // 2. Focus input -> isRecording=true -> clear Button disappears
    input.dispatchEvent(new Event('focus'));
    await nextTick();
    expect(container.querySelector('button[data-settings-hotkey-action="clear"]')).toBeNull();

    // 3. Escape cancels recording -> modelValue still exists -> clear Button returns
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    clearBtn = container.querySelector(
      'button[data-settings-hotkey-action="clear"]',
    ) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    expect(input.value).toBe('Ctrl+Alt+P');

    // 4. Click clear -> modelValue='' -> clear Button disappears
    clearBtn.click();
    await nextTick();
    expect(hotkey.value).toBe('');
    expect(input.value).toBe('');
    expect(container.querySelector('button[data-settings-hotkey-action="clear"]')).toBeNull();
  });

  it('does not render clear button when disabled or clearable is false', async () => {
    const disabledHotkey = ref('Ctrl+A');
    const nonClearableHotkey = ref('Ctrl+B');

    // Disabled test
    const disabledApp = createApp(
      defineComponent({
        setup() {
          return () =>
            h(SettingsHotkeyInput, {
              modelValue: disabledHotkey.value,
              disabled: true,
            });
        },
      }),
    );
    const disabledContainer = document.createElement('div');
    document.body.appendChild(disabledContainer);
    disabledApp.mount(disabledContainer);
    await nextTick();

    expect(
      disabledContainer.querySelector('button[data-settings-hotkey-action="clear"]'),
    ).toBeNull();
    disabledApp.unmount();
    disabledContainer.remove();

    // Clearable=false test
    const nonClearableApp = createApp(
      defineComponent({
        setup() {
          return () =>
            h(SettingsHotkeyInput, {
              modelValue: nonClearableHotkey.value,
              clearable: false,
            });
        },
      }),
    );
    const nonClearableContainer = document.createElement('div');
    document.body.appendChild(nonClearableContainer);
    nonClearableApp.mount(nonClearableContainer);
    await nextTick();

    expect(
      nonClearableContainer.querySelector('button[data-settings-hotkey-action="clear"]'),
    ).toBeNull();
    nonClearableApp.unmount();
    nonClearableContainer.remove();
  });

  it('enforces clear button icon-sm primitive contract without custom size-4 / size-3 overrides', async () => {
    const hotkey = ref('Ctrl+Shift+F');
    app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(SettingsHotkeyInput, {
              modelValue: hotkey.value,
              'onUpdate:modelValue': (val: string) => {
                hotkey.value = val;
              },
            });
        },
      }),
    );
    app.mount(container);
    await nextTick();

    const clearBtn = container.querySelector(
      'button[data-settings-hotkey-action="clear"]',
    ) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    // Button primitive size="icon-sm" contract
    expect(clearBtn.className).toContain(COMPONENT_SIZE_SPECS.sm.iconButtonSizeClass);
    expect(clearBtn.className).toContain(COMPONENT_SIZE_SPECS.sm.iconSvgClass);
    expect(clearBtn.className).not.toContain('size-4');
    expect(clearBtn.className).not.toContain('[&_svg]:size-3');

    const icon = clearBtn.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('class') || '').not.toContain('size-3');
  });
});

describe('SettingsPane shadcn-vue Component Integration & Data Flow', () => {
  let container: HTMLElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetI18nStateForTests('zh-TW');
    storage = createInMemoryPreferencesStorage();
    currentModule = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    resetI18nStateForTests('zh-TW');
    window.location.pathname = '/';
    app?.unmount();
    container.remove();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  const flushAsync = async () => {
    await nextTick();
    await new Promise((r) => setTimeout(r, 25));
    await nextTick();
  };

  const mountSettingsPane = async () => {
    let readyCalled = false;
    app = createApp(SettingsPane, {
      onReady: () => {
        readyCalled = true;
      },
    });
    app.mount(container);

    // Wait for onMounted and preferences load
    for (let i = 0; i < 20; i++) {
      await nextTick();
      if (readyCalled) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await flushAsync();
    return { container };
  };

  const changeToggleGroupValue = async (targetContainer: HTMLElement, value: string) => {
    const item = targetContainer.querySelector<HTMLElement>(
      `[data-slot="toggle-group-item"][value="${value}"]`,
    );
    if (!item) throw new Error(`ToggleGroupItem with value ${value} not found`);
    item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    item.click();
    await flushAsync();
  };

  type SelectControl = 'theme' | 'displayLocale' | 'addBookmarkBtnPosition';

  const SELECT_CONTROL_LABELS: Record<SelectControl, string> = {
    theme: '主題',
    displayLocale: '語言',
    addBookmarkBtnPosition: '加入書籤按鈕位置',
  };

  const findSelectTrigger = (
    targetContainer: HTMLElement,
    control: SelectControl | string | number,
  ): HTMLElement => {
    if (typeof control === 'number') {
      const triggers = targetContainer.querySelectorAll<HTMLElement>(
        '[data-slot="select-trigger"]',
      );
      const trigger = triggers[control];
      if (!trigger) throw new Error(`Select trigger at index ${control} not found`);
      return trigger;
    }
    const label = (SELECT_CONTROL_LABELS as Record<string, string>)[control] || control;
    const spans = Array.from(targetContainer.querySelectorAll('span'));
    const matchedSpan = spans.find(
      (s) => s.textContent?.trim() === label || s.textContent?.includes(label),
    );
    if (!matchedSpan) {
      throw new Error(`Select control label "${label}" not found`);
    }
    const row =
      matchedSpan.closest('.flex.items-center.justify-between') ||
      matchedSpan.closest('.flex') ||
      matchedSpan.parentElement;
    const trigger = row?.querySelector<HTMLElement>('[data-slot="select-trigger"]');
    if (!trigger) {
      throw new Error(`Select trigger for "${label}" not found`);
    }
    return trigger;
  };

  const changeSelectValue = async (
    targetContainer: HTMLElement,
    control: SelectControl | string | number,
    valueMatch: string,
  ) => {
    const trigger = findSelectTrigger(targetContainer, control);

    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    trigger.click();
    await flushAsync();

    const items = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
    );
    const valueToLabelMap: Record<string, string> = {
      'modern-dark': '現代暗色',
      caffeine: '咖啡因',
      catppuccin: '貓布奇諾',
      left: '左側',
      right: '右側',
      small: '小',
      medium: '中',
      large: '大',
      custom: '自訂',
      '1': '標準',
      '0.8': '緊湊',
      top: '僅資料夾右上方',
      bottom: '僅資料夾下方',
    };
    const expectedLabel = valueToLabelMap[valueMatch] || valueMatch;
    const targetItem = items.find(
      (item) =>
        item.getAttribute('data-value') === String(valueMatch) ||
        item.textContent?.trim() === expectedLabel ||
        item.textContent?.trim().includes(expectedLabel),
    );
    if (!targetItem)
      throw new Error(`Select item matching ${valueMatch} not found among ${items.length} items`);

    const EventCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    targetItem.focus?.();
    targetItem.dispatchEvent(new EventCtor('pointerdown', { bubbles: true, cancelable: true }));
    targetItem.dispatchEvent(new EventCtor('pointerup', { bubbles: true, cancelable: true }));
    targetItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    targetItem.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    targetItem.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await flushAsync();
  };

  it('renders with canonical defaults and fires ready event without legacy controls', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule).toBeDefined();

    // Sections are spaced with the section-gap token instead of separators
    expect(container.querySelectorAll('[data-slot="separator"]').length).toBe(0);
    const sectionStack = container.querySelector('[data-settings-section]')?.parentElement;
    expect(sectionStack?.className).toContain('--pxd-section-gap');
    expect(sectionStack?.className).not.toContain('--poexd-density-scale');

    // Verify 2 Select triggers for settings (theme, displayLocale)
    const selectTriggers = container.querySelectorAll('[data-slot="select-trigger"]');
    expect(selectTriggers.length).toBe(2);
    selectTriggers.forEach((trigger) => {
      expect(trigger.className).toContain('w-[140px]');
      expect(trigger.className).toContain('shrink-0');
    });

    // Verify 3 ToggleGroups (panel position, add bookmark button position, left-click action)
    const toggleGroups = container.querySelectorAll('[data-slot="toggle-group"]');
    expect(toggleGroups.length).toBe(3);
    toggleGroups.forEach((tg) => {
      expect(tg.className).toContain('w-[140px]');
      expect(tg.className).toContain('shrink-0');
    });
    const toggleItems = container.querySelectorAll('[data-slot="toggle-group-item"]');
    expect(toggleItems.length).toBe(6);
    toggleItems.forEach((item) => {
      expect(item.className).toContain('flex-1');
    });

    const segmentedControls = container.querySelectorAll(
      '[data-slot="settings-segmented-control"]',
    );
    expect(segmentedControls.length).toBe(0);

    // Verify no native radio inputs remain in SettingsPane
    expect(container.querySelectorAll('input[type="radio"]').length).toBe(0);

    // Verify no RadioGroups remain in SettingsPane
    expect(container.querySelectorAll('[data-slot="radio-group"]').length).toBe(0);

    // On/off settings use Switch (14 settings + 6 Sidebar Modules), sized by the checkbox token
    expect(container.querySelectorAll('[data-slot="checkbox"]').length).toBe(0);
    const switches = container.querySelectorAll('[data-slot="switch"]');
    expect(switches.length).toBe(21);
    switches.forEach((sw) => {
      expect(sw.className).toContain('h-[var(--checkbox-size,18px)]');
    });

    // Verify 5 sections exist with titles (Sidebar Modules first; Backup/Reset moved to toolbar menu)
    expect(container.querySelectorAll('[data-slot="collapsible"]').length).toBe(0);
    const triggers = container.querySelectorAll('[data-settings-section] > header h3');
    expect(triggers.length).toBe(5);
    const sectionTitles = Array.from(triggers).map((t) => t.textContent?.trim());
    expect(sectionTitles).toEqual([
      '側邊欄模組',
      '外觀與版面',
      '搜尋欄與快捷鍵',
      '搜尋結果顯示',
      '書籤與歷史',
    ]);
    expect(sectionTitles).not.toContain('桌面連接器');
    expect(container.textContent).not.toContain('桌面連接器');

    // Verify bottom description is removed
    expect(container.textContent).not.toContain('說明：調整大小或位置會即時套用');

    // Verify canonical defaults in preferences (all 7 SettingsPane boolean checkboxes default to true, densityScale defaults to 1.0)
    const snapshot = currentModule?.read();
    expect(snapshot?.displayLocale).toBe('auto');
    expect(snapshot?.sidebarPosition).toBe('left');
    expect(snapshot?.densityScale).toBe(1.0);
    expect(snapshot?.addBookmarkBtnPosition).toBe('top');
    expect(snapshot?.enableHotkeys).toBe(true);
    expect(snapshot?.enableSearchTilde).toBe(true);
    expect(snapshot?.enableFilterTilde).toBe(true);
    expect(snapshot?.enableAutoTitle).toBe(true);
    expect(snapshot?.enablePriceComparison).toBe(true);
    expect(snapshot?.enableResultModHighlight).toBe(true);
    expect(snapshot?.enableResultModQuickFilter).toBe(true);
    expect(snapshot?.enablePureBackground).toBe(true);
    expect(snapshot?.marketTranslation).toBe(false);
  });

  it('places Language selector in Appearance section alongside Theme and reactively localizes SettingsPane across zh-TW, zh-CN, en, and fallback locales', async () => {
    const { container } = await mountSettingsPane();

    // Language and translation selectors must be located inside the Appearance & Language section
    const appearanceSection = container.querySelector('[data-settings-section="appearance"]');
    expect(appearanceSection?.textContent).toContain('主題');
    expect(appearanceSection?.textContent).toContain('語言');
    expect(appearanceSection?.textContent).toContain('市集漢化');
    expect(container.textContent).not.toContain('詞綴顯示語系');

    // Default zh-TW rendering
    const sectionTriggers = container.querySelectorAll('[data-settings-section] > header h3');
    expect(Array.from(sectionTriggers).map((t) => t.textContent?.trim())).toEqual([
      '側邊欄模組',
      '外觀與版面',
      '搜尋欄與快捷鍵',
      '搜尋結果顯示',
      '書籤與歷史',
    ]);

    // Switch displayLocale to zh-CN via Language Select
    await changeSelectValue(container, 'displayLocale', 'zh-CN');
    expect(currentModule?.read().displayLocale).toBe('zh-CN');
    expect(storage.inspect()['displayLocale']).toBe('zh-CN');
    expect(Array.from(sectionTriggers).map((t) => t.textContent?.trim())).toEqual([
      '侧边栏模块',
      '外观与版面',
      '搜索栏与快捷键',
      '搜索结果显示',
      '书签与历史',
    ]);
    expect(container.textContent).toContain('主题');
    expect(container.textContent).toContain('语言');
    expect(container.textContent).toContain('启用网页快捷键');

    // Switch displayLocale to en via preferences update
    await currentModule!.update({ displayLocale: 'en' });
    await flushAsync();
    expect(Array.from(sectionTriggers).map((t) => t.textContent?.trim())).toEqual([
      'Sidebar modules',
      'Appearance & Layout',
      'Search & Filters',
      'Search Results',
      'Bookmarks & History',
    ]);
    expect(container.textContent).toContain('Theme');
    expect(container.textContent).toContain('Language');
    expect(container.textContent).toContain('Enable page hotkeys');
    const triggersEn = container.querySelectorAll('[data-slot="select-trigger"]');
    expect(triggersEn[0].textContent).toContain('Modern Dark');
    expect(triggersEn[1].textContent).toContain('English');

    // Switch displayLocale to 'ja' (non-Chinese affix locale -> UI falls back to 'en')
    await currentModule!.update({ displayLocale: 'ja' });
    await flushAsync();
    expect(Array.from(sectionTriggers).map((t) => t.textContent?.trim())).toEqual([
      'Sidebar modules',
      'Appearance & Layout',
      'Search & Filters',
      'Search Results',
      'Bookmarks & History',
    ]);
    expect(triggersEn[1].textContent).toContain('日本語');
  });

  it('switches theme live across modern-dark, caffeine, and catppuccin and updates preferences', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule?.read().theme).toBe('modern-dark');

    // Select 'caffeine'
    await changeSelectValue(container, 'theme', 'caffeine');
    expect(currentModule?.read().theme).toBe('caffeine');

    // Select 'catppuccin'
    await changeSelectValue(container, 'theme', 'catppuccin');
    expect(currentModule?.read().theme).toBe('catppuccin');

    // Switch back to modern-dark
    await changeSelectValue(container, 'theme', 'modern-dark');
    expect(currentModule?.read().theme).toBe('modern-dark');
  });

  it('updates sidebar position via ToggleGroup and guards against empty value', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule?.read().sidebarPosition).toBe('left');

    // Verify ToggleGroup dynamically renders canonical SIDEBAR_POSITION_OPTIONS
    const positionToggleGroup = container.querySelectorAll<HTMLElement>(
      '[data-slot="toggle-group"]',
    )[0];
    const toggleItems = positionToggleGroup.querySelectorAll<HTMLElement>(
      '[data-slot="toggle-group-item"]',
    );
    expect(toggleItems.length).toBe(SIDEBAR_POSITION_OPTIONS.length);
    SIDEBAR_POSITION_OPTIONS.forEach((opt, idx) => {
      const item = toggleItems[idx];
      expect(item.getAttribute('value')).toBe(opt.value);
      expect(item.getAttribute('aria-label')).toBe(opt.label);
      expect(item.textContent?.trim()).toBe(opt.label);
    });

    // Verify ToggleGroupItem adheres to scale-aware Control Profile and has NO hardcoded px-3
    toggleItems.forEach((item) => {
      expect(item.className).not.toContain('px-3');
      expect(item.className).toContain('h-[var(--control-height-sm,1.75rem)]');
      expect(item.className).toContain('px-[var(--control-padding-x-sm,10px)]');
      expect(item.className).toContain('text-[length:var(--control-font-sm,12px)]');
    });

    // Verification of scale-driven tokens at 85%, 100%, 120% UI scale
    const tokens85 = createUiRuntimeTokenValues({ scale: 0.85 });
    const tokens100 = createUiRuntimeTokenValues({ scale: 1.0 });
    const tokens120 = createUiRuntimeTokenValues({ scale: 1.2 });

    expect(tokens85['--control-height-sm']).toBe('23.8px');
    expect(tokens100['--control-height-sm']).toBe('28px');
    expect(tokens120['--control-height-sm']).toBe('33.6px');

    expect(tokens85['--control-font-sm']).toBe('10.2px');
    expect(tokens100['--control-font-sm']).toBe('12px');
    expect(tokens120['--control-font-sm']).toBe('14.4px');

    expect(tokens85['--control-padding-x-sm']).toBe('8.5px');
    expect(tokens100['--control-padding-x-sm']).toBe('10px');
    expect(tokens120['--control-padding-x-sm']).toBe('12px');

    // Switch to right
    await changeToggleGroupValue(container, 'right');
    expect(currentModule?.read().sidebarPosition).toBe('right');

    // Switch back to left
    await changeToggleGroupValue(container, 'left');
    expect(currentModule?.read().sidebarPosition).toBe('left');

    // Clicking active left button again emits empty/undefined, which must be ignored
    await changeToggleGroupValue(container, 'left');
    expect(currentModule?.read().sidebarPosition).toBe('left');
  });

  it('does not render sidebar width Select in SettingsPane', async () => {
    const { container } = await mountSettingsPane();

    expect(container.textContent).not.toContain('選單寬度');
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
  });

  async function openFontScalePopover(container: HTMLElement) {
    const triggerBtn = container.querySelector('[data-font-scale-trigger]') as HTMLButtonElement;
    expect(triggerBtn).not.toBeNull();
    triggerBtn.click();
    await flushAsync();

    const popover = document.body.querySelector('[data-font-scale-popover]') as HTMLElement;
    expect(popover).not.toBeNull();
    return {
      triggerBtn,
      popover,
      slider: popover.querySelector('[data-font-scale-slider]') as HTMLInputElement,
      decreaseBtn: popover.querySelector(
        '[data-font-scale-action="decrease"]',
      ) as HTMLButtonElement,
      increaseBtn: popover.querySelector(
        '[data-font-scale-action="increase"]',
      ) as HTMLButtonElement,
      popoverResetBtn: popover.querySelector(
        '[data-font-scale-popover-reset]',
      ) as HTMLButtonElement,
      scaleInput: popover.querySelector('[data-font-scale-input]') as HTMLInputElement,
    };
  }

  it('opens fixed non-scaling font scale popover and updates via slider, wheel, 5% stepper, input, and reset', async () => {
    const { container } = await mountSettingsPane();

    const triggerBtn = container.querySelector('[data-font-scale-trigger]') as HTMLButtonElement;
    const resetBtn = container.querySelector(
      '[data-font-scale-action="reset"]',
    ) as HTMLButtonElement;

    expect(triggerBtn).not.toBeNull();
    expect(resetBtn).not.toBeNull();
    expect(triggerBtn.textContent).toContain('100%');
    expect(resetBtn.disabled).toBe(true);
    expect(document.body.querySelector('[data-font-scale-popover]')).toBeNull();

    const { popover, slider, decreaseBtn, increaseBtn, popoverResetBtn, scaleInput } =
      await openFontScalePopover(container);

    expect(slider).not.toBeNull();
    expect(decreaseBtn).not.toBeNull();
    expect(increaseBtn).not.toBeNull();
    expect(popoverResetBtn).not.toBeNull();
    expect(scaleInput).not.toBeNull();
    expect(scaleInput.value).toBe('100');
    expect(slider.value).toBe('100');
    expect(popoverResetBtn.disabled).toBe(true);
    // 浮層鎖在 1.0x 基準 token，不隨背後側邊欄縮放而變形
    expect(popover.style.getPropertyValue('--control-height-sm')).toBe('28px');
    expect(popover.style.getPropertyValue('--control-font-sm')).toBe('12px');

    // +5% twice -> 110%
    increaseBtn.click();
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.05);
    expect(triggerBtn.textContent).toContain('105%');
    expect(scaleInput.value).toBe('105');
    expect(slider.value).toBe('105');
    expect(resetBtn.disabled).toBe(false);
    expect(popoverResetBtn.disabled).toBe(false);
    expect(popover.style.getPropertyValue('--control-height-sm')).toBe('28px');

    increaseBtn.click();
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.1);

    // -5% once -> 105%
    decreaseBtn.click();
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.05);

    // Wheel scroll up (+5% twice -> 115%) and down (-5% once -> 110%) inside popover without storage bounce
    const wheelArea = popover.firstElementChild as HTMLElement;
    wheelArea.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    wheelArea.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    await flushAsync();
    expect(scaleInput.value).toBe('115');
    wheelArea.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 110));
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.1);

    // Continuous slider drag previews locally during input without premature storage write, then commits on change
    slider.dispatchEvent(new Event('pointerdown'));
    slider.value = '128';
    slider.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(scaleInput.value).toBe('128');
    expect(triggerBtn.textContent).toContain('128%');
    expect(currentModule?.read().fontSizeScale).toBe(1.1);

    slider.value = '142';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.42);
    expect(scaleInput.value).toBe('142');
    expect(triggerBtn.textContent).toContain('142%');

    // Decimal input preserves draft mid-typing and rounds + commits on blur
    scaleInput.value = '120.6';
    scaleInput.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(scaleInput.value).toBe('120.6');
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.21);
    expect(scaleInput.value).toBe('121');

    // Direct input -> 150%
    scaleInput.value = '150';
    scaleInput.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.5);

    // Blur clamps out-of-range high value -> 200%
    scaleInput.value = '999';
    scaleInput.dispatchEvent(new Event('input'));
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(2);
    expect(scaleInput.value).toBe('200');
    expect(increaseBtn.disabled).toBe(true);

    // Popover reset -> 100%
    popoverResetBtn.click();
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1);
    expect(scaleInput.value).toBe('100');
    expect(popoverResetBtn.disabled).toBe(true);

    // Closing popover mid-slider-drag commits the previewed value cleanly
    slider.dispatchEvent(new Event('pointerdown'));
    slider.value = '133';
    slider.dispatchEvent(new Event('input'));
    await flushAsync();
    triggerBtn.click();
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.33);
    expect(triggerBtn.textContent).toContain('133%');

    // Inline reset back to 100%
    resetBtn.click();
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1);
    expect(triggerBtn.textContent).toContain('100%');
    expect(resetBtn.disabled).toBe(true);
  });

  it('preserves fontSizeScale when unrelated preferences change', async () => {
    const { container } = await mountSettingsPane();

    const { scaleInput, triggerBtn } = await openFontScalePopover(container);
    scaleInput.value = '120';
    scaleInput.dispatchEvent(new Event('input'));
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();
    // Toggle popover closed before interacting with other controls
    triggerBtn.click();
    await flushAsync();

    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // Change enableHotkeys
    const hotkeyCheckbox = container.querySelector('#enable-hotkeys') as HTMLButtonElement;
    hotkeyCheckbox.click();
    await flushAsync();
    expect(currentModule?.read().enableHotkeys).toBe(false);
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // Change sidebarPosition to right
    await changeToggleGroupValue(container, 'right');
    expect(currentModule?.read().sidebarPosition).toBe('right');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);
  });

  it('persists font scale across unmount/remount via Preferences SSOT without localStorage', async () => {
    // 1. Mount first instance
    const first = await mountSettingsPane();

    const { scaleInput: scaleInput1 } = await openFontScalePopover(first.container);
    scaleInput1.value = '135';
    scaleInput1.dispatchEvent(new Event('input'));
    scaleInput1.dispatchEvent(new Event('blur'));
    await flushAsync();
    expect(currentModule?.read().fontSizeScale).toBe(1.35);

    // 2. unmount SettingsPane
    app.unmount();
    container.innerHTML = '';

    // 3. 使用同一 Preferences storage 重新 mount
    const second = await mountSettingsPane();

    // 4. 恢復 1.35
    expect(currentModule?.read().fontSizeScale).toBe(1.35);
    const triggerBtn2 = second.container.querySelector(
      '[data-font-scale-trigger]',
    ) as HTMLButtonElement;
    expect(triggerBtn2.textContent).toContain('135%');
    const { scaleInput: scaleInput2 } = await openFontScalePopover(second.container);
    expect(scaleInput2.value).toBe('135');

    // 驗證所有值存在既有 Preferences storage，而不是 localStorage
    const storedSnapshot = storage.inspect();
    expect(storedSnapshot['fontSizeScale']).toBe(1.35);
    expect(window.localStorage.getItem('poexd_custom_font_size_percent_poe1')).toBeNull();
  });

  it('restores legacy fontSizeScale_poe2 on reload into scale trigger and popover input', async () => {
    window.location.pathname = '/trade2/search/Standard';
    storage = createInMemoryPreferencesStorage({
      fontSizeScale_poe2: 1.2,
    });

    const { container } = await mountSettingsPane();
    const triggerBtn = container.querySelector('[data-font-scale-trigger]') as HTMLButtonElement;
    expect(triggerBtn).not.toBeNull();
    expect(triggerBtn.textContent).toContain('120%');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    const { scaleInput } = await openFontScalePopover(container);
    expect(scaleInput.value).toBe('120');
  });

  it('updates density scale via density Checkbox and does not use density Select', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule?.read().densityScale).toBe(1.0);

    const densityCheckbox = container.querySelector<HTMLElement>('#density-compact');
    expect(densityCheckbox).not.toBeNull();
    expect(densityCheckbox?.getAttribute('data-state')).toBe('unchecked');

    // Toggle on (compact = 0.8)
    densityCheckbox?.click();
    await flushAsync();

    expect(currentModule?.read().densityScale).toBe(0.8);
    expect(typeof currentModule?.read().densityScale).toBe('number');
    expect(densityCheckbox?.getAttribute('data-state')).toBe('checked');

    // Toggle off (standard = 1.0)
    densityCheckbox?.click();
    await flushAsync();

    expect(currentModule?.read().densityScale).toBe(1.0);
    expect(densityCheckbox?.getAttribute('data-state')).toBe('unchecked');
  });

  it('shows every settings section on one page without a side nav', async () => {
    const { container } = await mountSettingsPane();
    const visibleSections = Array.from(
      container.querySelectorAll<HTMLElement>('[data-settings-section]'),
    )
      .filter((el) => el.style.display !== 'none')
      .map((el) => el.getAttribute('data-settings-section'));
    expect(visibleSections).toEqual([
      'modules',
      'appearance',
      'searchHotkeys',
      'resultDisplay',
      'bookmarks',
    ]);
    expect(container.querySelector('[data-settings-nav]')).toBeNull();
    expect(container.querySelector('[data-settings-tablist]')).toBeNull();
  });

  it('merges both fuzzy search preferences into one switch', async () => {
    const { container } = await mountSettingsPane();
    expect(container.querySelector('#enable-search-tilde')).toBeNull();
    expect(container.querySelector('#enable-filter-tilde')).toBeNull();
    const fuzzy = container.querySelector<HTMLElement>('#enable-fuzzy-search')!;
    expect(fuzzy.getAttribute('data-state')).toBe('checked');

    fuzzy.click();
    await flushAsync();
    expect(currentModule?.read().enableSearchTilde).toBe(false);
    expect(currentModule?.read().enableFilterTilde).toBe(false);

    fuzzy.click();
    await flushAsync();
    expect(currentModule?.read().enableSearchTilde).toBe(true);
    expect(currentModule?.read().enableFilterTilde).toBe(true);
  });

  it('groups both market translation bilingual options under one heading', async () => {
    const { container } = await mountSettingsPane();
    await currentModule!.update({ marketTranslation: true, displayLocale: 'zh-TW' });
    await flushAsync();
    const group = container.querySelector('[data-settings-group="market-translation-bilingual"]');
    expect(group?.textContent).toContain('中英並列');
    expect(group?.querySelector('#enable-market-translation-bilingual')).not.toBeNull();
    expect(group?.querySelector('#enable-market-translation-result-bilingual')).not.toBeNull();
  });

  it('exposes backup/import/reset in the top toolbar menu and restores defaults only after confirmation', async () => {
    const { container } = await mountSettingsPane();
    await currentModule!.update({ theme: 'caffeine', enableHotkeys: false });
    await flushAsync();
    const confirmSpy = vi.fn(async () => false);
    (window as any).poexdConfirm = confirmSpy;

    const openBackupMenu = async () => {
      const trigger = container.querySelector<HTMLButtonElement>('[data-settings-backup-menu]')!;
      expect(trigger).not.toBeNull();
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger.click();
      await flushAsync();
    };

    await openBackupMenu();
    expect(document.body.querySelector('[data-settings-backup="export"]')).not.toBeNull();
    expect(document.body.querySelector('[data-settings-backup="import"]')).not.toBeNull();
    const reset = document.body.querySelector<HTMLElement>('[data-settings-backup="reset"]')!;
    expect(reset).not.toBeNull();

    reset.click();
    await flushAsync();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(currentModule?.read().theme).toBe('caffeine');

    await openBackupMenu();
    const resetAgain = document.body.querySelector<HTMLElement>('[data-settings-backup="reset"]')!;
    confirmSpy.mockResolvedValueOnce(true);
    resetAgain.click();
    await flushAsync();
    expect(currentModule?.read().theme).toBe('modern-dark');
    expect(currentModule?.read().enableHotkeys).toBe(true);
    delete (window as any).poexdConfirm;
  });

  it('backs up and imports global, poe1, and poe2 preferences together as schemaVersion 2', async () => {
    storage = createInMemoryPreferencesStorage({
      theme: 'caffeine',
      enableTierHelper_poe1: false,
      enableItemNormalizer_poe2: false,
    });
    const { container } = await mountSettingsPane();

    let exportedBlob: Blob | undefined;
    let downloadedFilename = '';
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => {
        exportedBlob = obj as Blob;
        return 'blob:mock-settings-export';
      });
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedFilename = this.download;
      });

    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-settings-backup-menu]')!;
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      trigger.click();
      await flushAsync();

      const exportItem = document.body.querySelector<HTMLElement>(
        '[data-settings-backup="export"]',
      )!;
      exportItem.click();
      await vi.waitFor(() => expect(exportedBlob).toBeDefined());
      expect(downloadedFilename).toMatch(/^poexd_settings_\d{4}-\d{2}-\d{2}\.json$/);

      const exportedJson = JSON.parse(await exportedBlob!.text());
      expect(exportedJson).toMatchObject({
        format: 'poexd-settings',
        schemaVersion: 2,
        global: { theme: 'caffeine' },
        poe1: { enableTierHelper: false },
        poe2: { enableItemNormalizer: false },
      });

      const fileInput = container.querySelector<HTMLInputElement>('[data-settings-backup-file]')!;
      const importPayload = JSON.stringify({
        format: 'poexd-settings',
        schemaVersion: 2,
        global: { theme: 'catppuccin', collapsedTabTop: 280 },
        poe1: { enableTierHelper: true, liveSearchMaxDisplayedResults: 50 },
        poe2: { enableItemNormalizer: true, liveSearchMaxDisplayedResults: 500 },
      });
      const mockFile = {
        text: async () => importPayload,
      } as unknown as File;
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [mockFile],
      });
      fileInput.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(storage.inspect().theme).toBe('catppuccin'));

      expect(storage.inspect()).toMatchObject({
        theme: 'catppuccin',
        collapsedTabTop: 280,
        enableTierHelper_poe1: true,
        liveSearchMaxDisplayedResults_poe1: 50,
        enableItemNormalizer_poe2: true,
        liveSearchMaxDisplayedResults_poe2: 500,
      });
    } finally {
      anchorClickSpy.mockRestore();
      createObjectUrlSpy.mockRestore();
      revokeObjectUrlSpy.mockRestore();
    }
  });

  it('keeps setting rows free of always-visible descriptions', async () => {
    const { container } = await mountSettingsPane();
    const rows = container.querySelectorAll<HTMLElement>('[data-settings-row]');
    expect(rows.length).toBeGreaterThan(0);
    // Only the custom sidebar size hint may show inline text; everything else lives behind ⓘ
    expect(
      container.querySelectorAll('[data-settings-row] p[id^="pxd-setting-desc-"]').length,
    ).toBe(0);
    expect(container.querySelectorAll('[data-settings-details-toggle]').length).toBeGreaterThan(10);
  });

  it('reveals full setting details only after the info button is pressed', async () => {
    const { container } = await mountSettingsPane();
    const row = container
      .querySelector('#enable-fuzzy-search')!
      .closest<HTMLElement>('[data-settings-row]')!;
    const toggle = row.querySelector<HTMLButtonElement>('[data-settings-details-toggle]')!;
    const details = row.querySelector<HTMLElement>('[data-settings-details]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(details.style.display).toBe('none');

    toggle.click();
    await flushAsync();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(details.style.display).not.toBe('none');
    expect(toggle.getAttribute('aria-controls')).toBe(details.id);
  });

  it('filters settings rows by search query and shows an empty state when nothing matches', async () => {
    const { container } = await mountSettingsPane();
    expect(container.querySelector('[data-settings-search-toggle]')).toBeNull();
    const input = container.querySelector<HTMLInputElement>('[data-settings-search]')!;
    expect(input).not.toBeNull();

    const visibleSections = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-settings-section]'))
        .filter((el) => el.style.display !== 'none')
        .map((el) => el.getAttribute('data-settings-section'));

    input.value = '模糊';
    input.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(visibleSections()).toEqual(['searchHotkeys']);
    const hotkeyRows = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-settings-section="searchHotkeys"] [data-settings-row]',
      ),
    ).filter((el) => el.style.display !== 'none');
    expect(hotkeyRows.length).toBe(1);
    expect(container.querySelector('[data-settings-search-empty]')).toBeNull();

    // A section title match keeps every row in that section visible
    input.value = '書籤與歷史';
    input.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(visibleSections()).toEqual(['bookmarks']);

    // Hidden keywords keep removed descriptions searchable
    input.value = '翻譯';
    input.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(visibleSections()).toEqual(['appearance']);

    input.value = 'zzz-no-such-setting';
    input.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(visibleSections()).toEqual([]);
    const empty = container.querySelector('[data-settings-search-empty]');
    expect(empty?.textContent).toContain('zzz-no-such-setting');

    (container.querySelector('[data-settings-search-clear]') as HTMLButtonElement).click();
    await flushAsync();
    // Clearing the query shows every section again
    expect(visibleSections().length).toBe(5);
    expect(container.querySelector('[data-settings-search-empty]')).toBeNull();

    // Escape clears the query while keeping the search box visible
    input.value = '模糊';
    input.dispatchEvent(new Event('input'));
    await flushAsync();
    expect(visibleSections()).toEqual(['searchHotkeys']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushAsync();
    expect(container.querySelector('[data-settings-search]')).not.toBeNull();
    expect(input.value).toBe('');
    expect(visibleSections().length).toBe(5);
  });

  it('toggles Sidebar Modules and keeps the enabled count in sync', async () => {
    const { container } = await mountSettingsPane();
    const count = () =>
      container.querySelector('[data-settings-modules-count]')?.textContent?.trim();
    expect(count()).toBe('已開啟 7 / 7');

    const historySwitch = container.querySelector<HTMLElement>('#sidebar-module-history')!;
    expect(historySwitch.getAttribute('data-state')).toBe('checked');
    historySwitch.click();
    await flushAsync();
    expect(currentModule?.read().sidebarModuleHistory).toBe(false);
    expect(storage.inspect()['sidebarModuleHistory_poe1']).toBe(false);
    expect(historySwitch.getAttribute('data-state')).toBe('unchecked');
    expect(count()).toBe('已開啟 6 / 7');

    // Related-settings shortcut is offered only for enabled modules with a settings section
    const bookmarkRow = container.querySelector('[data-sidebar-module="bookmark"]');
    expect(
      bookmarkRow?.querySelector('[data-sidebar-module-action="related-settings"]'),
    ).not.toBeNull();
    const historyRow = container.querySelector('[data-sidebar-module="history"]');
    expect(historyRow?.querySelector('[data-sidebar-module-action="related-settings"]')).toBeNull();
    const pinnedRow = container.querySelector('[data-sidebar-module="pinned-items"]');
    expect(pinnedRow?.querySelector('[data-sidebar-module-action="related-settings"]')).toBeNull();
  });

  it('updates bookmark button position via ToggleGroup and guards against empty value', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule?.read().addBookmarkBtnPosition).toBe('top');

    // Toggle 'bottom' (下方)
    await changeToggleGroupValue(container, 'bottom');
    expect(currentModule?.read().addBookmarkBtnPosition).toBe('bottom');

    // Toggle 'top' (右上)
    await changeToggleGroupValue(container, 'top');
    expect(currentModule?.read().addBookmarkBtnPosition).toBe('top');

    // Clicking active 'top' again should not clear the value
    await changeToggleGroupValue(container, 'top');
    expect(currentModule?.read().addBookmarkBtnPosition).toBe('top');
  });

  it('toggles checkboxes and persists changes to preferences', async () => {
    const { container } = await mountSettingsPane();

    // Price comparison checkbox
    const priceCheckbox = container.querySelector('#enable-price-comparison') as HTMLElement;
    expect(priceCheckbox).not.toBeNull();
    expect(currentModule?.read().enablePriceComparison).toBe(true);

    // Click to toggle off
    priceCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().enablePriceComparison).toBe(false);

    // Result mod highlight checkbox
    const highlightCheckbox = container.querySelector(
      '#enable-result-mod-highlight',
    ) as HTMLElement;
    expect(highlightCheckbox).not.toBeNull();
    expect(currentModule?.read().enableResultModHighlight).toBe(true);

    highlightCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().enableResultModHighlight).toBe(false);

    // Result mod quick filter checkbox
    const quickFilterCheckbox = container.querySelector(
      '#enable-result-mod-quick-filter',
    ) as HTMLElement;
    expect(quickFilterCheckbox).not.toBeNull();
    expect(currentModule?.read().enableResultModQuickFilter).toBe(true);

    quickFilterCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().enableResultModQuickFilter).toBe(false);

    // Bookmark tooltip checkbox
    const bookmarkTooltipCheckbox = container.querySelector(
      '#enable-bookmark-tooltip',
    ) as HTMLElement;
    expect(bookmarkTooltipCheckbox).not.toBeNull();
    expect(currentModule?.read().enableBookmarkTooltip).toBe(true);

    bookmarkTooltipCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().enableBookmarkTooltip).toBe(false);

    // 市集漢化：預設關閉，勾選後寫入全域偏好
    const marketCheckbox = container.querySelector('#enable-market-translation') as HTMLElement;
    expect(marketCheckbox).not.toBeNull();
    expect(currentModule?.read().marketTranslation).toBe(false);

    marketCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().marketTranslation).toBe(true);

    // 中英並列：只在市集漢化開啟時出現，預設開啟
    const bilingualCheckbox = container.querySelector(
      '#enable-market-translation-bilingual',
    ) as HTMLElement;
    expect(bilingualCheckbox).not.toBeNull();
    expect(currentModule?.read().marketTranslationBilingual).toBe(true);

    bilingualCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().marketTranslationBilingual).toBe(false);

    // 搜尋結果詞綴中英並列：只在市集漢化開啟時出現，預設關閉
    const resultBilingualCheckbox = container.querySelector(
      '#enable-market-translation-result-bilingual',
    ) as HTMLElement;
    expect(resultBilingualCheckbox).not.toBeNull();
    expect(currentModule?.read().marketTranslationResultBilingual).toBe(false);

    resultBilingualCheckbox.click();
    await flushAsync();

    expect(currentModule?.read().marketTranslationResultBilingual).toBe(true);
  });

  it('auto-switches non-Chinese displayLocale when enabling marketTranslation, shows locale hint on manual mismatch, and shows reload action on international Trade host', async () => {
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: 'www.pathofexile.com',
        pathname: '/trade2/search/poe2/Standard',
        reload: reloadSpy,
      },
    });

    try {
      const { container } = await mountSettingsPane();

      // Switch displayLocale to 'en' while marketTranslation is off
      await currentModule!.update({ displayLocale: 'en', marketTranslation: false });
      await flushAsync();
      expect(currentModule?.read().displayLocale).toBe('en');
      expect(container.querySelector('[data-test="market-translation-reload"]')).toBeNull();

      // Enabling marketTranslation under 'en' auto-switches displayLocale to preferred Chinese ('zh-TW')
      const marketCheckbox = container.querySelector('#enable-market-translation') as HTMLElement;
      marketCheckbox.click();
      await flushAsync();

      expect(currentModule?.read().marketTranslation).toBe(true);
      expect(currentModule?.read().displayLocale).toBe('zh-TW');
      expect(container.querySelector('[data-test="market-translation-locale-hint"]')).toBeNull();

      // Reload prompt appears on www.pathofexile.com because effective state changed
      const reloadRow = container.querySelector('[data-test="market-translation-reload"]');
      expect(reloadRow).not.toBeNull();
      const reloadBtn = container.querySelector(
        '[data-test="market-translation-reload-btn"]',
      ) as HTMLButtonElement;
      expect(reloadBtn).not.toBeNull();
      reloadBtn.click();
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Manually switching displayLocale to 'en' while marketTranslation stays on shows locale mismatch hint
      await changeSelectValue(container, 'displayLocale', 'en');
      expect(currentModule?.read().displayLocale).toBe('en');
      const localeHint = container.querySelector('[data-test="market-translation-locale-hint"]');
      expect(localeHint).not.toBeNull();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it('compares the reload prompt against the page-load preferences when mounted later', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: 'www.pathofexile.com',
        pathname: '/trade2/search/poe2/Standard',
        reload: vi.fn(),
      },
    });
    resetPageLoadPreferencesForTests();
    try {
      // 開頁時漢化關閉；設定分頁打開前，漢化已在別處被打開
      rememberPageLoadPreferences({ ...DEFAULT_PREFERENCES, marketTranslation: false });
      storage = createInMemoryPreferencesStorage({
        marketTranslation: true,
        displayLocale: 'zh-TW',
      });
      const { container } = await mountSettingsPane();
      expect(container.querySelector('[data-test="market-translation-reload"]')).not.toBeNull();
    } finally {
      resetPageLoadPreferencesForTests();
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('records hotkey inputs on keydown and persists to preferences', async () => {
    const { container } = await mountSettingsPane();

    const focusInput = container.querySelector(
      'input[placeholder="按任意鍵設定"]',
    ) as HTMLInputElement;
    expect(focusInput).not.toBeNull();

    // Simulate keydown event with Ctrl + F
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    focusInput.dispatchEvent(keyEvent);
    await flushAsync();

    expect(currentModule?.read().hotkeyFocus).toBe('Ctrl+f');
  });

  it('shows recording indicator when focused and allows clearing hotkeys via button or Backspace', async () => {
    const { container } = await mountSettingsPane();

    const focusInput = container.querySelector(
      'input[placeholder="按任意鍵設定"]',
    ) as HTMLInputElement;
    expect(focusInput).not.toBeNull();
    expect(focusInput.value).toBe('/');

    // 1. Focus input should show "錄製中..."
    focusInput.dispatchEvent(new Event('focus'));
    await flushAsync();
    expect(focusInput.value).toBe('錄製中...');

    // 2. Escape cancels recording without changing value
    focusInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushAsync();
    expect(focusInput.value).toBe('/');
    expect(currentModule?.read().hotkeyFocus).toBe('/');

    // 3. Click clear button to clear and disable the hotkey
    const clearBtn = container.querySelector(
      'button[aria-label="清除聚焦搜尋欄快捷鍵"]',
    ) as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();
    clearBtn.click();
    await flushAsync();

    expect(currentModule?.read().hotkeyFocus).toBe('');
    expect(focusInput.value).toBe('');
    // Clear button should now disappear
    expect(container.querySelector('button[aria-label="清除聚焦搜尋欄快捷鍵"]')).toBeNull();

    // 4. Re-record with a key
    focusInput.dispatchEvent(new Event('focus'));
    await flushAsync();
    expect(focusInput.value).toBe('錄製中...');

    focusInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    await flushAsync();
    expect(currentModule?.read().hotkeyFocus).toBe('F2');
    expect(focusInput.value).toBe('F2');

    // 5. Backspace during recording clears the hotkey
    focusInput.dispatchEvent(new Event('focus'));
    await flushAsync();
    expect(focusInput.value).toBe('錄製中...');

    focusInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await flushAsync();
    expect(currentModule?.read().hotkeyFocus).toBe('');
    expect(focusInput.value).toBe('');
  });

  it('synchronizes multiple external preference changes to DOM view-state via subscription', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule).toBeDefined();

    // Perform multi-key external update
    const outcome = await currentModule!.update({
      sidebarPosition: 'right',
      enableHotkeys: false,
      densityScale: 0.8,
      fontSizeScale: 1.2,
      sidebarWidth: 500,
    });
    expect(outcome.ok).toBe(true);
    await flushAsync();

    // 1. Select triggers reflect updated values
    const triggers = container.querySelectorAll('[data-slot="select-trigger"]');
    // Theme: 'modern-dark' (default unmutated)
    expect(triggers[0].textContent).toContain('現代暗色');
    // Display locale: 'auto' (default unmutated)
    expect(triggers[1].textContent).toContain('自動偵測');
    // Font size trigger reflects 120%
    const scaleTrigger = container.querySelector('[data-font-scale-trigger]') as HTMLButtonElement;
    expect(scaleTrigger.textContent).toContain('120%');

    // Sidebar position in ToggleGroup reflects 'right'
    const rightItem = container.querySelector('[data-slot="toggle-group-item"][value="right"]');
    expect(rightItem?.getAttribute('data-state')).toBe('on');

    // Density scale reflects in checkbox: checked
    const densityCompact = container.querySelector('#density-compact');
    expect(densityCompact?.getAttribute('data-state')).toBe('checked');

    // 2. Enable hotkeys checkbox: unchecked
    const hotkeyCheckbox = container.querySelector('#enable-hotkeys');
    expect(hotkeyCheckbox?.getAttribute('data-state')).toBe('unchecked');

    // 3. Updated sidebarWidth is preserved in preferences without SettingsPane width select
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(currentModule?.read().sidebarWidth).toBe(500);
  });

  it('persists single preferences via savePreference dispatch (enum, boolean, hotkey)', async () => {
    const { container } = await mountSettingsPane();
    expect(currentModule).toBeDefined();

    // 1. Enum preference: sidebarPosition via ToggleGroup
    await changeToggleGroupValue(container, 'right');
    expect(currentModule?.read().sidebarPosition).toBe('right');

    // 2. Boolean preference: enableAutoTitle
    const autoTitleCheckbox = container.querySelector('#enable-auto-title') as HTMLElement;
    expect(autoTitleCheckbox).not.toBeNull();
    expect(currentModule?.read().enableAutoTitle).toBe(true);
    autoTitleCheckbox.click();
    await flushAsync();
    expect(currentModule?.read().enableAutoTitle).toBe(false);

    // 3. Hotkey preference: hotkeyClear recording
    const clearInput = container.querySelector(
      'input[aria-label="清除並聚焦搜尋欄快捷鍵"]',
    ) as HTMLInputElement;
    expect(clearInput).not.toBeNull();
    clearInput.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushAsync();
    expect(currentModule?.read().hotkeyClear).toBe('Ctrl+c');

    // 4. Another enum preference: addBookmarkBtnPosition
    await changeToggleGroupValue(container, 'bottom');
    expect(currentModule?.read().addBookmarkBtnPosition).toBe('bottom');
    await changeToggleGroupValue(container, 'top');
    expect(currentModule?.read().addBookmarkBtnPosition).toBe('top');
  });

  it('static guard: uses single reactive preferenceState with toRefs and Object.assign', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const content = fs.readFileSync(settingsPanePath, 'utf-8');

    expect(content).toContain('reactive<Preferences>');
    expect(content).toContain('toRefs(preferenceState)');
    expect(content).toContain('Object.assign(preferenceState, snapshot)');

    // Ensure scattered ref declarations are gone
    expect(content).not.toContain('ref(DEFAULT_PREFERENCES.sidebarPosition)');
    expect(content).not.toContain('ref(DEFAULT_PREFERENCES.hotkeyFocus)');
    expect(content).not.toContain('ref(DEFAULT_PREFERENCES.enableHotkeys)');
  });

  it('static guard: consolidates single-preference save handlers into savePreference', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const content = fs.readFileSync(settingsPanePath, 'utf-8');

    // Consolidated handler is declared
    expect(content).toContain('const savePreference = (key: keyof Preferences)');

    // 9 removed individual handlers must not be declared
    expect(content).not.toContain('const saveSidebarPosition');
    expect(content).not.toContain('const saveHotkeyFocus');
    expect(content).not.toContain('const saveHotkeyClear');
    expect(content).not.toContain('const saveHotkeySettings');
    expect(content).not.toContain('const saveTitleSettings');
    expect(content).not.toContain('const savePriceComparisonSettings');
    expect(content).not.toContain('const saveResultModHighlightSettings');
    expect(content).not.toContain('const saveBackgroundSettings');
    expect(content).not.toContain('const saveBookmarkBtnPosition');

    // Compound handlers: preserve active ones, eliminate dead width/mode handlers
    expect(content).not.toContain('const handleSizeChange');
    expect(content).not.toContain('const handleCustomWidthInput');
    expect(content).not.toContain('const handleCustomWidthBlur');
    expect(content).not.toContain('const handleFontSizeModeChange');
    expect(content).not.toContain('const handleCustomFontSizeInput');
    expect(content).not.toContain('const handleCustomFontSizeBlur');
    expect(content).toContain('const handleFontSizeScaleChange');
    expect(content).toContain('const handleDensityChange');
    expect(content).toContain('const fuzzySearchEnabled = computed');
  });

  it('renders ToggleGroups for sidebarPosition and addBookmarkBtnPosition with outline variant', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const settingsContent = fs.readFileSync(settingsPanePath, 'utf-8');

    expect(settingsContent).toMatch(
      /<ToggleGroup[\s\S]*?variant="outline"[\s\S]*?:model-value="sidebarPosition"/,
    );
    expect(settingsContent).toMatch(
      /<ToggleGroup[\s\S]*?variant="outline"[\s\S]*?:model-value="addBookmarkBtnPosition"/,
    );
  });

  it('commit updates sidebarWidth without rollback on unrelated preference snapshot', async () => {
    await mountSettingsPane();

    await currentModule!.update({
      sidebarWidth: 500,
    });
    await flushAsync();

    expect(currentModule?.read().sidebarWidth).toBe(500);

    // Unrelated preference update triggers snapshot notification
    await currentModule!.update({
      enablePureBackground: false,
    });
    await flushAsync();

    expect(currentModule?.read().sidebarWidth).toBe(500);
  });

  it('static guard: Sidebar.vue commits sidebarWidth on resize-end and SettingsPane eliminates dead preview listener', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const sidebarPath = path.resolve(__dirname, '../components/Sidebar.vue');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf-8');

    // handleResizeEnd in Sidebar.vue must commit sidebarWidth
    expect(sidebarContent).toMatch(/handleResizeEnd[\s\S]*?sidebarWidth:\s*sidebarWidth\.value/);

    const settingsPanePath = path.resolve(__dirname, '../components/sidebar/SettingsPane.vue');
    const settingsContent = fs.readFileSync(settingsPanePath, 'utf-8');

    // SettingsPane.vue must NOT listen to poexd-sidebar-width-preview since numeric input is removed
    expect(settingsContent).not.toContain("listenPoeEvent('poexd-sidebar-width-preview'");
    expect(settingsContent).not.toContain('removePreviewListener');
  });

  it('ensures SettingsPane has a single DOM element root and hides properly under v-show="false"', async () => {
    const isVisible = ref(false);
    const Host = defineComponent({
      components: { SettingsPane },
      setup() {
        return { isVisible };
      },
      template: '<SettingsPane v-show="isVisible" />',
    });

    app = createApp(Host);
    app.mount(container);
    await flushAsync();

    const rootElement = container.firstElementChild as HTMLElement;
    expect(rootElement).not.toBeNull();
    expect(rootElement.tagName).toBe('DIV');
    expect(rootElement.style.display).toBe('none');

    isVisible.value = true;
    await flushAsync();
    expect(rootElement.style.display).toBe('');
  });

  it('keeps the toolbar fixed above the scroll area, aligns module icons horizontally, and highlights the target section on jump', async () => {
    const { container } = await mountSettingsPane();

    // 1. Toolbar lives inside fixed pane slot, outside scroll root
    const fixedSlot = container.querySelector('[data-slot="sidebar-pane-fixed"]');
    const scrollRoot = container.querySelector('[data-slot="sidebar-pane-scroll-root"]');
    expect(fixedSlot?.querySelector('[data-settings-toolbar]')).not.toBeNull();
    expect(fixedSlot?.querySelector('[data-settings-backup-menu]')).not.toBeNull();
    expect(scrollRoot?.querySelector('[data-settings-toolbar]')).toBeNull();
    expect(scrollRoot?.querySelector('[data-settings-section="modules"]')).not.toBeNull();

    // 2. Module rows center-align icon box and label horizontally
    const bookmarkLead = container.querySelector(
      '[data-sidebar-module="bookmark"] [data-settings-row-lead]',
    );
    expect(bookmarkLead?.className).toContain('items-center');
    expect(bookmarkLead?.className).not.toContain('items-start');

    // 3. Clicking related-settings highlights the target section temporarily
    vi.useFakeTimers();
    try {
      const jumpBtn = container.querySelector<HTMLButtonElement>(
        '[data-sidebar-module="bookmark"] [data-sidebar-module-action="related-settings"]',
      )!;
      expect(jumpBtn).not.toBeNull();
      jumpBtn.click();
      await nextTick();

      const bookmarksSection = container.querySelector('[data-settings-section="bookmarks"]');
      expect(bookmarksSection?.getAttribute('data-settings-section-highlighted')).toBe('true');

      vi.advanceTimersByTime(1700);
      await nextTick();
      expect(bookmarksSection?.getAttribute('data-settings-section-highlighted')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
