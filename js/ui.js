/* ============================================================
   ui.js — the floating HUD: add menu, view switcher, lighting,
   export, prompt and scene JSON.

   Lens and framing controls deliberately do NOT live here. A camera is
   an object; select it and the inspector shows its lens. That keeps one
   set of controls for one camera and leaves the screen to the picture.
   ============================================================ */

import * as store from './store.js';
import {
  renderer, activeCamera, isFreeCamera, freeCamera,
  setAspect, getAspect, resize
} from './viewport.js';
import {
  addFromCatalog, applyRig, select, duplicateSelected, destroySelected,
  pickAt, lookThrough, frameSubject, applyCameraParams
} from './objects.js';
import { CATEGORIES } from './catalog.js';
import { RIGS, rigById } from './lights.js';
import {
  FORMATS, ASPECTS, RESOLUTIONS, SHOTS,
  focalFromEquiv, depthOfField
} from './optics.js';
import { exportRender, exportDepth, exportNormal, exportMask } from './export.js';
import { buildPrompt } from './prompt.js';
import { renderLayers } from './layers.js';
import { renderInspector } from './inspector.js';
import { installGlobalAPI } from './api.js';
import { $, el, fillSelect, toast } from './util.js';

/* ---------------- shared camera state ---------------- */

/** Lens for the free "Scene" camera. Placed cameras carry their own. */
const sceneParams = { formatId:'ff', equiv:50, fstop:5.6, focus:0.8 };

export function activeCameraItem(){
  return store.itemsOfKind('camera').find(c => c.obj === activeCamera()) || null;
}

/** Params of whichever camera the viewport is looking through. */
export function currentParams(){
  return activeCameraItem()?.params ?? sceneParams;
}

export const currentFormat = () => FORMATS[currentParams().formatId] || FORMATS.ff;

let currentRig  = rigById('three-point');
let currentShot = null;

export const setCurrentShot = shot => { currentShot = shot; };

/* ---------------- readouts ---------------- */

export function syncReadout(){
  const p = currentParams();
  const name = activeCameraItem()?.name ?? 'Scene';
  $('viewReadout').textContent =
    `${name} · ${Math.round(p.equiv)}mm · f/${p.fstop} · ${getAspect().id}`;
  renderViewSeg();
}

/* ---------------- view switcher ---------------- */

function renderViewSeg(){
  const host = $('viewSeg');
  if (!host) return;
  host.innerHTML = '';

  const current = activeCameraItem();

  const scene = el('button', isFreeCamera() ? 'on' : '', 'Scene');
  scene.title = 'Free orbit view for arranging the set';
  scene.onclick = () => { lookThrough(null); syncReadout(); };
  host.appendChild(scene);

  for (const cam of store.itemsOfKind('camera')){
    const b = el('button', cam === current ? 'on' : '', cam.name);
    b.onclick = () => { lookThrough(cam); select(cam); syncReadout(); };
    host.appendChild(b);
  }
}

/* ---------------- add menu ---------------- */

const GLYPH = {
  primitives:'◻', packaging:'▯', objects:'◨', figures:'☺', special:'✦'
};

let openMenu = null;

function closeMenu(){
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
  $('addBtn')?.setAttribute('aria-expanded', 'false');
}

function buildAddMenu(){
  const btn = $('addBtn');

  btn.onclick = e => {
    e.stopPropagation();
    if (openMenu){ closeMenu(); return; }

    const menu = el('div', 'menu');
    menu.setAttribute('role', 'menu');

    for (const cat of CATEGORIES){
      const group = el('div', 'menu-group');
      group.appendChild(el('div', 'menu-label', cat.label));

      for (const item of cat.items){
        const b = el('button');
        b.appendChild(el('span', 'g', GLYPH[cat.id] ?? '◻'));
        b.appendChild(el('span', null, item.label));
        b.onclick = () => {
          closeMenu();
          addFromCatalog(item.id);
        };
        group.appendChild(b);
      }
      menu.appendChild(group);
    }

    const r = btn.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top  = `${r.bottom + 6}px`;
    document.body.appendChild(menu);
    openMenu = menu;
    btn.setAttribute('aria-expanded', 'true');
  };

  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
}

/* ---------------- lighting gallery ---------------- */

function buildRigGallery(){
  const host = $('lightGallery');
  for (const rig of RIGS){
    const b = el('button', 'tile' + (rig.id === currentRig?.id ? ' on' : ''));
    b.appendChild(el('span', 't-name', rig.name));
    b.appendChild(el('span', 't-meta', rig.meta));
    b.dataset.rig = rig.id;
    b.onclick = () => {
      currentRig = applyRig(rig.id);
      markRig(rig.id);
      toast(`${rig.name} rig applied`);
    };
    host.appendChild(b);
  }
}

function markRig(id){
  for (const t of document.querySelectorAll('#lightGallery .tile')){
    t.classList.toggle('on', t.dataset.rig === id);
  }
}

/* ---------------- export ---------------- */

const longEdge = () => +$('resolution').value;

function buildExportControls(){
  fillSelect($('aspect'), ASPECTS.map(a => ({ value:a.id, label:a.label })), '4:5');
  $('aspect').onchange = e => { setAspect(e.target.value); syncReadout(); };
  setAspect('4:5');

  fillSelect($('resolution'), RESOLUTIONS.map(r => ({ value:r, label:`${r} px` })), 1536);

  for (const b of document.querySelectorAll('[data-export]')){
    b.onclick = () => {
      switch (b.dataset.export){
        case 'render': exportRender(longEdge()); break;
        case 'depth':  exportDepth(longEdge(), {
                         subjectOnly: $('depthSubjectOnly').checked,
                         invert:      $('depthInvert').checked
                       }); break;
        case 'normal': exportNormal(longEdge()); break;
        case 'mask':   exportMask(longEdge()); break;
      }
    };
  }
}

/* ---------------- sheets ---------------- */

function openSheet({ title, subtitle, value, actions }){
  const backdrop = el('div', 'sheet-backdrop');
  const sheet = el('div', 'sheet');

  sheet.appendChild(el('h1', null, title));
  if (subtitle) sheet.appendChild(el('p', 'sheet-sub', subtitle));

  const ta = el('textarea');
  ta.value = value;
  ta.spellcheck = false;
  sheet.appendChild(ta);

  const row = el('div', 'sheet-actions');
  for (const a of actions){
    const b = el('button', a.cls || '', a.label);
    b.onclick = () => a.run(ta, close);
    row.appendChild(b);
  }
  const close = () => backdrop.remove();

  const closeBtn = el('button', 'btn-quiet', 'Close');
  closeBtn.onclick = close;
  row.appendChild(closeBtn);

  sheet.appendChild(row);
  backdrop.appendChild(sheet);
  backdrop.onclick = e => { if (e.target === backdrop) close(); };
  document.body.appendChild(backdrop);

  ta.focus();
  ta.setSelectionRange(0, 0);
  return { close, textarea: ta };
}

async function copyText(text){
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Press ⌘C to copy', true); }
}

function buildPromptSheet(){
  $('genPrompt').onclick = () => {
    const p = currentParams();
    const format = currentFormat();
    const focalReal = focalFromEquiv(p.equiv, format);

    const text = buildPrompt({
      format,
      focal:  focalReal,
      fstop:  p.fstop,
      focusM: p.focus,
      dof:    depthOfField(focalReal, p.fstop, p.focus, format),
      shot:   currentShot,
      rig:    currentRig,
      aspect: getAspect()
    });

    openSheet({
      title:'Setup description',
      subtitle:'Read from the live scene — camera, lighting and contents. Paste it into Krea alongside the depth map.',
      value:text,
      actions:[
        { label:'Copy', cls:'btn-accent', run:(ta) => copyText(ta.value) }
      ]
    });
  };
}

function buildSceneSheet(){
  $('sceneJson').onclick = () => {
    const api = window.BlockoutStudio;
    openSheet({
      title:'Scene JSON',
      subtitle:'Copy this to describe your scene to an assistant, or paste one back and press Build to construct it.',
      value:JSON.stringify(api.serializeScene(), null, 2),
      actions:[
        { label:'Copy', run:(ta) => copyText(ta.value) },
        { label:'Build', cls:'btn-accent', run:(ta, close) => {
            try {
              const scene = JSON.parse(ta.value);
              api.applyScene(scene);
              close();
            } catch (err){
              toast(`Could not parse: ${err.message}`, true);
            }
          } }
      ]
    });
  };
}

/* ---------------- input ---------------- */

function buildInput(){
  const canvas = renderer.domElement;
  let downAt = null;

  canvas.addEventListener('pointerdown', e => { downAt = { x:e.clientX, y:e.clientY }; });
  canvas.addEventListener('pointerup', e => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 4) return;           // that was an orbit, not a click
    pickAt(e.clientX, e.clientY);
  });

  window.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey) return;

    switch (e.key.toLowerCase()){
      case 'd': duplicateSelected(); break;
      case 'x': destroySelected(); break;
      case 'f': frameSubject(activeCamera()); break;
      case 'escape': select(null); break;
      case 'backspace':
      case 'delete': destroySelected(); e.preventDefault(); break;
    }
  });
}

/* ---------------- scene API hooks ---------------- */

/** Lets applyScene drive the same state the panels read. */
const apiHooks = {
  setCamera(spec){
    // Shot first: it carries its own focal length, and an explicit `lens`
    // in the same request must win over the preset's default.
    if (spec.shot){
      const shot = SHOTS.find(s => s.id === spec.shot);
      if (shot) applyShot(shot);
      else console.warn(`[Blockout Studio] Unknown shot: "${spec.shot}"`);
    }

    const item = activeCameraItem();
    const p = item?.params ?? sceneParams;
    if (spec.lens   != null) p.equiv = +spec.lens;
    if (spec.fstop  != null) p.fstop = +spec.fstop;
    if (spec.focus  != null) p.focus = +spec.focus;
    if (spec.format && FORMATS[spec.format]) p.formatId = spec.format;
    if (item) applyCameraParams(item);

    syncReadout();
  },
  setExport(spec){
    if (spec.aspect && ASPECTS.some(a => a.id === spec.aspect)){
      $('aspect').value = spec.aspect;
      setAspect(spec.aspect);
    }
    if (spec.resolution && RESOLUTIONS.includes(+spec.resolution)){
      $('resolution').value = spec.resolution;
    }
    syncReadout();
  },
  setRig(rig){ currentRig = rig; markRig(rig.id); },
  afterBuild(){ frameSubject(activeCamera()); syncReadout(); },
  cameraState(){
    const p = currentParams();
    return {
      ...p,
      rigId: currentRig?.id ?? null,
      shotId: currentShot?.id ?? null,
      aspect: getAspect().id,
      resolution: longEdge()
    };
  }
};

/** Move the active camera to a framing preset, then fit the subject. */
export function applyShot(shot){
  const cam = activeCamera();
  const p = currentParams();
  p.equiv = shot.equiv;

  cam.position.set(...shot.pos);
  cam.lookAt(...shot.target);

  const item = activeCameraItem();
  if (item) applyCameraParams(item);

  currentShot = shot;
  frameSubject(cam);
  syncReadout();
}

/* ---------------- boot ---------------- */

export function initUI(){
  buildAddMenu();
  buildRigGallery();
  buildExportControls();
  buildPromptSheet();
  buildSceneSheet();
  buildInput();

  $('addLayer').onclick = () => {
    const layer = store.addLayer(`Layer ${store.state.layers.length + 1}`);
    store.state.activeLayerId = layer.id;
    store.changed();
  };

  store.on('change', () => { renderLayers(); renderViewSeg(); });
  store.on('names',  () => { renderLayers(); renderViewSeg(); });

  installGlobalAPI(apiHooks);

  renderLayers();
  renderInspector(true);
  syncReadout();
  resize();
}
