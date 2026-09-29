# HQ 3D assets

The ID SYSTEM HQ diorama is built to take real GLB/GLTF models. **None ship
with this repo yet.** This is a network constraint of the sandbox this was
built in, not a design choice: every CC0/permissive model host checked
(kenney.nl, poly.pizza, opengameart.org, itch.io, image3d.io, sketchfab.com)
returned `403 Forbidden` from this environment's outbound proxy — an
allowlist, not a licensing problem. Nothing here was skipped for lack of
trying; there was no route to fetch and vet a file.

Until a human with normal internet access adds real models, every asset key
renders its procedural placeholder — built to validate scale, layout,
interaction and animation states, not to be the final look.

## How to add a real model

1. Drop the `.glb` at the path listed below (under `public/models/`).
2. Open `src/components/universe/hq/assets/asset-manifest.ts` and flip that
   entry's `enabled` to `true`. Adjust `scale`/`rotationY` if the model's
   native scale or forward axis doesn't match what's already placed.
3. Reload `/dev/assets` (development only) to confirm it reads **GLB
   LOADED** rather than **ENABLED BUT MISSING**.

No other file needs to change — every room asks for an asset by key
(`ASSET_KEYS.OFFICE_CHAIR`, etc.) via `<WorldAsset>`, never by path, so the
swap from procedural fallback to real model is contained to the manifest.

## Expected files

| Key | Path | Notes |
|---|---|---|
| `OFFICE_DESK` | `public/models/office/desk.glb` | ~0.75m tall top |
| `OFFICE_CHAIR` | `public/models/office/chair.glb` | ~0.85m tall |
| `MONITOR` | `public/models/office/monitor.glb` | single screen |
| `DUAL_MONITOR` | `public/models/office/dual-monitor.glb` | two screens side by side |
| `RECEPTION_DESK` | `public/models/office/reception-desk.glb` | wider, front-desk shape |
| `WALL_SCREEN` | `public/models/office/wall-screen.glb` | large flat panel |
| `SOFA` | `public/models/decoration/sofa.glb` | |
| `PLANT` | `public/models/decoration/plant.glb` | |
| `CABINET` | `public/models/decoration/cabinet.glb` | |
| `SERVER_RACK` | `public/models/infrastructure/server-rack.glb` | ~2m tall |
| `SERVER_TOWER` | `public/models/infrastructure/server.glb` | small tower, for DATABASE resources |
| `EMPLOYEE_STANDARD` | `public/models/people/employee-01.glb` | ~1.7m tall, rigged |
| `EMPLOYEE_ALT` | `public/models/people/employee-02.glb` | second silhouette for variety |

## Scale reference

Everything in the scene is built against one human scale
(`src/components/universe/hq/scale.ts`):

- Digital employee ≈ **1.7** world units tall
- Door opening ≈ **2.2**
- Desk height ≈ **0.75**
- Wall height ≈ **2.5**
- Server rack ≈ **2.0**

Normalize any imported model against these before enabling it — a model
that comes in native units 100x too large or too small will look wrong next
to everything already placed.

## Licensing (fill in as models are added)

Every external asset actually used must be listed here before its manifest
entry is enabled. Empty because nothing has been added yet.

| Asset | Source | Author | License | Original URL | Local Path |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

Prefer CC0 / Public Domain / MIT-compatible sources. A permissive license
that requires attribution (e.g. CC-BY) is acceptable — record the
attribution in this table. Never add a model without knowing its license,
and never commit a model whose license forbids this use.
