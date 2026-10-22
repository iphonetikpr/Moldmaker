# Moldmaker clamp kit

## Flange spec for R2D2 (all boxes, incl. both 2-Part halves)
- External flange, **5 mm thick per half**; the halves meet at the parting line, so the two flanges stack to **10 mm**.
- Through slot **8.3 × 8.3 mm** (clampSlot 8 + clearance 0.3), **4 mm** from the flange outer edge to the slot edge. The flange must stick out ≥ 16.3 mm (4 + 8.3 + 4).
- Same size on every box. Count per side = `ceil(outerW / 80)`, evenly spaced.
- Current code (`src/cad/layout.ts` placeSlots L453, L309): blind 8.3 mm pockets 1.65 mm deep on the ±Y walls, adapted/tray only. There are no slots on 2-Part boxes, so this has to change.

## Flange clip — `clip_flange.scad` (params: flange_t, slot, clr, slot_edge, taper)
- Frame L 22.3 × H 22.96 × T 7.6. Back 6, arms 5, inner corners R2.
- Opening 12.96 = 10 stack + 2×0.2 + wedge mid 2.56.
- Lug 7.6 × 7.6, 4 mm tall, enters the bottom-flange slot, with 0.4 mm detent bumps at the tip.
- Wedge 5° (self-locking), 22 long, 1.6 → 3.52 thick, 0.35 ratchet teeth, 9 mm pull tab with a Ø3.6 hole.
- STL: `stl/clip_flange_frame.stl`, `stl/clip_flange_wedge.stl`

## C-clamp — `cclamp.scad` (throat=80 | 150)
- Frame thickness 12, bars 14, reach 45. Frame 59 × 108 (80) / 59 × 178 (150).
- Ø6.6 rod hole, captive M6 nut pocket 10.3 AF × 5.2 (slide-in). No printed threads.
- Knob Ø36 × 12 with a hex jam-nut pocket. Swivel pad Ø24 × 6 with a Ø6.4 snap socket.
- STL: `stl/cclamp80_frame.stl`, `stl/cclamp150_frame.stl`, `stl/cclamp_knob.stl`, `stl/cclamp_pad.stl`

## Hardware
- Per C-clamp: M6 threaded rod (~110 mm for the 80 throat, ~180 mm for the 150 throat) and 2 × M6 hex nuts.
- Clip: none.

## Print
- PETG, 5–6 walls, 40% infill, lay the parts flat (as exported), no supports.

## Previews
- `png/clip_flange_side_labeled.png`, `png/cclamp80_side_labeled.png`, `png/clip_flange_assembly.png`, `png/cclamp80_assembly.png`, `png/cclamp150_assembly.png`
- Legacy pocket clip (old blind-slot design): `clip.scad`, `legacy/clip8_*`
