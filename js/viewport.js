/* ============================================================
   viewport.js — renderer, scene, the set, controls, view switching.

   Two details worth knowing before you edit this file:

   1. The canvas is sized in CSS (see layout.css) and three.js is called
      with updateStyle=false. That lets exports resize the drawing buffer
      to any resolution without disturbing page layout.
   2. The camera aspect always matches the chosen export aspect, and the
      render is scissored into a letterboxed rect inside the pane. What
      you frame is exactly what you export.
   ============================================================ */

import * as THREE from 'three';
import { OrbitControls }     from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

import { $ } from './util.js';
import { ASPECTS } from './optics.js';

export const viewportEl = $('viewport');

/* ---------------- renderer ---------------- */

export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,   // required for toDataURL captures
  alpha: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x0D0D0D, 1);
viewportEl.appendChild(renderer.domElement);

RectAreaLightUniformsLib.init();   // required before any RectAreaLight is used

/* ---------------- scene ---------------- */

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141414);

/** Everything in here is hidden during any export: grid, gizmo, helpers. */
export const helpers = new THREE.Group();
helpers.name = '__helpers';
scene.add(helpers);

/**
 * Helpers that cannot live in the group above because they must be parented
 * to the object they describe (RectAreaLightHelper). Exports hide these too.
 * @type {THREE.Object3D[]}
 */
export const extraHelpers = [];

/* ---------------- the set ---------------- */

const matGround = new THREE.MeshStandardMaterial({ color:0x6a6a6a, roughness:0.85 });
const matBack   = new THREE.MeshStandardMaterial({ color:0x5a5a5a, roughness:0.90 });

// Big enough that the edges never enter frame, including behind a 1.75 m
// figure with the camera pulled well back. The floor stops exactly where the
// backdrop starts — a floor that carries on behind the wall shows up as a
// bright band above the seam.
const SET = 40;

export const ground = new THREE.Mesh(new THREE.PlaneGeometry(SET, SET), matGround);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, 0, SET / 2 - 1.2);
ground.receiveShadow = true;
scene.add(ground);

export const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(SET, SET * 0.6), matBack);
backdrop.position.set(0, SET * 0.3, -1.2);
backdrop.receiveShadow = true;
scene.add(backdrop);

export const grid = new THREE.GridHelper(2, 40, 0x3A3A3A, 0x2A2A2A);
grid.position.y = 0.0006;
helpers.add(grid);

/* ---------------- cameras ---------------- */

/** The free-roaming viewport camera. Placed cameras are separate objects. */
export const freeCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
freeCamera.filmGauge = 36;
freeCamera.setFocalLength(85);
freeCamera.position.set(0.34, 0.15, 0.34);

let activeCam = freeCamera;
export const activeCamera = () => activeCam;
export const isFreeCamera = () => activeCam === freeCamera;

/* ---------------- controls ---------------- */

export const orbit = new OrbitControls(freeCamera, renderer.domElement);
orbit.target.set(0, 0.06, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minDistance = 0.05;
orbit.maxDistance = 12;

export const gizmo = new TransformControls(freeCamera, renderer.domElement);
gizmo.setSize(0.8);
gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
scene.add(gizmo);

/**
 * Point the viewport at a different camera. Orbit and the gizmo both follow,
 * so framing a placed camera works exactly like framing the free one.
 */
export function setActiveCamera(cam, target){
  activeCam = cam;
  orbit.object = cam;
  if (target) orbit.target.copy(target);
  else {
    // Look 40 cm down the camera's own forward axis.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    orbit.target.copy(cam.position).addScaledVector(fwd, 0.4);
  }
  gizmo.camera = cam;
  orbit.update();
  resize();
}

/* ---------------- framing / aspect ---------------- */

let aspectId = '4:5';
export const setAspect = id => { aspectId = id; resize(); };
export const getAspect = () => ASPECTS.find(a => a.id === aspectId) || ASPECTS[0];

/**
 * The letterboxed rect the scene renders into, in CSS pixels with a
 * top-left origin (the same coordinate space as pointer events).
 */
export function frameRect(){
  const W = viewportEl.clientWidth;
  const H = viewportEl.clientHeight;
  const a = getAspect();
  const target = a.w / a.h;

  const pad = 0.94;                       // small breathing room in the pane
  let w = W * pad, h = w / target;
  if (h > H * pad){ h = H * pad; w = h * target; }

  return { x:(W - w) / 2, y:(H - h) / 2, w, h, W, H };
}

function syncFrameGuide(r){
  const guide = $('frameGuide');
  if (!guide) return;
  guide.hidden = false;
  guide.style.width  = `${Math.round(r.w)}px`;
  guide.style.height = `${Math.round(r.h)}px`;
}

/* ---------------- resize ---------------- */

export function resize(){
  const W = viewportEl.clientWidth;
  const H = viewportEl.clientHeight;
  if (W === 0 || H === 0) return;

  // updateStyle=false — the canvas is sized by CSS, see the note up top.
  renderer.setSize(W, H, false);

  const r = frameRect();
  syncFrameGuide(r);

  const a = getAspect();
  activeCam.aspect = a.w / a.h;
  activeCam.updateProjectionMatrix();
}

window.addEventListener('resize', resize);

/* ---------------- render loop ---------------- */

const clearColor = new THREE.Color(0x0D0D0D);
let onBeforeRender = null;
export const setBeforeRender = fn => { onBeforeRender = fn; };

function renderFrame(){
  const r = frameRect();

  // Paint the pane background, then scissor the scene into the frame rect.
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, r.W, r.H);
  renderer.setClearColor(clearColor, 1);
  renderer.clear();

  // setViewport takes CSS pixels (three multiplies by the pixel ratio itself),
  // but WebGL's origin is bottom-left while frameRect is top-left.
  const gx = r.x, gy = r.H - r.y - r.h;
  renderer.setViewport(gx, gy, r.w, r.h);
  renderer.setScissor(gx, gy, r.w, r.h);
  renderer.setScissorTest(true);

  renderer.render(scene, activeCam);
  renderer.setScissorTest(false);
}

export function tick(){
  requestAnimationFrame(tick);
  orbit.update();
  if (onBeforeRender) onBeforeRender();
  renderFrame();
}

/**
 * Pointer position → normalised device coordinates inside the framed rect,
 * or null when the pointer is out in the letterbox where nothing renders.
 */
export function pointerToNDC(clientX, clientY){
  const canvas = renderer.domElement.getBoundingClientRect();
  const r = frameRect();
  const x = clientX - canvas.left - r.x;
  const y = clientY - canvas.top  - r.y;
  if (x < 0 || y < 0 || x > r.w || y > r.h) return null;
  return new THREE.Vector2((x / r.w) * 2 - 1, -(y / r.h) * 2 + 1);
}

/**
 * Render once at an exact pixel size with helpers hidden, hand the caller a
 * data URL, then put everything back. Every image export goes through here.
 */
export function captureFrame(width, height, { background, overrideMaterial, toneMapping } = {}){
  const prevSize  = new THREE.Vector2();
  renderer.getSize(prevSize);
  const prevRatio = renderer.getPixelRatio();
  const prevTone  = renderer.toneMapping;
  const prevBg    = scene.background;
  const prevHelpers = helpers.visible;
  const prevGizmo   = gizmo.visible;

  const prevExtra = extraHelpers.map(h => h.visible);
  extraHelpers.forEach(h => { h.visible = false; });

  helpers.visible = false;
  gizmo.visible   = false;
  if (background !== undefined)      scene.background = background;
  if (overrideMaterial !== undefined) scene.overrideMaterial = overrideMaterial;
  if (toneMapping !== undefined)     renderer.toneMapping = toneMapping;

  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);

  const prevAspect = activeCam.aspect;
  activeCam.aspect = width / height;
  activeCam.updateProjectionMatrix();

  renderer.clear();
  renderer.render(scene, activeCam);
  const url = renderer.domElement.toDataURL('image/png');

  // restore
  scene.overrideMaterial = null;
  scene.background   = prevBg;
  renderer.toneMapping = prevTone;
  helpers.visible = prevHelpers;
  gizmo.visible   = prevGizmo;
  extraHelpers.forEach((h, i) => { h.visible = prevExtra[i]; });
  activeCam.aspect = prevAspect;
  activeCam.updateProjectionMatrix();
  renderer.setPixelRatio(prevRatio);
  renderer.setSize(prevSize.x, prevSize.y, false);
  resize();

  return url;
}
