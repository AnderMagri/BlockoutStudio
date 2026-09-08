/* ============================================================
   export.js — render, depth, normal, mask and edge passes.

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

import { scene, captureFrame, captureFramePixels, activeCamera, getAspect } from './viewport.js';
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

/**
 * Render one pass and hand back the pixels rather than saving them.
 *
 * Every export goes through here. The UI turns the result into a download;
 * the MCP bridge posts it to disk so an assistant can open and inspect it.
 *
 * @param {'render'|'depth'|'normal'|'mask'|'edge'} pass
 * @returns {{dataUrl:string, filename:string, note:string, width:number, height:number}}
 */
export function capturePass(pass, longEdge, opts = {}){
  const { width, height } = exportSize(longEdge);

  switch (pass){
    case 'depth':  return { ...depthPass(width, height, opts), width, height };
    case 'normal': return { ...normalPass(width, height), width, height };
    case 'mask':   return { ...maskPass(width, height), width, height };
    case 'edge':   return { ...edgePass(width, height, opts), width, height };
    case 'render':
    default:       return {
      dataUrl: captureFrame(width, height),
      filename: `blockout-render-${stamp()}.png`,
      note: `Lit render at ${width}×${height}`,
      width, height
    };
  }
}

export function exportRender(longEdge){
  const shot = capturePass('render', longEdge);
  download(shot.dataUrl, shot.filename);
  toast(shot.note);
}

function depthPass(width, height, { subjectOnly = true, invert = false } = {}){
  const camera = activeCamera();

  const pool = subjectOnly ? store.subjectMeshes() : store.visibleMeshes();
  if (!pool.length) throw new Error('Nothing visible to measure depth from.');

  const range = viewDepthRange(pool, camera);
  if (!range) throw new Error('Could not work out a depth range.');

  depthMaterial.uniforms.uNear.value   = range.near;
  depthMaterial.uniforms.uFar.value    = range.far;
  depthMaterial.uniforms.uInvert.value = invert ? 1 : 0;

  // Whatever "far" maps to is what the empty background should be.
  const bg = new THREE.Color(invert ? 0xffffff : 0x000000);

  const dataUrl = captureFrame(width, height, {
    background: bg,
    overrideMaterial: depthMaterial,
    toneMapping: THREE.NoToneMapping
  });

  return {
    dataUrl,
    filename: `blockout-depth-${stamp()}.png`,
    note: `Depth map, near = ${invert ? 'black' : 'white'}, fitted to ` +
          `${(range.near * 100).toFixed(1)}\u2013${(range.far * 100).toFixed(1)} cm from the lens`
  };
}

export function exportDepth(longEdge, opts = {}){
  try {
    const shot = capturePass('depth', longEdge, opts);
    download(shot.dataUrl, shot.filename);
    toast(shot.note);
  } catch (err){ toast(err.message, true); }
}

/* ---------------- edge pass ---------------- */

/*
 * Edges are traced from the depth and normal buffers rather than from the
 * geometry, because geometric edge extraction (EdgesGeometry) only finds
 * creases — a sphere has none, so the default scene would export an empty
 * frame. A Sobel over depth catches silhouettes and every place one surface
 * passes in front of another; a Sobel over view-space normals catches
 * creases and the contact line where a shape meets the floor. Taking the
 * stronger of the two gives a line drawing with no dependence on the
 * lighting, which is what canny-style control models are trained on.
 */

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

/** The largest magnitude a Sobel kernel can return from values in 0..1. */
const SOBEL_MAX = 4 * Math.SQRT2;

/** Per-pixel edge strength in 0..1, the stronger of depth and normal. */
function edgeMagnitudes(depth, normal, w, h){
  const out = new Float32Array(w * h);
  const d = depth.data;
  const n = normal.data;
  const normDepth  = 1 / SOBEL_MAX;
  const normNormal = 1 / (SOBEL_MAX * Math.sqrt(3));   // three channels

  for (let y = 1; y < h - 1; y++){
    for (let x = 1; x < w - 1; x++){
      let dx = 0, dy = 0;
      let rx = 0, ry = 0, gx = 0, gy = 0, bx = 0, by = 0;

      let k = 0;
      for (let ky = -1; ky <= 1; ky++){
        const row = (y + ky) * w;
        for (let kx = -1; kx <= 1; kx++, k++){
          const wx = SOBEL_X[k];
          const wy = SOBEL_Y[k];
          const i = (row + x + kx) * 4;

          const dv = d[i];                  // depth is greyscale
          dx += dv * wx; dy += dv * wy;

          const r = n[i], g = n[i + 1], b = n[i + 2];
          rx += r * wx; ry += r * wy;
          gx += g * wx; gy += g * wy;
          bx += b * wx; by += b * wy;
        }
      }

      const dMag = Math.sqrt(dx * dx + dy * dy) / 255 * normDepth;
      const nMag = Math.sqrt(rx * rx + ry * ry + gx * gx + gy * gy + bx * bx + by * by)
                   / 255 * normNormal;

      out[y * w + x] = dMag > nMag ? dMag : nMag;
    }
  }
  return out;
}

/** Grow a binary mask by `r` pixels, separably. */
function dilate(src, w, h, r){
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);

  for (let y = 0; y < h; y++){
    const row = y * w;
    for (let x = 0; x < w; x++){
      const lo = Math.max(x - r, 0), hi = Math.min(x + r, w - 1);
      let v = 0;
      for (let xx = lo; xx <= hi; xx++) if (src[row + xx]){ v = 1; break; }
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++){
    const lo = Math.max(y - r, 0), hi = Math.min(y + r, h - 1);
    for (let x = 0; x < w; x++){
      let v = 0;
      for (let yy = lo; yy <= hi; yy++) if (tmp[yy * w + x]){ v = 1; break; }
      out[y * w + x] = v;
    }
  }
  return out;
}

function edgePass(width, height, {
  subjectOnly = true, sensitivity = 0.5, thickness = 1, invert = false
} = {}){
  const camera = activeCamera();

  const pool = subjectOnly ? store.subjectMeshes() : store.visibleMeshes();
  if (!pool.length) throw new Error('Nothing visible to trace edges from.');

  const range = viewDepthRange(pool, camera);
  if (!range) throw new Error('Could not work out a depth range.');

  depthMaterial.uniforms.uNear.value   = range.near;
  depthMaterial.uniforms.uFar.value    = range.far;
  depthMaterial.uniforms.uInvert.value = 0;

  const depth = captureFramePixels(width, height, {
    background: new THREE.Color(0x000000),
    overrideMaterial: depthMaterial,
    toneMapping: THREE.NoToneMapping
  });
  const normal = captureFramePixels(width, height, {
    background: new THREE.Color(0x8080ff),
    overrideMaterial: normalMaterial,
    toneMapping: THREE.NoToneMapping
  });

  const mag = edgeMagnitudes(depth, normal, width, height);

  // Sensitivity runs the other way from the threshold it drives: turning it
  // up should find more edges. Squared so the useful low end has more travel.
  const s = THREE.MathUtils.clamp(sensitivity, 0, 1);
  const threshold = 0.015 + Math.pow(1 - s, 2) * 0.36;

  const lit = new Uint8Array(width * height);
  let count = 0;
  for (let i = 0; i < mag.length; i++){
    if (mag[i] >= threshold){ lit[i] = 1; count++; }
  }

  const r = Math.max(0, Math.round(thickness) - 1);
  const grown = r > 0 ? dilate(lit, width, height, r) : lit;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const px = img.data;

  for (let i = 0; i < grown.length; i++){
    const v = grown[i] ? 255 : 0;
    const o = i * 4;
    px[o] = px[o + 1] = px[o + 2] = invert ? 255 - v : v;
    px[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const coverage = (count / (width * height)) * 100;
  return {
    dataUrl: canvas.toDataURL('image/png'),
    filename: `blockout-edge-${stamp()}.png`,
    note: `Edge map, ${invert ? 'black lines on white' : 'white lines on black'} · ` +
          `${coverage.toFixed(1)}% of the frame is line`
  };
}

/**
 * Async only so the "tracing" toast gets painted first: the Sobel is a
 * second of synchronous work at 1536 px, and a click that freezes the tab
 * with no acknowledgement reads as a hang. capturePass itself stays
 * synchronous — the MCP bridge depends on that.
 *
 * setTimeout rather than requestAnimationFrame: a hidden tab stops
 * painting, so an rAF here would never fire and the export would hang
 * until the tab came back to the foreground.
 */
export async function exportEdge(longEdge, opts = {}){
  toast('Tracing edges…');
  await new Promise(r => setTimeout(r, 0));
  try {
    const shot = capturePass('edge', longEdge, opts);
    download(shot.dataUrl, shot.filename);
    toast(shot.note);
  } catch (err){ toast(err.message, true); }
}

function normalPass(width, height){
  return {
    dataUrl: captureFrame(width, height, {
      background: new THREE.Color(0x8080ff),   // flat tangent-space normal
      overrideMaterial: normalMaterial,
      toneMapping: THREE.NoToneMapping
    }),
    filename: `blockout-normal-${stamp()}.png`,
    note: `Normal map at ${width}\u00d7${height}`
  };
}

export function exportNormal(longEdge){
  const shot = capturePass('normal', longEdge);
  download(shot.dataUrl, shot.filename);
  toast(shot.note);
}

function maskPass(width, height){
  const layer = store.activeLayer();
  if (!layer) throw new Error('No active layer to mask.');

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

  const dataUrl = captureFrame(width, height, {
    background: new THREE.Color(0x000000),
    toneMapping: THREE.NoToneMapping
  });

  for (const [node, material] of saved) node.material = material;
  white.dispose();
  black.dispose();

  return {
    dataUrl,
    filename: `blockout-mask-${slug(layer.name)}-${stamp()}.png`,
    note: `Mask isolating the “${layer.name}” layer`
  };
}

export function exportMask(longEdge){
  try {
    const shot = capturePass('mask', longEdge);
    download(shot.dataUrl, shot.filename);
    toast(shot.note);
  } catch (err){ toast(err.message, true); }
}
