import { describe, expect, it } from 'vitest';
import {
  matchesSettingsQuery,
  normalizeSettingsQuery,
} from '@/components/sidebar/settings/settings-search';

describe('settings search matching', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizeSettingsQuery('\t PoB \n  Copy ')).toBe('pob copy');
  });

  it('matches any text case-insensitively and treats empty queries as a match', () => {
    expect(matchesSettingsQuery('', ['anything'])).toBe(true);
    expect(matchesSettingsQuery(' \t ', [])).toBe(true);
    expect(matchesSettingsQuery('poedb', ['PoEDB 連結'])).toBe(true);
    expect(matchesSettingsQuery('快捷', ['主題', '啟用網頁快捷鍵'])).toBe(true);
    expect(matchesSettingsQuery('書籤', ['主題', undefined, null])).toBe(false);
  });
});
