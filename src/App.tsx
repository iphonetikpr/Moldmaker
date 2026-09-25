import { useEffect, useMemo, useState } from "react";
import { bboxOf, bboxSize, sampleMaster, signedVolume, triangleCount } from "./cad/mesh";
import { parseOBJ } from "./cad/obj";
import { parseSVG } from "./cad/svg";
import { generateMold } from "./cad/generate";
import { initKernel, type Kernel } from "./cad/kernel";
import { defaultParams, sanitizeParams } from "./cad/params";
import { parseSTL } from "./cad/stl";
import type { MeshData, MoldParams, StepId, SystemId, UpAxis } from "./types";
import { safeName } from "./cad/export";
import { downloadBytes, downloadZip } from "./ui/download";
import { NumberField } from "./ui/NumberField";
import { ThemeToggle } from "./ui/ThemeToggle";
import { Viewport } from "./ui/Viewport";

const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "import", label: "Import" },
  { id: "system", label: "Sistema" },
  { id: "params", label: "Params" },
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
];

const SYSTEMS: Array<{ id: SystemId; title: string; text: string }> = [
  {
    id: "adapted",
    title: "Adapted Box",
    text: "Caja que sigue la silueta: holgura, fondo con llaves, embudo y canales, abrazaderas laterales y pines.",
  },
  {
    id: "tray",
    title: "Tray",
    text: "Bandeja abierta que sigue la silueta, fondo plano, una sola cavidad. Abrazadera opcional. Sin segunda mitad.",
  },
  {
    id: "twopart",
    title: "2-Part Silicone",
    text: "Plano de corte en Z (mitad por defecto). Dos mitades que siguen la silueta, pines, embudo en el plano y sello perimetral.",
  },
];

const UPS: UpAxis[] = ["z+", "z-", "y+", "y-", "x+", "x-"];

type Master = { name: string; mesh: MeshData };

export default function App() {
  const [kernel, setKernel] = useState<Kernel | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("import");
  const [system, setSystem] = useState<SystemId>("adapted");
  const [params, setParams] = useState<MoldParams>(() => defaultParams());
  const [up, setUp] = useState<UpAxis>("z+");
  const [rot, setRot] = useState(0);
  const [master, setMaster] = useState<Master | null>(() => ({ name: "ejemplo", mesh: sampleMaster() }));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [ghost, setGhost] = useState(true);

  useEffect(() => {
    let cancel = false;
    initKernel()
      .then((k) => {
        if (!cancel) setKernel(k);
      })
      .catch((err: unknown) => {
        if (!cancel) setBootError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancel = true;
    };
  }, []);

  const result = useMemo(() => {
    if (!kernel || !master) return null;
    try {
      return {
        ok: true as const,
        value: generateMold(kernel, {
          mesh: master.mesh,
          name: master.name,
          system,
          params,
          up,
          rotDeg: rot,
        }),
      };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  }, [kernel, master, system, params, up, rot]);

  const rawStats = useMemo(() => {
    if (!master) return null;
    const bb = bboxOf(master.mesh);
    return {
      triangles: triangleCount(master.mesh),
      size: bboxSize(bb),
      volume: Math.abs(signedVolume(master.mesh)),
    };
  }, [master]);

  async function takeFile(file: File) {
    setLoadError(null);
    try {
      const buf = await file.arrayBuffer();
      const lower = file.name.toLowerCase();
      const text = new TextDecoder().decode(buf);
      const mesh = lower.endsWith(".svg") ? parseSVG(text) : lower.endsWith(".obj") ? parseOBJ(text) : parseSTL(buf);
      setMaster({ name: file.name, mesh });
      setStep("system");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }

  function setParam<K extends keyof MoldParams>(key: K, value: MoldParams[K]) {
    setParams((prev) => sanitizeParams({ ...prev, [key]: value }));
  }

  const built = result?.ok ? result.value : null;
  const systemTitle = SYSTEMS.find((s) => s.id === system)?.title ?? system;

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <h1>
          Moldmaker <span>silicona</span>
        </h1>
        <span className="sp" />
        <ThemeToggle />
      </header>

      <div className="shell">
        <aside className="controls">
          <nav className="steps" aria-label="Pasos">
            {STEPS.map((s) => (
              <button key={s.id} type="button" className={step === s.id ? "on" : ""} onClick={() => setStep(s.id)}>
                {s.label}
              </button>
            ))}
          </nav>

          {step === "import" && (
            <section className="card">
              <h2>Import</h2>
              <label
                className={over ? "drop over" : "drop"}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) void takeFile(file);
                }}
              >
                Suelta un STL, OBJ o SVG
                <input
                  type="file"
                  accept=".stl,.obj,.svg,model/stl,image/svg+xml"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void takeFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="orient-actions">
                <button type="button" className="btn" onClick={() => setMaster({ name: "ejemplo", mesh: sampleMaster() })}>
                  Cargar ejemplo
                </button>
              </div>
              {loadError && <p className="warnbar">{loadError}</p>}
              {master && rawStats && (
                <div className="sum-details">
                  <div>
                    <span>Pieza</span>
                    <b>{master.name}</b>
                  </div>
                  <div>
                    <span>Tamaño</span>
                    <b>
                      {rawStats.size.map((n) => n.toFixed(1)).join(" × ")} mm
                    </b>
                  </div>
                  <div>
                    <span>Triángulos</span>
                    <b>{rawStats.triangles}</b>
                  </div>
                  <div>
                    <span>Volumen</span>
                    <b>{Math.round(rawStats.volume).toLocaleString("es-ES")} mm³</b>
                  </div>
                </div>
              )}
              <div className="row">
                <label htmlFor="up">Eje arriba</label>
                <select id="up" value={up} onChange={(e) => setUp(e.target.value as UpAxis)}>
                  {UPS.map((axis) => (
                    <option key={axis} value={axis}>
                      {axis}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <label htmlFor="rot">Giro Z</label>
                <NumberField id="rot" value={rot} min={-180} max={180} step={15} onChange={setRot} aria-label="Giro Z" />
              </div>
              <p className="hint">
                La pieza se apoya en Z=0 y se centra en XY. El molde sigue su silueta, no la caja envolvente. Un SVG sin data-depth se extruye 3 mm. La contracción de colada, si la activas, escala el maestro.
              </p>
            </section>
          )}

          {step === "system" && (
            <section className="card">
              <h2>Sistema</h2>
              <div className="sys">
                {SYSTEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={system === item.id ? "on" : ""}
                    onClick={() => setSystem(item.id)}
                  >
                    <b>{item.title}</b>
                    <span>{item.text}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === "params" && (
            <section className="card">
              <h2>Params</h2>
              <Field label="Espesor de pared" k="wall" v={params.wallThickness} step={0.1} min={0.8} max={20} set={(n) => setParam("wallThickness", n)} />
              <Field label="Ángulo de salida" k="draft" v={params.draftDeg} step={0.1} min={0} max={8} set={(n) => setParam("draftDeg", n)} />
              <Field label="Holgura silicona" k="gap" v={params.siliconeGap} step={0.1} min={0} max={30} set={(n) => setParam("siliconeGap", n)} />
              <Field label="Embudo Ø" k="fun" v={params.funnelDiameter} step={0.5} min={4} max={40} set={(n) => setParam("funnelDiameter", n)} />
              <Field label="Canal ancho" k="cw" v={params.channelW} step={0.5} min={1} max={20} set={(n) => setParam("channelW", n)} />
              <Field label="Canal alto" k="ch" v={params.channelH} step={0.5} min={1} max={20} set={(n) => setParam("channelH", n)} />
              <Field label="Pin Ø" k="pd" v={params.pinDiameter} step={0.05} min={0.6} max={12} set={(n) => setParam("pinDiameter", n)} />
              <Field label="Agujero Ø" k="hd" v={params.holeDiameter} step={0.05} min={0.8} max={14} set={(n) => setParam("holeDiameter", n)} />
              <Field label="Alcance del pin" k="pr" v={params.pinReach} step={0.5} min={1} max={20} set={(n) => setParam("pinReach", n)} />
              <Field label="Ranura abrazadera" k="cs" v={params.clampSlot} step={0.5} min={3} max={30} set={(n) => setParam("clampSlot", n)} />
              <Field label="Holgura abrazadera" k="cc" v={params.clampClearance} step={0.05} min={0} max={2} set={(n) => setParam("clampClearance", n)} />
              <Field label="Contracción %" k="sh" v={params.castShrinkPct} step={0.1} min={0} max={15} set={(n) => setParam("castShrinkPct", n)} />
              <Field label="Corte Z (0–1)" k="cut" v={params.cutRatio} step={0.05} min={0.2} max={0.8} set={(n) => setParam("cutRatio", n)} />
              <label className="chk">
                <input type="checkbox" checked={params.clampEnabled} onChange={(e) => setParam("clampEnabled", e.target.checked)} />
                <span>Abrazadera en Tray</span>
              </label>
              <label className="chk">
                <input type="checkbox" checked={params.splitEnabled} onChange={(e) => setParam("splitEnabled", e.target.checked)} />
                <span>Dividir si supera la cama</span>
              </label>
              <Field label="Cama máx." k="sm" v={params.splitMax} step={5} min={40} max={500} set={(n) => setParam("splitMax", n)} />
              <Field label="Solape / espiga" k="so" v={params.splitOverlap} step={0.1} min={0.4} max={20} set={(n) => setParam("splitOverlap", n)} />
              <button type="button" className="btn" onClick={() => setParams(defaultParams())}>
                Restaurar valores
              </button>
              <p className="hint">
                Valores de partida: pared 3 mm, salida 1.5°, holgura 0.5 mm, embudo Ø12, canal 4×4, pin Ø3 / agujero Ø3.25 / alcance 5, división 250 mm con solape 2.5, ranura 8 / holgura 0.3, contracción 0.
              </p>
            </section>
          )}

          {step === "preview" && (
            <section className="card">
              <h2>Preview</h2>
              <p className="hint">
                Verde: maestro. Gris: molde. Ámbar: abrazaderas. Arrastra para orbitar, rueda para zoom, botón derecho para desplazar.
              </p>
              <label className="chk">
                <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} />
                <span>Molde transparente</span>
              </label>
              {built && (
                <div className="sum-details">
                  <div>
                    <span>Sistema</span>
                    <b>{systemTitle}</b>
                  </div>
                  <div>
                    <span>Piezas STL</span>
                    <b>{built.parts.length}</b>
                  </div>
                  <div>
                    <span>Maestro dentro</span>
                    <b>Z +{built.masterLift.toFixed(2)} mm</b>
                  </div>
                </div>
              )}
            </section>
          )}

          {step === "export" && (
            <section className="card">
              <h2>Export</h2>
              {built ? (
                <>
                  <div className="dlgrid">
                    {built.parts.map((part) => (
                      <button key={part.filename} type="button" onClick={() => downloadBytes(part.filename, part.bytes)}>
                        <b>{part.filename}</b>
                        <span>
                          {part.role === "clamp" ? "Abrazadera" : "Molde"} · {part.mesh.indices.length / 3} tris
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="primary zip"
                      onClick={() => void downloadZip(`${safeName(master?.name || "pieza")}_moldmaker.zip`, built.parts)}
                    >
                      <b>Descargar todo (.zip)</b>
                      <span>STL binarios, milímetros</span>
                    </button>
                  </div>
                  <p className="hint">Los STL salen en milímetros, listos para el laminador. La división opcional añade espigas Ø pin y agujeros Ø agujero con solape de encaje.</p>
                </>
              ) : (
                <p className="hint">Importa una pieza para exportar.</p>
              )}
            </section>
          )}
        </aside>

        <section className="preview-col">
          <div className="preview-card">
            <div className="preview-hd">
              <b>{systemTitle}</b>
              {built && <span className="pill">{formatVolume(built.siliconeMm3)}</span>}
              {!kernel && !bootError && <span className="hint">Cargando núcleo CAD…</span>}
            </div>
            <div className="preview-pad">
              {bootError && <p className="warnbar">{bootError}</p>}
              {result && !result.ok && <p className="warnbar">{result.error}</p>}
              {built?.warnings.map((w) => (
                <p key={w} className="warnbar">
                  {w}
                </p>
              ))}
              <Viewport
                master={built?.master ?? null}
                masterLift={built?.masterLift ?? 0}
                parts={built?.parts.map((p) => ({ mesh: p.mesh, role: p.role })) ?? []}
                ghost={ghost}
              />
              <div className="preview-ft">
                <p className="hint">
                  <b>Silicona estimada</b> {built ? formatVolume(built.siliconeMm3) : "—"} — cavidad menos el maestro, más embudo y canal.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function formatVolume(mm3: number): string {
  const ml = mm3 / 1000;
  const mm = Math.round(mm3).toLocaleString("es-ES");
  const mlText = ml >= 100 ? ml.toFixed(0) : ml.toFixed(1);
  return `${mm} mm³ · ${mlText} ml`;
}

function Field({
  label,
  k,
  v,
  min,
  max,
  step,
  set,
}: {
  label: string;
  k: string;
  v: number;
  min: number;
  max: number;
  step: number;
  set: (n: number) => void;
}) {
  return (
    <div className="row">
      <label htmlFor={k}>{label}</label>
      <NumberField id={k} value={v} min={min} max={max} step={step} onChange={set} aria-label={label} />
    </div>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <rect x="3" y="6" width="26" height="20" rx="3" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M8 16h16M16 10v12" stroke="var(--accent)" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.2" fill="var(--accent)" />
    </svg>
  );
}
