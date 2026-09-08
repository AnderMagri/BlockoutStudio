/* ============================================================
   ui.js — the floating HUD: add menu, view switcher, lighting,
   export, prompt and scene JSON.

   Lens and framing controls deliberately do NOT live here. A camera is
   an object; select it and the inspector shows its lens. That keeps one
   set of controls for one camera and leaves the screen to the picture.
   ============================================================ */

import * as store from './store.js';
import {
  renderer, activeCamera, isFreeCamera, freeCamera, gizmo,
  setAspect, getAspect, resize, setPreviewCamera
} from './viewport.js';
import {
  addFromCatalog, applyRig, select, duplicateSelected, destroySelected,
  pickAt, lookThrough, frameSubject, applyCameraParams, setCompositionMode, setSetMode,
  setOrbitAroundSelection, orbitMode, focusSelection, destroyItem, addCameraObject,
  centreSelection
} from './objects.js';
import { CATEGORIES } from './catalog.js';
import { thumbnails, GLYPHS } from './thumbnails.js';
import { RIGS, rigById } from './lights.js';
import {
  FORMATS, ASPECTS, RESOLUTIONS, SHOTS,
  focalFromEquiv, depthOfField
} from './optics.js';
import {
  exportRender, exportDepth, exportNormal, exportMask, exportEdge,
  exportSize, capturePass
} from './export.js';
import { buildPrompt, buildManifest, buildGenerationPrompt } from './prompt.js';
import { renderLayers } from './layers.js';
import { renderInspector } from './inspector.js';
import { installGlobalAPI } from './api.js';
import {
  listScenes, loadScene, deleteScene, sceneToFile, sceneFromFile, readAutosave
} from './scenes.js';
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

/**
 * Push sceneParams onto the free camera, so the Scene view renders with the
 * same optics every readout and prompt describes.
 */
function applyFreeCameraParams(){
  const format = FORMATS[sceneParams.formatId] || FORMATS.ff;
  freeCamera.filmGauge = format.gauge;
  freeCamera.setFocalLength(focalFromEquiv(sceneParams.equiv, format));
  freeCamera.updateProjectionMatrix();
}

let currentRig  = rigById('three-point');
let currentShot = null;

export const setCurrentShot = shot => { currentShot = shot; };

/* ---------------- readouts ---------------- */

export function syncReadout(){
  const p = currentParams();
  const name = activeCameraItem()?.name ?? 'Scene';
  $('viewReadout').textContent = isFreeCamera()
    ? `arranging · ${getAspect().id} frame`
    : `${name} · ${Math.round(p.equiv)}mm · f/${p.fstop} · ${getAspect().id}`;
  renderViewSeg();
}

/* ---------------- view switcher ---------------- */

function renderViewSeg(){
  const host = $('viewSeg');
  if (!host) return;
  host.innerHTML = '';

  const current = activeCameraItem();

  /* Two states that look very different, because confusing "arranging the
     set" with "framing the shot" wastes real time. Arranging is a grey
     orbit view; a camera view is accent-coloured and named. */
  const scene = el('button', 'seg-scene' + (isFreeCamera() ? ' on' : ''));
  scene.innerHTML = '<span class="seg-ico">⟳</span>Arrange';
  scene.title = 'Free orbit view for arranging the set';
  scene.onclick = () => { lookThrough(null); select(null); syncReadout(); };
  host.appendChild(scene);

  for (const cam of store.itemsOfKind('camera')){
    const live = cam === current;
    const b = el('button', 'seg-cam' + (live ? ' on' : ''));
    b.innerHTML = `<span class="seg-ico">${cam.params.locked ? '🔒' : '▣'}</span>` +
                  cam.name.replace(/^Camera /, 'Cam ');
    b.title = live ? `Looking through ${cam.name}` : `Look through ${cam.name}`;
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
let edgeSensitivity = 0.5;
let edgeThickness   = 1;
let edgeInvert      = false;

/* Which passes the image brief tells you to attach. Depth earns its place
   by default; the edge map is a second structural cue worth stacking when
   silhouettes matter. */
let briefDepth = true;
let briefEdge  = false;

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
  { id:'edge',   name:'Edge map',    note:'White lines on black, for canny control' },
  { id:'normal', name:'Normal map',  note:'Surface normals' },
  { id:'mask',   name:'Layer mask',  note:'Active layer white, rest black' }
];

/** Options for whichever pass is being captured. */
export function passOptions(id){
  return id === 'edge'
    ? { subjectOnly:depthSubject, sensitivity:edgeSensitivity,
        thickness:edgeThickness, invert:edgeInvert }
    : { subjectOnly:depthSubject, invert:depthInvert };
}

function runPass(id){
  switch (id){
    case 'render': exportRender(longEdge()); break;
    case 'depth':  exportDepth(longEdge(), passOptions('depth')); break;
    case 'edge':   exportEdge(longEdge(), passOptions('edge')); break;
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
        'Default is near = white, the convention Krea and ControlNet depth expect. ' +
        '"Fit range to subject" applies to the edge pass too.'));
      body.appendChild(opts);

      /* ---- edge options ---- */
      const edgeOpts = el('details', 'opts');
      edgeOpts.appendChild(el('summary', null, 'Edge options'));

      // The .field row plus a full-width range is the same shape the
      // inspector's sliders use; a range inside .switch would inherit the
      // iOS-toggle styling meant for checkboxes.
      const range = (label, { min, max, step, value, format, onInput }) => {
        const row = el('div', 'field');
        row.appendChild(el('label', null, label));
        const out = el('span', 'val', format(value));
        row.appendChild(out);

        const input = el('input');
        input.type = 'range';
        input.min = min; input.max = max; input.step = step; input.value = value;
        input.setAttribute('aria-label', label);
        input.oninput = () => {
          const v = +input.value;
          out.textContent = format(v);
          onInput(v);
        };
        edgeOpts.append(row, input);
      };

      range('Sensitivity', {
        min:0, max:1, step:0.02, value:edgeSensitivity,
        format: v => `${Math.round(v * 100)}%`,
        onInput: v => { edgeSensitivity = v; }
      });
      range('Line thickness', {
        min:1, max:5, step:1, value:edgeThickness,
        format: v => `${v} px`,
        onInput: v => { edgeThickness = v; }
      });

      const inv = el('label', 'switch');
      inv.appendChild(document.createTextNode('Invert (black on white)'));
      const invBox = el('input');
      invBox.type = 'checkbox';
      invBox.checked = edgeInvert;
      invBox.onchange = () => { edgeInvert = invBox.checked; };
      inv.appendChild(invBox);
      edgeOpts.appendChild(inv);

      edgeOpts.appendChild(el('p', 'caption',
        'Traced from depth and normals, so lines follow the geometry and ignore ' +
        'the lighting. Stack it with the depth pass for the tightest structural hold.'));
      body.appendChild(edgeOpts);

      /* ---- what the brief asks for ---- */
      const briefOpts = el('details', 'opts');
      briefOpts.appendChild(el('summary', null, 'Image brief'));
      const mkBrief = (label, checked, onChange) => {
        const l = el('label', 'switch');
        l.appendChild(document.createTextNode(label));
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = checked;
        cb.onchange = () => onChange(cb.checked);
        l.appendChild(cb);
        briefOpts.appendChild(l);
      };
      mkBrief('Include the depth pass', briefDepth, v => { briefDepth = v; });
      mkBrief('Include the edge pass',  briefEdge,  v => { briefEdge = v; });
      briefOpts.appendChild(el('p', 'caption',
        'Declare what a shape stands in for by selecting it — the brief names ' +
        'it and says where it sits in frame.'));
      body.appendChild(briefOpts);

      /* ---- text outputs ---- */
      const brief = el('button', 'btn-accent', 'Image brief…');
      brief.style.marginTop = '2px';
      brief.title = 'The numbered image list and instruction to paste into an image tool';
      brief.onclick = () => { close(); openBriefSheet(); };
      body.appendChild(brief);

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
  // closeAnyModal must be able to run this cleanup too — removing only the
  // backdrop node would orphan the Escape listener.
  backdrop.closeModal = close;

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
  for (const node of document.querySelectorAll('.sheet-backdrop')){
    if (node.closeModal) node.closeModal();
    else node.remove();
  }
}

async function copyText(text){
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Press ⌘C to copy', true); }
}

/**
 * The brief: a numbered list of the images to attach and an instruction
 * that ties each one to its object.
 *
 * Written for a model that is handed several images at once, which is how
 * the manual workflow actually goes — export the passes, drop them and
 * your product shots into the image tool, paste this. The numbering is
 * the wiring diagram: attach the images in the order listed.
 */
function openBriefSheet(){
  const intent = el('input');
  intent.type = 'text';
  intent.placeholder = 'What do you want? e.g. an iPhone in a bucket of ice';

  const manifest = buildManifest({ includeDepth: briefDepth, includeEdge: briefEdge });
  const text = buildGenerationPrompt(promptContext(), manifest, '');

  const attachList = manifest
    .map((e, i) => `${i + 1}. ${e.kind === 'pass'
      ? `${e.pass} pass — export it from this panel`
      : `${e.label} — your own file`}`)
    .join('\n');

  const sheet = openSheet({
    title: 'Image brief',
    subtitle: `Attach ${manifest.length} image${manifest.length === 1 ? '' : 's'} ` +
              'in this order, then paste the text below.',
    value: text,
    actions: [
      { label:'Copy', cls:'btn-accent', run:(ta) => copyText(ta.value) }
    ]
  });

  // The wiring order, as a real list — a <p> collapses the newlines.
  const order = el('div', 'readout');
  order.style.whiteSpace = 'pre-line';
  order.textContent = attachList;

  const ta = sheet.textarea;
  // Retyping the intent should rewrite the brief, since it opens the text.
  intent.oninput = () => {
    ta.value = buildGenerationPrompt(
      promptContext(),
      buildManifest({ includeDepth: briefDepth, includeEdge: briefEdge }),
      intent.value
    );
    ta.scrollTop = 0;
  };

  ta.parentNode.insertBefore(order, ta);
  ta.parentNode.insertBefore(intent, ta);
  ta.scrollTop = 0;
  intent.focus();
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

/* ---------------- orbit pivot ---------------- */

function renderPivotBtn(){
  const b = $('pivotBtn');
  if (!b) return;
  const on = orbitMode();
  b.textContent = on ? '⊙ Orbit: selection' : '⊙ Orbit: scene';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on
    ? 'Selecting something makes it the centre of rotation. Click to orbit the whole scene instead.'
    : 'Orbiting turns around the scene. Click to orbit whatever you select.';
}

function buildPivotToggle(){
  $('pivotBtn').onclick = () => {
    setOrbitAroundSelection(!orbitMode());
    renderPivotBtn();
    toast(orbitMode() ? 'Orbiting around the selection' : 'Orbiting around the scene');
  };
  renderPivotBtn();
}

/* ---------------- camera preview ---------------- */

/**
 * The live inset of what the camera sees, so a set can be arranged and the
 * shot judged at once. On by default: the whole job here is composing a
 * picture, and working blind in the Scene view is what the switching back
 * and forth was for.
 */
let previewOn = true;

function renderPreviewBtn(){
  const b = $('previewBtn');
  if (!b) return;
  b.textContent = previewOn ? '◱ Preview' : '◱ Preview off';
  b.setAttribute('aria-pressed', previewOn ? 'true' : 'false');
  b.classList.toggle('on', previewOn);
}

/**
 * Which camera the inset shows: the one you have selected if it is a
 * camera, otherwise the first in the scene. Nothing while you are already
 * looking through a camera — the main view is the preview then.
 */
function syncPreview(){
  if (!previewOn || !isFreeCamera()){ setPreviewCamera(null); return; }
  const sel = store.state.selected;
  const cam = sel?.kind === 'camera' ? sel : store.itemsOfKind('camera')[0];
  setPreviewCamera(cam ?? null);
}

function buildPreviewToggle(){
  $('previewBtn').onclick = () => {
    previewOn = !previewOn;
    renderPreviewBtn();
    syncPreview();
    toast(previewOn ? 'Camera preview on' : 'Camera preview off');
  };
  renderPreviewBtn();
}

/* ---------------- scenes ---------------- */

const ago = iso => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)    return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
};

function openScenesPanel(){
  const api = window.BlockoutStudio;

  openModal({
    title:'Scenes',
    subtitle:'Saved in this browser. Use Download for anything you want to keep or share.',
    build(body, close){

      /* ---- save current ---- */
      const saveRow = el('div', 'modal-row');
      const nameInput = el('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Name this scene';
      nameInput.setAttribute('aria-label', 'Scene name');

      const saveBtn = el('button', 'btn-accent', 'Save');
      saveBtn.style.width = 'auto';
      saveBtn.onclick = () => {
        try {
          const { name } = api.saveScene(nameInput.value);
          toast(`Saved “${name}”`);
          nameInput.value = '';
          repaint();
        } catch (err){ toast(err.message, true); }
      };
      nameInput.onkeydown = e => { if (e.key === 'Enter') saveBtn.click(); };

      saveRow.append(nameInput, saveBtn);
      body.appendChild(saveRow);

      /* ---- saved list ---- */
      const list = el('div', 'scene-list');
      body.appendChild(list);

      function repaint(){
        list.innerHTML = '';
        const saved = listScenes();

        if (!saved.length){
          list.appendChild(el('p', 'caption', 'Nothing saved yet.'));
        }

        for (const entry of saved){
          const row = el('div', 'scene-row');

          const text = el('span', 'scene-text');
          text.appendChild(el('span', 'scene-name', entry.name));
          text.appendChild(el('span', 'scene-meta',
            `${entry.objects} object${entry.objects === 1 ? '' : 's'} · ${ago(entry.savedAt)}`));
          row.appendChild(text);

          const open = el('button', 'tiny', 'Open');
          open.onclick = async () => {
            close();
            try { await api.loadScene(entry.name); toast(`Opened “${entry.name}”`); }
            catch (err){ toast(err.message, true); }
          };

          const dl = el('button', 'tiny', '↓');
          dl.title = 'Download as a file';
          dl.onclick = () => {
            try { sceneToFile(loadScene(entry.name), entry.name); }
            catch (err){ toast(err.message, true); }
          };

          const del = el('button', 'tiny btn-danger', '×');
          del.title = 'Delete';
          del.onclick = () => {
            // Deleting a saved scene cannot be undone, so it gets a question.
            if (!confirm(`Delete the saved scene “${entry.name}”?`)) return;
            deleteScene(entry.name);
            repaint();
          };

          row.append(open, dl, del);
          list.appendChild(row);
        }
      }

      repaint();

      /* ---- file in and out ---- */
      const files = el('div', 'grid-2');
      const imp = el('button', null, 'Import file…');
      imp.onclick = async () => {
        try {
          const picked = await sceneFromFile();
          if (!picked) return;                   // the picker was cancelled
          close();
          await api.applyScene(picked.scene);
          toast(`Opened “${picked.name}”`);
        } catch (err){ toast(err.message, true); }
      };
      const exp = el('button', null, 'Download current');
      exp.onclick = () => sceneToFile(api.serializeScene(), 'blockout-scene');
      files.append(imp, exp);
      body.appendChild(files);

      /* ---- recovery ---- */
      const auto = readAutosave();
      if (auto){
        const recover = el('button', 'btn-quiet',
          `Restore last session (${ago(auto.savedAt)})`);
        recover.onclick = async () => {
          close();
          await api.applyScene(auto.scene);
          toast('Restored your last session');
        };
        body.appendChild(recover);
      }
    }
  });
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
    if (!(e.target instanceof Element) || e.target.matches('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey) return;
    // With a sheet open, focus can sit on a button — X would silently delete
    // the selection behind the modal. The modal's own Escape handler closes it.
    if (document.querySelector('.sheet-backdrop')) return;

    switch (e.key.toLowerCase()){
      case 'w': gizmo.setMode('translate'); break;
      case 'e': gizmo.setMode('rotate'); break;
      case 'r': gizmo.setMode('scale'); break;
      case 'c': centreSelection(); break;
      case 'd': duplicateSelected(); break;
      case 'x': destroySelected(); break;
      // F frames what you have selected, or the whole scene when nothing is.
      case 'f':
        if (!focusSelection({ keepFraming: false })) frameSubject(activeCamera());
        break;
      case 'escape': select(null); break;
      case 'backspace':
      case 'delete': destroySelected(); e.preventDefault(); break;
    }
  });
}

/* ---------------- scene API hooks ---------------- */

/**
 * The live camera, optics and lighting facts every prompt is built from.
 * Read fresh each time so no prompt can describe a setup that is no
 * longer on screen.
 */
function promptContext(){
  const p = currentParams();
  const format = currentFormat();
  const focalReal = focalFromEquiv(p.equiv, format);
  return {
    format, focal:focalReal, fstop:p.fstop, focusM:p.focus,
    dof: depthOfField(focalReal, p.fstop, p.focus, format),
    shot: currentShot, rig: currentRig, aspect: getAspect()
  };
}

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
    else applyFreeCameraParams();

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
  // rig may be null: a scene with explicit fixtures, or one deliberately
  // unlit, matches no preset — claiming the last one would be a lie.
  setRig(rig){ currentRig = rig ?? null; markRig(rig?.id ?? null); },

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
    return buildPrompt(promptContext());
  },

  /**
   * What would be sent to an image model right now: the ordered image
   * manifest and the instruction that numbers it. Exposed so the wording
   * can be read and checked before anything is spent on it.
   */
  generationPreview({ includeDepth = true, includeEdge = false, intent = '' } = {}){
    const manifest = buildManifest({ includeDepth, includeEdge });
    return {
      prompt: buildGenerationPrompt(promptContext(), manifest, intent),
      manifest: manifest.map((e, i) => ({
        n: i + 1,
        kind: e.kind,
        pass: e.pass ?? null,
        label: e.label,
        role: e.kind === 'ref' ? e.ref.role : null,
        object: e.kind === 'ref' ? e.item.name : null
      }))
    };
  },

  /** Render a pass with the panel's current options for that pass applied. */
  capturePass(pass, resolution){
    return capturePass(pass, resolution || exportRes, passOptions(pass));
  },
  afterBuild(){ frameSubject(activeCamera()); syncReadout(); },
  newScene(){ return resetToDefaultScene(); },
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
  const item = activeCameraItem();
  if (item?.params.locked){
    toast('This camera is locked — unlock it to apply a framing preset.');
    return;
  }

  const cam = activeCamera();
  const p = currentParams();
  p.equiv = shot.equiv;

  cam.position.set(...shot.pos);
  cam.lookAt(...shot.target);

  if (item) applyCameraParams(item);
  else applyFreeCameraParams();

  currentShot = shot;
  frameSubject(cam);
  syncReadout();
}

/**
 * Reset the studio to the scene it boots with: three-point rig, a sphere,
 * one camera looked through on the hero framing. The same code path serves
 * the New button, BlockoutStudio.newScene() and the MCP new_scene tool.
 */
export function resetToDefaultScene(){
  for (const item of [...store.state.items]){
    if (item.kind === 'mesh' || item.kind === 'camera' || item.kind === 'light'){
      destroyItem(item);
    }
  }
  select(null);

  const rig = applyRig('three-point');
  if (rig) apiHooks.setRig(rig);
  addFromCatalog('sphere');
  const camera = addCameraObject({ formatId:'ff', equiv:85, fstop:2.8, focus:0.6 });

  apiHooks.setStage({ set:'backdrop', compositionLight:false });
  apiHooks.setExport({ aspect:'4:5', resolution:1536 });

  lookThrough(camera);
  applyShot(SHOTS[0]);
  frameSubject(freeCamera);      // leave the Scene view usefully framed too
  select(null);

  store.applyVisibility();
  store.changed();
  syncReadout();
  return { ok:true, scene:'default' };
}

/* ---------------- boot ---------------- */

export function initUI(){
  $('addBtn').onclick = openObjectPicker;
  $('scenesBtn').onclick = openScenesPanel;
  $('newBtn').onclick = () => {
    // The wipe cannot be undone — the autosaved recovery copy is replaced
    // by the fresh scene moments later — so it gets a question.
    if (!confirm('Start a new scene? The current scene is discarded.')) return;
    resetToDefaultScene();
    toast('New scene');
  };
  buildPivotToggle();
  buildPreviewToggle();
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

  store.on('change', () => { renderLayers(); renderViewSeg(); syncPreview(); });
  store.on('names',  () => { renderLayers(); renderViewSeg(); });

  installGlobalAPI(apiHooks);
  applyFreeCameraParams();
  syncPreview();

  renderLayers();
  renderInspector(true);
  syncReadout();
  resize();
}
