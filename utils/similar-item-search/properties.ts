/**
 * 武器與防具的比較屬性：武器的 DPS／單次傷害／攻速／暴擊，防具的護甲、閃避、能量護盾、結界。
 * 數值取自 `/fetch` 的 `extended`（防禦已換算 20 品質）與 `properties` 的類型代碼。
 */
import { thresholdFor } from './threshold';
import type { DraftProperty, PropertyId, WeaponMode, WeaponModePreference } from './types';

const PROPERTY_TYPE = { crit: 12, aps: 13 } as const;
/** 某一種傷害佔總 DPS 的比例達到這個值時，預設只比該種傷害 */
const DOMINANT_SHARE = 0.6;
const DEFENCES = ['ar', 'ev', 'es', 'ward'] as const;
const NUMBER = /\d+(?:\.\d+)?/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function propertyValue(item: Record<string, unknown>, type: number): number | undefined {
  const properties = Array.isArray(item.properties) ? item.properties : [];
  const entry = properties.find((property) => isRecord(property) && property.type === type);
  const values = isRecord(entry) && Array.isArray(entry.values) ? entry.values : [];
  const first = Array.isArray(values[0]) ? values[0][0] : undefined;
  const match = typeof first === 'string' ? NUMBER.exec(first) : null;
  return match ? positive(Number(match[0])) : undefined;
}

const toProperty = (
  id: PropertyId,
  value: number,
  enabled: boolean,
  tolerance: number,
): DraftProperty => ({
  id,
  value,
  enabled,
  threshold: thresholdFor(value, tolerance),
  customized: false,
});

function autoWeaponMode(values: Partial<Record<PropertyId, number>>): WeaponMode {
  const dps = values.dps ?? 0;
  if (dps > 0 && (values.pdps ?? 0) >= dps * DOMINANT_SHARE) return 'pdps';
  if (dps > 0 && (values.edps ?? 0) >= dps * DOMINANT_SHARE) return 'edps';
  return 'dps';
}

function weaponValues(item: Record<string, unknown>): Partial<Record<PropertyId, number>> {
  const extended = isRecord(item.extended) ? item.extended : {};
  const dps = positive(extended.dps);
  const aps = propertyValue(item, PROPERTY_TYPE.aps);
  return {
    dps,
    pdps: positive(extended.pdps),
    edps: positive(extended.edps),
    damage: dps && aps ? roundTo(dps / aps, 1) : undefined,
    aps,
    crit: propertyValue(item, PROPERTY_TYPE.crit),
  };
}

export interface WeaponProperties {
  weaponMode: WeaponMode;
  properties: DraftProperty[];
}

/** 偏好的比較方式在這把武器上沒有數值時，退回依 DPS 組成自動判斷 */
function resolveWeaponMode(
  available: readonly PropertyId[],
  values: Partial<Record<PropertyId, number>>,
  preference: WeaponModePreference = 'auto',
): WeaponMode {
  return preference !== 'auto' && available.includes(preference)
    ? preference
    : autoWeaponMode(values);
}

export function deriveWeaponProperties(
  item: Record<string, unknown>,
  tolerance: number,
  preference: WeaponModePreference = 'auto',
): WeaponProperties {
  const values = weaponValues(item);
  const ids = (Object.keys(values) as PropertyId[]).filter((id) => values[id] !== undefined);
  const weaponMode = resolveWeaponMode(ids, values, preference);
  return {
    weaponMode,
    properties: ids.map((id) => toProperty(id, values[id] as number, id === weaponMode, tolerance)),
  };
}

export function deriveArmourProperties(
  item: Record<string, unknown>,
  tolerance: number,
): DraftProperty[] {
  const extended = isRecord(item.extended) ? item.extended : {};
  return DEFENCES.flatMap((id) => {
    const value = positive(extended[id]);
    return value !== undefined ? [toProperty(id, value, true, tolerance)] : [];
  });
}
