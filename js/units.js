/* ============================================================
   units.js — real-world measurement.

   The scene is modelled in metres and always has been: a can really is
   0.122 m tall, and the depth-of-field maths depends on that being true.
   This module is only about how those metres are shown and typed.

   The unit choice is a display preference, stored per browser. Nothing
   downstream ever sees anything but metres.
   ============================================================ */

const KEY = 'blockout.unit';

export const UNITS = {
  mm: { id:'mm', label:'mm',     perMetre: 1000,     decimals: 1 },
  cm: { id:'cm', label:'cm',     perMetre: 100,      decimals: 2 },
  m:  { id:'m',  label:'m',      perMetre: 1,        decimals: 3 },
  in: { id:'in', label:'inches', perMetre: 39.3701,  decimals: 2 }
};

export const UNIT_LIST = Object.values(UNITS);

let current = 'cm';
try {
  const saved = localStorage.getItem(KEY);
  if (saved && UNITS[saved]) current = saved;
} catch { /* private window — the default is fine */ }

export const unit = () => UNITS[current];

export function setUnit(id){
  if (!UNITS[id]) return current;
  current = id;
  try { localStorage.setItem(KEY, id); } catch {}
  return current;
}

/** Metres → a number in the current unit. */
export const toUnit = m => m * unit().perMetre;

/** A number in the current unit → metres. */
export const toMetres = v => v / unit().perMetre;

/** Metres → a rounded string in the current unit, without the suffix. */
export function value(m){
  const u = unit();
  return (m * u.perMetre).toFixed(u.decimals).replace(/\.?0+$/, '');
}

/** Metres → a display string with the unit, e.g. "12.2 cm". */
export function measure(m){
  return `${value(m)} ${unit().label === 'inches' ? 'in' : unit().label}`;
}

/**
 * Parse typed input into metres. Accepts a bare number in the current
 * unit, or an explicit suffix so "120mm" works while showing centimetres.
 */
export function parse(text){
  const raw = String(text).trim().toLowerCase();
  const match = raw.match(/^(-?[\d.]+)\s*(mm|cm|m|in|")?$/);
  if (!match) return null;

  const n = parseFloat(match[1]);
  if (!isFinite(n)) return null;

  const suffix = match[2] === '"' ? 'in' : match[2];
  const u = suffix ? UNITS[suffix] : unit();
  return u ? n / u.perMetre : null;
}
