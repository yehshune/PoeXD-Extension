// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import {
  rowAnchorFromEvent,
  usePinnedPreview,
} from '@/components/sidebar/composables/usePinnedPreview';

const item = (id: string) => ({ id });

describe('usePinnedPreview', () => {
  it('opens on the first toggle and closes when the same item is toggled again', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const preview = usePinnedPreview<{ id: string }>({ onOpen, onClose });
    const anchor = document.createElement('div');

    preview.toggle(item('a'), anchor);
    expect(preview.isOpen.value).toBe(true);
    expect(preview.activeItem.value?.id).toBe('a');
    expect(preview.anchorEl.value).toBe(anchor);
    expect(onOpen).toHaveBeenCalledWith(item('a'));

    preview.toggle(item('a'), anchor);
    expect(preview.isOpen.value).toBe(false);
    expect(preview.activeItem.value).toBeNull();
    expect(preview.anchorEl.value).toBeNull();
    expect(onClose).toHaveBeenCalledWith(item('a'));
  });

  it('switches to another item without closing in between', () => {
    const onClose = vi.fn();
    const preview = usePinnedPreview<{ id: string }>({ onClose });
    const b = document.createElement('div');
    preview.toggle(item('a'), document.createElement('div'));
    preview.toggle(item('b'), b);
    expect(preview.activeItem.value?.id).toBe('b');
    expect(preview.anchorEl.value).toBe(b);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores toggles without an anchor or while disabled, and closes when disabled', async () => {
    const disabled = ref(false);
    const preview = usePinnedPreview<{ id: string }>({ disabled });
    preview.toggle(item('a'), null);
    expect(preview.isOpen.value).toBe(false);

    preview.toggle(item('a'), document.createElement('div'));
    disabled.value = true;
    await nextTick();
    expect(preview.isOpen.value).toBe(false);

    preview.toggle(item('a'), document.createElement('div'));
    expect(preview.isOpen.value).toBe(false);
  });
});

describe('rowAnchorFromEvent', () => {
  it('anchors to the closest row, falling back to the clicked element', () => {
    const row = document.createElement('div');
    row.className = 'row';
    const button = document.createElement('button');
    row.appendChild(button);
    expect(rowAnchorFromEvent({ currentTarget: button } as unknown as Event, '.row')).toBe(row);
    expect(rowAnchorFromEvent({ currentTarget: button } as unknown as Event, '.none')).toBe(button);
    expect(rowAnchorFromEvent({ currentTarget: null } as unknown as Event, '.row')).toBeNull();
  });
});
