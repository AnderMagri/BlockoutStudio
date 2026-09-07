/* ============================================================
   main.js — boot the studio.
   ============================================================ */

import * as store from './store.js';
import { tick, setBeforeRender, resize, freeCamera } from './viewport.js';
import {
  initScene, addFromCatalog, addCameraObject, applyRig,
  updateHelpers, select, frameSubject, lookThrough
} from './objects.js';
import { initUI, applyShot, refreshObjectCards } from './ui.js';
import { buildThumbnails } from './thumbnails.js';
import { connectBridge } from './bridge.js';
import { SHOTS } from './optics.js';
import { $ } from './util.js';

function boot(){
  initScene();

  // Something you can shoot straight away rather than an empty stage.
  applyRig('three-point');
  addFromCatalog('bottle');

  // There is always a camera. The Scene view is only for arranging things.
  const camera = addCameraObject({ formatId:'ff', equiv:85, fstop:2.8, focus:0.6 });

  initUI();

  // Open looking through the camera: this tool is for composing a shot,
  // and the Scene view is only for arranging things.
  lookThrough(camera);
  applyShot(SHOTS[0]);
  frameSubject(freeCamera);        // leave the Scene view usefully framed too
  select(null);

  setBeforeRender(updateHelpers);
  store.applyVisibility();
  store.changed();

  // Talk to the MCP server if one is running. Harmless when there isn't.
  connectBridge();

  resize();
  tick();

  // Card artwork is rendered from the real geometry, offscreen. It runs
  // after the first frame so a slow machine still paints immediately;
  // until it lands the cards show glyphs.
  buildThumbnails()
    .then(refreshObjectCards)
    .catch(err => console.warn('[thumbnails]', err));
}

try {
  boot();
} catch (err){
  console.error(err);
  const box = $('loadError');
  if (box){
    box.hidden = false;
    box.innerHTML = '<strong>Blockout Studio failed to start.</strong><br>' +
      String(err.message || err).replace(/[<>&]/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;' }[c]));
  }
}
