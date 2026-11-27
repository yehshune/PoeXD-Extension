import { describe, expect, it } from 'vitest';
import { loadEnglishStatText } from '@/entrypoints/content/logic/similar-search-feature';
import { panelPosition } from '@/entrypoints/content/logic/similar-search-panel-host';

describe('找相似面板位置', () => {
  const viewport = { width: 1600, height: 1000 };

  it('放在結果列下方，靠列的左邊', () => {
    expect(panelPosition({ top: 100, left: 300, bottom: 180, right: 900 }, viewport)).toEqual({
      top: 186,
      left: 300,
    });
  });

  it('列在視窗底部時往上移，右邊不超出視窗', () => {
    expect(panelPosition({ top: 900, left: 1500, bottom: 980, right: 1590 }, viewport)).toEqual({
      top: 640,
      left: 1152,
    });
  });
});

describe('英文市集 stat 寫法', () => {
  it('依版本載入，同一代碼有多種寫法時取第一個', async () => {
    const paths: string[] = [];
    const lookup = await loadEnglishStatText('poe2', async (path) => {
      paths.push(path);
      return {
        stats: {
          'explicit.stat_1': ['+# to Strength', 'other'],
          'explicit.stat_2': '+#% to Fire Resistance',
        },
      };
    });
    expect(paths).toEqual(['json/poe2/locales/en/trade-stats.json']);
    expect(lookup('explicit.stat_1')).toBe('+# to Strength');
    expect(lookup('explicit.stat_2')).toBe('+#% to Fire Resistance');
    expect(lookup('missing')).toBeUndefined();
  });
});
