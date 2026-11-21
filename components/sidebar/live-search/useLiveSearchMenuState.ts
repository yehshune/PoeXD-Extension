import { onUnmounted, ref } from 'vue';

export function useLiveSearchMenuState() {
  const isFilteredBatchMenuOpen = ref(false);
  const activeGroupMenuId = ref<string | null>(null);
  const activeItemMenuId = ref<string | null>(null);

  let ignoreNextMenuClick = false;
  let menuClickResetTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerDownToggledMenu = false;

  function clearMenuClickTimer() {
    if (menuClickResetTimer) {
      clearTimeout(menuClickResetTimer);
      menuClickResetTimer = null;
    }
  }

  function closeAllMenus() {
    activeGroupMenuId.value = null;
    activeItemMenuId.value = null;
    isFilteredBatchMenuOpen.value = false;
  }

  function setIgnoreNextMenuClick() {
    ignoreNextMenuClick = true;
    clearMenuClickTimer();
    menuClickResetTimer = setTimeout(() => {
      ignoreNextMenuClick = false;
      menuClickResetTimer = null;
    }, 400);
  }

  function handleMenuTriggerClickCapture(event: MouseEvent) {
    if (ignoreNextMenuClick) {
      event.preventDefault();
      event.stopPropagation();
      ignoreNextMenuClick = false;
      clearMenuClickTimer();
    }
  }

  function setFilteredBatchMenuOpen(open: boolean) {
    pointerDownToggledMenu = true;
    if (open) {
      activeGroupMenuId.value = null;
      activeItemMenuId.value = null;
    }
    isFilteredBatchMenuOpen.value = open;
  }

  function handleFilteredTriggerPointerDown(event: PointerEvent | MouseEvent) {
    pointerDownToggledMenu = false;
    if (isFilteredBatchMenuOpen.value) {
      event.preventDefault();
      event.stopPropagation();
      setIgnoreNextMenuClick();
      isFilteredBatchMenuOpen.value = false;
      pointerDownToggledMenu = true;
    }
  }

  function handleFilteredTriggerClick() {
    if (pointerDownToggledMenu) {
      pointerDownToggledMenu = false;
      return;
    }
    const next = !isFilteredBatchMenuOpen.value;
    if (next) {
      activeGroupMenuId.value = null;
      activeItemMenuId.value = null;
    }
    isFilteredBatchMenuOpen.value = next;
  }

  function setGroupMenuOpen(groupId: string, open: boolean) {
    pointerDownToggledMenu = true;
    if (open) {
      isFilteredBatchMenuOpen.value = false;
      activeItemMenuId.value = null;
      activeGroupMenuId.value = groupId;
      return;
    }
    if (activeGroupMenuId.value === groupId) {
      activeGroupMenuId.value = null;
    }
  }

  function handleGroupTriggerPointerDown(groupId: string, event: PointerEvent | MouseEvent) {
    pointerDownToggledMenu = false;
    if (activeGroupMenuId.value === groupId) {
      event.preventDefault();
      event.stopPropagation();
      setIgnoreNextMenuClick();
      activeGroupMenuId.value = null;
      pointerDownToggledMenu = true;
    }
  }

  function handleGroupTriggerClick(groupId: string) {
    if (pointerDownToggledMenu) {
      pointerDownToggledMenu = false;
      return;
    }
    if (activeGroupMenuId.value === groupId) {
      activeGroupMenuId.value = null;
    } else {
      isFilteredBatchMenuOpen.value = false;
      activeItemMenuId.value = null;
      activeGroupMenuId.value = groupId;
    }
  }

  function setItemMenuOpen(itemId: string, open: boolean) {
    pointerDownToggledMenu = true;
    if (open) {
      isFilteredBatchMenuOpen.value = false;
      activeGroupMenuId.value = null;
      activeItemMenuId.value = itemId;
      return;
    }
    if (activeItemMenuId.value === itemId) {
      activeItemMenuId.value = null;
    }
  }

  function handleItemTriggerPointerDown(itemId: string, event: PointerEvent | MouseEvent) {
    pointerDownToggledMenu = false;
    if (activeItemMenuId.value === itemId) {
      event.preventDefault();
      event.stopPropagation();
      setIgnoreNextMenuClick();
      activeItemMenuId.value = null;
      pointerDownToggledMenu = true;
    }
  }

  function handleItemTriggerClick(itemId: string) {
    if (pointerDownToggledMenu) {
      pointerDownToggledMenu = false;
      return;
    }
    if (activeItemMenuId.value === itemId) {
      activeItemMenuId.value = null;
    } else {
      isFilteredBatchMenuOpen.value = false;
      activeGroupMenuId.value = null;
      activeItemMenuId.value = itemId;
    }
  }

  onUnmounted(() => {
    clearMenuClickTimer();
  });

  return {
    isFilteredBatchMenuOpen,
    activeGroupMenuId,
    activeItemMenuId,
    closeAllMenus,
    handleMenuTriggerClickCapture,
    setFilteredBatchMenuOpen,
    handleFilteredTriggerPointerDown,
    handleFilteredTriggerClick,
    setGroupMenuOpen,
    handleGroupTriggerPointerDown,
    handleGroupTriggerClick,
    setItemMenuOpen,
    handleItemTriggerPointerDown,
    handleItemTriggerClick,
  };
}
