import { describe, expect, it } from 'vitest';
import { buildPobItemText, isPobExportableItem } from '@/utils/pob-item-text';
import { createPobTextLexicon } from '@/utils/pob-text-lexicon';

// 以下物品取自官方 fetch API 的實際回應（2026-11，刪去與輸出無關的欄位）

const POE1_ENGLISH_RARE = {
  name: 'Golem Veil',
  typeLine: 'Crimson Raiment',
  baseType: 'Crimson Raiment',
  rarity: 'Rare',
  ilvl: 48,
  sockets: [
    { group: 0, attr: 'D', sColour: 'G' },
    { group: 0, attr: 'I', sColour: 'B' },
    { group: 1, attr: 'I', sColour: 'B' },
    { group: 1, attr: 'D', sColour: 'G' },
  ],
  properties: [
    { name: 'Quality', values: [['+19%', 1]], displayMode: 0, type: 6 },
    { name: 'Evasion Rating', values: [['513', 1]], displayMode: 0, type: 17 },
  ],
  requirements: [
    { name: 'Level', values: [['48', 0]], displayMode: 0, type: 62 },
    { name: 'Dex', values: [['71', 0]], displayMode: 1, type: 64 },
  ],
  explicitMods: [
    {
      description: '+105 to Evasion Rating',
      domain: 'explicit',
      hash: 'stat.explicit.stat_53045048',
    },
    {
      description: '+13 to all Attributes',
      flags: { crafted: true },
      domain: 'crafted',
      hash: 'stat.crafted.stat_1379411836',
    },
  ],
  frameType: 2,
};

const POE1_TW_RARE = {
  name: '蛇牙 慧齒',
  typeLine: '靈石法杖',
  baseType: '靈石法杖',
  rarity: 'Rare',
  ilvl: 71,
  sockets: [
    { group: 0, attr: 'D', sColour: 'G' },
    { group: 0, attr: 'G', sColour: 'W' },
    { group: 0, attr: 'G', sColour: 'W' },
  ],
  requirements: [{ name: '等級', values: [['62', 0]], displayMode: 0, type: 62 }],
  implicitMods: [
    {
      description: '增加 31% 法術傷害',
      domain: 'implicit',
      hash: 'stat.implicit.stat_2974417149',
    },
  ],
  explicitMods: [
    {
      description: '附加 65 至 119 冰冷傷害',
      domain: 'explicit',
      hash: 'stat.explicit.stat_1037193709',
    },
    { description: '+37 最大魔力', domain: 'explicit', hash: 'stat.explicit.stat_1050105434' },
    {
      description:
        '使用技能時觸發插槽中的 1 個法術，有 8 秒冷卻時間\n以此方式觸發的法術有 150% 更多消耗',
      flags: { crafted: true },
      domain: 'crafted',
      hash: 'stat.crafted.stat_3079007202',
    },
  ],
  frameType: 2,
};

// 取自 PoE1 3.30.0.2 的 mod-lines.json（台服）
const TW_MOD_LINES = {
  '2974417149': [
    ['{0:d}% increased Spell Damage', '增加 {0:d}% 法術傷害'],
    ['{0:n}% reduced Spell Damage', '減少 {0:n}% 法術傷害'],
  ],
  '1037193709': [['Adds {0:d} to {1:d} Cold Damage', '附加 {0:d} 至 {1:d} 冰冷傷害']],
  '1050105434': [['{0:+d} to maximum Mana', '{0:+d} 最大魔力']],
  '3079007202': [
    [
      '{0:d}% chance to Trigger a Socketed Spell on Using a Skill, with a 8 second Cooldown\\nSpells Triggered this way have 150% more Cost',
      '使用技能時有 {0:d}% 機率觸發插槽中的 1 個法術，有 8 秒冷卻時間\\n以此方式觸發的法術有 150% 更多消耗',
    ],
    [
      'Trigger a Socketed Spell when you Use a Skill, with a 8 second Cooldown\\nSpells Triggered this way have 150% more Cost',
      '使用技能時觸發插槽中的 1 個法術，有 8 秒冷卻時間\\n以此方式觸發的法術有 150% 更多消耗',
    ],
  ],
} as const;

const twLexicon = createPobTextLexicon({
  modLines: TW_MOD_LINES,
  englishItems: ['Opal Wand', 'Sorcerer Boots', 'Warlock Boots', "Kalandra's Touch"],
  localizedItems: ['靈石法杖', '術士長靴', '術士長靴', '卡蘭德之觸'],
});

const POE2_ENGLISH_RARE = {
  realm: 'poe2',
  name: 'Doom Cloak',
  typeLine: 'Ascetic Garb',
  baseType: 'Ascetic Garb',
  rarity: 'Rare',
  ilvl: 55,
  sockets: [
    { group: 0, type: 'rune' },
    { group: 1, type: 'rune' },
  ],
  properties: [{ name: '[Quality]', values: [['+20%', 1]], displayMode: 0, type: 6 }],
  requirements: [{ name: 'Level', values: [['51', 0]], displayMode: 0, type: 62 }],
  runeMods: [
    {
      description:
        '18% increased [Armour|Armour], [Evasion|Evasion] and [EnergyShield|Energy Shield]',
      domain: 'rune',
      hash: 'stat.rune.stat_3523867985',
    },
    {
      description: '[ShamanOnlyMods|Bonded]: +40 to maximum Life',
      domain: 'rune',
      hash: 'stat.rune.stat_2280525771',
    },
  ],
  explicitMods: [
    {
      description: '+81 to [Evasion] Rating',
      domain: 'explicit',
      hash: 'stat.explicit.stat_53045048',
    },
    {
      description: '19% increased [ESRechargeRate|Energy Shield Recharge Rate]',
      flags: { desecrated: true },
      domain: 'desecrated',
      hash: 'stat.desecrated.stat_2339757871',
    },
  ],
  desecrated: true,
  frameType: 2,
};

describe('buildPobItemText：英文頁面', () => {
  it('PoE 1 稀有裝備輸出 PoB 格式，工藝詞綴帶 {crafted} 標記', () => {
    const result = buildPobItemText(POE1_ENGLISH_RARE, { version: 'poe1' });
    expect(result).toEqual({
      text: [
        'Rarity: RARE',
        'Golem Veil',
        'Crimson Raiment',
        'Item Level: 48',
        'Quality: 19',
        'Sockets: G-B B-G',
        'LevelReq: 48',
        'Implicits: 0',
        '+105 to Evasion Rating',
        '{crafted}+13 to all Attributes',
      ].join('\n'),
      untranslatedLines: 0,
      baseTypeUncertain: false,
    });
  });

  it('PoE 2 去掉 [標籤|顯示文字] 標記、符文詞綴算在固定詞綴區、略過 Bonded 行', () => {
    const result = buildPobItemText(POE2_ENGLISH_RARE, { version: 'poe2' });
    expect(result?.text).toBe(
      [
        'Rarity: RARE',
        'Doom Cloak',
        'Ascetic Garb',
        'Item Level: 55',
        'Quality: 20',
        'Sockets: S S',
        'LevelReq: 51',
        'Implicits: 1',
        '{rune}18% increased Armour, Evasion and Energy Shield',
        '+81 to Evasion Rating',
        '19% increased Energy Shield Recharge Rate',
      ].join('\n'),
    );
  });

  it('勢力、破裂、汙染等狀態各佔一行', () => {
    const result = buildPobItemText(
      {
        name: 'Test',
        baseType: 'Vaal Regalia',
        rarity: 'Rare',
        influences: { shaper: true, hunter: true },
        searing: true,
        synthesised: true,
        fractured: true,
        corrupted: true,
        duplicated: true,
        fracturedMods: [{ description: '+90 to maximum Life', domain: 'fractured' }],
      },
      { version: 'poe1' },
    );
    expect(result?.text.split('\n')).toEqual([
      'Rarity: RARE',
      'Test',
      'Vaal Regalia',
      'Shaper Item',
      'Hunter Item',
      'Searing Exarch Item',
      'Synthesised Item',
      'Fractured Item',
      'Implicits: 0',
      '{fractured}+90 to maximum Life',
      'Corrupted',
      'Mirrored',
    ]);
  });

  it('魔法與普通物品只有一行名稱；附魔與固定詞綴都算進 Implicits', () => {
    const result = buildPobItemText(
      {
        name: '',
        typeLine: 'Seething Divine Life Flask of Staunching',
        baseType: 'Divine Life Flask',
        rarity: 'Magic',
        enchantMods: ['Used when Charges reach full'],
        implicitMods: ['Recovers 5 Life'],
        explicitMods: ['Immunity to Bleeding'],
      },
      { version: 'poe1' },
    );
    expect(result?.text.split('\n')).toEqual([
      'Rarity: MAGIC',
      'Seething Divine Life Flask of Staunching',
      'Implicits: 2',
      '{enchant}Used when Charges reach full',
      'Recovers 5 Life',
      'Immunity to Bleeding',
    ]);
  });

  it('同一行詞綴重複出現在兩個欄位時只輸出一次', () => {
    const crafted = {
      description: '+13 to all Attributes',
      domain: 'crafted',
      hash: 'stat.crafted.stat_1379411836',
    };
    const result = buildPobItemText(
      { name: 'A', baseType: 'B', rarity: 'Rare', explicitMods: [crafted], craftedMods: [crafted] },
      { version: 'poe1' },
    );
    expect(result?.text.match(/all Attributes/g)).toHaveLength(1);
  });
});

describe('buildPobItemText：在地化頁面', () => {
  it('台服稀有裝備轉成英文：基底查物品表、詞綴依 stat 代碼反查、多行詞綴逐行標記', () => {
    const result = buildPobItemText(POE1_TW_RARE, { version: 'poe1', lexicon: twLexicon });
    expect(result).toEqual({
      text: [
        'Rarity: RARE',
        'New Item',
        'Opal Wand',
        'Item Level: 71',
        'Sockets: G-W-W',
        'LevelReq: 62',
        'Implicits: 1',
        '31% increased Spell Damage',
        'Adds 65 to 119 Cold Damage',
        '+37 to maximum Mana',
        '{crafted}Trigger a Socketed Spell when you Use a Skill, with a 8 second Cooldown',
        '{crafted}Spells Triggered this way have 150% more Cost',
      ].join('\n'),
      untranslatedLines: 0,
      baseTypeUncertain: false,
    });
  });

  it('查不到英文的詞綴保留原文並計數', () => {
    const result = buildPobItemText(
      {
        ...POE1_TW_RARE,
        explicitMods: [
          { description: '未知的詞綴 5', domain: 'explicit', hash: 'stat.explicit.stat_1' },
          { description: '沒有代碼的詞綴' },
        ],
      },
      { version: 'poe1', lexicon: twLexicon },
    );
    expect(result?.untranslatedLines).toBe(2);
    expect(result?.text).toContain('未知的詞綴 5');
  });

  it('基底中文名對到多個英文基底時標記為不確定', () => {
    const result = buildPobItemText(
      { name: '某 靴', baseType: '術士長靴', rarity: 'Rare' },
      { version: 'poe1', lexicon: twLexicon },
    );
    expect(result?.baseTypeUncertain).toBe(true);
    expect(result?.text).toContain('Sorcerer Boots');
  });

  it('基底查不到時保留原文並標記為不確定', () => {
    const result = buildPobItemText(
      { name: '某 物', baseType: '不存在的基底', rarity: 'Rare' },
      { version: 'poe1', lexicon: twLexicon },
    );
    expect(result?.baseTypeUncertain).toBe(true);
    expect(result?.text).toContain('不存在的基底');
  });

  it('傳奇物品名稱也轉成英文', () => {
    const result = buildPobItemText(
      { name: '卡蘭德之觸', baseType: '靈石法杖', rarity: 'Unique' },
      { version: 'poe1', lexicon: twLexicon },
    );
    expect(result?.text.split('\n').slice(0, 3)).toEqual([
      'Rarity: UNIQUE',
      "Kalandra's Touch",
      'Opal Wand',
    ]);
  });
});

describe('isPobExportableItem', () => {
  it('只有普通、魔法、稀有、傳奇物品可匯出', () => {
    expect(isPobExportableItem(POE1_ENGLISH_RARE)).toBe(true);
    expect(isPobExportableItem({ typeLine: 'Chaos Orb', frameType: 5 })).toBe(false);
    expect(isPobExportableItem({ typeLine: 'Vaal Regalia', frameType: 0 })).toBe(true);
    expect(isPobExportableItem(null)).toBe(false);
    expect(buildPobItemText({ typeLine: 'Chaos Orb', frameType: 5 }, { version: 'poe1' })).toBe(
      null,
    );
  });
});
