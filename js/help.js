/* ============================================================
   help.js — what the studio does, in the studio.

   Content only: no DOM, no imports. ui.js renders it into a sheet.
   Kept separate because it is prose that will be edited far more often
   than the panel that shows it, and because a wall of copy in the middle
   of the HUD wiring makes both harder to read.

   The README says all of this too. This exists because nobody reads a
   README while their hands are on the tool.
   ============================================================ */

/** Keyboard commands, grouped the way you reach for them. */
export const HELP_KEYS = [
  {
    group: 'Moving things',
    keys: [
      ['W', 'Move the selection'],
      ['E', 'Rotate it'],
      ['R', 'Scale it'],
      ['D', 'Duplicate it'],
      ['X', 'Delete it — or Backspace / Delete'],
      ['Esc', 'Deselect']
    ]
  },
  {
    group: 'Moving the camera',
    keys: [
      ['Drag', 'Orbit around the pivot'],
      ['C', 'Centre the selection in frame — turns the camera, does not move it'],
      ['F', 'Frame the selection — also pulls the camera back so it fits, which changes the shot'],
      ['Click', 'Select whatever is under the pointer']
    ]
  }
];

/** The controls that are not obvious from their label. */
export const HELP_PANELS = [
  ['Arrange / Cam',
   'The view switcher. Arrange is for building the set and moving things; ' +
   'Cam looks through a placed camera, where orbiting moves that camera. ' +
   'The studio opens in Cam.'],

  ['◱ Preview',
   'A live inset of what a camera sees, shown in the Arrange view so you can ' +
   'move things and watch the framing at once. It is hidden while you are ' +
   'already looking through a camera, since the main view is the preview then.'],

  ['⊙ Orbit',
   'Whether orbiting turns around the selection or the whole scene. Lights, ' +
   'cameras and the set never become the pivot — they are either far away or ' +
   'enormous.'],

  ['Lock framing',
   'On a selected camera. Stops a drag, C, F or a framing preset from moving a ' +
   'shot you are happy with. A locked camera shows a padlock in the switcher.'],

  ['Set',
   'None, ground, ground plus backdrop, or an infinite cove. "None" leaves your ' +
   'objects against empty space and gives the cleanest depth and mask passes.'],

  ['Composition light',
   'A flat, shadowless working light for arranging. It mutes the lighting rig ' +
   'rather than replacing it, so the rig you tuned comes back when you switch off.'],

  ['Stands in for',
   'On a selected shape. Declares what the grey form represents — the product ' +
   'itself, a label, a screen, a cover — so the image brief can name it. No ' +
   'file is involved; your artwork goes straight to the image tool.'],

  ['⦿ MCP',
   'The connection to an assistant. Purple means a server is connected and can ' +
   'drive the scene; click to switch it off and this page stops taking commands.']
];

/**
 * The whole workflow, start to finish.
 *
 * Deliberately ends at "change one thing and go round again", because that
 * is what the tool is for — the blockout is cheap to adjust and the
 * generation is not.
 */
export const HELP_WORKFLOW = {
  intro:
    'The studio does not make your final image. It makes the inputs that tell ' +
    'an image model the composition, the camera and the light — and the brief ' +
    'that explains them. Everything stays grey clay on purpose: surface detail ' +
    'would only mislead the depth and mask passes.',

  steps: [
    ['Set the frame first',
     'Pick your output shape from the aspect menu at the top right. The viewport ' +
     'is letterboxed to it, so what you frame is exactly what you get. Changing ' +
     'it later re-crops everything you have composed.'],

    ['Block out the shapes',
     'Add object. Everything is modelled at real scale — a 330 ml can really is ' +
     '66 × 122 mm — and the depth-of-field maths depends on that being true. Use ' +
     'a cylinder for a bucket, a box for a phone; it does not need to look like ' +
     'the thing, it needs to sit where the thing sits. Type an exact size into ' +
     'the Size fields if it matters.'],

    ['Place the camera',
     'Select Camera 1 and press Look through. Pick a lens from the gallery, or ' +
     'set a focal length and aperture by hand — focal lengths are full-frame ' +
     'equivalents, so 85 mm looks like 85 mm on any format. Drag to orbit, then ' +
     'press C to put your subject back in the middle without changing the shot. ' +
     'Turn on Lock framing once you like it.'],

    ['Light it',
     'Pick a rig from the Lighting gallery — the twelve are built the way they ' +
     'are built on a real set. Applying one drops real light objects into the ' +
     'Lighting layer; select any of them to change colour temperature, power, ' +
     'angle or softness. Switch the composition light off before you judge the look.'],

    ['Say what the shapes are',
     'Select a shape and fill in Stands in for: a role, and a few words saying ' +
     'what it is ("an iPhone 15 Pro in natural titanium"). Do this for anything ' +
     'you are supplying a photo or artwork for. Nothing is rendered — it only ' +
     'shapes the brief.'],

    ['Copy the brief',
     'Export… → Image brief. Type what you actually want at the top. It lists ' +
     'the images to attach, in order, and writes the instruction: what the grey ' +
     'blockout is, what the depth map is, and which shape each of your reference ' +
     'images replaces — located by where it really sits in the frame. Copy it.'],

    ['Export the passes',
     'From the same panel: Render, then Depth map. Add the Edge map when ' +
     'silhouettes matter — depth and edge together hold structure harder than ' +
     'either alone. They land in your downloads at the size and aspect shown.'],

    ['Assemble it in Krea',
     'Make an image generation in Krea and add your inputs as references in ' +
     'exactly the order the brief lists: the render first, then the depth map, ' +
     'then your product photos and artwork. Paste the brief as the prompt. The ' +
     'order matters — the brief refers to them as "Image 1", "Image 2", and that ' +
     'numbering is how the model knows which reference belongs to which shape.'],

    ['Change one thing and go round again',
     'If the light is wrong, fix it here and re-export — it costs you nothing. ' +
     'That is the whole reason to block a shot out instead of prompting at it: ' +
     'the geometry, the lens and the lighting are yours to adjust exactly, and ' +
     'only the picture is left to chance.']
  ],

  notes: [
    ['The brief describes the camera you are looking through.',
     'In the Arrange view that is the free camera, not your placed one. Be in ' +
     'your camera when you export the passes and copy the brief, or they will ' +
     'disagree.'],

    ['Save early, download to keep.',
     'Scenes… saves into this browser, which works with no server running but is ' +
     'tied to this browser. Use Download for anything you want to keep or hand ' +
     'to someone else.'],

    ['If the image contains something you did not ask for, the prompt named it.',
     'Naming a piece of equipment makes a model draw it — say "softbox" and you ' +
     'get a softbox hanging in the top of the frame. The brief describes light ' +
     'by what it does to the subject for exactly this reason. The same trap is ' +
     'worth remembering whenever you edit the text by hand.'],

    ['Exact logos and type cannot be generated.',
     'No image model reproduces real typography or a logo reliably — it produces ' +
     'something logo-shaped. For artwork that has to be exact, generate the ' +
     'scene and composite your real artwork on afterwards; the layer mask pass ' +
     'gives you the region to composite into.']
  ]
};
