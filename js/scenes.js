/* ============================================================
   scenes.js — saving and loading scenes.

   Scenes are stored as the same JSON the scene API already speaks, so a
   saved scene, a pasted scene and one built by an assistant are all the
   same thing. Nothing new to learn and nothing that can drift.

   Storage is the browser's localStorage. That keeps saving working with
   no server running, which matters because the studio is usable on its
   own — and a scene is a few kilobytes of JSON, not an asset library.
   Anything you want to keep properly, or hand to someone else, use
   "Download" for: that gives you a real file.
   ============================================================ */

const KEY_SCENES   = 'blockout.scenes';
const KEY_AUTOSAVE = 'blockout.autosave';

/** localStorage throws in private windows and when storage is full. */
function readStore(){
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY_SCENES) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(all){
  try {
    localStorage.setItem(KEY_SCENES, JSON.stringify(all));
    return true;
  } catch (err){
    console.warn('[scenes] could not write:', err);
    return false;
  }
}

/** Saved scenes, newest first. */
export function listScenes(){
  const all = readStore();
  return Object.entries(all)
    // One hand-edited or corrupt entry must not take the whole panel down.
    .filter(([, entry]) => entry && typeof entry === 'object')
    .map(([name, entry]) => ({
      name,
      savedAt: entry.savedAt,
      objects: entry.scene?.objects?.length ?? 0
    }))
    .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
}

export function saveScene(name, scene){
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A scene needs a name.');

  const all = readStore();
  all[clean] = { savedAt: new Date().toISOString(), scene };
  if (!writeStore(all)) throw new Error('Could not save — browser storage is full or blocked.');
  return { name: clean, count: Object.keys(all).length };
}

export function loadScene(name){
  const entry = readStore()[name];
  if (!entry) throw new Error(`No saved scene called "${name}".`);
  return entry.scene;
}

export function deleteScene(name){
  const all = readStore();
  if (!(name in all)) return false;
  delete all[name];
  writeStore(all);
  return true;
}

export const sceneExists = name => name in readStore();

/* ---------------- autosave ---------------- */

/**
 * A recovery copy, not a session restore. Boot deliberately gives the same
 * default scene every time — a demo that opens differently depending on
 * what you did yesterday is a bad demo — so this is offered in the Scenes
 * panel rather than applied automatically.
 */
export function autosave(scene){
  try {
    localStorage.setItem(KEY_AUTOSAVE, JSON.stringify({
      savedAt: new Date().toISOString(), scene
    }));
  } catch { /* full or blocked — autosave is best-effort by nature */ }
}

export function readAutosave(){
  try {
    const raw = localStorage.getItem(KEY_AUTOSAVE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Debounced autosave, so dragging a slider does not thrash storage. */
export function makeAutosaver(getScene, delay = 1200){
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { autosave(getScene()); } catch { /* never let this break the app */ }
    }, delay);
  };
}

/* ---------------- files ---------------- */

export function sceneToFile(scene, name){
  const blob = new Blob([JSON.stringify(scene, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || 'scene').replace(/[^a-z0-9._-]+/gi, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with the parsed scene, or null on cancel. */
export function sceneFromFile(){
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    // Without this, cancelling the picker leaves the promise pending forever.
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('No file chosen.'));
      try {
        resolve({ scene: JSON.parse(await file.text()), name: file.name.replace(/\.json$/i, '') });
      } catch (err){
        reject(new Error(`That file is not valid scene JSON: ${err.message}`));
      }
    };
    input.click();
  });
}
