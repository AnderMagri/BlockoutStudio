/* ============================================================
   api.js — the scene as data.

   This is the seam for driving Blockout Studio from outside the UI.
   A scene is plain JSON: describe what you want, call applyScene, and
   the studio builds it. serializeScene goes the other way.

   Exposed on window.BlockoutStudio so it can be driven from the console,
   from a pasted document, or later from an MCP server that speaks to the
   page over a local WebSocket. An MCP tool would be a thin wrapper around
   these same two functions — the format below is the contract.

   ── SCENE FORMAT ──────────────────────────────────────────────
   {
     "objects": [
       { "id":"bottle", "name":"Hero bottle",
         "position":[0,0,0], "rotation":[0,0,0], "scale":1,
         "layer":"Product" },
       { "id":"text", "text":"AURA", "size":0.04,
         "position":[0,0.01,0.08] },
       { "id":"mannequin", "pose":"contrapposto", "position":[0.4,0,0] }
     ],
     "lighting": { "rig":"softbox" },
     "camera":   { "lens":85, "fstop":2.8, "focus":0.6,
                   "format":"ff", "shot":"hero" },
     "set":      "infinite",
     "export":   { "aspect":"4:5", "resolution":1536 }
   }

   `set` is one of none | ground | backdrop | infinite.

   Every field is optional. `id` is any catalog id (see catalog.js).
   ============================================================ */

import * as THREE from 'three';

import * as store from './store.js';
import {
  addFromCatalog, addMannequinObject, setPose, applyRig, addCameraObject,
  addLightObject, addSplineObject,
  destroyItem, select, frameSubject, updateTextObject, fitShadowCameras
} from './objects.js';
import { CATEGORIES, catalogItem } from './catalog.js';
import { POSES } from './figure.js';
import { RIGS } from './lights.js';
import { LENSES, SHOTS, ASPECTS, RESOLUTIONS, FORMATS } from './optics.js';
import { toast } from './util.js';
import * as scenes from './scenes.js';
import { activeCamera as activeCameraForApi } from './viewport.js';

/* ---------------- helpers ---------------- */

const vec = (v, fallback = [0, 0, 0]) =>
  Array.isArray(v) && v.length === 3 ? v : fallback;

function layerNamed(name){
  if (!name) return null;
  const existing = store.state.layers.find(
    l => l.name.toLowerCase() === String(name).toLowerCase()
  );
  return existing || store.addLayer(String(name));
}

/* ---------------- apply ---------------- */

/**
 * Build a scene from a description.
 *
 * @param {object} scene           see the format above
 * @param {object} [opts]
 * @param {boolean} [opts.replace] clear existing objects first (default true)
 * @param {object}  [opts.hooks]   {setCamera, setExport} supplied by ui.js so
 *                                 the panels stay in sync with what was built
 * @returns {Promise<{added:number, warnings:string[]}>}
 *
 * Async because some objects cannot be built synchronously — the text
 * object waits on a typeface load. Awaiting a non-promise is free, so
 * every creation path goes through the same await.
 */
export async function applyScene(scene, { replace = true, hooks = {} } = {}){
  const warnings = [];
  if (!scene || typeof scene !== 'object') {
    return { added:0, warnings:['Scene is not an object.'] };
  }

  // Does this scene say anything about lighting? If not, the lights that
  // are already up are left alone — clearing them would hand back a black
  // stage to anyone who only meant to swap the objects.
  // A `lighting` block with `rig: null` means "deliberately unlit" — that is
  // how a scene whose lights were all deleted serializes, and it must not
  // reload with the old rig quietly rebuilt.
  const definesLights   = (scene.objects || []).some(o => o.id === 'light');
  const definesLighting = definesLights || (scene.lighting != null && 'rig' in scene.lighting);

  if (replace){
    for (const item of [...store.state.items]){
      if (item.kind === 'mesh')   { destroyItem(item); continue; }
      // Cameras always go: leaving them meant every rebuild added another,
      // so they piled up. A fresh one is created below if the scene has none.
      if (item.kind === 'camera') { destroyItem(item); continue; }
      if (item.kind === 'light' && definesLighting) destroyItem(item);
    }
    select(null);
  }

  /* ---- objects ---- */
  let added = 0;
  for (const spec of scene.objects || []){
    const def = catalogItem(spec.id);
    if (!def){ warnings.push(`Unknown object id: "${spec.id}"`); continue; }

    const layer = layerNamed(spec.layer);
    const previousActive = store.state.activeLayerId;
    if (layer) store.state.activeLayerId = layer.id;

    // Cameras, lights and splines carry settings that shape the object as it
    // is built — a light's type decides which THREE class is constructed, so
    // assigning params after the fact would leave an area light living in a
    // SpotLight. Build them from their spec directly.
    let item;
    if (spec.id === 'light'){
      item = addLightObject({ ...(spec.light || {}) }, layer?.id ?? null);
    } else if (spec.id === 'camera'){
      item = addCameraObject({ ...(spec.camera || {}) });
      if (layer) item.layerId = layer.id;
    } else if (spec.id === 'spline' && spec.spline){
      item = addSplineObject({
        ...spec.spline,
        points: Array.isArray(spec.spline.points) && spec.spline.points.length >= 2
          ? spec.spline.points.map(p => new THREE.Vector3(...vec(p)))
          : undefined
      });
    } else {
      item = await (spec.id === 'mannequin' ? addMannequinObject() : addFromCatalog(spec.id));
    }
    store.state.activeLayerId = previousActive;

    if (!item){ warnings.push(`Could not build "${spec.id}"`); continue; }
    added++;

    if (spec.name) item.name = spec.name;

    const [px, py, pz] = vec(spec.position);
    // Position is a nudge from where the studio placed it, not a hard set,
    // unless the caller gives an explicit position.
    if (spec.position) item.obj.position.set(px, py, pz);

    if (spec.rotation){
      const [rx, ry, rz] = vec(spec.rotation);
      item.obj.rotation.set(
        THREE.MathUtils.degToRad(rx),
        THREE.MathUtils.degToRad(ry),
        THREE.MathUtils.degToRad(rz)
      );
    }

    if (spec.scale != null){
      const s = typeof spec.scale === 'number' ? [spec.scale, spec.scale, spec.scale] : vec(spec.scale, [1,1,1]);
      item.obj.scale.set(...s);
    }

    if (spec.id === 'text' && item.obj.userData.textParams){
      const p = item.obj.userData.textParams;
      if (spec.text != null)  p.text = String(spec.text);
      if (spec.size != null)  p.size = +spec.size;
      if (spec.depth != null) p.depth = +spec.depth;
      await updateTextObject(item);
    }

    if (spec.id === 'mannequin'){
      if (spec.pose){
        if (POSES.some(p => p.id === spec.pose)) setPose(item, spec.pose);
        else warnings.push(`Unknown pose: "${spec.pose}"`);
      }
      // Hand-posed joints, saved on top of the preset they started from.
      if (spec.joints && item.joints){
        for (const [name, rot] of Object.entries(spec.joints)){
          const [jx, jy, jz] = vec(rot);
          item.joints.get(name)?.rotation.set(
            THREE.MathUtils.degToRad(jx),
            THREE.MathUtils.degToRad(jy),
            THREE.MathUtils.degToRad(jz)
          );
        }
        item.obj.updateMatrixWorld(true);
      }
      // setPose re-seats the figure on the floor, which tramples an explicit
      // position (a mannequin saved sitting on a box would snap to y=0) —
      // the saved position was captured after flooring, so it wins.
      if (spec.position) item.obj.position.set(px, py, pz);
    }
  }

  /* ---- lighting ---- */
  // Explicit lights win: if the scene lists them, applying the rig on top
  // would duplicate every fixture.
  if (scene.lighting?.rig && !definesLights){
    const rig = applyRig(scene.lighting.rig);
    if (!rig) warnings.push(`Unknown lighting rig: "${scene.lighting.rig}"`);
    else hooks.setRig?.(rig);
  } else if (definesLighting){
    // Explicit fixtures or a cleared rig: no preset describes this lighting.
    hooks.setRig?.(null);
  }

  // There is always a camera.
  if (!store.itemsOfKind('camera').length) addCameraObject();

  /* ---- stage, camera and export ---- */
  if (scene.set != null || scene.compositionLight != null){
    hooks.setStage?.({ set: scene.set, compositionLight: scene.compositionLight });
  }
  if (scene.export) hooks.setExport?.(scene.export);
  if (scene.camera) hooks.setCamera?.(scene.camera);

  fitShadowCameras();
  store.applyVisibility();
  store.changed();
  hooks.afterBuild?.();

  return { added, warnings };
}

/* ---------------- serialise ---------------- */

/** Capture the current scene in the same format applyScene accepts. */
export function serializeScene(cameraState = {}){
  const deg = r => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10;
  const round = n => Math.round(n * 1000) / 1000;

  const objects = store.state.items
    .filter(i => i.kind === 'mesh' || i.kind === 'camera' || i.kind === 'light')
    .map(item => {
      if (item.kind === 'camera'){
        return {
          id:'camera', name:item.name,
          position:[round(item.obj.position.x), round(item.obj.position.y), round(item.obj.position.z)],
          rotation:[deg(item.obj.rotation.x), deg(item.obj.rotation.y), deg(item.obj.rotation.z)],
          layer: store.getLayer(item.layerId)?.name,
          camera:{ ...item.params }
        };
      }
      if (item.kind === 'light'){
        return {
          id:'light', name:item.name,
          layer: store.getLayer(item.layerId)?.name,
          light:{ ...item.params }
        };
      }
      const spec = {
        id: item.sub,
        name: item.name,
        position: [round(item.obj.position.x), round(item.obj.position.y), round(item.obj.position.z)],
        layer: store.getLayer(item.layerId)?.name
      };
      const r = item.obj.rotation;
      if (r.x || r.y || r.z) spec.rotation = [deg(r.x), deg(r.y), deg(r.z)];
      const s = item.obj.scale;
      if (s.x !== 1 || s.y !== 1 || s.z !== 1) spec.scale = [round(s.x), round(s.y), round(s.z)];

      if (item.sub === 'text'){
        const p = item.obj.userData.textParams;
        spec.text = p.text; spec.size = p.size; spec.depth = p.depth;
      }
      if (item.sub === 'mannequin'){
        spec.pose = item.params?.pose;
        // The preset is a starting point; hand-posed joints are the work.
        if (item.joints){
          spec.joints = {};
          for (const [name, node] of item.joints){
            spec.joints[name] = [deg(node.rotation.x), deg(node.rotation.y), deg(node.rotation.z)];
          }
        }
      }
      if (item.sub === 'spline' && item.spline){
        const p = item.spline.params;
        spec.spline = {
          radius: p.radius, tension: p.tension, closed: p.closed,
          points: p.points.map(v => [round(v.x), round(v.y), round(v.z)])
        };
      }
      return spec;
    });

  // No light objects means deliberately unlit — the last rig id would only
  // resurrect fixtures the user deleted.
  const hasLights = store.state.items.some(i => i.kind === 'light');

  return {
    objects,
    lighting: { rig: hasLights ? cameraState.rigId ?? null : null },
    camera: {
      lens:   cameraState.equiv,
      fstop:  cameraState.fstop,
      focus:  cameraState.focus,
      format: cameraState.formatId,
      shot:   cameraState.shotId ?? null
    },
    set: store.state.setMode,
    compositionLight: store.state.compositionMode,
    export: { aspect: cameraState.aspect, resolution: cameraState.resolution }
  };
}

/* ---------------- vocabulary ---------------- */

/**
 * Everything a caller is allowed to say, in one object. Paste this into a
 * conversation and the other end knows exactly what the studio understands.
 */
export function vocabulary(){
  return {
    objects: CATEGORIES.map(c => ({
      category: c.label,
      ids: c.items.map(i => i.id)
    })),
    poses:       POSES.map(p => p.id),
    lightingRigs: RIGS.map(r => r.id),
    lenses:      LENSES.map(l => l.equiv),
    shots:       SHOTS.map(s => s.id),
    formats:     Object.keys(FORMATS),
    aspects:     ASPECTS.map(a => a.id),
    resolutions: RESOLUTIONS,
    sets:        Object.keys(store.SET_MODES)
  };
}

/* ---------------- public handle ---------------- */

/**
 * Install window.BlockoutStudio. ui.js supplies the hooks that reach into
 * panel state. This object is the whole remote-control surface: the MCP
 * bridge calls nothing else.
 */
export function installGlobalAPI(hooks){
  const api = {
    applyScene: async (scene, opts = {}) => {
      const result = await applyScene(scene, { ...opts, hooks });
      if (result.warnings.length) console.warn('[Blockout Studio]', result.warnings);
      toast(`Built ${result.added} object${result.added === 1 ? '' : 's'}` +
            (result.warnings.length ? ` · ${result.warnings.length} warning(s)` : ''));
      return result;
    },
    serializeScene: () => serializeScene(hooks.cameraState?.() ?? {}),
    vocabulary,

    /** Discard everything and start over on the default boot scene. */
    newScene(){
      const result = hooks.newScene?.() ?? { ok:false, error:'newScene hook missing' };
      toast('New scene');
      return result;
    },

    /** Fit the active camera to the subject. */
    frameSubject: () => frameSubject(activeCameraForApi()),

    /** Adjust the camera without rebuilding anything. */
    setCamera(spec){
      hooks.setCamera?.(spec);
      return { ok:true, camera: hooks.cameraState?.() };
    },

    /** Swap the lighting rig, leaving the objects alone. */
    setLighting(rigId){
      const rig = applyRig(rigId);
      if (!rig) throw new Error(`Unknown lighting rig: "${rigId}"`);
      hooks.setRig?.(rig);
      return { ok:true, rig: rig.id, description: rig.note };
    },

    /** The studio's own prose description of the current setup. */
    describeSetup: () => hooks.describeSetup?.() ?? '',

    /**
     * Render a pass and return the pixels, so a caller can save them
     * somewhere the UI's download path cannot reach.
     */
    capturePass: (pass, resolution, opts) =>
      hooks.capturePass?.(pass, resolution, opts),

    /* ---- saved scenes ---- */

    listScenes: scenes.listScenes,

    saveScene(name){
      return scenes.saveScene(name, serializeScene(hooks.cameraState?.() ?? {}));
    },

    async loadScene(name){
      const scene = scenes.loadScene(name);
      await applyScene(scene, { hooks });
      return { loaded: name, objects: scene.objects?.length ?? 0 };
    },

    deleteScene: scenes.deleteScene
  };

  window.BlockoutStudio = api;
  return api;
}
