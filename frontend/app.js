// frontend/app.js
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  apiBase: new URL("../backend/api.php", location.href).toString(),
  sessionToken: localStorage.getItem("sessionToken") || "",
  pin: localStorage.getItem("pin") || "",
  mapBounds: { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 },
  vehicles: [],
  events: [],
  hospitals: [],
  players: [],
  zoom: 1,
  pan: { x: 0, y: 0 },
  mapNatural: { w: 0, h: 0 },
  modId: null,
  logs: [],
  logSince: 0,
  highlightedEventId: null,
  highlightedVehicleId: null,
};

/* ============================ Event-Highlight ============================ */
function setHighlightedEvent(eventId) {
  const n = eventId == null ? null : Number(eventId);
  if (state.highlightedEventId === n) return;
  state.highlightedEventId = n;
  syncEventListHighlights();
  renderMap();
}
function syncEventListHighlights() {
  const id = state.highlightedEventId;
  $$("#eventsList .evt").forEach((item) => {
    const itemId = item.dataset.eventId
      ? parseInt(item.dataset.eventId, 10)
      : null;
    item.classList.toggle("highlighted", id != null && itemId === id);
  });
}
function findEventNearPointer(clientX, clientY, hitRadius = 12) {
  if (!state.events.length) return null;
  const pos = clientToCanvas(clientX, clientY);
  for (const ev of state.events) {
    const screen = toScreen(worldToCanvas(ev));
    const dx = screen.x - pos.x,
      dy = screen.y - pos.y;
    if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) return ev.id;
  }
  return null;
}

/* ============================ Fahrzeug-Highlight ============================ */
function setHighlightedVehicle(vehicleId) {
  const n = vehicleId == null ? null : Number(vehicleId);
  if (state.highlightedVehicleId === n) return;
  state.highlightedVehicleId = n;
  syncVehicleListHighlights();
  renderMap();
}
function syncVehicleListHighlights() {
  const id = state.highlightedVehicleId;
  $$("#vehiclesList .veh").forEach((item) => {
    const itemId = item.dataset.vid ? parseInt(item.dataset.vid, 10) : null;
    item.classList.toggle("highlighted", id != null && itemId === id);
  });
}
function findVehicleNearPointer(clientX, clientY, hitRadius = 10) {
  if (!state.vehicles.length) return null;
  const pos = clientToCanvas(clientX, clientY);
  for (const v of state.vehicles) {
    const screen = toScreen(worldToCanvas(v));
    const dx = screen.x - pos.x,
      dy = screen.y - pos.y;
    if (Math.sqrt(dx * dx + dy * dy) <= hitRadius) return v.id;
  }
  return null;
}

/* ============================ CSS-Var-Helfer (Karte) ============================ */
const cssVarCache = new Map();
function readCssVar(name) {
  if (!cssVarCache.has(name))
    cssVarCache.set(
      name,
      getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    );
  return cssVarCache.get(name);
}
const statusFillCache = new Map();
function getStatusFillColor(status) {
  const key = `status-${status}`;
  if (!statusFillCache.has(key))
    statusFillCache.set(
      key,
      readCssVar(`--status-${status}-start`) ||
        readCssVar("--good") ||
        "#16c98d",
    );
  return statusFillCache.get(key);
}
const getAccentColor = () => readCssVar("--accent") || "#5b9dff";
const getAccentOutlineColor = () => readCssVar("--accent-outline") || "#bcd2ff";
const getVehicleOutlineColor = () =>
  readCssVar("--vehicle-outline") || "#dfe7ff";
const getTextFillColor = () => readCssVar("--text") || "#e8eeff";

/* ============================ Settings / Token ============================ */
const _urlTok =
  new URLSearchParams(location.search).get("token") ||
  new URLSearchParams(location.search).get("session_token");
if (_urlTok) {
  $("#sessionToken").value = _urlTok;
  state.sessionToken = _urlTok;
  localStorage.setItem("sessionToken", _urlTok);
} else if (!$("#sessionToken").value) {
  $("#sessionToken").value = state.sessionToken;
}
function saveSettings() {
  state.sessionToken = $("#sessionToken").value.trim();
  state.pin = $("#pin").value.trim();
  localStorage.setItem("sessionToken", state.sessionToken);
  fetchState(true);
}
$("#saveSettings").addEventListener("click", saveSettings);
$("#reloadBtn").innerHTML = icon("reload");
$("#reloadBtn").addEventListener("click", () => fetchState(true));

// Natives Kontextmenü aus — Eingabefelder behalten es (Kopieren/Einfügen),
// der Karten-Rechtsklick (Einsatz anlegen) hat weiterhin seinen eigenen Handler.
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea")) return;
  e.preventDefault();
});

// Fahrzeug-Toolbar (Suche + Statusfilter)
const vehFilter = { q: "", status: "all" };
$("#vehSearch").addEventListener("input", (e) => {
  vehFilter.q = e.target.value;
  renderVehicles();
});
$("#vehStatusSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  vehFilter.status = b.dataset.f;
  $$("#vehStatusSeg button").forEach((x) =>
    x.classList.toggle("active", x === b),
  );
  renderVehicles();
});
let vehTab = "fw";
$("#vehTabs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  vehTab = b.dataset.tab;
  $$("#vehTabs button").forEach((x) => x.classList.toggle("active", x === b));
  renderVehicles();
});

/* ============================ Gutter-Resize ============================ */
const rootGrid = $("#grid");
const rowContainers = { left: $("#grid-left"), right: $("#grid-right") };
const rowState = { left: [1.4, 1], right: [0.82, 1.25] };
Object.keys(rowState).forEach(applyRowState);
let dragContext = null;
$("#gutter-col").addEventListener("mousedown", (evt) => {
  evt.preventDefault();
  if (!rootGrid) return;
  dragContext = { type: "col", container: rootGrid };
  rootGrid.classList.add("dragging");
});
$$(".gutter-row[data-grid-key]").forEach((g) =>
  g.addEventListener("mousedown", (evt) => {
    const key = g.dataset.gridKey,
      index = parseInt(g.dataset.trackIndex, 10);
    if (!key || Number.isNaN(index)) return;
    evt.preventDefault();
    startRowDrag(key, index, g);
  }),
);
function startRowDrag(key, index, gutter) {
  const container = rowContainers[key];
  if (!container) return;
  const prev = gutter.previousElementSibling,
    next = gutter.nextElementSibling;
  if (!prev || !next) return;
  dragContext = { type: "row", container, key, index, prev, next };
  container.classList.add("dragging");
}
function applyRowState(key) {
  const container = rowContainers[key];
  if (!container) return;
  const tracks = [];
  rowState[key].forEach((val, idx) => {
    if (idx) tracks.push("6px");
    tracks.push(`${val}fr`);
  });
  container.style.gridTemplateRows = tracks.join(" ");
}
window.addEventListener("mousemove", (e) => {
  if (!dragContext) return;
  if (dragContext.type === "col") {
    const rect = dragContext.container.getBoundingClientRect();
    const ratio = Math.min(
      0.85,
      Math.max(0.15, (e.clientX - rect.left) / rect.width),
    );
    dragContext.container.style.setProperty("--col1", `${ratio}fr`);
    dragContext.container.style.setProperty("--col2", `${1 - ratio}fr`);
    queueResize();
  } else if (dragContext.type === "row") {
    const prevRect = dragContext.prev?.getBoundingClientRect(),
      nextRect = dragContext.next?.getBoundingClientRect();
    if (!prevRect || !nextRect) return;
    const ratio = Math.min(
      0.85,
      Math.max(
        0.15,
        (e.clientY - prevRect.top) / (nextRect.bottom - prevRect.top),
      ),
    );
    const values = rowState[dragContext.key];
    if (!values || values[dragContext.index + 1] === undefined) return;
    const sum = values[dragContext.index] + values[dragContext.index + 1];
    values[dragContext.index] = sum * ratio;
    values[dragContext.index + 1] = sum * (1 - ratio);
    applyRowState(dragContext.key);
    queueResize();
  }
});
window.addEventListener("mouseup", () => {
  if (!dragContext) return;
  dragContext.container?.classList.remove("dragging");
  dragContext = null;
});

/* ============================ Karte (Canvas) ============================ */
const mapImg = $("#mapImage"),
  mapCanvas = $("#mapCanvas"),
  mapWrapper = $("#mapWrapper");
const ctx = mapCanvas.getContext("2d", { alpha: true });
let resizeQueued = false;
function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    resizeCanvas();
  });
}
mapImg.addEventListener("load", () => {
  state.mapNatural.w = mapImg.naturalWidth;
  state.mapNatural.h = mapImg.naturalHeight;
  queueResize();
});
mapImg.addEventListener("error", () =>
  console.warn("Map image failed to load"),
);
new ResizeObserver(() => queueResize()).observe(mapWrapper);
window.addEventListener("resize", queueResize);
function resizeCanvas() {
  const rect = mapWrapper.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  mapCanvas.style.width = rect.width + "px";
  mapCanvas.style.height = rect.height + "px";
  mapCanvas.width = Math.max(1, Math.floor(rect.width * ratio));
  mapCanvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  renderMap();
}
let isPanning = false,
  lastMouse = { x: 0, y: 0 };
mapWrapper.addEventListener("mousedown", (e) => {
  if (e.button === 0 && !e.shiftKey) {
    isPanning = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    setHighlightedEvent(null);
    setHighlightedVehicle(null);
  }
});
mapWrapper.addEventListener("mousemove", (e) => {
  if (isPanning) {
    state.pan.x += e.clientX - lastMouse.x;
    state.pan.y += e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
    renderMap();
    return;
  }
  // Einsätze haben Vorrang; sonst Fahrzeug unterm Zeiger hervorheben
  const evId = findEventNearPointer(e.clientX, e.clientY);
  setHighlightedEvent(evId);
  setHighlightedVehicle(
    evId == null ? findVehicleNearPointer(e.clientX, e.clientY) : null,
  );
});
window.addEventListener("mouseup", () => (isPanning = false));
mapWrapper.addEventListener("mouseleave", () => {
  if (!isPanning) {
    setHighlightedEvent(null);
    setHighlightedVehicle(null);
  }
});
mapWrapper.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const mouse = clientToCanvas(e.clientX, e.clientY);
    const preX = (mouse.x - state.pan.x) / state.zoom,
      preY = (mouse.y - state.pan.y) / state.zoom;
    const newZoom = Math.max(
      0.2,
      Math.min(4, state.zoom * Math.pow(1.0015, -e.deltaY)),
    );
    state.zoom = newZoom;
    state.pan.x = mouse.x - preX * state.zoom;
    state.pan.y = mouse.y - preY * state.zoom;
    renderMap();
  },
  { passive: false },
);
mapWrapper.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const pos = clientToWorld(e.clientX, e.clientY);
  const name = prompt("Name des neuen Einsatzes?", "Einsatz");
  if (!name) return;
  api("events_create", { name, x: pos.x, y: pos.y })
    .then(() => fetchState(true))
    .catch((err) => alert("Fehler: " + err.message));
});
mapWrapper.addEventListener("click", (e) => {
  const id = findEventNearPointer(e.clientX, e.clientY);
  if (!id) return;
  const ev = state.events.find((x) => x.id === id);
  if (ev) openAssignModal(ev);
});
function clientToCanvas(cx, cy) {
  const rect = mapCanvas.getBoundingClientRect();
  return { x: cx - rect.left, y: cy - rect.top };
}
function clientToWorld(cx, cy) {
  const c = clientToCanvas(cx, cy);
  const w = (c.x - state.pan.x) / state.zoom,
    h = (c.y - state.pan.y) / state.zoom,
    d = imageDrawRect();
  const nx = (w - d.x) / d.w,
    ny = (h - d.y) / d.h;
  return {
    x:
      state.mapBounds.min_x +
      nx * (state.mapBounds.max_x - state.mapBounds.min_x),
    y: -(
      state.mapBounds.min_y +
      ny * (state.mapBounds.max_y - state.mapBounds.min_y)
    ),
  };
}
function worldToCanvas(pt) {
  const nx =
    (pt.x - state.mapBounds.min_x) /
    (state.mapBounds.max_x - state.mapBounds.min_x || 1);
  const ny =
    (-pt.y - state.mapBounds.min_y) /
    (state.mapBounds.max_y - state.mapBounds.min_y || 1);
  const d = imageDrawRect();
  return { x: d.x + nx * d.w, y: d.y + ny * d.h };
}
function toScreen(p) {
  return {
    x: p.x * state.zoom + state.pan.x,
    y: p.y * state.zoom + state.pan.y,
  };
}
function imageDrawRect() {
  const cw = mapCanvas.clientWidth,
    ch = mapCanvas.clientHeight;
  const iw = state.mapNatural.w || cw,
    ih = state.mapNatural.h || ch;
  const cr = cw / ch,
    ir = iw / ih;
  if (ir > cr) {
    const w = cw,
      h = cw / ir;
    return { x: 0, y: (ch - h) / 2, w, h };
  }
  const h = ch,
    w = ch * ir;
  return { x: (cw - w) / 2, y: 0, w, h };
}
function renderMap() {
  const ratio = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  ctx.save();
  ctx.scale(ratio, ratio);
  ctx.translate(state.pan.x, state.pan.y);
  ctx.scale(state.zoom, state.zoom);
  const d = imageDrawRect();
  if (state.mapNatural.w && state.mapNatural.h)
    ctx.drawImage(mapImg, d.x, d.y, d.w, d.h);
  const fontSize = Math.min(12 / (0.75 * state.zoom), 12);
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  const accentColor = getAccentColor(),
    accentOutline = getAccentOutlineColor(),
    vehicleOutline = getVehicleOutlineColor(),
    textFill = getTextFillColor();
  const placed = [],
    pad = 3;
  const intersects = (a, b) =>
    !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  const canPlace = (r) => placed.every((p) => !intersects(p, r));
  for (const ev of state.events) {
    const p = worldToCanvas(ev),
      isHi = state.highlightedEventId === ev.id;
    const baseRadius = Math.min(10 / state.zoom, 10),
      radius = isHi ? baseRadius * 1.4 : baseRadius;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.lineWidth = (isHi ? 3 : 2) / state.zoom;
    ctx.strokeStyle = isHi ? "#fff" : accentOutline;
    ctx.stroke();
    const text = ev.name || "Einsatz",
      tw = ctx.measureText(text).width,
      th = fontSize,
      lx = p.x + radius + 2,
      ly = p.y + radius / 2 - 1;
    ctx.lineWidth = 3 / state.zoom;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = textFill;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.strokeText(text, lx, ly);
    ctx.fillText(text, lx, ly);
    const s = toScreen({ x: lx, y: ly - th });
    placed.push({
      x: s.x - pad,
      y: s.y - pad,
      w: tw * state.zoom + 2 * pad,
      h: th * state.zoom + 2 * pad,
    });
  }
  const nodeOffset = Math.min(8 / state.zoom, 8);
  for (const v of state.vehicles) {
    const p = worldToCanvas(v);
    const isHi = state.highlightedVehicleId === v.id;
    const off = isHi ? nodeOffset * 1.45 : nodeOffset;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - off);
    ctx.lineTo(p.x + off, p.y);
    ctx.lineTo(p.x, p.y + off);
    ctx.lineTo(p.x - off, p.y);
    ctx.closePath();
    ctx.fillStyle = getStatusFillColor(v.status);
    ctx.fill();
    ctx.lineWidth = (isHi ? 2.5 : 1.5) / state.zoom;
    ctx.strokeStyle = isHi ? "#fff" : vehicleOutline;
    ctx.stroke();
    // Status 2 (frei auf Wache) bleibt unbeschriftet — außer beim Hervorheben
    if (v.status == 2 && !isHi) continue;
    const text = v.name || v.type || v.game_vehicle_id || `#${v.id}`,
      tw = ctx.measureText(text).width,
      th = fontSize;
    const candidates = [
      { dx: 0, dy: -fontSize - nodeOffset + 2 },
      { dx: 0, dy: fontSize + nodeOffset + 2 },
      { dx: -tw + nodeOffset, dy: fontSize / 2 },
      { dx: nodeOffset + tw / 2 + 2, dy: fontSize / 2 },
    ];
    for (const c of candidates) {
      const lx = p.x + c.dx,
        ly = p.y + c.dy;
      const rectScreen = {
        x: (lx - tw / 2) * state.zoom + state.pan.x - pad,
        y: (ly - th) * state.zoom + state.pan.y - pad,
        w: tw * state.zoom + 2 * pad,
        h: th * state.zoom + 2 * pad,
      };
      if (canPlace(rectScreen)) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineWidth = 3 / state.zoom;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.fillStyle = textFill;
        ctx.strokeText(text, lx, ly);
        ctx.fillText(text, lx, ly);
        ctx.restore();
        placed.push(rectScreen);
        break;
      }
    }
  }
  ctx.restore();
}

/* ============================ Helfer: Status / Gruppen ============================ */
function renderState(status, cls_nr = -1, title = "") {
  const n = cls_nr == null || cls_nr == -1 ? status : cls_nr;
  const cls = Number.isFinite(+n) ? `status-${n}` : "status-unknown";
  return `<span class="st ${cls}"${title ? ` title="${title}"` : ""}>${status}</span>`;
}
function stationKey(v) {
  const gid = v.game_vehicle_id || "";
  const sep = gid.includes("_") ? "_" : "-";
  return gid.includes(sep) ? gid.split(sep)[0] : "?";
}
const STATION_LABELS = {
  0: "Boote",
  1: "FuRW 1",
  2: "FuRW 2",
  3: "FuRW 3",
  4: "FuRW 4",
  11: "Löschzug 11",
  31: "Löschzug 31",
  72: "RW 72",
  74: "RW 74",
  Christoph: "Luftrettung",
  FS: "Sperrungen",
  "?": "Weitere Einheiten",
};
function stationLabel(k) {
  return STATION_LABELS[k] || "Gruppe " + k;
}
// Feste Spalten-Zuordnung je Tab (Reihenfolge = Spalten links->rechts, Gruppen innerhalb untereinander)
const COLUMN_LAYOUT = {
  fw: [["1", "11"], ["2", "31"], ["3", "0"], ["4"]],
  rd: [["1", "Christoph"], ["2", "72"], ["3", "74"], ["4"]],
};
// FMS-Semantik: Frei = 1,2 | Im Einsatz = 3,4,7 | Status 6 = weder/noch (nur unter "Alle")
const FREE_STATUS = new Set([1, 2]);
const DEPLOYED_STATUS = new Set([3, 4, 7]);
function isFree(v) {
  return FREE_STATUS.has(+v.status);
}
function isDeployed(v) {
  return DEPLOYED_STATUS.has(+v.status);
}

// Nicht trackbare Pseudo-Fahrzeuge (Typ-Alarm/Infrastruktur) -> nicht in der Liste anzeigen
const UNTRACKED = new Set(["TD", "FuSTW", "ASF", "BSW", "JA"]);
function isTrackable(v) {
  const gid = v.game_vehicle_id || "";
  return !UNTRACKED.has(gid) && !/^FS[_-]/.test(gid);
}
// Kategorie fuer die Tabs: Rettungsdienst (RTW/NEF/… + Luftrettung) vs. Feuerwehr (Rest)
function vehicleCategory(v) {
  const c = vehicleCategoryIcon(v);
  return c === "medical" || c === "helicopter" ? "rd" : "fw";
}
function vehTypeLabel(v) {
  const parts = (v.game_vehicle_id || "").split(/[_-]/);
  return parts.length >= 3 ? parts.slice(1, -1).join("-") : v.type || "";
}

/* ============================ Fahrzeugliste ============================ */
const vehOpen = {};
function vehicleCardHTML(v) {
  const actions =
    v.status == 3
      ? `<button class="icon-btn sm ghost" title="Einrücken" onclick='sendHome(${v.id}).then(()=>fetchState(false))'>${icon("home")}</button>`
      : "";
  const hl = state.highlightedVehicleId === v.id ? " highlighted" : "";
  return `<div class="veh${v.status == 5 ? " talkwish" : ""}${hl}" data-vid="${v.id}" title="${v.name || v.game_vehicle_id} · Status ${v.status}">${renderState(v.status)}<span class="vn">${v.name || v.game_vehicle_id}</span><span class="vend">${actions}</span></div>`;
}
function groupHTML(k, vs) {
  const open = vehOpen[k] !== false;
  return `<details class="vgroup"${open ? " open" : ""} data-k="${k}">
    <summary>${icon("chevron", "chev")}<span class="gname">${stationLabel(k)}</span></summary>
    <div class="vlist">${vs.map(vehicleCardHTML).join("")}</div>
  </details>`;
}
function renderVehicles() {
  const c = $("#vehiclesList");
  const q = vehFilter.q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (v) => {
    if (!isTrackable(v)) return false;
    if (vehicleCategory(v) !== vehTab) return false;
    if (vehFilter.status === "free" && !isFree(v)) return false;
    if (vehFilter.status === "deployed" && !isDeployed(v)) return false;
    if (!q.length) return true;
    const hay =
      `${v.name || ""} ${v.game_vehicle_id || ""} ${vehTypeLabel(v)} ${stationLabel(stationKey(v))}`.toLowerCase();
    return q.every((t) => hay.includes(t));
  };
  const groups = {};
  for (const v of state.vehicles) {
    if (!match(v)) continue;
    const k = stationKey(v);
    (groups[k] || (groups[k] = [])).push(v);
  }
  const allKeys = Object.keys(groups);
  if (!allKeys.length) {
    c.innerHTML = `<div style="color:var(--muted);padding:8px">Keine Fahrzeuge.</div>`;
    return;
  }
  // Feste Spalten-Zuordnung (stabil beim Ein-/Ausklappen); unbekannte Gruppen werden verteilt.
  const layout = COLUMN_LAYOUT[vehTab] || [allKeys];
  const cols = layout.map((colKeys) => colKeys.filter((k) => groups[k]));
  const placed = new Set(layout.flat());
  allKeys
    .filter((k) => !placed.has(k))
    .forEach((k, i) => cols[i % cols.length].push(k));
  const nonEmpty = cols.filter((cc) => cc.length);
  c.innerHTML = nonEmpty
    .map(
      (colKeys) =>
        `<div class="vcol">${colKeys.map((k) => groupHTML(k, groups[k])).join("")}</div>`,
    )
    .join("");
  c.querySelectorAll(".vgroup").forEach((d) =>
    d.addEventListener("toggle", () => {
      vehOpen[d.dataset.k] = d.open;
    }),
  );
  c.querySelectorAll(".veh[data-vid]").forEach((el) => {
    el.addEventListener("mouseenter", () =>
      setHighlightedVehicle(parseInt(el.dataset.vid, 10)),
    );
    el.addEventListener("mouseleave", () => setHighlightedVehicle(null));
  });
}
async function sendHome(vehicle_id) {
  await api("events_unassign", { vehicle_ids: [vehicle_id] });
}

/* ============================ Krankenhäuser ============================ */
function renderHospitals() {
  const c = $("#hospitalsList");
  const col = (r) =>
    r >= 50 ? "var(--good)" : r >= 20 ? "var(--warn)" : "var(--bad)";
  c.innerHTML =
    state.hospitals
      .map((h) => {
        const wf = h.ward_total
          ? Math.round((100 * h.ward_available) / h.ward_total)
          : 0;
        const cf = h.icu_total
          ? Math.round((100 * h.icu_available) / h.icu_total)
          : 0;
        return `<div class="hosp">
      <div class="hname">${icon("hospital")}${h.name || "Krankenhaus"}</div>
      <div class="hrow"><span class="hk">Station</span><div class="bar"><i style="width:${wf}%;background:${col(wf)}"></i></div><span class="hv">${h.ward_available}/${h.ward_total}</span></div>
      <div class="hrow"><span class="hk">Intensiv</span><div class="bar"><i style="width:${cf}%;background:${col(cf)}"></i></div><span class="hv">${h.icu_available}/${h.icu_total}</span></div>
    </div>`;
      })
      .join("") || `<div style="color:var(--muted)">Keine Krankenhäuser.</div>`;
}

/* ============================ Einsätze ============================ */
const difference = (a, b) => new Set([...a].filter((x) => !b.has(x)));
let phoneSound = new Audio("./assets/phone.wav");
let lastEvents = new Set();
function eventForID(id) {
  return state.events.find((ev) => ev.id == id);
}
// Einsatzart -> Farbe + Icon (nach Name erkannt)
const EVENT_TYPES = [
  {
    key: "fire",
    re: /brand|feuer|rauch|explos|dachstuhl|zimmerbr|bma|schornstein|flamm|verbrenn/i,
    color: "var(--bad)",
    icon: "fire",
  },
  {
    key: "medical",
    re: /person in not|bewusstlos|herz|reanim|verletzt|kollaps|sturz|internist|medizin|notfall|geburt|kreislauf|atemnot/i,
    color: "var(--good)",
    icon: "medical",
  },
  {
    key: "th",
    re: /unfall|eingeklemmt|ölspur|oelspur|baum|wasser|technisch|tier|absicher|hochwasser|sturm|verkehr|bus|lkw/i,
    color: "var(--warn)",
    icon: "axe",
  },
];
function eventType(ev) {
  const n = ev.name || "";
  for (const t of EVENT_TYPES) if (t.re.test(n)) return t;
  return { key: "other", color: "var(--accent)", icon: "warning" };
}
function renderEvents() {
  const c = $("#eventsList");
  const sorted = [...state.events].sort((a, b) => a.id - b.id);
  const events = new Set();
  c.innerHTML =
    sorted
      .map((ev) => {
        events.add(ev.id);
        const hl = state.highlightedEventId === ev.id ? " highlighted" : "";
        const t = eventType(ev);
        return `<div class="evt${hl}" data-event-id="${ev.id}" style="border-left-color:${t.color}">
      <div class="eico" style="--ec:${t.color}">${icon(t.icon)}</div>
      <div class="ebody">
        <div class="et">${ev.name}</div>
        <div class="em"><span>${icon("pin")}${Math.round(ev.x)}, ${Math.round(ev.y)}</span><span>#${ev.id} · ${ev.status}</span></div>
      </div>
      <div class="eact">
        ${ev.created_by === "frontend" ? `<button class="icon-btn sm ok" data-act="finish" title="Erledigt">${icon("check")}</button>` : ""}
      </div>
    </div>`;
      })
      .join("") || `<div style="color:var(--muted)">Keine Einsätze.</div>`;
  sorted.forEach((ev) => {
    const el = c.querySelector(`.evt[data-event-id="${ev.id}"]`);
    if (!el) return;
    const fin = el.querySelector('[data-act="finish"]');
    if (fin)
      fin.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Einsatz als erledigt markieren?")) return;
        try {
          await api("events_finish", { event_id: ev.id });
          fetchState(true);
        } catch (err) {
          alert("Fehler: " + err.message);
        }
      });
    el.addEventListener("click", () => openAssignModal(ev));
    el.addEventListener("mouseenter", () => setHighlightedEvent(ev.id));
    el.addEventListener("mouseleave", () => setHighlightedEvent(null));
  });
  if (
    state.highlightedEventId &&
    !sorted.some((ev) => ev.id === state.highlightedEventId)
  )
    state.highlightedEventId = null;
  let play = false;
  Array.from(difference(events, lastEvents))
    .map(eventForID)
    .forEach((e) => {
      if (e && e.created_by == "game") play = true;
    });
  if (play) {
    phoneSound.load();
    phoneSound.play().catch(() => {});
  }
  lastEvents = events;
}

/* ============================ Alarmierungsfenster ============================ */
const modal = $("#assignModal");
let modalEvent = null;
$("#closeAssign").addEventListener("click", () => {
  modal.classList.add("hidden");
  sendNotesAsync(modalEvent);
});
// Distanz-Sortierung umschaltbar; Einstellung bleibt gespeichert
$("#assignSortDist").checked = localStorage.getItem("assignSortDist") !== "0";
$("#assignSortDist").addEventListener("change", (e) => {
  localStorage.setItem("assignSortDist", e.target.checked ? "1" : "0");
  renderList(false);
});
$("#submitAssign").addEventListener("click", submitAssign);
document.addEventListener("keyup", (e) => {
  if (modal.classList.contains("hidden")) return;
  if (e.code === "Escape") {
    modal.classList.add("hidden");
    sendNotesAsync(modalEvent);
  } else if (e.code === "Enter") submitAssign();
});

function buildDropdown(modeStr, id, selected) {
  if (!modeStr) return "";
  const opts = modeStr
    .split(",")
    .map((m) => `<option${m === selected ? " selected" : ""}>${m}</option>`)
    .join("");
  return `<span class="amodes"><select data-vid="${id}" id="${id}_mode">${opts}</select></span>`;
}
// Luftlinie Fahrzeug -> Einsatzort in Metern (10 Spieleinheiten ≈ 1 m); null = Position unbekannt
function distToEvent(v, ev) {
  if (!ev) return null;
  const x = +v.x,
    y = +v.y;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x <= -900000 ||
    y <= -900000
  )
    return null;
  return Math.hypot(x - ev.x, y - ev.y) / 10;
}
function fmtDist(d) {
  return d >= 1000
    ? (d / 1000).toFixed(1).replace(".", ",") + " km"
    : Math.round(d) + " m";
}
function assignRowHTML(v, checked, mode) {
  const d = distToEvent(v, modalEvent);
  return `<label class="acheck">
    <span class="arow">
      <input type="checkbox" value="${v.id}"${checked ? " checked" : ""}>
      ${renderState(v.status)}
      <span class="an">${v.name || v.game_vehicle_id}</span>
      ${d != null ? `<span class="adist" title="Luftlinie zum Einsatzort">${fmtDist(d)}</span>` : ""}
    </span>
    ${buildDropdown(v.modes, v.id, mode)}
  </label>`;
}
function renderList(first = false) {
  const cont = $("#assignVehicles"),
    selection = $("#selectedVehicles");
  const prevChecked = first
    ? new Set()
    : new Set(
        Array.from(cont.querySelectorAll("input[type=checkbox]:checked")).map(
          (b) => +b.value,
        ),
      );
  const prevModes = {};
  cont.querySelectorAll("select").forEach((s) => {
    prevModes[+s.dataset.vid] = s.value;
  });
  const term = $("#assignSearch").value.trim().toLowerCase();
  const matches = (v) => {
    if (!term) return true;
    const label =
      `${v.name || ""} ${v.type || ""} ${v.game_vehicle_id || ""} ${v.id}`.toLowerCase();
    return term
      .split(/\s+/)
      .filter(Boolean)
      .every((t) => label.includes(t));
  };
  const base = state.vehicles.filter(
    (v) => (v.status == 1 || v.status == 2) && matches(v),
  );
  const groups = {},
    order = [];
  for (const v of base) {
    const k = stationKey(v);
    if (!groups[k]) {
      groups[k] = [];
      order.push(k);
    }
    groups[k].push(v);
  }
  // Innerhalb jeder Wache: nächstes Fahrzeug zuerst, ohne Position ans Ende (abschaltbar)
  if ($("#assignSortDist").checked) {
    for (const k of order)
      groups[k].sort((a, b) => {
        const da = distToEvent(a, modalEvent),
          db = distToEvent(b, modalEvent);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      });
  }
  cont.innerHTML =
    order
      .map(
        (k) =>
          `<details class="vgroup" open><summary>${icon("chevron", "chev")}<span class="gname">${stationLabel(k)}</span><span class="count">${groups[k].length}</span></summary>
      <div class="vlist">${groups[k].map((v) => assignRowHTML(v, prevChecked.has(v.id), prevModes[v.id])).join("")}</div></details>`,
      )
      .join("") ||
    `<div style="color:var(--muted);padding:6px">Keine passenden Kräfte.</div>`;
  cont
    .querySelectorAll("input[type=checkbox]")
    .forEach((b) => b.addEventListener("change", updateChosen));
  updateChosen();
  function updateChosen() {
    const chosen = Array.from(
      cont.querySelectorAll("input[type=checkbox]:checked"),
    );
    selection.innerHTML = chosen
      .map((b) => {
        const v = state.vehicles.find((x) => x.id == +b.value);
        return `<span class="u">${v ? v.name || v.game_vehicle_id : "#" + b.value}<button data-vid="${b.value}">×</button></span>`;
      })
      .join("");
    selection.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", () => {
        const cb = cont.querySelector(`input[value="${btn.dataset.vid}"]`);
        if (cb) {
          cb.checked = false;
          updateChosen();
        }
      }),
    );
  }
}
async function loadAssignedVehiclesAsync(ev) {
  const sel = $("#assignAssignedVehicles");
  sel.innerHTML = "lädt…";
  try {
    const r = await api("events_get_vehicles", { event_id: ev.id });
    sel.innerHTML =
      (r.vehicles || [])
        .map(
          (v) =>
            `<div class="acheck" style="cursor:default">${renderState(v.status)}<span class="an">${v.name || v.game_vehicle_id}</span></div>`,
        )
        .join("") || `<div style="color:var(--muted2);font-size:12px">—</div>`;
  } catch {
    sel.innerHTML = "";
  }
}
async function loadNotesAsync(ev) {
  const sel = $("#assignEventComments");
  try {
    const r = await api("events_get_note", { event_id: ev.id });
    sel.value = (r.notes || []).map((e) => e.content).join("\n");
  } catch {
    sel.value = "";
  }
}
async function sendNotesAsync(ev) {
  if (!ev) return;
  try {
    await api("events_set_note", {
      event_id: ev.id,
      content: $("#assignEventComments").value,
    });
  } catch {}
}
function openAssignModal(ev) {
  modalEvent = ev;
  $("#assignEventInfo").innerHTML =
    `${ev.name} <span class="mhinfo">#${ev.id} · (${Math.round(ev.x)}, ${Math.round(ev.y)})</span>`;
  loadAssignedVehiclesAsync(ev);
  loadNotesAsync(ev);
  const sel = $("#assignPlayer");
  sel.innerHTML = '<option value="">— Alle / Host —</option>';
  for (const p of state.players) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name || p.player_id || "Spieler #" + p.id;
    sel.appendChild(o);
  }
  const sbox = $("#assignSearch");
  sbox.value = "";
  sbox.oninput = () => renderList(false);
  renderList(true);
  modal.classList.remove("hidden");
  sbox.focus();
}
async function submitAssign() {
  const cont = $("#assignVehicles");
  const boxes = Array.from(
    cont.querySelectorAll("input[type=checkbox]:checked"),
  );
  if (!boxes.length) {
    alert("Mindestens eine Kraft auswählen");
    return;
  }
  const vehicle_ids = boxes.map((b) => parseInt(b.value, 10));
  const player_id = $("#assignPlayer").value
    ? parseInt($("#assignPlayer").value, 10)
    : null;
  const modes = {};
  cont.querySelectorAll("select").forEach((s) => {
    const id = parseInt(s.dataset.vid, 10);
    if (vehicle_ids.includes(id)) modes[id] = s.value;
  });
  try {
    sendNotesAsync(modalEvent);
    await api("events_assign", {
      event_id: modalEvent.id,
      vehicle_ids,
      player_id,
      modes,
    });
    modal.classList.add("hidden");
    fetchState(true);
  } catch (err) {
    alert("Fehler beim Alarmieren: " + err.message);
  }
}

/* ============================ Log (Sprechwünsche | Statusverlauf) ============================ */
let talkLog = []; // Sprechwünsche (Fahrzeug -> Leitstelle)
let statusLog = []; // Statusverlauf: verfolgte Statuswechsel + sonstige Meldungen
let prevStatus = {}; // game_vehicle_id -> letzter Status

function isSprechwunsch(row) {
  return (
    (row.message && /sprechwunsch/i.test(row.message)) ||
    /sprechwunsch/i.test(row.long_message || "")
  );
}
function fmtTime(t) {
  return new Date(t).toLocaleTimeString();
}

function trackStatusChanges(vehicles) {
  const now = {};
  for (const v of vehicles) {
    now[v.game_vehicle_id] = v.status;
    const old = prevStatus[v.game_vehicle_id];
    if (old !== undefined && old !== v.status)
      statusLog.unshift({
        time: Date.now(),
        kind: "status",
        name: v.name || v.game_vehicle_id,
        from: old,
        to: v.status,
      });
  }
  prevStatus = now;
  if (statusLog.length > 120) statusLog.length = 120;
}
function renderTalkLog() {
  const c = $("#talkLog");
  c.innerHTML = talkLog
    .map((e) => {
      const v = state.vehicles.find(
        (x) => x.game_vehicle_id === e.entity || x.name === e.entity,
      );
      const ev = v && v.event_id != null ? eventForID(v.event_id) : null;
      return `<div class="row talk">
    <span class="time">${fmtTime(e.time)}</span>
    <span class="lentity">${(v && v.name) || e.entity}</span>
    <span class="lmsg">${renderState(5)}</span>
    <span class="lact">
      ${ev ? `<button class="icon-btn sm" title="Einsatz öffnen: ${ev.name}" onclick='openEventById(${ev.id})'>${icon("paperplane")}</button>` : ""}
      <button class="icon-btn sm ok" title="Quittieren" onclick='dismissTalk(${e.id})'>${icon("check")}</button>
    </span></div>`;
    })
    .join("");
}
function openEventById(id) {
  const ev = eventForID(id);
  if (ev) openAssignModal(ev);
}
function renderStatusLog() {
  const c = $("#statusLog");
  c.innerHTML = statusLog
    .map((e) =>
      e.kind === "status"
        ? `<div class="row"><span class="time">${fmtTime(e.time)}</span><span class="lentity">${e.name}</span><span class="lmsg">${renderState(e.to)}</span></div>`
        : `<div class="row"><span class="time">${fmtTime(e.time)}</span><span class="lmsg">${e.text}</span></div>`,
    )
    .join("");
}
function dismissTalk(id) {
  talkLog = talkLog.filter((e) => e.id !== id);
  renderTalkLog();
  fetch(
    `${state.apiBase}?action=log_viewed&session_token=${encodeURIComponent(state.sessionToken)}&mid=${id}`,
  ).catch(() => {});
}
/* ============================ Spiel-Zustände (Sperrungen etc.) ============================ */
// Der Mod meldet Sperrungen/Lagen als Meldung mit state active (an) / disabled (aufgehoben).
const GAME_STATE_TOPICS = [
  {
    key: "ship",
    re: /schiffsverkehr/i,
    emoji: "🚢",
    label: "Schiffsverkehr gesperrt",
  },
  {
    key: "tram",
    re: /tramverkehr/i,
    emoji: "🚊",
    label: "Tramverkehr gesperrt",
  },
  { key: "rail", re: /zugverkehr/i, emoji: "🚆", label: "Zugverkehr gesperrt" },
  { key: "alarmstufe", re: /alarmstufe/i, emoji: "🚨", label: "Alarmstufe" },
  {
    key: "rmk",
    re: /rettungsmittelknappheit/i,
    emoji: "🚑",
    label: "Rettungsmittelknappheit",
  },
  { key: "na", re: /notarzt/i, emoji: "🩺", label: "Notarztreduzierung" },
];
const gameStates = {}; // key -> {active, time}
function updateGameStates(row) {
  const text = `${row.long_message || ""} ${row.message || ""}`;
  for (const t of GAME_STATE_TOPICS) {
    if (!t.re.test(text)) continue;
    const off =
      row.state === "disabled" || /aufgehoben|freigegeben/i.test(text);
    gameStates[t.key] = {
      active: !off,
      time: Date.parse(row.updated_at) || Date.now(),
    };
    return;
  }
}
function renderGameStates() {
  const c = $("#game-states");
  c.innerHTML = GAME_STATE_TOPICS.filter((t) => gameStates[t.key]?.active)
    .map(
      (t) =>
        `<span class="gstate" data-k="${t.key}" title="Seit ${fmtTime(gameStates[t.key].time)} · Klick zum Ausblenden">${t.emoji} ${t.label}</span>`,
    )
    .join("");
  c.querySelectorAll(".gstate").forEach((el) =>
    el.addEventListener("click", () => {
      gameStates[el.dataset.k].active = false;
      renderGameStates();
    }),
  );
}

/* ============================ Statistik ============================ */
// Patientenaufnahmen als Betten-Proxy: jedes Absinken der freien Betten zählt als Aufnahme.
// Wird pro Session im localStorage mitgezählt (zählt nur, solange die Leitstelle offen ist).
function admissionsKey() {
  return `admissions_${state.sessionToken}`;
}
function trackAdmissions(hospitals) {
  if (!state.sessionToken || !hospitals.length) return;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(admissionsKey())) || {};
  } catch {}
  saved.count = saved.count || 0;
  saved.beds = saved.beds || {};
  for (const h of hospitals) {
    const id = h.game_hospital_id || h.name || h.id;
    const free = (+h.icu_available || 0) + (+h.ward_available || 0);
    const prev = saved.beds[id];
    if (prev != null && free < prev) saved.count += prev - free;
    saved.beds[id] = free;
  }
  try {
    localStorage.setItem(admissionsKey(), JSON.stringify(saved));
  } catch {}
}
function admissionCount() {
  try {
    return (JSON.parse(localStorage.getItem(admissionsKey())) || {}).count || 0;
  } catch {
    return 0;
  }
}

const statsModal = $("#statsModal");
$("#statsBtn").addEventListener("click", openStats);
$("#closeStats").addEventListener("click", () =>
  statsModal.classList.add("hidden"),
);
document.addEventListener("keyup", (e) => {
  if (e.code === "Escape" && !statsModal.classList.contains("hidden"))
    statsModal.classList.add("hidden");
});
async function openStats() {
  statsModal.classList.remove("hidden");
  const body = $("#statsBody");
  body.innerHTML = `<div style="color:var(--muted);padding:20px">lädt…</div>`;
  try {
    const url = `${state.apiBase}?action=stats&session_token=${encodeURIComponent(state.sessionToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Statistik nicht verfügbar");
    body.innerHTML = renderStats(data);
  } catch (err) {
    body.innerHTML = `<div style="color:var(--bad);padding:20px">Fehler: ${err.message}</div>`;
  }
}
function parseTs(s) {
  return s ? Date.parse(String(s).replace(" ", "T")) || null : null;
}
// Zeitpunkt eines Events in ms: bevorzugt den Unix-Timestamp vom Server (zeitzonensicher),
// fällt sonst auf das Parsen des Datums-Strings zurück.
function evTs(e, k) {
  const n = e[k + "_ts"];
  return n != null ? n * 1000 : parseTs(e[k + "_at"]);
}
function isDone(e) {
  return e.status === "completed" || e.status === "finished";
}
const EVENT_TYPE_LABELS = {
  fire: "Brand",
  medical: "Rettungsdienst",
  th: "Technische Hilfe",
  other: "Sonstige",
};
function fmtDur(mins) {
  if (!Number.isFinite(mins)) return "–";
  return mins < 90
    ? Math.round(mins) + " min"
    : (mins / 60).toFixed(1).replace(".", ",") + " h";
}
function barRows(rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    rows
      .map(
        (r) =>
          `<div class="srow"><span class="sk" title="${r.label}">${r.label}</span><div class="bar"><i style="width:${Math.round((100 * r.count) / max)}%;background:${r.color}"></i></div><span class="sv">${r.count}</span></div>`,
      )
      .join("") ||
    `<div style="color:var(--muted2);font-size:12px">Noch keine Daten.</div>`
  );
}
function svgHistogram(buckets, color) {
  const max = Math.max(1, ...buckets);
  const W = 480,
    H = 130,
    padL = 6,
    padR = 6,
    padT = 16,
    padB = 16;
  const bw = (W - padL - padR) / buckets.length;
  let out = `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" class="sv-base"/>`;
  buckets.forEach((v, h) => {
    const x = padL + h * bw;
    if (v) {
      const bh = Math.max(3, ((H - padT - padB) * v) / max),
        y = H - padB - bh;
      out += `<rect x="${(x + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"><title>${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59 Uhr · ${v} Einsätze</title></rect>`;
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="sv-num">${v}</text>`;
    }
    if (h % 6 === 0)
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="sv-ax">${String(h).padStart(2, "0")}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="shist" role="img" aria-label="Einsätze nach Uhrzeit">${out}</svg>`;
}
function renderStats(data) {
  const events = data.events || [];
  const done = events.filter(isDone),
    active = events.filter((e) => !isDone(e));

  // Einsatzarten (Erkennung wie in der Einsatzliste)
  const typeCounts = { fire: 0, medical: 0, th: 0, other: 0 };
  for (const e of events) typeCounts[eventType(e).key]++;
  const typeRows = Object.entries(typeCounts)
    .filter(([, c]) => c > 0)
    .map(([k, c]) => ({
      label: EVENT_TYPE_LABELS[k],
      count: c,
      color: (
        EVENT_TYPES.find((t) => t.key === k) || { color: "var(--accent)" }
      ).color,
    }))
    .sort((a, b) => b.count - a.count);

  // Aufkommen nach Uhrzeit (Anlagezeit, reale Zeit)
  const buckets = new Array(24).fill(0);
  for (const e of events) {
    const t = evTs(e, "created");
    if (t != null) buckets[new Date(t).getHours()]++;
  }

  // Ø Dauer abgeschlossener Einsätze
  const durs = done
    .map((e) => {
      const a = evTs(e, "created"),
        b = evTs(e, "updated");
      return a != null && b != null && b > a ? (b - a) / 60000 : null;
    })
    .filter((d) => d != null);
  const avgDur = durs.length
    ? durs.reduce((s, d) => s + d, 0) / durs.length
    : NaN;

  const topVeh = (data.alarms || [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((a) => ({
      label: a.name || a.game_vehicle_id,
      count: a.count,
      color: "var(--accent)",
    }));

  const kpi = (v, l) => `<div class="skpi"><b>${v}</b><span>${l}</span></div>`;
  return `
    <div class="stats-kpis">
      ${kpi(events.length, "Einsätze gesamt")}
      ${kpi(active.length, "Aktiv")}
      ${kpi(done.length, "Abgeschlossen")}
      ${kpi(fmtDur(avgDur), "Ø Einsatzdauer")}
      ${kpi(admissionCount(), "Patientenaufnahmen")}
      ${kpi(data.talk_count ?? 0, "Sprechwünsche")}
    </div>
    <div class="stats-grid">
      <div class="schart"><h4>Einsatzarten</h4>${barRows(typeRows)}</div>
      <div class="schart"><h4>Meist alarmierte Fahrzeuge</h4>${barRows(topVeh)}</div>
      <div class="schart wide"><h4>Einsätze nach Uhrzeit</h4>${svgHistogram(buckets, "var(--accent)")}
        <div class="snote">Patientenaufnahmen werden aus der Bettenbelegung abgeleitet und nur gezählt, solange die Leitstelle geöffnet ist.</div>
      </div>
    </div>`;
}

/* ============================ API / Polling ============================ */
async function api(action, payload = {}, method = "POST") {
  const url = `${state.apiBase}?action=${encodeURIComponent(action)}`;
  const add = { session_token: state.sessionToken };
  if (state.pin) add.pin = state.pin;
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({}, payload, add)),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function fetchState(showErr) {
  if (!state.sessionToken) return;
  try {
    const url = `${state.apiBase}?action=state&session_token=${encodeURIComponent(state.sessionToken)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load state");
    state.mapBounds = data.session.map_bounds;
    state.players = data.players || [];
    state.vehicles = data.vehicles || [];
    state.events = data.events || [];
    state.hospitals = data.hospitals || [];
    const newMod = data.session.mod_id || null;
    if (state.modId !== newMod) {
      state.modId = newMod;
      if (state.modId)
        $("#mapImage").src =
          `${state.apiBase}?action=map_image&session_token=${encodeURIComponent(state.sessionToken)}`;
    }
    if (data.time)
      $("#time-panel").textContent =
        String(data.time.time_hours).padStart(2, "0") +
        ":" +
        String(data.time.time_minutes).padStart(2, "0");
    trackStatusChanges(state.vehicles);
    trackAdmissions(state.hospitals);
    // Sprechwuensche verwerfen, deren Fahrzeug nicht mehr existiert (z.B. nach Session-Reset)
    talkLog = talkLog.filter((e) =>
      state.vehicles.some(
        (x) => x.game_vehicle_id === e.entity || x.name === e.entity,
      ),
    );
    renderVehicles();
    renderHospitals();
    renderEvents();
    renderMap();
    renderStatusLog();
    renderTalkLog();
  } catch (err) {
    if (showErr) alert(err.message);
  }
}
let messageSound = new Audio("./assets/Alarm.wav");
async function pollLogs() {
  if (!state.sessionToken) return;
  try {
    const url = `${state.apiBase}?action=logs&session_token=${encodeURIComponent(state.sessionToken)}&since=${state.logSince}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) return;
    const rows = data.logs || [];
    if (!rows.length) return;
    const newStamp = rows[rows.length - 1]["updated_at"];
    if (newStamp == state.logSince) return;
    state.logSince = newStamp;
    let gotTalk = false;
    for (const row of rows) {
      updateGameStates(row);
      if (isSprechwunsch(row)) {
        if (!talkLog.some((e) => e.id === row.id)) {
          talkLog.unshift({
            id: row.id,
            time: Date.parse(row.updated_at) || Date.now(),
            entity: row.entity_id,
            text: row.long_message,
          });
          gotTalk = true;
        }
      } else {
        statusLog.unshift({
          time: Date.parse(row.updated_at) || Date.now(),
          kind: "msg",
          text: row.long_message || row.message,
        });
      }
    }
    if (statusLog.length > 120) statusLog.length = 120;
    if (gotTalk) {
      messageSound.load();
      messageSound.play().catch(() => {});
    }
    renderTalkLog();
    renderStatusLog();
    renderGameStates();
  } catch (ex) {
    console.log(ex);
  }
}

setInterval(fetchState, 3000);
setInterval(pollLogs, 2000);
fetchState(false);
pollLogs();
