/* ============================================================
   inspector.js — context panel for whatever is selected.

   This is where lens controls live: a camera is an object, so its
   settings belong to it rather than to a permanent sidebar.

   The panel is only rebuilt when the selection changes. Slider drags
   and typing update the scene and the readouts in place, because
   rebuilding the DOM under a focused field steals the caret.
   ============================================================ */

import * as store from './store.js';
import {
  duplicateSelected, destroySelected, updateLight, updateTextObject,
  applyCameraParams, lookThrough, refreshOutline, setPose, frameSubject,
  setCameraLock, measureItem, resizeItem, restOnGround, centreSelection
} from './objects.js';
import { gizmo, activeCamera, renderer, getAspect } from './viewport.js';
import { rebuildSpline, addControlPoint, removeControlPoint } from './spline.js';
import { POSES } from './figure.js';
import {
  FORMAT_LIST, FORMATS, FSTOPS, LENSES, SHOTS,
  focalFromEquiv, depthOfField, hFov
} from './optics.js';
import { LIGHT_TYPES } from './lights.js';
import { ROLE_LIST, roleById, attachRef, detachRef } from './references.js';
import { $, el, fillSelect, metres, mm, kelvinName } from './util.js';
import { UNIT_LIST, unit, setUnit, value as unitValue, parse as parseLength } from './units.js';

let lastId = null;

/* Module scope on purpose: the inspector rebuilds after every resize, so a
   local would silently flip this back on between one edit and the next. */
let keepProportions = true;

/* ---------------- builders ---------------- */

function field(labelText, valueText){
  const row = el('div', 'field');
  row.appendChild(el('label', null, labelText));
  const val = el('span', 'val', valueText);
  row.appendChild(val);
  return { row, val };
}

/** A labelled range slider whose readout tracks the handle. */
function slider(host, labelText, opts){
  const { row, val } = field(labelText, opts.format(opts.value));
  const input = el('input');
  input.type = 'range';
  input.min = opts.min; input.max = opts.max; input.step = opts.step;
  input.value = opts.value;
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = opts.format(v);
    opts.onInput(v);
  });
  host.append(row, input);
  return { input, val };
}

function button(host, label, onClick, cls = ''){
  const b = el('button', cls, label);
  b.onclick = onClick;
  host.appendChild(b);
  return b;
}

function section(host, title){
  const h = el('h2', null, title);
  h.style.marginTop = '14px';
  host.appendChild(h);
}

function tileGrid(host, entries, isOn, onPick){
  const grid = el('div', 'gallery');
  for (const e of entries){
    const b = el('button', 'tile' + (isOn(e) ? ' on' : ''));
    b.appendChild(el('span', 't-name', e.name));
    if (e.meta) b.appendChild(el('span', 't-meta', e.meta));
    b.onclick = () => { onPick(e); renderInspector(true); };
    grid.appendChild(b);
  }
  host.appendChild(grid);
  return grid;
}

/* ---------------- entry point ---------------- */

export function renderInspector(force = false){
  const host = $('inspector');
  if (!host) return;

  const item = store.state.selected;
  const id = item ? item.id : null;

  if (!force && id === lastId) return;   // keep the DOM, keep the caret
  lastId = id;
  host.innerHTML = '';

  if (!item){
    host.appendChild(el('p', 'empty-note',
      'Nothing selected. Click an object, or a camera to set its lens.'));
    return;
  }

  host.appendChild(headerFor(item));

  switch (item.kind){
    case 'camera': cameraControls(host, item); break;
    case 'light':  lightControls(host, item);  break;
    default:       meshControls(host, item);   break;
  }
}

function headerFor(item){
  const head = el('div', 'insp-head');
  head.appendChild(el('span', 'insp-kind', item.sub || item.kind));

  const name = el('input', 'insp-name');
  name.type = 'text';
  name.value = item.name;
  name.oninput = e => { item.name = e.target.value; store.emit('names'); };
  head.appendChild(name);
  return head;
}

/* ---------------- transform ---------------- */

function transformControls(host, item){
  const modes = el('div', 'grid-3');
  for (const [mode, label] of [['translate','Move'], ['rotate','Rotate'], ['scale','Scale']]){
    button(modes, label, () => gizmo.setMode(mode));
  }
  host.appendChild(modes);

  const moveTo = el('select');
  moveTo.style.marginTop = '6px';
  fillSelect(moveTo,
    store.state.layers.map(l => ({ value:l.id, label:`Layer: ${l.name}` })),
    item.layerId);
  moveTo.onchange = e => {
    item.layerId = +e.target.value;
    store.applyVisibility();
    store.changed();
  };
  host.appendChild(moveTo);

  if (!item.locked){
    // Turns the camera without moving it, so a viewpoint you settled on
    // survives — unlike "Fit to subject", which also picks a distance.
    const centre = button(host, 'Centre in view', () => {
      centreSelection();
      renderInspector(true);
    }, 'btn-quiet');
    centre.style.marginTop = '6px';
    centre.title = 'Aim the camera at this object, keeping its position (C)';

    const row = el('div', 'grid-2');
    row.style.marginTop = '6px';
    button(row, 'Duplicate', () => duplicateSelected());
    button(row, 'Delete', () => destroySelected(), 'btn-danger');
    host.appendChild(row);
  }
}

/* ---------------- meshes ---------------- */

function meshControls(host, item){
  if (item.sub === 'text')      textControls(host, item);
  if (item.sub === 'spline')    splineControls(host, item);
  if (item.sub === 'mannequin') mannequinControls(host, item);
  dimensionControls(host, item);
  standInControls(host, item);
  transformControls(host, item);
}

/**
 * Declare what this grey shape stands in for.
 *
 * No file is involved — the artwork and product photos go straight to
 * the image tool. What the studio contributes is knowing which shape
 * each one belongs to, so the generated instruction can say so and the
 * model puts the right thing in the right place.
 */
function standInControls(host, item){
  section(host, 'Stands in for');

  const list = el('div', 'scene-list');
  host.appendChild(list);

  const repaint = () => {
    list.innerHTML = '';
    if (!item.refs?.length){
      list.appendChild(el('p', 'caption',
        'Nothing declared. Grey shapes are described only by their form.'));
      return;
    }
    item.refs.forEach((ref, i) => {
      const row = el('div', 'scene-row');
      const text = el('span', 'scene-text');
      text.appendChild(el('span', 'scene-name', roleById(ref.role).label));
      text.appendChild(el('span', 'scene-meta', ref.describe || 'no description'));
      row.appendChild(text);

      const del = el('button', 'tiny btn-danger', '×');
      del.title = 'Remove';
      del.onclick = () => { detachRef(item, i); repaint(); };
      row.append(del);
      list.appendChild(row);
    });
  };
  repaint();

  const role = el('select');
  fillSelect(role, ROLE_LIST.map(r => ({ value:r.id, label:r.label })), 'product');

  const what = el('input');
  what.type = 'text';
  what.placeholder = 'What is it? e.g. an iPhone 15 Pro';
  what.setAttribute('aria-label', 'What this shape stands in for');

  const add = el('button', 'btn-quiet', 'Declare');
  add.onclick = () => {
    attachRef(item, { role: role.value, describe: what.value });
    what.value = '';
    repaint();
  };
  what.onkeydown = e => { if (e.key === 'Enter') add.click(); };

  host.append(role, what, add);
  host.appendChild(el('p', 'caption',
    'Named in the prompt under Export → Image brief, with this object’s ' +
    'position in frame so the model knows which shape you mean.'));
}

/**
 * Real-world size. Everything in the scene is modelled at true scale, so
 * these are the actual dimensions of the thing — type a number to make an
 * object exactly that big.
 */
function dimensionControls(host, item){
  const size = measureItem(item);
  if (!size) return;

  const head = el('h2');
  head.style.marginTop = '15px';
  head.appendChild(document.createTextNode('Size'));

  const unitSel = el('select');
  unitSel.style.cssText = 'width:auto; margin-left:auto; font-size:10px; padding:1px 18px 1px 5px';
  fillSelect(unitSel, UNIT_LIST.map(u => ({ value:u.id, label:u.label })), unit().id);
  unitSel.onchange = e => { setUnit(e.target.value); renderInspector(true); };
  head.appendChild(unitSel);
  host.appendChild(head);

  const row = el('div', 'grid-3');
  const fields = {};

  for (const axis of ['x', 'y', 'z']){
    const wrap = el('div', 'dim');
    wrap.appendChild(el('span', 'dim-label', { x:'W', y:'H', z:'D' }[axis]));

    const input = el('input');
    input.type = 'text';
    input.className = 'dim-input';
    input.value = unitValue(size[axis]);
    input.setAttribute('aria-label', { x:'Width', y:'Height', z:'Depth' }[axis]);

    const commit = () => {
      const current = measureItem(item)[axis];
      // An untouched field still holds the unit-rounded display string, and
      // committing that would silently resize to the rounding error.
      if (input.value.trim() === unitValue(current)) return;

      const metresWanted = parseLength(input.value);
      if (metresWanted == null || metresWanted <= 0){
        input.value = unitValue(current);                   // reject, restore
        return;
      }
      resizeItem(item, axis, metresWanted, keepProportions);
      restOnGround(item);
      renderInspector(true);
    };
    input.onchange = commit;
    input.onkeydown = e => { if (e.key === 'Enter') commit(); };

    wrap.appendChild(input);
    row.appendChild(wrap);
    fields[axis] = input;
  }
  host.appendChild(row);

  const keep = el('label', 'switch');
  keep.appendChild(document.createTextNode('Keep proportions'));
  const keepBox = el('input');
  keepBox.type = 'checkbox';
  keepBox.checked = keepProportions;
  keepBox.onchange = () => { keepProportions = keepBox.checked; };
  keep.appendChild(keepBox);
  host.appendChild(keep);

  host.appendChild(el('p', 'caption',
    `Real dimensions. The floor grid is ${metres(0.05)} per square.`));
}

function textControls(host, item){
  const p = item.obj.userData.textParams;

  const input = el('input');
  input.type = 'text';
  input.value = p.text;
  input.setAttribute('aria-label', 'Text content');
  let pending = null;
  input.oninput = () => {
    p.text = input.value;
    // Extruded glyphs are expensive; wait for a pause in typing.
    clearTimeout(pending);
    pending = setTimeout(() => updateTextObject(item), 140);
  };
  host.appendChild(input);

  slider(host, 'Size', {
    min:0.005, max:0.30, step:0.001, value:p.size,
    format:metres, onInput: v => { p.size = v; updateTextObject(item); }
  });
  slider(host, 'Extrusion', {
    min:0.001, max:0.06, step:0.001, value:p.depth,
    format:metres, onInput: v => { p.depth = v; updateTextObject(item); }
  });
}

function splineControls(host, item){
  const p = item.spline.params;

  slider(host, 'Thickness', {
    min:0.002, max:0.06, step:0.001, value:p.radius,
    format:metres,
    onInput: v => { p.radius = v; rebuildSpline(item.spline); refreshOutline(); }
  });
  slider(host, 'Tension', {
    min:0, max:1, step:0.05, value:p.tension,
    format: v => v.toFixed(2),
    onInput: v => { p.tension = v; rebuildSpline(item.spline); }
  });

  const closed = el('label', 'switch');
  closed.appendChild(document.createTextNode('Closed loop'));
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = p.closed;
  cb.onchange = () => { p.closed = cb.checked; rebuildSpline(item.spline); refreshOutline(); };
  closed.appendChild(cb);
  host.appendChild(closed);

  const row = el('div', 'grid-2');
  button(row, 'Add point', () => { addControlPoint(item.spline); refreshOutline(); });
  button(row, 'Remove point', () => { removeControlPoint(item.spline); refreshOutline(); });
  host.appendChild(row);

  host.appendChild(el('p', 'caption',
    'Click a control point to grab it, then move it with the gizmo.'));
}

function mannequinControls(host, item){
  section(host, 'Pose');
  tileGrid(host,
    POSES.map(p => ({ ...p, meta:'' })),
    p => p.id === item.params.pose,
    p => setPose(item, p.id));

  host.appendChild(el('p', 'caption',
    'Click any purple joint to grab it — the gizmo switches to rotate, and ' +
    'everything below that joint follows.'));
}

/* ---------------- cameras ---------------- */

function cameraControls(host, item){
  const p = item.params;

  const viewing = !!item.isActiveView;
  button(host,
    viewing ? 'Back to scene view' : 'Look through',
    () => { lookThrough(viewing ? null : item); renderInspector(true); syncFromUI(); },
    viewing ? 'btn-quiet' : 'btn-accent');

  const lock = el('label', 'switch');
  lock.appendChild(document.createTextNode('Lock framing'));
  const lockBox = el('input');
  lockBox.type = 'checkbox';
  lockBox.checked = !!p.locked;
  lockBox.onchange = () => { setCameraLock(item, lockBox.checked); renderInspector(true); };
  lock.appendChild(lockBox);
  host.appendChild(lock);

  if (p.locked){
    host.appendChild(el('p', 'caption',
      'Locked — dragging will not move this camera. The lens still works.'));
  }

  section(host, 'Lens');
  tileGrid(host,
    LENSES.map(l => ({ ...l, meta:`${l.character} · f/${l.fstop.toFixed(1)}` })),
    l => Math.round(p.equiv) === l.equiv,
    l => { p.equiv = l.equiv; p.fstop = l.fstop; applyCameraParams(item); syncFromUI(); });

  const format = el('select');
  format.style.marginTop = '2px';
  fillSelect(format, FORMAT_LIST.map(f => ({ value:f.id, label:f.name })), p.formatId);
  format.onchange = e => {
    p.formatId = e.target.value;
    applyCameraParams(item);
    renderInspector(true);
  };
  host.appendChild(format);

  const dofBox = el('div', 'readout');

  const refreshDof = () => {
    const fmt = FORMATS[p.formatId];
    const focalReal = focalFromEquiv(p.equiv, fmt);
    const dof = depthOfField(focalReal, p.fstop, p.focus, fmt);
    dofBox.innerHTML =
      `<b>${mm(dof.total)}</b> in focus · ${mm(dof.front)} front / ${mm(dof.back)} back<br>` +
      `real focal <b>${focalReal.toFixed(0)} mm</b> · h-fov ${hFov(focalReal, fmt, getAspect().w / getAspect().h).toFixed(0)}°<br>` +
      `hyperfocal ${mm(dof.hyperfocal)}`;
    syncFromUI();
  };

  slider(host, 'Focal length', {
    min:12, max:300, step:1, value:p.equiv,
    format: v => `${Math.round(v)} mm`,
    onInput: v => { p.equiv = v; applyCameraParams(item); refreshDof(); }
  });
  // The f-stop may have been set to a value off the ladder (via the scene
  // API); the nearest step is honest, where indexOf's -1 showed f/1.4.
  const fstopIndex = FSTOPS.reduce(
    (best, f, i) => Math.abs(f - p.fstop) < Math.abs(FSTOPS[best] - p.fstop) ? i : best, 0);
  slider(host, 'Aperture', {
    min:0, max:FSTOPS.length - 1, step:1,
    value: fstopIndex,
    format: i => `f/${FSTOPS[i]}`,
    onInput: i => { p.fstop = FSTOPS[i]; refreshDof(); }
  });
  slider(host, 'Focus distance', {
    min:0.05, max:4, step:0.01, value:p.focus,
    format:metres,
    onInput: v => { p.focus = v; refreshDof(); }
  });

  host.appendChild(dofBox);
  refreshDof();

  slider(host, 'Exposure', {
    min:-3, max:3, step:0.1, value:Math.log2(renderer.toneMappingExposure),
    format: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} EV`,
    onInput: v => { renderer.toneMappingExposure = Math.pow(2, v); }
  });

  section(host, 'Framing');
  tileGrid(host,
    SHOTS.map(s => ({ ...s, meta:`${s.equiv}mm` })),
    () => false,
    s => applyShotFromInspector(s, item));

  const fit = button(host, 'Fit to subject', () => frameSubject(activeCamera()), 'btn-quiet');
  fit.style.marginTop = '2px';

  host.appendChild(el('p', 'caption',
    'Move and aim this camera with the gizmo like any other object.'));

  transformControls(host, item);
}

/* ui.js owns shot application; imported lazily to avoid an import cycle. */
async function applyShotFromInspector(shot, item){
  const ui = await import('./ui.js');
  if (!ui.activeCameraItem() || ui.activeCameraItem() !== item) lookThrough(item);
  ui.applyShot(shot);
  renderInspector(true);
}

async function syncFromUI(){
  const ui = await import('./ui.js');
  ui.syncReadout();
}

/* ---------------- lights ---------------- */

function lightControls(host, item){
  const p = item.params;
  const positional = p.type !== 'ambient';

  host.appendChild(el('p', 'caption',
    `${LIGHT_TYPES[p.type]?.label ?? p.type}${p.type === 'area'
      ? ' — softboxes light beautifully but cannot cast shadows in three.js.'
      : ''}`));

  slider(host, 'Power', {
    min:0, max:30, step:0.1, value:p.power,
    format: v => v.toFixed(1),
    onInput: v => { p.power = v; updateLight(item); }
  });
  slider(host, 'Colour temp', {
    min:1800, max:9000, step:50, value:p.kelvin,
    format: v => `${Math.round(v)}K ${kelvinName(v)}`,
    onInput: v => { p.kelvin = v; updateLight(item); }
  });

  if (positional){
    slider(host, 'Azimuth', {
      min:-180, max:180, step:1, value:p.az,
      format: v => `${Math.round(v)}°`,
      onInput: v => { p.az = v; updateLight(item); }
    });
    slider(host, 'Elevation', {
      min:-30, max:89, step:1, value:p.el,
      format: v => `${Math.round(v)}°`,
      onInput: v => { p.el = v; updateLight(item); }
    });
    slider(host, 'Distance', {
      min:0.2, max:6, step:0.05, value:p.dist,
      format:metres,
      onInput: v => { p.dist = v; updateLight(item); }
    });
    slider(host, 'Softness', {
      min:0, max:1, step:0.01, value:p.softness,
      format: v => `${Math.round(v * 100)}%`,
      onInput: v => { p.softness = v; updateLight(item); }
    });
  }

  if (p.type === 'area'){
    slider(host, 'Softbox size', {
      min:0.1, max:4, step:0.05, value:p.size,
      format:metres,
      onInput: v => { p.size = v; updateLight(item); }
    });
  }
  if (p.type === 'spot'){
    slider(host, 'Cone angle', {
      min:5, max:80, step:1, value:p.angle,
      format: v => `${Math.round(v)}°`,
      onInput: v => { p.angle = v; updateLight(item); }
    });
  }

  transformControls(host, item);
}

/* ---------------- keep in sync ---------------- */

store.on('change', () => renderInspector());
