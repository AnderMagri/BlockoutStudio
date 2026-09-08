/* ============================================================
   prompt.js — turn the actual scene state into prompt text.

   Everything here is read from the live scene rather than from whatever
   preset was last clicked, so the prompt cannot drift out of sync with
   what the exported images show.
   ============================================================ */

import * as store from './store.js';
import { dofCharacter, equivFromFocal } from './optics.js';
import { kelvinName, mm } from './util.js';
import { describeLightForPrompt, describeDirection } from './lights.js';
import { labelFor } from './catalog.js';
import { describeRefTargets } from './references.js';

/** What each set mode actually looks like, in prompt language. */
const SET_WORDS = {
  none:     'floating against an empty background, no visible surface',
  ground:   'standing on a plain continuous surface with an open horizon',
  backdrop: 'on a plain surface against a flat backdrop wall',
  infinite: 'on a seamless infinity cove, no horizon line and no visible corner'
};

/** Count the subject shapes so the prompt can mention the arrangement. */
function describeSubject(){
  const meshes = store.subjectMeshes();
  if (!meshes.length) return '[subject]';

  // Words that take no article and do not pluralise with a bare "s".
  const UNCOUNTABLE = new Set(['lettering']);

  const counts = new Map();
  for (const m of meshes){
    // Describe what a thing IS, from the catalog — not what the user
    // renamed it to. "Hero bottle" should still read as a bottle.
    const key = m.sub === 'text' ? 'lettering'
              : m.sub === 'spline' ? 'curved form'
              : labelFor(m.sub).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const parts = [...counts].map(([name, n]) => {
    if (UNCOUNTABLE.has(name)) return name;
    return n > 1 ? `${n} ${name}s` : `a ${name}`;
  });
  if (parts.length === 1) return `[product — ${parts[0]} in the blockout]`;
  return `[product group — ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}]`;
}

/** The brightest non-ambient light, which is what reads as the key. */
function keyLight(){
  const lights = store.itemsOfKind('light')
    .filter(l => l.obj.visible && l.params.type !== 'ambient');
  if (!lights.length) return null;
  return lights.reduce((a, b) => (b.params.power > a.params.power ? b : a));
}

/*
 * Lighting has to be described by what it does, never by the kit doing it.
 *
 * A prompt saying "large softbox directly overhead" comes back with a
 * softbox hanging in the top of the frame: a named object is something the
 * model draws. "Window light" paints a window. So every rig carries a
 * `look` written for prompts alongside the `note` written for the panel,
 * and single lights go through describeLightForPrompt.
 */
function describeLighting(rig){
  const key = keyLight();
  const lines = [];

  if (rig) lines.push(rig.look ?? rig.note);
  else if (key) lines.push(`lit by ${describeLightForPrompt(key.params)}`);
  else lines.push('soft even lighting');

  if (key){
    // Plain words first, because that is what the model can act on; the
    // angles follow for anyone rebuilding the setup for real.
    lines.push(
      `key light ${describeDirection(key.params.az, key.params.el)} ` +
      `(${Math.round(key.params.az)}° azimuth, ` +
      `${Math.round(key.params.el)}° elevation), ` +
      `${kelvinName(key.params.kelvin)} at ${Math.round(key.params.kelvin)}K`
    );
  }
  return lines;
}

/**
 * @param {object} ctx {format, focal, fstop, focusM, dof, shot, rig, aspect}
 */
export function buildPrompt(ctx){
  const equiv = Math.round(equivFromFocal(ctx.focal, ctx.format));
  const lighting = describeLighting(ctx.rig);

  const camera = [
    `${equiv}mm on ${ctx.format.short}`,
    `f/${ctx.fstop}`,
    ctx.shot ? ctx.shot.note : 'free camera framing',
    `focused at ${(ctx.focusM * 100).toFixed(0)} cm`
  ].join(', ');

  const dofLine = isFinite(ctx.dof.total)
    ? `${dofCharacter(ctx.dof.total)} — roughly ${mm(ctx.dof.total)} of the scene is sharp`
    : dofCharacter(ctx.dof.total);

  const setLine = SET_WORDS[store.state.setMode] ?? SET_WORDS.backdrop;

  return [
    describeSubject(),
    `· ${setLine}, in [environment]`,
    `· camera: ${camera}`,
    `· depth of field: ${dofLine}`,
    ...lighting.map(l => `· lighting: ${l}`),
    `· composition: ${ctx.aspect.label}, product reads clearly against the background`,
    '· mood: [atmosphere and palette]',
    '· razor-sharp on the product, photographic realism, no text artefacts'
  ].join('\n');
}

/* ============================================================
   The generation request

   A different job from buildPrompt above. That one writes prose for a
   person to paste and edit, with [placeholders] to fill in. This one
   writes an instruction for a model that is being handed several images
   at once, and every word of it has to be true of what we actually send.

   Two things are easy to get wrong and both are fatal:

   1. The grey render is a LAYOUT GUIDE, not a target. Send it without
      saying so and the model faithfully returns grey clay. It has to be
      told the material is a placeholder.
   2. The images are identified only by their position in the array.
      "Image 3" means the third thing sent, so the manifest that numbers
      them here is the same manifest generate.js sends — never two lists
      that happen to agree.
   ============================================================ */

/**
 * Decide what to send and in what order.
 *
 * @param {object} opts
 * @param {boolean} [opts.includeDepth] send the depth pass as well
 * @param {boolean} [opts.includeEdge]  send the edge pass as well
 * @returns {{kind:'pass'|'ref', pass?:string, label:string, ref?:object,
 *            item?:object, phrase?:string}[]}
 */
export function buildManifest({ includeDepth = true, includeEdge = false } = {}){
  const manifest = [
    { kind:'pass', pass:'render', label:'the grey blockout' }
  ];
  if (includeDepth) manifest.push({ kind:'pass', pass:'depth', label:'a depth map' });
  if (includeEdge)  manifest.push({ kind:'pass', pass:'edge',  label:'an edge map' });

  for (const t of describeRefTargets()){
    manifest.push({
      kind:'ref', ref:t.ref, item:t.item,
      label: t.ref.describe || `${t.item.name} reference`,
      phrase: t.phrase
    });
  }
  return manifest;
}

/** What each pass is for, said plainly enough to be acted on. */
const PASS_WORDS = {
  render:
    'a grey clay blockout of the composition. Match its camera angle, ' +
    'perspective, object placement, proportions and lighting direction ' +
    'exactly. The grey material is a placeholder for layout only — do not ' +
    'reproduce the grey clay look in the final image',
  depth:
    'a linear depth map of the same scene, where nearer surfaces are ' +
    'brighter. Use it to keep the depth relationships and the position of ' +
    'every object exactly as shown',
  edge:
    'a line drawing of the same scene showing silhouettes and hard edges. ' +
    'Keep every contour where it falls here'
};

/**
 * The instruction that travels with the images.
 *
 * @param {object} ctx      same shape buildPrompt takes
 * @param {object[]} manifest from buildManifest — the exact send order
 * @param {string} [intent] what the user actually wants, in their words
 */
export function buildGenerationPrompt(ctx, manifest, intent = ''){
  const equiv = Math.round(equivFromFocal(ctx.focal, ctx.format));
  const lines = [];

  const wanted = String(intent || '').trim();
  lines.push(wanted || 'A photorealistic product photograph.');
  lines.push('');

  // Number the images exactly as they are sent.
  lines.push('You are given these images, in order:');
  manifest.forEach((entry, i) => {
    const n = i + 1;
    if (entry.kind === 'pass'){
      lines.push(`Image ${n} is ${PASS_WORDS[entry.pass] || entry.label}.`);
    } else {
      lines.push(`Image ${n} is ${entry.phrase}`);
    }
  });

  const refs = manifest.filter(e => e.kind === 'ref');
  if (refs.length){
    lines.push('');
    lines.push(
      'Render the referenced products as the real items shown, in the exact ' +
      'positions and at the exact scale their placeholder shapes occupy in ' +
      'the blockout. Keep any artwork, lettering and logos from the ' +
      'reference images legible and unaltered.'
    );
  }

  lines.push('');
  lines.push('Shoot it as:');
  lines.push(`· ${equiv}mm on ${ctx.format.short} at f/${ctx.fstop}, ` +
             `focused at ${(ctx.focusM * 100).toFixed(0)} cm`);
  lines.push(`· ${isFinite(ctx.dof.total)
    ? `${dofCharacter(ctx.dof.total)} — roughly ${mm(ctx.dof.total)} sharp`
    : dofCharacter(ctx.dof.total)}`);
  for (const l of describeLighting(ctx.rig)) lines.push(`· ${l}`);
  lines.push(`· ${SET_WORDS[store.state.setMode] ?? SET_WORDS.backdrop}`);
  lines.push(`· ${ctx.aspect.label} framing`);
  lines.push('· photographic realism, sharp on the product, no invented text');

  return lines.join('\n');
}
