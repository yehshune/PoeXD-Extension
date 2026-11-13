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
import { SIDEBAR_SIZE_PRESETS } from '@/utils/preferences-contract';
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

  type SelectControl =
    | 'theme'
    | 'displayLocale'
    | 'sidebarSize'
    | 'fontSizeMode'
    | 'addBookmarkBtnPosition';

  const SELECT_CONTROL_LABELS: Record<SelectControl, string> = {
    theme: '主題',
    displayLocale: '語言',
    sidebarSize: '選單寬度',
    fontSizeMode: '介面縮放比例',
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

    // Verify 4 Separators exist between 5 collapsible sections
    const separators = container.querySelectorAll('[data-slot="separator"]');
    expect(separators.length).toBe(4);
    separators.forEach((sep) => {
      expect(sep.className).toContain('--pxd-section-gap');
      expect(sep.className).not.toContain('--poexd-density-scale');
    });

    // Verify 4 Select triggers for settings (theme, displayLocale, sidebar size, font size)
    const selectTriggers = container.querySelectorAll('[data-slot="select-trigger"]');
    expect(selectTriggers.length).toBe(4);
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

    // Verify Checkbox slots exist (13 settings).
    const checkboxes = container.querySelectorAll('[data-slot="checkbox"]');
    expect(checkboxes.length).toBe(13);
    checkboxes.forEach((cb) => {
      expect(cb.className).toContain(FORM_INDICATOR_SPECS.checkbox.sizeClass);
    });

    // Verify 5 Collapsible sections exist with titles
    const collapsibles = container.querySelectorAll('[data-slot="collapsible"]');
    expect(collapsibles.length).toBe(5);
    const triggers = container.querySelectorAll('[data-slot="collapsible-trigger"]');
    expect(triggers.length).toBe(5);
    const sectionTitles = Array.from(triggers).map((t) => t.textContent?.trim());
    expect(sectionTitles).toEqual([
      '外觀與介面',
      '側邊欄版面',
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
    expect(snapshot?.sidebarSize).toBe('medium');
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

    // Language and translation selectors must be located inside the first Collapsible section (Appearance & Language)
    const collapsibles = container.querySelectorAll('[data-slot="collapsible"]');
    const appearanceSection = collapsibles[0];
    expect(appearanceSection?.textContent).toContain('主題');
    expect(appearanceSection?.textContent).toContain('語言');
    expect(appearanceSection?.textContent).toContain('市集漢化');
    expect(container.textContent).not.toContain('詞綴顯示語系');

    // Default zh-TW rendering
    const sectionTriggers = container.querySelectorAll('[data-slot="collapsible-trigger"]');
    expect(Array.from(sectionTriggers).map((t) => t.textContent?.trim())).toEqual([
      '外觀與介面',
      '側邊欄版面',
      '搜尋欄與快捷鍵',
      '搜尋結果顯示',
      '書籤與歷史',
    ]);

    // Switch displayLocale to zh-CN via Language Select
    await changeSelectValue(container, 'displayLocale', 'zh-CN');
    expect(currentModule?.read().displayLocale).toBe('zh-CN');
    expect(storage.inspect()['displayLocale']).toBe('zh-CN');
    expect(Array.from(sectionTriggers).map((t) => t.textContent?.trim())).toEqual([
      '外观与界面',
      '侧边栏版面',
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
      'Appearance & Language',
      'Sidebar Layout',
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
      'Appearance & Language',
      'Sidebar Layout',
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

  it('updates sidebar size and width via Select', async () => {
    const { container } = await mountSettingsPane();

    // Select 'small'
    await changeSelectValue(container, 'sidebarSize', 'small');
    expect(currentModule?.read().sidebarSize).toBe('small');
    expect(currentModule?.read().sidebarWidth).toBe(SIDEBAR_SIZE_PRESETS.small);

    // Select 'large'
    await changeSelectValue(container, 'sidebarSize', 'large');
    expect(currentModule?.read().sidebarSize).toBe('large');
    expect(currentModule?.read().sidebarWidth).toBe(SIDEBAR_SIZE_PRESETS.large);
  });

  it('does not render custom width numeric Input when custom is selected, showing drag helper text instead', async () => {
    const { container } = await mountSettingsPane();

    // Select 'custom'
    await changeSelectValue(container, 'sidebarSize', 'custom');

    // Input for custom width should NOT appear
    const widthInput = container.querySelector('input[type="number"][min="300"]');
    expect(widthInput).toBeNull();

    // Helper text must appear
    expect(container.textContent).toContain('選擇「自訂」後，可拖曳側邊欄邊緣調整寬度。');
    expect(currentModule?.read().sidebarSize).toBe('custom');
  });

  it('updates font size scale and mode via Select and custom input', async () => {
    const { container } = await mountSettingsPane();

    // Select 'small' (fontSizeMode, scale: 0.85)
    await changeSelectValue(container, 'fontSizeMode', 'small');
    expect(currentModule?.read().fontSizeMode).toBe('small');
    expect(currentModule?.read().fontSizeScale).toBe(0.85);

    // Select 'large' (scale: 1.2)
    await changeSelectValue(container, 'fontSizeMode', 'large');
    expect(currentModule?.read().fontSizeMode).toBe('large');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // Select 'custom'
    await changeSelectValue(container, 'fontSizeMode', 'custom');
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    const scaleInput = container.querySelector(
      'input[type="number"][min="80"]',
    ) as HTMLInputElement;
    expect(scaleInput).not.toBeNull();
    expect(scaleInput.closest('.flex.justify-end')).not.toBeNull();
    expect(scaleInput.parentElement?.className).toContain('w-[140px]');

    scaleInput.value = '150';
    scaleInput.dispatchEvent(new Event('input'));
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.5);
  });

  it('permanently distinguishes Large 120% from Custom 120%', async () => {
    const { container } = await mountSettingsPane();

    // 1. Select Large -> mode = large, scale = 1.2
    await changeSelectValue(container, 'fontSizeMode', 'large');
    expect(currentModule?.read().fontSizeMode).toBe('large');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // 2. Select Custom and input 120 -> mode = custom, scale = 1.2
    await changeSelectValue(container, 'fontSizeMode', 'custom');
    const scaleInput = container.querySelector(
      'input[type="number"][min="80"]',
    ) as HTMLInputElement;
    expect(scaleInput).not.toBeNull();
    scaleInput.value = '120';
    scaleInput.dispatchEvent(new Event('input'));
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();

    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);
  });

  it('preserves fontSizeMode = custom when unrelated preferences change', async () => {
    const { container } = await mountSettingsPane();

    // Set Custom 120%
    await changeSelectValue(container, 'fontSizeMode', 'custom');
    const scaleInput = container.querySelector(
      'input[type="number"][min="80"]',
    ) as HTMLInputElement;
    scaleInput.value = '120';
    scaleInput.dispatchEvent(new Event('input'));
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();

    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // Change enableHotkeys
    const hotkeyCheckbox = container.querySelector('#enable-hotkeys') as HTMLButtonElement;
    hotkeyCheckbox.click();
    await flushAsync();
    expect(currentModule?.read().enableHotkeys).toBe(false);
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // Change sidebarPosition to right
    await changeToggleGroupValue(container, 'right');
    expect(currentModule?.read().sidebarPosition).toBe('right');
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // Change sidebarSize to custom
    await changeSelectValue(container, 'sidebarSize', 'custom');
    expect(currentModule?.read().sidebarSize).toBe('custom');
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);
  });

  it('retains custom values for sidebar width and font scale when switching back from preset options', async () => {
    const { container } = await mountSettingsPane();

    // 1. 設定自訂選單寬度為 560（如透過拖曳已存進 customSidebarWidth）
    await currentModule!.update({
      sidebarSize: 'custom',
      sidebarWidth: 560,
      customSidebarWidth: 560,
    });
    await flushAsync();
    expect(currentModule?.read().sidebarSize).toBe('custom');
    expect(currentModule?.read().sidebarWidth).toBe(560);
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(container.textContent).toContain('選擇「自訂」後，可拖曳側邊欄邊緣調整寬度。');

    // 2. 切換為「大」
    await changeSelectValue(container, 'sidebarSize', 'large');
    expect(currentModule?.read().sidebarSize).toBe('large');
    expect(currentModule?.read().sidebarWidth).toBe(SIDEBAR_SIZE_PRESETS.large);
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();

    // 3. 切換為「小」
    await changeSelectValue(container, 'sidebarSize', 'small');
    expect(currentModule?.read().sidebarSize).toBe('small');
    expect(currentModule?.read().sidebarWidth).toBe(SIDEBAR_SIZE_PRESETS.small);

    // 4. 切回「自訂」，驗證保持 560
    await changeSelectValue(container, 'sidebarSize', 'custom');
    expect(currentModule?.read().sidebarSize).toBe('custom');
    expect(currentModule?.read().sidebarWidth).toBe(560);
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(container.textContent).toContain('選擇「自訂」後，可拖曳側邊欄邊緣調整寬度。');

    // 5. 設定自訂縮放比例為 135%
    await changeSelectValue(container, 'fontSizeMode', 'custom');
    let scaleInput = container.querySelector('input[type="number"][min="80"]') as HTMLInputElement;
    expect(scaleInput).not.toBeNull();
    scaleInput.value = '135';
    scaleInput.dispatchEvent(new Event('input'));
    scaleInput.dispatchEvent(new Event('blur'));
    await flushAsync();
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.35);

    // 6. 切換為「小」
    await changeSelectValue(container, 'fontSizeMode', 'small');
    expect(currentModule?.read().fontSizeMode).toBe('small');
    expect(currentModule?.read().fontSizeScale).toBe(0.85);
    expect(container.querySelector('input[type="number"][min="80"]')).toBeNull();

    // 7. 切換為「大」
    await changeSelectValue(container, 'fontSizeMode', 'large');
    expect(currentModule?.read().fontSizeMode).toBe('large');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // 8. 切回「自訂」，驗證保持 135%
    await changeSelectValue(container, 'fontSizeMode', 'custom');
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.35);
    scaleInput = container.querySelector('input[type="number"][min="80"]') as HTMLInputElement;
    expect(scaleInput).not.toBeNull();
    expect(scaleInput.value).toBe('135');
  });

  it('persists custom width and font scale across unmount/remount via Preferences SSOT without localStorage', async () => {
    // 1. Mount first instance
    const first = await mountSettingsPane();

    // 1. 設 custom width = 560
    await currentModule!.update({
      sidebarSize: 'custom',
      sidebarWidth: 560,
      customSidebarWidth: 560,
    });
    await flushAsync();
    expect(currentModule?.read().sidebarSize).toBe('custom');
    expect(currentModule?.read().sidebarWidth).toBe(560);
    expect(currentModule?.read().customSidebarWidth).toBe(560);

    // 2. 切到 small
    await changeSelectValue(first.container, 'sidebarSize', 'small');
    expect(currentModule?.read().sidebarSize).toBe('small');
    expect(currentModule?.read().sidebarWidth).toBe(SIDEBAR_SIZE_PRESETS.small);
    expect(currentModule?.read().customSidebarWidth).toBe(560);

    // 設 custom font scale = 1.35
    await changeSelectValue(first.container, 'fontSizeMode', 'custom');
    let scaleInput1 = first.container.querySelector(
      'input[type="number"][min="80"]',
    ) as HTMLInputElement;
    scaleInput1.value = '135';
    scaleInput1.dispatchEvent(new Event('input'));
    scaleInput1.dispatchEvent(new Event('blur'));
    await flushAsync();
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.35);
    expect(currentModule?.read().customFontSizeScale).toBe(1.35);

    // 切到 large
    await changeSelectValue(first.container, 'fontSizeMode', 'large');
    expect(currentModule?.read().fontSizeMode).toBe('large');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);
    expect(currentModule?.read().customFontSizeScale).toBe(1.35);

    // 3. unmount SettingsPane
    app.unmount();
    container.innerHTML = '';

    // 4. 使用同一 Preferences storage 重新 mount
    const second = await mountSettingsPane();

    // 5. 此時 active 仍為 small 與 large
    expect(currentModule?.read().sidebarSize).toBe('small');
    expect(currentModule?.read().sidebarWidth).toBe(SIDEBAR_SIZE_PRESETS.small);
    expect(currentModule?.read().fontSizeMode).toBe('large');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);

    // 6. 切回 custom
    await changeSelectValue(second.container, 'sidebarSize', 'custom');

    // 7. 恢復 560
    expect(currentModule?.read().sidebarSize).toBe('custom');
    expect(currentModule?.read().sidebarWidth).toBe(560);
    expect(second.container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(second.container.textContent).toContain('選擇「自訂」後，可拖曳側邊欄邊緣調整寬度。');

    // 切回 custom font scale
    await changeSelectValue(second.container, 'fontSizeMode', 'custom');

    // 恢復 1.35
    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.35);
    const scaleInput2 = second.container.querySelector(
      'input[type="number"][min="80"]',
    ) as HTMLInputElement;
    expect(scaleInput2).not.toBeNull();
    expect(scaleInput2.value).toBe('135');

    // 驗證所有值存在既有 Preferences storage，而不是 localStorage
    const storedSnapshot = storage.inspect();
    expect(storedSnapshot['customSidebarWidth_poe1']).toBe(560);
    expect(storedSnapshot['customFontSizeScale_poe1']).toBe(1.35);
    expect(window.localStorage.getItem('poexd_custom_sidebar_width_poe1')).toBeNull();
    expect(window.localStorage.getItem('poexd_custom_font_size_percent_poe1')).toBeNull();
  });

  it('restores custom font size mode and 120% input on reload without showing large', async () => {
    window.location.pathname = '/trade2/search/Standard';
    storage = createInMemoryPreferencesStorage({
      fontSizeMode_poe2: 'custom',
      fontSizeScale_poe2: 1.2,
    });

    const { container } = await mountSettingsPane();
    const triggers = container.querySelectorAll('[data-slot="select-trigger"]');

    // Font size select must display '自訂'
    const fontSizeTrigger = Array.from(triggers).find((t) =>
      t.parentElement?.textContent?.includes('介面縮放比例'),
    );
    expect(fontSizeTrigger?.textContent).toContain('自訂');

    // Custom input must exist and display 120
    const scaleInput = container.querySelector(
      'input[type="number"][min="80"]',
    ) as HTMLInputElement;
    expect(scaleInput).not.toBeNull();
    expect(scaleInput.value).toBe('120');

    expect(currentModule?.read().fontSizeMode).toBe('custom');
    expect(currentModule?.read().fontSizeScale).toBe(1.2);
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

  it('provides collapsible sections that toggle independently without modifying preferences', async () => {
    const { container } = await mountSettingsPane();
    const initialPrefs = { ...currentModule?.read() };

    const triggers = container.querySelectorAll<HTMLElement>('[data-slot="collapsible-trigger"]');
    expect(triggers.length).toBe(5);

    // Toggle all 5 sections closed
    for (const trigger of Array.from(triggers)) {
      trigger.click();
      await flushAsync();
    }

    // Preferences must remain completely untouched
    expect(currentModule?.read()).toEqual(initialPrefs);

    // Toggle all 4 sections open again
    for (const trigger of Array.from(triggers)) {
      trigger.click();
      await flushAsync();
    }
    expect(currentModule?.read()).toEqual(initialPrefs);
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
      sidebarSize: 'custom',
      enableHotkeys: false,
      densityScale: 0.8,
      fontSizeMode: 'large',
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
    // Sidebar size: 'custom'
    expect(triggers[2].textContent).toContain('自訂');
    // Font size mode: 'large'
    expect(triggers[3].textContent).toContain('大');

    // Sidebar position in ToggleGroup reflects 'right'
    const rightItem = container.querySelector('[data-slot="toggle-group-item"][value="right"]');
    expect(rightItem?.getAttribute('data-state')).toBe('on');

    // Density scale reflects in checkbox: checked
    const densityCompact = container.querySelector('#density-compact');
    expect(densityCompact?.getAttribute('data-state')).toBe('checked');

    // 2. Enable hotkeys checkbox: unchecked
    const hotkeyCheckbox = container.querySelector('#enable-hotkeys');
    expect(hotkeyCheckbox?.getAttribute('data-state')).toBe('unchecked');

    // 3. Custom width reflects updated sidebarWidth without numeric input, showing drag helper
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(container.textContent).toContain('選擇「自訂」後，可拖曳側邊欄邊緣調整寬度。');
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
    expect(content).not.toContain('ref(DEFAULT_PREFERENCES.sidebarSize)');
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

    // Compound handlers: preserve active ones, eliminate dead custom width ones
    expect(content).toContain('const handleSizeChange');
    expect(content).not.toContain('const handleCustomWidthInput');
    expect(content).not.toContain('const handleCustomWidthBlur');
    expect(content).toContain('const handleFontSizeModeChange');
    expect(content).toContain('const handleCustomFontSizeInput');
    expect(content).toContain('const handleCustomFontSizeBlur');
    expect(content).toContain('const handleDensityChange');
    expect(content).toContain('const saveTildeSettings');
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

  it('commit updates both sidebarWidth and customSidebarWidth, preventing rollback on preference snapshot', async () => {
    const { container } = await mountSettingsPane();

    // Switch to custom mode (380)
    await changeSelectValue(container, 'sidebarSize', 'custom');
    expect(container.querySelector('input[type="number"][min="300"]')).toBeNull();
    expect(container.textContent).toContain('選擇「自訂」後，可拖曳側邊欄邊緣調整寬度。');

    // Formal resize-end commit: both sidebarWidth and customSidebarWidth are 500
    await currentModule!.update({
      sidebarSize: 'custom',
      sidebarWidth: 500,
      customSidebarWidth: 500,
    });
    await flushAsync();

    expect(currentModule?.read().sidebarWidth).toBe(500);
    expect(currentModule?.read().customSidebarWidth).toBe(500);

    // Unrelated preference update triggers snapshot notification
    await currentModule!.update({
      enablePureBackground: false,
    });
    await flushAsync();

    // customSidebarWidth must NOT revert to old 380
    expect(currentModule?.read().sidebarWidth).toBe(500);
    expect(currentModule?.read().customSidebarWidth).toBe(500);
  });

  it('static guard: Sidebar.vue commits customSidebarWidth on resize-end and SettingsPane eliminates dead preview listener', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const sidebarPath = path.resolve(__dirname, '../components/Sidebar.vue');
    const sidebarContent = fs.readFileSync(sidebarPath, 'utf-8');

    // handleResizeEnd in Sidebar.vue must commit both sidebarWidth and customSidebarWidth
    expect(sidebarContent).toMatch(/handleResizeEnd[\s\S]*?sidebarSize:\s*'custom'/);
    expect(sidebarContent).toMatch(/handleResizeEnd[\s\S]*?sidebarWidth:\s*sidebarWidth\.value/);
    expect(sidebarContent).toMatch(
      /handleResizeEnd[\s\S]*?customSidebarWidth:\s*sidebarWidth\.value/,
    );

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
});
