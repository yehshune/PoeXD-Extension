// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { useBookmarkMenuState } from '@/components/sidebar/composables/useBookmarkMenuState';

describe('useBookmarkMenuState Composable', () => {
  it('A. initial state has all menus closed and null IDs', () => {
    const state = useBookmarkMenuState();

    expect(state.isTransferMenuOpen.value).toBe(false);
    expect(state.activeGroupMenuId.value).toBeNull();
    expect(state.activeBookmarkMenuId.value).toBeNull();
    expect(state.isMoveSubMenu.value).toBe(false);
    expect(state.isCoverSubMenu.value).toBe(false);
  });

  it('B. open Group opens target group and closes all other menus and submenus', () => {
    const state = useBookmarkMenuState();

    state.isTransferMenuOpen.value = true;
    state.activeBookmarkMenuId.value = 'bm-1';
    state.isMoveSubMenu.value = true;
    state.isCoverSubMenu.value = true;

    state.setGroupMenuOpen('g1', true);

    expect(state.activeGroupMenuId.value).toBe('g1');
    expect(state.isTransferMenuOpen.value).toBe(false);
    expect(state.activeBookmarkMenuId.value).toBeNull();
    expect(state.isMoveSubMenu.value).toBe(false);
    expect(state.isCoverSubMenu.value).toBe(false);
  });

  it('C. stale Group close does not close currently active group', () => {
    const state = useBookmarkMenuState();

    state.setGroupMenuOpen('g1', true);
    expect(state.activeGroupMenuId.value).toBe('g1');

    state.setGroupMenuOpen('g2', true);
    expect(state.activeGroupMenuId.value).toBe('g2');

    // Attempting to close g1 when g2 is active should NOT close g2
    state.setGroupMenuOpen('g1', false);
    expect(state.activeGroupMenuId.value).toBe('g2');

    // Closing the active g2 should set activeGroupMenuId to null
    state.setGroupMenuOpen('g2', false);
    expect(state.activeGroupMenuId.value).toBeNull();
  });

  it('D. open Bookmark opens target bookmark and closes group, transfer, and submenus', () => {
    const state = useBookmarkMenuState();

    state.isTransferMenuOpen.value = true;
    state.activeGroupMenuId.value = 'g1';
    state.isMoveSubMenu.value = true;
    state.isCoverSubMenu.value = true;

    state.setBookmarkMenuOpen('bm1', true);

    expect(state.activeBookmarkMenuId.value).toBe('bm1');
    expect(state.activeGroupMenuId.value).toBeNull();
    expect(state.isTransferMenuOpen.value).toBe(false);
    expect(state.isMoveSubMenu.value).toBe(false);
    expect(state.isCoverSubMenu.value).toBe(false);
  });

  it('E. stale Bookmark close does not close currently active bookmark', () => {
    const state = useBookmarkMenuState();

    state.setBookmarkMenuOpen('bm1', true);
    expect(state.activeBookmarkMenuId.value).toBe('bm1');

    state.setBookmarkMenuOpen('bm2', true);
    expect(state.activeBookmarkMenuId.value).toBe('bm2');

    // Stale close for bm1 should not close bm2
    state.setBookmarkMenuOpen('bm1', false);
    expect(state.activeBookmarkMenuId.value).toBe('bm2');

    // Closing bm2 should reset activeBookmarkMenuId, Move, and Cover
    state.isMoveSubMenu.value = true;
    state.isCoverSubMenu.value = true;
    state.setBookmarkMenuOpen('bm2', false);
    expect(state.activeBookmarkMenuId.value).toBeNull();
    expect(state.isMoveSubMenu.value).toBe(false);
    expect(state.isCoverSubMenu.value).toBe(false);
  });

  it('F. Move / Cover exclusion: opening Move submenu closes Cover submenu', () => {
    const state = useBookmarkMenuState();

    state.isCoverSubMenu.value = true;
    state.setMoveSubMenuOpen(true);

    expect(state.isMoveSubMenu.value).toBe(true);
    expect(state.isCoverSubMenu.value).toBe(false);

    state.setMoveSubMenuOpen(false);
    expect(state.isMoveSubMenu.value).toBe(false);
  });

  it('G. Cover open=true contract: setCoverSubMenuOpen(true) does NOT directly open Cover submenu', () => {
    const state = useBookmarkMenuState();

    expect(state.isCoverSubMenu.value).toBe(false);

    // Reka hover request open=true must NOT set isCoverSubMenu = true
    state.setCoverSubMenuOpen(true);
    expect(state.isCoverSubMenu.value).toBe(false);

    // Explicit close must set isCoverSubMenu to false
    state.isCoverSubMenu.value = true;
    state.setCoverSubMenuOpen(false);
    expect(state.isCoverSubMenu.value).toBe(false);
  });

  it('H. closeAllMenus resets all 5 menu and submenu states', () => {
    const state = useBookmarkMenuState();

    state.isTransferMenuOpen.value = true;
    state.activeGroupMenuId.value = 'g1';
    state.activeBookmarkMenuId.value = 'bm1';
    state.isMoveSubMenu.value = true;
    state.isCoverSubMenu.value = true;

    state.closeAllMenus();

    expect(state.isTransferMenuOpen.value).toBe(false);
    expect(state.activeGroupMenuId.value).toBeNull();
    expect(state.activeBookmarkMenuId.value).toBeNull();
    expect(state.isMoveSubMenu.value).toBe(false);
    expect(state.isCoverSubMenu.value).toBe(false);
  });

  it('I. trigger pointerdown toggles open menu to close and suppresses following click', () => {
    const state = useBookmarkMenuState();
    state.activeBookmarkMenuId.value = 'bm-1';

    const pointerDownEvent = new MouseEvent('pointerdown', { cancelable: true });
    state.handleBookmarkTriggerPointerDown('bm-1', pointerDownEvent);

    expect(pointerDownEvent.defaultPrevented).toBe(true);
    expect(state.activeBookmarkMenuId.value).toBeNull();

    // The subsequent click must be prevented and stopped
    const clickEvent = new MouseEvent('click', { cancelable: true });
    state.handleTriggerClick(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    // Further click is not suppressed
    const nextClick = new MouseEvent('click', { cancelable: true });
    state.handleTriggerClick(nextClick);
    expect(nextClick.defaultPrevented).toBe(false);
  });

  it('J. trigger pointerdown when menu is closed does not intercept event', () => {
    const state = useBookmarkMenuState();
    expect(state.activeBookmarkMenuId.value).toBeNull();

    const pointerDownEvent = new MouseEvent('pointerdown', { cancelable: true });
    state.handleBookmarkTriggerPointerDown('bm-1', pointerDownEvent);

    expect(pointerDownEvent.defaultPrevented).toBe(false);
    expect(state.activeBookmarkMenuId.value).toBeNull();

    const clickEvent = new MouseEvent('click', { cancelable: true });
    state.handleTriggerClick(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it('K. group and transfer triggers toggle open menus to close and suppress click', () => {
    const state = useBookmarkMenuState();

    // Group trigger
    state.activeGroupMenuId.value = 'g-1';
    const groupPd = new MouseEvent('pointerdown', { cancelable: true });
    state.handleGroupTriggerPointerDown('g-1', groupPd);
    expect(groupPd.defaultPrevented).toBe(true);
    expect(state.activeGroupMenuId.value).toBeNull();

    const groupClick = new MouseEvent('click', { cancelable: true });
    state.handleTriggerClick(groupClick);
    expect(groupClick.defaultPrevented).toBe(true);

    // Transfer trigger
    state.isTransferMenuOpen.value = true;
    const transferPd = new MouseEvent('pointerdown', { cancelable: true });
    state.handleTransferTriggerPointerDown(transferPd);
    expect(transferPd.defaultPrevented).toBe(true);
    expect(state.isTransferMenuOpen.value).toBe(false);

    const transferClick = new MouseEvent('click', { cancelable: true });
    state.handleTriggerClick(transferClick);
    expect(transferClick.defaultPrevented).toBe(true);
  });
});
