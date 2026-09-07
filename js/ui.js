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
  pickAt, lookThrough, frameSubject, applyCameraParams, setCompositionMode, setSetMode
} from './objects.js';
import { CATEGORIES } from './catalog.js';
import { thumbnails, GLYPHS } from './thumbnails.js';
import { RIGS, rigById } from './lights.js';
import {
  FORMATS, ASPECTS, RESOLUTIONS, SHOTS,
  focalFromEquiv, depthOfField
} from './optics.js';
import { exportRender, exportDepth, exportNormal, exportMask, exportSize, capturePass } from './export.js';
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

/* ---------------- object picker ---------------- */

/* "Add object" opens a modal of tabbed cards. The thumbnails are rendered
   from the real geometry, so a new catalog entry needs no artwork. The tab
   you were last on is remembered between openings. */

let activeTab = CATEGORIES[0].id;

function renderPickerTabs(host, cardHost){
  host.innerHTML = '';
  for (const cat of CATEGORIES){
    const b = el('button', 'tab' + (cat.id === activeTab ? ' on' : ''), cat.label);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', cat.id === activeTab ? 'true' : 'false');
    b.onclick = () => {
      activeTab = cat.id;
      renderPickerTabs(host, cardHost);
      renderPickerCards(cardHost);
    };
    host.appendChild(b);
  }
}

function renderPickerCards(host, close){
  host.innerHTML = '';
  const cat = CATEGORIES.find(c => c.id === activeTab) || CATEGORIES[0];

  for (const item of cat.items){
    const card = el('button', 'card');
    card.title = `Add ${item.label}`;

    const art = el('span', 'card-art');
    const thumb = thumbnails.get(item.id);
    if (thumb){
      const img = el('img');
      img.src = thumb;
      img.alt = '';
      art.appendChild(img);
    } else {
      art.appendChild(el('span', 'card-glyph', GLYPHS[item.id] ?? '◻'));
    }

    card.appendChild(art);
    card.appendChild(el('span', 'card-label', item.label));
    card.onclick = () => {
      // Close first so the new object is visible the moment it lands.
      host._close?.();
      addFromCatalog(item.id);
    };
    host.appendChild(card);
  }
  host._close = close ?? host._close;
}

/** The card grid of the picker while it is open, so late thumbnails land. */
let openPickerCards = null;

function openObjectPicker(){
  openModal({
    title: 'Add object',
    subtitle: 'Everything is modelled at real scale — a can really is 12 cm tall.',
    wide: true,
    build(body, close){
      const tabs = el('div', 'tabs');
      tabs.setAttribute('role', 'tablist');

      const cards = el('div', 'cards cards-wide');
      cards.setAttribute('role', 'tabpanel');
      cards._close = close;

      renderPickerTabs(tabs, cards);
      renderPickerCards(cards, close);
      openPickerCards = cards;

      body.append(tabs, cards);
    }
  });
}

/**
 * Called when the offscreen thumbnail renders finish. If the picker happens
 * to be open at that moment, swap its glyph placeholders for the pictures.
 */
export function refreshObjectCards(){
  if (openPickerCards?.isConnected) renderPickerCards(openPickerCards);
}

/* ---------------- lighting gallery ---------------- */

const SET_LABELS = [
  { value:'none',     label:'None — objects only' },
  { value:'ground',   label:'Ground' },
  { value:'backdrop', label:'Ground + backdrop' },
  { value:'infinite', label:'Infinite cove' }
];

function buildSetControl(){
  const sel = $('setMode');
  fillSelect(sel, SET_LABELS, store.state.setMode);
  sel.onchange = e => setSetMode(e.target.value);
}

function buildCompositionToggle(){
  const box = $('compositionMode');
  box.onchange = () => {
    setCompositionMode(box.checked);
    toast(box.checked
      ? 'Composition light on — rigs muted'
      : 'Composition light off — rigs restored');
  };
}

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

/* Export settings live here rather than in the DOM: the controls only exist
   while the modal is open, but the scene API can set them at any time. */
let exportRes   = 1536;
let depthSubject = true;
let depthInvert  = false;

const longEdge = () => exportRes;

function buildExportControls(){
  fillSelect($('aspect'), ASPECTS.map(a => ({ value:a.id, label:a.label })), '4:5');
  $('aspect').onchange = e => { setAspect(e.target.value); syncReadout(); };
  setAspect('4:5');

  $('exportBtn').onclick = openExportModal;
}

const PASSES = [
  { id:'render', name:'Render',      note:'The lit scene as you see it',        cls:'btn-accent' },
  { id:'depth',  name:'Depth map',   note:'Linear depth, near = white' },
  { id:'normal', name:'Normal map',  note:'Surface normals' },
  { id:'mask',   name:'Layer mask',  note:'Active layer white, rest black' }
];

function runPass(id){
  switch (id){
    case 'render': exportRender(longEdge()); break;
    case 'depth':  exportDepth(longEdge(), { subjectOnly:depthSubject, invert:depthInvert }); break;
    case 'normal': exportNormal(longEdge()); break;
    case 'mask':   exportMask(longEdge()); break;
  }
}

function openExportModal(){
  openModal({
    title:'Export',
    subtitle:'Everything renders from the active camera, cropped to the frame you see.',
    build(body, close){
      /* ---- size ---- */
      const sizeRow = el('div', 'modal-row');

      const aspectSel = el('select');
      fillSelect(aspectSel, ASPECTS.map(a => ({ value:a.id, label:a.label })), getAspect().id);

      const resSel = el('select');
      fillSelect(resSel, RESOLUTIONS.map(r => ({ value:r, label:`${r} px long edge` })), exportRes);

      const px = el('span', 'val mono');
      const refreshPx = () => {
        const { width, height } = exportSize(exportRes);
        px.textContent = `${width} × ${height}`;
      };

      aspectSel.onchange = e => {
        $('aspect').value = e.target.value;
        setAspect(e.target.value);
        syncReadout();
        refreshPx();
      };
      resSel.onchange = e => { exportRes = +e.target.value; refreshPx(); };

      sizeRow.append(aspectSel, resSel, px);
      body.appendChild(sizeRow);
      refreshPx();

      /* ---- passes ---- */
      const list = el('div', 'pass-list');
      for (const pass of PASSES){
        const row = el('button', 'pass ' + (pass.cls || ''));
        const text = el('span', 'pass-text');
        text.appendChild(el('span', 'pass-name', pass.name));
        text.appendChild(el('span', 'pass-note', pass.note));
        row.appendChild(text);
        row.appendChild(el('span', 'pass-go', '↓'));
        row.onclick = () => runPass(pass.id);
        list.appendChild(row);
      }
      body.appendChild(list);

      /* ---- depth options ---- */
      const opts = el('details', 'opts');
      const sum = el('summary', null, 'Depth options');
      opts.appendChild(sum);

      const mk = (label, checked, onChange) => {
        const l = el('label', 'switch');
        l.appendChild(document.createTextNode(label));
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = checked;
        cb.onchange = () => onChange(cb.checked);
        l.appendChild(cb);
        opts.appendChild(l);
      };
      mk('Fit range to subject', depthSubject, v => { depthSubject = v; });
      mk('Invert (near = black)', depthInvert,  v => { depthInvert = v; });
      opts.appendChild(el('p', 'caption',
        'Default is near = white, the convention Krea and ControlNet depth expect.'));
      body.appendChild(opts);

      /* ---- text outputs ---- */
      const row = el('div', 'grid-2');
      const a = el('button', null, 'Describe setup…');
      a.onclick = () => { close(); openPromptSheet(); };
      const b = el('button', 'btn-quiet', 'Scene JSON…');
      b.onclick = () => { close(); openSceneSheet(); };
      row.append(a, b);
      body.appendChild(row);
    }
  });
}

/* ---------------- sheets ---------------- */

function openSheet({ title, subtitle, value, actions }){
  closeAnyModal();

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

/** A modal whose body is built by a callback — used by the export panel. */
function openModal({ title, subtitle, build, wide = false }){
  // Only ever one modal. Without this, clicking a button twice stacks two
  // sheets and the one underneath keeps handling clicks.
  closeAnyModal();

  const backdrop = el('div', 'sheet-backdrop');
  const sheet = el('div', 'sheet sheet-auto' + (wide ? ' sheet-wide' : ''));

  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  sheet.appendChild(el('h1', null, title));
  if (subtitle) sheet.appendChild(el('p', 'sheet-sub', subtitle));

  const body = el('div', 'modal-body');
  build(body, close);
  sheet.appendChild(body);

  const row = el('div', 'sheet-actions');
  const done = el('button', 'btn-quiet', 'Done');
  done.onclick = close;
  row.appendChild(done);
  sheet.appendChild(row);

  backdrop.appendChild(sheet);
  backdrop.onclick = e => { if (e.target === backdrop) close(); };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  return { close };
}

/** Dismiss whatever sheet is open, if any. */
function closeAnyModal(){
  for (const node of document.querySelectorAll('.sheet-backdrop')) node.remove();
}

async function copyText(text){
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Press ⌘C to copy', true); }
}

function openPromptSheet(){
  {
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
  }
}

function openSceneSheet(){
  {
    const api = window.BlockoutStudio;
    openSheet({
      title:'Scene JSON',
      subtitle:'Copy this to describe your scene to an assistant, or paste one back and press Build to construct it.',
      value:JSON.stringify(api.serializeScene(), null, 2),
      actions:[
        { label:'Copy', run:(ta) => copyText(ta.value) },
        { label:'Build', cls:'btn-accent', run:async (ta, close) => {
            try {
              const scene = JSON.parse(ta.value);
              close();
              await api.applyScene(scene);
            } catch (err){
              toast(`Could not build: ${err.message}`, true);
            }
          } }
      ]
    });
  }
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
      exportRes = +spec.resolution;
    }
    syncReadout();
  },
  setRig(rig){ currentRig = rig; markRig(rig.id); },

  /** applyScene can choose the set and the working light. */
  setStage(spec){
    if (spec.set && store.SET_MODES[spec.set]){
      setSetMode(spec.set);
      $('setMode').value = spec.set;
    }
    if (spec.compositionLight != null){
      setCompositionMode(!!spec.compositionLight);
      $('compositionMode').checked = !!spec.compositionLight;
    }
  },

  /** The prose description, built from the same live state as the sheet. */
  describeSetup(){
    const p = currentParams();
    const format = currentFormat();
    const focalReal = focalFromEquiv(p.equiv, format);
    return buildPrompt({
      format, focal:focalReal, fstop:p.fstop, focusM:p.focus,
      dof: depthOfField(focalReal, p.fstop, p.focus, format),
      shot: currentShot, rig: currentRig, aspect: getAspect()
    });
  },

  /** Render a pass with the panel's current depth options applied. */
  capturePass(pass, resolution){
    return capturePass(pass, resolution || exportRes, {
      subjectOnly: depthSubject, invert: depthInvert
    });
  },
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
  $('addBtn').onclick = openObjectPicker;
  buildSetControl();
  buildCompositionToggle();
  buildRigGallery();
  buildExportControls();
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
