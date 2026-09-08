/* ============================================================
   store.js — scene object registry, layers, selection.

   One flat list holds everything the user can select: meshes, cameras
   and lights alike. That is what lets a camera or a light be dropped in
   and manipulated exactly like a primitive.
   ============================================================ */

/**
 * @typedef {Object} SceneItem
 * @property {number}  id
 * @property {string}  name
 * @property {'mesh'|'camera'|'light'|'set'} kind
 * @property {string}  sub       specific type: 'box', 'bottle', 'text', 'spot'…
 * @property {Object}  obj       the THREE.Object3D placed in the scene
 * @property {number}  layerId
 * @property {boolean} locked    set dressing: selectable but not deletable
 * @property {Object}  params    kind-specific settings
 * @property {Object=} helper    visual helper (cameras, lights)
 */

export const state = {
  /** @type {SceneItem[]} */
  items: [],
  /** @type {{id:number,name:string,visible:boolean}[]} */
  layers: [],
  activeLayerId: null,
  soloLayerId: null,
  /** @type {SceneItem|null} */
  selected: null,
  /** Flat working light on, every rig light muted. Non-destructive. */
  compositionMode: false,
  /** 'none' | 'ground' | 'backdrop' | 'infinite' */
  setMode: 'backdrop'
};

/**
 * Which set pieces a given mode uses.
 *   none      nothing — objects float against empty space, which gives the
 *             cleanest possible depth and mask passes
 *   ground    floor only, open horizon
 *   backdrop  floor meeting a vertical wall, with a visible corner
 *   infinite  a seamless cove, no seam and no horizon line
 */
export const SET_MODES = {
  none:     [],
  ground:   ['ground'],
  backdrop: ['ground', 'backdrop'],
  infinite: ['cyclorama']
};

export const setPieceLive = (sub, mode = state.setMode) =>
  (SET_MODES[mode] || SET_MODES.backdrop).includes(sub);

let itemSeq = 0;
let layerSeq = 0;

/* ---------------- events ---------------- */

const listeners = new Map();

/** Subscribe to a store event. Returns an unsubscribe function. */
export function on(event, fn){
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload){
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) fn(payload);
}

/** Most mutations end with this: repaint every panel that reads the store. */
export const changed = () => emit('change');

/* ---------------- layers ---------------- */

export function addLayer(name){
  const layer = { id: ++layerSeq, name, visible: true };
  state.layers.push(layer);
  if (state.activeLayerId == null) state.activeLayerId = layer.id;
  return layer;
}

export const getLayer  = id => state.layers.find(l => l.id === id) || null;
export const activeLayer = () => getLayer(state.activeLayerId);

export function removeLayer(id){
  if (state.layers.length <= 1) return false;
  const idx = state.layers.findIndex(l => l.id === id);
  if (idx < 0) return false;

  const fallback = state.layers.find(l => l.id !== id);
  for (const item of state.items){
    if (item.layerId === id) item.layerId = fallback.id;
  }
  state.layers.splice(idx, 1);

  if (state.activeLayerId === id) state.activeLayerId = fallback.id;
  if (state.soloLayerId   === id) state.soloLayerId   = null;
  return true;
}

export const itemsInLayer = id => state.items.filter(i => i.layerId === id);

/* ---------------- items ---------------- */

export function addItem(item){
  item.id = ++itemSeq;
  if (item.layerId == null) item.layerId = state.activeLayerId;
  if (item.locked == null)  item.locked = false;
  if (item.params == null)  item.params = {};
  state.items.push(item);
  return item;
}

export function removeItem(item){
  const idx = state.items.indexOf(item);
  if (idx >= 0) state.items.splice(idx, 1);
  if (state.selected === item) state.selected = null;
}

export const itemFor = object3D =>
  state.items.find(i => i.obj === object3D) || null;

/** Walk up from a raycast hit to the registered item that owns it. */
export function itemForDescendant(object3D){
  let node = object3D;
  while (node){
    const hit = itemFor(node);
    if (hit) return hit;
    node = node.parent;
  }
  return null;
}

export const itemsOfKind = kind => state.items.filter(i => i.kind === kind);

/** Meshes that count as "the subject" — everything but locked set dressing. */
export const subjectMeshes = () =>
  state.items.filter(i => i.kind === 'mesh' && !i.locked && i.obj.visible);

/** Every mesh currently visible, subject and set alike. */
export const visibleMeshes = () =>
  state.items.filter(i => (i.kind === 'mesh' || i.kind === 'set') && i.obj.visible);

/** Unique name within its kind: "Box 3", "Camera 2"… */
export function nextName(base){
  // The base comes from user-editable names, so it must be matched
  // literally — duplicating an object renamed "C++" is not a regex error.
  const literal = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${literal} (\\d+)$`);
  let n = 0;
  for (const item of state.items){
    const m = item.name.match(pattern);
    if (m) n = Math.max(n, +m[1]);
  }
  return `${base} ${n + 1}`;
}

/* ---------------- visibility ---------------- */

/**
 * Apply layer visibility and solo to every item. Cameras and lights follow
 * their layer too, so hiding the Lighting layer really does kill the lights.
 */
export function applyVisibility(){
  const solo = state.soloLayerId;
  for (const item of state.items){
    const layer = getLayer(item.layerId);
    let on = !layer ? true : (solo ? layer.id === solo : layer.visible);

    // Composition mode mutes every rig light without deleting one, so the
    // setup you tuned is still there when you switch back.
    if (on && item.kind === 'light' && state.compositionMode) on = false;

    // Set pieces answer to the chosen set as well as to their layer.
    if (on && item.kind === 'set') on = setPieceLive(item.sub);

    item.obj.visible = on;

    // A camera cannot see its own frustum. Without this the helper of the
    // camera you are looking through is drawn from the inside, filling the
    // view with lines — which reads as "look through is broken".
    if (item.helper) item.helper.visible = on && !item.isActiveView;
  }
}
