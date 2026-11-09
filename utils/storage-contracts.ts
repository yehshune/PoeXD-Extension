import type { PoeVersion } from './trade-context';

export function createVersionedStorageKeys(version: PoeVersion) {
  const key = (name: string) => `${name}_${version}`;

  return {
    activeTab: key('activeTab'),
    bookmarkCollapsedGroups: key('bookmarkCollapsedGroups'),
    isCollapsed: key('isCollapsed'),
  } as const;
}

export function readStorageValue<T>(
  data: Record<string, any>,
  versionedKey: string,
  legacyKey: string,
  defaultValue: T,
): T {
  if (data[versionedKey] !== undefined) return data[versionedKey] as T;
  if (data[legacyKey] !== undefined) return data[legacyKey] as T;
  return defaultValue;
}

export function collectLegacyStorageMigration(
  data: Record<string, any>,
  mappings: ReadonlyArray<readonly [versionedKey: string, legacyKey: string]>,
) {
  return mappings.reduce<Record<string, any>>((migration, [versionedKey, legacyKey]) => {
    if (data[versionedKey] === undefined && data[legacyKey] !== undefined) {
      migration[versionedKey] = data[legacyKey];
    }
    return migration;
  }, {});
}
