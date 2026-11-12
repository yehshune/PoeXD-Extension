import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hostSource = readFileSync('components/injected/mercenary/MercenaryPickerHost.vue', 'utf8');
const panelSource = readFileSync('components/injected/mercenary/MercenarySupportPanel.vue', 'utf8');
const comboboxSource = readFileSync(
  'components/injected/mercenary/MercenaryBuildCombobox.vue',
  'utf8',
);

describe('傭兵技能選擇器版面比照詞綴選擇器', () => {
  it('使用 inset 尺寸與固定標題列', () => {
    const content = hostSource.match(/<DialogContent[\s\S]*?>/)?.[0] ?? '';
    expect(content).toContain('placement="inset"');
    expect(content).toContain('inset-x-[5vw] inset-y-[5vh]');
    expect(content).toContain('p-0');

    const header = hostSource.match(/<DialogHeader[\s\S]*?>/)?.[0] ?? '';
    expect(header).toContain('h-[var(--pxd-sidebar-affix-dialog-header-height)]');
    expect(header).toContain('border-b border-border');
    expect(hostSource).toMatch(
      /<DialogTitle class="text-\[length:var\(--pxd-font-body\)\] font-bold tracking-\[0\.5px\]">/,
    );
  });

  it('內容區雙欄各自捲動，不再用 vh 寫死高度', () => {
    expect(hostSource).toContain('data-test="mercenary-body"');
    expect(hostSource).toContain('data-test="mercenary-footer"');
    expect(hostSource).not.toMatch(/max-h-\[\d+vh\]/);
    expect(panelSource).not.toMatch(/max-h-\[\d+vh\]/);
  });

  it('技能與輔助列使用本文字級', () => {
    expect(hostSource).toContain('text-[length:var(--pxd-font-body)] leading-[1.25]');
    expect(panelSource).toContain('text-[length:var(--pxd-font-body)] leading-[1.25]');
  });

  it('不寫死像素尺寸', () => {
    for (const source of [hostSource, panelSource, comboboxSource]) {
      const template = source.slice(source.indexOf('<template>'));
      expect(template).not.toMatch(/(?:^|[\s"'])(?:w|h|min-w|max-w|size)-\[\d+px\]/m);
    }
    expect(comboboxSource).toContain('w-[var(--pxd-mercenary-build-width)]');
  });
});
