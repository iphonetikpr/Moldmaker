/**
 * Even cuts so each body fits `maxLen`. The 2.5 mm "overlap" is the dowel
 * engagement past the cut (pin length), not a second copy of the solid.
 * A male piece may stick out by `overlap` beyond `maxLen`.
 */
export function planSplits(span: number, maxLen: number): number[] {
  if (span <= maxLen + 1e-6) return [0, span];
  const n = Math.max(2, Math.ceil(span / maxLen));
  const cuts = [0];
  for (let i = 1; i < n; i++) cuts.push((span * i) / n);
  cuts.push(span);
  return cuts;
}

export function splitPieceCount(span: number, maxLen: number): number {
  return planSplits(span, maxLen).length - 1;
}
