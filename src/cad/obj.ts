import type { MeshData } from "../types";
import { weldMesh } from "./mesh";

/** OBJ vertices + faces. Quads and n-gons are fanned into triangles. */
export function parseOBJ(text: string): MeshData {
  const verts: number[] = [];
  const idx: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const parts = s.split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) {
      verts.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (parts[0] === "f" && parts.length >= 4) {
      const ids = parts.slice(1).map((tok) => {
        const raw = tok.split("/")[0];
        let n = Number(raw);
        if (!Number.isFinite(n) || n === 0) throw new Error("Cara OBJ inválida");
        if (n < 0) n = verts.length / 3 + n + 1;
        return n - 1;
      });
      for (let k = 1; k < ids.length - 1; k++) idx.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  if (idx.length < 3) throw new Error("El OBJ no tiene caras");
  return weldMesh({ positions: Float32Array.from(verts), indices: Uint32Array.from(idx) });
}
