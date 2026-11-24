import { ref } from 'vue';

/** Workspace 內部的選單狀態部件。 */
export function createBookmarkMenus() {
  const isTransferMenuOpen = ref(false);
  const activeGroupMenuId = ref<string | null>(null);
  const activeBookmarkMenuId = ref<string | null>(null);
  const isMoveSubMenu = ref(false);
  const isCoverSubMenu = ref(false);

  const closeAllMenus = () => {
    isTransferMenuOpen.value = false;
    activeGroupMenuId.value = null;
    activeBookmarkMenuId.value = null;
    isMoveSubMenu.value = false;
    isCoverSubMenu.value = false;
  };

  const setGroupMenuOpen = (groupId: string, open: boolean) => {
    if (open) {
      isTransferMenuOpen.value = false;
      activeBookmarkMenuId.value = null;
      isMoveSubMenu.value = false;
      isCoverSubMenu.value = false;
      activeGroupMenuId.value = groupId;
      return;
    }

    if (activeGroupMenuId.value === groupId) {
      activeGroupMenuId.value = null;
    }
  };

  const setBookmarkMenuOpen = (bookmarkId: string, open: boolean) => {
    if (open) {
      isTransferMenuOpen.value = false;
      activeGroupMenuId.value = null;
      isMoveSubMenu.value = false;
      isCoverSubMenu.value = false;
      activeBookmarkMenuId.value = bookmarkId;
      return;
    }

    if (activeBookmarkMenuId.value === bookmarkId) {
      activeBookmarkMenuId.value = null;
      isMoveSubMenu.value = false;
      isCoverSubMenu.value = false;
    }
  };

  const setMoveSubMenuOpen = (open: boolean) => {
    isMoveSubMenu.value = open;
    if (open) {
      isCoverSubMenu.value = false;
    }
  };

  const setCoverSubMenuOpen = (open: boolean) => {
    if (!open) {
      isCoverSubMenu.value = false;
    }
  };

  let ignoreNextClick = false;
  let clickResetTimer: ReturnType<typeof setTimeout> | null = null;

  const setIgnoreClick = () => {
    ignoreNextClick = true;
    if (clickResetTimer) clearTimeout(clickResetTimer);
    clickResetTimer = setTimeout(() => {
      ignoreNextClick = false;
      clickResetTimer = null;
    }, 400);
  };

  const handleTriggerClick = (event: MouseEvent) => {
    if (ignoreNextClick) {
      event.preventDefault();
      event.stopPropagation();
      ignoreNextClick = false;
      if (clickResetTimer) {
        clearTimeout(clickResetTimer);
        clickResetTimer = null;
      }
    }
  };

  const dismissOnTriggerPointerDown = (
    isOpen: boolean,
    event: PointerEvent | MouseEvent,
    close: () => void,
  ) => {
    if (!isOpen) return;
    event.preventDefault();
    event.stopPropagation();
    setIgnoreClick();
    close();
  };

  const handleTransferTriggerPointerDown = (event: PointerEvent | MouseEvent) => {
    dismissOnTriggerPointerDown(isTransferMenuOpen.value, event, () => {
      isTransferMenuOpen.value = false;
    });
  };

  const handleGroupTriggerPointerDown = (groupId: string, event: PointerEvent | MouseEvent) => {
    dismissOnTriggerPointerDown(activeGroupMenuId.value === groupId, event, () => {
      activeGroupMenuId.value = null;
    });
  };

  const handleBookmarkTriggerPointerDown = (
    bookmarkId: string,
    event: PointerEvent | MouseEvent,
  ) => {
    dismissOnTriggerPointerDown(activeBookmarkMenuId.value === bookmarkId, event, () => {
      activeBookmarkMenuId.value = null;
      isMoveSubMenu.value = false;
      isCoverSubMenu.value = false;
    });
  };

  return {
    isTransferMenuOpen,
    activeGroupMenuId,
    activeBookmarkMenuId,
    isMoveSubMenu,
    isCoverSubMenu,

    closeAllMenus,
    setGroupMenuOpen,
    setBookmarkMenuOpen,
    setMoveSubMenuOpen,
    setCoverSubMenuOpen,
    handleTriggerClick,
    handleTransferTriggerPointerDown,
    handleGroupTriggerPointerDown,
    handleBookmarkTriggerPointerDown,
  };
}
