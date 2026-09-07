/* ============================================================
   util.js — DOM helpers, formatting, colour science, downloads
   ============================================================ */

import { measure } from './units.js';

export const $  = id => document.getElementById(id);
export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Metres → a display string in whatever unit the user has chosen. */
export const metres = m => measure(m);

/** Millimetres → readable string, used by the depth-of-field readout. */
export function mm(v){
  if (!isFinite(v)) return '∞';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} m`;
  if (Math.abs(v) >= 10)   return `${(v / 10).toFixed(1)} cm`;
  return `${v.toFixed(1)} mm`;
}

export const slug = s =>
  (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

/**
 * Colour temperature → linear-ish RGB, Tanner Helland's approximation.
 * 2700 K tungsten, 5600 K daylight, 7500 K open shade.
 */
export function kelvinToRGB(kelvin){
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r, g, b;

  if (t <= 66){
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66)      b = 255;
  else if (t <= 19) b = 0;
  else              b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

/** Plain-language name for a colour temperature, for the prompt text. */
export function kelvinName(k){
  if (k < 2200) return 'candlelight';
  if (k < 3000) return 'tungsten';
  if (k < 4000) return 'warm white';
  if (k < 5000) return 'neutral white';
  if (k < 6000) return 'daylight';
  if (k < 7500) return 'overcast daylight';
  return 'open shade';
}

/** Trigger a browser download for a data URL. */
export function download(url, name){
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- toast ---------- */
let toastEl = null, toastTimer = null;
export function toast(msg, isError = false){
  if (!toastEl){
    toastEl = el('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = 'show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 2600);
}

/** Fill a <select> from [{value,label}] and select `current`. */
export function fillSelect(node, options, current){
  node.innerHTML = '';
  for (const o of options){
    const opt = el('option', null, o.label);
    opt.value = o.value;
    if (String(o.value) === String(current)) opt.selected = true;
    node.appendChild(opt);
  }
}
