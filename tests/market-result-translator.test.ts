// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  RESULT_MOD_ENGLISH_SUBTITLE_CLASS,
  createResultTranslator,
  translateResultItemName,
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

  it('魔法物品與品質普通物品（單行標題）翻出其中的基底名，前後綴保留英文', () => {
    document.body.innerHTML = `
      <div class="item-popup item-popup--magic"><div class="item-popup__header">
        <div class="item-popup__header-line">Thirsty Helix Spear of the Whale</div>
      </div></div>
      <div class="item-popup item-popup--normal"><div class="item-popup__header">
        <div class="item-popup__header-line">Superior Helix Spear</div>
      </div></div>`;
    createResultTranslator(DATA).translate(document.body);
    expect(texts('.item-popup__header-line')).toEqual([
      'Thirsty 螺旋長矛 of the Whale',
      'Superior 螺旋長矛',
    ]);
  });

  it('雙行標題的稀有名稱不做部分比對', () => {
    document.body.innerHTML = `
      <div class="item-popup__header">
        <div class="item-popup__header-line">Helix Spear Song</div>
        <div class="item-popup__header-line">Helix Spear</div>
      </div>`;
    createResultTranslator(DATA).translate(document.body);
    expect(texts('.item-popup__header-line')).toEqual(['Helix Spear Song', '螺旋長矛']);
  });

  it('異變傳奇名稱套 Foulborn 句型；佔位值不是物品名時不套', () => {
    document.body.innerHTML = `
      <div class="item-popup__header">
        <div class="item-popup__header-line">Foulborn Mageblood</div>
        <div class="item-popup__header-line">Heavy Belt</div>
      </div>
      <div class="item-popup__header">
        <div class="item-popup__header-line">Foulborn Grasp</div>
        <div class="item-popup__header-line">Heavy Belt</div>
      </div>`;
    createResultTranslator({
      ...DATA,
      items: { mageblood: '魔血', 'heavy belt': '重革腰帶' },
      templates: [['Foulborn {0}', '穢生 {0}']],
    }).translate(document.body);
    expect(texts('.item-popup__header-line')).toEqual([
      '穢生 魔血',
      '重革腰帶',
      'Foulborn Grasp',
      '重革腰帶',
    ]);
  });

  it('部分比對取最長的段落', () => {
    const items = { spear: '矛', 'helix spear': '螺旋長矛' };
    expect(translateResultItemName('Sharp Helix Spear', items, true)).toBe('Sharp 螺旋長矛');
    expect(translateResultItemName('Sharp Helix Spear', items, false)).toBeNull();
    expect(translateResultItemName('Nothing Here', items, true)).toBeNull();
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
</div><div class="itemPopupAdditional"><span data-field="dps" class="s lc">DPS<span class="colourAugmented" title="at max Quality">91.88</span></span></div>
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
    'at max Quality': '最高品質',
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

// 取自 2026-11-12 國際服：PoE1 星團珠寶附魔（選項代碼）、PoE2 賦予技能（非數字代碼）、多行詞綴
const OPTION_ROW = `
<div class="item-mod item-mod--enchant poexd-filter-mod-highlight"><span data-field="stat.enchant.stat_3948993189|17" class="s lc"><!----><span>Added Small Passive Skills grant: Minions deal 10% increased Damage</span></span></div>
<div class="item-property poexd-filter-mod-highlight"><span data-field="stat.skill.summon_skeleton_warrior" class="s lc"><img class="lci"><span>Grants Skill</span>: <span class="keyword">Level 17 Skeletal Warrior Minion</span></span></div>
<div class="item-mod"><span data-field="stat.explicit.stat_77" class="s lc"><span>17% increased Damage while area is not in Lockdown</span><br><span>Players have 17% increased Damage while area is not in Lockdown</span></span></div>`;

const OPTION_DATA: ResultTranslatorData = {
  modLines: {},
  items: {},
  labels: {},
  tradeStats: {
    en: {
      'enchant.stat_3948993189|17':
        'Added Small Passive Skills grant: Minions deal 10% increased Damage',
      'skill.summon_skeleton_warrior': 'Grants Skill: Level # Skeletal Warrior Minion',
      'explicit.stat_77':
        '#% increased Damage while area is not in Lockdown\nPlayers have #% increased Damage while area is not in Lockdown',
    },
    localized: {
      'enchant.stat_3948993189|17': '附加的小型天賦給予：增加 10% 召喚物所造成的傷害',
      'skill.summon_skeleton_warrior': '賦予技能: 等級 # 骷髏戰士召喚物',
      'explicit.stat_77': '區域未封鎖時增加 #% 傷害\n玩家在區域未封鎖時增加 #% 傷害',
    },
  },
};

describe('createResultTranslator：代碼格式與多節點詞綴', () => {
  it('選項代碼（stat_<hash>|<option>）以市集寫法翻譯', () => {
    document.body.innerHTML = OPTION_ROW;
    createResultTranslator(OPTION_DATA).translate(document.body);
    expect(document.querySelector('.item-mod--enchant')?.textContent).toBe(
      '附加的小型天賦給予：增加 10% 召喚物所造成的傷害',
    );
  });

  it('非數字代碼的賦予技能：整句比對後依分隔節點分段寫回', () => {
    document.body.innerHTML = OPTION_ROW;
    createResultTranslator(OPTION_DATA).translate(document.body);
    const field = document.querySelector('[data-field="stat.skill.summon_skeleton_warrior"]')!;
    expect(field.textContent).toBe('賦予技能: 等級 17 骷髏戰士召喚物');
    expect(field.querySelector('.keyword')?.textContent).toBe('等級 17 骷髏戰士召喚物');
  });

  it('以 <br> 分行的多行詞綴逐行寫回', () => {
    document.body.innerHTML = OPTION_ROW;
    createResultTranslator(OPTION_DATA).translate(document.body);
    expect(
      Array.from(document.querySelectorAll('[data-field="stat.explicit.stat_77"] > span')).map(
        (el) => el.textContent,
      ),
    ).toEqual(['區域未封鎖時增加 17% 傷害', '玩家在區域未封鎖時增加 17% 傷害']);
  });
});

// 取自 2026-11-12 國際服 PoE1 傭兵契約書結果列
const MERCENARY_ROW = `
<div class="item-popup__content">
  <div class="item-property" id="merc-name"><span class="lc"><span>Velessa, the Bardiyan-Born</span></span></div>
  <div class="item-property" id="merc-build"><span class="lc"><span>Build</span>: <span>Infamous Kineticist</span></span></div>
  <div class="item-property" id="merc-level"><span data-field="ilvl" class="s lc"><span>Mercenary Level</span>: <span>83</span></span></div>
  <div class="item-mod item-mod--mercenary"><div><span>Flame Wall</span></div><div id="merc-support"><span>Greater Curse Effect</span> (<span>Tier: 3</span>) </div></div>
</div>`;

describe('createResultTranslator：傭兵契約書', () => {
  it('傭兵名（名＋稱號）、建造、等級標籤、技能與輔助名、階級', () => {
    document.body.innerHTML = MERCENARY_ROW;
    createResultTranslator({
      modLines: {},
      items: {},
      labels: {
        Build: '建造',
        'Infamous Kineticist': '萬惡動能師',
        'Mercenary Level': '傭兵等級',
        'Flame Wall': '烈焰之牆',
        'Greater Curse Effect': '高階詛咒效果',
      },
      templates: [['Tier: {0}', '階級：{0}']],
      names: {
        first: { Velessa: '維勒莎' },
        suffix: { ', the Bardiyan-Born': '．巴迪亞家族子嗣' },
      },
    }).translate(document.body);
    expect(byId('merc-name').textContent).toBe('維勒莎．巴迪亞家族子嗣');
    expect(byId('merc-build').textContent).toBe('建造: 萬惡動能師');
    expect(byId('merc-level').textContent).toBe('傭兵等級: 83');
    expect(document.querySelector('.item-mod--mercenary > div')?.textContent).toBe('烈焰之牆');
    expect(byId('merc-support').textContent).toBe('高階詛咒效果 (階級：3) ');
  });

  it('官網把「Tier: 3」拆成兩個文字節點時仍整段比對', () => {
    document.body.innerHTML = MERCENARY_ROW;
    const tier = document.querySelector('#merc-support span:last-child')!;
    tier.textContent = 'Tier: ';
    tier.appendChild(document.createTextNode('3'));
    createResultTranslator({
      modLines: {},
      items: {},
      labels: {},
      templates: [['Tier: {0}', '階級：{0}']],
    }).translate(document.body);
    expect(tier.textContent).toBe('階級：3');
  });
});

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
    expect(
      document.querySelector('[data-field="dps"] .colourAugmented')?.getAttribute('title'),
    ).toBe('最高品質');
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
    expect(document.querySelector('.colourAugmented')?.getAttribute('title')).toBe('最高品質');
  });

  it('observe：官網把數值提示換回英文時再翻一次', async () => {
    document.body.innerHTML = LABEL_ROW;
    const stop = createResultTranslator(LABEL_DATA).observe(document.body);
    const value = document.querySelector('.colourAugmented')!;
    expect(value.getAttribute('title')).toBe('最高品質');
    value.setAttribute('title', 'at max Quality');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(value.getAttribute('title')).toBe('最高品質');
    stop();
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

describe('createResultTranslator：結果列詞綴中英並列副標', () => {
  it('預設不顯示英文副標；開啟後僅在已翻譯詞綴下方顯示淡色英文副標，不影響標題、屬性與未翻譯詞綴', () => {
    document.body.innerHTML = ROW;
    createResultTranslator(DATA).translate(document.body);
    expect(document.querySelectorAll(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).toHaveLength(0);

    document.body.innerHTML = ROW;
    createResultTranslator(DATA, { resultBilingual: true }).translate(document.body);

    const subtitles = texts(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`);
    expect(subtitles).toEqual([
      '30% reduced Attribute Requirements',
      'Small Passive Skills in Radius also grant 3% increased Spell Damage',
    ]);
    // 詞綴本體仍只包含中文譯文，不混入英文副標
    expect(
      document.querySelector('[data-field="stat.explicit.stat_3639275092"]')?.textContent,
    ).toBe('減少30%能力值需求');
    // 標題與屬性列不顯示副標
    expect(
      document.querySelectorAll(`.item-popup__header .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll(`.item-property .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`),
    ).toHaveLength(0);
    // 樣式已注入 document
    expect(document.getElementById('poexd-result-mod-en-style')).not.toBeNull();
  });

  it('沒有 data-field 的詞綴行（藥劑、寶石效果）也支援英文副標', () => {
    document.body.innerHTML = LABEL_ROW;
    createResultTranslator(LABEL_DATA, { resultBilingual: true }).translate(document.body);
    expect(document.querySelector('.item-mod--utility .lc')?.textContent).toBe('+40% 冰冷抗性');
    expect(
      document.querySelector(`.item-mod--utility .${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)
        ?.textContent,
    ).toBe('+40% to Cold Resistance');
  });

  it('setResultBilingual 可在已翻譯的結果列上即時切換顯示與隱藏', () => {
    document.body.innerHTML = ROW;
    const translator = createResultTranslator(DATA, { resultBilingual: false });
    const stop = translator.observe(document.body);

    expect(document.querySelectorAll(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).toHaveLength(0);

    translator.setResultBilingual(true);
    expect(texts(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).toEqual([
      '30% reduced Attribute Requirements',
      'Small Passive Skills in Radius also grant 3% increased Spell Damage',
    ]);

    translator.setResultBilingual(false);
    expect(document.querySelectorAll(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).toHaveLength(0);
    // 中文譯文保持不變
    expect(
      document.querySelector('[data-field="stat.explicit.stat_3639275092"]')?.textContent,
    ).toBe('減少30%能力值需求');
    stop();
  });

  it('官網重繪詞綴為新英文或無法翻譯的詞綴時，同步更新或移除英文副標', async () => {
    document.body.innerHTML = ROW;
    const translator = createResultTranslator(DATA, { resultBilingual: true });
    const stop = translator.observe(document.body);

    const stat = document.querySelector('[data-field="stat.explicit.stat_3639275092"]')!;
    const modLine = stat.parentElement!;
    expect(modLine.querySelector(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)?.textContent).toBe(
      '30% reduced Attribute Requirements',
    );

    // 官網改為另一個可翻譯詞綴
    stat.querySelector('span')!.textContent = '15% increased Attribute Requirements';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stat.textContent).toBe('增加15%能力值需求');
    expect(modLine.querySelector(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)?.textContent).toBe(
      '15% increased Attribute Requirements',
    );

    // 官網改為無法翻譯的詞綴時，移除舊的英文副標
    stat.querySelector('span')!.textContent = 'Completely unknown mod text';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stat.textContent).toBe('Completely unknown mod text');
    expect(modLine.querySelector(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).toBeNull();
    stop();
  });

  it('ShadowRoot 內的釘選卡片也能獨立注入副標樣式並即時切換', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = ROW;

    const translator = createResultTranslator(DATA, { resultBilingual: true });
    const stop = translator.observe(shadow);

    expect(shadow.querySelector('#poexd-result-mod-en-style')).not.toBeNull();
    expect(
      Array.from(shadow.querySelectorAll(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).map(
        (el) => el.textContent,
      ),
    ).toEqual([
      '30% reduced Attribute Requirements',
      'Small Passive Skills in Radius also grant 3% increased Spell Damage',
    ]);

    translator.setResultBilingual(false);
    expect(shadow.querySelectorAll(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)).toHaveLength(0);
    stop();
  });

  it('英文副標會插在官方 .lc.l / .lc.r 前後綴標籤之後、.poexd-result-mod-actions 之前，避免絕對定位 P/S 錯位', async () => {
    document.body.innerHTML = `
      <div class="item-mod item-mod--explicit poexd-result-mod-host">
        <span data-field="stat.explicit.stat_3639275092" class="s lc"><span>30% reduced Attribute Requirements</span></span>
        <span class="lc l su">S2<span class="d">&nbsp;[-30]</span></span>
        <span class="lc r su"><span class="d">of the Worthy</span></span>
        <span class="poexd-result-mod-actions"><button type="button" class="poexd-result-mod-btn">+和</button></span>
      </div>`;

    const translator = createResultTranslator(DATA, { resultBilingual: true });
    const stop = translator.observe(document.body);
    const modLine = document.querySelector('.item-mod')!;

    expect(Array.from(modLine.children).map((el) => el.className)).toEqual([
      's lc',
      'lc l su',
      'lc r su',
      RESULT_MOD_ENGLISH_SUBTITLE_CLASS,
      'poexd-result-mod-actions',
    ]);

    // 官網重繪後再補插新的 .lc.l / .lc.r 時，副標仍維持在它們之後
    const lateMarker = document.createElement('span');
    lateMarker.className = 'lc r su extra';
    modLine.querySelector(`.${RESULT_MOD_ENGLISH_SUBTITLE_CLASS}`)!.after(lateMarker);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(Array.from(modLine.children).map((el) => el.className)).toEqual([
      's lc',
      'lc l su',
      'lc r su',
      'lc r su extra',
      RESULT_MOD_ENGLISH_SUBTITLE_CLASS,
      'poexd-result-mod-actions',
    ]);
    stop();
  });
});

// 取自 2026-11-22 國際服 PoE1 阿茲瓦特史記與探險日誌結果列的實際結構
const CHRONICLE_ROW = `
<div class="item-popup item-popup--currency">
  <div class="item-popup__header"><div class="item-popup__header-line">Chronicle of Atzoatl</div></div>
  <div class="item-popup__content">
    <div class="item-property item-popup__property"><span class="lc"><span>Area Level</span>: <span>71</span></span></div>
    <div class="item-property item-popup__property item-popup__property--additional" id="open-hdr"><span class="lc"><span>Open Rooms:</span></span></div>
    <div class="item-property item-popup__property item-popup__property--additional" id="room-tiered"><span class="lc"><span>Jewellery Forge (Tier 2)</span></span></div>
    <div class="item-property item-popup__property item-popup__property--additional" id="room-plain"><span class="lc"><span>Cellar</span></span></div>
    <div class="item-property item-popup__property item-popup__property--additional" id="obs-hdr"><span class="lc"><span>Obstructed Rooms:</span></span></div>
    <div class="item-property item-popup__property item-popup__property--additional" id="room-obs"><span class="lc"><span>Treasury (Tier 2)</span></span></div>
    <div class="item-property item-popup__property item-popup__property--additional" id="room-apex"><span class="lc"><span>Apex of Atzoatl</span></span></div>
    <div class="item-mod item-mod--pseudo"><span data-field="stat.pseudo.pseudo_temple_storm_room_1" class="s lc"><span>Has Room: Tempest Generator (Tier 1)</span></span></div>
    <div class="item-popup__desc-text"><span class="lc">Right click this item to view the Temple of Atzoatl.\r\nCan be used in a personal Map Device to open portals to the Temple of Atzoatl in the present day.</span></div>
  </div>
</div>`;

const LOGBOOK_ROW = `
<div class="item-popup item-popup--normal">
  <div class="item-popup__header"><div class="item-popup__header-line">Expedition Logbook</div></div>
  <div class="item-popup__content">
    <div class="item-property item-popup__property"><span class="lc"><span>Area Level</span>: <span>75</span></span></div>
    <div class="item-popup__mod item-popup__mod--logbook" id="lb-1">
      <span class="lc area">Rotting Temple</span><br>
      <span class="lc faction" faction="Faction1">Druids of the Broken Circle</span>
    </div>
    <div class="item-mod item-mod--implicit"><span data-field="stat.implicit.stat_1640965354" class="s lc"><span>Area contains 24% increased number of Runic Monster Markers</span></span></div>
    <div class="item-popup__mod item-popup__mod--logbook" id="lb-2">
      <span class="lc area">Volcanic Island</span><br>
      <span class="lc faction" faction="Faction1">Druids of the Broken Circle</span>
    </div>
    <div class="item-mod item-mod--implicit"><span data-field="stat.implicit.stat_3289828378" class="s lc"><span>31% increased Explosive Radius</span></span></div>
    <div class="item-popup__desc-text"><span class="lc">Take this item to Dannig in your Hideout to open portals to an expedition.</span></div>
  </div>
</div>`;

describe('createResultTranslator：阿茲瓦特史記與探險日誌', () => {
  it('阿茲瓦特史記：標題、房間（含階級模板巢狀譯名）、偽屬性房間與多行物品說明', () => {
    document.body.innerHTML = CHRONICLE_ROW;
    createResultTranslator({
      modLines: {},
      tradeStats: {
        en: {
          'pseudo.pseudo_temple_storm_room_1': 'Has Room: Tempest Generator (Tier 1)',
          'explicit.stat_210067635': '#% increased Attack Speed (Local)',
        },
        localized: {
          'pseudo.pseudo_temple_storm_room_1': '有房間：暴雷發電室（階級 1）',
          'explicit.stat_210067635': '增加 #% 攻擊速度 (部分)',
        },
      },
      items: { 'chronicle of atzoatl': '阿茲瓦特史記' },
      labels: {
        'Area Level': '區域等級',
        'Open Rooms:': '開啟房間：',
        'Obstructed Rooms:': '受阻的房間：',
        'Jewellery Forge': '珠寶冶煉室',
        Cellar: '神殿地窖',
        Treasury: '祕寶庫',
        'Apex of Atzoatl': '阿茲瓦特之巔',
        'Right click this item to view the Temple of Atzoatl. Can be used in a personal Map Device to open portals to the Temple of Atzoatl in the present day.':
          '右鍵點擊此物品來檢視阿茲瓦特神廟。\n可以使用於個人地圖裝置以開啟前往現今阿茲瓦特神廟的傳送門。',
      },
      templates: [['{0} (Tier {1})', '{0}（階級 {1}）']],
    }).translate(document.body);

    expect(texts('.item-popup__header-line')).toEqual(['阿茲瓦特史記']);
    expect(byId('open-hdr').textContent).toBe('開啟房間：');
    expect(byId('room-tiered').textContent).toBe('珠寶冶煉室（階級 2）');
    expect(byId('room-plain').textContent).toBe('神殿地窖');
    expect(byId('obs-hdr').textContent).toBe('受阻的房間：');
    expect(byId('room-obs').textContent).toBe('祕寶庫（階級 2）');
    expect(byId('room-apex').textContent).toBe('阿茲瓦特之巔');
    expect(
      document.querySelector('[data-field="stat.pseudo.pseudo_temple_storm_room_1"]')?.textContent,
    ).toBe('有房間：暴雷發電室（階級 1）');
    expect(document.querySelector('.item-popup__desc-text')?.textContent).toBe(
      '右鍵點擊此物品來檢視阿茲瓦特神廟。\n可以使用於個人地圖裝置以開啟前往現今阿茲瓦特神廟的傳送門。',
    );
  });

  it('探險日誌：標題、地區與派系（.item-popup__mod--logbook）、固定詞綴與物品說明', () => {
    document.body.innerHTML = LOGBOOK_ROW;
    createResultTranslator({
      modLines: {
        '1640965354': [
          [
            'Area contains {0:d}% increased number of Runic Monster Markers',
            '區域增加 {0:d}% 魔符怪物標記的數量',
          ],
        ],
        '3289828378': [['{0:d}% increased Explosive Radius', '增加 {0:d}% 爆炸範圍']],
      },
      items: { 'expedition logbook': '探險日誌' },
      labels: {
        'Area Level': '區域等級',
        'Rotting Temple': '腐朽神殿',
        'Volcanic Island': '火山島',
        'Druids of the Broken Circle': '破碎環之德魯伊',
        'Take this item to Dannig in your Hideout to open portals to an expedition.':
          '把此道具帶回你的藏身處給丹尼格，來開啟前往探險的傳送門。',
      },
    }).translate(document.body);

    expect(texts('.item-popup__header-line')).toEqual(['探險日誌']);
    expect(byId('lb-1').querySelector('.area')?.textContent).toBe('腐朽神殿');
    expect(byId('lb-1').querySelector('.faction')?.textContent).toBe('破碎環之德魯伊');
    expect(byId('lb-2').querySelector('.area')?.textContent).toBe('火山島');
    expect(byId('lb-2').querySelector('.faction')?.textContent).toBe('破碎環之德魯伊');
    expect(texts('[data-field^="stat."] > span')).toEqual([
      '區域增加 24% 魔符怪物標記的數量',
      '增加 31% 爆炸範圍',
    ]);
    expect(document.querySelector('.item-popup__desc-text')?.textContent).toBe(
      '把此道具帶回你的藏身處給丹尼格，來開啟前往探險的傳送門。',
    );
  });
});
