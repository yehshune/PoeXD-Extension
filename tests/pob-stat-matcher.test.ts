// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPobSlot } from '@/components/sidebar/pob-build/pob-slot-label';
import { resetI18nStateForTests } from '@/utils/i18n';
import { parsePobBuildXml } from '@/utils/pob-build';
import {
  aliasPairs,
  createModLineTranslator,
  loadModLineTranslator,
} from '@/utils/pob-mod-translator';
import { buildShoppingList, createTradeNameCatalog } from '@/utils/pob-shopping-list';
import { createStatMatcher, loadStatMatcher } from '@/utils/pob-stat-matcher';

// 取自 PoE1 3.30.0.2 的 mod-lines.json 與國際服 trade-stats.json
const matcher = createStatMatcher({
  modLines: {
    '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']],
    '3484657501': [['{0:+d} to Armour', '{0:+d} 點護甲']],
    '809229260': [['{0:+d} to Armour', '{0:+d} 點護甲']],
    '2866361420': [
      ['{0:d}% increased Armour', '增加 {0:d}% 護甲'],
      ['{0:n}% reduced Armour', '減少 {0:n}% 護甲'],
    ],
    '1037193709': [['Adds {0:d} to {1:d} Cold Damage', '附加 {0:d} 至 {1:d} 冰冷傷害']],
    '3079007202': [
      [
        'Trigger a Socketed Spell when you Use a Skill, with a 8 second Cooldown\\nSpells Triggered this way have 150% more Cost',
        '…',
      ],
    ],
    '1': [['Socketed Gems are Supported by Level {0:d} Burning Damage', '…']],
    '2': [['Cannot be Frozen', '無法被冰凍']],
    '3': [['Regenerate {0:d} Life per second for 4 seconds', '…']],
  },
  tradeStats: {
    'explicit.stat_3299347043': '+# to maximum Life',
    'explicit.stat_3484657501': '+# to Armour (Local)',
    'explicit.stat_809229260': '+# to Armour',
    'explicit.stat_2866361420': '#% increased Armour',
    'explicit.stat_1037193709': 'Adds # to # Cold Damage',
    'explicit.stat_3079007202': 'Trigger a Socketed Spell…',
    'explicit.stat_2': 'Cannot be Frozen',
    'explicit.stat_3': 'Regenerate # Life per second for 4 seconds',
    // stat_1 沒有對應的市集代碼
  },
});

describe('createStatMatcher', () => {
  it('以句型比對出代碼與數值，忽略大小寫與多餘空白', () => {
    expect(matcher.match('+100 to maximum Life', { preferLocal: false })).toEqual({
      statId: 'explicit.stat_3299347043',
      value: 100,
    });
    expect(matcher.match('  +7  to MAXIMUM life ', { preferLocal: false })?.value).toBe(7);
  });

  it('同一句話有裝備本身與全域兩種代碼時，依部位偏好選擇', () => {
    expect(matcher.match('+35 to Armour', { preferLocal: true })?.statId).toBe(
      'explicit.stat_3484657501',
    );
    expect(matcher.match('+35 to Armour', { preferLocal: false })?.statId).toBe(
      'explicit.stat_809229260',
    );
    // 只有一種代碼時不受偏好影響
    expect(matcher.match('+100 to maximum Life', { preferLocal: true })?.statId).toBe(
      'explicit.stat_3299347043',
    );
  });

  it('「減少」的句型數值為負；兩個數值取平均；句型裡寫死的數字不算數值', () => {
    expect(matcher.match('12% reduced Armour', { preferLocal: false })).toEqual({
      statId: 'explicit.stat_2866361420',
      value: -12,
    });
    expect(matcher.match('Adds 65 to 119 Cold Damage', { preferLocal: false })?.value).toBe(92);
    expect(
      matcher.match('Regenerate 30 Life per second for 4 seconds', { preferLocal: false }),
    ).toEqual({ statId: 'explicit.stat_3', value: 30 });
  });

  it('沒有數值的詞綴只回傳代碼', () => {
    expect(matcher.match('Cannot be Frozen', { preferLocal: false })).toEqual({
      statId: 'explicit.stat_2',
    });
  });

  it('對不到句型、沒有市集代碼、多行詞綴都回傳 undefined', () => {
    expect(matcher.match('Some unknown modifier 5', { preferLocal: false })).toBeUndefined();
    expect(
      matcher.match('Socketed Gems are Supported by Level 16 Burning Damage', {
        preferLocal: false,
      }),
    ).toBeUndefined();
    expect(
      matcher.match('Trigger a Socketed Spell when you Use a Skill, with a 8 second Cooldown', {
        preferLocal: false,
      }),
    ).toBeUndefined();
  });
});

describe('loadStatMatcher：隨擴充發佈的資料分片', () => {
  const loadJson = async (path: string) =>
    JSON.parse(await readFile(resolve(__dirname, '../public', path), 'utf8')) as unknown;

  it('PoE 1：常見詞綴對得到代碼，護甲依部位分辨', async () => {
    const real = await loadStatMatcher(loadJson, 'poe1');
    expect(real.match('+100 to maximum Life', { preferLocal: true })).toEqual({
      statId: 'explicit.stat_3299347043',
      value: 100,
    });
    expect(real.match('+38% to Fire Resistance', { preferLocal: false })?.statId).toBe(
      'explicit.stat_3372524247',
    );
    expect(real.match('+35 to Armour', { preferLocal: true })?.statId).toBe(
      'explicit.stat_3484657501',
    );
  });

  it('PoE 2 可載入', async () => {
    const real = await loadStatMatcher(loadJson, 'poe2');
    expect(real.match('+117 to maximum Life', { preferLocal: false })?.value).toBe(117);
  });
});

describe('PoB 物品詞綴解析', () => {
  const xml = `<PathOfBuilding>
	<Build className="Marauder" level="90"/>
	<Items activeItemSet="1">
		<Item id="1">
			Rarity: RARE
Behemoth Claw
Leviathan Gauntlets
Armour: 538
Unique ID: cd03
Searing Exarch Item
Item Level: 85
Quality: 20
Sockets: R-R-W-W
LevelReq: 84
Implicits: 2
3% increased Damage per 100 Strength
{crafted}+7% to Fire Damage over Time Multiplier
+35 to Armour
+100 to maximum Life
{crafted}12% increased Area of Effect
Fractured Item
Corrupted
			<ModRange id="1" range="0.5"/>
		</Item>
		<Item id="2">
			Rarity: UNIQUE
Test Unique
Leather Belt
Selected Variant: 2
Implicits: 1
{range:0.5}+(25-40) to maximum Life
{variant:1}{range:1}+(60-80) to maximum Life
{variant:2}{range:1}+(70-90) to maximum Life
{variant:2,3}{range:0}Regenerate (5.5-7.5) Life per second
		</Item>
		<ItemSet id="1">
			<Slot itemId="1" name="Gloves"/>
			<Slot itemId="2" name="Belt"/>
		</ItemSet>
	</Items>
</PathOfBuilding>`;
  const [gloves, belt] = parsePobBuildXml(xml).itemSets[0].items;

  it('依 Implicits 行分出固定與一般詞綴，去掉標記並略過屬性行與狀態行', () => {
    expect(gloves.implicitMods).toEqual([
      // 屬性區標了 Searing Exarch Item：非附魔的固定詞綴是 Eldritch 固定詞綴
      { text: '3% increased Damage per 100 Strength', crafted: false, eldritch: true },
      { text: '+7% to Fire Damage over Time Multiplier', crafted: true },
    ]);
    expect(gloves.explicitMods).toEqual([
      { text: '+35 to Armour', crafted: false },
      { text: '+100 to maximum Life', crafted: false },
      { text: '12% increased Area of Effect', crafted: true },
    ]);
  });

  it('可變數值依 range 算出實際值；只留目前選用變體的詞綴', () => {
    expect(belt.implicitMods).toEqual([{ text: '+33 to maximum Life', crafted: false }]);
    expect(belt.explicitMods.map((mod) => mod.text)).toEqual([
      '+90 to maximum Life',
      'Regenerate 5.5 Life per second',
    ]);
  });

  it('稀有裝備的搜尋：手套的護甲對到裝備本身的代碼，數值下限八成，工藝詞綴不列入', () => {
    const [entry] = buildShoppingList(
      parsePobBuildXml(xml),
      createTradeNameCatalog({ englishItems: ['Leviathan Gauntlets', 'Leather Belt'] }),
      {},
      matcher,
    ).filter((item) => item.kind === 'equipment');

    expect(entry.query).toEqual({
      status: { option: 'securable' },
      type: 'Leviathan Gauntlets',
      filters: { type_filters: { filters: { rarity: { option: 'nonunique' } } } },
      stats: [
        {
          type: 'and',
          filters: [
            { id: 'explicit.stat_3484657501', value: { min: 28 } },
            { id: 'explicit.stat_3299347043', value: { min: 80 } },
          ],
        },
      ],
    });
    expect(entry.mods?.map((mod) => [mod.kind, mod.searched])).toEqual([
      ['implicit', false],
      // PoB 把附魔寫成標了 crafted 的固定詞綴
      ['enchant', false],
      ['explicit', true],
      ['explicit', true],
      ['crafted', false],
    ]);
  });

  it('傳奇只列出詞綴，不帶入搜尋條件', () => {
    const unique = buildShoppingList(
      parsePobBuildXml(xml),
      createTradeNameCatalog({ englishItems: ['Test Unique', 'Leather Belt'] }),
      {},
      matcher,
    ).find((item) => item.kind === 'unique');
    expect(unique?.query).toEqual({
      status: { option: 'securable' },
      name: 'Test Unique',
      type: 'Leather Belt',
    });
    expect(unique?.mods?.every((mod) => !mod.searched)).toBe(true);
  });
});

describe('createModLineTranslator', () => {
  const translator = createModLineTranslator({
    '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']],
    '2866361420': [
      ['{0:d}% increased Armour', '增加 {0:d}% 護甲'],
      ['{0:n}% reduced Armour', '減少 {0:n}% 護甲'],
    ],
    '1037193709': [['Adds {0:d} to {1:d} Cold Damage', '附加 {0:d} 至 {1:d} 冰冷傷害']],
    '2': [['Cannot be Frozen', '無法被冰凍']],
    '3': [['Regenerate {0:d} Life per second for 4 seconds', '4 秒內每秒回復 {0:d} 生命']],
    '4': [['Line one\nLine two', '第一行\n第二行']],
  });

  it('依句型翻譯並填入數值，選對增加／減少的變體', () => {
    expect(translator.translate('+100 to maximum Life')).toBe('+100 最大生命');
    expect(translator.translate('12% reduced Armour')).toBe('減少 12% 護甲');
    expect(translator.translate('30% increased Armour')).toBe('增加 30% 護甲');
    expect(translator.translate('Adds 65 to 119 Cold Damage')).toBe('附加 65 至 119 冰冷傷害');
    expect(translator.translate('Cannot be Frozen')).toBe('無法被冰凍');
  });

  it('句型裡寫死的數字不同時不會誤翻', () => {
    expect(translator.translate('Regenerate 30 Life per second for 4 seconds')).toBe(
      '4 秒內每秒回復 30 生命',
    );
    expect(translator.translate('Regenerate 30 Life per second for 9 seconds')).toBeUndefined();
  });

  it('對不到句型回傳 undefined', () => {
    expect(translator.translate('Some unknown modifier 5')).toBeUndefined();
  });

  it('多行句型被 PoB 拆開時，每一行各自翻譯', () => {
    expect(translator.translate('Line one')).toBe('第一行');
    expect(translator.translate('Line two')).toBe('第二行');
    const escaped = createModLineTranslator({
      '5': [
        [
          'Grants Immunity to Bleeding for {0:d} seconds if used while Bleeding\\nGrants Immunity to Corrupted Blood for {0:d} seconds',
          '若使用時流血，獲得免疫流血 {0:d} 秒\\n獲得免疫腐化之血 {0:d} 秒',
        ],
      ],
      '6': [['Only one\\nline here\\nthree', '只有\\n兩行']],
    });
    expect(
      escaped.translate('Grants Immunity to Bleeding for 8 seconds if used while Bleeding'),
    ).toBe('若使用時流血，獲得免疫流血 8 秒');
    expect(escaped.translate('Grants Immunity to Corrupted Blood for 8 seconds')).toBe(
      '獲得免疫腐化之血 8 秒',
    );
    // 行數不同時無法對應，不拆
    expect(escaped.translate('Only one')).toBeUndefined();
  });
});

describe('createModLineTranslator：完整 stat 文字目錄與舊英文寫法', () => {
  const translator = createModLineTranslator(
    { '3299347043': [['{0:+d} to maximum Life', '{0:+d} 最大生命']] },
    {
      statText: {
        '3299347043': [['{0:+d} to maximum Life', '目錄裡的另一種譯文 {0:+d}']],
        '3917489142': [['{0:+d}% to Item Rarity', '{0:+d}%物品稀有度']],
        '1': [['Unique only {0:d}', '只有傳奇 {0:d}']],
      },
      aliases: {
        '3917489142': [
          ['{0:d}% increased Rarity of Items found', '{0:+d}% to Item Rarity'],
          ['{0:n}% reduced Rarity of Items found', '{0:+d}% to Item Rarity'],
        ],
        // 現行英文在該語系沒有譯文，或別名本身就是現行寫法時不採用
        '2': [['Old wording {0:d}', 'Missing {0:d}']],
        '3299347043': [['{0:+d} to maximum Life', '{0:+d} to maximum Life']],
      },
    },
  );

  it('市集上沒有的 stat 也能從完整目錄翻譯；同一句英文以 mod-lines 為準', () => {
    expect(translator.translate('Unique only 7')).toBe('只有傳奇 7');
    expect(translator.translate('+50 to maximum Life')).toBe('+50 最大生命');
    expect(translator.translate('+22% to Item Rarity')).toBe('+22%物品稀有度');
  });

  it('舊英文寫法對到現行寫法的譯文，增加／減少換成正負號', () => {
    expect(translator.translate('22% increased Rarity of Items found')).toBe('+22%物品稀有度');
    expect(translator.translate('10% reduced Rarity of Items found')).toBe('-10%物品稀有度');
    expect(translator.translate('Old wording 5')).toBeUndefined();
  });

  it('aliasPairs 只輸出找得到譯文的別名', () => {
    expect(
      aliasPairs(
        {
          h: [
            ['Old {0:d}', 'New {0:d}'],
            ['Gone {0:d}', 'Nope {0:d}'],
          ],
        },
        [{ h: [['New {0:d}', '新 {0:d}']] }],
      ),
    ).toEqual([['Old {0:d}', '新 {0:d}']]);
  });
});

describe('createModLineTranslator：市集文字補充句型', () => {
  const translator = createModLineTranslator(
    { '1': [['{0:+d} to maximum Life', '{0:+d} 最大生命']] },
    {
      tradeStats: {
        english: {
          'explicit.stat_3299347043': '+# to maximum Life',
          'enchant.stat_2954116742|4833': 'Allocates Vigour',
          'enchant.stat_3948993189|2':
            'Added Small Passive Skills grant: Staff Attacks deal 12% increased Damage\nAdded Small Passive Skills grant: Mace Attacks deal 12% increased Damage',
          'explicit.stat_1': '#% increased Armour (Local)',
          'explicit.stat_2': 'Adds # to # Fire Damage',
          'explicit.stat_3': ['# to Alpha', '# to Beta'],
          'explicit.stat_4': ['# to Gamma', '# to Delta'],
          'pseudo.pseudo_total_life': '+# total maximum Life',
        },
        localized: {
          'explicit.stat_3299347043': '+# 市集寫法生命',
          'enchant.stat_2954116742|4833': '配置 活力之源',
          'enchant.stat_3948993189|2':
            '附加的小型天賦給予：長杖攻擊增加 12% 傷害\n附加的小型天賦給予：錘攻擊增加 12% 傷害',
          'explicit.stat_1': '增加 #% 護甲 (部分)',
          'explicit.stat_2': '附加 # 至 # 火焰傷害',
          'explicit.stat_3': ['# 阿爾法', '# 貝塔'],
          'explicit.stat_4': ['# 伽瑪'],
          'pseudo.pseudo_total_life': '+# 總生命',
        },
      },
    },
  );

  it('翻出選項型詞綴（塗油、星團附魔的每一行）', () => {
    expect(translator.translate('Allocates Vigour')).toBe('配置 活力之源');
    expect(
      translator.translate(
        'Added Small Passive Skills grant: Staff Attacks deal 12% increased Damage',
      ),
    ).toBe('附加的小型天賦給予：長杖攻擊增加 12% 傷害');
    expect(translator.translate('15% increased Armour')).toBe('增加 15% 護甲');
    expect(translator.translate('5 to Beta')).toBe('5 貝塔');
  });

  it('mod-lines 優先；多個佔位符、寫法數量不同、pseudo 都不採用', () => {
    expect(translator.translate('+50 to maximum Life')).toBe('+50 最大生命');
    expect(translator.translate('Adds 5 to 10 Fire Damage')).toBeUndefined();
    expect(translator.translate('5 to Gamma')).toBeUndefined();
    expect(translator.translate('+50 total maximum Life')).toBeUndefined();
  });
});

describe('createModLineTranslator：寶石名稱與前綴', () => {
  const names: Record<string, string> = {
    'Pierce Support': '穿透輔助',
    'Shockwave Support': '震波輔助',
    'Burning Damage Support': '燃燒傷害輔助',
    Hatred: '憎恨',
    'Purity of Ice': '冰霜淨化',
    Wrath: '憤怒',
  };
  const translator = createModLineTranslator(
    {
      '1': [
        ['Socketed Gems are Supported by Level {0:d} Pierce', '插槽中寶石被等級 {0:d} 的穿透輔助'],
      ],
      '2': [
        [
          'Socketed Gems are Supported by Level {0:d} Shockwave',
          '插槽中寶石被等級 {0:d} 的震波輔助',
        ],
      ],
      '3': [['Grants Level {0:d} Hatred Skill', '獲得等級 {0:d} 的憎恨技能']],
      '4': [['Grants Level {0:d} Purity of Ice Skill', '獲得等級 {0:d} 的冰霜淨化技能']],
      '5': [['{0:+d} to maximum Life', '{0:+d} 最大生命']],
      '6': [['{0:d}% increased Fire Damage', '增加 {0:d}% 火焰傷害']],
      '7': [
        [
          'Added Small Passive Skills also grant: {0:d}% increased Fire Damage',
          '附加的小天賦給予：增加 {0:d}% 火焰傷害',
        ],
      ],
      '8': [
        [
          'Added Small Passive Skills also grant: {0:+d} to maximum Life',
          '附加的小天賦給予：{0:+d} 最大生命',
        ],
      ],
    },
    { toLocalizedName: (english) => names[english], labels: { 'Bonded:': '命定:' } },
  );

  it('PoB 在輔助寶石名稱後多寫的 Support 不影響比對', () => {
    expect(translator.translate('Socketed Gems are Supported by Level 16 Pierce Support')).toBe(
      '插槽中寶石被等級 16 的穿透輔助',
    );
  });

  it('對照資料沒收錄的寶石：用已收錄句子的框架套上物品表的譯名', () => {
    expect(
      translator.translate('Socketed Gems are Supported by Level 16 Burning Damage Support'),
    ).toBe('插槽中寶石被等級 16 的燃燒傷害輔助');
    expect(translator.translate('Grants Level 22 Wrath Skill')).toBe('獲得等級 22 的憤怒技能');
  });

  it('物品表裡沒有的名稱不翻', () => {
    expect(translator.translate('Grants Level 20 Approaching Flames Skill')).toBeUndefined();
  });

  it('前綴的譯文從同前綴的句子學出來，後半句照常翻譯', () => {
    // 這一句本身不在對照資料裡，前綴與後半句分別來自其他句子
    expect(translator.translate('Added Small Passive Skills also grant: +9 to maximum Life')).toBe(
      '附加的小天賦給予：+9 最大生命',
    );
  });

  it('學不到前綴時查標籤表；都沒有就保留英文前綴', () => {
    expect(translator.translate('Bonded: +20 to maximum Life')).toBe('命定: +20 最大生命');
    expect(translator.translate('Passives in Radius also grant 12% increased Fire Damage')).toBe(
      'Passives in Radius also grant 增加 12% 火焰傷害',
    );
  });

  it('後半句翻不出來時整句不翻，不會只翻前綴', () => {
    expect(translator.translate('Bonded: Some unknown modifier')).toBeUndefined();
    expect(translator.translate('Allocates Testudo')).toBeUndefined();
  });

  it('沒有物品表與標籤表時，一般詞綴仍可翻譯', () => {
    const plain = createModLineTranslator({
      '5': [['{0:+d} to maximum Life', '{0:+d} 最大生命']],
    });
    expect(plain.translate('+5 to maximum Life')).toBe('+5 最大生命');
    expect(plain.translate('Grants Level 22 Wrath Skill')).toBeUndefined();
    expect(plain.translate('Bonded: +5 to maximum Life')).toBe('Bonded: +5 最大生命');
  });
});

describe('loadModLineTranslator：隨擴充發佈的資料分片', () => {
  const loadJson = async (path: string) =>
    JSON.parse(await readFile(resolve(__dirname, '../public', path), 'utf8')) as unknown;

  it('PoE 1 台服與騰訊服可翻譯常見詞綴', async () => {
    const tw = await loadModLineTranslator(loadJson, { version: 'poe1', locale: 'zh-TW' });
    expect(tw?.translate('+100 to maximum Life')).toBe('+100 最大生命');
    expect(tw?.translate('Adds 65 to 119 Cold Damage')).toBe('附加 65 至 119 冰冷傷害');
    expect(tw?.translate('8% increased Attack Speed')).toBe('增加 8% 攻擊速度');
    const cn = await loadModLineTranslator(loadJson, { version: 'poe1', locale: 'zh-CN' });
    expect(cn?.translate('+100 to maximum Life')).toBeTruthy();
  });

  it('PoE 1 台服：沒收錄的輔助寶石句子與星團珠寶前綴也翻得出來', async () => {
    const tw = await loadModLineTranslator(loadJson, { version: 'poe1', locale: 'zh-TW' });
    // 完整目錄有該寶石自己的官方句子時用它，否則用學出的框架；兩者只差在空白與「的」
    expect(tw?.translate('Socketed Gems are Supported by Level 16 Burning Damage Support')).toMatch(
      /^插槽中的?寶石被等級 ?16 ?的燃燒傷害輔助$/,
    );
    expect(tw?.translate('Added Small Passive Skills also grant: +4% to Chaos Resistance')).toBe(
      '附加的小天賦給予：+4% 混沌抗性',
    );
  });

  it('PoE 1 台服：塗油、星團附魔與藥劑的多行詞綴', async () => {
    const tw = await loadModLineTranslator(loadJson, { version: 'poe1', locale: 'zh-TW' });
    expect(tw?.translate('Allocates Vigour')).toBe('配置 活力之源');
    expect(
      tw?.translate(
        'Added Small Passive Skills grant: Staff Attacks deal 12% increased Damage with Hits and Ailments',
      ),
    ).toBe('附加的小型天賦給予：長杖攻擊增加 12% 擊中和異常狀態傷害');
    expect(tw?.translate('Grants Immunity to Bleeding for 8 seconds if used while Bleeding')).toBe(
      '若使用時流血，獲得免疫流血 8 秒',
    );
  });

  it('PoE 2 台服可翻譯，Bonded 前綴用官方標籤', async () => {
    const tw = await loadModLineTranslator(loadJson, { version: 'poe2', locale: 'zh-TW' });
    expect(tw?.translate('Bonded: +20 to maximum Life')).toBe('命定: +20最大生命');
    expect(tw?.translate('29% increased Evasion and Energy Shield')).toBe('增加29%閃避和能量護盾');
  });

  it('沒有對照資料的語言不載入、回傳 undefined', async () => {
    const loadSpy = async () => {
      throw new Error('should not load');
    };
    expect(await loadModLineTranslator(loadSpy, { version: 'poe1', locale: 'en' })).toBeUndefined();
    expect(await loadModLineTranslator(loadSpy, { version: 'poe1', locale: 'ja' })).toBeUndefined();
  });
});

describe('formatPobSlot', () => {
  beforeEach(() => resetI18nStateForTests('zh-TW'));

  it('把 PoB 的部位名稱換成介面語言；認不得的保留原文', () => {
    expect(formatPobSlot('Weapon 1')).toBe('主手');
    expect(formatPobSlot('Weapon 2 Swap')).toBe('副手（切換）');
    expect(formatPobSlot('Body Armour')).toBe('胸甲');
    expect(formatPobSlot('Ring 2')).toBe('戒指 2');
    expect(formatPobSlot('Flask 5')).toBe('藥劑 5');
    expect(formatPobSlot('Jewel')).toBe('珠寶');
    expect(formatPobSlot('Weapon 1 Abyssal Socket 1')).toBe('主手深淵插槽 1');
    expect(formatPobSlot('Belt Abyssal Socket 2')).toBe('腰帶深淵插槽 2');
    expect(formatPobSlot('Arm 1')).toBe('Arm 1');
  });
});
