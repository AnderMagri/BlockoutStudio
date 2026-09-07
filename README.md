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
splines. **Add object** opens a picker of tabbed cards, and each card's
picture is rendered from the real geometry at startup — so a new catalog
entry gets its artwork for free and the picture can never drift from the
shape it represents.

**Cameras are objects.** Drop one in, move it with the gizmo, select it to
set the lens. The view switcher at the top left separates *arranging* the
set from *framing* through a camera, and a camera can be locked so a stray
drag cannot move a framing you were happy with. Focal lengths are full-frame equivalents and the real focal
length is derived from the sensor format you choose, so "85 mm" looks like
85 mm on APS-C too. Depth of field is computed from the actual optics —
hyperfocal distance, near and far limits, and a circle of confusion that
changes with format.

**The set** is switchable: none, ground only, ground plus backdrop, or an
infinite cove — a seamless sweep with no corner and no horizon, which is
the white-studio look. "None" leaves your objects against empty space and
gives the cleanest depth and mask passes.

**Composition light** is a flat, shadowless working light for arranging a
scene. It mutes the lighting rig rather than replacing it, so the rig you
tuned is still there when you switch back.

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

## Measurements

Everything is modelled at real scale — a 330 ml can really is 66 × 122 mm,
and the depth-of-field maths depends on that being true.

Select an object and the **Size** block gives its actual width, height and
depth. Type a number to make it exactly that big; type `120mm` while the
panel is showing centimetres and it understands. Units are mm, cm, m or
inches, and the choice applies to every readout in the app. The floor grid
is 50 mm per square.

Sizes are measured in the object's own frame, so turning something 45°
does not change its stated size — a world-space bounding box around a
rotated bottle is bigger than the bottle.

---

## Saving scenes

**Scenes…** in the top bar. Name the current scene and save it; reopen,
download or delete it from the list. A scene is the same JSON the scene
API speaks, so a saved scene, a pasted one and one an assistant built are
all the same thing.

Saves live in the browser's local storage, which means saving works with
no server running. It also means they are tied to that browser — so for
anything you want to keep properly, or hand to someone else, use
**Download** and you get a real file. **Import file…** reads one back.

A recovery copy of your work is kept quietly in the background and offered
as *Restore last session* in the same panel. It is never applied
automatically: the studio opens on the same default scene every time,
because a demo that opens differently depending on what you did yesterday
is a bad demo.

Over MCP: `list_scenes`, `save_scene`, `load_scene`.

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

## Connecting it to an assistant (MCP)

`mcp/server.js` is an MCP server with **zero dependencies** — nothing to
install, nothing to fail during a demo. It does three jobs at once:

1. Serves the studio at <http://localhost:8787>
2. Holds an event stream open to the page so an assistant can drive it
3. Speaks MCP over stdio to Claude

### Set up

Register it once with Claude Code:

```bash
claude mcp add blockout -- node /absolute/path/to/BlockoutStudio/mcp/server.js
```

For Claude Desktop, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blockout": {
      "command": "node",
      "args": ["/absolute/path/to/BlockoutStudio/mcp/server.js"]
    }
  }
}
```

Then open <http://localhost:8787> and leave the tab open. The dot in the
top-left pill turns purple when the studio and the assistant are talking.

You can also run the server by hand — it serves the site either way:

```bash
node mcp/server.js
```

### Tools

| Tool | What it does |
|---|---|
| `studio_status` | Is a page connected? Call this first if anything fails |
| `get_vocabulary` | Every object id, pose, rig, lens and shot it understands |
| `get_scene` | The current scene as JSON |
| `build_scene` | Build a scene from a description |
| `set_camera` | Change lens, aperture, focus or framing |
| `set_lighting` | Swap the lighting rig |
| `export_image` | Render a pass to `exports/` and return the file path |
| `describe_setup` | The prose description of the current setup |

`export_image` returns a **path rather than image data**. That is
deliberate: a 1536px depth map is about 2 MB of base64, which has no
business travelling through a tool result — and a path means the
assistant can open the file and actually look at what it made, then
adjust and re-render.

### How it works

The server pushes commands to the page over Server-Sent Events; results
and rendered PNGs come back as ordinary POSTs. SSE rather than a
WebSocket because it is plain HTTP — no handshake to implement, no frame
masking to get wrong, and `EventSource` reconnects by itself when the
page reloads or the server restarts.

Everything routes through `window.BlockoutStudio`. If a command cannot be
expressed through that object, the fix belongs in `api.js`, not in the
bridge.

### Known limits

- **The page must be open.** No tab, no tools. `studio_status` says so
  plainly rather than hanging.
- One studio tab at a time is the sane setup. Several tabs all receive
  the commands and the first answer wins.
- The server binds to `127.0.0.1` only.
- Port 8787 by default; set `BLOCKOUT_PORT` to change it.

---

## Adding new geometry

One entry in `js/catalog.js`:

```js
{ id:'lamp', label:'Lamp', make: () => new THREE.CylinderGeometry(...) }
```

`make` may return a geometry, a mesh or a whole `Object3D`. `rest:'float'`
leaves it in the air instead of sitting it on the floor. The picker, its
thumbnail, the layer icons and the scene API all read from the catalog, so
there is nothing else to update — including the artwork.

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
  thumbnails.js     card artwork, rendered from the catalog
  bridge.js         talks to the MCP server
  ui.js             the HUD wiring
mcp/
  server.js         MCP server + static host, zero dependencies
```

---

## Keyboard

`W` move · `E` rotate · `R` scale · `F` frame the selection (or the whole
scene when nothing is selected) · `D` duplicate · `X` delete · `Esc`
deselect

**⊙ Orbit** in the top bar switches the centre of rotation between
whatever you have selected and the scene as a whole. Selecting something
moves the pivot to it without swinging the view around, so clicking things
to inspect them stays calm.
