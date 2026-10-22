import JSZip from "jszip";
import type { MoldPart } from "../types";

export function downloadBytes(filename: string, bytes: ArrayBuffer, type = "model/stl"): void {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ZipExtra {
  path: string;
  data: ArrayBuffer | Uint8Array | string;
}

export async function downloadZip(filename: string, parts: MoldPart[], extras: ZipExtra[] = []): Promise<void> {
  const zip = new JSZip();
  for (const part of parts) zip.file(part.filename, part.bytes);
  for (const extra of extras) zip.file(extra.path, extra.data);
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
