/* ============================================================
   bridge.js — connects the open studio to the MCP server.

   The server holds a Server-Sent Events stream open and pushes
   commands down it; results and rendered pixels go back as ordinary
   POSTs. No WebSocket, no handshake, and EventSource reconnects by
   itself when the page reloads or the server restarts.

   Everything here routes through window.BlockoutStudio. If a command
   cannot be expressed through that object, the fix belongs in api.js,
   not here.
   ============================================================ */

import { toast } from './util.js';

/* The server that serves this page is the one to talk to; the fallback
   covers running the site from python -m http.server on another port.
   Probed rather than matched against a hardcoded port, because the MCP
   server honours BLOCKOUT_PORT and may be serving this page from anywhere. */
let ORIGIN = location.origin;

async function resolveOrigin(){
  try {
    const res = await fetch(`${location.origin}/studio/health`, { cache:'no-store' });
    if (res.ok) return location.origin;
  } catch { /* not the MCP server — fall through */ }
  return 'http://localhost:8787';
}

let source = null;

/**
 * 'off'        — not connected and not trying (the user switched it off)
 * 'connecting' — the stream is open or retrying; EventSource retries by
 *                itself, so this is also the state after a failure
 * 'on'         — the server answered and commands can arrive
 */
let state = 'off';
let detail = 'Not connected';

const watchers = new Set();

export const bridgeState  = () => state;
export const bridgeDetail = () => detail;

/** Tell the UI when the connection changes. Returns an unsubscribe. */
export function onBridgeState(fn){
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/* ---------------- status light ---------------- */

function setStatus(next, title){
  state = next;
  detail = title;

  const dot = document.querySelector('.pill .dot');
  if (dot){
    dot.style.background = next === 'on' ? 'var(--accent)' : 'rgba(122,122,122,.5)';
    dot.title = title;
  }
  for (const fn of watchers) fn(state, detail);
}

/* ---------------- command handlers ---------------- */

/**
 * Each handler returns whatever should travel back to the assistant.
 * Keep the returns small and descriptive — they are read, not rendered.
 */
const HANDLERS = {
  vocabulary: () => window.BlockoutStudio.vocabulary(),

  getScene: () => window.BlockoutStudio.serializeScene(),

  describeSetup: () => ({ description: window.BlockoutStudio.describeSetup() }),

  setCamera: params => window.BlockoutStudio.setCamera(params),

  setLighting: params => window.BlockoutStudio.setLighting(params.rig),

  buildScene: async params => {
    const { replace = true, ...scene } = params || {};
    const result = await window.BlockoutStudio.applyScene(scene, { replace });
    return {
      built: result.added,
      warnings: result.warnings,
      scene: window.BlockoutStudio.serializeScene()
    };
  },

  newScene: () => window.BlockoutStudio.newScene(),

  listScenes: () => ({ scenes: window.BlockoutStudio.listScenes() }),

  saveScene: params => window.BlockoutStudio.saveScene(params.name),

  loadScene: params => window.BlockoutStudio.loadScene(params.name),

  /**
   * Render a pass and hand the PNG to the server, which writes it to disk
   * and returns the path. Sending bytes rather than a data URL keeps a
   * 2 MB base64 string out of the conversation.
   */
  exportImage: async params => {
    const shot = window.BlockoutStudio.capturePass(
      params.pass || 'render',
      params.resolution || 1536
    );
    if (!shot) throw new Error('Export failed — nothing was captured.');

    const blob = await (await fetch(shot.dataUrl)).blob();
    const res = await fetch(
      `${ORIGIN}/studio/upload?name=${encodeURIComponent(shot.filename)}`,
      { method:'POST', headers:{ 'Content-Type':'image/png' }, body: blob }
    );
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);

    const { path } = await res.json();
    return {
      path,
      pass: params.pass || 'render',
      size: `${shot.width}×${shot.height}`,
      note: shot.note
    };
  }
};

/* ---------------- plumbing ---------------- */

async function runCommand({ id, method, params }){
  let body;
  try {
    const handler = HANDLERS[method];
    if (!handler) throw new Error(`Unknown command: ${method}`);
    body = { id, result: await handler(params || {}) };
  } catch (err){
    body = { id, error: String(err?.message || err) };
  }

  try {
    await fetch(`${ORIGIN}/studio/result`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    // The server went away mid-command. EventSource will reconnect and
    // the caller will see its own timeout — nothing useful to do here.
  }
}

/** Open the event stream. EventSource retries on its own, so this runs once. */
export async function connectBridge(){
  if (source) return;

  setStatus('connecting', 'Looking for the MCP server…');
  ORIGIN = await resolveOrigin();

  // A disconnect that landed while the origin was being probed wins.
  if (state === 'off') return;

  try {
    source = new EventSource(`${ORIGIN}/studio/events`);
  } catch (err){
    console.warn('[bridge] could not open the event stream:', err);
    setStatus('off', 'Could not open the event stream');
    return;
  }

  source.onopen = () => {
    const first = state !== 'on';
    setStatus('on', 'Connected to the MCP server — an assistant can drive this scene');
    if (first) toast('Assistant connected');
  };

  source.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); }
    catch { return; }
    if (msg && msg.id && msg.method) runCommand(msg);
  };

  source.onerror = () => {
    // Fires on every retry too, so this must stay quiet and cheap. It is
    // still "connecting" rather than "off": EventSource keeps trying, and
    // the server appearing later should just work.
    setStatus('connecting', 'No MCP server yet — run: node mcp/server.js');
  };
}

/**
 * Stop listening. The server keeps running; this page simply stops taking
 * commands from it, which is the point of an off switch.
 */
export function disconnectBridge(){
  if (source){
    source.close();
    source = null;
  }
  setStatus('off', 'MCP off — this page is not taking commands');
}

export function toggleBridge(){
  if (state === 'off') connectBridge();
  else disconnectBridge();
  return state;
}
