/* ============================================================
   export.js — render, depth, normal and mask passes.

   The depth pass is the reason this tool exists, so it is worth saying
   what it does differently from the naive version:

   • It writes LINEAR view-space depth from a custom shader. three.js's
     MeshDepthMaterial writes the non-linear z-buffer value, which packs
     almost the whole tonal range into the first few centimetres and
     leaves the subject as flat white.
   • The range is fitted to the subject's own bounding box in view space,
     not to the whole set. Including a 6 m backdrop in the range is what
     flattens a 12 cm product into three grey levels.
   • Near is white by default, the convention Krea and ControlNet depth
     models are trained on.
   • Tone mapping is switched off for every data pass. ACES would bend
     the depth ramp and turn a white mask grey.
   ============================================================ */

import * as THREE from 'three';

import { scene, captureFrame, activeCamera, getAspect } from './viewport.js';
import * as store from './store.js';
import { download, slug, toast } from './util.js';

/* ---------------- depth material ---------------- */

const depthMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uNear:   { value: 0.1 },
    uFar:    { value: 1.0 },
    uInvert: { value: 0.0 }
  },
  vertexShader: /* glsl */`
    varying float vViewDepth;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewDepth = -mv.z;                 // distance along the camera axis
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uNear;
    uniform float uFar;
    uniform float uInvert;
    varying float vViewDepth;
    void main(){
      float d = clamp((vViewDepth - uNear) / max(uFar - uNear, 1e-6), 0.0, 1.0);
      float v = 1.0 - d;                  // near = white
      v = mix(v, 1.0 - v, uInvert);
      gl_FragColor = vec4(vec3(v), 1.0);
    }
  `
});

const normalMaterial = new THREE.MeshNormalMaterial();

/* ---------------- geometry helpers ---------------- */

const _box = new THREE.Box3();
const _v   = new THREE.Vector3();

/** Never walk more than this many vertices per mesh when fitting the range. */
const MAX_SAMPLES = 20000;

/**
 * Nearest and furthest distance, along the camera's viewing axis, of a set
 * of objects.
 *
 * Measured from real vertices rather than from bounding-box corners. A box
 * around a bottle viewed at an angle is deeper than the bottle itself, and
 * fitting to the box would spend a third of the tonal range on empty corners
 * where no surface exists. Falls back to the box when a node has no readable
 * position attribute.
 */
function viewDepthRange(items, camera){
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse;

  let near = Infinity, far = -Infinity;

  const consider = d => {
    if (d < near) near = d;
    if (d > far)  far  = d;
  };

  for (const item of items){
    let sampled = false;

    item.obj.traverse(node => {
      if (!node.isMesh || !node.visible) return;
      const pos = node.geometry?.attributes?.position;
      if (!pos) return;

      node.updateWorldMatrix(true, false);
      const stride = Math.max(1, Math.ceil(pos.count / MAX_SAMPLES));

      for (let i = 0; i < pos.count; i += stride){
        _v.fromBufferAttribute(pos, i)
          .applyMatrix4(node.matrixWorld)
          .applyMatrix4(view);
        consider(-_v.z);
      }
      sampled = true;
    });

    if (sampled) continue;

    // Fallback: the eight box corners.
    _box.setFromObject(item.obj);
    if (_box.isEmpty()) continue;
    for (let i = 0; i < 8; i++){
      _v.set(
        (i & 1) ? _box.max.x : _box.min.x,
        (i & 2) ? _box.max.y : _box.min.y,
        (i & 4) ? _box.max.z : _box.min.z
      ).applyMatrix4(view);
      consider(-_v.z);
    }
  }

  if (!isFinite(near) || !isFinite(far)) return null;

  // A hair of padding stops the nearest and furthest surfaces clipping to
  // pure black and pure white, which would lose their shape.
  const span = Math.max(far - near, 1e-3);
  return { near: Math.max(near - span * 0.04, 1e-4), far: far + span * 0.04 };
}

/** Pixel dimensions for the current aspect and long-edge setting. */
export function exportSize(longEdge){
  const a = getAspect();
  return a.w >= a.h
    ? { width: longEdge, height: Math.round(longEdge * a.h / a.w) }
    : { width: Math.round(longEdge * a.w / a.h), height: longEdge };
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/* ---------------- passes ---------------- */

export function exportRender(longEdge){
  const { width, height } = exportSize(longEdge);
  const url = captureFrame(width, height);
  download(url, `blockout-render-${stamp()}.png`);
  toast(`Render exported at ${width}×${height}`);
}

export function exportDepth(longEdge, { subjectOnly = true, invert = false } = {}){
  const { width, height } = exportSize(longEdge);
  const camera = activeCamera();

  const pool = subjectOnly ? store.subjectMeshes() : store.visibleMeshes();
  if (!pool.length){
    toast('Nothing visible to measure depth from.', true);
    return;
  }

  const range = viewDepthRange(pool, camera);
  if (!range){
    toast('Could not work out a depth range.', true);
    return;
  }

  depthMaterial.uniforms.uNear.value   = range.near;
  depthMaterial.uniforms.uFar.value    = range.far;
  depthMaterial.uniforms.uInvert.value = invert ? 1 : 0;

  // Whatever "far" maps to is what the empty background should be.
  const bg = new THREE.Color(invert ? 0xffffff : 0x000000);

  const url = captureFrame(width, height, {
    background: bg,
    overrideMaterial: depthMaterial,
    toneMapping: THREE.NoToneMapping
  });

  download(url, `blockout-depth-${stamp()}.png`);
  toast(`Depth exported · range ${(range.near * 100).toFixed(1)}–${(range.far * 100).toFixed(1)} cm`);
}

export function exportNormal(longEdge){
  const { width, height } = exportSize(longEdge);
  const url = captureFrame(width, height, {
    background: new THREE.Color(0x8080ff),   // flat tangent-space normal
    overrideMaterial: normalMaterial,
    toneMapping: THREE.NoToneMapping
  });
  download(url, `blockout-normal-${stamp()}.png`);
  toast(`Normal map exported at ${width}×${height}`);
}

export function exportMask(longEdge){
  const layer = store.activeLayer();
  if (!layer){ toast('No active layer to mask.', true); return; }

  const { width, height } = exportSize(longEdge);

  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const saved = new Map();

  // Per-mesh swap rather than an override, because the two groups need
  // different materials. Hidden meshes stay hidden: if you cannot see it,
  // it should not be in the mask.
  for (const item of store.state.items){
    if (item.kind !== 'mesh' && item.kind !== 'set') continue;
    item.obj.traverse(node => {
      if (!node.isMesh) return;
      saved.set(node, node.material);
      node.material = (item.layerId === layer.id) ? white : black;
    });
  }

  const url = captureFrame(width, height, {
    background: new THREE.Color(0x000000),
    toneMapping: THREE.NoToneMapping
  });

  for (const [node, material] of saved) node.material = material;
  white.dispose();
  black.dispose();

  download(url, `blockout-mask-${slug(layer.name)}-${stamp()}.png`);
  toast(`Mask exported for “${layer.name}”`);
}
