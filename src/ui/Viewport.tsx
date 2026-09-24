import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MeshData, PartRole } from "../types";

type PartView = { mesh: MeshData; role: PartRole };

type Props = {
  master: MeshData | null;
  masterLift: number;
  parts: PartView[];
  ghost: boolean;
};

type Orbit = {
  theta: number;
  phi: number;
  r: number;
  target: THREE.Vector3;
};

export function Viewport({ master, masterLift, parts, ghost }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const api = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    root: THREE.Group;
    grid: THREE.GridHelper;
    orbit: Orbit;
    fit: () => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 8000);
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(60, 90, 40);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9eb6c9, 0.35);
    fill.position.set(-40, 20, -30);
    scene.add(fill);
    const grid = new THREE.GridHelper(240, 24, 0x314052, 0x243140);
    scene.add(grid);

    const orbit: Orbit = { theta: 0.65, phi: 1.05, r: 160, target: new THREE.Vector3() };
    const applyCamera = () => {
      const sph = new THREE.Spherical(orbit.r, orbit.phi, orbit.theta);
      const offset = new THREE.Vector3().setFromSpherical(sph);
      camera.position.copy(orbit.target).add(offset);
      camera.lookAt(orbit.target);
    };
    const fit = () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 20);
      orbit.target.copy(center);
      orbit.r = radius / Math.sin((camera.fov * Math.PI) / 360);
      const span = radius * 2.4;
      grid.scale.set(span / 240, span / 240, span / 240);
      applyCamera();
    };

    host.appendChild(renderer.domElement);
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const pointers = new Map<number, { x: number; y: number; button: number }>();
    const onDown = (e: PointerEvent) => {
      host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      if (prev.button === 2 || e.shiftKey || pointers.size > 1) {
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.updateMatrixWorld();
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        const scale = orbit.r * 0.0016;
        orbit.target.addScaledVector(right, -dx * scale);
        orbit.target.addScaledVector(up, dy * scale);
      } else {
        orbit.theta -= dx * 0.008;
        orbit.phi = Math.min(Math.PI - 0.12, Math.max(0.12, orbit.phi - dy * 0.008));
      }
      applyCamera();
    };
    const onUp = (e: PointerEvent) => pointers.delete(e.pointerId);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbit.r = Math.min(4000, Math.max(8, orbit.r * (e.deltaY > 0 ? 1.08 : 0.92)));
      applyCamera();
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("contextmenu", (e) => e.preventDefault());

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();
    api.current = { renderer, scene, camera, root, grid, orbit, fit };

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("wheel", onWheel);
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const current = api.current;
    if (!current) return;
    clearGroup(current.root);
    if (master) {
      const geo = geometryOf(master);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0f9f6e,
        roughness: 0.38,
        metalness: 0.06,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = masterLift;
      current.root.add(mesh);
    }
    for (const part of parts) {
      const geo = geometryOf(part.mesh);
      const seeThrough = ghost && part.role === "mold";
      const mat = new THREE.MeshStandardMaterial({
        color: part.role === "clamp" ? 0xe8a838 : 0xd7e0ea,
        roughness: 0.46,
        metalness: 0.04,
        transparent: seeThrough,
        opacity: seeThrough ? 0.4 : 1,
        depthWrite: !seeThrough,
        side: THREE.DoubleSide,
      });
      current.root.add(new THREE.Mesh(geo, mat));
    }
    current.fit();
  }, [master, masterLift, parts, ghost]);

  return (
    <div className="canvas-wrap" ref={hostRef}>
      <button type="button" className="seats-btn" onClick={() => api.current?.fit()}>
        Centrar
      </button>
    </div>
  );
}

function geometryOf(mesh: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  }
}
