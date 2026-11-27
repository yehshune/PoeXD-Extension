import { describe, expect, it } from 'vitest';
import poe1Stats from '@/public/json/poe1/locales/en/trade-stats.json';
import poe2Stats from '@/public/json/poe2/locales/en/trade-stats.json';
import poe1Chest from './fixtures/similar-item-search/poe1-chest.json';
import poe1Weapon from './fixtures/similar-item-search/poe1-weapon.json';
import poe2Chest from './fixtures/similar-item-search/poe2-chest.json';
import poe2Weapon from './fixtures/similar-item-search/poe2-weapon.json';
import {
  createSimilarSearchDraft,
  setPropertyEnabled,
  setPropertyThreshold,
  setStatDomain,
  setStatRole,
  setStatThreshold,
  setTolerance,
  setWeaponMode,
  type SimilarSearchContext,
  type SimilarSearchDraft,
} from '@/utils/similar-item-search';
import type { PoeVersion } from '@/utils/trade-context';

const statsOf = { poe1: poe1Stats.stats, poe2: poe2Stats.stats } as const;

/** 同一個代碼有多種寫法時，市集資料是陣列；取第一種 */
function englishStatTextOf(version: PoeVersion) {
  const stats = statsOf[version] as Record<string, string | string[]>;
  return (statId: string): string | undefined => {
    const text = stats[statId];
    return Array.isArray(text) ? text[0] : text;
  };
}

function contextFor(
  version: PoeVersion,
  overrides: Partial<SimilarSearchContext> = {},
): SimilarSearchContext {
  return {
    version,
    englishStatText: englishStatTextOf(version),
    ...overrides,
  };
}

const iconFor = (path: string): string =>
  `https://web.poecdn.com/gen/image/${Buffer.from(
    JSON.stringify([25, 14, { f: `2DItems/${path}`, w: 1, h: 1, scale: 1 }]),
  ).toString('base64')}/x/icon.png`;

describe('createSimilarSearchDraft：哪些物品可以找相似', () => {
  it('從 icon 的美術路徑判斷市集類別（與伺服器語言無關）', () => {
    expect(createSimilarSearchDraft(poe1Weapon, contextFor('poe1'))?.category).toBe(
      'weapon.onesword',
    );
    expect(createSimilarSearchDraft(poe1Chest, contextFor('poe1'))?.category).toBe('armour.chest');
    expect(createSimilarSearchDraft(poe2Weapon, contextFor('poe2'))?.category).toBe(
      'weapon.onemace',
    );
    expect(createSimilarSearchDraft(poe2Chest, contextFor('poe2'))?.category).toBe('armour.chest');
  });

  it('傳奇、藥劑與無法辨識類別的物品不提供找相似', () => {
    expect(
      createSimilarSearchDraft(
        { ...poe1Weapon, rarity: 'Unique', frameType: 3 },
        contextFor('poe1'),
      ),
    ).toBeNull();
    expect(
      createSimilarSearchDraft(
        { ...poe1Weapon, icon: iconFor('Flasks/lifeflask1') },
        contextFor('poe1'),
      ),
    ).toBeNull();
    expect(
      createSimilarSearchDraft(
        { ...poe1Weapon, icon: 'https://example.com/x.png' },
        contextFor('poe1'),
      ),
    ).toBeNull();
  });

  it('戒指、項鍊、腰帶與珠寶都可以找相似', () => {
    const cases: [string, PoeVersion, string][] = [
      ['Rings/Ring1', 'poe1', 'accessory.ring'],
      ['Amulets/Basetypes/Amulet1', 'poe2', 'accessory.amulet'],
      ['Belts/Belt1', 'poe1', 'accessory.belt'],
      ['Jewels/basicstr', 'poe1', 'jewel'],
      ['Weapons/TwoHandWeapons/WarStaves/Staff1', 'poe2', 'weapon.warstaff'],
    ];
    for (const [path, version, category] of cases) {
      const item = { ...poe1Chest, icon: iconFor(path), properties: [], extended: {} };
      expect(createSimilarSearchDraft(item, contextFor(version))?.category).toBe(category);
    }
  });
});

type ModEntry = Record<string, unknown>;
const mod = (
  description: string,
  hash: string,
  domain: string,
  tier?: string,
  magnitudes: { min: string; max: string }[] = [{ min: '1', max: '1' }],
): ModEntry => ({
  description,
  domain,
  hash: `stat.${hash}`,
  mods: [{ ...(tier ? { name: 'X', tier } : {}), magnitudes }],
});

const statOf = (draft: ReturnType<typeof createSimilarSearchDraft>, key: string) =>
  draft?.stats.find((stat) => stat.key === key);

describe('createSimilarSearchDraft：stat 的預設角色與門檻', () => {
  it('T1–T3 是參考、其餘忽略，沒有任何必要條件；門檻是數值的 80% 無條件捨去', () => {
    const draft = createSimilarSearchDraft(poe1Weapon, contextFor('poe1'));
    expect(draft?.stats.map(({ key, role, threshold }) => [key, role, threshold])).toEqual([
      ['implicit.stat_3556824919', 'ignored', 20],
      ['explicit.stat_829382474', 'reference', 1],
      ['explicit.stat_1509134228', 'ignored', 84],
      ['explicit.stat_1940865751', 'ignored', 8],
      ['explicit.stat_821021828', 'ignored', 6],
      ['explicit.stat_2517001139', 'reference', 22],
    ]);
    expect(statOf(draft, 'explicit.stat_1940865751')).toMatchObject({ value: 10.5, tier: 7 });
  });

  it('PoE 2：小數保留一位、屬性併成 pseudo 總和並沿用最好的階級', () => {
    const draft = createSimilarSearchDraft(poe2Weapon, contextFor('poe2'));
    expect(statOf(draft, 'explicit.stat_518292764')).toMatchObject({
      text: '+4.66% to Critical Hit Chance',
      value: 4.66,
      role: 'reference',
      threshold: 3.7,
    });
    expect(statOf(draft, 'pseudo.pseudo_total_strength')).toMatchObject({
      value: 30,
      tier: 2,
      role: 'reference',
      threshold: 24,
      pseudo: true,
    });
    expect(statOf(draft, 'explicit.stat_4080418644')).toBeUndefined();
  });

  it('工藝、破裂、褻瀆詞綴預設以 explicit 搜尋，可縮小到該型態；工藝詞預設參考', () => {
    const weapon = {
      ...poe1Weapon,
      explicitMods: [
        mod('105% increased Physical Damage', 'fractured.stat_1509134228', 'fractured', 'P5'),
        mod('28% increased Stun Duration on Enemies', 'explicit.stat_2517001139', 'crafted'),
      ],
    };
    const draft = createSimilarSearchDraft(weapon, contextFor('poe1'));
    expect(statOf(draft, 'explicit.stat_1509134228')).toMatchObject({
      id: 'explicit.stat_1509134228',
      role: 'ignored',
      domain: 'any',
      domains: ['any', 'fractured'],
    });
    expect(statOf(draft, 'explicit.stat_2517001139')).toMatchObject({
      role: 'reference',
      domains: ['any', 'crafted'],
    });

    const chest = {
      ...poe2Chest,
      explicitMods: [],
      desecratedMods: [
        mod('+61 to maximum Life', 'desecrated.stat_3299347043', 'desecrated', 'P1'),
      ],
    };
    expect(
      statOf(createSimilarSearchDraft(chest, contextFor('poe2')), 'pseudo.pseudo_total_life'),
    ).toMatchObject({ value: 61, role: 'reference' });
  });

  it('生命、抗性含基底與複合詞併成 pseudo 總和；只有基底貢獻時不當參考', () => {
    const chest = {
      ...poe1Chest,
      implicitMods: [
        mod('+20 to maximum Life', 'implicit.stat_3299347043', 'implicit'),
        mod('+10% to all Elemental Resistances', 'implicit.stat_2901986750', 'implicit'),
      ],
      explicitMods: [
        mod('+90 to maximum Life', 'explicit.stat_3299347043', 'explicit', 'P2'),
        mod('+30% to Fire Resistance', 'explicit.stat_3372524247', 'explicit', 'S5'),
        mod('+12% to Fire and Cold Resistances', 'explicit.stat_2915988346', 'explicit', 'S6'),
      ],
    };
    const draft = createSimilarSearchDraft(chest, contextFor('poe1'));
    expect(draft?.stats.map((stat) => stat.key)).toEqual([
      'pseudo.pseudo_total_life',
      'pseudo.pseudo_total_elemental_resistance',
    ]);
    expect(statOf(draft, 'pseudo.pseudo_total_life')).toMatchObject({
      value: 110,
      tier: 2,
      role: 'reference',
      threshold: 88,
      text: '+20 to maximum Life / +90 to maximum Life',
    });
    expect(statOf(draft, 'pseudo.pseudo_total_elemental_resistance')).toMatchObject({
      value: 84,
      role: 'ignored',
    });
  });

  it('沒有數字的詞綴也列出，只要求存在', () => {
    const chest = {
      ...poe1Chest,
      explicitMods: [mod('Cannot be Frozen', 'explicit.stat_876831634', 'explicit', 'S1')],
    };
    expect(
      statOf(createSimilarSearchDraft(chest, contextFor('poe1')), 'explicit.stat_876831634'),
    ).toMatchObject({ role: 'reference', value: 1 });
  });

  it('舊版字串詞綴沒有階級：照樣合併 pseudo，但不當參考', () => {
    const chest = {
      ...poe1Chest,
      explicitMods: ['+90 to maximum Life', '47% increased Evasion Rating'],
      extended: {
        ev: 709,
        hashes: {
          explicit: [
            ['explicit.stat_3299347043', [0]],
            ['explicit.stat_124859000', [1]],
          ],
        },
      },
    };
    const draft = createSimilarSearchDraft(chest, contextFor('poe1'));
    expect(draft?.stats.map(({ key, value, role }) => [key, value, role])).toEqual([
      ['pseudo.pseudo_total_life', 90, 'ignored'],
      ['explicit.stat_124859000', 47, 'ignored'],
    ]);
  });

  it('附魔與符文不參考；販售狀態跟著頁面、沒有時為直購', () => {
    const weapon = {
      ...poe1Weapon,
      enchantMods: [mod('10% increased Attack Speed', 'enchant.stat_210067635', 'enchant')],
    };
    const draft = createSimilarSearchDraft(weapon, contextFor('poe1', { status: 'available' }));
    expect(statOf(draft, 'enchant.stat_210067635')?.role).toBe('ignored');
    expect(draft?.status).toBe('available');
    expect(createSimilarSearchDraft(poe1Weapon, contextFor('poe1'))?.status).toBe('securable');
  });
});

describe('草稿調整：容忍度與單行覆寫', () => {
  const draftOf = (): SimilarSearchDraft => {
    const draft = createSimilarSearchDraft(poe2Weapon, contextFor('poe2'));
    if (!draft) throw new Error('no draft');
    return draft;
  };

  it('容忍度重算所有門檻，使用者改過的那行不跟著變', () => {
    const edited = setStatThreshold(draftOf(), 'pseudo.pseudo_total_strength', 28);
    const loosened = setTolerance(edited, 50);
    expect(loosened.tolerance).toBe(50);
    expect(statOf(loosened, 'explicit.stat_518292764')?.threshold).toBe(2.3);
    expect(statOf(loosened, 'explicit.stat_748522257')?.threshold).toBe(10);
    expect(statOf(loosened, 'pseudo.pseudo_total_strength')).toMatchObject({
      threshold: 28,
      customized: true,
    });
  });

  it('容忍度限制在 50–100；清空門檻代表不設', () => {
    expect(setTolerance(draftOf(), 30).tolerance).toBe(50);
    expect(setTolerance(draftOf(), 120).tolerance).toBe(100);
    const cleared = setStatThreshold(draftOf(), 'explicit.stat_518292764', undefined);
    expect(statOf(cleared, 'explicit.stat_518292764')?.threshold).toBeUndefined();
  });

  it('鎖定成必要、改成忽略；調整不改動原本的草稿', () => {
    const original = draftOf();
    const locked = setStatRole(original, 'explicit.stat_3336890334', 'required');
    expect(statOf(locked, 'explicit.stat_3336890334')?.role).toBe('required');
    expect(statOf(original, 'explicit.stat_3336890334')?.role).toBe('ignored');
  });

  it('縮小型態時改用該型態的 stat 代碼，不在選項內的型態不接受', () => {
    const weapon = {
      ...poe1Weapon,
      explicitMods: [
        mod('105% increased Physical Damage', 'fractured.stat_1509134228', 'fractured', 'P1'),
      ],
    };
    const draft = createSimilarSearchDraft(weapon, contextFor('poe1'));
    if (!draft) throw new Error('no draft');
    const narrowed = setStatDomain(draft, 'explicit.stat_1509134228', 'fractured');
    expect(statOf(narrowed, 'explicit.stat_1509134228')).toMatchObject({
      domain: 'fractured',
      id: 'fractured.stat_1509134228',
    });
    const back = setStatDomain(narrowed, 'explicit.stat_1509134228', 'any');
    expect(statOf(back, 'explicit.stat_1509134228')?.id).toBe('explicit.stat_1509134228');
    expect(setStatDomain(draft, 'explicit.stat_1509134228', 'crafted')).toBe(draft);
  });
});

const propertiesOf = (draft: SimilarSearchDraft | null) =>
  draft?.properties.map(({ id, value, enabled, threshold }) => [id, value, enabled, threshold]);

describe('createSimilarSearchDraft：武器與防具屬性', () => {
  it('武器依 DPS 組成預選比較方式；攻速與暴擊預設不帶', () => {
    const draft = createSimilarSearchDraft(poe2Weapon, contextFor('poe2'));
    expect(draft?.weaponMode).toBe('pdps');
    expect(propertiesOf(draft)).toEqual([
      ['dps', 138.48, false, 110],
      ['pdps', 117.45, true, 93],
      ['edps', 21.03, false, 16],
      ['damage', 95.5, false, 76],
      ['aps', 1.45, false, 1.1],
      ['crit', 9.66, false, 7.7],
    ]);
  });

  it('物理、元素各半時比總 DPS；沒有的傷害類型不列出；偏好可指定比較方式', () => {
    const mixed = { ...poe2Weapon, extended: { dps: 100, pdps: 50, edps: 50 } };
    expect(createSimilarSearchDraft(mixed, contextFor('poe2'))?.weaponMode).toBe('dps');
    const elemental = { ...poe2Weapon, extended: { dps: 100, pdps: 30, edps: 70 } };
    expect(createSimilarSearchDraft(elemental, contextFor('poe2'))?.weaponMode).toBe('edps');

    const physical = createSimilarSearchDraft(poe1Weapon, contextFor('poe1'));
    expect(physical?.properties.map((property) => property.id)).toEqual([
      'dps',
      'pdps',
      'damage',
      'aps',
      'crit',
    ]);
    const byHit = createSimilarSearchDraft(
      poe1Weapon,
      contextFor('poe1', { weaponMode: 'damage' }),
    );
    expect(byHit?.weaponMode).toBe('damage');
    expect(byHit?.properties.find((property) => property.enabled)).toMatchObject({
      id: 'damage',
      value: 138,
    });
  });

  it('偏好的比較方式在這把武器上沒有數值時退回自動判斷', () => {
    const draft = createSimilarSearchDraft(poe1Weapon, contextFor('poe1', { weaponMode: 'edps' }));
    expect(draft?.weaponMode).toBe('pdps');
  });

  it('防具帶入物品有的防禦（已含 20 品質）', () => {
    expect(propertiesOf(createSimilarSearchDraft(poe2Chest, contextFor('poe2')))).toEqual([
      ['ar', 253, true, 202],
      ['ev', 234, true, 187],
    ]);
    expect(propertiesOf(createSimilarSearchDraft(poe1Chest, contextFor('poe1')))).toEqual([
      ['ev', 709, true, 567],
    ]);
    expect(createSimilarSearchDraft(poe1Chest, contextFor('poe1'))?.weaponMode).toBeUndefined();
  });

  it('切換比較方式、開關屬性與自訂門檻', () => {
    const draft = createSimilarSearchDraft(poe2Weapon, contextFor('poe2'));
    if (!draft) throw new Error('no draft');
    const byTotal = setWeaponMode(draft, 'dps');
    expect(byTotal.weaponMode).toBe('dps');
    expect(byTotal.properties.filter((p) => p.enabled).map((p) => p.id)).toEqual(['dps']);
    expect(
      setWeaponMode(createSimilarSearchDraft(poe1Weapon, contextFor('poe1'))!, 'edps').weaponMode,
    ).toBe('pdps');

    const withSpeed = setPropertyEnabled(byTotal, 'aps', true);
    expect(withSpeed.properties.find((p) => p.id === 'aps')?.enabled).toBe(true);
    const custom = setTolerance(setPropertyThreshold(withSpeed, 'aps', 1.4), 50);
    expect(custom.properties.find((p) => p.id === 'aps')).toMatchObject({
      threshold: 1.4,
      customized: true,
    });
    expect(custom.properties.find((p) => p.id === 'dps')?.threshold).toBe(69);
  });
});
