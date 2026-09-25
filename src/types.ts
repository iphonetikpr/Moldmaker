export type SystemId = "adapted" | "tray" | "twopart";

export type StepId = "import" | "system" | "params" | "preview" | "export";

export type UpAxis = "z+" | "z-" | "y+" | "y-" | "x+" | "x-";

export type Vec3 = [number, number, number];

export interface MoldParams {
  wallThickness: number;
  draftDeg: number;
  siliconeGap: number;
  funnelDiameter: number;
  channelW: number;
  channelH: number;
  pinDiameter: number;
  holeDiameter: number;
  pinReach: number;
  splitMax: number;
  splitOverlap: number;
  splitEnabled: boolean;
  clampSlot: number;
  clampClearance: number;
  clampEnabled: boolean;
  castShrinkPct: number;
  cutRatio: number;
}

/** Indexed triangle mesh, millimeters, Z up. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export interface MeshStats {
  triangles: number;
  volume: number;
  bbox: BBox;
  openEdges: number;
  flipped: boolean;
}

export type PartRole = "mold" | "clamp";

export interface MoldPart {
  id: string;
  filename: string;
  mesh: MeshData;
  bytes: ArrayBuffer;
  role: PartRole;
}

export interface MoldResult {
  parts: MoldPart[];
  master: MeshData;
  masterLift: number;
  siliconeMm3: number;
  warnings: string[];
  system: SystemId;
  /** Whether the cavity followed the part outline or the bounding box. */
  profileMode: "silhouette" | "rect" | "bbox";
}
