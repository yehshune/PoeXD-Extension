import { describe, expect, it } from 'vitest';
import {
  decodePoeIconArtPath,
  normalizePoe2Item,
  resolveEquipmentSlot,
  type RawPoeItem,
  type RuneSubstitutionConfig,
} from '../utils/poe2-item-normalizer';

describe('poe2-item-normalizer', () => {
  it('案例 1 (Vortex Post, 2孔長杖): 正確扣除 36% 符文物傷還原淨底子，並試算滿孔頂符潛力', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Dreaming Quarterstaff',
      sockets: [
        { group: 0, type: 'rune' },
        { group: 1, type: 'rune' },
      ],
      socketedItems: [{}, {}],
      properties: [
        { name: 'Attacks per Second', values: [['1.50', 0]], type: 13 },
        { name: '[Physical] Damage', values: [['590-838', 1]], type: 9 },
      ],
      runeMods: [{ description: '36% increased [Physical] Damage' }],
      explicitMods: [{ description: '208% increased [Physical] Damage' }],
      extended: {
        dps: 1071,
        pdps: 1071,
        edps: 0,
      },
    };

    const res = normalizePoe2Item(item);
    expect(res).not.toBeNull();
    if (res?.type !== 'weapon') throw new Error('Expected weapon');

    expect(res.socketsCount).toBe(2);
    expect(res.filledSocketsCount).toBe(2);
    expect(res.emptySocketsCount).toBe(0);
    expect(res.socketAnalysis.targetSockets).toBe(2);
    expect(res.socketAnalysis.canAddSockets).toBe(false);

    // 總倍率: 1 + 208% + 36% = 3.44
    // 淨底子倍率: 1 + 208% = 3.08
    // 1071 * 3.08 / 3.44 = 958.92
    expect(res.clean.pdps).toBe(958.92);
    expect(res.clean.dps).toBe(958.92);

    // 滿孔 2 顆 Perfect (40%):
    // 滿孔倍率: 1 + 208% + 40% = 3.48
    // 1071 * 3.48 / 3.44 = 1083.45
    expect(res.potential.pdps).toBe(1083.45);
    expect(res.potential.dps).toBe(1083.45);
    expect(res.potential.diffDps).toBe(12.45);
  });

  it('案例 2 (Storm Mast, 3孔混傷長杖, 超上限孔): 雙手杖預設上限2孔，3孔視為超上限瓦孔', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Striking Quarterstaff',
      sockets: [
        { group: 0, type: 'rune' },
        { group: 1, type: 'rune' },
        { group: 2, type: 'rune' },
      ],
      socketedItems: [{}, {}, {}],
      properties: [{ name: 'Attacks per Second', values: [['1.40', 0]], type: 13 }],
      runeMods: [
        { description: '40% increased [Physical] Damage' },
        {
          description: '50% increased [Attack] Damage against Rare or Unique Enemies',
        },
      ],
      explicitMods: [{ description: '167% increased [Physical] Damage' }],
      extended: {
        dps: 1059.1,
        pdps: 810.6,
        edps: 248.5,
      },
    };

    const res = normalizePoe2Item(item);
    expect(res).not.toBeNull();
    if (res?.type !== 'weapon') throw new Error('Expected weapon');

    expect(res.socketsCount).toBe(3);
    expect(res.socketAnalysis.isOvercapped).toBe(true);
    expect(res.socketAnalysis.targetSockets).toBe(3);

    // 物理總倍率: 1 + 167% + 40% = 3.07
    // 淨底子倍率: 1 + 167% = 2.67
    // clean pdps: 810.6 * 2.67 / 3.07 = 704.98
    expect(res.clean.pdps).toBe(704.98);
    expect(res.clean.edps).toBe(248.5);
    expect(res.clean.dps).toBe(953.48);

    // 滿孔 3 顆 Perfect (60%):
    // 滿孔倍率: 1 + 167% + 60% = 3.27
    // potential pdps: 810.6 * 3.27 / 3.07 = 863.41
    expect(res.potential.pdps).toBe(863.41);
    expect(res.potential.dps).toBe(1111.91);
    expect(res.potential.diffDps).toBe(52.81);
  });

  it('案例 3 (防具裝備, 2孔胸甲): 正確解析護甲並在扣除與試算滿孔頂符防禦', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Exquisite Plate',
      sockets: [
        { group: 0, type: 'rune' },
        { group: 1, type: 'rune' },
      ],
      socketedItems: [{ socket: 0 }], // 只插了 1 顆
      properties: [
        { name: 'Quality', values: [['+20%', 1]], type: 6 },
        { name: 'Armour', values: [['1200', 0]], type: 16 },
      ],
      runeMods: [{ description: '18% increased Armour, Evasion and Energy Shield' }],
      explicitMods: [{ description: '80% increased Armour' }],
    };

    const res = normalizePoe2Item(item);
    expect(res).not.toBeNull();
    if (res?.type !== 'armour') throw new Error('Expected armour');

    expect(res.socketsCount).toBe(2);
    expect(res.filledSocketsCount).toBe(1);
    expect(res.emptySocketsCount).toBe(1);

    // 當前倍率: 1 + 80% + 18% = 1.98
    // 淨底子倍率: 1 + 80% = 1.80
    // clean armour: 1200 * 1.80 / 1.98 = 1091
    expect(res.clean.armour).toBe(1091);

    // 滿孔 2 顆 Perfect (40%):
    // 滿孔倍率: 1 + 80% + 40% = 2.20
    // potential armour: 1091 * 2.20 / 1.80 = 1333
    expect(res.potential.armour).toBe(1333);
    expect(res.potential.diffTotalDefense).toBe(133);
  });

  it('案例 4 (Carrion Pole, 3孔長杖帶30%符文效果放大): 正確試算淨底與滿孔潛力', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Lunar Quarterstaff',
      sockets: [
        { group: 0, type: 'rune' },
        { group: 1, type: 'rune' },
        { group: 2, type: 'rune' },
      ],
      socketedItems: [{}, {}, {}],
      properties: [{ name: 'Attacks per Second', values: [['1.88', 1]], type: 13 }],
      runeMods: [{ description: '78% increased [Physical] Damage' }],
      explicitMods: [
        { description: '30% increased effect of Socketed [Augment] Items' },
        { description: '175% increased [Physical] Damage' },
      ],
      extended: {
        dps: 1366.76,
        pdps: 1097.92,
        edps: 268.84,
      },
    };

    const res = normalizePoe2Item(item);
    expect(res).not.toBeNull();
    if (res?.type !== 'weapon') throw new Error('Expected weapon');

    expect(res.socketsCount).toBe(3);
    expect(res.emptySocketsCount).toBe(0);

    // 淨底子: 1097.92 * (2.75 / 3.53) = 855.32
    expect(res.clean.pdps).toBe(855.32);
    expect(res.clean.edps).toBe(268.84);
    expect(res.clean.dps).toBe(1124.16);

    // 滿孔潛力: 3 孔 * 20% * 1.3 = 78% (與當前相同)
    expect(res.potential.pdps).toBe(1097.92);
  });

  it('案例 5 (未打孔雙手弓, 0孔未污染): 市集未打孔裝備不可預設為0孔，應以雙手預設上限2孔計算潛力', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Expert Dual Bow',
      sockets: [], // 0 孔
      corrupted: false,
      properties: [{ name: 'Attacks per Second', values: [['1.40', 0]], type: 13 }],
      explicitMods: [{ description: '100% increased [Physical] Damage' }],
      extended: {
        dps: 400,
        pdps: 400,
        edps: 0,
      },
    };

    const res = normalizePoe2Item(item);
    expect(res).not.toBeNull();
    if (res?.type !== 'weapon') throw new Error('Expected weapon');

    expect(res.socketsCount).toBe(0);
    expect(res.socketAnalysis.defaultLimit).toBe(2);
    expect(res.socketAnalysis.targetSockets).toBe(2);
    expect(res.socketAnalysis.canAddSockets).toBe(true);

    // 淨底子 pdps: 400
    expect(res.clean.pdps).toBe(400);

    // 滿孔 2 顆鐵符文 (+40% 物傷):
    // 淨倍率: 2.0 (1 + 100%)
    // 滿孔倍率: 2.4 (1 + 100% + 40%)
    // 400 * 2.4 / 2.0 = 480
    expect(res.potential.pdps).toBe(480);
    expect(res.potential.dps).toBe(480);
    expect(res.potential.diffDps).toBe(80);
  });

  it('案例 6 (已污染單手劍, 0孔已污染): 已污染裝備無法再打孔，潛力孔數應為 0', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Expert Broadsword',
      sockets: [], // 0 孔
      corrupted: true, // 已污染
      properties: [{ name: 'Attacks per Second', values: [['1.30', 0]], type: 13 }],
      explicitMods: [{ description: '80% increased [Physical] Damage' }],
      extended: {
        dps: 300,
        pdps: 300,
        edps: 0,
      },
    };

    const res = normalizePoe2Item(item);
    expect(res).not.toBeNull();
    if (res?.type !== 'weapon') throw new Error('Expected weapon');

    expect(res.socketAnalysis.isCorrupted).toBe(true);
    expect(res.socketAnalysis.targetSockets).toBe(0);
    expect(res.socketAnalysis.canAddSockets).toBe(false);

    // 無法打孔，滿孔潛力等於當前淨底子
    expect(res.potential.pdps).toBe(300);
    expect(res.potential.diffDps).toBe(0);
  });

  it('案例 7 (自訂目標符文全替換): 使用者選擇全部替換為火點傷符文試算', () => {
    const item = {
      realm: 'poe2',
      baseType: 'Striking Quarterstaff',
      sockets: [
        { group: 0, type: 'rune' },
        { group: 1, type: 'rune' },
      ],
      socketedItems: [{}, {}],
      properties: [{ name: 'Attacks per Second', values: [['1.50', 0]], type: 13 }],
      runeMods: [
        { description: '36% increased [Physical] Damage' }, // 原本是物傷符文
      ],
      explicitMods: [{ description: '100% increased [Physical] Damage' }],
      extended: {
        dps: 500,
        pdps: 500,
        edps: 0,
      },
    };

    // 使用者設定：全部替換為火點傷符文 (每孔平均 +20 火點傷)
    const customConfig: RuneSubstitutionConfig = {
      weaponRune: { type: 'flat_fire', value: 20 },
      armourRune: { type: 'def_percent', value: 20 },
    };

    const res = normalizePoe2Item(item, customConfig);
    expect(res).not.toBeNull();
    if (res?.type !== 'weapon') throw new Error('Expected weapon');

    // 淨底子 pdps: 500 * (2.0 / 2.36) = 423.73
    expect(res.clean.pdps).toBe(423.73);

    // 替換後：2 孔 * 20 平均火點傷 * 1.50 APS = 60 火點傷 edps
    expect(res.potential.pdps).toBe(423.73);
    expect(res.potential.edps).toBe(60);
    expect(res.potential.dps).toBe(483.73);
  });

  it('案例 8 (法杖與長杖施法武器排除): 法杖 (Wand) 與長杖 (Staff) 不予試算攻擊 DPS，武杖 (Quarterstaff) 正常試算', () => {
    const wand = {
      realm: 'poe2',
      baseType: 'Bone Wand',
      properties: [{ name: 'Attacks per Second', values: [['1.20', 0]], type: 13 }],
      extended: { dps: 100, pdps: 100, edps: 0 },
    };
    expect(normalizePoe2Item(wand)).toBeNull();

    const staff = {
      realm: 'poe2',
      baseType: 'Pagan Staff',
      properties: [{ name: 'Attacks per Second', values: [['1.15', 0]], type: 13 }],
      extended: { dps: 200, pdps: 200, edps: 0 },
    };
    expect(normalizePoe2Item(staff)).toBeNull();

    const sceptre = {
      realm: 'poe2',
      baseType: 'Omen Sceptre',
      properties: [{ name: 'Attacks per Second', values: [['1.20', 0]], type: 13 }],
      extended: { dps: 150, pdps: 150, edps: 0 },
    };
    expect(normalizePoe2Item(sceptre)).toBeNull();

    const quarterstaff = {
      realm: 'poe2',
      baseType: 'Dreaming Quarterstaff',
      properties: [{ name: 'Attacks per Second', values: [['1.50', 0]], type: 13 }],
      extended: { dps: 300, pdps: 300, edps: 0 },
    };
    expect(normalizePoe2Item(quarterstaff)).not.toBeNull();
  });

  it('案例 9 (完美沙漠/冰川/暴風點傷符文試算): 驗證 18.5、18 與 20.5 均傷試算', () => {
    const weapon = {
      realm: 'poe2',
      baseType: 'Expert Dual Bow',
      sockets: [
        { group: 0, type: 'rune' },
        { group: 1, type: 'rune' },
      ],
      socketedItems: [{}, {}],
      properties: [{ name: 'Attacks per Second', values: [['1.50', 0]], type: 13 }],
      extended: { dps: 200, pdps: 200, edps: 0 },
    };

    // 1. 完美沙漠符文 (17-20 火傷，均傷 18.5)
    // 2 孔 * 18.5 * 1.50 APS = 55.5 edps
    const desertRes = normalizePoe2Item(weapon, {
      weaponRune: { type: 'flat_fire', value: 18.5 },
      armourRune: { type: 'def_percent', value: 20 },
    });
    expect(desertRes?.type).toBe('weapon');
    if (desertRes?.type === 'weapon') {
      expect(desertRes.potential.edps).toBe(55.5);
      expect(desertRes.potential.dps).toBe(255.5);
    }

    // 2. 完美冰川符文 (16-20 冰傷，均傷 18)
    // 2 孔 * 18 * 1.50 APS = 54 edps
    const glacierRes = normalizePoe2Item(weapon, {
      weaponRune: { type: 'flat_cold', value: 18 },
      armourRune: { type: 'def_percent', value: 20 },
    });
    expect(glacierRes?.type).toBe('weapon');
    if (glacierRes?.type === 'weapon') {
      expect(glacierRes.potential.edps).toBe(54);
      expect(glacierRes.potential.dps).toBe(254);
    }

    // 3. 完美暴風符文 (1-40 電傷，均傷 20.5)
    // 2 孔 * 20.5 * 1.50 APS = 61.5 edps
    const stormRes = normalizePoe2Item(weapon, {
      weaponRune: { type: 'flat_lightning', value: 20.5 },
      armourRune: { type: 'def_percent', value: 20 },
    });
    expect(stormRes?.type).toBe('weapon');
    if (stormRes?.type === 'weapon') {
      expect(stormRes.potential.edps).toBe(61.5);
      expect(stormRes.potential.dps).toBe(261.5);
    }
  });
  describe('打孔上限規則 (部位判定 / 卓越 / 污染)', () => {
    const iconFor = (artPath: string) => {
      const json = JSON.stringify([25, 14, { f: artPath, w: 2, h: 2, scale: 1, realm: 'poe2' }]);
      const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `https://web.poecdn.com/gen/image/${b64}/b5cbbe6ce4/Icon.png`;
    };
    const helmetIcon = iconFor('2DItems/Armours/Helmets/Basetypes/HelmetIntStr02');
    const helmet = (overrides: Record<string, unknown>): RawPoeItem => ({
      realm: 'poe2',
      icon: helmetIcon,
      baseType: '翱翔之面',
      typeLine: '翱翔之面',
      sockets: [] as Array<{ group: number; type: string }>,
      socketedItems: [],
      properties: [
        { name: '頭盔', values: [], displayMode: 0, type: 109 },
        { name: '[Quality]', values: [['+20%', 1] as [string, number]], displayMode: 0, type: 6 },
        { name: '[Armour]', values: [['174', 1] as [string, number]], displayMode: 0, type: 16 },
      ],
      ...overrides,
    });
    const rune = (group: number) => ({ group, type: 'rune' });

    it('解碼 CDN 圖示路徑並依路徑判定部位 (不受在地化 baseType 影響)', () => {
      expect(decodePoeIconArtPath(helmetIcon)).toBe(
        '2DItems/Armours/Helmets/Basetypes/HelmetIntStr02',
      );
      expect(resolveEquipmentSlot(helmet({}))).toBe('helmet');
      expect(
        resolveEquipmentSlot({
          icon: iconFor('2DItems/Weapons/TwoHandWeapons/Bows/Basetypes/Bow09'),
        }),
      ).toBe('two_hand_weapon');
      expect(
        resolveEquipmentSlot({ icon: iconFor('2DItems/Armours/BodyArmours/Basetypes/BodyStr01') }),
      ).toBe('body_armour');
      expect(decodePoeIconArtPath('https://web.poecdn.com/image/Art/foo.png')).toBeUndefined();
    });

    it('一般頭盔 (繁中 baseType) 0 孔只能打到 1 孔', () => {
      const res = normalizePoe2Item(helmet({}));
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.socketAnalysis.slot).toBe('helmet');
      expect(res.socketAnalysis.defaultLimit).toBe(1);
      expect(res.socketAnalysis.targetSockets).toBe(1);
      expect(res.socketAnalysis.canAddSockets).toBe(true);
    });

    it('一般頭盔已 1 孔時不可再打孔', () => {
      const res = normalizePoe2Item(helmet({ sockets: [rune(0)] }));
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.socketAnalysis.canAddSockets).toBe(false);
      expect(res.socketAnalysis.targetSockets).toBe(1);
    });

    it.each(['卓越 翱翔之面', 'Exceptional Wrapped Cap'])(
      '卓越頭盔 (%s) 上限為基礎 +1 孔',
      (typeLine) => {
        const res = normalizePoe2Item(helmet({ typeLine, sockets: [rune(0)] }));
        if (res?.type !== 'armour') throw new Error('Expected armour');
        expect(res.socketAnalysis.isExceptional).toBe(true);
        expect(res.socketAnalysis.baseLimit).toBe(1);
        expect(res.socketAnalysis.defaultLimit).toBe(2);
        expect(res.socketAnalysis.targetSockets).toBe(2);
        expect(res.socketAnalysis.canAddSockets).toBe(true);
      },
    );

    it('未污染且孔數超出基礎上限的稀有頭盔推定為卓越，已達上限不顯示打孔', () => {
      const res = normalizePoe2Item(helmet({ rarity: 'Rare', sockets: [rune(0), rune(1)] }));
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.socketAnalysis.isExceptional).toBe(true);
      expect(res.socketAnalysis.canAddSockets).toBe(false);
      expect(res.socketAnalysis.targetSockets).toBe(2);
    });

    it('技能寶石不計入已鑲嵌增幅數', () => {
      const res = normalizePoe2Item(
        helmet({
          sockets: [rune(0)],
          socketedItems: [{ frameType: 4, frameTypeId: 'Gem', support: false }],
        }),
      );
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.filledSocketsCount).toBe(0);
    });

    it('插槽綁定增幅佔用的孔不可被目標符文覆寫', () => {
      const socketBound = {
        socket: 0,
        frameType: 5,
        frameTypeId: 'Currency',
        runeMods: ['[SocketBound|插槽綁定]'],
      };
      const normalRune = { socket: 1, frameType: 5, frameTypeId: 'Currency' };
      const chest = {
        realm: 'poe2',
        icon: iconFor('2DItems/Armours/BodyArmours/Basetypes/BodyInt01'),
        typeLine: '羽飾長袍',
        baseType: '羽飾長袍',
        sockets: [rune(0), rune(1)],
        socketedItems: [socketBound, normalRune],
        properties: [
          { name: '[Quality]', values: [['+20%', 1] as [string, number]], type: 6 },
          { name: '[EnergyShield]', values: [['200', 1] as [string, number]], type: 18 },
        ],
      };
      const res = normalizePoe2Item(chest);
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.socketAnalysis.lockedSockets).toBe(1);
      expect(res.socketAnalysis.overridableSockets).toBe(1);
      // 淨底 200，只有 1 孔可覆寫 20% → 240
      expect(res.potential.energyShield).toBe(240);

      const unlocked = normalizePoe2Item({ ...chest, socketedItems: [normalRune, normalRune] });
      if (unlocked?.type !== 'armour') throw new Error('Expected armour');
      expect(unlocked.socketAnalysis.lockedSockets).toBe(0);
      expect(unlocked.potential.energyShield).toBe(280);
    });

    it('高階鍛鐵符文 18% 套用於防具覆寫試算', () => {
      const res = normalizePoe2Item(helmet({ sockets: [rune(0)] }), {
        weaponRune: { type: 'phys_percent', value: 18 },
        armourRune: { type: 'def_percent', value: 18 },
      });
      if (res?.type !== 'armour') throw new Error('Expected armour');
      // 淨底 174，1 孔 18% → round(174 * 1.18) = 205
      expect(res.potential.armour).toBe(205);
    });

    it('污染頭盔孔數不可變更 (含卓越)', () => {
      for (const typeLine of ['翱翔之面', '卓越 翱翔之面']) {
        const res = normalizePoe2Item(helmet({ typeLine, corrupted: true }));
        if (res?.type !== 'armour') throw new Error('Expected armour');
        expect(res.socketAnalysis.canAddSockets).toBe(false);
        expect(res.socketAnalysis.targetSockets).toBe(0);
      }
    });
  });

  describe('真實 API 格式與修正後計算公式驗證', () => {
    it('真實 PoE 2 API [Evasion|Evasion] Rating 括號詞綴與 0% 未污染自動換算 20% 品質', () => {
      // 取自實際 /api/trade2/fetch 之 Elevore Hunter Hood 資料 (0% 品質實值 265，官方 extended.ev 已換算 20% 品質 = 319)
      const item: RawPoeItem = {
        realm: 'poe2',
        icon: 'https://web.poecdn.com/gen/image/WzI1LDE0LHsiZiI6IjJESXRlbXMvQXJtb3Vycy9IZWxtZXRzL0Jhc2V0eXBlcy9IZWxtZXREZXgwNSIsInciOjIsImgiOjIsInNjYWxlIjoxLCJyZWFsbSI6InBvZTIifV0/abc/HelmetDex05.png',
        typeLine: 'Hunter Hood',
        baseType: 'Hunter Hood',
        sockets: [],
        properties: [
          { name: 'Ezomyte Helmet', values: [], displayMode: 0, type: 109 },
          { name: '[Evasion|Evasion Rating]', values: [['265', 1]], displayMode: 0, type: 17 },
        ],
        explicitMods: [
          {
            description: '68% increased [Evasion|Evasion] Rating',
            domain: 'explicit',
            hash: 'stat.explicit.stat_124859000',
          },
          {
            description: '+21 to [Dexterity|Dexterity]',
            domain: 'explicit',
            hash: 'stat.explicit.stat_3261801346',
          },
        ],
        extended: {
          ev: 319,
          ev_aug: true,
        },
      };

      const res = normalizePoe2Item(item);
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.current.evasion).toBe(319);
      expect(res.clean.evasion).toBe(319);
      // 319 * (1 + 0.68 + 0.20) / (1 + 0.68) = 319 * 1.88 / 1.68 = 356.98 -> 357 (+38)
      expect(res.potential.evasion).toBe(357);
      expect(res.potential.diffTotalDefense).toBe(38);
    });

    it('複合防具各自獨立計算護甲 / 閃避 / ES 百分比，且排除充能率與條件詞綴誤判', () => {
      const hybridChest: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Conjurer Mantle',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [{}, {}],
        properties: [
          { name: '[Quality]', values: [['+20%', 1]], type: 6 },
          { name: '[Armour]', values: [['360', 1]], type: 16 },
          { name: '[EnergyShield|Energy Shield]', values: [['160', 1]], type: 18 },
        ],
        runeMods: [
          {
            description:
              '40% increased [Armour|Armour], [Evasion|Evasion] and [EnergyShield|Energy Shield]',
          },
        ],
        explicitMods: [
          { description: '80% increased [Armour|Armour]' },
          { description: '60% increased [EnergyShield|Energy Shield]' },
          { description: '30% increased [EnergyShield|Energy Shield] Recharge Rate' },
          { description: '50% increased [Armour|Armour] while stationary' },
        ],
      };

      const res = normalizePoe2Item(hybridChest);
      if (res?.type !== 'armour') throw new Error('Expected armour');
      // 護甲倍率: 1 + 0.80 + 0.40 = 2.20 -> clean = 360 * 1.80 / 2.20 = 295, potential = 360
      expect(res.clean.armour).toBe(295);
      expect(res.potential.armour).toBe(360);
      // ES 倍率: 1 + 0.60 + 0.40 = 2.00 -> clean = 160 * 1.60 / 2.00 = 128, potential = 160
      expect(res.clean.energyShield).toBe(128);
      expect(res.potential.energyShield).toBe(160);
      expect(res.potential.diffTotalDefense).toBe(0);
    });

    it('武器 [Fire|Fire] 括號元素點傷符文可正確扣除並排除 Bonded/條件詞綴', () => {
      const weapon: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Dreaming Quarterstaff',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [{}, {}],
        properties: [{ name: 'Attacks per Second', values: [['1.50', 1]], type: 13 }],
        runeMods: [
          {
            description: '18% increased [Physical] Damage',
            domain: 'rune',
            hash: 'stat.rune.stat_1509134228',
          },
          {
            description: 'Adds 13 to 16 [Fire|Fire] Damage',
            domain: 'rune',
            hash: 'stat.rune.stat_709508406',
          },
          {
            description:
              '[ShamanOnlyMods|Bonded]: 30% increased [Ignite|Ignite] [BuffMagnitude|Magnitude]',
          },
          {
            description: 'Adds 10 to 20 [Lightning|Lightning] Damage against Shocked Enemies',
            domain: 'rune',
            hash: 'stat.rune.stat_90012347',
          },
        ],
        explicitMods: [
          {
            description: '182% increased [Physical] Damage',
            domain: 'explicit',
            hash: 'stat.explicit.stat_1509134228',
          },
          {
            description: '30% increased Global [Physical] Damage',
            domain: 'explicit',
            hash: 'stat.explicit.stat_1310194496',
          },
        ],
        extended: {
          dps: 321.75,
          pdps: 300,
          edps: 21.75, // (13+16)/2 * 1.50 = 21.75
        },
      };

      const res = normalizePoe2Item(weapon);
      if (res?.type !== 'weapon') throw new Error('Expected weapon');
      // 淨底子: eDPS 應完整扣掉 21.75 歸 0；pDPS = 300 * 2.82 / 3.00 = 282
      expect(res.clean.edps).toBe(0);
      expect(res.clean.pdps).toBe(282);
      // 滿孔 2 顆完美鐵符 (+40%): pDPS = 300 * 3.22 / 3.00 = 322
      expect(res.potential.pdps).toBe(322);
      expect(res.potential.edps).toBe(0);
    });

    it('支援繁中/簡中「鑲嵌的物品效果」詞綴放大試算與 fracturedMods/desecratedMods 欄位', () => {
      const twWeapon: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Dreaming Quarterstaff',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [{}, {}],
        properties: [{ name: 'Attacks per Second', values: [['1.50', 0]], type: 13 }],
        fracturedMods: ['100% increased [Physical|Physical] Damage'],
        desecratedMods: ['50% increased [Physical|Physical] Damage'],
        explicitMods: ['增加30%鑲嵌的物品效果'],
        extended: { dps: 500, pdps: 500, edps: 0 },
      };

      const res = normalizePoe2Item(twWeapon);
      if (res?.type !== 'weapon') throw new Error('Expected weapon');
      // 2 孔 * 20% * 1.3 = 52%; explicit = 150% -> 500 * 3.02 / 2.50 = 604
      expect(res.potential.pdps).toBe(604);

      const cnWeapon: RawPoeItem = {
        ...twWeapon,
        explicitMods: ['镶嵌的增幅器物品效果提高 30%'],
      };
      const cnRes = normalizePoe2Item(cnWeapon);
      if (cnRes?.type !== 'weapon') throw new Error('Expected weapon');
      expect(cnRes.potential.pdps).toBe(604);
    });

    it('插槽綁定增幅器本身帶有的屬性在覆寫試算時不可被移除', () => {
      const weapon: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Dreaming Quarterstaff',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [
          {
            socket: 0,
            frameType: 5,
            frameTypeId: 'Currency',
            runeMods: ['[SocketBound|Socket-bound]'],
            explicitMods: [
              { description: '[MartialWeapon|Martial Weapon]: 25% increased [Physical] Damage' },
            ],
          },
          {
            socket: 1,
            frameType: 5,
            frameTypeId: 'Currency',
          },
        ],
        properties: [{ name: 'Attacks per Second', values: [['1.50', 0]], type: 13 }],
        runeMods: [
          { description: '25% increased [Physical] Damage', hash: 'stat.rune.stat_1509134228' },
        ],
        explicitMods: [
          {
            description: '100% increased [Physical] Damage',
            hash: 'stat.explicit.stat_1509134228',
          },
        ],
        extended: { dps: 450, pdps: 450, edps: 0 },
      };

      const res = normalizePoe2Item(weapon);
      if (res?.type !== 'weapon') throw new Error('Expected weapon');
      expect(res.socketAnalysis.lockedSockets).toBe(1);
      expect(res.socketAnalysis.overridableSockets).toBe(1);
      // 總倍率 1 + 1.00 + 0.25 = 2.25; 潛力 = 保留綁定 25% + 可覆寫 1 孔 20% = 2.45
      // 450 * 2.45 / 2.25 = 490
      expect(res.potential.pdps).toBe(490);
    });

    it('現有符文含局部攻速加成時，覆寫為非攻速符文應正確扣除被替換孔的攻速', () => {
      const weapon: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Dreaming Quarterstaff',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [{}, {}],
        properties: [{ name: 'Attacks per Second', values: [['1.50', 1]], type: 13 }],
        runeMods: [
          {
            description: '10% increased [Attack] Speed',
            domain: 'rune',
            hash: 'stat.rune.stat_210067635',
          },
        ],
        explicitMods: [
          {
            description: '100% increased [Physical] Damage',
            domain: 'explicit',
            hash: 'stat.explicit.stat_1509134228',
          },
          {
            description: '15% increased [Attack] Speed',
            domain: 'explicit',
            hash: 'stat.explicit.stat_210067635',
          },
        ],
        extended: { dps: 500, pdps: 500, edps: 0 },
      };

      const res = normalizePoe2Item(weapon);
      if (res?.type !== 'weapon') throw new Error('Expected weapon');
      // 攻速倍率 1.25 -> 1.15; 物傷倍率 2.00 -> 2.40
      // 500 * (2.40 / 2.00) * (1.15 / 1.25) = 552
      expect(res.potential.pdps).toBe(552);
    });
  });

  describe('品質標準化規則 (20% 基準與超過 20% 保留)', () => {
    it('未污染 0% 品質防具即使缺少 extended 也會自動打滿至 20% 品質試算', () => {
      const helmet0Qual: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Hunter Hood',
        sockets: [],
        properties: [{ name: '[Evasion|Evasion Rating]', values: [['265', 1]], type: 17 }],
        explicitMods: [
          {
            description: '68% increased [Evasion|Evasion] Rating',
            hash: 'stat.explicit.stat_124859000',
          },
        ],
      };

      const res = normalizePoe2Item(helmet0Qual);
      if (res?.type !== 'armour') throw new Error('Expected armour');
      // 265 * 1.20 = 318
      expect(res.current.evasion).toBe(318);
      expect(res.clean.evasion).toBe(318);
      // 318 * 1.88 / 1.68 = 355.85 -> 356
      expect(res.potential.evasion).toBe(356);
    });

    it('未污染 7% 品質防具優先採用官方 extended 20% 數值，缺少 extended 時則依 1.20 / 1.07 換算', () => {
      const smugglerWithExtended: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Smuggler Coat',
        sockets: [{ group: 0, type: 'rune' }],
        socketedItems: [],
        properties: [
          { name: '[Quality]', values: [['+7%', 1]], type: 6 },
          { name: '[Evasion|Evasion Rating]', values: [['563', 1]], type: 17 },
        ],
        explicitMods: [
          {
            description: '80% increased [Evasion|Evasion] Rating',
            hash: 'stat.explicit.stat_124859000',
          },
        ],
        extended: { ev: 631, ev_aug: true },
      };

      const withExt = normalizePoe2Item(smugglerWithExtended);
      if (withExt?.type !== 'armour') throw new Error('Expected armour');
      expect(withExt.current.evasion).toBe(631);
      // 胸甲預設 2 孔 +40%: 631 * (1 + 0.80 + 0.40) / 1.80 = 771
      expect(withExt.potential.evasion).toBe(771);

      const withoutExt = normalizePoe2Item({ ...smugglerWithExtended, extended: undefined });
      if (withoutExt?.type !== 'armour') throw new Error('Expected armour');
      // round(563 * 1.20 / 1.07) = 631
      expect(withoutExt.current.evasion).toBe(631);
      expect(withoutExt.potential.evasion).toBe(771);
    });

    it('已超過 20% 品質 (例如 25% / 30%) 之防具與武器必須保留原品質，不可降回 20%', () => {
      const overQualChest: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Exquisite Plate',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [],
        properties: [
          { name: '[Quality]', values: [['+25%', 1]], type: 6 },
          { name: 'Armour', values: [['1250', 1]], type: 16 },
        ],
        explicitMods: [
          { description: '100% increased Armour', hash: 'stat.explicit.stat_1062208444' },
        ],
      };

      const armourRes = normalizePoe2Item(overQualChest);
      if (armourRes?.type !== 'armour') throw new Error('Expected armour');
      expect(armourRes.current.armour).toBe(1250);
      // 1250 * 2.40 / 2.00 = 1500
      expect(armourRes.potential.armour).toBe(1500);

      const overQualWeapon: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Dreaming Quarterstaff',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [],
        properties: [
          { name: '[Quality]', values: [['+30%', 1]], type: 6 },
          { name: 'Attacks per Second', values: [['1.50', 0]], type: 13 },
        ],
        explicitMods: [
          {
            description: '100% increased [Physical] Damage',
            hash: 'stat.explicit.stat_1509134228',
          },
        ],
        extended: { dps: 650, pdps: 650, edps: 0 },
      };

      const weaponRes = normalizePoe2Item(overQualWeapon);
      if (weaponRes?.type !== 'weapon') throw new Error('Expected weapon');
      // 保留 30% 品質對應之 extended.pdps 650 -> 650 * 2.40 / 2.00 = 780
      expect(weaponRes.current.pdps).toBe(650);
      expect(weaponRes.potential.pdps).toBe(780);
    });

    it('已污染且低於 20% 品質之防具不可再打磨品質，依現有品質計算', () => {
      const corruptedArmour: RawPoeItem = {
        realm: 'poe2',
        baseType: 'Hunter Hood',
        corrupted: true,
        sockets: [{ group: 0, type: 'rune' }],
        socketedItems: [],
        properties: [{ name: '[Evasion|Evasion Rating]', values: [['209', 1]], type: 17 }],
        explicitMods: [
          {
            description: '50% increased [Evasion|Evasion] Rating',
            hash: 'stat.explicit.stat_124859000',
          },
        ],
      };

      const res = normalizePoe2Item(corruptedArmour);
      if (res?.type !== 'armour') throw new Error('Expected armour');
      expect(res.current.evasion).toBe(209);
      // 已污染不可補品質、已有 1 孔覆寫 +20%: 209 * 1.70 / 1.50 = 237
      expect(res.potential.evasion).toBe(237);
    });
  });

  describe('Bonded prefix filtering & Talisman slot detection', () => {
    it('resolveEquipmentSlot 將 category.weapons 包含 talisman 識別為 two_hand_weapon', () => {
      expect(
        resolveEquipmentSlot({
          realm: 'poe2',
          category: { weapons: ['talisman'] },
        }),
      ).toBe('two_hand_weapon');
    });

    it('extractIncPhysPercent 在比對 hash 前應排除 Bonded: / 命定: 行，避免誤認命定物理增傷為符文增傷', () => {
      const talismanWithBonded: RawPoeItem = {
        realm: 'poe2',
        category: { weapons: ['talisman'] },
        baseType: 'Primal Talisman',
        sockets: [
          { group: 0, type: 'rune' },
          { group: 1, type: 'rune' },
        ],
        socketedItems: [{}, {}],
        properties: [
          { name: 'Quality', values: [['+20%', 1]], type: 6 },
          { name: 'Attacks per Second', values: [['1.50', 0]], type: 13 },
          { name: '[Physical|Physical Damage]', values: [['100-200', 1]], type: 9 },
        ],
        explicitMods: [{ description: '100% increased [Physical|Physical] Damage' }],
        // 模擬實際 API 回傳：同一條 mod 的 raw string 帶有 Bonded 前綴與符文物理 hash
        runeMods: [
          {
            description: '[ShamanOnlyMods|Bonded]: 30% increased [Physical|Physical] Damage',
            hash: 'stat.rune.stat_1509134228',
          },
        ],
        extended: {
          dps: 450,
          pdps: 450,
          edps: 0,
        },
      };

      const res = normalizePoe2Item(talismanWithBonded, {
        weaponRune: { type: 'phys_percent', value: 20 },
        armourRune: { type: 'def_percent', value: 20 },
      });
      if (res?.type !== 'weapon') throw new Error('Expected weapon');
      // Bonded 行不可被當成 +30% 符文物傷扣除，否則淨物傷會被低估
      expect(res.runeModifiers.incPhysPercent).toBe(0);
      // 武器品質在 PoE2 為獨立乘區且已為 +20%；雙手 2 孔各插 20% 符文 -> 潛力物傷倍率 = (1 + 1.0 + 0.4) / (1 + 1.0) = 2.4 / 2.0
      expect(res.potential.pdps).toBe(Math.round((450 * 2.4) / 2.0));
    });
  });
});
