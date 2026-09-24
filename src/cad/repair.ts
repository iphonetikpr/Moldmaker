import type { MeshData } from "../types";
import { flipMesh, openEdgeCount, signedVolume, triangleCount, weldMesh } from "./mesh";

export interface RepairResult {
  mesh: MeshData;
  flipped: boolean;
  openEdges: number;
  inputTriangles: number;
  warnings: string[];
}

/** Weld, drop degenerates, force outward windings. */
export function repairMesh(mesh: MeshData): RepairResult {
  const inputTriangles = triangleCount(mesh);
  let next = weldMesh(mesh);
  const warnings: string[] = [];
  if (triangleCount(next) === 0) throw new Error("La malla no tiene triángulos útiles");
  let flipped = false;
  if (signedVolume(next) < 0) {
    next = flipMesh(next);
    flipped = true;
  }
  const openEdges = openEdgeCount(next);
  if (openEdges > 0) {
    warnings.push("La malla no está cerrada. El molde usa su caja envolvente y el volumen es aproximado.");
  }
  if (flipped) warnings.push("Se invirtió la orientación de las normales.");
  return { mesh: next, flipped, openEdges, inputTriangles, warnings };
}
