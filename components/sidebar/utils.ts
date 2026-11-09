// 靜態數據與輔助計算函數

export const getTierMinMaxList = (
  key: string,
  values: string[][],
): { mins: string[]; maxs: string[] } => {
  const mins: string[] = [];
  const maxs: string[] = [];
  if (!values || values.length === 0) return { mins, maxs };

  const subKeys = key.split('|||||');
  let valIdx = 0;

  subKeys.forEach((subKey) => {
    const hashCount = (subKey.match(/#/g) || []).length;

    if (hashCount === 2) {
      let subMin = '';
      let subMax = '';

      const range1 = valIdx < values.length ? values[valIdx++] : null;
      const range2 = valIdx < values.length ? values[valIdx++] : null;

      if (range1 && range2) {
        const min1 = Number(range1[0]);
        const max1 = range1.length === 2 ? Number(range1[1]) : Number(range1[0]);
        const min2 = Number(range2[0]);
        const max2 = range2.length === 2 ? Number(range2[1]) : Number(range2[0]);

        subMin = ((min1 + min2) / 2).toString();
        subMax = ((max1 + max2) / 2).toString();
      } else if (range1) {
        subMin = range1[0];
        subMax = range1.length === 2 ? range1[1] : range1[0];
      }

      mins.push(subMin);
      maxs.push(subMax);
    } else if (hashCount === 1) {
      let subMin = '';
      let subMax = '';

      if (valIdx < values.length) {
        const range = values[valIdx];
        if (range.length === 2) {
          subMin = range[0];
          subMax = range[1];
        } else if (range.length === 1) {
          subMin = range[0];
        }
        valIdx++;
      }

      mins.push(subMin);
      maxs.push(subMax);
    } else {
      mins.push('');
      maxs.push('');
    }
  });

  return { mins, maxs };
};

export const isTradeStatId = (id?: string): boolean => {
  if (!id) return false;
  return (
    id.startsWith('stat_') ||
    /^(explicit|implicit|enchant|crafted|fractured|scourge|crucible|sanctum|rune|ultimatum|delve|veiled|pseudo|monster|imbued|mercenary|skill|desecrated)\./.test(
      id,
    )
  );
};
