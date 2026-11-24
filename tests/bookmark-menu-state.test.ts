// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createBookmarkWorkspace } from '@/components/sidebar/bookmark-workspace';
import { createFakeBookmarkWorkspaceHost } from '@/components/sidebar/bookmark-workspace/fake-host';
import { createFakeBookmarkModel } from './helpers/fake-bookmark-model';

describe('Bookmark Workspace — menus', () => {
  const setupMenus = () =>
    createBookmarkWorkspace(createFakeBookmarkWorkspaceHost(), {
      version: 'poe1',
      model: createFakeBookmarkModel(),
    }).menus;

  it('A. initial state has all menus closed and null IDs', () => {
    const menus = setupMenus();

    expect(menus.isTransferMenuOpen.value).toBe(false);
    expect(menus.activeGroupMenuId.value).toBeNull();
    expect(menus.activeBookmarkMenuId.value).toBeNull();
    expect(menus.isMoveSubMenu.value).toBe(false);
    expect(menus.isCoverSubMenu.value).toBe(false);
  });

  it('B. open Group opens target group and closes all other menus and submenus', () => {
    const menus = setupMenus();

    menus.isTransferMenuOpen.value = true;
    menus.activeBookmarkMenuId.value = 'bm-1';
    menus.isMoveSubMenu.value = true;
    menus.isCoverSubMenu.value = true;

    menus.setGroupMenuOpen('g1', true);

    expect(menus.activeGroupMenuId.value).toBe('g1');
    expect(menus.isTransferMenuOpen.value).toBe(false);
    expect(menus.activeBookmarkMenuId.value).toBeNull();
    expect(menus.isMoveSubMenu.value).toBe(false);
    expect(menus.isCoverSubMenu.value).toBe(false);
  });

  it('C. stale Group close does not close currently active group', () => {
    const menus = setupMenus();

    menus.setGroupMenuOpen('g1', true);
    expect(menus.activeGroupMenuId.value).toBe('g1');

    menus.setGroupMenuOpen('g2', true);
    expect(menus.activeGroupMenuId.value).toBe('g2');

    // Attempting to close g1 when g2 is active should NOT close g2
    menus.setGroupMenuOpen('g1', false);
    expect(menus.activeGroupMenuId.value).toBe('g2');

    // Closing the active g2 should set activeGroupMenuId to null
    menus.setGroupMenuOpen('g2', false);
    expect(menus.activeGroupMenuId.value).toBeNull();
  });

  it('D. open Bookmark opens target bookmark and closes group, transfer, and submenus', () => {
    const menus = setupMenus();

    menus.isTransferMenuOpen.value = true;
    menus.activeGroupMenuId.value = 'g1';
    menus.isMoveSubMenu.value = true;
    menus.isCoverSubMenu.value = true;

    menus.setBookmarkMenuOpen('bm1', true);

    expect(menus.activeBookmarkMenuId.value).toBe('bm1');
    expect(menus.activeGroupMenuId.value).toBeNull();
    expect(menus.isTransferMenuOpen.value).toBe(false);
    expect(menus.isMoveSubMenu.value).toBe(false);
    expect(menus.isCoverSubMenu.value).toBe(false);
  });

  it('E. stale Bookmark close does not close currently active bookmark', () => {
    const menus = setupMenus();

    menus.setBookmarkMenuOpen('bm1', true);
    expect(menus.activeBookmarkMenuId.value).toBe('bm1');

    menus.setBookmarkMenuOpen('bm2', true);
    expect(menus.activeBookmarkMenuId.value).toBe('bm2');

    // Stale close for bm1 should not close bm2
    menus.setBookmarkMenuOpen('bm1', false);
    expect(menus.activeBookmarkMenuId.value).toBe('bm2');

    // Closing bm2 should reset activeBookmarkMenuId, Move, and Cover
    menus.isMoveSubMenu.value = true;
    menus.isCoverSubMenu.value = true;
    menus.setBookmarkMenuOpen('bm2', false);
    expect(menus.activeBookmarkMenuId.value).toBeNull();
    expect(menus.isMoveSubMenu.value).toBe(false);
    expect(menus.isCoverSubMenu.value).toBe(false);
  });

  it('F. Move / Cover exclusion: opening Move submenu closes Cover submenu', () => {
    const menus = setupMenus();

    menus.isCoverSubMenu.value = true;
    menus.setMoveSubMenuOpen(true);

    expect(menus.isMoveSubMenu.value).toBe(true);
    expect(menus.isCoverSubMenu.value).toBe(false);

    menus.setMoveSubMenuOpen(false);
    expect(menus.isMoveSubMenu.value).toBe(false);
  });

  it('G. Cover open=true contract: setCoverSubMenuOpen(true) does NOT directly open Cover submenu', () => {
    const menus = setupMenus();

    expect(menus.isCoverSubMenu.value).toBe(false);

    // Reka hover request open=true must NOT set isCoverSubMenu = true
    menus.setCoverSubMenuOpen(true);
    expect(menus.isCoverSubMenu.value).toBe(false);

    // Explicit close must set isCoverSubMenu to false
    menus.isCoverSubMenu.value = true;
    menus.setCoverSubMenuOpen(false);
    expect(menus.isCoverSubMenu.value).toBe(false);
  });

  it('H. closeAll resets all 5 menu and submenu states', () => {
    const menus = setupMenus();

    menus.isTransferMenuOpen.value = true;
    menus.activeGroupMenuId.value = 'g1';
    menus.activeBookmarkMenuId.value = 'bm1';
    menus.isMoveSubMenu.value = true;
    menus.isCoverSubMenu.value = true;

    menus.closeAll();

    expect(menus.isTransferMenuOpen.value).toBe(false);
    expect(menus.activeGroupMenuId.value).toBeNull();
    expect(menus.activeBookmarkMenuId.value).toBeNull();
    expect(menus.isMoveSubMenu.value).toBe(false);
    expect(menus.isCoverSubMenu.value).toBe(false);
  });

  it('I. trigger pointerdown toggles open menu to close and suppresses following click', () => {
    const menus = setupMenus();
    menus.activeBookmarkMenuId.value = 'bm-1';

    const pointerDownEvent = new MouseEvent('pointerdown', { cancelable: true });
    menus.handleBookmarkTriggerPointerDown('bm-1', pointerDownEvent);

    expect(pointerDownEvent.defaultPrevented).toBe(true);
    expect(menus.activeBookmarkMenuId.value).toBeNull();

    // The subsequent click must be prevented and stopped
    const clickEvent = new MouseEvent('click', { cancelable: true });
    menus.handleTriggerClick(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    // Further click is not suppressed
    const nextClick = new MouseEvent('click', { cancelable: true });
    menus.handleTriggerClick(nextClick);
    expect(nextClick.defaultPrevented).toBe(false);
  });

  it('J. trigger pointerdown when menu is closed does not intercept event', () => {
    const menus = setupMenus();
    expect(menus.activeBookmarkMenuId.value).toBeNull();

    const pointerDownEvent = new MouseEvent('pointerdown', { cancelable: true });
    menus.handleBookmarkTriggerPointerDown('bm-1', pointerDownEvent);

    expect(pointerDownEvent.defaultPrevented).toBe(false);
    expect(menus.activeBookmarkMenuId.value).toBeNull();

    const clickEvent = new MouseEvent('click', { cancelable: true });
    menus.handleTriggerClick(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it('K. group and transfer triggers toggle open menus to close and suppress click', () => {
    const menus = setupMenus();

    // Group trigger
    menus.activeGroupMenuId.value = 'g-1';
    const groupPd = new MouseEvent('pointerdown', { cancelable: true });
    menus.handleGroupTriggerPointerDown('g-1', groupPd);
    expect(groupPd.defaultPrevented).toBe(true);
    expect(menus.activeGroupMenuId.value).toBeNull();

    const groupClick = new MouseEvent('click', { cancelable: true });
    menus.handleTriggerClick(groupClick);
    expect(groupClick.defaultPrevented).toBe(true);

    // Transfer trigger
    menus.isTransferMenuOpen.value = true;
    const transferPd = new MouseEvent('pointerdown', { cancelable: true });
    menus.handleTransferTriggerPointerDown(transferPd);
    expect(transferPd.defaultPrevented).toBe(true);
    expect(menus.isTransferMenuOpen.value).toBe(false);

    const transferClick = new MouseEvent('click', { cancelable: true });
    menus.handleTriggerClick(transferClick);
    expect(transferClick.defaultPrevented).toBe(true);
  });
});
