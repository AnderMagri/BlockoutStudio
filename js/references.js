/* ============================================================
   references.js — declaring what each grey shape stands in for.

   The scene stays grey clay. That is the whole point of the studio: the
   geometry tells an image model the composition, the camera and the
   light, and surface detail would only mislead the data passes.

   But a real product has a label, a cover, a screen — and often you have
   a photograph of the thing itself. Those files go straight to the image
   tool; the studio never holds them. What the studio contributes is
   knowing *which grey shape each one belongs to*, and saying so in words
   the model can act on.

   So a reference here is a DECLARATION, not an upload: "this box stands
   in for a phone, and I am supplying a photo of it." No bytes, no file
   store, nothing to manage.

   ── WHY THE WORDS MATTER ──────────────────────────────────────
   Multi-image models take an array of images with no mask field, no
   region selection and no per-image metadata. Nothing in the request
   says which grey box is the phone — the model infers it from the
   prompt. So the prompt has to say it, and say it accurately.

   `describeRefTargets` projects each declared object through the active
   camera and describes where it lands in the frame. A person guessing
   "the box on the left" is wrong as soon as the camera moves. Real
   geometry is not.
   ============================================================ */

import * as THREE from 'three';

import * as store from './store.js';
import { activeCamera } from './viewport.js';

/**
 * What a reference is for. The role is not decoration — it becomes the
 * wording in the generated prompt, and "replace this shape with this
 * product" is a very different instruction from "apply this label to it".
 */
export const ROLES = {
  product: {
    id: 'product',
    label: 'The product itself',
    hint: 'A photo of the real thing this shape stands in for.',
    /** @param {string} where screen-space description of the object */
    phrase: where => `the product that replaces ${where}`
  },
  label: {
    id: 'label',
    label: 'Label / packaging artwork',
    hint: 'Artwork to appear on the surface.',
    phrase: where => `the label artwork to apply to ${where}`
  },
  screen: {
    id: 'screen',
    label: 'Screen content',
    hint: 'What is displayed on the screen.',
    phrase: where => `the screen content for ${where}`
  },
  cover: {
    id: 'cover',
    label: 'Cover art',
    hint: 'A book, magazine or case cover.',
    phrase: where => `the cover art for ${where}`
  },
  other: {
    id: 'other',
    label: 'Other reference',
    hint: 'Anything else the model should look at.',
    phrase: where => `a reference for ${where}`
  }
};

export const ROLE_LIST = Object.values(ROLES);
export const roleById = id => ROLES[id] || ROLES.other;

/* ---------------- the model ---------------- */

/**
 * Declare that an item stands in for something you are supplying an
 * image of.
 *
 * @param {object} item a store item
 * @param {{role?:string, describe?:string}} ref
 *   `describe` does double duty: it tells the model what the thing is,
 *   and it tells you which of your files to wire to this slot.
 */
export function attachRef(item, { role = 'product', describe = '' } = {}){
  if (!item) return null;
  if (!item.refs) item.refs = [];

  const ref = {
    role: ROLES[role] ? role : 'other',
    describe: String(describe || '').trim()
  };
  item.refs.push(ref);
  store.changed();
  return ref;
}

/** Remove one declaration by its position in the item's list. */
export function detachRef(item, index){
  if (!item?.refs) return false;
  if (index < 0 || index >= item.refs.length) return false;
  item.refs.splice(index, 1);
  store.changed();
  return true;
}

/** Every reference in the scene, with the item that owns it. */
export function allRefs(){
  const out = [];
  for (const item of store.state.items){
    for (const ref of item.refs || []) out.push({ item, ref });
  }
  return out;
}

export const refCount = () => allRefs().length;

/* ---------------- where things are in the frame ---------------- */

const _box = new THREE.Box3();
const _v   = new THREE.Vector3();

/**
 * Describe where an object sits in the rendered frame, in words.
 *
 * Projects the object's bounding-box centre through the camera into
 * normalised device coordinates, which is exactly the frame the export
 * is cropped to, and turns that into the kind of phrase a person would
 * use. "Left" here means left *as the picture shows it*, which is what
 * the image model is looking at — not left in world space.
 *
 * @returns {string|null} e.g. "centre-left, about a third up the frame"
 */
export function framePosition(item, camera = activeCamera()){
  if (!item?.obj) return null;

  _box.setFromObject(item.obj);
  if (_box.isEmpty()) return null;

  _box.getCenter(_v);
  camera.updateMatrixWorld();
  _v.project(camera);                       // → NDC, -1..1 on both axes

  // Behind the camera, or outside the frame: any words about left and
  // right would be a guess, so say nothing rather than something wrong.
  if (_v.z > 1 || Math.abs(_v.x) > 1.15 || Math.abs(_v.y) > 1.15) return null;

  const x = _v.x, y = _v.y;

  const across =
    x < -0.55 ? 'far left' :
    x < -0.18 ? 'left of centre' :
    x <  0.18 ? 'centre' :
    x <  0.55 ? 'right of centre' : 'far right';

  const up =
    y < -0.55 ? 'low in the frame' :
    y < -0.18 ? 'below centre' :
    y <  0.18 ? 'at mid height' :
    y <  0.55 ? 'above centre' : 'high in the frame';

  return `${across}, ${up}`;
}

/**
 * How big the object is in frame, as a share of the picture's height.
 * Useful to the model as a scale cue, and it distinguishes two objects
 * that happen to sit at the same place in the frame.
 */
export function frameShare(item, camera = activeCamera()){
  if (!item?.obj) return null;

  _box.setFromObject(item.obj);
  if (_box.isEmpty()) return null;

  const corners = [];
  for (let i = 0; i < 8; i++){
    corners.push(new THREE.Vector3(
      (i & 1) ? _box.max.x : _box.min.x,
      (i & 2) ? _box.max.y : _box.min.y,
      (i & 4) ? _box.max.z : _box.min.z
    ).project(camera));
  }
  const ys = corners.map(c => c.y);
  const share = (Math.max(...ys) - Math.min(...ys)) / 2;   // NDC spans 2
  if (!Number.isFinite(share) || share <= 0) return null;
  return Math.min(share, 1);
}

/**
 * A phrase identifying one object well enough for an image model to pick
 * it out of a grey blockout: what shape it is, what it is called, and
 * where it sits in the picture.
 *
 * The shape word matters. "The cylinder" is meaningless to a model
 * looking at a photo-real render, but it is exactly right for a model
 * looking at the grey blockout we are also sending.
 */
export function describeTarget(item, camera = activeCamera()){
  const shape = item.sub || 'shape';
  const named = item.name && item.name !== shape ? ` ("${item.name}")` : '';

  const where = framePosition(item, camera);
  const share = frameShare(item, camera);

  const size =
    share == null   ? '' :
    share > 0.6     ? ', filling most of the frame height' :
    share > 0.3     ? ', about a third of the frame height' :
    share > 0.12    ? ', a small part of the frame' : ', small in the frame';

  const place = where ? ` at ${where}` : '';
  return `the ${shape}${named}${place}${size}`;
}

/**
 * Every annotated object, in the order their images will be sent, with
 * the sentence that ties each image to its object.
 *
 * Returned rather than formatted so prompt.js decides the final wording
 * and generate.js can send the images in exactly this order — the two
 * must agree, because "Image 3" only means anything if both sides count
 * the same way.
 *
 * @returns {{item:object, ref:object, target:string, phrase:string}[]}
 */
export function describeRefTargets(camera = activeCamera()){
  return allRefs().map(({ item, ref }) => {
    const target = describeTarget(item, camera);
    const role = roleById(ref.role);
    const extra = ref.describe ? ` It is ${ref.describe}.` : '';
    return {
      item, ref, target,
      phrase: `${role.phrase(target)}.${extra}`
    };
  });
}
