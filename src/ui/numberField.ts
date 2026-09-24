export function parseNumberDraft(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "" || t === "+" || t === "-" || t === "." || t === "-." || t === "+.") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function clampNumber(n: number, min?: number, max?: number): number {
  let x = n;
  if (min != null && x < min) x = min;
  if (max != null && x > max) x = max;
  return x;
}

export function stepNumber(value: number, direction: 1 | -1, step = 1, min?: number, max?: number): number {
  const next = value + direction * step;
  const rounded = Number(next.toFixed(8));
  return clampNumber(rounded, min, max);
}
