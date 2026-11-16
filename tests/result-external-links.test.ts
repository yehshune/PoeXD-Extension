// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESULT_EXTERNAL_LINKS_CLASS,
  ResultExternalLinks,
  type ResultExternalLinksDeps,
  type ResultItemSource,
} from '@/entrypoints/content/logic/result-external-links';
import {
  RESULT_LEFT_ACTIONS_CLASS,
  mountLeftAction,
  removeLeftActions,
} from '@/entrypoints/content/logic/result-left-actions';
import { setActiveDisplayLocalePreference } from '@/utils/i18n';
import { resolveEnglishItemName } from '@/utils/pob-item-text';
import { createPobTextLexicon } from '@/utils/pob-text-lexicon';
import { buildPoedbUrl } from '@/utils/result-external-links';

const twLexicon = createPobTextLexicon({
  modLines: {},
  englishItems: ['Opal Wand', "Kalandra's Touch"],
  localizedItems: ['靈石法杖', '卡蘭德之觸'],
});

describe('buildPoedbUrl', () => {
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
  });

  it('非 ASCII 字元做百分比編碼', () => {
    expect(buildPoedbUrl('Maelström Staff', { version: 'poe1', uiLocale: 'en' })).toBe(
      'https://poedb.tw/us/Maelstr%C3%B6m_Staff',
    );
  });
});

describe('resolveEnglishItemName', () => {
  it('傳奇用傳奇名稱，其餘用基底；PoE 2 去掉標記', () => {
    expect(
      resolveEnglishItemName({ name: "Atziri's Acuity", baseType: 'Vaal Gauntlets', frameType: 3 }),
    ).toBe("Atziri's Acuity");
    expect(
      resolveEnglishItemName({ name: 'Doom Cloak', baseType: 'Ascetic Garb', rarity: 'Rare' }),
    ).toBe('Ascetic Garb');
    expect(resolveEnglishItemName({ typeLine: '[Rune|Iron Rune]', frameType: 5 })).toBe(
      'Iron Rune',
    );
  });

  it('在地化頁面查英文，查不到回傳 null', () => {
    expect(
      resolveEnglishItemName(
        { name: '卡蘭德之觸', baseType: '靈石法杖', rarity: 'Unique' },
        twLexicon,
      ),
    ).toBe("Kalandra's Touch");
    expect(
      resolveEnglishItemName({ name: '蛇牙', baseType: '靈石法杖', rarity: 'Rare' }, twLexicon),
    ).toBe('Opal Wand');
    expect(resolveEnglishItemName({ baseType: '不存在', rarity: 'Rare' }, twLexicon)).toBeNull();
  });
});

describe('ResultExternalLinks', () => {
  const items: Record<string, unknown> = {
    en: { name: 'Golem Veil', baseType: 'Crimson Raiment', rarity: 'Rare' },
    tw: { name: '蛇牙 慧齒', baseType: '靈石法杖', rarity: 'Rare' },
    unknown: { name: '某', baseType: '不存在', rarity: 'Rare' },
  };
  let deps: { [K in keyof ResultExternalLinksDeps]: ReturnType<typeof vi.fn> };
  let source: { getItem: ReturnType<typeof vi.fn>; getEnglishLexicon: ReturnType<typeof vi.fn> };
  let links: ResultExternalLinks;

  const mountRows = (ids: string[]) => {
    document.body.innerHTML = `<div class="results">${ids
      .map((id) => `<div class="row" data-id="${id}"><div class="left"></div></div>`)
      .join('')}</div>`;
    return document.querySelector('.results') as HTMLElement;
  };
  const strips = () => Array.from(document.querySelectorAll(`.${RESULT_EXTERNAL_LINKS_CLASS}`));

  beforeEach(() => {
    setActiveDisplayLocalePreference('zh-TW');
    deps = {
      getPageLocale: vi.fn().mockReturnValue('en'),
      openUrl: vi.fn(),
      notify: vi.fn(),
    };
    source = {
      getItem: vi.fn((id: string) => items[id]),
      getEnglishLexicon: vi.fn().mockResolvedValue(twLexicon),
    };
    links = new ResultExternalLinks(
      'poe1',
      source as unknown as ResultItemSource,
      deps as unknown as ResultExternalLinksDeps,
    );
  });

  afterEach(() => {
    links.cleanup();
    document.body.innerHTML = '';
  });

  it('只在有物品資料的卡片圖片欄加入 PoEDB 按鈕，停用後移除', () => {
    const root = mountRows(['en', 'missing']);
    links.apply(root);
    expect(strips()).toHaveLength(0);

    links.setEnabled(true);
    links.apply(root);
    expect(strips()).toHaveLength(1);
    expect(strips()[0].parentElement?.className).toBe(RESULT_LEFT_ACTIONS_CLASS);
    expect(strips()[0].parentElement?.parentElement?.className).toBe('left');
    expect(strips()[0].querySelectorAll('button')).toHaveLength(1);

    links.setEnabled(false);
    expect(strips()).toHaveLength(0);
    expect(document.querySelectorAll(`.${RESULT_LEFT_ACTIONS_CLASS}`)).toHaveLength(0);
  });

  it('英文頁面開啟 PoEDB，不載入字典', async () => {
    await links.openPoedb('en');
    expect(source.getEnglishLexicon).not.toHaveBeenCalled();
    expect(deps.openUrl).toHaveBeenCalledWith('https://poedb.tw/tw/Crimson_Raiment');
  });

  it('在地化頁面先把名稱轉成英文再開啟 PoEDB', async () => {
    deps.getPageLocale.mockReturnValue('zh-TW');
    await links.openPoedb('tw');
    expect(deps.openUrl).toHaveBeenCalledWith('https://poedb.tw/tw/Opal_Wand');
  });

  it('查不到英文名稱或沒有字典時不開啟並說明', async () => {
    deps.getPageLocale.mockReturnValue('zh-TW');
    await links.openPoedb('unknown');
    source.getEnglishLexicon.mockResolvedValue(undefined);
    await links.openPoedb('tw');

    expect(deps.openUrl).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.notify).toHaveBeenLastCalledWith('找不到此物品的英文名稱，無法開啟 PoEDB', 'error');
  });

  it('點擊按鈕開啟 PoEDB', async () => {
    mountRows(['en']);
    links.setEnabled(true);
    (strips()[0].querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(deps.openUrl).toHaveBeenCalled());
    expect(deps.openUrl).toHaveBeenCalledWith('https://poedb.tw/tw/Crimson_Raiment');
  });

  it('與其他左上角按鈕共用容器時，停用其中一個不影響另一個', () => {
    const root = mountRows(['en']);
    const row = root.querySelector('.row') as HTMLElement;
    const sibling = document.createElement('button');
    sibling.className = 'poexd-dummy-action';
    mountLeftAction(row, sibling);

    links.setEnabled(true);
    const leftActions = row.querySelectorAll(`.${RESULT_LEFT_ACTIONS_CLASS}`);
    expect(leftActions).toHaveLength(1);
    expect(leftActions[0].children).toHaveLength(2);

    links.setEnabled(false);
    expect(strips()).toHaveLength(0);
    expect(row.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`)).not.toBeNull();
    expect(document.getElementById('poexd-result-left-actions-style')).not.toBeNull();

    removeLeftActions('.poexd-dummy-action');
    expect(row.querySelector(`.${RESULT_LEFT_ACTIONS_CLASS}`)).toBeNull();
    expect(document.getElementById('poexd-result-left-actions-style')).toBeNull();
  });
});
