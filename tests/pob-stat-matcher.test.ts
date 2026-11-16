// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPobSlot } from '@/components/sidebar/pob-build/pob-slot-label';
import { resetI18nStateForTests } from '@/utils/i18n';
import { parsePobBuildXml } from '@/utils/pob-build';
import { createModLineTranslator, loadModLineTranslator } from '@/utils/pob-mod-translator';
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
      '3% increased Damage per 100 Strength',
      '+7% to Fire Damage over Time Multiplier',
    ]);
    expect(gloves.explicitMods).toEqual([
      { text: '+35 to Armour', crafted: false },
      { text: '+100 to maximum Life', crafted: false },
      { text: '12% increased Area of Effect', crafted: true },
    ]);
  });

  it('可變數值依 range 算出實際值；只留目前選用變體的詞綴', () => {
    expect(belt.implicitMods).toEqual(['+33 to maximum Life']);
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
      status: { option: 'online' },
      type: 'Leviathan Gauntlets',
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
      ['implicit', false],
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
      status: { option: 'online' },
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

  it('對不到句型、被拆開的多行詞綴回傳 undefined', () => {
    expect(translator.translate('Some unknown modifier 5')).toBeUndefined();
    expect(translator.translate('Line one')).toBeUndefined();
  });
});

describe('loadModLineTranslator：隨擴充發佈的資料分片', () => {
  const loadJson = async (path: string) =>
    JSON.parse(await readFile(resolve(__dirname, '../public', path), 'utf8')) as unknown;

  it('PoE 1 台服與國服可翻譯常見詞綴', async () => {
    const tw = await loadModLineTranslator(loadJson, { version: 'poe1', locale: 'zh-TW' });
    expect(tw?.translate('+100 to maximum Life')).toBe('+100 最大生命');
    expect(tw?.translate('Adds 65 to 119 Cold Damage')).toBe('附加 65 至 119 冰冷傷害');
    expect(tw?.translate('8% increased Attack Speed')).toBe('增加 8% 攻擊速度');
    const cn = await loadModLineTranslator(loadJson, { version: 'poe1', locale: 'zh-CN' });
    expect(cn?.translate('+100 to maximum Life')).toBeTruthy();
  });

  it('PoE 2 台服可翻譯', async () => {
    const tw = await loadModLineTranslator(loadJson, { version: 'poe2', locale: 'zh-TW' });
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
    expect(formatPobSlot('Weapon 1 Abyssal Socket 1')).toBe('Weapon 1 Abyssal Socket 1');
    expect(formatPobSlot('Arm 1')).toBe('Arm 1');
  });
});
