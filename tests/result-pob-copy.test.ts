// @vitest-environment happy-dom
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_POB_COPY_BUTTON_CLASS,
  ResultPobCopy,
  type ResultPobCopyDeps,
} from '@/entrypoints/content/logic/result-pob-copy';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { createPobTextLexicon, loadPobTextLexicon } from '@/utils/pob-text-lexicon';

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

const fetchDetail = (entries: Array<{ id: string; item: unknown }>) =>
  JSON.stringify({
    url: 'https://www.pathofexile.com/api/trade/fetch/a,b?query=abc',
    data: { result: entries },
  });

function mountRows(ids: string[]): HTMLElement {
  document.body.innerHTML = `<div class="results">${ids
    .map(
      (id) =>
        `<div class="row" data-id="${id}"><div class="left"></div><div class="middle"></div></div>`,
    )
    .join('')}</div>`;
  return document.querySelector('.results') as HTMLElement;
}

const buttons = () => Array.from(document.querySelectorAll(`.${RESULT_POB_COPY_BUTTON_CLASS}`));

describe('ResultPobCopy', () => {
  let deps: { [K in keyof ResultPobCopyDeps]: ReturnType<typeof vi.fn> };
  let pobCopy: ResultPobCopy;

  beforeEach(() => {
    setActiveDisplayLocalePreference('zh-TW');
    deps = {
      getPageLocale: vi.fn().mockReturnValue('en'),
      loadLexicon: vi.fn(),
      writeClipboard: vi.fn().mockResolvedValue(undefined),
      notify: vi.fn(),
    };
    pobCopy = new ResultPobCopy('poe1', deps as unknown as ResultPobCopyDeps);
  });

  afterEach(() => {
    pobCopy.cleanup();
    document.body.innerHTML = '';
  });

  it('只在有可匯出物品資料的卡片圖片欄加入按鈕，且不重複加入', () => {
    const root = mountRows(['rare', 'currency', 'unknown']);
    pobCopy.setEnabled(true);
    pobCopy.handleFetchResponse(
      fetchDetail([
        { id: 'rare', item: RARE_ITEM },
        { id: 'currency', item: { typeLine: 'Chaos Orb', frameType: 5 } },
      ]),
    );
    pobCopy.apply(root);

    expect(buttons()).toHaveLength(1);
    expect(buttons()[0].parentElement?.className).toBe('left');
    expect(buttons()[0].closest('.row')?.getAttribute('data-id')).toBe('rare');
  });

  it('停用時不加入按鈕，停用後移除已加入的按鈕', () => {
    const root = mountRows(['rare']);
    pobCopy.handleFetchResponse(fetchDetail([{ id: 'rare', item: RARE_ITEM }]));
    pobCopy.apply(root);
    expect(buttons()).toHaveLength(0);

    pobCopy.setEnabled(true);
    expect(buttons()).toHaveLength(1);
    pobCopy.setEnabled(false);
    expect(buttons()).toHaveLength(0);
  });

  it('英文頁面點擊後直接複製，不載入字典', async () => {
    mountRows(['rare']);
    pobCopy.setEnabled(true);
    pobCopy.handleFetchResponse(fetchDetail([{ id: 'rare', item: RARE_ITEM }]));

    (buttons()[0] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(deps.notify).toHaveBeenCalled());

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

  it('在地化頁面用字典轉成英文，字典只載入一次，並提示轉不了的部分', async () => {
    deps.getPageLocale.mockReturnValue('zh-TW');
    deps.loadLexicon.mockResolvedValue(
      createPobTextLexicon({
        modLines: {},
        englishItems: ['Opal Wand'],
        localizedItems: ['靈石法杖'],
      }),
    );
    pobCopy.handleFetchResponse(fetchDetail([{ id: 'tw', item: TW_ITEM }]));

    await pobCopy.copy('tw');
    await pobCopy.copy('tw');

    expect(deps.loadLexicon).toHaveBeenCalledTimes(1);
    expect(deps.loadLexicon).toHaveBeenCalledWith('poe1', 'zh-TW');
    expect(deps.writeClipboard.mock.calls[0][0]).toContain('Opal Wand');
    expect(deps.notify).toHaveBeenLastCalledWith(
      '已複製 PoB 物品文字（1 行詞綴無法轉成英文）',
      'success',
    );
  });

  it('該語系沒有字典時不複製並說明原因', async () => {
    deps.getPageLocale.mockReturnValue('ru');
    deps.loadLexicon.mockRejectedValue(new Error('HTTP 404'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    pobCopy.handleFetchResponse(fetchDetail([{ id: 'tw', item: TW_ITEM }]));

    await pobCopy.copy('tw');

    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(
      '此頁面語系尚不支援轉成英文 PoB 文字（目前支援英文、繁體中文、簡體中文）',
      'error',
    );
    warn.mockRestore();
  });

  it('剪貼簿寫入失敗時回報錯誤', async () => {
    deps.writeClipboard.mockRejectedValue(new Error('denied'));
    pobCopy.handleFetchResponse(fetchDetail([{ id: 'rare', item: RARE_ITEM }]));

    await pobCopy.copy('rare');

    expect(deps.notify).toHaveBeenCalledWith('複製 PoB 物品文字失敗：denied', 'error');
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
