import type { MeshData, MoldParams, MoldResult, SystemId, UpAxis, Vec3 } from "../types";
import { bboxOf, bboxSize, signedVolume } from "./mesh";
import { orientMesh } from "./orient";
import { sanitizeParams } from "./params";
import { repairMesh } from "./repair";
import { writeSTL } from "./stl";
import { partFilename, safeName } from "./export";
import type { Kernel } from "./kernel";
import { planMold, type SolidSpec } from "./layout";
import type { Loop } from "./outline";
import { planSplits } from "./split";

export interface GenerateInput {
  mesh: MeshData;
  name: string;
  system: SystemId;
  params: MoldParams;
  up: UpAxis;
  rotDeg: number;
}

export function generateMold(kernel: Kernel, input: GenerateInput): MoldResult {
  const params = sanitizeParams(input.params);
  const repaired = repairMesh(input.mesh);
  const scale = 1 + params.castShrinkPct / 100;
  const master = orientMesh(repaired.mesh, input.up, input.rotDeg, scale);
  const bb = bboxOf(master);
  const size = bboxSize(bb);
  const masterVolume = Math.abs(signedVolume(master));
  const warnings = [...repaired.warnings];

  let outline: Loop | undefined;
  try {
    const hit = kernel.projectOutline(master);
    if (hit.exact) outline = hit.loop;
    else warnings.push("No se pudo leer la silueta. El molde usa la caja envolvente de la pieza.");
  } catch {
    warnings.push("No se pudo leer la silueta. El molde usa la caja envolvente de la pieza.");
  }

  const plan = planMold(input.system, size, masterVolume, params, outline, (loop, delta) =>
    kernel.offsetOutline(loop, delta),
  );
  warnings.push(...plan.warnings);

  const base = safeName(input.name);
  const parts: MoldResult["parts"] = [];
  try {
    for (const spec of plan.solids) {
      const mesh = buildSolid(kernel, spec);
      const pieces = spec.split && params.splitEnabled ? splitMesh(kernel, mesh, params) : [mesh];
      if (!pieces.length) throw new Error(`División vacía en ${spec.id}`);
      pieces.forEach((piece, i) => {
        parts.push({
          id: spec.id,
          filename: partFilename(base, spec.id, i, pieces.length),
          mesh: piece,
          bytes: writeSTL(piece, spec.id),
          role: spec.role,
        });
      });
    }
  } finally {
    kernel.end();
  }

  for (const part of parts) {
    if (part.role !== "mold") continue;
    const span = Math.max(...bboxSize(bboxOf(part.mesh)));
    const limit = params.splitMax + (params.splitEnabled ? params.splitOverlap + 0.35 : 0.2);
    if (span > limit) {
      warnings.push(
        params.splitEnabled
          ? `${part.filename} sigue midiendo ${span.toFixed(0)} mm tras dividir. Sube el número de cortes bajando splitMax o revisa el embudo.`
          : `${part.filename} mide ${span.toFixed(0)} mm, por encima de ${params.splitMax} mm. Activa dividir (solape ${params.splitOverlap} mm) o sube el límite.`,
      );
    }
  }

  return {
    parts,
    master,
    masterLift: plan.masterLift,
    siliconeMm3: plan.metrics.siliconeMm3,
    warnings: unique(warnings),
    system: input.system,
    profileMode: plan.profileMode,
  };
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function buildSolid(kernel: Kernel, spec: SolidSpec): MeshData {
  if (!spec.unions.length) throw new Error("Sólido sin geometría");
  let solid = kernel.feat(spec.unions[0]);
  for (const f of spec.carve) solid = kernel.subtract(solid, kernel.feat(f));
  for (const f of spec.unions.slice(1)) solid = kernel.union(solid, kernel.feat(f));
  for (const f of spec.subtracts) solid = kernel.subtract(solid, kernel.feat(f));
  if (solid.isEmpty() || solid.numTri() < 4) throw new Error(`No se pudo construir ${spec.id}`);
  return kernel.toMesh(solid);
}

function splitMesh(kernel: Kernel, mesh: MeshData, params: MoldParams): MeshData[] {
  return splitAxis(kernel, mesh, params, false);
}

function splitAxis(kernel: Kernel, mesh: MeshData, params: MoldParams, pinned: boolean): MeshData[] {
  const bb = bboxOf(mesh);
  const size = bboxSize(bb);
  let axis: 0 | 1 | 2 = 0;
  if (size[1] > size[axis]) axis = 1;
  if (size[2] > size[axis]) axis = 2;
  const span = size[axis];
  const limit = params.splitMax + (pinned ? params.splitOverlap + 1 : 0);
  if (span <= limit + 1e-4) return [mesh];

  const cuts = planSplits(span, params.splitMax).map((t) => bb.min[axis] + t);
  const src = kernel.fromMesh(mesh);
  const pad = 2;
  const pieces: MeshData[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    const min: Vec3 = [bb.min[0] - pad, bb.min[1] - pad, bb.min[2] - pad];
    const max: Vec3 = [bb.max[0] + pad, bb.max[1] + pad, bb.max[2] + pad];
    min[axis] = a;
    max[axis] = b;
    let piece = kernel.intersect(src, kernel.box(min, [max[0] - min[0], max[1] - min[1], max[2] - min[2]]));
    const sites = dowelSites(bb, axis, params.holeDiameter / 2 + 1.8);
    const reach = params.splitOverlap;
    const pinR = params.pinDiameter / 2;
    const holeR = params.holeDiameter / 2;
    const bossR = holeR + 1.8;
    if (i < cuts.length - 2) {
      for (const site of sites) {
        piece = kernel.union(piece, kernel.cyl(axisName(axis), baseAt(site, axis, b - 0.2), reach + 0.2, pinR));
      }
    }
    if (i > 0) {
      const face = a;
      for (const site of sites) {
        piece = kernel.union(piece, kernel.cyl(axisName(axis), baseAt(site, axis, face), reach, bossR));
        piece = kernel.subtract(piece, kernel.cyl(axisName(axis), baseAt(site, axis, face - 0.04), reach + 0.2, holeR));
      }
    }
    if (!piece.isEmpty()) pieces.push(kernel.toMesh(piece));
  }
  return pieces.flatMap((piece) => splitAxis(kernel, piece, params, true));
}

function axisName(axis: 0 | 1 | 2): "x" | "y" | "z" {
  return axis === 0 ? "x" : axis === 1 ? "y" : "z";
}

function dowelSites(bb: { min: Vec3; max: Vec3 }, axis: 0 | 1 | 2, inset: number): Vec3[] {
  const u = ((axis + 1) % 3) as 0 | 1 | 2;
  const v = ((axis + 2) % 3) as 0 | 1 | 2;
  const make = (su: -1 | 1, sv: -1 | 1): Vec3 => {
    const p: Vec3 = [0, 0, 0];
    p[u] = su < 0 ? bb.min[u] + inset : bb.max[u] - inset;
    p[v] = sv < 0 ? bb.min[v] + inset : bb.max[v] - inset;
    p[axis] = 0;
    return p;
  };
  const spanU = bb.max[u] - bb.min[u];
  const spanV = bb.max[v] - bb.min[v];
  if (spanU < inset * 3 || spanV < inset * 3) {
    const p: Vec3 = [0, 0, 0];
    p[u] = (bb.min[u] + bb.max[u]) / 2;
    p[v] = (bb.min[v] + bb.max[v]) / 2;
    return [p];
  }
  return [make(-1, -1), make(1, 1)];
}

function baseAt(site: Vec3, axis: 0 | 1 | 2, along: number): Vec3 {
  const p: Vec3 = [site[0], site[1], site[2]];
  p[axis] = along;
  return p;
}
