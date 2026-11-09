import { shallowRef, nextTick } from 'vue';

export interface TierDropdownItemSpec {
  id: string;
  type:
    | 'switch_category'
    | 'trigger_modal'
    | 'header'
    | 'tier'
    | 'switch_mod_group'
    | 'mod_group_option'
    | 'back_to_tiers';
  label: string;
  tierName?: string;
  tierLevel?: number;
  rangeText?: string;
  valMin?: string;
  valMax?: string;
  isRange?: boolean;
  groupId?: string;
  groupIndex?: number;
  isActive?: boolean;
}

/**
 * 解析 Tier 項目的「階級與等級 (不可點擊標籤)」與「詞綴數值範圍 (點擊填入)」
 */
export function getTierParts(item: TierDropdownItemSpec): { tag: string; range: string } {
  // 1. 若有顯式提供 tierName
  if (item.tierName) {
    const tag = `${item.tierName}${item.tierLevel != null ? ` (Lv.${item.tierLevel})` : ''}`;
    let range = item.rangeText?.trim() || '';
    if (!range) {
      if (item.valMin && item.valMax) {
        range = `(${item.valMin} ~ ${item.valMax})`;
      } else if (item.valMin) {
        range = `(${item.valMin} ~ ${item.valMin})`;
      }
    }
    return { tag, range: range || item.label };
  }

  // 2. 從 item.label 解析 "T1 (Lv.85) (10 ~ 20)" 或 "T1 (10 ~ 20)"
  const match = item.label.match(/^(T\d+(?:\s*\(Lv\.\d+\))?)(.*)$/);
  if (match) {
    const tag = match[1].trim();
    let rest = match[2].trim();
    if (!rest) {
      if (item.rangeText?.trim()) {
        rest = item.rangeText.trim();
      } else if (item.valMin && item.valMax) {
        rest = `(${item.valMin} ~ ${item.valMax})`;
      } else if (item.valMin) {
        rest = `(${item.valMin} ~ ${item.valMin})`;
      }
    }
    if (!rest) {
      return { tag: '', range: item.label };
    }
    return { tag, range: rest };
  }

  // 3. 非 T 階格式 (例如測試用 "Button 1 Tier")
  return { tag: '', range: item.label };
}

/**
 * 取得 Tier 項目的最小與最大數值，單一數值時兩者相同
 */
export function getTierValues(item: TierDropdownItemSpec): { min: string; max: string } {
  const min = item.valMin ?? '';
  const max = item.valMax ?? item.valMin ?? '';
  return { min, max };
}

export interface TierSlotDescriptor {
  key: string;
  targetEl: HTMLElement;
  items: TierDropdownItemSpec[];
  onSelect: (item: TierDropdownItemSpec, mode?: 'min' | 'both' | 'max') => void;
}

/**
 * 集中管理所有活躍的 PoE 詞綴行 Teleport 槽位與 Tier 項目
 */
export const activeTierSlots = shallowRef<TierSlotDescriptor[]>([]);

/**
 * 由 DOM scanner 在掃描完成後同步槽位列表
 */
export function syncTierSlots(slots: TierSlotDescriptor[]): void {
  activeTierSlots.value = slots;
}

/**
 * 清空所有槽位（例如頁面切換或 teardown）
 */
export function clearTierSlots(): void {
  activeTierSlots.value = [];
}

/**
 * 以不可變陣列替換更新單一槽位描述，確保 shallowRef consumer 能感知變更
 */
export function upsertTierSlot(descriptor: TierSlotDescriptor): void {
  const current = activeTierSlots.value;
  const idx = current.findIndex((s) => s.key === descriptor.key);
  if (idx !== -1) {
    const next = [...current];
    next[idx] = descriptor;
    activeTierSlots.value = next;
  } else {
    activeTierSlots.value = [...current, descriptor];
  }
}

export type TierSlotRefreshHandler = (slotKey: string) => Promise<boolean> | boolean;

let refreshHandler: TierSlotRefreshHandler | null = null;

/**
 * 註冊 Tier domain 提供的槽位資料刷新函式 (由 common.ts 註冊)
 */
export function registerTierSlotRefresher(handler: TierSlotRefreshHandler | null): () => void {
  refreshHandler = handler;
  return () => {
    if (refreshHandler === handler) {
      refreshHandler = null;
    }
  };
}

/**
 * 依 stable slotKey 重新計算指定槽位的 domain snapshot 並更新 registry
 */
export async function refreshTierSlot(slotKey: string): Promise<boolean> {
  if (!refreshHandler) return false;
  return await refreshHandler(slotKey);
}

/**
 * 依 stable slotKey 刷新該槽位最新 domain snapshot，並開啟對應之原生 Reka Trigger
 */
export async function refreshAndReopenTierSlot(slotKey: string): Promise<boolean> {
  const refreshed = await refreshTierSlot(slotKey);
  if (!refreshed) return false;
  await nextTick();
  const trigger =
    document.querySelector<HTMLButtonElement>(`button[data-tier-slot-key="${slotKey}"]`) ||
    document.querySelector<HTMLButtonElement>(
      `.poexd-tier-trigger-slot[data-poexd-slot-key="${slotKey}"] button`,
    );
  if (trigger && trigger.isConnected) {
    trigger.click();
    return true;
  }
  return false;
}
