/* ============================================================
   figure.js — a head and a poseable artist's mannequin.

   The mannequin is a plain Object3D hierarchy, not a skinned mesh:
   every joint is an empty with its limb segment hanging off it, so
   rotating a joint rotates everything below it for free. That keeps
   posing exact, cheap, and readable — and it means the existing
   TransformControls gizmo can drive a joint with no special casing.

   Proportions follow the classical 7.5-head canon at 1.75 m tall.
   ============================================================ */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clayMaterial } from './material.js';

/* ---------------- head ---------------- */

/**
 * A simplified head: cranium, jaw wedge, brow, nose and a neck stub.
 * Planar enough to read as a head in a depth pass, plain enough not to
 * pretend it is a portrait.
 */
export function headGeometry({ neck = true } = {}){
  const parts = [];

  const cranium = new THREE.SphereGeometry(0.077, 40, 30);
  cranium.scale(1.0, 1.10, 1.14);
  cranium.translate(0, 0.030, -0.004);
  parts.push(cranium);

  // Jaw and chin: a tapered block, narrower and lower than the skull.
  const jaw = new THREE.CylinderGeometry(0.052, 0.036, 0.080, 24);
  jaw.scale(1.0, 1.0, 1.16);
  jaw.translate(0, -0.040, 0.006);
  parts.push(jaw);

  // Face front — fills the plane between brow and chin.
  const face = new THREE.SphereGeometry(0.058, 28, 22);
  face.scale(1.02, 1.16, 0.92);
  face.translate(0, -0.014, 0.020);
  parts.push(face);

  const nose = new THREE.ConeGeometry(0.019, 0.052, 4);
  nose.rotateX(Math.PI / 2);
  nose.rotateZ(Math.PI / 4);
  nose.translate(0, -0.008, 0.072);
  parts.push(nose);

  if (neck){
    const neckGeo = new THREE.CylinderGeometry(0.036, 0.041, 0.085, 24);
    neckGeo.translate(0, -0.096, -0.004);
    parts.push(neckGeo);
  }

  return mergeGeometries(parts, false) || cranium;
}

/* ---------------- mannequin ---------------- */

const P = {                 // proportions, metres
  ankle:  0.075,
  shin:   0.420,
  thigh:  0.440,
  pelvis: 0.120,
  spine:  0.170,
  chest:  0.170,
  neck:   0.080,
  headR:  0.098,
  clav:   0.175,            // shoulder half-width
  upper:  0.300,
  fore:   0.255,
  hand:   0.095,
  hipGap: 0.093
};

const R = {                 // segment radii
  thigh:0.078, shin:0.056, foot:0.045,
  pelvis:0.115, torso:0.118, chest:0.128,
  neck:0.040, upper:0.048, fore:0.040, hand:0.036
};

/** An empty at `offset` from its parent, registered by name. */
function joint(parent, name, offset, registry){
  const j = new THREE.Object3D();
  j.name = name;
  j.position.copy(offset);
  parent.add(j);
  registry.set(name, j);
  return j;
}

/** A capsule hanging from a joint along `dir` (default: straight down). */
function limb(jointNode, length, radius, dir = -1){
  const geo = new THREE.CapsuleGeometry(radius, Math.max(length - radius * 2, 0.001), 8, 20);
  const mesh = new THREE.Mesh(geo, clayMaterial());
  mesh.position.y = dir * length / 2;
  mesh.castShadow = mesh.receiveShadow = true;
  jointNode.add(mesh);
  return mesh;
}

function ball(jointNode, radius){
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), clayMaterial());
  mesh.castShadow = mesh.receiveShadow = true;
  jointNode.add(mesh);
  return mesh;
}

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Build the mannequin.
 * @returns {{root:THREE.Group, joints:Map<string,THREE.Object3D>}}
 */
export function makeMannequin(){
  const root = new THREE.Group();
  const joints = new Map();

  // Root sits on the floor; the pelvis rides at hip height.
  const hipHeight = P.ankle + P.shin + P.thigh;

  const pelvis = joint(root, 'pelvis', v3(0, hipHeight, 0), joints);
  const pelvisMesh = new THREE.Mesh(
    new THREE.SphereGeometry(R.pelvis, 24, 18), clayMaterial()
  );
  pelvisMesh.scale.set(1.0, 0.72, 0.82);
  pelvisMesh.position.y = 0.03;
  pelvisMesh.castShadow = pelvisMesh.receiveShadow = true;
  pelvis.add(pelvisMesh);

  /* ---- spine ---- */
  const spine = joint(pelvis, 'spine', v3(0, P.pelvis * 0.55, 0), joints);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(R.torso, 24, 18), clayMaterial());
  torso.scale.set(1.0, P.spine / R.torso * 0.60, 0.80);
  torso.position.y = P.spine * 0.45;
  torso.castShadow = torso.receiveShadow = true;
  spine.add(torso);

  const chest = joint(spine, 'chest', v3(0, P.spine, 0), joints);
  const chestMesh = new THREE.Mesh(new THREE.SphereGeometry(R.chest, 24, 18), clayMaterial());
  chestMesh.scale.set(1.12, P.chest / R.chest * 0.62, 0.78);
  chestMesh.position.y = P.chest * 0.34;
  chestMesh.castShadow = chestMesh.receiveShadow = true;
  chest.add(chestMesh);

  /* ---- neck and head ---- */
  const neck = joint(chest, 'neck', v3(0, P.chest * 0.86, 0), joints);
  limb(neck, P.neck, R.neck, 1);

  const head = joint(neck, 'head', v3(0, P.neck, 0), joints);
  const headMesh = new THREE.Mesh(headGeometry({ neck:false }), clayMaterial());
  headMesh.position.y = P.headR * 0.52;
  headMesh.castShadow = headMesh.receiveShadow = true;
  head.add(headMesh);

  /* ---- arms ---- */
  for (const [side, sign] of [['L', 1], ['R', -1]]){
    const shoulder = joint(chest, `shoulder${side}`,
      v3(sign * P.clav, P.chest * 0.72, 0), joints);
    ball(shoulder, R.upper * 0.92);
    limb(shoulder, P.upper, R.upper);

    const elbow = joint(shoulder, `elbow${side}`, v3(0, -P.upper, 0), joints);
    ball(elbow, R.fore * 0.92);
    limb(elbow, P.fore, R.fore);

    const wrist = joint(elbow, `wrist${side}`, v3(0, -P.fore, 0), joints);
    const handMesh = limb(wrist, P.hand, R.hand);
    handMesh.scale.set(1.0, 1.0, 0.55);
  }

  /* ---- legs ---- */
  for (const [side, sign] of [['L', 1], ['R', -1]]){
    const hip = joint(pelvis, `hip${side}`, v3(sign * P.hipGap, -P.pelvis * 0.30, 0), joints);
    ball(hip, R.thigh * 0.86);
    limb(hip, P.thigh, R.thigh);

    const knee = joint(hip, `knee${side}`, v3(0, -P.thigh, 0), joints);
    ball(knee, R.shin * 0.94);
    limb(knee, P.shin, R.shin);

    const ankle = joint(knee, `ankle${side}`, v3(0, -P.shin, 0), joints);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.055, 0.185), clayMaterial());
    foot.position.set(0, -P.ankle * 0.42, 0.045);
    foot.castShadow = foot.receiveShadow = true;
    ankle.add(foot);
  }

  applyPose(joints, POSES[0]);
  return { root, joints };
}

/* ---------------- posing ---------------- */

/** Degrees → the joint rotations that define a pose. */
export const POSES = [
  {
    id:'relaxed', name:'Relaxed',
    note:'standing at ease, weight even, arms hanging naturally',
    rot:{
      shoulderL:[3, 0, -7],  shoulderR:[3, 0, 7],
      elbowL:[10, 0, -3],    elbowR:[10, 0, 3],
      hipL:[-2, 0, 1],       hipR:[-2, 0, -1],
      kneeL:[3, 0, 0],       kneeR:[3, 0, 0]
    }
  },
  {
    id:'tpose', name:'T-pose',
    note:'arms straight out to the sides, neutral reference stance',
    rot:{
      shoulderL:[0, 0, -90], shoulderR:[0, 0, 90],
      elbowL:[0, 0, 0],      elbowR:[0, 0, 0]
    }
  },
  {
    id:'contrapposto', name:'Contrapposto',
    note:'weight on one leg, hip and shoulder lines opposed, classical stance',
    rot:{
      pelvis:[0, 0, -7],     spine:[0, 4, 5],  chest:[0, -6, 3],
      neck:[0, 6, -3],
      shoulderL:[6, 0, -10], shoulderR:[-4, 0, 12],
      elbowL:[18, 0, -4],    elbowR:[26, 0, 6],
      hipL:[-4, 0, 2],       hipR:[6, 0, -4],
      kneeL:[2, 0, 0],       kneeR:[16, 0, 0]
    }
  },
  {
    id:'walking', name:'Walking',
    note:'mid-stride walking pose, opposing arm and leg swing',
    rot:{
      spine:[2, 3, 0],  chest:[0, -5, 0],
      shoulderL:[-26, 0, -6], shoulderR:[24, 0, 6],
      elbowL:[26, 0, 0],      elbowR:[34, 0, 0],
      hipL:[24, 0, 1],        hipR:[-20, 0, -1],
      kneeL:[6, 0, 0],        kneeR:[30, 0, 0],
      ankleL:[-8, 0, 0],      ankleR:[12, 0, 0]
    }
  },
  {
    id:'sitting', name:'Sitting',
    note:'seated with thighs level and knees bent at a right angle',
    rot:{
      hipL:[-88, 0, 3],  hipR:[-88, 0, -3],
      kneeL:[86, 0, 0],  kneeR:[86, 0, 0],
      shoulderL:[12, 0, -8], shoulderR:[12, 0, 8],
      elbowL:[34, 0, -4],    elbowR:[34, 0, 4],
      spine:[4, 0, 0]
    }
  },
  {
    id:'reaching', name:'Reaching',
    note:'one arm raised and reaching upward, torso extended',
    rot:{
      spine:[-4, 0, -4], chest:[-6, 8, -4], neck:[-10, -6, 0],
      shoulderL:[-8, 0, -155], shoulderR:[8, 0, 14],
      elbowL:[12, 0, 0],       elbowR:[30, 0, 4],
      hipR:[-4, 0, 0], kneeL:[4, 0, 0]
    }
  },
  {
    id:'crouch', name:'Crouching',
    note:'low crouch, knees deeply bent, torso folded forward',
    rot:{
      spine:[26, 0, 0], chest:[12, 0, 0], neck:[-18, 0, 0],
      hipL:[-96, 0, 6], hipR:[-96, 0, -6],
      kneeL:[112, 0, 0], kneeR:[112, 0, 0],
      ankleL:[-26, 0, 0], ankleR:[-26, 0, 0],
      shoulderL:[-16, 0, -12], shoulderR:[-16, 0, 12],
      elbowL:[52, 0, 0], elbowR:[52, 0, 0]
    }
  }
];

export const poseById = id => POSES.find(p => p.id === id) || null;

/** Reset every joint, then apply the pose's rotations. */
export function applyPose(joints, pose){
  for (const j of joints.values()) j.rotation.set(0, 0, 0);
  if (!pose) return;
  for (const [name, [x, y, z]] of Object.entries(pose.rot)){
    const j = joints.get(name);
    if (j) j.rotation.set(
      THREE.MathUtils.degToRad(x),
      THREE.MathUtils.degToRad(y),
      THREE.MathUtils.degToRad(z)
    );
  }
}

/* ---------------- joint handles ---------------- */

const HANDLE_R = 0.028;
const handleGeo = new THREE.SphereGeometry(HANDLE_R, 16, 12);
const handleMat = new THREE.MeshBasicMaterial({
  color:0xBF5AF2, depthTest:false, transparent:true, opacity:0.85
});
const handleMatOn = new THREE.MeshBasicMaterial({ color:0xffffff, depthTest:false });

/** Joints a user actually poses — the ones that get a grab handle. */
const POSEABLE = [
  'pelvis','spine','chest','neck','head',
  'shoulderL','elbowL','wristL','shoulderR','elbowR','wristR',
  'hipL','kneeL','ankleL','hipR','kneeR','ankleR'
];

/**
 * Attach a clickable handle to every poseable joint. Handles are children
 * of their joints so they follow the pose; the caller registers them with
 * viewport.extraHelpers so exports never see them.
 * @returns {THREE.Mesh[]}
 */
export function buildJointHandles(joints){
  const handles = [];
  for (const name of POSEABLE){
    const j = joints.get(name);
    if (!j) continue;
    const h = new THREE.Mesh(handleGeo, handleMat);
    h.renderOrder = 999;
    h.visible = false;
    h.userData.joint = { node:j, name };
    j.add(h);
    handles.push(h);
  }
  return handles;
}

export function highlightJointHandle(handles, active){
  for (const h of handles) h.material = (h === active) ? handleMatOn : handleMat;
}
