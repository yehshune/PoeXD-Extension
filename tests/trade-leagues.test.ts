import { describe, expect, it, vi } from 'vitest';
import { fetchTradeLeagues } from '@/utils/trade-leagues';

describe('Trade league discovery', () => {
  it('loads only PC leagues from the current PoE1 market endpoint', async () => {
    const http = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: [
          { id: 'Allflame', text: 'Allflame', realm: 'pc' },
          { id: 'Allflame', text: 'Allflame', realm: 'xbox' },
          { id: 'Standard', text: 'Standard', realm: 'pc' },
        ],
      }),
    }));

    await expect(fetchTradeLeagues('poe1', http)).resolves.toEqual([
      { id: 'Allflame', text: 'Allflame' },
      { id: 'Standard', text: 'Standard' },
    ]);
    expect(http).toHaveBeenCalledWith('/api/trade/data/leagues', { credentials: 'same-origin' });
  });

  it('loads the PoE2 realm from the PoE2 market endpoint', async () => {
    const http = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: [
          { id: 'Runes of Aldur', text: 'Runes of Aldur', realm: 'poe2' },
          { id: 'Standard', text: 'Standard', realm: 'pc' },
        ],
      }),
    }));

    await expect(fetchTradeLeagues('poe2', http)).resolves.toEqual([
      { id: 'Runes of Aldur', text: 'Runes of Aldur' },
    ]);
    expect(http).toHaveBeenCalledWith('/api/trade2/data/leagues', { credentials: 'same-origin' });
  });
});
