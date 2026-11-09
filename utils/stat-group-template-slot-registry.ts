import { shallowRef } from 'vue';

/**
 * 官方「新增詞綴群組」旁，供常用詞綴群組選單 Teleport 的插入點。
 * 由 content logic 掃描 DOM 後同步，Sidebar 內的 StatGroupTemplateHost 消費。
 */
export const activeStatGroupTemplateSlots = shallowRef<HTMLElement[]>([]);

export function syncStatGroupTemplateSlots(slots: HTMLElement[]): void {
  const current = activeStatGroupTemplateSlots.value;
  const unchanged = current.length === slots.length && current.every((el, i) => el === slots[i]);
  if (!unchanged) activeStatGroupTemplateSlots.value = [...slots];
}

export function clearStatGroupTemplateSlots(): void {
  if (activeStatGroupTemplateSlots.value.length > 0) activeStatGroupTemplateSlots.value = [];
}
