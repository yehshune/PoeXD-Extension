// @vitest-environment happy-dom
import { publishedLines } from './helpers/game-data-fixtures';
import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createLabelLookup } from '@/utils/market-result-labels';
import { createModLineTranslator } from '@/utils/pob-mod-translator';
import { createTradeNameCatalog } from '@/utils/pob-shopping-list';
import { getPobbinGameLabels } from '@/utils/pobbin-pob-terms';
import {
  createPobbinTranslator,
  extractPassiveNameMap,
  isPobbinAssetPath,
  loadPobbinTranslatorData,
  POBBIN_ORIGIN,
  POBBIN_TRANSLATION_SCRIPT_FILE,
  POBBIN_TRANSLATION_SCRIPT_ID,
  resolvePobbinTranslationConfig,
  startPobbinTranslation,
  syncPobbinTranslationContentScript,
  type PobbinTranslatorData,
  detectPobbinGameVersion,
} from '@/utils/pobbin-translator';

function makeTestTranslatorData(bilingual = true): PobbinTranslatorData {
  const englishItems = [
    'Reaver Axe',
    'Dawnbreaker',
    'Colossal Tower Shield',
    'Divine Life Flask',
    'Lethal Pride',
    'Timeless Jewel',
    'Herald of Ash',
    'Enlighten Support',
    'Static Strike',
    'Unwavering Stance',
  ];
  const localizedItems = [
    '殘暴之斧',
    '破曉',
    '巨型塔盾',
    '神聖生命藥劑',
    '致命之驕',
    '永恆珠寶',
    '灰燼之捷',
    '啟蒙輔助',
    '充能打擊',
    '烈士意志',
  ];
  const items: Record<string, string> = {};
  englishItems.forEach((en, i) => {
    items[en.toLowerCase()] = localizedItems[i];
  });

  const modLines = {
    '1001': [['{0:d}% increased Physical Damage', '增加 {0:d}% 物理傷害']] as const,
    '1002': [['{0:+d} to Dexterity and Intelligence', '{0:+d} 敏捷和智慧']] as const,
    '1003': [['{0:+d} to maximum Life', '{0:+d} 最大生命']] as const,
    '1004': [['{0:n}% reduced Mana Cost of Attacks', '減少 {0:n}% 攻擊的魔力消耗']] as const,
    '1005': [['Cannot be Stunned', '不會被暈眩']] as const,
    '1006': [['Gain {0:d} Rage on Hit with Axes', '以斧擊中時獲得 {0:d} 層盛怒']] as const,
    '1007': [['1 Added Passive Skill is Fuel the Fight', '1 個附加的天賦為刺激戰鬥']] as const,
    // 佔位符前帶有字面正號的句型（stat-text-items.json 的專精詞綴常見寫法）
    '1010': [
      [
        '+{0:d}% to Critical Strike Multiplier against Unique Enemies',
        '對傳奇敵人 +{0:d}% 暴擊加成',
      ],
    ] as const,
    // 多行詞綴：譯文行數相同（但語序不同）、譯文行數不同
    '1008': [
      [
        '{0:d}% of Elemental Damage from your Hits cannot be Reflected while\\naffected by Purity of Elements',
        '受到元素之純影響時\\n你擊中造成的元素傷害有 {0:d}% 不會被反射',
      ],
    ] as const,
    '1009': [
      [
        'You have Consecrated Ground around you while\\nstationary if Strength is your highest Attribute',
        '若力量是你最高的能力值，你靜止時周圍會有奉獻地面',
      ],
    ] as const,
  };

  const tradeStats = {
    english: {
      'enchant.stat_1': 'Allocates Exceptional Performance',
      'explicit.stat_2': 'Allocates Slayer if you have the matching modifier on Forbidden Flesh',
    },
    localized: {
      'enchant.stat_1': '配置 卓越的表現',
      'explicit.stat_2': '若禁忌血肉上有符合的詞綴，配置 處刑者',
    },
  };

  const labels = {
    ...getPobbinGameLabels('zh-TW'),
    Quality: '品質',
    'Quality:': '品質：',
    Armour: '護甲',
    'Armour:': '護甲：',
    Life: '生命',
    Mana: '魔力',
    DPS: '每秒造成傷害',
    Resistance: '抗性',
    'Critical Strike Chance': '暴擊率',
    'Pantheon:': '眾神殿：',
    'Soul of Lunaris': '月影神之魂',
    'Soul of Gruthkul': '葛魯斯寇之魂',
    Nessa: '奈莎',
    "The Siren's Cadence": '海妖之歌',
  };

  const templates: Array<[string, string]> = [
    ['Act {0}', '第 {0} 章'],
    ['Inflicts Mana Burn every {0} Seconds', '每 {0} 秒造成魔力灼燒'],
    ['{0} Second Cooldown when Deactivated', '解除時有 {0} 秒冷卻時間'],
  ];

  return {
    modTranslator: createModLineTranslator(modLines, {
      toLocalizedName: (en) => items[en.toLowerCase()],
      labels,
      tradeStats,
    }),
    labelLookup: createLabelLookup(labels, templates, items),
    catalog: createTradeNameCatalog({ englishItems, localizedItems }),
    items,
    passives: extractPassiveNameMap({ tradeStats, modLines: [modLines] }),
    bilingual,
  };
}

describe('resolvePobbinTranslationConfig', () => {
  it('市集漢化關閉時回傳 null', () => {
    expect(
      resolvePobbinTranslationConfig({
        stored: { marketTranslation: false, displayLocale: 'zh-TW' },
      }),
    ).toBeNull();
  });

  it('啟用市集漢化且顯示語言為繁中／簡中時回傳對應設定與雙語旗標', () => {
    expect(
      resolvePobbinTranslationConfig({
        stored: { marketTranslation: true, displayLocale: 'zh-TW' },
      }),
    ).toEqual({ locale: 'zh-TW', bilingual: true });

    expect(
      resolvePobbinTranslationConfig({
        stored: {
          marketTranslation: true,
          marketTranslationBilingual: false,
          displayLocale: 'auto',
        },
        browserLocale: 'zh-CN',
      }),
    ).toEqual({ locale: 'zh-CN', bilingual: false });
  });

  it('顯示語言不是中文時回傳 null', () => {
    expect(
      resolvePobbinTranslationConfig({
        stored: { marketTranslation: true, displayLocale: 'en' },
      }),
    ).toBeNull();
  });
});

describe('extractPassiveNameMap', () => {
  it('從 trade-stats 與 mod-lines 抽出塗油、昇華與星團天賦譯名', () => {
    const map = extractPassiveNameMap({
      tradeStats: {
        english: {
          a: 'Allocates Twin Terrors',
          b: 'Allocates Slayer if you have the matching modifier on Forbidden Flame',
        },
        localized: {
          a: '配置 雙生恐怖',
          b: '若禁忌烈焰上有符合的詞綴，配置 處刑者',
        },
      },
      modLines: [
        {
          h1: [['1 Added Passive Skill is Fuel the Fight', '1 個附加的天賦為刺激戰鬥']],
        },
      ],
    });
    expect(map).toEqual({
      'twin terrors': '雙生恐怖',
      slayer: '處刑者',
      'fuel the fight': '刺激戰鬥',
    });
  });
});

describe('createPobbinTranslator', () => {
  it('翻譯裝備懸浮框（含範圍數值、傳奇、魔法藥劑、永恆珠寶）與寶石、天賦並保留 build code 與筆記', async () => {
    document.body.innerHTML = `
      <main>
        <div data-route="">
          <div>
            <div class="inline-block"><span>Life</span><span>: </span><span>5,336</span></div>
            <div class="inline-block"><span>DPS</span><span>: </span><span>11,883,974</span></div>
            <textarea data-marker-content="">eNrtRawBuildCodeKeepUntouched</textarea>
          </div>
          <div>
            <div data-gem-id="Metadata/Items/Gems/SkillGemHeraldOfAsh">Herald of Ash</div>
            <div data-gem-id="Metadata/Items/Gems/SupportGemAdditionalXP">Enlighten</div>
            <div class="pointer-events-none">
              <div class="min-w-48">
                <div>Enlighten</div>
                <div>Quality:</div>
              </div>
            </div>
          </div>
          <div>
            <div data-node-id="40907"><span>Unwavering Stance</span></div>
            <div class="pointer-events-none">
              <div class="whitespace-pre-line">Cannot Evade enemy Attacks\nCannot be Stunned</div>
            </div>
            <ul>
              <li data-node-id="999">Gain 2 Rage on Hit with Axes</li>
            </ul>
          </div>
          <pre>General 3.29 Update: Static Strike notes stay in English</pre>
        </div>
      </main>
    `;

    const translator = createPobbinTranslator(makeTestTranslatorData(true));
    const stop = translator.observe(document);

    expect(
      Array.from(document.querySelectorAll('[data-gem-id]')).map((el) => el.textContent),
    ).toEqual(['灰燼之捷 (Herald of Ash)', '啟蒙輔助 (Enlighten)']);
    expect(document.querySelector('.min-w-48 > div:first-child')?.textContent).toBe(
      '啟蒙輔助 (Enlighten)',
    );
    expect(document.querySelector('div[data-node-id] > span')?.textContent).toBe(
      '烈士意志 (Unwavering Stance)',
    );
    expect(document.querySelector('.whitespace-pre-line')?.textContent).toBe(
      'Cannot Evade enemy Attacks\n不會被暈眩',
    );
    expect(document.querySelector('li[data-node-id]')?.textContent).toBe('以斧擊中時獲得 2 層盛怒');
    expect(
      Array.from(
        document.querySelectorAll('main [data-route] .inline-block > span:first-child'),
      ).map((el) => el.textContent),
    ).toEqual(['生命', '每秒造成傷害']);

    // 動態插入懸浮框（模擬滑鼠移到裝備上）
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="pob-item" data-rarity="Rare">
        <div><div>New Item</div><div>Reaver Axe</div></div>
        <div>
          <ul>
            <li><span>Quality (Life and Mana Modifiers):</span><span>+24%</span></li>
          </ul>
          <ul>
            <li>(100-129)% increased Physical Damage</li>
            <li>+(20-24) to Dexterity and Intelligence</li>
            <li>(21-22)% reduced Mana Cost of Attacks</li>
          </ul>
        </div>
      </div>
      <div class="pob-item" data-rarity="Magic">
        <div><div>Seething Divine Life Flask of Alleviation</div></div>
        <div>
          <ul>
            <li>Inflicts Mana Burn every 0,41 Seconds</li>
            <li>8 Second Cooldown when Deactivated</li>
          </ul>
        </div>
      </div>
      <div class="pob-item" data-rarity="Unique">
        <div><div>Lethal Pride 11057; 7; Duelist</div><div>Timeless Jewel</div></div>
        <div><ul><li>+(10-20) to maximum Life</li></ul></div>
      </div>
    `;
    document.body.appendChild(host);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const popups = Array.from(host.querySelectorAll('.pob-item'));
    expect(popups[0].querySelectorAll(':scope > div:first-child > div')[1].textContent).toBe(
      '殘暴之斧 (Reaver Axe)',
    );
    expect(popups[0].querySelector('ul:first-child span')?.textContent).toBe(
      '品質 (Life and Mana Modifiers):',
    );
    expect(
      Array.from(popups[0].querySelectorAll('ul:nth-child(2) > li')).map((li) => li.textContent),
    ).toEqual(['增加 (100-129)% 物理傷害', '+(20-24) 敏捷和智慧', '減少 (21-22)% 攻擊的魔力消耗']);

    expect(popups[1].querySelector(':scope > div:first-child > div')?.textContent).toBe(
      '神聖生命藥劑 (Seething Divine Life Flask of Alleviation)',
    );
    expect(Array.from(popups[1].querySelectorAll('ul > li')).map((li) => li.textContent)).toEqual([
      '每 0,41 秒造成魔力灼燒',
      '解除時有 8 秒冷卻時間',
    ]);

    expect(
      Array.from(popups[2].querySelectorAll(':scope > div:first-child > div')).map(
        (d) => d.textContent,
      ),
    ).toEqual(['致命之驕 (Lethal Pride) 11057; 7; Duelist', '永恆珠寶 (Timeless Jewel)']);

    expect(document.querySelector('textarea')?.value).toBe('eNrtRawBuildCodeKeepUntouched');
    expect(document.querySelector('pre')?.textContent).toBe(
      'General 3.29 Update: Static Strike notes stay in English',
    );

    stop();
  });

  it('多行詞綴：相鄰的 <li> 與懸浮框換行合併成一句翻譯', async () => {
    document.body.innerHTML = `
      <div class="pob-item" data-rarity="Unique">
        <div><div>Watcher's Eye</div><div>Prismatic Jewel</div></div>
        <div>
          <ul>
            <li>+(10-20) to maximum Life</li>
            <li>75% of Elemental Damage from your Hits cannot be Reflected while</li>
            <li>affected by Purity of Elements</li>
            <li>You have Consecrated Ground around you while</li>
            <li>stationary if Strength is your highest Attribute</li>
            <li>Cannot be Stunned</li>
          </ul>
        </div>
      </div>
      <div class="pointer-events-none">
        <div class="whitespace-pre-line">You have Consecrated Ground around you while\nstationary if Strength is your highest Attribute\nCannot be Stunned</div>
      </div>
    `;
    const translator = createPobbinTranslator(makeTestTranslatorData(true));
    const stop = translator.observe(document);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      Array.from(document.querySelectorAll('.pob-item li')).map((li) => li.textContent),
    ).toEqual([
      '+(10-20) 最大生命',
      '受到元素之純影響時',
      '你擊中造成的元素傷害有 75% 不會被反射',
      '若力量是你最高的能力值，你靜止時周圍會有奉獻地面',
      '',
      '不會被暈眩',
    ]);
    // 併入前一行而清空的 <li> 隱藏起來，不留空白列；其餘照常顯示
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.pob-item li')).map((li) => li.hidden),
    ).toEqual([false, false, false, false, true, false]);
    expect(document.querySelector('.whitespace-pre-line')?.textContent).toBe(
      '若力量是你最高的能力值，你靜止時周圍會有奉獻地面\n不會被暈眩',
    );
    stop();
  });

  it('多行合併：小數逗號（7,5）對不到時改成小數點再試', () => {
    document.body.innerHTML = `
      <div class="pob-item" data-rarity="Unique">
        <div><div>Watcher's Eye</div><div>Prismatic Jewel</div></div>
        <div>
          <ul>
            <li>7,5% of Elemental Damage from your Hits cannot be Reflected while</li>
            <li>affected by Purity of Elements</li>
          </ul>
        </div>
      </div>
    `;
    createPobbinTranslator(makeTestTranslatorData(true)).translate(document);

    expect(
      Array.from(document.querySelectorAll('.pob-item li')).map((li) => li.textContent),
    ).toEqual(['受到元素之純影響時', '你擊中造成的元素傷害有 7.5% 不會被反射']);
  });

  it('多行合併只在整組都翻得出來時採用，不把保留英文前綴的結果當成功（星團珠寶）', () => {
    document.body.innerHTML = `
      <div class="pob-item" data-rarity="Rare">
        <div><div>New Item</div><div>Large Cluster Jewel</div></div>
        <div>
          <ul>
            <li>Adds 8 Passive Skills</li>
            <li>1 Added Passive Skill is Fuel the Fight</li>
            <li>Added Small Passive Skills grant: 12% increased Physical Damage</li>
          </ul>
        </div>
      </div>
    `;
    createPobbinTranslator(makeTestTranslatorData(true)).translate(document);

    expect(
      Array.from(document.querySelectorAll('.pob-item li')).map((li) => li.textContent),
    ).toEqual([
      'Adds 8 Passive Skills',
      '1 個附加的天賦為刺激戰鬥',
      'Added Small Passive Skills grant: 增加 12% 物理傷害',
    ]);
  });

  it('相鄰兩行都帶可學出的前綴時（小型星團珠寶），多行合併不會互相吞併而破壞譯文', () => {
    const modLines = {
      '2001': [
        [
          'Added Small Passive Skills also grant: {0:+d} to All Attributes',
          '附加的小天賦給予：{0:+d} 全能力',
        ],
      ] as const,
      '2002': [
        [
          'Added Small Passive Skills also grant: {0:+d}% to all Elemental Resistances',
          '附加的小天賦給予：{0:+d}% 全部元素抗性',
        ],
      ] as const,
      '2003': [['{0:+d}% to all Elemental Resistances', '{0:+d}% 全部元素抗性']] as const,
      '2004': [
        [
          'Socketed Gems are Supported by Level {0:d} Enlighten',
          '插槽中的寶石被等級 {0:d} 的 啟蒙輔助 輔助',
        ],
      ] as const,
    };
    const items = {
      'enlighten support': '啟蒙輔助',
      'melee splash support': '近戰傷害擴散輔助',
    };
    const data: PobbinTranslatorData = {
      modTranslator: createModLineTranslator(modLines, {
        toLocalizedName: (en) => items[en.toLowerCase() as keyof typeof items],
      }),
      labelLookup: createLabelLookup({}, [], items),
      catalog: createTradeNameCatalog({ englishItems: [], localizedItems: [] }),
      items,
      bilingual: true,
    };
    document.body.innerHTML = `
      <div class="pob-item" data-rarity="Rare">
        <div><div>Carrion Scar</div><div>Small Cluster Jewel</div></div>
        <div>
          <ul>
            <li>Added Small Passive Skills also grant: +4 to All Attributes</li>
            <li>Added Small Passive Skills also grant: +5% to all Elemental Resistances</li>
            <li>Socketed Gems are supported by Level 16 Melee Splash</li>
          </ul>
        </div>
      </div>
    `;
    createPobbinTranslator(data).translate(document);

    expect(
      Array.from(document.querySelectorAll('.pob-item li')).map((li) => li.textContent),
    ).toEqual([
      '附加的小天賦給予：+4 全能力',
      '附加的小天賦給予：+5% 全部元素抗性',
      '插槽中的寶石被等級 16 的 近戰傷害擴散輔助 輔助',
    ]);
  });

  it('關閉雙語時名稱只顯示中文', () => {
    document.body.innerHTML = `
      <div data-gem-id="Metadata/Items/Gems/SkillGemStaticStrike">Static Strike</div>
      <div class="pob-item" data-rarity="Unique">
        <div><div>Dawnbreaker</div><div>Colossal Tower Shield</div></div>
        <div><ul><li>+(10-20) to maximum Life</li></ul></div>
      </div>
    `;
    const translator = createPobbinTranslator(makeTestTranslatorData(false));
    translator.translate(document);

    expect(document.querySelector('[data-gem-id]')?.textContent).toBe('充能打擊');
    expect(
      Array.from(document.querySelectorAll('.pob-item > div:first-child > div')).map(
        (d) => d.textContent,
      ),
    ).toEqual(['破曉', '巨型塔盾']);
  });

  it('翻譯 +{0:d} 專精詞綴、寶石懸浮框取得清單與眾神殿摘要', () => {
    document.body.innerHTML = `
      <main>
        <div data-route="">
          <div class="inline-block">
            <span>Pantheon</span><span>: </span><span><span>Soul of Lunaris, Soul of Gruthkul</span></span>
          </div>
          <div class="absolute z-30">
            <div>
              <div class="min-w-48">
                <div>Static Strike</div>
                <div>Quality:</div>
              </div>
              <div class="grid">
                <div>Act 1</div><div>Nessa</div><div>The Siren's Cadence</div>
              </div>
            </div>
          </div>
          <ul>
            <li data-node-id="123">+25% to Critical Strike Multiplier against Unique Enemies</li>
          </ul>
        </div>
      </main>
    `;
    createPobbinTranslator(makeTestTranslatorData(true)).translate(document);

    expect(document.querySelector('.inline-block > span:first-child')?.textContent).toBe('眾神殿');
    expect(document.querySelector('.inline-block > span:last-child')?.textContent).toBe(
      '月影神之魂、葛魯斯寇之魂',
    );
    expect(Array.from(document.querySelectorAll('.grid > div')).map((d) => d.textContent)).toEqual([
      '第 1 章',
      '奈莎',
      '海妖之歌',
    ]);
    expect(document.querySelector('li[data-node-id]')?.textContent).toBe(
      '對傳奇敵人 +25% 暴擊加成',
    );
  });

  it('翻譯 PoB 摘要統計、eHP 最大承傷、盜賊／Config 與永恆珠寶征服詞綴，且不碰網站介面', () => {
    document.body.innerHTML = `
      <main>
        <div data-route="">
          <div class="inline-block">
            <span>eHP</span><span>: </span><span>139,859</span>
            <div class="pointer-events-none">
              <div class="whitespace-pre-line"><span>Phys Max Hit</span><span>: 23,165\n</span><span>Chaos Max Hit</span><span>: 26,061</span></div>
            </div>
          </div>
          <div class="inline-block"><span>Resistances</span><span>: </span><span>78%/77%/77%/65%</span></div>
          <div class="inline-block"><span>ES</span><span>: </span><span>9,575</span></div>
          <div class="inline-block"><span>Evade</span><span>: </span><span>70%</span></div>
          <div class="inline-block"><span>Crit Chance</span><span>: </span><span>99%</span></div>
          <div class="inline-block"><span>Crit Multi</span><span>: </span><span>691%</span></div>
          <div class="inline-block"><span>Hit Rate</span><span>: </span><span>4.31</span></div>
          <div class="inline-block">
            <span>Config</span><span>: </span>
            <div class="contents"><span><span>10% Shock, Custom Mods</span></span></div>
            <div class="pointer-events-none"><span>Graft</span></div>
          </div>
          <div class="inline-block"><span>Bandit</span><span>: </span><span><span>Kill All</span></span></div>
          <h2>Loadout</h2>
          <button>Copy</button>
          <div class="pob-item" data-rarity="Unique">
            <div><div>Lethal Pride 11057; 7; Duelist</div><div>Timeless Jewel</div></div>
            <div><ul><li>Passives in radius are Conquered by the Karui</li></ul></div>
          </div>
        </div>
      </main>
    `;
    createPobbinTranslator(makeTestTranslatorData(true)).translate(document);

    const labels = Array.from(
      document.querySelectorAll('main [data-route] .inline-block > span:first-child'),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      '有效血量',
      '抗性',
      '能量護盾',
      '閃避率',
      '暴擊率',
      '暴擊加成',
      '擊中頻率',
      '配置',
      '盜賊',
    ]);
    expect(document.querySelector('.whitespace-pre-line')?.textContent).toBe(
      '物理最大承傷: 23,165\n混沌最大承傷: 26,061',
    );
    expect(document.querySelector('.inline-block .contents')?.textContent).toBe(
      '10% 感電、自訂詞綴',
    );
    expect(
      Array.from(document.querySelectorAll('main [data-route] .inline-block')).at(-1)
        ?.lastElementChild?.textContent,
    ).toBe('全部擊殺');
    expect(document.querySelector('.pob-item li')?.textContent).toBe('範圍內天賦被卡魯征服');
    // pobb.in 網站本身介面維持原樣
    expect(document.querySelector('h2')?.textContent).toBe('Loadout');
    expect(document.querySelector('button')?.textContent).toBe('Copy');
  });
});

describe('detectPobbinGameVersion', () => {
  const pobCode = (root: string) =>
    deflateSync(
      Buffer.from(
        `<?xml version="1.0"?><${root}><Build className="Ranger" level="90"/></${root}>`,
        'utf8',
      ),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const docWith = (...values: string[]) => {
    const doc = document.implementation.createHTMLDocument('');
    for (const value of values) {
      const textarea = doc.createElement('textarea');
      textarea.value = value;
      doc.body.append(textarea);
    }
    return doc;
  };

  it('從頁面上的 build code 判斷 PoE 1／PoE 2，略過不是 PoB 代碼的 textarea', async () => {
    expect(await detectPobbinGameVersion(docWith('notes', pobCode('PathOfBuilding2')))).toBe(
      'poe2',
    );
    expect(await detectPobbinGameVersion(docWith(pobCode('PathOfBuilding')))).toBe('poe1');
    expect(await detectPobbinGameVersion(docWith('not a code'))).toBeUndefined();
  });
});

describe('loadPobbinTranslatorData', () => {
  const passiveLines = (locale: string) =>
    publishedLines({
      [locale]: {
        '42': [['Maximum Life becomes 1, Immune to Chaos Damage', '最大生命變為 1，免疫混沌傷害']],
      },
    });
  const assets = (locale: string): Record<string, unknown> => ({
    'json/poe1/locales/en/mod-lines.json': publishedLines({ [locale]: {} }).en,
    [`json/poe1/locales/${locale}/mod-lines.json`]: publishedLines({ [locale]: {} })[locale],
    'json/poe1/locales/en/items.json': { items: ['Herald of Ash'] },
    [`json/poe1/locales/${locale}/items.json`]: { items: ['灰燼之捷'] },
    'json/poe1/locales/en/trade-stats.json': {
      stats: { 'enchant.stat_1': 'Allocates Exceptional Performance' },
    },
    [`json/poe1/locales/${locale}/trade-stats.json`]: {
      stats: { 'enchant.stat_1': '配置 卓越的表現' },
    },
    'json/poe1/locales/en/stat-text-passives.json': passiveLines(locale).en,
    [`json/poe1/locales/${locale}/stat-text-passives.json`]: passiveLines(locale)[locale],
    'json/poe1/locales/zh-TW/passive-names.json': {
      names: {
        'Chaos Inoculation': '異靈之體',
        'Exceptional Performance': '遊戲資料表譯名',
        'Life Mastery': '生命專精',
      },
    },
  });
  const loader = (files: Record<string, unknown>) => {
    const requested: string[] = [];
    const loadJson = async (path: string) => {
      requested.push(path);
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    };
    return { loadJson, requested };
  };

  it('載入天賦 stat 文字與天賦名稱表；市集對得到的天賦名優先', async () => {
    const { loadJson } = loader(assets('zh-TW'));
    const data = await loadPobbinTranslatorData(loadJson, {
      version: 'poe1',
      locale: 'zh-TW',
      bilingual: false,
    });
    expect(data.passives).toMatchObject({
      'chaos inoculation': '異靈之體',
      'life mastery': '生命專精',
      'exceptional performance': '卓越的表現',
    });
    expect(data.modTranslator.translate('Maximum Life becomes 1, Immune to Chaos Damage')).toBe(
      '最大生命變為 1，免疫混沌傷害',
    );
  });

  it('簡中不要求天賦名稱表（官方沒有簡中資料表）', async () => {
    const { loadJson, requested } = loader(assets('zh-CN'));
    const data = await loadPobbinTranslatorData(loadJson, {
      version: 'poe1',
      locale: 'zh-CN',
      bilingual: false,
    });
    expect(requested.some((path) => path.endsWith('passive-names.json'))).toBe(false);
    expect(data.passives).toEqual({ 'exceptional performance': '卓越的表現' });
  });

  it('pobb.in 可要求的資料檔包含天賦 stat 文字與天賦名稱表', () => {
    expect(isPobbinAssetPath('json/poe2/locales/zh-CN/stat-text-passives.json')).toBe(true);
    expect(isPobbinAssetPath('json/poe1/locales/zh-TW/passive-names.json')).toBe(true);
    expect(isPobbinAssetPath('json/poe1/locales/zh-TW/stat-text.json')).toBe(false);
  });
});

describe('startPobbinTranslation', () => {
  it('市集漢化停用時不載入分片也不建立監聽器', async () => {
    let loaded = false;
    const stop = await startPobbinTranslation({
      doc: document,
      browserLocale: 'zh-TW',
      readStorage: async () => ({ marketTranslation: false }),
      loadJson: async () => {
        loaded = true;
        return {};
      },
    });
    expect(stop).toBeNull();
    expect(loaded).toBe(false);
  });

  it('依選用權限狀態動態註冊與取消註冊 pobb.in 翻譯腳本', async () => {
    const scripting = {
      getRegisteredContentScripts: vi.fn(),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    };

    scripting.getRegisteredContentScripts.mockResolvedValueOnce([]);
    await syncPobbinTranslationContentScript({
      hasPermission: async () => true,
      scripting,
    });
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: POBBIN_TRANSLATION_SCRIPT_ID,
        matches: [POBBIN_ORIGIN],
        js: [POBBIN_TRANSLATION_SCRIPT_FILE],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);

    scripting.getRegisteredContentScripts.mockResolvedValueOnce([
      { id: POBBIN_TRANSLATION_SCRIPT_ID },
    ]);
    await syncPobbinTranslationContentScript({
      hasPermission: async () => false,
      scripting,
    });
    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: [POBBIN_TRANSLATION_SCRIPT_ID],
    });
  });
});
