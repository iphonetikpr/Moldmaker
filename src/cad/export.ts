export function safeName(name: string): string {
  const base = name.replace(/\.(stl|obj|svg)$/i, "");
  const s = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "pieza";
}

export function partFilename(base: string, id: string, index?: number, count?: number): string {
  const split = index != null && count != null && count > 1 ? `_s${index + 1}` : "";
  return `${base}_${id}${split}.stl`;
}
