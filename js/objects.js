/* ============================================================
   objects.js — creating, selecting and destroying scene items.

   Meshes, cameras and lights all become entries in the same store, so
   the layer panel, the gizmo and the inspector treat them identically.
   ============================================================ */

import * as THREE from 'three';

import * as store from './store.js';
import {
  scene, helpers, extraHelpers, gizmo, orbit,
  ground, backdrop, freeCamera, activeCamera, setActiveCamera, pointerToNDC
} from './viewport.js';
import { makeCatalogObject, labelFor, catalogItem } from './catalog.js';
import { makeMannequin, buildJointHandles, highlightJointHandle, applyPose, poseById } from './figure.js';
import { makeText, rebuildText } from './text.js';
import {
  makeSpline, rebuildSpline, setHandlesVisible, highlightHandle
} from './spline.js';
import { makeLight, applyLightParams, unplace, rigById } from './lights.js';
import { FORMATS, focalFromEquiv } from './optics.js';
import { toast } from './util.js';

/* ---------------- selection outline ---------------- */

const outline = new THREE.BoxHelper(undefined, 0xBF5AF2);
outline.visible = false;
helpers.add(outline);

/** Handle mesh currently driven by the gizmo, when a spline point is grabbed. */
let activeHandle = null;
export const getActiveHandle = () => activeHandle;

/* ---------------- bootstrap ---------------- */

export function initScene(){
  store.addLayer('Product');
  const lighting = store.addLayer('Lighting');
  const cameras  = store.addLayer('Cameras');
  const set      = store.addLayer('Set');

  store.addItem({
    name:'Ground', kind:'set', sub:'ground', obj:ground, layerId:set.id, locked:true
  });
  store.addItem({
    name:'Backdrop', kind:'set', sub:'backdrop', obj:backdrop, layerId:set.id, locked:true
  });

  store.state.activeLayerId = store.state.layers[0].id;
  return { lighting, cameras, set };
}

/** Named layers the app puts things into automatically. */
const namedLayer = name =>
  store.state.layers.find(l => l.name === name) || store.state.layers[0];

export const lightingLayer = () => namedLayer('Lighting');
export const cameraLayer   = () => namedLayer('Cameras');

/* ---------------- meshes ---------------- */

const _placeBox = new THREE.Box3();
const _newBox   = new THREE.Box3();

/**
 * Stand a new object beside what is already on the table rather than
 * dropping everything on the origin inside one another.
 */
function placeBeside(object3D){
  const existing = store.subjectMeshes();
  if (!existing.length) return;

  _placeBox.makeEmpty();
  for (const item of existing) _placeBox.expandByObject(item.obj);
  if (_placeBox.isEmpty()) return;

  _newBox.setFromObject(object3D);
  const halfWidth = (_newBox.max.x - _newBox.min.x) / 2;

  object3D.position.x = _placeBox.max.x + halfWidth + 0.025;
}

function registerMesh(mesh, sub, nameBase){
  scene.add(mesh);
  placeBeside(mesh);
  const item = store.addItem({
    name: store.nextName(nameBase), kind:'mesh', sub, obj:mesh
  });
  fitShadowCameras();
  store.applyVisibility();
  select(item);
  store.changed();
  return item;
}

/**
 * Add any catalog entry by id. The Add menus are built straight from the
 * catalog, and entries carrying a `special` flag are routed to their own
 * constructor — that is the seam for adding new kinds of object later.
 */
export function addFromCatalog(id){
  const def = catalogItem(id);
  if (!def) { toast(`Unknown item: ${id}`, true); return null; }

  switch (def.special){
    case 'text':      return addTextObject();
    case 'spline':    return addSplineObject();
    case 'mannequin': return addMannequinObject();
    case 'camera':    return addCameraObject();
    case 'light':     { const it = addLightObject({ type:'spot', az:40, el:40, power:8 });
                        select(it); store.changed(); return it; }
    default:          return registerMesh(makeCatalogObject(id), id, labelFor(id));
  }
}

/* ---------------- mannequin ---------------- */

export function addMannequinObject(){
  const { root, joints } = makeMannequin();
  scene.add(root);
  placeBeside(root);

  // Handles must be children of their joints to follow the pose, so they
  // cannot live in the helpers group. Register them for export hiding.
  const handles = buildJointHandles(joints);
  for (const h of handles) extraHelpers.push(h);

  const item = store.addItem({
    name: store.nextName('Mannequin'), kind:'mesh', sub:'mannequin', obj:root
  });
  item.joints  = joints;
  item.handles = handles;
  item.params  = { pose:'relaxed' };

  store.applyVisibility();
  select(item);
  store.changed();
  return item;
}

/** Drop a preset pose onto a mannequin. */
export function setPose(item, poseId){
  if (!item?.joints) return;
  applyPose(item.joints, poseById(poseId));
  item.params.pose = poseId;
  refreshOutline();
}

/** Show or hide a mannequin's joint grab handles. */
function setHandlesShown(item, shown){
  if (!item?.handles) return;
  for (const h of item.handles) h.visible = shown;
}

export async function addTextObject(){
  try {
    const mesh = await makeText();
    return registerMesh(mesh, 'text', 'Text');
  } catch (err){
    toast(err.message || 'Could not build the text object.', true);
    return null;
  }
}

export async function updateTextObject(item){
  await rebuildText(item.obj);
  refreshOutline();
}

export function addSplineObject(){
  const spline = makeSpline();
  scene.add(spline.group);
  placeBeside(spline.group);
  helpers.add(spline.handles);

  const item = store.addItem({
    name: store.nextName('Spline'), kind:'mesh', sub:'spline', obj:spline.group
  });
  item.spline = spline;

  store.applyVisibility();
  select(item);
  store.changed();
  return item;
}

/* ---------------- cameras ---------------- */

export function addCameraObject(params = {}){
  const p = {
    formatId: params.formatId ?? 'ff',
    equiv:    params.equiv    ?? 85,
    fstop:    params.fstop    ?? 2.8,
    focus:    params.focus    ?? 0.6
  };
  const format = FORMATS[p.formatId];

  const cam = new THREE.PerspectiveCamera(35, 4 / 5, 0.01, 100);
  cam.filmGauge = format.gauge;
  cam.setFocalLength(focalFromEquiv(p.equiv, format));

  // Drop it where the user is looking from, aimed at what they are looking at.
  cam.position.copy(activeCamera().position);
  cam.lookAt(orbit.target);
  scene.add(cam);

  const helper = new THREE.CameraHelper(cam);
  helpers.add(helper);

  const item = store.addItem({
    name: store.nextName('Camera'), kind:'camera', sub:'camera',
    obj: cam, helper, params: p, layerId: cameraLayer().id
  });

  store.applyVisibility();
  select(item);
  store.changed();
  return item;
}

/** Re-apply lens params to a camera item. */
export function applyCameraParams(item){
  const format = FORMATS[item.params.formatId];
  item.obj.filmGauge = format.gauge;
  item.obj.setFocalLength(focalFromEquiv(item.params.equiv, format));
  item.obj.updateProjectionMatrix();
  item.helper?.update();
}

/* ---------------- lights ---------------- */

export function addLightObject(params = {}, layerId = null, nameOverride = null){
  // makeLight fills in every default and hands the complete set back.
  const { light, helper, helperIsChild, target, params: built } = makeLight(params);

  scene.add(light);
  if (target) scene.add(target);

  if (helper){
    if (helperIsChild){
      light.add(helper);
      extraHelpers.push(helper);
    } else {
      helpers.add(helper);
    }
  }

  const item = store.addItem({
    name: nameOverride || store.nextName('Light'),
    kind:'light', sub: built.type,
    obj: light, helper, params: built,
    layerId: layerId ?? lightingLayer().id
  });
  item.lightTarget = target;
  item.helperIsChild = !!helperIsChild;

  store.applyVisibility();
  return item;
}

export function updateLight(item){
  applyLightParams(item.obj, item.params, item.lightTarget);
  item.helper?.update?.();
  refreshOutline();
}

/**
 * Replace every light in the Lighting layer with a preset rig.
 * Lights the user put in other layers are left alone.
 */
export function applyRig(rigId){
  const rig = rigById(rigId);
  if (!rig) return null;

  const layer = lightingLayer();
  for (const item of store.itemsInLayer(layer.id).filter(i => i.kind === 'light')){
    destroyItem(item);
  }

  for (const spec of rig.lights){
    addLightObject(spec, layer.id, spec.name);
  }

  fitShadowCameras();
  store.applyVisibility();
  store.changed();
  return rig;
}

/* ---------------- selection ---------------- */

export function select(item, handleMesh = null){
  // Leaving an object with handles puts them away.
  const prev = store.state.selected;
  if (prev && prev !== item){
    if (prev.spline)  setHandlesVisible(prev.spline, false);
    if (prev.handles) setHandlesShown(prev, false);
  }

  store.state.selected = item;
  activeHandle = handleMesh;

  if (!item){
    gizmo.detach();
    outline.visible = false;
    store.changed();
    return;
  }

  // Deliberately does NOT change the active layer. Lights are created into
  // the Lighting layer and auto-selected; if selection moved the active
  // layer, the next primitive you added would silently land there too.
  // The active layer is changed by clicking a layer header, nothing else.

  if (item.spline){
    setHandlesVisible(item.spline, true);
    highlightHandle(item.spline, handleMesh);
  }
  if (item.handles){
    setHandlesShown(item, true);
    highlightJointHandle(item.handles, handleMesh);
  }

  if (handleMesh?.userData.joint){
    // A joint only ever rotates — translating one would tear the figure apart.
    gizmo.attach(handleMesh.userData.joint.node);
    gizmo.setMode('rotate');
  } else {
    gizmo.attach(handleMesh || item.obj);
  }
  refreshOutline();
  store.changed();
}

export function refreshOutline(){
  const item = store.state.selected;
  if (!item || item.kind === 'light' || !item.obj.visible){
    outline.visible = false;
    return;
  }
  try {
    outline.setFromObject(item.obj);
    outline.visible = true;
  } catch {
    outline.visible = false;
  }
}

/* ---------------- picking ---------------- */

const ray = new THREE.Raycaster();

/** Raycast at a pointer position; select whatever is under it. */
export function pickAt(clientX, clientY){
  const ndc = pointerToNDC(clientX, clientY);
  if (!ndc){ select(null); return; }

  ray.setFromCamera(ndc, activeCamera());

  // Handles on the current selection win — they are drawn on top of everything.
  const sel = store.state.selected;
  if (sel?.obj.visible){
    const handleMeshes = sel.spline ? sel.spline.handles.children : sel.handles;
    if (handleMeshes?.length){
      const hit = ray.intersectObjects(handleMeshes, false)[0];
      if (hit){ select(sel, hit.object); return; }
    }
  }

  const targets = [];
  for (const item of store.state.items){
    if (!item.obj.visible) continue;
    if (item.kind === 'light'){
      // Lights have no geometry to hit — pick their helper instead.
      if (item.helper && !item.helperIsChild) targets.push(item.helper);
      continue;
    }
    targets.push(item.obj);
  }

  const hit = ray.intersectObjects(targets, true)[0];
  if (!hit){ select(null); return; }

  const item = store.itemForDescendant(hit.object)
            || store.state.items.find(i => i.helper === hit.object)
            || null;
  select(item);
}

/* ---------------- destruction ---------------- */

function disposeObject3D(root){
  root.traverse(node => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
    else node.material?.dispose?.();
  });
}

export function destroyItem(item){
  if (!item || item.locked) return false;

  if (store.state.selected === item) select(null);

  if (item.spline){
    helpers.remove(item.spline.handles);
    disposeObject3D(item.spline.handles);
  }
  if (item.handles){
    for (const h of item.handles){
      const i = extraHelpers.indexOf(h);
      if (i >= 0) extraHelpers.splice(i, 1);
    }
  }
  if (item.helper){
    if (item.helperIsChild){
      const i = extraHelpers.indexOf(item.helper);
      if (i >= 0) extraHelpers.splice(i, 1);
      item.obj.remove(item.helper);
    } else {
      helpers.remove(item.helper);
    }
    item.helper.dispose?.();
  }
  if (item.lightTarget) scene.remove(item.lightTarget);

  scene.remove(item.obj);
  disposeObject3D(item.obj);
  store.removeItem(item);
  return true;
}

export function destroySelected(){
  const item = store.state.selected;
  if (!item) return;
  if (item.locked){ toast('Set pieces cannot be deleted — hide the Set layer instead.'); return; }
  destroyItem(item);
  store.applyVisibility();
  store.changed();
}

/* ---------------- duplicate ---------------- */

export function duplicateSelected(){
  const item = store.state.selected;
  if (!item || item.locked) return null;

  if (item.kind === 'light'){
    const copy = addLightObject({ ...item.params }, item.layerId);
    copy.params.az += 25;
    updateLight(copy);
    select(copy);
    store.changed();
    return copy;
  }

  if (item.kind === 'camera'){
    const copy = addCameraObject({ ...item.params });
    copy.obj.position.copy(item.obj.position).add(new THREE.Vector3(0.06, 0, 0));
    copy.obj.quaternion.copy(item.obj.quaternion);
    copy.helper?.update();
    return copy;
  }

  const offset = new THREE.Vector3(0.09, 0, 0);
  const baseName = item.name.replace(/ \d+$/, '');

  // A mannequin is rebuilt rather than cloned: a cloned joint map would
  // still point at the original's nodes, so posing the copy would move
  // the original.
  if (item.joints){
    const copy = addMannequinObject();
    copy.obj.position.copy(item.obj.position).add(offset);
    copy.obj.rotation.copy(item.obj.rotation);
    copy.obj.scale.copy(item.obj.scale);
    for (const [name, node] of item.joints){
      copy.joints.get(name)?.rotation.copy(node.rotation);
    }
    copy.params.pose = item.params.pose;
    refreshOutline();
    return copy;
  }

  // A spline needs its own handle set to stay editable, so rebuild rather
  // than clone — a cloned handle group would still point at the original.
  if (item.spline){
    const spline = makeSpline({
      ...item.spline.params,
      points: item.spline.params.points.map(p => p.clone())
    });
    spline.group.position.copy(item.obj.position).add(offset);
    spline.group.rotation.copy(item.obj.rotation);
    spline.group.scale.copy(item.obj.scale);
    scene.add(spline.group);
    helpers.add(spline.handles);

    const copy = store.addItem({
      name: store.nextName(baseName), kind:'mesh', sub:'spline',
      obj: spline.group, layerId: item.layerId
    });
    copy.spline = spline;

    store.applyVisibility();
    select(copy);
    store.changed();
    return copy;
  }

  // Meshes: clone the object graph and carry the full transform across.
  const clone = item.obj.clone(true);
  clone.traverse(node => {
    if (node.isMesh && node.material) node.material = node.material.clone();
  });
  clone.position.copy(item.obj.position).add(offset);
  clone.rotation.copy(item.obj.rotation);
  clone.scale.copy(item.obj.scale);
  if (item.sub === 'text'){
    clone.userData.textParams = { ...item.obj.userData.textParams };
  }
  scene.add(clone);

  const copy = store.addItem({
    name: store.nextName(baseName), kind:'mesh', sub:item.sub,
    obj: clone, layerId: item.layerId
  });

  store.applyVisibility();
  select(copy);
  store.changed();
  return copy;
}

/* ---------------- gizmo wiring ---------------- */

gizmo.addEventListener('objectChange', () => {
  const item = store.state.selected;
  if (!item) return;

  if (activeHandle && item.spline){
    rebuildSpline(item.spline);
  } else if (item.kind === 'light'){
    // Dragging a light invalidates its spherical params — recompute them.
    Object.assign(item.params, unplace(item.obj.position));
    item.helper?.update?.();
    store.changed();
  } else if (item.kind === 'camera'){
    item.helper?.update();
  }
  refreshOutline();
});

/* ---------------- per-frame upkeep ---------------- */

/** Helpers that track a moving light or camera need a nudge each frame. */
export function updateHelpers(){
  for (const item of store.state.items){
    if (item.helper && !item.helperIsChild && item.helper.visible) item.helper.update?.();
  }
  if (outline.visible) refreshOutline();
}

/* ---------------- framing ---------------- */

const _fitBox = new THREE.Box3();

/**
 * Pull the camera back along its current viewing direction until the whole
 * subject fits, and re-centre the orbit target on it.
 *
 * This is what makes the framing presets work at any product scale: they
 * choose the angle, this chooses the distance. Without it a preset tuned
 * for a 12 cm jar crops the top off a 20 cm bottle.
 */
export function frameSubject(camera, margin = 1.22){
  const items = store.subjectMeshes();
  if (!items.length) return false;

  _fitBox.makeEmpty();
  for (const item of items) _fitBox.expandByObject(item.obj);
  if (_fitBox.isEmpty()) return false;

  const sphere = _fitBox.getBoundingSphere(new THREE.Sphere());
  if (sphere.radius <= 0) return false;

  // camera.fov is vertical; the tighter of the two axes is what actually crops.
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const fov  = Math.min(vFov, hFov);

  const dist = (sphere.radius * margin) / Math.sin(fov / 2);

  const dir = new THREE.Vector3().subVectors(camera.position, orbit.target);
  if (dir.lengthSq() < 1e-9) dir.set(0.6, 0.4, 0.6);
  dir.normalize();

  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.lookAt(sphere.center);
  if (camera === activeCamera()) orbit.target.copy(sphere.center);
  orbit.update();
  return true;
}

/* ---------------- shadows ---------------- */

const _shadowBox = new THREE.Box3();

/**
 * Size every shadow camera to the subject.
 *
 * A fixed shadow frustum tuned for a 12 cm bottle draws a hard-edged pool
 * of light on the floor around a 1.75 m figure — everything outside the
 * frustum is simply never shadowed. Too generous a frustum instead wastes
 * shadow-map resolution and gives soft, blocky contact shadows. So it
 * follows the content.
 */
export function fitShadowCameras(){
  const items = store.subjectMeshes();
  if (!items.length) return;

  _shadowBox.makeEmpty();
  for (const item of items) _shadowBox.expandByObject(item.obj);
  if (_shadowBox.isEmpty()) return;

  const sphere = _shadowBox.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius * 1.7, 0.35);

  for (const item of store.itemsOfKind('light')){
    const shadow = item.obj.shadow;
    if (!shadow) continue;

    const cam = shadow.camera;
    const reach = (item.params.dist || 1.2) + radius * 2;

    if (cam.isOrthographicCamera){
      cam.left = cam.bottom = -radius;
      cam.right = cam.top   =  radius;
      cam.near = 0.05;
      cam.far  = Math.max(reach, 6);
    } else {
      cam.far = Math.max(reach, 6);
    }
    cam.updateProjectionMatrix();
    shadow.needsUpdate = true;
  }
}

/* ---------------- views ---------------- */

/** Switch the viewport to the free camera or to a placed camera item. */
export function lookThrough(item){
  if (!item){
    setActiveCamera(freeCamera, new THREE.Vector3(0, 0.06, 0));
    for (const cam of store.itemsOfKind('camera')) if (cam.helper) cam.helper.visible = true;
    return;
  }
  // A camera cannot see its own frustum lines.
  for (const cam of store.itemsOfKind('camera')){
    if (cam.helper) cam.helper.visible = (cam !== item);
  }
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(item.obj.quaternion);
  setActiveCamera(item.obj, item.obj.position.clone().addScaledVector(fwd, item.params.focus));
}
