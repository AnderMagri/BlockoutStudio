/* ============================================================
   lights.js — lights as placeable objects, plus a gallery of rigs
   built the way they are built on a real set.

   Positions are spherical and product-relative: azimuth 0° is the
   camera side (+Z), 90° is camera-right, 180° is behind the subject.
   Elevation is degrees above the table.

   `power` is illuminance at the subject rather than raw three.js
   intensity — the factory multiplies by distance² for the lights that
   obey inverse-square falloff, so a preset's numbers mean the same
   thing wherever you put the fixture.
   ============================================================ */

import * as THREE from 'three';
import { RectAreaLightHelper }     from 'three/addons/helpers/RectAreaLightHelper.js';
import { kelvinToRGB, kelvinName } from './util.js';

/** Aim point: the middle of a product sitting on the table. */
export const AIM = new THREE.Vector3(0, 0.055, 0);

export const LIGHT_TYPES = {
  spot:    { label:'Spot',     shadows:true  },
  area:    { label:'Softbox',  shadows:false },
  sun:     { label:'Sun',      shadows:true  },
  point:   { label:'Practical',shadows:true  },
  ambient: { label:'Ambient',  shadows:false }
};

/** Spherical (deg, deg, m) → cartesian. */
export function place(azDeg, elDeg, dist){
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(
    dist * Math.cos(el) * Math.sin(az),
    dist * Math.sin(el),
    dist * Math.cos(el) * Math.cos(az)
  );
}

/** Cartesian → spherical, so the inspector can show sliders after a drag. */
export function unplace(v){
  const dist = Math.max(v.length(), 1e-4);
  return {
    az: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)),
    el: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y / dist, -1, 1))),
    dist
  };
}

/* ---------------- factory ---------------- */

/**
 * Build a light object.
 * @param {object} p {type, az, el, dist, power, kelvin, softness, size, angle}
 * @returns {{light:THREE.Light, helper:THREE.Object3D|null, helperIsChild:boolean,
 *            params:object, target:THREE.Object3D|null}}
 *
 * `helperIsChild` means the helper must be parented to the light itself
 * (RectAreaLightHelper requires it). The caller is then responsible for
 * hiding it during exports — see viewport.extraHelpers.
 */
export function makeLight(p = {}){
  const params = {
    type:     p.type     ?? 'spot',
    az:       p.az       ?? 40,
    el:       p.el       ?? 40,
    dist:     p.dist     ?? 1.2,
    power:    p.power    ?? 6,
    kelvin:   p.kelvin   ?? 5600,
    softness: p.softness ?? 0.5,
    size:     p.size     ?? 0.8,   // softbox edge, metres
    angle:    p.angle    ?? 34     // spot cone, degrees
  };

  const colour = new THREE.Color(...kelvinToRGB(params.kelvin));
  const pos = place(params.az, params.el, params.dist);

  let light, helper = null, target = null, helperIsChild = false;

  switch (params.type){

    case 'sun': {
      light = new THREE.DirectionalLight(colour, params.power);
      light.position.copy(pos);
      configureShadow(light, params, 2.2);
      target = light.target;
      target.position.copy(AIM);
      helper = new THREE.DirectionalLightHelper(light, 0.12, 0xe8a33d);
      break;
    }

    case 'area': {
      // A softbox: physically the closest match to studio diffusion.
      // RectAreaLight cannot cast shadows in three.js — that is a library
      // limitation, not an oversight. Pair it with a spot when you need one.
      light = new THREE.RectAreaLight(colour, params.power * 2.2, params.size, params.size);
      light.position.copy(pos);
      light.lookAt(AIM);
      helper = new RectAreaLightHelper(light);
      helperIsChild = true;       // this helper only works parented to its light
      break;
    }

    case 'point': {
      light = new THREE.PointLight(colour, params.power * params.dist * params.dist, 0, 2);
      light.position.copy(pos);
      configureShadow(light, params, 1.0);
      helper = new THREE.PointLightHelper(light, 0.02, 0xe8a33d);
      break;
    }

    case 'ambient': {
      light = new THREE.HemisphereLight(colour, 0x2a2a2a, params.power);
      light.position.set(0, 1, 0);
      break;
    }

    case 'spot':
    default: {
      light = new THREE.SpotLight(
        colour,
        params.power * params.dist * params.dist,
        0,
        THREE.MathUtils.degToRad(params.angle),
        THREE.MathUtils.clamp(params.softness, 0, 1),
        2
      );
      light.position.copy(pos);
      configureShadow(light, params, 1.4);
      target = light.target;
      target.position.copy(AIM);
      helper = new THREE.SpotLightHelper(light, 0xe8a33d);
      break;
    }
  }

  return { light, helper, helperIsChild, params, target };
}

function configureShadow(light, params, radius){
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0012;
  // PCFSoft reads shadow.radius — a stand-in for physical source size.
  light.shadow.radius = 1 + params.softness * 7;

  const cam = light.shadow.camera;
  cam.near = 0.05;
  cam.far  = 8;
  if (cam.isOrthographicCamera){
    cam.left = cam.bottom = -radius;
    cam.right = cam.top   =  radius;
  }
  cam.updateProjectionMatrix();
}

/** Push changed params onto a live light without rebuilding it. */
export function applyLightParams(light, params, target){
  light.color.setRGB(...kelvinToRGB(params.kelvin));

  const pos = place(params.az, params.el, params.dist);
  light.position.copy(pos);

  const d2 = params.dist * params.dist;
  switch (params.type){
    case 'sun':
      light.intensity = params.power;
      break;
    case 'area':
      light.intensity = params.power * 2.2;
      light.width = light.height = params.size;
      light.lookAt(AIM);
      break;
    case 'ambient':
      light.intensity = params.power;
      break;
    case 'point':
      light.intensity = params.power * d2;
      break;
    default:
      light.intensity = params.power * d2;
      light.angle = THREE.MathUtils.degToRad(params.angle);
      light.penumbra = THREE.MathUtils.clamp(params.softness, 0, 1);
  }

  if (light.shadow) light.shadow.radius = 1 + params.softness * 7;
  if (target) target.position.copy(AIM);
}

/* ---------------- rig gallery ---------------- */

/**
 * Each rig is how a photographer would actually set the shot up.
 * `note` is written to be dropped straight into an image prompt.
 */
export const RIGS = [
  {
    id:'three-point', name:'Three point', meta:'key · fill · rim',
    note:'three-point studio lighting, soft key at 45 degrees, gentle fill opposite, rim light separating the subject from the background',
    lights:[
      { name:'Key',  type:'spot', az: 42, el:38, dist:1.2, power:9,  kelvin:5400, softness:0.6, angle:36 },
      { name:'Fill', type:'area', az:-55, el:18, dist:1.0, power:1.6,kelvin:5800, size:1.0 },
      { name:'Rim',  type:'spot', az:165, el:42, dist:1.1, power:7,  kelvin:6200, softness:0.3, angle:30 }
    ]
  },
  {
    id:'softbox', name:'Softbox above', meta:'tabletop product',
    note:'large softbox directly overhead, soft even tabletop product lighting, gentle gradient falloff',
    lights:[
      { name:'Overhead box', type:'area', az:0,   el:78, dist:0.85, power:5, kelvin:5600, size:1.4 },
      { name:'Bounce',       type:'area', az:180, el:12, dist:0.9,  power:1.1, kelvin:5600, size:1.0 },
      { name:'Shadow key',   type:'spot', az:25,  el:62, dist:1.3, power:3, kelvin:5600, softness:0.85, angle:44 }
    ]
  },
  {
    id:'clamshell', name:'Clamshell', meta:'beauty, shadowless',
    note:'clamshell beauty lighting, large soft source above and a fill below, almost shadowless and very even',
    lights:[
      { name:'Top box',    type:'area', az:0, el:55, dist:0.8, power:5,   kelvin:5600, size:1.2 },
      { name:'Bottom fill',type:'area', az:0, el:-18,dist:0.7, power:2.2, kelvin:5600, size:1.0 },
      { name:'Shaper',     type:'spot', az:0, el:60, dist:1.2, power:2,   kelvin:5600, softness:0.9, angle:48 }
    ]
  },
  {
    id:'rembrandt', name:'Rembrandt', meta:'45/45, moody',
    note:'Rembrandt lighting, single key at 45 degrees azimuth and 45 degrees elevation, deep shaped shadows, dramatic falloff',
    lights:[
      { name:'Key',     type:'spot',   az:45, el:45, dist:1.2, power:11, kelvin:4800, softness:0.35, angle:30 },
      { name:'Ambient', type:'ambient',power:0.10, kelvin:6500 }
    ]
  },
  {
    id:'split', name:'Split', meta:'hard side light',
    note:'split lighting, single hard source at 90 degrees to the camera, half the subject in shadow, high contrast',
    lights:[
      { name:'Side key', type:'spot',    az:92, el:16, dist:1.1, power:12, kelvin:5200, softness:0.15, angle:28 },
      { name:'Ambient',  type:'ambient', power:0.07, kelvin:6500 }
    ]
  },
  {
    id:'rim', name:'Backlit rim', meta:'silhouette edge',
    note:'strong backlight rimming the subject, near-silhouette with a bright outline, dark foreground',
    lights:[
      { name:'Back key', type:'spot',    az:180, el:26, dist:1.1, power:22, kelvin:6400, softness:0.25, angle:34 },
      { name:'Whisper',  type:'area',    az:0,   el:22, dist:1.0, power:0.6, kelvin:5600, size:1.0 },
      { name:'Ambient',  type:'ambient', power:0.06, kelvin:7000 }
    ]
  },
  {
    id:'window', name:'Window light', meta:'single soft source',
    note:'soft daylight from a large window to one side, natural directional falloff, subtle shadows',
    lights:[
      { name:'Window',  type:'area',    az:78, el:26, dist:0.95, power:6, kelvin:6300, size:1.6 },
      { name:'Shaper',  type:'spot',    az:70, el:32, dist:1.3, power:2.5, kelvin:6300, softness:0.8, angle:46 },
      { name:'Bounce',  type:'area',    az:-100,el:12, dist:0.9, power:0.9, kelvin:6000, size:1.2 }
    ]
  },
  {
    id:'golden', name:'Golden hour', meta:'low warm sun',
    note:'low golden hour sun, warm raking light from a shallow angle, long soft shadows, warm ambient bounce',
    lights:[
      { name:'Low sun', type:'sun',     az:140, el:11, dist:2.0, power:3.4, kelvin:2900, softness:0.3 },
      { name:'Sky',     type:'ambient', power:0.30, kelvin:7600 },
      { name:'Bounce',  type:'area',    az:-30, el:14, dist:1.0, power:0.8, kelvin:3400, size:1.2 }
    ]
  },
  {
    id:'overcast', name:'Overcast', meta:'flat, shadowless',
    note:'overcast daylight, flat even illumination from a broad sky, very soft shadows, cool neutral cast',
    lights:[
      { name:'Sky',      type:'ambient', power:1.15, kelvin:6800 },
      { name:'Soft top', type:'area',    az:10, el:66, dist:1.0, power:2.4, kelvin:6800, size:1.8 },
      { name:'Shaper',   type:'spot',    az:10, el:66, dist:1.4, power:1.2, kelvin:6800, softness:1.0, angle:52 }
    ]
  },
  {
    id:'hardsun', name:'Hard sun', meta:'sharp shadows',
    note:'direct midday sun, hard-edged shadows, high contrast, crisp specular highlights',
    lights:[
      { name:'Sun',     type:'sun',     az:35, el:58, dist:2.2, power:4.2, kelvin:5600, softness:0.05 },
      { name:'Sky',     type:'ambient', power:0.22, kelvin:8000 }
    ]
  },
  {
    id:'highkey', name:'High key', meta:'white, airy',
    note:'high key lighting on a white background, bright airy exposure, minimal shadow, clean e-commerce look',
    lights:[
      { name:'Front box', type:'area',    az:20,  el:30, dist:0.9, power:5.5, kelvin:5800, size:1.6 },
      { name:'Back wash', type:'area',    az:170, el:34, dist:1.0, power:4.5, kelvin:5800, size:1.6 },
      { name:'Top',       type:'spot',    az:0,   el:72, dist:1.2, power:3,   kelvin:5800, softness:0.95, angle:50 },
      { name:'Ambient',   type:'ambient', power:0.55, kelvin:6200 }
    ]
  },
  {
    id:'lowkey', name:'Low key', meta:'dark, single source',
    note:'low key lighting, one small hard source, deep black surroundings, dramatic chiaroscuro',
    lights:[
      { name:'Snoot', type:'spot',    az:58, el:52, dist:1.0, power:14, kelvin:4400, softness:0.1, angle:18 },
      { name:'Edge',  type:'spot',    az:200,el:30, dist:1.1, power:4,  kelvin:6800, softness:0.2, angle:24 },
      { name:'Ambient',type:'ambient',power:0.03, kelvin:6500 }
    ]
  }
];

export const rigById = id => RIGS.find(r => r.id === id) || null;

/** Human summary of one light, used by the prompt writer. */
export function describeLight(params){
  const t = LIGHT_TYPES[params.type]?.label.toLowerCase() ?? params.type;
  if (params.type === 'ambient') return `${kelvinName(params.kelvin)} ambient fill`;
  return `${t} at ${Math.round(params.az)}° azimuth, ` +
         `${Math.round(params.el)}° elevation, ${kelvinName(params.kelvin)}`;
}
