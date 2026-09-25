# Moldmaker

App web para generar **cajas de molde de silicona** a partir de un maestro STL u OBJ. Eliges el sistema, ajustas los parámetros CAD y descargas STL listos para imprimir, con una estimación del volumen de silicona.

**Mismo patrón que Jiggmaker:** SPA Vite/TypeScript en el navegador. El uso diario es **Docker Compose en un Synology** (puerto **8081**, para no chocar con Jiggmaker en el 8080). **GitHub Pages** es la demo estática. No hay backend: el archivo no sale del navegador.

## Qué hace

1. **Import** — STL, OBJ o SVG. Repara la malla (suelda vértices, orienta normales) y la apoya en Z. Un SVG (milímetros) se extruye; `data-depth` fija la altura y, si falta, usa el espesor de pared (3 mm).
2. **Sistema** — Adapted Box, Tray o 2-Part Silicone.
3. **Params** — números editables, con estos valores de partida (mm / grados):

| Parámetro | Valor |
| --- | --- |
| `wallThickness` | 3.0 |
| `draftDeg` | 1.5 |
| `siliconeGap` | 0.5 |
| `funnelDiameter` | 12 |
| `channelW` × `channelH` | 4 × 4 |
| `pinDiameter` / `holeDiameter` / `pinReach` | 3.0 / 3.25 / 5 |
| `splitMax` / `splitOverlap` | 250 / 2.5 (división apagada) |
| `clampSlot` / `clampClearance` | 8 / 0.3 |
| `castShrinkPct` | 0 |

4. **Preview** — maestro y molde en 3D.
5. **Export** — STL binarios con nombre y el volumen de silicona en mm³ (y ml).

### Sistemas (MVP)

- **Adapted Box** — cáscara sobre la silueta 2D de la pieza (no la caja envolvente), con holgura, fondo con llaves, embudo y canal, abrazaderas laterales y pines de registro.
- **Tray** — bandeja abierta arriba que sigue la silueta, fondo plano, una cavidad, abrazadera opcional, sin segunda mitad.
- **2-Part Silicone** — plano de corte en Z (mitad del maestro por defecto), dos mitades que siguen la silueta, pines (Ø3) y agujeros (Ø3.25), embudo en el plano y sello perimetral.

Si activas la división, cada pieza cabe en `splitMax` (250 mm). La espiga sobresale `splitOverlap` (2.5 mm): pin Ø `pinDiameter`, agujero Ø `holeDiameter`.

La contracción de colada está apagada (`castShrinkPct = 0`). Un 2 % escala el maestro ×1.02 antes de construir el molde.

Fuera de esta fase: cavidades internas, Direct-mold, Smart Seal, modo avanzado y caja de colada reutilizable.

## Desarrollo

```bash
npm ci
npm test
npm run dev
```

Abre la URL de Vite. Puedes cargar el ejemplo (bloque con tejado, 40×30×28 mm) o soltar un STL sencillo, cambiar de sistema y descargar los STL.

## Docker Compose en Synology

El DS415+ es **Intel Atom C2538 (x86_64)** con **2 GB de RAM**. Usa la imagen amd64 de abajo y deja el límite de memoria. No actives GPU ni modo privilegiado.

**DSM 6:** Centro de paquetes → **Docker**.  
**DSM 7:** **Container Manager**.

### 1. Copia el proyecto

SSH o File Station: deja el repo en el NAS, por ejemplo `/volume1/docker/moldmaker`.

### 2. Construye y arranca

```bash
cd /volume1/docker/moldmaker
sudo docker-compose up -d --build
```

Si el NAS tiene Compose v2:

```bash
sudo docker compose up -d --build
```

**GUI:** Docker / Container Manager → Proyecto → creado desde `docker-compose.yml` → carpeta de este archivo → puerto **8081**.

### 3. Abre la app

En la LAN: `http://<ip-del-nas>:8081`

Si el 8081 está ocupado, cambia el puerto del host en `docker-compose.yml` (`"9081:80"`).

### 4. Actualizar

```bash
cd /volume1/docker/moldmaker
git pull
sudo docker-compose up -d --build
```

La imagen es nginx alpine más la SPA estática. En reposo debería quedarse muy por debajo del `mem_limit` de 256 MB. La primera construcción necesita red para `node:20-alpine` y `nginx:1.27-alpine`; después funciona sin red. No pongas `GITHUB_PAGES` aquí: el contenedor sirve la app en `/`.

## GitHub Pages

El workflow construye con `GITHUB_PAGES=true` para que los assets salgan en `/Moldmaker/`. Docker **no** define esa variable y se queda en `/`.

1. Merge a `main` (o Actions → GitHub Pages → Run workflow).
2. Settings → Pages → Source: **GitHub Actions**.
3. Abre `https://iphonetikpr.github.io/Moldmaker/` cuando el workflow esté en verde.

Los PR ejecutan tests y el build; no publican. Un push a `main` sí publica.

Build local con la misma base:

```bash
npm run build:pages
npx vite preview
```
