/* ============================================================
   optics.js — sensor formats, lens presets, framing presets and
   real depth-of-field maths. Everything here is plain data and
   arithmetic; nothing touches three.js or the DOM.
   ============================================================ */

/**
 * Sensor formats. `gauge` is the sensor width in mm (three.js calls it
 * filmGauge); `coc` is the circle of confusion in mm, which is what makes
 * depth of field format-dependent in the real world.
 */
export const FORMATS = {
  ff:   { id:'ff',   name:'Full frame 36×24',    short:'full frame',    gauge:36.0,  coc:0.029 },
  apsc: { id:'apsc', name:'APS-C 23.6×15.7',     short:'APS-C',         gauge:23.6,  coc:0.019 },
  mft:  { id:'mft',  name:'Micro 4/3 17.3×13',   short:'Micro 4/3',     gauge:17.3,  coc:0.015 },
  s35:  { id:'s35',  name:'Super 35 cine',       short:'Super 35',      gauge:24.89, coc:0.020 },
  mf:   { id:'mf',   name:'Medium format 44×33', short:'medium format', gauge:43.8,  coc:0.039 }
};
export const FORMAT_LIST = Object.values(FORMATS);

/** f-stop ladder, in the order the aperture slider steps through. */
export const FSTOPS = [1.4, 1.8, 2.0, 2.8, 4.0, 5.6, 8.0, 11, 16];

/**
 * Lens gallery. `equiv` is the full-frame-equivalent focal length — the
 * number photographers actually reason with. The real focal length applied
 * to the camera is derived from the selected sensor format, so "85 mm" looks
 * like 85 mm whichever format you are on.
 */
export const LENSES = [
  { id:'w24',  name:'24 mm',  character:'wide',      equiv:24,  fstop:8.0, note:'wide angle, strong perspective, product in its environment' },
  { id:'w35',  name:'35 mm',  character:'reportage', equiv:35,  fstop:5.6, note:'reportage framing, mild perspective, context around the product' },
  { id:'n50',  name:'50 mm',  character:'normal',    equiv:50,  fstop:2.8, note:'normal lens, natural perspective' },
  { id:'p85',  name:'85 mm',  character:'product',   equiv:85,  fstop:2.0, note:'short telephoto, gentle compression, classic product framing' },
  { id:'m100', name:'100 mm', character:'macro',     equiv:100, fstop:4.0, note:'macro lens, tight detail, shallow plane of focus' },
  { id:'t135', name:'135 mm', character:'tele',      equiv:135, fstop:2.8, note:'telephoto compression, background pulled forward' },
  { id:'t200', name:'200 mm', character:'long',      equiv:200, fstop:4.0, note:'long telephoto, flat compressed perspective' }
];

/**
 * Framing presets. Positions are in metres around a product roughly 12 cm
 * tall sitting at the origin. Camera sits on +Z, backdrop on −Z.
 */
export const SHOTS = [
  { id:'hero',     name:'Hero 3/4',   equiv:85,  pos:[ 0.34, 0.150, 0.34], target:[0,0.060,0], note:'three-quarter view, 45 degrees off axis' },
  { id:'front',    name:'Front on',   equiv:100, pos:[ 0.00, 0.070, 0.52], target:[0,0.060,0], note:'straight-on frontal view, symmetrical' },
  { id:'low',      name:'Low angle',  equiv:85,  pos:[ 0.24, 0.035, 0.30], target:[0,0.070,0], note:'low camera angle looking slightly up, heroic' },
  { id:'top',      name:'Top-down',   equiv:50,  pos:[ 0.01, 0.620, 0.02], target:[0,0.020,0], note:'top-down flat lay, camera directly overhead' },
  { id:'macro',    name:'Macro',      equiv:100, pos:[ 0.16, 0.090, 0.18], target:[0,0.060,0], note:'macro detail, very close to the product' },
  { id:'packshot', name:'Packshot',   equiv:85,  pos:[ 0.00, 0.180, 0.45], target:[0,0.055,0], note:'catalogue packshot, slightly above eye level' }
];

/** Export aspect ratios, the shapes generators actually want. */
export const ASPECTS = [
  { id:'1:1',  label:'1:1 square',    w:1,  h:1  },
  { id:'4:5',  label:'4:5 portrait',  w:4,  h:5  },
  { id:'2:3',  label:'2:3 portrait',  w:2,  h:3  },
  { id:'3:2',  label:'3:2 landscape', w:3,  h:2  },
  { id:'16:9', label:'16:9 wide',     w:16, h:9  },
  { id:'9:16', label:'9:16 vertical', w:9,  h:16 }
];

export const RESOLUTIONS = [768, 1024, 1280, 1536, 2048];

/* ---------------- conversions ---------------- */

/** Full-frame-equivalent focal length → real focal length on this format. */
export const focalFromEquiv = (equiv, format) => equiv * format.gauge / 36;

/** Real focal length on this format → full-frame equivalent. */
export const equivFromFocal = (focal, format) => focal * 36 / format.gauge;

/** Horizontal field of view in degrees. */
export const hFov = (focal, format) =>
  2 * Math.atan(format.gauge / (2 * focal)) * 180 / Math.PI;

/* ---------------- depth of field ---------------- */

/**
 * Real depth-of-field maths.
 *
 * @param {number} focal    real focal length, mm
 * @param {number} fstop    f-number
 * @param {number} distM    focus distance, metres
 * @param {object} format   one of FORMATS
 * @returns {{near:number, far:number, total:number, hyperfocal:number,
 *            front:number, back:number}} all in mm (far/total may be Infinity)
 */
export function depthOfField(focal, fstop, distM, format){
  const f = focal;
  const s = distM * 1000;                       // mm
  const H = (f * f) / (fstop * format.coc) + f; // hyperfocal, mm

  // Subject closer than the lens can focus — degenerate, report nothing.
  if (s <= f) return { near:s, far:s, total:0, hyperfocal:H, front:0, back:0 };

  const near = (s * (H - f)) / (H + s - 2 * f);
  const far  = (s >= H) ? Infinity : (s * (H - f)) / (H - s);

  return {
    near,
    far,
    total: far - near,
    hyperfocal: H,
    front: s - near,
    back:  far - s
  };
}

/** Rough plain-language description of the depth of field, for the prompt. */
export function dofCharacter(totalMm){
  if (!isFinite(totalMm))  return 'deep focus, everything sharp';
  if (totalMm < 8)         return 'razor-thin plane of focus';
  if (totalMm < 25)        return 'very shallow depth of field, strong background separation';
  if (totalMm < 80)        return 'shallow depth of field';
  if (totalMm < 300)       return 'moderate depth of field';
  return 'deep depth of field, most of the scene sharp';
}
