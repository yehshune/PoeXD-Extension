import { describe, expect, it } from 'vitest';
import {
  parseStatGroupTemplateTransfer,
  serializeStatGroupTemplates,
  STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
} from '@/utils/stat-group-template-transfer';
import type { StatGroupTemplate } from '@/utils/stat-group-template-store';
import type { CriteriaOverlayStatGroup } from '@/utils/criteria-overlay';

const groups: CriteriaOverlayStatGroup[] = [
  { type: 'and', filters: [{ id: 'explicit.a', value: { min: 1 } }] },
];

const templates: StatGroupTemplate[] = [
  { id: 't1', name: '抗性', statGroups: groups, createdAt: 1, updatedAt: 2 },
  { id: 't2', name: '移速', statGroups: groups, createdAt: 3, updatedAt: 4 },
];

describe('serializeStatGroupTemplates', () => {
  it('只輸出名稱與詞綴群組，並標記格式與遊戲版本', () => {
    const parsed = JSON.parse(serializeStatGroupTemplates('poe2', templates));
    expect(parsed).toEqual({
      format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
      version: 1,
      gameVersion: 'poe2',
      templates: [
        { name: '抗性', statGroups: groups },
        { name: '移速', statGroups: groups },
      ],
    });
  });
});

describe('parseStatGroupTemplateTransfer', () => {
  it('還原匯出的內容', () => {
    const text = serializeStatGroupTemplates('poe2', templates);
    expect(parseStatGroupTemplateTransfer(text, 'poe2')).toEqual({
      entries: [
        { name: '抗性', statGroups: groups },
        { name: '移速', statGroups: groups },
      ],
      skipped: 0,
    });
  });

  it('略過名稱或詞綴群組無效的項目並回報數量', () => {
    const text = JSON.stringify({
      format: STAT_GROUP_TEMPLATE_TRANSFER_FORMAT,
      version: 1,
      gameVersion: 'poe1',
      templates: [
        { name: ' 有效 ', statGroups: groups },
        { name: '', statGroups: groups },
        { name: '沒有群組', statGroups: [] },
        'garbage',
      ],
    });
    expect(parseStatGroupTemplateTransfer(text, 'poe1')).toEqual({
      entries: [{ name: '有效', statGroups: groups }],
      skipped: 3,
    });
  });

  it('拒絕非 JSON、格式不符、不同遊戲版本或沒有有效項目的內容', () => {
    expect(() => parseStatGroupTemplateTransfer('not json', 'poe1')).toThrow('格式');
    expect(() => parseStatGroupTemplateTransfer('{"format":"other"}', 'poe1')).toThrow('格式');
    expect(() =>
      parseStatGroupTemplateTransfer(serializeStatGroupTemplates('poe2', templates), 'poe1'),
    ).toThrow('POE2');
    expect(() =>
      parseStatGroupTemplateTransfer(serializeStatGroupTemplates('poe1', []), 'poe1'),
    ).toThrow('沒有');
  });
});
