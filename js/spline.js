/* ============================================================
   spline.js — an editable curve swept into a tube.

   Good for the things primitives cannot describe: cables, straps,
   handles, ribbons, stems, hose. Control points are draggable handles;
   the tube rebuilds as you move them.

   Handles live in the helpers group, so they never appear in an export.
   ============================================================ */

import * as THREE from 'three';
import { clayMaterial } from './material.js';

const HANDLE_RADIUS = 0.007;

const handleMat       = new THREE.MeshBasicMaterial({ color:0xBF5AF2, depthTest:false });
const handleMatActive = new THREE.MeshBasicMaterial({ color:0xffffff, depthTest:false });
const handleGeo       = new THREE.SphereGeometry(HANDLE_RADIUS, 16, 12);

/**
 * Create a spline object.
 * @returns {{group:THREE.Group, tube:THREE.Mesh, handles:THREE.Group, params:object}}
 */
export function makeSpline(params = {}){
  const p = {
    radius: params.radius ?? 0.006,
    closed: params.closed ?? false,
    tension: params.tension ?? 0.5,
    points: params.points ?? [
      new THREE.Vector3(-0.09, 0.010, 0.02),
      new THREE.Vector3(-0.03, 0.075, -0.01),
      new THREE.Vector3( 0.03, 0.075, 0.03),
      new THREE.Vector3( 0.09, 0.010, 0.00)
    ]
  };

  const group = new THREE.Group();
  const tube  = new THREE.Mesh(new THREE.BufferGeometry(), clayMaterial());
  tube.castShadow = true;
  tube.receiveShadow = true;
  group.add(tube);

  const handles = new THREE.Group();
  handles.visible = false;

  const spline = { group, tube, handles, params: p };

  p.points.forEach((pt, i) => handles.add(makeHandle(spline, pt, i)));
  rebuildSpline(spline);

  return spline;
}

function makeHandle(spline, position, index){
  const h = new THREE.Mesh(handleGeo, handleMat);
  h.position.copy(position);
  h.renderOrder = 999;
  h.userData.splineHandle = { spline, index };
  return h;
}

/** Regenerate the tube from the current handle positions. */
export function rebuildSpline(spline){
  const pts = spline.handles.children.map(h => h.position.clone());
  if (pts.length < 2) return;

  const curve = new THREE.CatmullRomCurve3(
    pts, spline.params.closed, 'catmullrom', spline.params.tension
  );

  const segments = Math.max(24, pts.length * 24);
  const geo = new THREE.TubeGeometry(
    curve, segments, spline.params.radius, 16, spline.params.closed
  );

  spline.tube.geometry.dispose();
  spline.tube.geometry = geo;
  spline.params.points = pts;
}

/** Add a control point at the end of the curve. */
export function addControlPoint(spline){
  const pts = spline.handles.children;
  const last = pts[pts.length - 1].position;
  const prev = pts[pts.length - 2]?.position ?? last;

  const dir = new THREE.Vector3().subVectors(last, prev);
  if (dir.lengthSq() < 1e-8) dir.set(0.04, 0, 0);
  dir.setLength(0.04);

  const next = last.clone().add(dir);
  next.y = Math.max(next.y, HANDLE_RADIUS);

  spline.handles.add(makeHandle(spline, next, pts.length));
  rebuildSpline(spline);
}

/** Remove the last control point, never dropping below two. */
export function removeControlPoint(spline){
  const kids = spline.handles.children;
  if (kids.length <= 2) return false;
  spline.handles.remove(kids[kids.length - 1]);
  rebuildSpline(spline);
  return true;
}

export function setHandlesVisible(spline, visible){
  spline.handles.visible = visible;
}

export function highlightHandle(spline, mesh){
  for (const h of spline.handles.children){
    h.material = (h === mesh) ? handleMatActive : handleMat;
  }
}

/** Every handle mesh across a set of spline items, for raycasting. */
export const handleMeshesOf = spline => spline.handles.children;
