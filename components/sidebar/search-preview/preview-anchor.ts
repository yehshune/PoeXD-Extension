export interface BoundaryVirtualElement {
  contextElement?: Element;
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
    x: number;
    y: number;
    toJSON(): any;
  };
}

/**
 * 依據外層邊界容器 (如 Sidebar Pane) 與目標 Trigger 元素，
 * 建立一個通用 VirtualElement 錨點，使 Floating UI 水平定位以邊界為準、垂直定位以 Trigger 為準。
 *
 * left / right / width 來自 boundary
 * top / height / bottom 來自實際 trigger
 */
export function createBoundaryVirtualElement(
  boundarySource: HTMLElement | (() => HTMLElement | null | undefined),
  triggerSource?: HTMLElement | (() => HTMLElement | null | undefined) | null,
): BoundaryVirtualElement {
  return {
    get contextElement() {
      const trigger = typeof triggerSource === 'function' ? triggerSource() : triggerSource;
      const boundary = typeof boundarySource === 'function' ? boundarySource() : boundarySource;
      return trigger ?? boundary ?? undefined;
    },
    getBoundingClientRect() {
      const boundary = typeof boundarySource === 'function' ? boundarySource() : boundarySource;
      const trigger = typeof triggerSource === 'function' ? triggerSource() : triggerSource;

      const boundaryRect = boundary?.getBoundingClientRect?.() ?? {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
      };
      const effectiveTriggerRect = trigger?.getBoundingClientRect?.() ?? boundaryRect;

      const left = boundaryRect.left;
      const top = effectiveTriggerRect.top;
      const width = boundaryRect.width;
      const height = effectiveTriggerRect.height;

      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON() {
          return this;
        },
      };
    },
  };
}
