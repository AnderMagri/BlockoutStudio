/* ============================================================
   layers.js — the layer panel.

   Layers are the unit of export: the mask pass renders the active layer
   white and everything else black, so "Product" / "Lighting" / "Set"
   double as a compositing plan.
   ============================================================ */

import * as store from './store.js';
import { destroyItem, select } from './objects.js';
import { $, el, toast } from './util.js';

const ICONS = {
  camera:'▣', light:'✦', set:'▤',
  text:'T', spline:'∿', mesh:'▢'
};

const iconFor = item =>
  ICONS[item.sub] || ICONS[item.kind] || ICONS.mesh;

export function renderLayers(){
  const host = $('layers');
  if (!host) return;
  host.innerHTML = '';

  for (const layer of store.state.layers){
    host.appendChild(renderLayer(layer));
  }
}

function renderLayer(layer){
  const isActive = layer.id === store.state.activeLayerId;
  const wrap = el('div', 'layer' + (isActive ? ' active' : '') + (layer.visible ? '' : ' hidden'));

  /* ---- head ---- */
  const head = el('div', 'layer-head');
  head.onclick = () => {
    store.state.activeLayerId = layer.id;
    store.changed();
  };

  const eye = el('button', 'eye', layer.visible ? '◉' : '○');
  eye.title = layer.visible ? 'Hide layer' : 'Show layer';
  eye.onclick = e => {
    e.stopPropagation();
    layer.visible = !layer.visible;
    store.applyVisibility();
    store.changed();
  };

  const solo = el('button', 'solo' + (store.state.soloLayerId === layer.id ? ' on' : ''), 'S');
  solo.title = 'Isolate this layer';
  solo.onclick = e => {
    e.stopPropagation();
    store.state.soloLayerId = store.state.soloLayerId === layer.id ? null : layer.id;
    store.applyVisibility();
    store.changed();
  };

  const name = el('input', 'layer-name');
  name.type = 'text';
  name.value = layer.name;
  name.onclick = e => e.stopPropagation();
  // Rename on blur, not on every keystroke: renaming to "" mid-edit and
  // having it snap back to a placeholder is maddening to type through.
  name.oninput = e => { layer.name = e.target.value; };
  name.onblur  = e => {
    if (!e.target.value.trim()){
      layer.name = 'Layer';
      e.target.value = layer.name;
    }
    store.changed();
  };

  const members = store.itemsInLayer(layer.id);
  const count = el('span', 'count', String(members.length));

  head.append(eye, solo, name, count);

  // The Set layer holds locked pieces and must not be deletable: there is
  // nothing that could put it back.
  const holdsLocked = members.some(i => i.locked);

  if (store.state.layers.length > 1 && !holdsLocked){
    const kill = el('button', 'kill', '×');
    kill.title = 'Delete layer — its contents move to the first layer';
    kill.onclick = e => {
      e.stopPropagation();
      if (!store.removeLayer(layer.id)){
        toast('That layer cannot be deleted.', true);
        return;
      }
      store.applyVisibility();
      store.changed();
    };
    head.appendChild(kill);
  }

  wrap.appendChild(head);

  /* ---- members ---- */
  const list = el('ul');
  if (!members.length){
    list.appendChild(el('li', 'empty', 'Empty'));
  } else {
    for (const item of members) list.appendChild(renderItem(item));
  }
  wrap.appendChild(list);

  return wrap;
}

function renderItem(item){
  const li = el('li', item === store.state.selected ? 'sel' : '');
  if (item.locked) li.classList.add('locked');

  li.appendChild(el('span', 'ico', iconFor(item)));

  const name = el('span', 'nm', item.name);
  name.title = item.name;
  li.appendChild(name);

  if (!item.locked){
    const rm = el('button', 'rm', '×');
    rm.title = 'Remove';
    rm.onclick = e => {
      e.stopPropagation();
      destroyItem(item);
      store.applyVisibility();
      store.changed();
    };
    li.appendChild(rm);
  }

  li.onclick = () => select(item);
  return li;
}
