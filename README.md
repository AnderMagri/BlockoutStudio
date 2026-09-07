# Blockout Studio

Block out a scene in 3D, light it like a real set, and export the
**depth maps, masks, normals and prompt** you feed to an image generator
such as Krea.

It is deliberately not a modelling app. Everything is neutral grey clay,
because the output is geometry and light — surface detail would only
mislead the model downstream.

---

## Running it

ES modules do not load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. No build step, no dependencies to
install — three.js comes from a CDN and the typeface is vendored.

It also works as-is on GitHub Pages (Settings → Pages → deploy from
`main`, root).

---

## What's in it

**Objects** — primitives, packaging silhouettes (bottle, can, jar, tube,
cup, carton), everyday objects (book, magazine, card, phone, rock,
boulder, cloud), a head, a poseable mannequin, extruded text and editable
splines.

**Cameras are objects.** Drop one in, move it with the gizmo, select it to
set the lens. Focal lengths are full-frame equivalents and the real focal
length is derived from the sensor format you choose, so "85 mm" looks like
85 mm on APS-C too. Depth of field is computed from the actual optics —
hyperfocal distance, near and far limits, and a circle of confusion that
changes with format.

**Lights are objects too.** Twelve rigs built the way they are built on a
real set — three-point, softbox, clamshell, Rembrandt, split, backlit rim,
window, golden hour, overcast, hard sun, high key, low key. Applying a rig
drops real light objects into the Lighting layer; select any one to change
its colour temperature, power, angle or softness.

**The mannequin** is a joint hierarchy, not a skinned mesh. Click any
purple joint to grab it — the gizmo switches to rotate and everything
below that joint follows. Seven preset poses to start from.

---

## Exports

| Pass | What it is |
|---|---|
| **Render** | The lit scene, as you see it |
| **Depth** | Linear view-space depth, near = white |
| **Normal** | Surface normals |
| **Mask** | The active layer white, everything else black |

All four live behind **Export…** in the top bar, along with the aspect
ratio, output size and the setup description.

Two things make the depth pass actually usable, and both are easy to get
wrong:

- It writes **linear** depth from a custom shader. three.js's
  `MeshDepthMaterial` writes the non-linear z-buffer value, which packs
  nearly the whole tonal range into the first few centimetres and leaves
  the subject as flat white.
- The range is fitted to **the subject's own geometry**, sampled from real
  vertices. Fitting to the whole set — a 6 m backdrop behind a 12 cm
  bottle — is what flattens a product into three grey levels.

Tone mapping is switched off for every data pass, so a white mask stays
white and the depth ramp is not bent by ACES.

The viewport is letterboxed to the export aspect ratio: what you frame is
exactly what you get.

---

## Driving it from a conversation

Open **Export… → Scene JSON**, copy what's there, and paste it to an
assistant along with what you want changed. Paste the JSON it gives back
and press **Build**.

```json
{
  "objects": [
    { "id": "bottle", "name": "Hero bottle", "position": [0, 0, 0], "layer": "Product" },
    { "id": "text", "text": "AURA", "size": 0.04, "position": [0, 0.01, 0.08] },
    { "id": "mannequin", "pose": "contrapposto", "position": [0.6, 0, 0] }
  ],
  "lighting": { "rig": "softbox" },
  "camera":   { "lens": 85, "fstop": 2.8, "focus": 0.6, "format": "ff", "shot": "hero" },
  "export":   { "aspect": "4:5", "resolution": 1536 }
}
```

Every field is optional. From the browser console:

```js
BlockoutStudio.vocabulary()      // every id, pose, rig and shot it understands
BlockoutStudio.serializeScene()  // the current scene as JSON
BlockoutStudio.applyScene({ ... })
```

### Would an MCP connector be better?

Yes, eventually — and this is the groundwork for it.

Copy-paste works today with zero infrastructure, which is why it exists
first. Its limit is that it is not a conversation: you paste, look, and
paste again.

An MCP server would let an assistant build and adjust the scene directly
while you talk about it — "move the key light round to the left, go
longer on the lens". That needs a small local Node process and a
WebSocket to this page, the same shape as a Figma plugin bridge. When it
gets built, its tools should call `applyScene` and `serializeScene` and
nothing else. **The JSON format above is the contract either way**, so
nothing you learn now is wasted.

---

## Adding new geometry

One entry in `js/catalog.js`:

```js
{ id:'lamp', label:'Lamp', make: () => new THREE.CylinderGeometry(...) }
```

`make` may return a geometry, a mesh or a whole `Object3D`. `rest:'float'`
leaves it in the air instead of sitting it on the floor. The Add menu,
the layer icons and the scene API all read from the catalog, so there is
nothing else to update.

Entries carrying a `special` flag (`text`, `spline`, `mannequin`,
`camera`, `light`) are routed to their own constructors in
`js/objects.js` — that is the seam for anything that needs more than a
geometry.

---

## Layout

```
index.html          markup only
css/
  base.css          tokens, type, controls
  panels.css        the floating HUD
  components.css    layers, galleries, inspector
js/
  main.js           boot
  catalog.js        ← everything you can add
  material.js       the shared clay surface
  figure.js         head + poseable mannequin
  text.js           extruded 3D text
  spline.js         editable swept curves
  viewport.js       renderer, set, controls, view switching
  optics.js         formats, lenses, framing, depth-of-field maths
  lights.js         light objects + rig gallery
  objects.js        create / select / destroy
  store.js          scene registry, layers, selection
  layers.js         layer panel
  inspector.js      contextual panel (lens lives here)
  export.js         render / depth / normal / mask
  prompt.js         setup → prompt text
  api.js            scene JSON in and out
  ui.js             the HUD wiring
```

---

## Keyboard

`W` move · `E` rotate · `R` scale · `F` fit to subject · `D` duplicate ·
`X` delete · `Esc` deselect
