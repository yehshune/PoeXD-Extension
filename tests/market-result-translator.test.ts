// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  createResultTranslator,
  type ResultTranslatorData,
} from '@/utils/market-result-translator';

// 取自 2026-11-12 國際服 PoE2 結果列的實際結構
const ROW = `
<div class="row"><div class="middle"><div class="item-popup item-popup--rare">
  <div class="item-popup__header">
    <div class="item-popup__header-line">Rift Edge</div>
    <div class="item-popup__header-line">Helix Spear</div>
  </div>
  <div class="item-popup__content">
    <div class="item-property"><span data-field="ilvl" class="s lc"><span>Item Level</span>: <span>71</span></span></div>
    <div class="item-property"><span class="lc">Requires: <span data-field="lvl" class="s"><span>Level</span> <span>65</span></span>, <span data-field="str" class="s"><span>25</span> <span>Str</span></span></span></div>
    <div class="item-mod item-mod--explicit"><span data-field="stat.explicit.stat_3639275092" class="s lc"><!----><span>30% reduced Attribute Requirements</span></span><span class="lc l su">S2<span class="d">&nbsp;[-30]</span></span></div>
    <div class="item-mod item-mod--explicit"><span data-field="stat.explicit.stat_1137305356" class="s lc"><span>Small Passive Skills in Radius also grant 3% increased Spell Damage</span></span></div>
    <div class="item-mod item-mod--explicit"><span data-field="stat.explicit.stat_404" class="s lc"><span>Some unknown stat</span></span></div>
  </div>
</div></div></div>`;

const DATA: ResultTranslatorData = {
  modLines: {
    '3639275092': [
      ['{0:d}% increased Attribute Requirements', '增加{0:d}%能力值需求'],
      ['{0:n}% reduced Attribute Requirements', '減少{0:n}%能力值需求'],
    ],
  },
  tradeStats: {
    en: {
      'explicit.stat_1137305356':
        'Small Passive Skills in Radius also grant #% increased Spell Damage',
    },
    localized: { 'explicit.stat_1137305356': '範圍內的小型天賦也會給予增加 #% 法術傷害' },
  },
  items: { 'helix spear': '螺旋長矛' },
  labels: { 'Item Level': '物品等級', Requires: '需求', Level: '等級', Str: '力量' },
};

const texts = (selector: string) =>
  Array.from(document.querySelectorAll(selector)).map((el) => el.textContent?.trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createResultTranslator', () => {
  it('詞綴行用遊戲寫法、描述檔查不到時用市集寫法、都查不到保留英文', () => {
    document.body.innerHTML = ROW;
    createResultTranslator(DATA).translate(document.body);
    expect(texts('[data-field^="stat."] > span')).toEqual([
      '減少30%能力值需求',
      '範圍內的小型天賦也會給予增加 3% 法術傷害',
      'Some unknown stat',
    ]);
    // 階級欄位等其他節點不動
    expect(texts('.item-mod .l')[0]).toContain('S2');
  });

  it('物品名與屬性標籤；查不到的隨機稀有名稱保留英文', () => {
    document.body.innerHTML = ROW;
    createResultTranslator(DATA).translate(document.body);
    expect(texts('.item-popup__header-line')).toEqual(['Rift Edge', '螺旋長矛']);
    expect(document.querySelector('[data-field="ilvl"]')?.textContent).toBe('物品等級: 71');
    expect(document.querySelector('.item-property:nth-child(2) .lc')?.textContent).toBe(
      '需求: 等級 65, 25 力量',
    );
  });

  it('重複執行不會重翻；官網重繪換回英文時重新翻譯', () => {
    document.body.innerHTML = ROW;
    const translator = createResultTranslator(DATA);
    translator.translate(document.body);
    translator.translate(document.body);
    const span = document.querySelector('[data-field="stat.explicit.stat_3639275092"] > span')!;
    expect(span.textContent).toBe('減少30%能力值需求');

    span.firstChild!.nodeValue = '15% reduced Attribute Requirements';
    translator.translate(document.body);
    expect(span.textContent).toBe('減少15%能力值需求');
  });

  it('observe：新加入的結果列與文字變更都會翻譯，停止後不再處理', async () => {
    const translator = createResultTranslator(DATA);
    const stop = translator.observe(document.body);
    document.body.innerHTML = ROW;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(texts('.item-popup__header-line')[1]).toBe('螺旋長矛');

    const span = document.querySelector('[data-field="stat.explicit.stat_3639275092"] > span')!;
    span.firstChild!.nodeValue = '12% increased Attribute Requirements';
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(span.textContent).toBe('增加12%能力值需求');

    stop();
    span.firstChild!.nodeValue = '9% increased Attribute Requirements';
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(span.textContent).toBe('9% increased Attribute Requirements');
  });
});
