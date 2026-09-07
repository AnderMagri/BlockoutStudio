#!/usr/bin/env node
/* ============================================================
   server.js — Blockout Studio MCP connector.

   One process, three jobs:

     1. Serves the studio itself at http://localhost:8787
     2. Holds an event stream open to the open page, so an assistant
        can drive it
     3. Speaks MCP over stdio to Claude

   ZERO DEPENDENCIES. Node's own http and crypto only — nothing to
   install, nothing to fail in front of an audience.

   Why Server-Sent Events rather than a WebSocket: SSE is plain HTTP,
   so there is no handshake to implement and no frame masking to get
   wrong, and EventSource reconnects by itself when the page reloads.
   Results and image uploads come back as ordinary POSTs.

   IMPORTANT: stdout belongs to the MCP protocol. Everything human
   goes to stderr.
   ============================================================ */

import http from 'node:http';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.BLOCKOUT_PORT || 8787);
const EXPORT_DIR = process.env.BLOCKOUT_EXPORTS || path.join(ROOT, 'exports');

const log = (...a) => console.error('[blockout]', ...a);

/* ============================================================
   Page channel
   ============================================================ */

/** Open SSE connections — normally exactly one: the studio tab. */
const pages = new Set();

/** In-flight commands awaiting a reply from the page. */
const pending = new Map();

function broadcast(payload){
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of pages){
    try { res.write(line); } catch { pages.delete(res); }
  }
}

/**
 * Send a command to the studio page and wait for its answer.
 * @returns {Promise<any>}
 */
function callPage(method, params = {}, timeoutMs = 20000){
  if (pages.size === 0){
    return Promise.reject(new Error(
      'No studio page is connected. Open http://localhost:' + PORT +
      ' in a browser and leave the tab open.'
    ));
  }

  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`The studio did not answer "${method}" within ${timeoutMs}ms.`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });
    broadcast({ id, method, params });
  });
}

function settle(id, body){
  const entry = pending.get(id);
  if (!entry) return;              // late reply to a timed-out call
  clearTimeout(entry.timer);
  pending.delete(id);
  if (body.error) entry.reject(new Error(body.error));
  else entry.resolve(body.result);
}

/* ============================================================
   HTTP
   ============================================================ */

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon'
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function readBody(req, limitBytes = 64 * 1024 * 1024){
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limitBytes){ reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS'){ res.writeHead(204, cors); return res.end(); }

  /* ---- the page's event stream ---- */
  if (url.pathname === '/studio/events'){
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1000\n\n');
    res.write(': connected\n\n');

    pages.add(res);
    log(`studio connected (${pages.size} open)`);

    // Comment lines keep the connection warm through any idle proxy.
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
    req.on('close', () => {
      clearInterval(beat);
      pages.delete(res);
      log(`studio disconnected (${pages.size} open)`);
    });
    return;
  }

  /* ---- the page answering a command ---- */
  if (url.pathname === '/studio/result' && req.method === 'POST'){
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      settle(body.id, body);
      res.writeHead(204, cors); return res.end();
    } catch (err){
      res.writeHead(400, { ...cors, 'Content-Type':'application/json' });
      return res.end(JSON.stringify({ error: String(err.message || err) }));
    }
  }

  /* ---- the page handing over rendered pixels ---- */
  if (url.pathname === '/studio/upload' && req.method === 'POST'){
    try {
      const name = (url.searchParams.get('name') || 'export.png')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
      const file = path.join(EXPORT_DIR, name);
      fs.writeFileSync(file, await readBody(req));
      log('wrote', file);
      res.writeHead(200, { ...cors, 'Content-Type':'application/json' });
      return res.end(JSON.stringify({ path: file }));
    } catch (err){
      res.writeHead(500, { ...cors, 'Content-Type':'application/json' });
      return res.end(JSON.stringify({ error: String(err.message || err) }));
    }
  }

  /* ---- status ---- */
  if (url.pathname === '/studio/health'){
    res.writeHead(200, { ...cors, 'Content-Type':'application/json' });
    return res.end(JSON.stringify({
      status:'ok', pagesConnected: pages.size, port: PORT, exportDir: EXPORT_DIR
    }));
  }

  /* ---- static site ---- */
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);

  // Refuse anything that escapes the project folder.
  if (!file.startsWith(ROOT)){ res.writeHead(403, cors); return res.end('Forbidden'); }

  fs.readFile(file, (err, data) => {
    if (err){ res.writeHead(404, cors); return res.end('Not found'); }
    res.writeHead(200, { ...cors, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE'){
    log(`port ${PORT} is already in use — another copy is probably running.`);
    log('Close it, or set BLOCKOUT_PORT to a different port.');
  } else log('server error:', err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`studio on http://localhost:${PORT}  ·  exports → ${EXPORT_DIR}`);
});

/* ============================================================
   MCP tools
   ============================================================ */

const TOOLS = [
  {
    name: 'studio_status',
    description:
      'Check whether the Blockout Studio page is open and connected. Call this ' +
      'first if any other tool fails — it reports the URL to open.',
    inputSchema: { type:'object', properties:{}, additionalProperties:false }
  },
  {
    name: 'get_vocabulary',
    description:
      'List everything the studio understands: object ids you can add, mannequin ' +
      'poses, lighting rigs, lens focal lengths, framing shots, sensor formats, ' +
      'aspect ratios and export resolutions. Call this before building a scene ' +
      'so you use real ids rather than guessing.',
    inputSchema: { type:'object', properties:{}, additionalProperties:false }
  },
  {
    name: 'get_scene',
    description: 'Return the current scene as JSON: objects with positions, lighting rig and camera.',
    inputSchema: { type:'object', properties:{}, additionalProperties:false }
  },
  {
    name: 'build_scene',
    description:
      'Build a scene in the studio. Objects are placed on a floor with a backdrop; ' +
      'positions are metres, y is up, the camera looks from +Z. Product-scale items ' +
      'are roughly 0.1–0.2 m tall and the mannequin is 1.75 m. Omit position to let ' +
      'the studio arrange items side by side.',
    inputSchema: {
      type:'object',
      properties:{
        objects:{
          type:'array',
          description:'Objects to create. `id` must come from get_vocabulary.',
          items:{
            type:'object',
            properties:{
              id:{ type:'string' },
              name:{ type:'string' },
              position:{ type:'array', items:{ type:'number' }, minItems:3, maxItems:3 },
              rotation:{ type:'array', items:{ type:'number' }, minItems:3, maxItems:3,
                         description:'Euler angles in degrees' },
              scale:{ type:'number' },
              layer:{ type:'string', description:'Layer name; created if absent' },
              text:{ type:'string', description:'For the "text" object' },
              size:{ type:'number', description:'Cap height in metres, for "text"' },
              pose:{ type:'string', description:'For "mannequin"; see get_vocabulary' }
            },
            required:['id'],
            additionalProperties:false
          }
        },
        lighting:{ type:'object', properties:{ rig:{ type:'string' } }, additionalProperties:false },
        camera:{
          type:'object',
          properties:{
            lens:{ type:'number', description:'Full-frame-equivalent focal length in mm' },
            fstop:{ type:'number' },
            focus:{ type:'number', description:'Focus distance in metres' },
            format:{ type:'string' },
            shot:{ type:'string', description:'Framing preset id' }
          },
          additionalProperties:false
        },
        export:{
          type:'object',
          properties:{ aspect:{ type:'string' }, resolution:{ type:'number' } },
          additionalProperties:false
        },
        replace:{
          type:'boolean',
          description:'Clear existing objects first. Default true. Pass false to add to the scene.'
        }
      },
      additionalProperties:false
    }
  },
  {
    name: 'set_camera',
    description: 'Adjust the active camera without rebuilding the scene.',
    inputSchema: {
      type:'object',
      properties:{
        lens:{ type:'number' }, fstop:{ type:'number' }, focus:{ type:'number' },
        format:{ type:'string' }, shot:{ type:'string' }
      },
      additionalProperties:false
    }
  },
  {
    name: 'set_lighting',
    description: 'Swap the lighting rig without touching the objects.',
    inputSchema: {
      type:'object',
      properties:{ rig:{ type:'string', description:'Rig id; see get_vocabulary' } },
      required:['rig'],
      additionalProperties:false
    }
  },
  {
    name: 'export_image',
    description:
      'Render a pass and save it to disk, returning the file path so it can be ' +
      'opened and inspected. "depth" is the linear depth map for ControlNet-style ' +
      'conditioning, "mask" isolates the active layer.',
    inputSchema: {
      type:'object',
      properties:{
        pass:{ type:'string', enum:['render','depth','normal','mask'], default:'render' },
        resolution:{ type:'number', description:'Long edge in pixels, default 1536' }
      },
      additionalProperties:false
    }
  },
  {
    name: 'describe_setup',
    description:
      'Return the studio\'s own prose description of the current scene — camera, ' +
      'optics, lighting and contents — ready to paste into an image generator ' +
      'alongside the depth map.',
    inputSchema: { type:'object', properties:{}, additionalProperties:false }
  }
];

async function runTool(name, args = {}){
  switch (name){
    case 'studio_status':
      return {
        connected: pages.size > 0,
        pagesConnected: pages.size,
        url: `http://localhost:${PORT}`,
        exportDir: EXPORT_DIR,
        hint: pages.size ? 'Studio is connected.'
            : `Open http://localhost:${PORT} in a browser and leave the tab open.`
      };

    case 'get_vocabulary': return callPage('vocabulary');
    case 'get_scene':      return callPage('getScene');
    case 'describe_setup': return callPage('describeSetup');
    case 'set_camera':     return callPage('setCamera', args);
    case 'set_lighting':   return callPage('setLighting', args);

    case 'build_scene':
      // Text objects wait on a font load, so allow a little longer.
      return callPage('buildScene', args, 40000);

    case 'export_image':
      return callPage('exportImage', {
        pass: args.pass || 'render',
        resolution: args.resolution || 1536
      }, 60000);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ============================================================
   MCP over stdio — newline-delimited JSON-RPC 2.0
   ============================================================ */

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc:'2.0', id, result });
const fail  = (id, code, message) => send({ jsonrpc:'2.0', id, error:{ code, message } });

async function handleRpc(msg){
  const { id, method, params } = msg;

  // Notifications carry no id and expect no answer.
  if (id === undefined || id === null){
    return;
  }

  switch (method){
    case 'initialize':
      return reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'blockout-studio', version: '1.0.0' }
      });

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = params?.name;
      try {
        const result = await runTool(toolName, params?.arguments || {});
        return reply(id, {
          content: [{ type:'text', text: JSON.stringify(result, null, 2) }]
        });
      } catch (err){
        // A failed tool is reported in-band so the model can react to it,
        // rather than as a protocol error.
        return reply(id, {
          content: [{ type:'text', text: `Error: ${err.message || err}` }],
          isError: true
        });
      }
    }

    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0){
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      handleRpc(JSON.parse(line));
    } catch (err){
      log('bad JSON-RPC line:', err.message);
    }
  }
});

process.stdin.on('end', () => {
  log('stdin closed — the MCP client went away. HTTP server stays up.');
});

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
