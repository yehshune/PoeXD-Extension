import type { PoeVersion } from '@/utils/trade-context';
import {
  typeMapPoe1,
  typeMapPoe2,
  typeNamesPoe1,
  typeNamesPoe2,
  poe1Groups,
  poe2Groups,
  typeRowConfigsPoe1,
  typeRowConfigsPoe2,
  officialCategoryMapPoe1,
  officialCategoryMapPoe2,
  type GroupConfig,
  type TypeRowConfig,
} from './typeMaps';

export interface TradeMapping {
  typeMap: Record<string, { cat: string[]; sub?: string[] }>;
  typeNames: Record<string, string>;
  machineOptionLookup: Record<string, string>;
  groups: GroupConfig[];
  typeRowConfigs: TypeRowConfig[];
}

export const tradeMappings: Record<PoeVersion, TradeMapping> = {
  poe1: {
    typeMap: typeMapPoe1,
    typeNames: typeNamesPoe1,
    machineOptionLookup: officialCategoryMapPoe1,
    groups: poe1Groups,
    typeRowConfigs: typeRowConfigsPoe1,
  },
  poe2: {
    typeMap: typeMapPoe2,
    typeNames: typeNamesPoe2,
    machineOptionLookup: officialCategoryMapPoe2,
    groups: poe2Groups,
    typeRowConfigs: typeRowConfigsPoe2,
  },
};

export const getTradeMapping = (version: PoeVersion) => tradeMappings[version];

export function validateTradeMapping(mapping: TradeMapping) {
  const errors: string[] = [];
  Object.entries(mapping.typeMap).forEach(([key, entry]) => {
    if (!entry.cat.length || entry.cat.some((label) => !label.trim())) {
      errors.push(`typeMap.${key} must contain non-empty category labels`);
    }
    if (entry.sub?.some((label) => !label.trim()))
      errors.push(`typeMap.${key} contains an empty subcategory label`);
  });
  const resolves = (key: string) => !!mapping.typeNames[key] || !!mapping.typeMap[key];
  Object.entries(mapping.machineOptionLookup).forEach(([option, key]) => {
    if (!option.trim()) {
      errors.push('machineOptionLookup contains an empty option key');
    } else if (!resolves(key)) {
      errors.push(`machineOptionLookup target ${key} is undefined`);
    }
  });
  mapping.groups.forEach((group) => {
    if (!group.groupLabel.trim()) errors.push('group must contain a non-empty label');
    group.keys.forEach((key) => {
      if (!resolves(key)) errors.push(`group key ${key} is undefined`);
    });
  });
  mapping.typeRowConfigs.forEach((row) => {
    if (!resolves(row.mainKey)) errors.push(`row mainKey ${row.mainKey} is undefined`);
    Object.keys(row.subKeys).forEach((key) => {
      if (!resolves(key)) errors.push(`row subKey ${key} is undefined`);
    });
  });
  return errors;
}
