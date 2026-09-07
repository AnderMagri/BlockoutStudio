/* ============================================================
   thumbnails.js — card pictures, rendered from the real geometry.

   Deliberately not a folder of hand-drawn icons. Every catalog entry
   gets its thumbnail by being rendered once in an offscreen scene, so
   adding a shape to catalog.js gives you a card picture for free and
   the picture can never drift from what the shape actually is.

   Runs once at boot on its own small renderer, then throws that
   renderer away.
   ============================================================ */

import * as THREE from 'three';
import { CATEGORIES, makeCatalogObject } from './catalog.js';
import { makeMannequin } from './figure.js';
import { makeSpline } from './spline.js';

const SIZE = 128;

/** id → data URL. Empty until buildThumbnails resolves. */
export const thumbnails = new Map();

/**
 * Specials have no `make`, so build them the way objects.js would.
 * Anything not listed falls back to a glyph card.
 */
const SPECIAL_BUILDERS = {
  mannequin: () => makeMannequin().root,
  spline:    () => makeSpline().group
};

/** Flat glyphs for the few entries that are not geometry at all. */
export const GLYPHS = {
  text:   'T',
  camera: '◉',
  light:  '✦'
};

function buildOne(id, def){
  if (SPECIAL_BUILDERS[id]) return SPECIAL_BUILDERS[id]();
  if (def.make) return makeCatalogObject(id);
  return null;
}

/**
 * Render every catalog entry to a small PNG.
 * @returns {Promise<Map<string,string>>}
 */
export async function buildThumbnails(){
  // Wait for one painted frame so the studio appears first — but never
  // wait forever. requestAnimationFrame does not fire in a background tab,
  // and gating on it alone left the cards showing placeholder glyphs
  // permanently for anyone who opened the app in a tab they weren't
  // looking at.
  await Promise.race([
    new Promise(requestAnimationFrame),
    new Promise(r => setTimeout(r, 400))
  ]);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true, preserveDrawingBuffer: true
    });
  } catch {
    return thumbnails;                 // no WebGL to spare — cards use glyphs
  }

  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(2);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  // Flat, legible lighting — these are icons, not renders.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x707070, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.6, 1.0, 0.9);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-0.8, 0.4, -0.6);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();

  for (const cat of CATEGORIES){
    for (const def of cat.items){
      let node = null;
      try { node = buildOne(def.id, def); }
      catch { node = null; }
      if (!node) continue;

      scene.add(node);

      // Frame it: the same fit the viewport uses, minus the orbit target.
      box.setFromObject(node);
      if (box.isEmpty()){ scene.remove(node); continue; }
      box.getBoundingSphere(sphere);

      const fov = THREE.MathUtils.degToRad(camera.fov);
      const dist = (sphere.radius * 1.35) / Math.sin(fov / 2);

      // A three-quarter view reads a silhouette better than a front view.
      const dir = new THREE.Vector3(0.62, 0.46, 0.86).normalize();
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.lookAt(sphere.center);
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
      thumbnails.set(def.id, renderer.domElement.toDataURL('image/png'));

      scene.remove(node);
      node.traverse(n => {
        n.geometry?.dispose?.();
        if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
        else n.material?.dispose?.();
      });

      // Deliberately no yield inside the loop. A per-item setTimeout gets
      // clamped to ~1s in a background tab, which turned 27 quick renders
      // into half a minute of glyph placeholders. The whole batch is a few
      // hundred milliseconds, and it already runs after the first frame.
    }
  }

  renderer.dispose();
  renderer.forceContextLoss?.();
  return thumbnails;
}
