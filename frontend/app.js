// frontend/app.js
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  apiBase: localStorage.getItem('apiBase') || '/backend/api.php',
  sessionToken: localStorage.getItem('sessionToken') || '',
  mapBounds: {min_x:0, min_y:0, max_x:1000, max_y:1000},
  vehicles: [],
  events: [],
  hospitals: [],
  players: [],
  logsLastId: 0,
  grouping: null,
  zoom: 1,
  pan: {x:0, y:0},
  mapNatural: {w:0, h:0},
  modId: null,
  activeVehTab: 'vehicles',
};
if(!$('#apiBase').value){
	$('#apiBase').value = state.apiBase;
}
if(!$('#sessionToken').value){
	$('#sessionToken').value = state.sessionToken;
}
function saveSettings(){
  state.apiBase = $('#apiBase').value.trim() || '/backend/api.php';
  state.sessionToken = $('#sessionToken').value.trim();
  localStorage.setItem('apiBase', state.apiBase);
  localStorage.setItem('sessionToken', state.sessionToken);
  fetchState(true);
}
$('#saveSettings').addEventListener('click', () => saveSettings());
$('#reloadBtn').addEventListener('click', () => fetchState(true));

$$('.panel-toggles input[type=checkbox]').forEach(cb => {
  cb.addEventListener('change', () => {
    togglePanelVisibility(cb.dataset.toggle, cb.checked);
    queueResize();
  });
});
function togglePanelVisibility(panelId, visible) {
  const el = document.getElementById(panelId);
  if (!el) return;
  el.classList.toggle('hidden-panel', !visible);
}

$$('.hide-panel').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.panel;
    const panel = document.getElementById(id);
    panel.classList.add('hidden-panel');
    const cb = document.querySelector(`.panel-toggles input[data-toggle="${id}"]`);
    if (cb) cb.checked = false;
    queueResize();
  });
});

$$('.detach').forEach(btn => {
  btn.addEventListener('click', () => {
    togglePopout(btn.dataset.panel);
    queueResize();
  });
});
function togglePopout(panelId) {
  const el = document.getElementById(panelId);
  if (!el) return;
  el.classList.toggle('popout');
}

let dragPanel = null, dragOffset = {x:0,y:0};
document.addEventListener('mousedown', (e) => {
  const header = e.target.closest('.panel.popout .panel-header');
  if (!header || e.button !== 0) return;
  if (e.target.closest('button, input, select, label')) return;
  dragPanel = header.closest('.panel.popout');
  const rect = dragPanel.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!dragPanel) return;
  dragPanel.style.left = (e.clientX - dragOffset.x) + 'px';
  dragPanel.style.top  = (e.clientY - dragOffset.y) + 'px';
});
document.addEventListener('mouseup', () => { dragPanel = null; });

const grid = $('#grid');
let gridDrag = null;
$('#gutter-col').addEventListener('mousedown', () => { gridDrag = {type:'col'}; grid.classList.add('dragging'); });
$('#gutter-row').addEventListener('mousedown', () => { gridDrag = {type:'row'}; grid.classList.add('dragging'); });
window.addEventListener('mousemove', (e) => {
  if (!gridDrag) return;
  const rect = grid.getBoundingClientRect();
  if (gridDrag.type === 'col') {
    const x = e.clientX - rect.left;
    const ratio = Math.min(0.85, Math.max(0.15, x / rect.width));
    grid.style.setProperty('--col1', `${ratio}fr`);
    grid.style.setProperty('--col2', `${1 - ratio}fr`);
  } else {
    const y = e.clientY - rect.top;
    const ratio = Math.min(0.85, Math.max(0.15, y / rect.height));
    grid.style.setProperty('--row1', `${ratio}fr`);
    grid.style.setProperty('--row2', `${1 - ratio}fr`);
  }
  queueResize();
});
window.addEventListener('mouseup', () => { gridDrag = null; grid.classList.remove('dragging'); });

$('#panel-vehicles').querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $('#panel-vehicles').querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeVehTab = btn.dataset.tab;
    if (state.activeVehTab === 'vehicles') {
      $('#vehiclesList').classList.remove('hidden');
      $('#hospitalsList').classList.add('hidden');
    } else {
      $('#hospitalsList').classList.remove('hidden');
      $('#vehiclesList').classList.add('hidden');
      renderHospitals();
    }
  });
});

const mapImg = $('#mapImage');
const mapCanvas = $('#mapCanvas');
const mapWrapper = $('#mapWrapper');
const ctx = mapCanvas.getContext('2d', {alpha: true});

let resizeQueued = false;
function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resizeCanvas();
  });
}

mapImg.addEventListener('load', () => {
  state.mapNatural.w = mapImg.naturalWidth;
  state.mapNatural.h = mapImg.naturalHeight;
  queueResize();
});
mapImg.addEventListener('error', () => {
  console.warn('Map image failed to load (mod_id=', state.modId, ')');
});

const ro = new ResizeObserver(() => queueResize());
ro.observe(mapWrapper);
window.addEventListener('resize', queueResize);

function resizeCanvas() {
  const rect = mapWrapper.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  mapCanvas.style.width = rect.width + 'px';
  mapCanvas.style.height = rect.height + 'px';
  mapCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
  mapCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(1,0,0,1,0,0);
  renderMap();
}

// Panning
let isPanning = false, lastMouse = {x:0,y:0};
mapWrapper.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !e.shiftKey) {
    isPanning = true; lastMouse = {x:e.clientX, y:e.clientY};
  }
});
mapWrapper.addEventListener('mousemove', (e) => {
  if (isPanning) {
    state.pan.x += (e.clientX - lastMouse.x);
    state.pan.y += (e.clientY - lastMouse.y);
    lastMouse = {x:e.clientX, y:e.clientY};
    renderMap();
  }
});
window.addEventListener('mouseup', () => isPanning = false);

// ⬇️ UPDATED: zoom anchored at mouse pointer (trackpad + wheel friendly)
mapWrapper.addEventListener('wheel', (e) => {
  e.preventDefault();

  // mouse position in canvas CSS pixels
  const mouse = clientToCanvas(e.clientX, e.clientY);

  // pre-zoom scene coordinates (CSS pixels before pan/zoom)
  const preX = (mouse.x - state.pan.x) / state.zoom;
  const preY = (mouse.y - state.pan.y) / state.zoom;

  // multiplicative zoom (smooth for wheel/trackpad)
  const factor = Math.pow(1.0015, -e.deltaY); // >1 zoom in, <1 zoom out
  const minZ = 0.2, maxZ = 4;
  const newZoom = Math.max(minZ, Math.min(maxZ, state.zoom * factor));

  // keep the point under the cursor fixed
  state.zoom = newZoom;
  state.pan.x = mouse.x - preX * state.zoom;
  state.pan.y = mouse.y - preY * state.zoom;

  renderMap();
}, {passive:false});

// Right-click to create event
mapWrapper.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const pos = clientToWorld(e.clientX, e.clientY);
  const name = prompt('Name of new event?', 'Custom Event');
  if (!name) return;
  api('events_create', {name, x: pos.x, y: pos.y}).then(() => {
    fetchState(true);
  }).catch(err => alert('Failed to create event: ' + err.message));
});

// Left-click on event: open assign modal if clicked over an event icon
mapWrapper.addEventListener('click', (e) => {
  const pos = clientToCanvas(e.clientX, e.clientY);
  const hits = [];
  for (const ev of state.events) {
    const p = worldToCanvas({x: ev.x, y: ev.y});
    const dx = (p.x * state.zoom + state.pan.x) - pos.x;
    const dy = (p.y * state.zoom + state.pan.y) - pos.y;
    if (Math.sqrt(dx*dx + dy*dy) <= 12) { hits.push(ev); }
  }
  if (hits.length) openAssignModal(hits[0]);
});

function clientToCanvas(cx, cy) {
  const rect = mapCanvas.getBoundingClientRect();
  return { x: cx - rect.left, y: cy - rect.top };
}

function clientToWorld(cx, cy) {
  const c = clientToCanvas(cx, cy);
  const w = (c.x - state.pan.x) / state.zoom;
  const h = (c.y - state.pan.y) / state.zoom;
  const d = imageDrawRect();
  const nx = (w - d.x) / d.w;
  const ny = (h - d.y) / d.h;
  const worldX = state.mapBounds.min_x + nx * (state.mapBounds.max_x - state.mapBounds.min_x);
  const worldY = state.mapBounds.min_y + ny * (state.mapBounds.max_y - state.mapBounds.min_y);
  return {x: worldX, y: -worldY};
}

function worldToCanvas(pt) {
  const nx = (pt.x - state.mapBounds.min_x) / (state.mapBounds.max_x - state.mapBounds.min_x || 1);
  const ny = (-pt.y - state.mapBounds.min_y) / (state.mapBounds.max_y - state.mapBounds.min_y || 1);
  const d = imageDrawRect();
  const x = d.x + nx * d.w;
  const y = (d.y + ny * d.h);
  return { x, y };
}
function toScreen(p) { return { x: p.x * state.zoom + state.pan.x, y: p.y * state.zoom + state.pan.y }; }

function imageDrawRect() {
  const cwCss = mapCanvas.clientWidth, chCss = mapCanvas.clientHeight;
  const iw = state.mapNatural.w || cwCss, ih = state.mapNatural.h || chCss;
  const cr = cwCss / chCss, ir = iw / ih;
  if (ir > cr) { const w = cwCss, h = cwCss / ir; return {x:0, y:(chCss - h)/2, w, h}; }
  else { const h = chCss, w = chCss * ir; return {x:(cwCss - w)/2, y:0, w, h}; }
}

function renderMap() {
  const ratio = window.devicePixelRatio || 1;
  const w = mapCanvas.width, h = mapCanvas.height;
  ctx.clearRect(0,0,w,h);

  ctx.save();
  ctx.scale(ratio, ratio);
  ctx.translate(state.pan.x, state.pan.y);
  ctx.scale(state.zoom, state.zoom);

  const d = imageDrawRect();
  if (state.mapNatural.w && state.mapNatural.h) {
    ctx.drawImage(mapImg, d.x, d.y, d.w, d.h);
  }

  const fontSize = Math.min(12/(0.75*state.zoom),12);//Maximal old value, minimum 3px (as max zoom is 4 currently)
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'center';

  const placed = [];
  const pad = 3;
  const intersects = (a,b) => !(a.x+a.w < b.x || b.x+b.w < a.x || a.y+a.h < b.y || b.y+b.h < a.y);
  const canPlace = (rect) => placed.every(r => !intersects(r, rect));
  const pushRect = (r) => placed.push(r);

  for (const ev of state.events) {
    const p = worldToCanvas(ev);
    ctx.beginPath();
    const diameter = Math.min(10/state.zoom,10);
    ctx.arc(p.x, p.y, diameter, 0, Math.PI*2);
    ctx.fillStyle = '#6ea8fe';
    ctx.fill();
    ctx.lineWidth = 2 / state.zoom;
    ctx.strokeStyle = '#bcd2ff';
    ctx.stroke();

    const text = ev.name || 'Event';
    const tw = ctx.measureText(text).width;
    const th = fontSize;
    const lx = p.x + diameter+2;
    const ly = p.y + diameter/2 -1;
    ctx.lineWidth = 3 / state.zoom;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#e6ecff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.strokeText(text, lx, ly);
    ctx.fillText(text, lx, ly);

    const scrTopLeft = toScreen({x: lx, y: ly - th});
    pushRect({x: scrTopLeft.x - pad, y: scrTopLeft.y - pad, w: tw*state.zoom + 2*pad, h: th*state.zoom + 2*pad});
  }

  const nodeOffset = Math.min(8/state.zoom,8);//Maximal old value, minimum 2px (as max zoom is 4 currently)
  for (const v of state.vehicles) {
    const p = worldToCanvas(v);

    ctx.beginPath();
    ctx.moveTo(p.x, p.y-nodeOffset); ctx.lineTo(p.x+nodeOffset, p.y); ctx.lineTo(p.x, p.y+nodeOffset); ctx.lineTo(p.x-nodeOffset, p.y); ctx.closePath();
    let fill = '#1dd1a1';
    if (v.status >= 3 && v.status <= 5) fill = '#ff9f43';
    if (v.status > 5) fill = '#ee5253';
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.5 / state.zoom;
    ctx.strokeStyle = '#dfe7ff'; ctx.stroke();

    if(v.status==2){
      //No text on status2 (at Home)
      continue;
    }
    const text = v.name || v.type || v.game_vehicle_id || `#${v.id}`;
    const tw = ctx.measureText(text).width;
    const th = fontSize;

    const candidates = [
      {dx: 0,  dy: -fontSize-nodeOffset+2},//Above center
      {dx: 0,  dy: fontSize+nodeOffset+2},//Below center
      {dx: -tw+nodeOffset,  dy: fontSize/2},//left
      {dx: nodeOffset+tw/2+2,  dy: fontSize/2},//right
    ];

    for (const c of candidates) {
      const lx = p.x + c.dx;
      const ly = p.y + c.dy;
      const rectScreen = {
        x: (lx - tw/2) * state.zoom + state.pan.x - pad,
        y: (ly - th)   * state.zoom + state.pan.y - pad,
        w: tw * state.zoom + 2*pad,
        h: th * state.zoom + 2*pad
      };
      if (canPlace(rectScreen)) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3 / state.zoom;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.fillStyle = '#e6ecff';
        ctx.strokeText(text, lx, ly);
        ctx.fillText(text, lx, ly);
        ctx.restore();
        pushRect(rectScreen);
        break;
      }
    }
  }

  ctx.restore();
}

const modal = $('#assignModal');
$('#closeAssign').addEventListener('click', () => {modal.classList.add('hidden'); sendNotesAsync(modalEvent);});
$('#submitAssign').addEventListener('click', submitAssign);
// Vehicle checklist + search box just above it
const cont = $('#assignVehicles');
const selection = $('#selectedVehicles');
const vehiclesRow = cont.closest('.form-row') || cont.parentElement;
// Create (or reuse) the search input and insert it directly above the list
let sbox = vehiclesRow.querySelector('#assignSearch');
let modalEvent = null;

// Render helper (keeps checked boxes)
function renderList(first=false) {
  const prevChecked = first==true ? new Set() : new Set(
    Array.from(cont.querySelectorAll('input[type=checkbox]:checked')).map(b => +b.value)
  );
  
  //Search for modes:
  const sel = $('#assignVehicles');
  const dropDowns = Array.from(sel.querySelectorAll('select'));
  const modes = {}
  for(let dropDown of dropDowns){
    var id = parseInt(dropDown.id.split("_")[0],10);
    modes[id]=dropDown.value;
  }
  
  // Base list = status 1 or 2
  const base = state.vehicles.filter(v => v.status == 1 || v.status == 2);//3 allows reassignment
  selection.innerHTML="";
  const q = sbox.value.trim();
  let rex = null, isRegex = false;

  // If user typed /pattern/flags build a RegExp
  if (q.startsWith('/') && q.lastIndexOf('/') > 0) {
    const last = q.lastIndexOf('/');
    const pat = q.slice(1, last);
    const flags = q.slice(last + 1);
    try { rex = new RegExp(pat, flags); isRegex = true; } catch { /* ignore regex errors, fallback to plain */ }
  }

  const term = q.toLowerCase();
  const matches = (v) => {
    const label = `${v.name||''} ${v.type||''} ${v.game_vehicle_id||''} ${v.id}`.trim();
    if (!q) return true;
    if (isRegex) return rex.test(label);
    const tokens = term.split(/\s+/).filter(Boolean);
    const hay = label.toLowerCase();
    return tokens.every(t => hay.includes(t));
  };
  cont.innerHTML = '';
  let lastPrefix = '';
  base.forEach(v => {
    const isDisplayed= matches(v);
    const display_mode = `style = "display:${isDisplayed?"block":"none"}"`
    const id = 'veh_' + v.id;
	const separator = v.name.includes("_")?"_":"-";
    const prefix = v.name.includes(separator)?v.name.split(separator)[0]:"";
    if(prefix!=lastPrefix && isDisplayed ){
      const breaker = document.createElement('div');
      breaker.classList.add("row-break");
      cont.appendChild(breaker);
      if(lastPrefix!=""){
        const rule = document.createElement('hr');
        rule.classList.add("row-break");
        cont.appendChild(rule);
      }
      lastPrefix=prefix;
    }

    const row = document.createElement('div');
    row.innerHTML = `<label class="selectedVehicles" ${display_mode}><input type="checkbox" value="${v.id}" id="${id}" onClick="renderList()"/> ${v.name || v.type || v.game_vehicle_id}
                      ${buildDropdown(v.modes, v.id, modes)}<span class="meta">${v.status==2?"&#x0032;&#xFE0F;&#x20E3;":"&#x0031;&#xFE0F;&#x20E3;"}</span></label>`;
    const box = row.querySelector('input[type=checkbox]');
    if (prevChecked.has(v.id)){
      box.checked = true;
      selection.innerHTML += `<label class="selectedVehicles">${v.name}&nbsp;<button onClick="$('#${id}').click()">X</button></label>`;
    } 
    cont.appendChild(row);
  });
}

function openAssignModal(eventObj) {
  modalEvent = eventObj;
  $('#assignEventInfo').innerHTML =
    `<div><b>${eventObj.name}</b> @ (${eventObj.x.toFixed(1)}, ${eventObj.y.toFixed(1)})</div>`;
    
  loadAssignedVehiclesAsync(eventObj);
  loadNotesAsync(eventObj);

  // Players
  const sel = $('#assignPlayer');
  sel.innerHTML = '<option value="">— None —</option>';
  for (const p of state.players) {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name || p.player_id || ('Player #' + p.id);
    sel.appendChild(opt);
  }
  if (!sbox) {
    sbox = document.createElement('input');
    sbox.id = 'assignSearch';
    sbox.type = 'text';
    sbox.placeholder = 'Search or /regex/flags (matches name, type, id)';
    sbox.style.cssText = `
      width:100%;margin:6px 0 8px 0;padding:6px 8px;border-radius:8px;
      border:1px solid #26366d;background:#0d1a3a;color:var(--text);
    `;
    vehiclesRow.insertBefore(sbox, cont); // ← place above the list
  } else {
    sbox.value = '';
  }
  // Initial render + live filtering
  renderList(true);
  sbox.oninput = renderList;
  sbox.focus();
  // Show modal
  modal.classList.remove('hidden');
}


function buildDropdown(mode,id, prev_modes){
    var modes = mode ? mode.split(","):null;
    if(!modes)return "";
    const selectedMode = id in prev_modes ? prev_modes[id]:"";
    modes = modes.map(m=>`<option value="${m}" ${m==selectedMode?"selected=true":""}>${m}</option>`).join("");
    return `<select id="${id}_mode">${modes}</select>`;
}

async function loadAssignedVehiclesAsync(ev) {
  const sel = $("#assignAssignedVehicles");
  const result = await api('events_get_vehicles', {event_id: ev.id});
  var names = result["vehicles"].map(e=>`<div class="selectedVehicles">${e.name}</div>`).sort().join("");
  if(names){
    sel.innerHTML = `${names}`;
  }else{
    sel.innerHTML = "";
  }
}

async function loadNotesAsync(ev) {
  const sel = $("#assignEventComments");
  const result = await api('events_get_note', {event_id: ev.id});
  var notes = result.notes.map(e=>e.content).join("<br>");
  sel.value = notes;
}

async function sendNotesAsync(ev) {
  if(!ev)return;
  const sel = $("#assignEventComments");
  const result = await api('events_set_note', {event_id: ev.id, content: sel.value});
}

async function submitAssign() {
  const sel = $('#assignVehicles');
  const boxes = Array.from(sel.querySelectorAll('input[type=checkbox]:checked'));
  if (!boxes.length) { alert('Select at least one unit'); return; }
  const vehicle_ids = boxes.map(b => parseInt(b.value, 10));
  const player_id = $('#assignPlayer').value ? parseInt($('#assignPlayer').value, 10) : null;

  //Search for modes:
  const dropDowns = Array.from(sel.querySelectorAll('select'));
  const modes = {}
  for(let dropDown of dropDowns){
    var id = parseInt(dropDown.id.split("_")[0],10);
    if(vehicle_ids.includes(id)){
      modes[id]=dropDown.value;
    }
  }

  try {
    sendNotesAsync(modalEvent);
    await api('events_assign', {event_id: modalEvent.id, vehicle_ids, player_id, modes});
    modal.classList.add('hidden');
    pushLogRow({created_at: new Date().toISOString(), type:'command', message:'Assigned vehicles to event', meta:{event_id: modalEvent.id, vehicle_ids}});
    fetchState(true);
  } catch (err) {
    alert('Failed to assign: ' + err.message);
  }
}

const status_visible = {};
function renderVehicles() {
  const container = $('#vehiclesList');
  const byStatus = {};
  for (const v of state.vehicles) {
    if (!byStatus[v.status]) byStatus[v.status] = [];
    byStatus[v.status].push(v);
  }
  Object.values(byStatus).forEach(arr => arr.sort((a,b) => (a.name||'').localeCompare(b.name||'')));

  container.innerHTML = '';
  const statuses = Object.keys(byStatus).map(Number).sort((a,b)=>a-b);
  const grouping = state.grouping;

  for (const s of statuses) {
    if(!(s in status_visible)){
      status_visible[s]= s!=2;//state 2 is hidden by default
    }
    const title = document.createElement('div');
    title.className = 'group-title collapsible';
    title.onclick = function() { toggleCollapse(title,s); };
    title.textContent = `Status ${s}`;
    container.appendChild(title);
    const box = document.createElement('div');
    box.style.display = status_visible[s]?"block":"none";
    container.appendChild(box);

    let items = byStatus[s];

    if (grouping && grouping.groups) {
      for (const [gname, rule] of Object.entries(grouping.groups)) {
        const matches = items.filter(v => {
          const idOk = rule.ids ? rule.ids.includes(v.id) : true;
          const typeOk = rule.types ? rule.types.includes(v.type) : true;
          return idOk && typeOk;
        });
        if (!matches.length) continue;
        const gt = document.createElement('div');
        gt.className = 'meta'; gt.textContent = `— ${gname}`;
        box.appendChild(gt);
        matches.forEach(v => box.appendChild(vehicleItem(v,s)));
        const matchIds = new Set(matches.map(m=>m.id));
        items = items.filter(v => !matchIds.has(v.id));
      }
      if (items.length) {
        const gt = document.createElement('div');
        gt.className = 'meta'; gt.textContent = '— Other';
        box.appendChild(gt);
      }
    }
    items.forEach(v => box.appendChild(vehicleItem(v,s)));
  }
}
async function sendHome(vehicle_id){
  var vehicle_ids = [vehicle_id];
  await api('events_unassign', {vehicle_ids});
}
function vehicleItem(v,s) {
  const el = document.createElement('div');
  el.className = 'item';
  const label = v.name || v.type || v.game_vehicle_id || ('Vehicle #' + v.id);
  const player = (state.players.find(p => p.id === v.assigned_player_id)?.name) || '—';
  el.innerHTML = `
    <div><b>${label}</b>${s==3?`<button onclick='sendHome(${v.id}).then(() => this.remove())'>Send Home</button>`:""}</div>
    <div class="meta">id:${v.id} • status:${v.status} • pos:${Math.round(v.x)},${Math.round(v.y)} • player:${player}</div>
  `;
  return el;
}

function renderHospitals() {
  const container = $('#hospitalsList');
  const list = [...state.hospitals];
  list.sort((a,b) => (b.icu_available - a.icu_available) || (b.ward_available - a.ward_available) || (a.name||'').localeCompare(b.name||''));
  container.innerHTML = '';
  for (const h of list) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div><b>${h.name || 'Hospital'}</b></div>
      <div class="meta">
        ICU: ${h.icu_available}/${h.icu_total} • Ward: ${h.ward_available}/${h.ward_total}
        • Pos: ${Math.round(h.x)},${Math.round(h.y)}
      </div>
    `;
    container.appendChild(el);
  }
}

function renderEvents() {
  const container = $('#eventsList');
  container.innerHTML = '';
  const sorted = [...state.events].sort((a,b)=>a.id-b.id);
  for (const ev of sorted) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div>
          <b>${ev.name}</b>
          <span class="meta">id:${ev.id} • ${ev.status} • (${Math.round(ev.x)}, ${Math.round(ev.y)})</span>
        </div>
        <div style="white-space:nowrap;">
          <button data-id="${ev.id}" data-act="assign">Send Units</button>
          ${ev.created_by === 'frontend' ? `<button data-id="${ev.id}" data-act="finish" title="Mark finished">Finish</button>` : ``}
        </div>
      </div>
    `;
    el.querySelector('[data-act="assign"]').addEventListener('click', () => openAssignModal(ev));
    const finishBtn = el.querySelector('[data-act="finish"]');
    if (finishBtn) {
      finishBtn.addEventListener('click', async () => {
        if (!confirm('Mark this event as finished?')) return;
        try {
          await api('events_finish', {event_id: ev.id});
          fetchState(true);
        } catch (err) {
          alert('Failed to finish event: ' + err.message);
        }
      });
    }
    container.appendChild(el);
  }
}

function pushLogRow(row) {
  const cont = $('#activityLog');
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML = `<span class="time">${new Date(row.created_at).toLocaleTimeString()}</span>
                  <span class="type">[${row.type}]</span> ${row.message}
                  ${row.meta ? `<span class="meta"> ${JSON.stringify(row.meta)}</span>` : ''}`;
  cont.appendChild(el);
  cont.scrollTop = cont.scrollHeight;
}
$('#clearLog').addEventListener('click', () => {
  $('#activityLog').innerHTML = '';
  state.logsLastId = 0;
});

async function api(action, payload={}, method='POST') {
  const url = `${state.apiBase}?action=${encodeURIComponent(action)}`;
  const body = Object.assign({}, payload, {session_token: state.sessionToken});
  const res = await fetch(url, {
    method, headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function fetchState(showErr) {
  if (!state.sessionToken) return;
  try {
    const url = `${state.apiBase}?action=state&session_token=${encodeURIComponent(state.sessionToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load state');

    state.mapBounds = data.session.map_bounds;
    state.players = data.players || [];
    state.vehicles = data.vehicles || [];
    state.events = data.events || [];
    state.hospitals = data.hospitals || [];

    const newMod = data.session.mod_id || null;
    if (state.modId !== newMod) {
      state.modId = newMod;
      if (state.modId) {
        const src = `${state.apiBase}?action=map_image&session_token=${encodeURIComponent(state.sessionToken)}`;
        $('#mapImage').src = src;
      }
    }
    if(data.time){
      $('#time-panel').innerHTML = (data.time.time_hours+"").padStart(2, "0") +":"+ (data.time.time_minutes+"").padStart(2, "0");
    }

    renderVehicles();
    if (state.activeVehTab === 'hospitals') renderHospitals();
    renderEvents();
    renderMap();
  } catch (err) {
    if (showErr) alert(err.message);
  }
}

async function pollLogs() {
  if (!state.sessionToken) return;
  try {
    const url = `${state.apiBase}?action=logs&session_token=${encodeURIComponent(state.sessionToken)}&since_id=${state.logsLastId}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) return;
    const rows = data.logs || [];
    if (rows.length) {
      rows.forEach(r => pushLogRow(r));
      state.logsLastId = rows[rows.length - 1].id;
    }
  } catch {}
}

function toggleCollapse(node,state){
    node.classList.toggle("active");
    var content = node.nextElementSibling;
    status_visible[state] = content.style.display === "block"?false:true;
    content.style.display = content.style.display === "block"?"none":"block";
}

setInterval(fetchState, 3000);
setInterval(pollLogs, 2000);

fetchState(false);
pollLogs();
