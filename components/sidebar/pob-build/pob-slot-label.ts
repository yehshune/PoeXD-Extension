/**
 * PoB 的部位名稱（英文）轉成介面語言。認不得的部位保留 PoB 原文。
 */
import { t, type I18nKey } from '@/utils/i18n';

const FIXED_SLOTS: Readonly<Record<string, I18nKey>> = {
  'Weapon 1': 'pobBuild.slot.mainHand',
  'Weapon 2': 'pobBuild.slot.offHand',
  'Weapon 1 Swap': 'pobBuild.slot.mainHandSwap',
  'Weapon 2 Swap': 'pobBuild.slot.offHandSwap',
  Helmet: 'pobBuild.slot.helmet',
  'Body Armour': 'pobBuild.slot.bodyArmour',
  Gloves: 'pobBuild.slot.gloves',
  Boots: 'pobBuild.slot.boots',
  Amulet: 'pobBuild.slot.amulet',
  Belt: 'pobBuild.slot.belt',
  Jewel: 'pobBuild.slot.jewel',
};

const NUMBERED_SLOTS: Readonly<Record<string, I18nKey>> = {
  Ring: 'pobBuild.slot.ring',
  Flask: 'pobBuild.slot.flask',
  Charm: 'pobBuild.slot.charm',
};

const NUMBERED_SLOT = /^([A-Za-z]+) (\d+)$/;
/** 裝備上的深淵插槽：`Belt Abyssal Socket 1` */
const ABYSSAL_SLOT = /^(.+) Abyssal Socket (\d+)$/;

export function formatPobSlot(slot: string): string {
  if (Object.hasOwn(FIXED_SLOTS, slot)) return t(FIXED_SLOTS[slot]);
  const abyssal = ABYSSAL_SLOT.exec(slot);
  if (abyssal)
    return t('pobBuild.slot.abyssal', { slot: formatPobSlot(abyssal[1]), n: abyssal[2] });
  const numbered = NUMBERED_SLOT.exec(slot);
  if (numbered && Object.hasOwn(NUMBERED_SLOTS, numbered[1])) {
    return t(NUMBERED_SLOTS[numbered[1]], { n: numbered[2] });
  }
  return slot;
}
