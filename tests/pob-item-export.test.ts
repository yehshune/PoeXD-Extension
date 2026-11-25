import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { createPobItemExporter, type PobItemExporterDeps } from '@/utils/pob-item-export';
import { resolveEnglishItemName } from '@/utils/pob-item-text';
import { createPobTextLexicon, loadPobTextLexicon } from '@/utils/pob-text-lexicon';
import { buildPoedbUrl } from '@/utils/result-external-links';

const RARE_ITEM = {
  name: 'Golem Veil',
  baseType: 'Crimson Raiment',
  rarity: 'Rare',
  ilvl: 48,
  explicitMods: [
    { description: '+74 to maximum Life', domain: 'explicit', hash: 'stat.explicit.stat_1' },
  ],
};

const TW_ITEM = {
  name: '蛇牙 慧齒',
  baseType: '靈石法杖',
  rarity: 'Rare',
  explicitMods: [
    { description: '+37 最大魔力', domain: 'explicit', hash: 'stat.explicit.stat_1050105434' },
  ],
};

const twLexicon = createPobTextLexicon({
  modLines: {},
  englishItems: ['Opal Wand', "Kalandra's Touch"],
  localizedItems: ['靈石法杖', '卡蘭德之觸'],
});

describe('createPobItemExporter', () => {
  let deps: { [K in keyof PobItemExporterDeps]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setActiveDisplayLocalePreference('zh-TW');
    deps = {
      getPageLocale: vi.fn().mockReturnValue('en'),
      loadLexicon: vi.fn().mockResolvedValue(twLexicon),
      writeClipboard: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
    };
  });

  it('英文物品直接複製，不載入字典', async () => {
    const exporter = createPobItemExporter('poe1', deps as unknown as PobItemExporterDeps);
    await exporter.copyItem(RARE_ITEM);

    expect(deps.loadLexicon).not.toHaveBeenCalled();
    expect(deps.writeClipboard).toHaveBeenCalledWith(
      [
        'Rarity: RARE',
        'Golem Veil',
        'Crimson Raiment',
        'Item Level: 48',
        'Implicits: 0',
        '+74 to maximum Life',
      ].join('\n'),
    );
    expect(deps.notify).toHaveBeenCalledWith('已複製 PoB 物品文字', 'success');
  });

  it('在地化頁面載入並快取字典（僅載入一次），並提示無法轉換的詞綴數量', async () => {
    deps.getPageLocale.mockReturnValue('zh-TW');
    const exporter = createPobItemExporter('poe1', deps as unknown as PobItemExporterDeps);

    await exporter.copyItem(TW_ITEM);
    await exporter.copyItem(TW_ITEM);

    expect(deps.loadLexicon).toHaveBeenCalledTimes(1);
    expect(deps.loadLexicon).toHaveBeenCalledWith('poe1', 'zh-TW');
    expect(deps.writeClipboard.mock.calls[0][0]).toContain('Opal Wand');
    expect(deps.notify).toHaveBeenLastCalledWith(
      '已複製 PoB 物品文字（1 行詞綴無法轉成英文）',
      'success',
    );
  });

  it('該語系沒有字典時不複製並發送不支援語系通知', async () => {
    deps.getPageLocale.mockReturnValue('ru');
    deps.loadLexicon.mockRejectedValue(new Error('HTTP 404'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const exporter = createPobItemExporter('poe1', deps as unknown as PobItemExporterDeps);

    await exporter.copyItem(TW_ITEM);

    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(
      '此頁面語系尚不支援轉成英文 PoB 文字（目前支援英文、繁體中文、簡體中文）',
      'error',
    );
    warn.mockRestore();
  });

  it('不可匯出的物品或剪貼簿寫入失敗時回報錯誤', async () => {
    const exporter = createPobItemExporter('poe1', deps as unknown as PobItemExporterDeps);

    await exporter.copyItem({ typeLine: 'Chaos Orb', frameType: 5 });
    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenLastCalledWith(
      expect.stringContaining('找不到這筆結果的物品資料'),
      'error',
    );

    deps.writeClipboard.mockRejectedValueOnce(new Error('denied'));
    await exporter.copyItem(RARE_ITEM);
    expect(deps.notify).toHaveBeenLastCalledWith('複製 PoB 物品文字失敗：denied', 'error');
  });

  it('resolveEnglishName 可在英文與在地化頁面反查英文名稱，並於缺少字典時回傳 null', async () => {
    const exporter = createPobItemExporter('poe1', deps as unknown as PobItemExporterDeps);

    expect(await exporter.resolveEnglishName(RARE_ITEM, 'en')).toBe('Crimson Raiment');
    expect(deps.loadLexicon).not.toHaveBeenCalled();

    expect(await exporter.resolveEnglishName(TW_ITEM, 'zh-TW')).toBe('Opal Wand');
    expect(deps.loadLexicon).toHaveBeenCalledTimes(1);

    exporter.clearCache();
    deps.loadLexicon.mockRejectedValueOnce(new Error('HTTP 404'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await exporter.resolveEnglishName(TW_ITEM, 'ru')).toBeNull();
    warn.mockRestore();
  });
});

describe('buildPoedbUrl & resolveEnglishItemName', () => {
  it('英文名去撇號、空白換底線，語系依介面語言', () => {
    expect(buildPoedbUrl("Atziri's Acuity", { version: 'poe1', uiLocale: 'en' })).toBe(
      'https://poedb.tw/us/Atziris_Acuity',
    );
    expect(buildPoedbUrl('Opal Wand', { version: 'poe1', uiLocale: 'zh-TW' })).toBe(
      'https://poedb.tw/tw/Opal_Wand',
    );
    expect(buildPoedbUrl('Ascetic Garb', { version: 'poe2', uiLocale: 'zh-CN' })).toBe(
      'https://poe2db.tw/cn/Ascetic_Garb',
    );
    expect(buildPoedbUrl('Maelström Staff', { version: 'poe1', uiLocale: 'en' })).toBe(
      'https://poedb.tw/us/Maelstr%C3%B6m_Staff',
    );
  });

  it('傳奇用傳奇名稱，其餘用基底；在地化頁面查不到回傳 null', () => {
    expect(
      resolveEnglishItemName({ name: "Atziri's Acuity", baseType: 'Vaal Gauntlets', frameType: 3 }),
    ).toBe("Atziri's Acuity");
    expect(resolveEnglishItemName({ typeLine: '[Rune|Iron Rune]', frameType: 5 })).toBe(
      'Iron Rune',
    );
    expect(
      resolveEnglishItemName(
        { name: '卡蘭德之觸', baseType: '靈石法杖', rarity: 'Unique' },
        twLexicon,
      ),
    ).toBe("Kalandra's Touch");
    expect(resolveEnglishItemName({ baseType: '不存在', rarity: 'Rare' }, twLexicon)).toBeNull();
  });
});

describe('loadPobTextLexicon：隨擴充發佈的資料分片', () => {
  const loadJson = async (path: string) =>
    JSON.parse(await readFile(resolve(__dirname, '../public', path), 'utf8')) as unknown;

  it('PoE 1 台服的詞綴與基底可轉回英文', async () => {
    const lexicon = await loadPobTextLexicon(loadJson, { version: 'poe1', locale: 'zh-TW' });
    expect(lexicon.toEnglishModLine('附加 65 至 119 冰冷傷害', '1037193709')).toBe(
      'Adds 65 to 119 Cold Damage',
    );
    expect(lexicon.toEnglishModLine('增加 8% 攻擊速度', '210067635')).toBe(
      '8% increased Attack Speed',
    );
    expect(lexicon.toEnglishNames('靈石法杖')).toEqual(['Opal Wand']);
  });

  it('PoE 2 台服的詞綴與基底可轉回英文', async () => {
    const lexicon = await loadPobTextLexicon(loadJson, { version: 'poe2', locale: 'zh-TW' });
    expect(lexicon.toEnglishModLine('增加29%閃避和能量護盾', '1999113824')).toBe(
      '29% increased Evasion and Energy Shield',
    );
    expect(lexicon.toEnglishNames('苦行者裝束')).toEqual(['Ascetic Garb']);
  });

  it('沒有 mod-lines 的語系載入失敗', async () => {
    await expect(loadPobTextLexicon(loadJson, { version: 'poe1', locale: 'ru' })).rejects.toThrow();
  });
});
