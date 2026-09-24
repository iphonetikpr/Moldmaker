import type { MeshData, UpAxis, Vec3 } from "../types";
import { bboxOf, transformMesh } from "./mesh";

type Mat3 = [number, number, number, number, number, number, number, number, number];

const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rotX(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

function rotY(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function rotZ(deg: number): Mat3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      o[col * 3 + row] =
        a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
    }
  }
  return o as Mat3;
}

function apply(m: Mat3, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[3] * y + m[6] * z,
    m[1] * x + m[4] * y + m[7] * z,
    m[2] * x + m[5] * y + m[8] * z,
  ];
}

/** Rotation that maps the chosen up axis onto +Z, then spins around Z. */
export function orientMatrix(up: UpAxis, rotDeg: number): Mat3 {
  let base: Mat3;
  switch (up) {
    case "z+":
      base = I;
      break;
    case "z-":
      base = rotX(180);
      break;
    case "y+":
      base = rotX(90);
      break;
    case "y-":
      base = rotX(-90);
      break;
    case "x+":
      base = rotY(-90);
      break;
    case "x-":
      base = rotY(90);
      break;
    default:
      base = I;
  }
  if (!rotDeg) return base;
  return mul(rotZ(rotDeg), base);
}

/**
 * Orient, apply cast-shrink scale about the centroid, then seat on Z=0
 * and center the footprint on XY.
 */
export function orientMesh(mesh: MeshData, up: UpAxis, rotDeg: number, scale = 1): MeshData {
  const m = orientMatrix(up, rotDeg);
  const spun = transformMesh(mesh, (x, y, z) => apply(m, x, y, z));
  const bb = bboxOf(spun);
  const cx = (bb.min[0] + bb.max[0]) / 2;
  const cy = (bb.min[1] + bb.max[1]) / 2;
  const cz = (bb.min[2] + bb.max[2]) / 2;
  const s = scale;
  const scaled = transformMesh(spun, (x, y, z) => [cx + (x - cx) * s, cy + (y - cy) * s, cz + (z - cz) * s]);
  const seated = bboxOf(scaled);
  const ox = (seated.min[0] + seated.max[0]) / 2;
  const oy = (seated.min[1] + seated.max[1]) / 2;
  const oz = seated.min[2];
  return transformMesh(scaled, (x, y, z) => [x - ox, y - oy, z - oz]);
}
