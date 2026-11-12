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
    localized: {
      'explicit.stat_1137305356': '範圍內的小型天賦也會給予增加 #% 法術傷害',
    },
  },
  items: { 'helix spear': '螺旋長矛' },
  labels: {
    'Item Level': '物品等級',
    Requires: '需求',
    Level: '等級',
    Str: '力量',
  },
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

// 取自 2026-11-12 國際服結果列（藥劑、寶石、價格與賣家區塊）的實際結構
const LABEL_ROW = `
<div class="row"><div class="middle"><div class="item-popup"><div class="item-popup__content">
  <div class="item-property" id="consumes"><span class="lc"><span>Consumes <span>20</span> of <span>50</span> Charges on use</span></span></div>
  <div class="item-property" id="has"><span class="lc"><span>Currently has <span>0</span> Charges</span></span></div>
  <div class="item-property" id="cast"><span class="lc"><span>Cast Time</span>: <span>0.80 sec</span></span></div>
  <div class="item-property" id="cost"><span class="lc"><span>Cost</span>: <span>5 Mana</span></span></div>
  <div class="item-property" id="tags"><span class="lc"><span>Spell, AoE</span></span></div>
  <div class="item-popup__sec-desc-text"><span class="lc">Launches a series of fireballs.</span></div>
  <div class="item-mod item-mod--utility"><span class="lc"><span>+40% to Cold Resistance</span></span><span class="lc l"><span class="d">[40]</span></span></div>
  <div><span class="lc">Corrupted</span></div>
</div><div class="itemPopupAdditional"><span data-field="dps" class="s lc">DPS<span class="colourAugmented">91.88</span></span></div>
</div></div>
<div class="right"><div class="details">
  <div class="price"><span data-field="price"><span class="price-label fixed-price">Exact Price:</span>&nbsp;<span>1</span></span>
    <span data-field="fee"><span class="price-label">Fee:</span>&nbsp;<span>525</span></span></div>
  <div data-field="indexed" class="s info"><span class="profile-link"><a>Someone#1234</a></span>&nbsp;<small id="t1">listed 4 years ago</small></div>
  <div data-field="indexed" class="s info"><small id="t2">listed yesterday</small></div>
  <div class="btns"><span class="status status-offline">Offline</span><span><button class="btn ignore-btn">Ignore Player</button></span></div>
</div></div></div>`;

const LABEL_DATA: ResultTranslatorData = {
  modLines: { '5': [['{0:+d}% to Cold Resistance', '{0:+d}% 冰冷抗性']] },
  items: {},
  labels: {
    'Cast Time': '施放時間',
    Cost: '消耗',
    Mana: '魔力',
    Spell: '法術',
    AoE: '範圍效果',
    'Launches a series of fireballs.': '發射一連串火球。',
    Corrupted: '已汙染',
    DPS: '每秒傷害',
    'Exact Price:': '不二價:',
    Fee: '費用',
    Offline: '不在線上',
    'Ignore Player': '黑名單流亡者',
  },
  templates: [
    ['Consumes {0} of {1} Charges on use', '每次使用會從 {1} 充能次數中消耗 {0} 次'],
    ['Currently has {0} Charges', '目前有 {0} 充能次數'],
    ['{0} sec', '{0} 秒'],
  ],
  locale: 'zh-TW',
};

const byId = (id: string) => document.getElementById(id)!;

describe('createResultTranslator：結果列標籤', () => {
  it('整行模板：佔位順序相同時只換文字段、保留數值節點；順序不同時整行寫入', () => {
    document.body.innerHTML = LABEL_ROW;
    createResultTranslator(LABEL_DATA).translate(document.body);
    expect(byId('has').textContent).toBe('目前有 0 充能次數');
    expect(byId('has').querySelector('.lc > span > span')?.textContent).toBe('0');
    expect(byId('consumes').textContent).toBe('每次使用會從 50 充能次數中消耗 20 次');
  });

  it('逐節點：標籤、單節點模板、數值加標籤、逗號清單', () => {
    document.body.innerHTML = LABEL_ROW;
    createResultTranslator(LABEL_DATA).translate(document.body);
    expect(byId('cast').textContent).toBe('施放時間: 0.80 秒');
    expect(byId('cost').textContent).toBe('消耗: 5 魔力');
    expect(byId('tags').textContent).toBe('法術, 範圍效果');
  });

  it('寶石說明、旗標、DPS、價格與手續費標籤（含冒號的鍵）、狀態與按鈕', () => {
    document.body.innerHTML = LABEL_ROW;
    createResultTranslator(LABEL_DATA).translate(document.body);
    expect(document.querySelector('.item-popup__sec-desc-text')?.textContent).toBe(
      '發射一連串火球。',
    );
    expect(document.querySelector('.item-popup__content > div:not([class])')?.textContent).toBe(
      '已汙染',
    );
    expect(document.querySelector('[data-field="dps"]')?.textContent).toBe('每秒傷害91.88');
    expect(texts('.price-label')).toEqual(['不二價:', '費用:']);
    expect(document.querySelector('.status')?.textContent).toBe('不在線上');
    expect(document.querySelector('.ignore-btn')?.textContent).toBe('黑名單流亡者');
  });

  it('沒有 stat 代碼的詞綴行以英文句型比對遊戲寫法，階級欄位不動', () => {
    document.body.innerHTML = LABEL_ROW;
    createResultTranslator(LABEL_DATA).translate(document.body);
    expect(document.querySelector('.item-mod--utility .lc')?.textContent).toBe('+40% 冰冷抗性');
    expect(document.querySelector('.item-mod--utility .l')?.textContent).toBe('[40]');
  });

  it('刊登時間以目標語系的相對時間顯示', () => {
    document.body.innerHTML = LABEL_ROW;
    createResultTranslator(LABEL_DATA).translate(document.body);
    const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });
    expect(byId('t1').textContent).toBe(rtf.format(-4, 'year'));
    expect(byId('t2').textContent).toBe(rtf.format(-1, 'day'));
  });

  it('文字很短的模板只接受數值（避免 {0}s 吃掉英文單字）；整行模板的數值節點也查標籤；物品名備援', () => {
    document.body.innerHTML = `<div class="item-popup__content">
      <div class="item-property" id="boots"><span class="lc"><span>Boots</span></span></div>
      <div class="item-property" id="time"><span class="lc"><span>Cast Time</span>: <span>0.80s</span></span></div>
      <div class="item-property" id="costline"><span class="lc"><span>Cost</span>: <span>5 Mana</span></span></div>
      <div class="item-property" id="supports"><span class="lc"><span>Spell Echo, Rapid Casting</span></span></div>
    </div>`;
    createResultTranslator({
      ...LABEL_DATA,
      items: { 'spell echo': '法術回響', 'rapid casting': '快速施放' },
      templates: [
        ['{0}s', '{0} 秒'],
        ['Cost: {0}', '消耗：{0}'],
      ],
    }).translate(document.body);
    expect(byId('boots').textContent).toBe('Boots');
    expect(byId('time').textContent).toBe('施放時間: 0.80 秒');
    expect(byId('costline').textContent).toBe('消耗：5 魔力');
    expect(byId('supports').textContent).toBe('法術回響, 快速施放');
  });

  it('外層容器帶有本擴充的 class 時照常翻譯（略過判斷只看目標元素內部）', () => {
    document.body.innerHTML = `<div class="poexd-host">${LABEL_ROW}</div>`;
    createResultTranslator(LABEL_DATA).translate(document.body);
    expect(byId('cast').textContent).toBe('施放時間: 0.80 秒');
    expect(byId('has').textContent).toBe('目前有 0 充能次數');
  });

  it('重繪換回英文時整行模板重新套用', () => {
    document.body.innerHTML = LABEL_ROW;
    const translator = createResultTranslator(LABEL_DATA);
    translator.translate(document.body);
    byId('has').innerHTML =
      '<span class="lc"><span>Currently has <span>3</span> Charges</span></span>';
    translator.translate(document.body);
    expect(byId('has').textContent).toBe('目前有 3 充能次數');
  });
});
