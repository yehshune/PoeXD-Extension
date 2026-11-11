import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 疊層一律走 assets/main.css 的 --pxd-z-* token；數字 z-index 會讓浮動選單或對話框跑到後面。
 */
const ROOTS = ['components', 'entrypoints/sidebar', 'entrypoints/popup'];
const RAW_Z_CLASS = /(?:^|[\s"'`:])z-(?:\d+|\[\d+\])(?=[\s"'`]|$)/m;
const RAW_Z_CSS = /z-index:\s*\d/;

function listSources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return /\.(vue|ts|css)$/.test(name) ? [path] : [];
  });
}

describe('z-index tokens', () => {
  it('元件不使用數字 z-index', () => {
    const offenders = ROOTS.flatMap(listSources).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return RAW_Z_CLASS.test(source) || RAW_Z_CSS.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('浮動選單層高於所有對話框層', () => {
    const css = readFileSync('assets/main.css', 'utf8');
    const token = (name: string) => {
      const match = css.match(new RegExp(String.raw`--pxd-z-${name}:\s*(\d+)`));
      if (!match) throw new Error(`missing --pxd-z-${name}`);
      return Number(match[1]);
    };
    const dialogs = [token('dialog'), token('dialog-nested'), token('dialog-system')];
    expect(dialogs).toEqual([...dialogs].sort((a, b) => a - b));
    expect(token('floating')).toBeGreaterThan(Math.max(...dialogs));
    expect(token('sidebar-handle')).toBeLessThan(token('dialog'));
    expect(token('toast')).toBeGreaterThan(token('floating'));
  });
});
