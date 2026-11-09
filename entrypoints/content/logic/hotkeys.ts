import type { PreferencesModule } from '@/utils/preferences';

function getActiveElementDeep(): Element | null {
  let activeElement = document.activeElement;
  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

export function initHotkeysAndTildeListeners(preferences: PreferencesModule) {
  let isComposing = false;

  const handleKeyDown = (event: KeyboardEvent) => {
    const current = preferences.read();
    const enableHotkeys = current.enableHotkeys;
    if (!enableHotkeys) return;

    const activeElement = getActiveElementDeep();
    const isTyping =
      activeElement &&
      (activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.getAttribute('contenteditable') === 'true');
    const currentCombo = getEventCombo(event);
    const isCombo = event.ctrlKey || event.altKey || event.metaKey;
    if (isTyping && !isCombo) return;

    const focusHotkey = current.hotkeyFocus;
    const clearHotkey = current.hotkeyClear;
    if (focusHotkey && currentCombo === focusHotkey) {
      event.preventDefault();
      focusSearchInput();
    } else if (clearHotkey && currentCombo === clearHotkey) {
      event.preventDefault();
      clearAndFocusSearchInput();
    }
  };

  const handleCompositionStart = () => {
    isComposing = true;
  };
  const handleCompositionEnd = (event: Event) => {
    isComposing = false;
    const target = event.target as HTMLInputElement;
    if (!target?.classList.contains('multiselect__input')) return;
    setTimeout(() => applyTildePrefix(target, preferences), 50);
  };
  const handleInput = (event: Event) => {
    if (isComposing || (event as InputEvent).isComposing) return;
    const target = event.target as HTMLInputElement;
    if (!target?.classList.contains('multiselect__input')) return;
    applyTildePrefix(target, preferences);
  };

  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('compositionstart', handleCompositionStart);
  document.addEventListener('compositionend', handleCompositionEnd);
  document.addEventListener('input', handleInput);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('compositionstart', handleCompositionStart);
    document.removeEventListener('compositionend', handleCompositionEnd);
    document.removeEventListener('input', handleInput);
  };
}

function applyTildePrefix(target: HTMLInputElement, preferences: PreferencesModule) {
  const { enableSearchTilde, enableFilterTilde } = preferences.read();
  const placeholder = target.placeholder || '';
  const isSearchInput =
    placeholder.includes('搜尋') ||
    placeholder.toLowerCase().includes('search') ||
    target.closest('.search-left') !== null ||
    target.closest('.search-bar') !== null;
  const isFilterInput =
    placeholder.includes('過濾') ||
    placeholder.toLowerCase().includes('filter') ||
    target.closest('.filter-group-select') !== null ||
    target.closest('.filter-group-header') !== null;

  if ((isSearchInput && enableSearchTilde) || (isFilterInput && enableFilterTilde)) {
    if (target.value && !target.value.startsWith('~')) {
      target.value = `~${target.value}`;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

function getEventCombo(event: KeyboardEvent) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  let combo = '';
  if (event.ctrlKey) combo += 'Ctrl+';
  if (event.altKey) combo += 'Alt+';
  if (event.shiftKey) combo += 'Shift+';
  const keyName = event.key === ' ' ? 'Space' : event.key === 'Escape' ? 'Esc' : event.key;
  return combo + keyName;
}

function focusSearchInput() {
  const input = document.querySelector('.search-left input') as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

function clearAndFocusSearchInput() {
  (document.querySelector('.clear-btn') as HTMLButtonElement | null)?.click();
  const input = document.querySelector('.search-left input') as HTMLInputElement | null;
  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  setTimeout(focusSearchInput, 50);
}
