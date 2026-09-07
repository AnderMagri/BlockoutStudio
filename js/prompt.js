/* ============================================================
   prompt.js — turn the actual scene state into prompt text.

   Everything here is read from the live scene rather than from whatever
   preset was last clicked, so the prompt cannot drift out of sync with
   what the exported images show.
   ============================================================ */

import * as store from './store.js';
import { dofCharacter, equivFromFocal } from './optics.js';
import { kelvinName, mm } from './util.js';
import { describeLight } from './lights.js';
import { labelFor } from './catalog.js';

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

function describeLighting(rig){
  const key = keyLight();
  const lines = [];

  if (rig) lines.push(rig.note);
  else if (key) lines.push(`lit by a ${describeLight(key.params)}`);
  else lines.push('soft even lighting');

  if (key){
    lines.push(
      `key light at ${Math.round(key.params.az)} degrees azimuth and ` +
      `${Math.round(key.params.el)} degrees elevation, ` +
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

  return [
    describeSubject(),
    '· on [surface], in [environment]',
    `· camera: ${camera}`,
    `· depth of field: ${dofLine}`,
    ...lighting.map(l => `· lighting: ${l}`),
    `· composition: ${ctx.aspect.label}, product reads clearly against the background`,
    '· mood: [atmosphere and palette]',
    '· razor-sharp on the product, photographic realism, no text artefacts'
  ].join('\n');
}
