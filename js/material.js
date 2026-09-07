/* ============================================================
   material.js — the one surface every object wears.

   Its own module so catalog, figure, text and spline can all reach it
   without importing each other in a circle.
   ============================================================ */

import * as THREE from 'three';

/**
 * Neutral matte clay. Deliberately featureless: this tool exports depth,
 * masks and composition, and surface detail would only mislead the model
 * you feed them to.
 */
export const clayMaterial = () => new THREE.MeshStandardMaterial({
  color: 0x9a9a9a,
  roughness: 0.62,
  metalness: 0.0
});
