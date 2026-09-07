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
     "export":   { "aspect":"4:5", "resolution":1536 }
   }

   Every field is optional. `id` is any catalog id (see catalog.js).
   ============================================================ */

import * as THREE from 'three';

import * as store from './store.js';
import {
  addFromCatalog, addMannequinObject, setPose, applyRig,
  destroyItem, select, frameSubject, updateTextObject
} from './objects.js';
import { CATEGORIES, catalogItem } from './catalog.js';
import { POSES } from './figure.js';
import { RIGS } from './lights.js';
import { LENSES, SHOTS, ASPECTS, RESOLUTIONS, FORMATS } from './optics.js';
import { toast } from './util.js';

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
 * @returns {{added:number, warnings:string[]}}
 */
export function applyScene(scene, { replace = true, hooks = {} } = {}){
  const warnings = [];
  if (!scene || typeof scene !== 'object') {
    return { added:0, warnings:['Scene is not an object.'] };
  }

  if (replace){
    for (const item of [...store.state.items]){
      if (item.kind === 'mesh') destroyItem(item);
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

    const item = spec.id === 'mannequin' ? addMannequinObject() : addFromCatalog(spec.id);
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
      updateTextObject(item);
    }

    if (spec.id === 'mannequin' && spec.pose){
      if (POSES.some(p => p.id === spec.pose)) setPose(item, spec.pose);
      else warnings.push(`Unknown pose: "${spec.pose}"`);
    }
  }

  /* ---- lighting ---- */
  if (scene.lighting?.rig){
    const rig = applyRig(scene.lighting.rig);
    if (!rig) warnings.push(`Unknown lighting rig: "${scene.lighting.rig}"`);
    else hooks.setRig?.(rig);
  }

  /* ---- camera and export ---- */
  if (scene.export) hooks.setExport?.(scene.export);
  if (scene.camera) hooks.setCamera?.(scene.camera);

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
    .filter(i => i.kind === 'mesh')
    .map(item => {
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
      if (item.sub === 'mannequin') spec.pose = item.params?.pose;
      return spec;
    });

  return {
    objects,
    lighting: { rig: cameraState.rigId ?? null },
    camera: {
      lens:   cameraState.equiv,
      fstop:  cameraState.fstop,
      focus:  cameraState.focus,
      format: cameraState.formatId,
      shot:   cameraState.shotId ?? null
    },
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
    resolutions: RESOLUTIONS
  };
}

/* ---------------- public handle ---------------- */

/** Install window.BlockoutStudio. ui.js supplies the camera/export hooks. */
export function installGlobalAPI(hooks){
  const api = {
    applyScene: (scene, opts = {}) => {
      const result = applyScene(scene, { ...opts, hooks });
      if (result.warnings.length) console.warn('[Blockout Studio]', result.warnings);
      toast(`Built ${result.added} object${result.added === 1 ? '' : 's'}` +
            (result.warnings.length ? ` · ${result.warnings.length} warning(s)` : ''));
      return result;
    },
    serializeScene: () => serializeScene(hooks.cameraState?.() ?? {}),
    vocabulary,
    frameSubject
  };
  window.BlockoutStudio = api;
  return api;
}
