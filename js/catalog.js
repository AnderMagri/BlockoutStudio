/* ============================================================
   catalog.js — the single registry of everything you can add.

   ADDING A NEW SHAPE
   ------------------
   Drop one entry into the relevant category below:

       { id:'lamp', label:'Lamp', make: () => someGeometryOrObject3D }

   `make` may return a BufferGeometry, a Mesh, or a whole Object3D —
   whatever is convenient. `rest` decides how it meets the floor:
   'ground' (default) sits it on y=0, 'float' leaves it where it is.

   Nothing else in the app needs touching. The Add menus, the layer
   icons and the prompt writer all read from here.
   ============================================================ */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clayMaterial } from './material.js';
import { headGeometry } from './figure.js';

export { clayMaterial };

const V2 = (x, y) => new THREE.Vector2(x, y);
const lathe = (profile, segments = 64) => new THREE.LatheGeometry(profile, segments);

/* ---------------- geometry helpers ---------------- */

/** A rounded rectangle in the XY plane, extruded to `depth`. */
function roundedSlab(w, h, depth, radius){
  const shape = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + radius);
  shape.lineTo(x + w, y + h - radius);
  shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  shape.lineTo(x + radius, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(depth * 0.12, 0.0012),
    bevelSize: Math.min(depth * 0.12, 0.0012),
    bevelSegments: 2,
    curveSegments: 10
  });
  geo.center();
  return geo;
}

/** Cheap deterministic value noise — enough to make a rock look quarried. */
function hash3(x, y, z){
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** An icosphere pushed around by noise at two frequencies. */
function rockGeometry(radius = 0.045, seed = 1){
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const coarse = hash3(n.x * 2.1 + seed, n.y * 2.1, n.z * 2.1);
    const fine   = hash3(n.x * 7.3, n.y * 7.3 + seed, n.z * 7.3);
    const scale  = 0.80 + coarse * 0.34 + fine * 0.10;
    v.copy(n).multiplyScalar(radius * scale);
    v.y *= 0.82;                       // rocks sit lower than they are wide
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A clump of overlapping spheres — reads as cloud in silhouette and depth. */
function cloudGeometry(){
  const lobes = [
    [ 0.000, 0.000, 0.000, 0.085],
    [ 0.075, 0.018, 0.010, 0.062],
    [-0.078, 0.010, -0.008, 0.058],
    [ 0.030, 0.052, -0.015, 0.052],
    [-0.032, 0.045, 0.014, 0.046],
    [ 0.135, -0.010, 0.000, 0.040],
    [-0.140, -0.006, 0.006, 0.036]
  ];
  const parts = lobes.map(([x, y, z, r]) => {
    const g = new THREE.SphereGeometry(r, 24, 16);
    g.translate(x, y, z);
    return g;
  });
  return mergeGeometries(parts, false);
}

/** A book: text block plus a cover that overhangs it slightly. */
function bookGeometry(){
  const w = 0.145, h = 0.210, d = 0.032;
  const pages = new THREE.BoxGeometry(w - 0.006, h - 0.008, d - 0.006);
  const cover = roundedSlab(w, h, d, 0.004);
  return mergeGeometries([pages, cover], false) || cover;
}

/* ---------------- the catalog ---------------- */

/**
 * @typedef {Object} CatalogItem
 * @property {string}   id
 * @property {string}   label
 * @property {Function} [make]     → BufferGeometry | Object3D
 * @property {string}   [special]  routed by objects.js instead of `make`
 *                                 ('text' | 'spline' | 'mannequin' |
 *                                  'camera' | 'light')
 * @property {'ground'|'float'} [rest]
 * @property {number}   [y]        resting height when rest is 'float'
 */

export const CATEGORIES = [
  {
    id:'primitives',
    label:'Primitives',
    items:[
      { id:'box',      label:'Box',      make:() => new THREE.BoxGeometry(0.08, 0.10, 0.05) },
      { id:'sphere',   label:'Sphere',   make:() => new THREE.SphereGeometry(0.045, 48, 32) },
      { id:'cylinder', label:'Cylinder', make:() => new THREE.CylinderGeometry(0.0425, 0.0425, 0.13, 64) },
      { id:'cone',     label:'Cone',     make:() => new THREE.ConeGeometry(0.045, 0.11, 48) },
      { id:'torus',    label:'Torus',    make:() => new THREE.TorusGeometry(0.045, 0.014, 24, 64) },
      { id:'capsule',  label:'Capsule',  make:() => new THREE.CapsuleGeometry(0.030, 0.070, 12, 32) },
      { id:'facet',    label:'Facet',    make:() => new THREE.IcosahedronGeometry(0.050, 0) },
      { id:'plane',    label:'Panel',    make:() => new THREE.PlaneGeometry(0.10, 0.14) }
    ]
  },
  {
    id:'packaging',
    label:'Packaging',
    items:[
      { id:'bottle', label:'Bottle', make:() => lathe([
          V2(0.000, 0.000), V2(0.030, 0.000), V2(0.032, 0.004),
          V2(0.032, 0.100), V2(0.030, 0.116), V2(0.018, 0.140),
          V2(0.012, 0.152), V2(0.012, 0.184), V2(0.014, 0.188),
          V2(0.014, 0.196), V2(0.000, 0.196)
        ]) },
      { id:'can', label:'Can', make:() => lathe([
          V2(0.000, 0.000), V2(0.026, 0.000), V2(0.033, 0.008),
          V2(0.033, 0.110), V2(0.029, 0.119), V2(0.026, 0.122),
          V2(0.000, 0.122)
        ]) },
      { id:'jar', label:'Jar', make:() => lathe([
          V2(0.000, 0.000), V2(0.040, 0.000), V2(0.045, 0.006),
          V2(0.045, 0.068), V2(0.042, 0.079), V2(0.031, 0.084),
          V2(0.031, 0.092), V2(0.000, 0.092)
        ]) },
      { id:'tube', label:'Tube', make:() => lathe([
          V2(0.000, 0.000), V2(0.021, 0.003), V2(0.024, 0.018),
          V2(0.024, 0.098), V2(0.016, 0.120), V2(0.010, 0.127),
          V2(0.010, 0.140), V2(0.000, 0.140)
        ]) },
      { id:'cup',    label:'Cup',    make:() => new THREE.CylinderGeometry(0.040, 0.028, 0.095, 64) },
      { id:'carton', label:'Carton', make:() => new THREE.BoxGeometry(0.068, 0.155, 0.048) }
    ]
  },
  {
    id:'objects',
    label:'Objects',
    items:[
      { id:'book',     label:'Book',     make: bookGeometry },
      { id:'magazine', label:'Magazine', make:() => roundedSlab(0.210, 0.275, 0.006, 0.002) },
      { id:'card',     label:'Card',     make:() => roundedSlab(0.085, 0.055, 0.0009, 0.003) },
      { id:'phone',    label:'Phone',    make:() => roundedSlab(0.0716, 0.1467, 0.0078, 0.010) },
      { id:'rock',     label:'Rock',     make:() => rockGeometry(0.045, 1) },
      { id:'boulder',  label:'Boulder',  make:() => rockGeometry(0.085, 7) },
      { id:'cloud',    label:'Cloud',    make: cloudGeometry, rest:'float', y:0.42 }
    ]
  },
  {
    id:'figures',
    label:'Figures',
    items:[
      { id:'head',      label:'Head',      make:() => headGeometry({ neck:true }) },
      // Built by figure.js rather than from a geometry — it carries a joint
      // hierarchy, so objects.js routes it through its own constructor.
      { id:'mannequin', label:'Mannequin', special:'mannequin' }
    ]
  },
  {
    id:'special',
    label:'Special',
    items:[
      { id:'text',   label:'Text',   special:'text' },
      { id:'spline', label:'Spline', special:'spline' },
      { id:'camera', label:'Camera', special:'camera' },
      { id:'light',  label:'Light',  special:'light' }
    ]
  }
];

/** Flat id → item lookup, built once. */
export const CATALOG = new Map();
for (const cat of CATEGORIES){
  for (const item of cat.items) CATALOG.set(item.id, { ...item, category: cat.id });
}

export const catalogItem = id => CATALOG.get(id) || null;
export const labelFor = id => CATALOG.get(id)?.label ?? 'Shape';

/* ---------------- construction ---------------- */

/**
 * Build a catalog entry into a scene-ready Object3D, centred on its own
 * footprint and resting correctly against the floor.
 */
export function makeCatalogObject(id){
  const def = CATALOG.get(id);
  if (!def) throw new Error(`Unknown catalog item: ${id}`);

  let node = def.make();

  // A factory may hand back geometry or a finished object.
  if (node.isBufferGeometry){
    const geo = node;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;

    geo.translate(
      -(bb.min.x + bb.max.x) / 2,
      def.rest === 'float' ? -(bb.min.y + bb.max.y) / 2 : -bb.min.y,
      -(bb.min.z + bb.max.z) / 2
    );
    geo.computeBoundingBox();

    node = new THREE.Mesh(geo, clayMaterial());
  }

  node.traverse(n => {
    if (n.isMesh){ n.castShadow = true; n.receiveShadow = true; }
  });

  if (def.rest === 'float') node.position.y = def.y ?? 0.4;

  return node;
}
