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
   covers running the site from python -m http.server on another port. */
const ORIGIN = location.port === '8787'
  ? location.origin
  : 'http://localhost:8787';

let source = null;
let connected = false;

/* ---------------- status light ---------------- */

function setStatus(on, title){
  connected = on;
  const dot = document.querySelector('.pill .dot');
  if (!dot) return;
  dot.style.background = on ? 'var(--accent)' : 'rgba(122,122,122,.5)';
  dot.title = title;
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
export function connectBridge(){
  if (source) return;

  try {
    source = new EventSource(`${ORIGIN}/studio/events`);
  } catch (err){
    console.warn('[bridge] could not open the event stream:', err);
    return;
  }

  source.onopen = () => {
    const first = !connected;
    setStatus(true, 'Connected to the MCP server — an assistant can drive this scene');
    if (first) toast('Assistant connected');
  };

  source.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); }
    catch { return; }
    if (msg && msg.id && msg.method) runCommand(msg);
  };

  source.onerror = () => {
    // Fires on every retry too, so this must stay quiet and cheap.
    setStatus(false, `Not connected — run: node mcp/server.js`);
  };

  setStatus(false, 'Connecting…');
}
