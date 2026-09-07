/* ============================================================
   text.js — extruded 3D text.

   The typeface is vendored in assets/fonts, so this works offline and
   does not add a second CDN the tool can fail on.
   ============================================================ */

import * as THREE from 'three';
import { FontLoader }   from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { clayMaterial } from './material.js';

const FONT_URL = 'assets/fonts/helvetiker_regular.typeface.json';

let fontPromise = null;

/** Load the typeface once and share the promise. */
export function loadFont(){
  if (!fontPromise){
    fontPromise = new Promise((resolve, reject) => {
      new FontLoader().load(FONT_URL, resolve, undefined,
        () => reject(new Error('Could not load the typeface in assets/fonts.')));
    });
  }
  return fontPromise;
}

/** Build centred, ground-resting text geometry. */
export function buildTextGeometry(font, { text, size, depth, bevel }){
  const geo = new TextGeometry(text || ' ', {
    font,
    size:  size,
    height: depth,               // r160 still calls the extrusion "height"
    curveSegments: 8,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.6,
    bevelSegments: 3
  });

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(
    -(bb.min.x + bb.max.x) / 2,
    -bb.min.y,
    -(bb.min.z + bb.max.z) / 2
  );
  geo.computeBoundingBox();
  return geo;
}

/**
 * Create a text mesh. Its params live on mesh.userData.textParams so the
 * inspector can rebuild it when the wording or size changes.
 */
export async function makeText(params = {}){
  const p = {
    text:  params.text  ?? 'BRAND',
    size:  params.size  ?? 0.03,
    depth: params.depth ?? 0.008,
    bevel: params.bevel ?? 0.0
  };

  const font = await loadFont();
  const mesh = new THREE.Mesh(buildTextGeometry(font, p), clayMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.textParams = p;
  return mesh;
}

/** Rebuild an existing text mesh in place after its params change. */
export async function rebuildText(mesh){
  const font = await loadFont();
  const geo = buildTextGeometry(font, mesh.userData.textParams);
  mesh.geometry.dispose();
  mesh.geometry = geo;
}
