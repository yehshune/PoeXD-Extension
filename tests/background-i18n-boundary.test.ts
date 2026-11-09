import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Background 不持有 UI 語系狀態，也不應打包 UI 字典（ADR-0011）：
 * 它只回傳翻譯 key（LocalizedMessage），由 UI 端以 formatMessage()/t() 翻譯。
 * 此測試沿著 Background 的「執行期」import（排除 `import type`）走訪，確保不會再接到 utils/i18n。
 */
const ROOT = resolve(__dirname, '..');
const I18N_ENTRY = join(ROOT, 'utils/i18n/index.ts');
const RUNTIME_IMPORT = /(?:^|\n)\s*import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/g;

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.vue`, join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function findImportChain(entry: string, target: string): string[] | null {
  const parent = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (file === target) {
      const chain: string[] = [];
      for (let cur: string | null = file; cur; cur = parent.get(cur) ?? null) {
        chain.unshift(relative(ROOT, cur));
      }
      return chain;
    }
    for (const match of readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) {
      const next = resolveImport(file, match[1]);
      if (next && !parent.has(next)) {
        parent.set(next, file);
        queue.push(next);
      }
    }
  }
  return null;
}

describe('Background i18n boundary', () => {
  it('does not import the UI i18n module at runtime', () => {
    const chain = findImportChain(join(ROOT, 'entrypoints/background/index.ts'), I18N_ENTRY);
    expect(chain, chain ? `import chain: ${chain.join(' -> ')}` : undefined).toBeNull();
  });
});
