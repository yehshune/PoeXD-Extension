import { describe, expect, it } from 'vitest';
import {
  tradeTextToModTemplate,
  translateModLine,
  type ModLinePairs,
} from '@/utils/market-mod-lines';

// 取自 PoE2 0.5.5.8 的 mod-lines.json（台服）
const ATTRIBUTE: ModLinePairs = [
  ['{0:d}% increased Attribute Requirements', '增加{0:d}%能力值需求'],
  ['{0:n}% reduced Attribute Requirements', '減少{0:n}%能力值需求'],
];
const ADDS: ModLinePairs = [['Adds {0:d} to {1:d} Physical Damage', '附加 {0:d} - {1:d} 物理傷害']];
const ACCURACY: ModLinePairs = [['{0:+d} to Accuracy Rating', '{0:+d} 命中值']];
const REGEN: ModLinePairs = [
  ['Allies in your Presence Regenerate {0:d} Life per second', '你光環中的友軍每秒恢復 {0:d} 生命'],
];
const ARROWS: ModLinePairs = [
  ['Bow Attacks fire an additional Arrow', '弓攻擊額外發射 1 支箭矢'],
  ['Bow Attacks fire {0:d} additional Arrows', '弓攻擊額外發射 {0:d} 支箭矢'],
];

describe('translateModLine', () => {
  it('英文句子決定變體（含負向），數值原樣填入譯文', () => {
    expect(translateModLine('27% increased Attribute Requirements', ATTRIBUTE)).toBe(
      '增加27%能力值需求',
    );
    expect(translateModLine('30% reduced Attribute Requirements', ATTRIBUTE)).toBe(
      '減少30%能力值需求',
    );
  });

  it('多個數值、小數與正負號', () => {
    expect(translateModLine('Adds 6 to 11 Physical Damage', ADDS)).toBe('附加 6 - 11 物理傷害');
    expect(translateModLine('Allies in your Presence Regenerate 16.9 Life per second', REGEN)).toBe(
      '你光環中的友軍每秒恢復 16.9 生命',
    );
    expect(translateModLine('+72 to Accuracy Rating', ACCURACY)).toBe('+72 命中值');
    expect(translateModLine('-5 to Accuracy Rating', ACCURACY)).toBe('-5 命中值');
  });

  it('英文與譯文的正負號格式不同時依譯文格式輸出', () => {
    const pairs: ModLinePairs = [['{0:+d} to Strength', '力量 {0:d}']];
    expect(translateModLine('+10 to Strength', pairs)).toBe('力量 10');
    const signed: ModLinePairs = [['{0:d} to Strength', '{0:+d} 力量']];
    expect(translateModLine('10 to Strength', signed)).toBe('+10 力量');
  });

  it('單複數等不同變體以整句比對區分', () => {
    expect(translateModLine('Bow Attacks fire an additional Arrow', ARROWS)).toBe(
      '弓攻擊額外發射 1 支箭矢',
    );
    expect(translateModLine('Bow Attacks fire 2 additional Arrows', ARROWS)).toBe(
      '弓攻擊額外發射 2 支箭矢',
    );
  });

  it('多行詞綴：模板中的 \\n 對應換行', () => {
    const pairs: ModLinePairs = [['Line {0:d}\\nSecond line', '第 {0:d} 行\\n第二行']];
    expect(translateModLine('Line 3\nSecond line', pairs)).toBe('第 3 行\n第二行');
  });

  it('比對不到或沒有資料時回傳 null', () => {
    expect(translateModLine('27% more Attribute Requirements', ATTRIBUTE)).toBeNull();
    expect(translateModLine('27% increased Attribute Requirements', undefined)).toBeNull();
    expect(translateModLine('', ATTRIBUTE)).toBeNull();
  });
});

describe('tradeTextToModTemplate（市集寫法備援）', () => {
  it('# 轉成依序編號的佔位符，+# 保留正負號，去掉結尾括號', () => {
    expect(tradeTextToModTemplate('Adds # to # Fire Damage to Attacks')).toBe(
      'Adds {0:d} to {1:d} Fire Damage to Attacks',
    );
    expect(tradeTextToModTemplate('+#% to Cold Resistance (Local)')).toBe(
      '{0:+d}% to Cold Resistance',
    );
    expect(tradeTextToModTemplate('+# 命中值 (部分)')).toBe('{0:+d} 命中值');
  });

  it('轉換後可直接用於比對', () => {
    const pairs: ModLinePairs = [
      [
        tradeTextToModTemplate(
          'Small Passive Skills in Radius also grant #% increased Spell Damage',
        ),
        tradeTextToModTemplate('範圍內的小型天賦也會給予增加 #% 法術傷害'),
      ],
    ];
    expect(
      translateModLine(
        'Small Passive Skills in Radius also grant 3% increased Spell Damage',
        pairs,
      ),
    ).toBe('範圍內的小型天賦也會給予增加 3% 法術傷害');
  });
});
