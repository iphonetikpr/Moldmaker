import type { MeshData } from "../types";
import { weldMesh } from "./mesh";

function isBinaryStl(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false;
  const view = new DataView(buf);
  const n = view.getUint32(80, true);
  return 84 + 50 * n === buf.byteLength;
}

function soup(positions: Float32Array): MeshData {
  const n = positions.length / 3;
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  return weldMesh({ positions, indices });
}

function parseBinary(buf: ArrayBuffer): MeshData {
  const view = new DataView(buf);
  const n = view.getUint32(80, true);
  const positions = new Float32Array(n * 9);
  let o = 84;
  let p = 0;
  for (let i = 0; i < n; i++) {
    o += 12;
    for (let k = 0; k < 9; k++, p++, o += 4) positions[p] = view.getFloat32(o, true);
    o += 2;
  }
  return soup(positions);
}

function parseAscii(buf: ArrayBuffer): MeshData {
  const text = new TextDecoder("latin1").decode(buf);
  const nums: number[] = [];
  const re = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  if (nums.length < 9 || nums.length % 9 !== 0) throw new Error("El STL ASCII no tiene triángulos completos");
  return soup(Float32Array.from(nums));
}

export function parseSTL(buf: ArrayBuffer): MeshData {
  if (isBinaryStl(buf)) return parseBinary(buf);
  const head = new TextDecoder("latin1").decode(buf.slice(0, 256));
  if (/^\s*solid/i.test(head)) return parseAscii(buf);
  if (buf.byteLength >= 84) {
    try {
      return parseBinary(buf);
    } catch {
      /* fall through */
    }
  }
  throw new Error("STL no reconocido");
}

export function writeSTL(mesh: MeshData, name = "Moldmaker"): ArrayBuffer {
  const p = mesh.positions;
  const idx = mesh.indices;
  const n = idx.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const view = new DataView(buf);
  const header = new TextEncoder().encode(`Moldmaker ${name}`.slice(0, 80));
  new Uint8Array(buf, 0, 80).set(header);
  view.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    const verts = [ax, ay, az, bx, by, bz, cx, cy, cz];
    for (const v of verts) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
