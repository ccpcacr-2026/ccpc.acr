/**
 * Bus Tracking UI Component
 * Real-time bus positions, geofence alerts, ETA tracking via Leaflet map
 */

let map = null;
let busMarkers = {};
let allBusData = {};      // imei -> latest bus object, independent of map/selection state
let selectedImeis = new Set(); // which buses are checked "visible" in the fleet list
let geofenceCircles = {};
let busUpdateInterval = null;
let selectedBusImei = null;
let hasFittedOnce = false;
// Follow mode: tapping a bus isolates it (every other pin hidden) and
// re-centers the map on it every time a new position arrives, not just
// once at selection time — see redrawMarkers. _preFollowSelectedImeis
// remembers what was checked before so exitFollowMode can restore it
// instead of just dumping the user back to an empty map.
let _followImei = null;
let _preFollowSelectedImeis = null;

const BUS_SVG = '<svg viewBox="0 0 24 24"><path d="M18 11h-1V7c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v10h1c0 1.1.9 2 2 2s2-.9 2-2h6c0 1.1.9 2 2 2s2-.9 2-2h1v-4c0-1.1-.9-2-2-2zM6 18c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm11 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-7H5V7h11v4z"/></svg>';

// One id per browser tab, reused across polls (so the server counts this
// tab once, not once per poll) but distinct from any other tab/device —
// backs the "N watching" live-viewer count in the toolbar.
const trackerId = sessionStorage.getItem('_bt_tid') || 'w' + Math.random().toString(36).slice(2, 10);
sessionStorage.setItem('_bt_tid', trackerId);

// Best-effort display label sent alongside every heartbeat so an Admin can
// see WHO is watching, not just a count — client-supplied (not looked up
// server-side), since this is a convenience display, not an access-control
// surface. Falls back gracefully if login data isn't in the expected shape.
const watcherLabel = (() => {
  try {
    const name = (window._loginProfile && window._loginProfile.full_name) || (window.APP_USER && window.APP_USER.user_id) || 'Staff';
    const role = window.ACTIVE_ROLE || window.USER_ROLE || '';
    return role ? `${name} (${role})` : String(name);
  } catch (e) { return 'Staff'; }
})();
let currentWatchers = []; // latest [{label, lastSeen}] from the server, for the popover

/**
 * Initialize Leaflet map
 */
function initBusMap() {
  const mapContainer = document.getElementById('bus-map-container');
  if (!mapContainer) return;

  // `map` persists across re-entries into the Bus Tracker view (only built
  // once, guarded below), but hasFittedOnce gated the auto-fit to a single
  // page-session-wide fire — so clicking away and back skipped it on every
  // visit after the first. Resetting here makes every fresh click into Bus
  // Tracker fit-all again on its next successful data load.
  hasFittedOnce = false;

  // Default center (Dhaka, Bangladesh)
  const defaultLat = 23.8103;
  const defaultLng = 90.4125;

  if (!map) {
    // attributionControl:false + a hand-added one below (prefix:false) drops
    // Leaflet's own "Leaflet 🇺🇦" self-promo link — OpenStreetMap's own
    // attribution stays (required by their tile usage policy; only the
    // library's own branding is optional).
    // zoomControl:false — Leaflet auto-adds its own default zoom control
    // (topleft) unless told not to; we add our own custom-positioned one
    // below, and without this both end up on the map at once.
    map = L.map('bus-map-container', { attributionControl: false, zoomControl: false }).setView([defaultLat, defaultLng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);

    // bottomleft, not the default topright — on mobile the toolbar floats
    // over the top of the map (see ensureSheetHandle/CSS), which would sit
    // on top of a topright zoom control.
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    const fitBtn = document.createElement('button');
    fitBtn.className = 'bt-fit-btn';
    fitBtn.title = 'Fit all';
    fitBtn.innerHTML = '<i data-lucide="maximize" class="h-3.5 w-3.5"></i><span class="bt-fit-label"> Fit all</span>';
    fitBtn.onclick = fitBusesInBounds;
    mapContainer.appendChild(fitBtn);
    if (window.lucide) lucide.createIcons();

    // Mobile bottom-sheet UX: tapping the map (not a marker/control) collapses
    // the fleet sheet down to its peek bar, giving the map the full screen.
    map.on('click', collapseFleetSheet);
  }

  ensureFleetListHead();
  ensureSheetHandle();
  loadBusTrackingConfig();
}

/**
 * Drag-handle grip pinned above the fleet list, for tapping the sheet back
 * closed on mobile (desktop hides it via CSS — the sidebar there is always
 * open, no sheet behavior at all). Inserted once from JS rather than the
 * host page's static markup so this file stays a single drop-in include.
 */
function ensureSheetHandle() {
  const sidebar = document.getElementById('bus-sidebar');
  if (!sidebar || document.getElementById('bt-sheet-handle')) return;
  const handle = document.createElement('div');
  handle.id = 'bt-sheet-handle';
  handle.className = 'bt-sheet-handle';
  handle.innerHTML = `<div class="bt-sheet-grip"></div>`;
  handle.onclick = toggleFleetSheet;
  sidebar.insertBefore(handle, sidebar.firstChild);
}

/**
 * On mobile the collapsed sheet is fully off-screen (see .bt-collapsed in
 * CSS) — #bt-fleet-toggle is the one thing that stays reachable, appearing
 * only while the sheet is closed. Desktop never shows it (CSS: display:none
 * outside the max-width:767px block) since the sidebar there is never
 * collapsed in the first place.
 */
function toggleFleetSheet() {
  const sidebar = document.getElementById('bus-sidebar');
  if (sidebar) sidebar.classList.contains('bt-collapsed') ? expandFleetSheet() : collapseFleetSheet();
}
function collapseFleetSheet() {
  const sidebar = document.getElementById('bus-sidebar');
  const toggle = document.getElementById('bt-fleet-toggle');
  if (sidebar) sidebar.classList.add('bt-collapsed');
  if (toggle) toggle.classList.add('bt-visible');
}
function expandFleetSheet() {
  const sidebar = document.getElementById('bus-sidebar');
  const toggle = document.getElementById('bt-fleet-toggle');
  if (sidebar) sidebar.classList.remove('bt-collapsed');
  if (toggle) toggle.classList.remove('bt-visible');
}

/**
 * Insert the "Fleet · All · None" header above the bus list once — done in
 * JS rather than the host page's static markup so this file stays a single
 * drop-in include (same pattern the map's own Fit-all button already uses).
 */
function ensureFleetListHead() {
  const list = document.getElementById('bus-list');
  if (!list || document.getElementById('bt-fleet-head')) return;
  const head = document.createElement('div');
  head.id = 'bt-fleet-head';
  head.className = 'bt-fleet-head';
  head.innerHTML = `
    <span class="bt-fleet-title">Fleet <span class="bt-fleet-count" id="bt-fleet-count">0</span></span>
    <div class="bt-fleet-actions">
      <button type="button" onclick="selectAllBuses()">All</button>
      <button type="button" onclick="selectNoneBuses()">None</button>
    </div>
  `;
  list.parentElement.insertBefore(head, list);
}

/**
 * Load bus registry and place registry from portal settings
 */
async function loadBusTrackingConfig() {
  try {
    const response = await portalFetch('get_tracking_config', {});

    if (response.busRegistry) {
      window.busRegistry = response.busRegistry;
    }

    if (response.placeRegistry) {
      response.placeRegistry.forEach(place => {
        const [name, coordsStr, radius] = place;
        try {
          const [lat, lng] = coordsStr.split(',').map(s => parseFloat(s.trim()));
          if (!isNaN(lat) && !isNaN(lng)) {
            addGeofenceCircle(name, lat, lng, parseInt(radius) || 100);
          }
        } catch (e) {
          console.warn('Failed to parse geofence coords:', coordsStr);
        }
      });
    }

    startBusTracking();
  } catch (err) {
    console.error('Failed to load tracking config:', err);
  }
}

/**
 * Add geofence circle to map
 */
function addGeofenceCircle(name, lat, lng, radius) {
  if (geofenceCircles[name]) {
    map.removeLayer(geofenceCircles[name]);
  }

  const circle = L.circle([lat, lng], {
    color: '#2563eb',
    fillColor: '#3b82f6',
    fillOpacity: 0.1,
    weight: 2,
    radius: radius, // meters
  }).addTo(map);

  circle.bindPopup(`<strong>${name}</strong><br/>Radius: ${radius}m`);
  geofenceCircles[name] = circle;
}

/**
 * Start polling for bus positions
 */
function startBusTracking() {
  updateBusPositions();
  if (busUpdateInterval) clearInterval(busUpdateInterval);
  busUpdateInterval = setInterval(updateBusPositions, 8000);
}

/**
 * Update bus positions from API
 */
async function updateBusPositions() {
  try {
    const response = await portalFetch('get_bus_data', { tracker_id: trackerId, label: watcherLabel });

    const watchingEl = document.getElementById('bt-watching-count');
    if (watchingEl && typeof response.trackers === 'number') watchingEl.textContent = response.trackers;
    if (Array.isArray(response.watchers)) {
      currentWatchers = response.watchers;
      const popover = document.getElementById('bt-watchers-popover');
      if (popover && !popover.classList.contains('hidden')) renderWatchersList();
    }

    if (!response.data || !Array.isArray(response.data)) {
      console.warn('Invalid bus data response');
      return;
    }

    // New buses default to visible/checked; buses no longer in the registry
    // lose their marker and drop out of the list entirely.
    const incomingImeis = new Set();
    response.data.forEach(bus => {
      incomingImeis.add(bus.imei);
      if (!allBusData[bus.imei]) selectedImeis.add(bus.imei);
      allBusData[bus.imei] = bus;
    });
    Object.keys(allBusData).forEach(imei => {
      if (!incomingImeis.has(imei)) {
        delete allBusData[imei];
        selectedImeis.delete(imei);
        removeMarker(imei);
      }
    });

    redrawMarkers();
    updateBusList(Object.values(allBusData));

    // Fit the map to wherever the buses actually are on the very first
    // successful load — the map's default view is a generic city center,
    // not the school's actual location, so real bus positions can easily
    // fall outside it (list populates fine either way; only the map looks
    // empty). After this first fit the user's own pan/zoom is left alone.
    if (!hasFittedOnce && Object.keys(busMarkers).length) {
      hasFittedOnce = true;
      fitBusesInBounds();
    }

    const timeEl = document.getElementById('bus-data-timestamp');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.error('Failed to update bus positions:', err);
  }
}

/**
 * Build the pulsing gradient marker icon used both on the map and (larger) when selected
 */
function busMarkerIcon(bus, selected) {
  const mv = !!bus.isMoving;
  const color = mv ? '#2563eb' : '#f59e0b';
  const dark = mv ? '#1d4ed8' : '#b45309';
  const size = selected ? 40 : 32;
  const pulse = mv ? `<div class="bt-marker-pulse" style="border-color:${color}"></div>` : '';

  return L.divIcon({
    className: '',
    html: `<div class="bt-marker-wrap">
      ${pulse}
      <div class="bt-marker-circle" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,${color},${dark})">${BUS_SVG}</div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function busName(imei) {
  if (window.busRegistry && Array.isArray(window.busRegistry)) {
    // Registry rows are [name, plate_number, imei] — imei is index 2, not 1
    // (it used to be a 2-element [name, imei] row before the Number Plate
    // column was added; this lookup broke silently until fixed here).
    const found = window.busRegistry.find(b => b[2] === imei);
    if (found) return found[0];
  }
  return imei;
}

function removeMarker(imei) {
  if (busMarkers[imei]) { map.removeLayer(busMarkers[imei]); delete busMarkers[imei]; }
}

/**
 * Create/update/remove every bus's marker to match selectedImeis — the
 * single place that reconciles "what's checked" with "what's on the map".
 */
function redrawMarkers() {
  // While Route History is open the 30s poll would otherwise keep calling
  // this and silently re-adding every live pin right back — so this has
  // to be checked here, not just in _hideLiveBusMarkers's one-off sweep.
  if (_liveMarkersHidden) { Object.keys(busMarkers).forEach(imei => removeMarker(imei)); return; }
  Object.keys(allBusData).forEach(imei => {
    const bus = allBusData[imei];
    if (!selectedImeis.has(imei)) { removeMarker(imei); return; }
    if (isNaN(bus.lat) || isNaN(bus.lng)) return;

    const selected = selectedBusImei === imei;
    const icon = busMarkerIcon(bus, selected);
    const label = `<b>${busName(imei)}</b> · ${bus.isMoving ? `${Math.round(bus.speed) || 0} km/h` : 'Idle'}`;

    if (busMarkers[imei]) {
      busMarkers[imei].setLatLng([bus.lat, bus.lng]);
      busMarkers[imei].setIcon(icon);
      busMarkers[imei].setTooltipContent(label);
      if (_followImei === imei) {
        map.panTo([bus.lat, bus.lng]);
        renderFollowCard(bus);
      }
    } else {
      const marker = L.marker([bus.lat, bus.lng], { icon }).addTo(map);
      marker.bindTooltip(label, { permanent: true, direction: 'top', className: 'bt-marker-label', offset: [0, selected ? -22 : -18] });
      // Leaflet markers bubble clicks to the map by default — without
      // stopping it here, this click would also fire map.on('click',
      // collapseFleetSheet) right after selectBus() expands the sheet,
      // instantly collapsing it again (looks like marker taps do nothing).
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectBus(imei, allBusData[imei]);
      });
      busMarkers[imei] = marker;
    }
    busMarkers[imei].busData = bus; // kept for CSV export

    checkGeofenceEvents(bus);
  });
}

/**
 * Check if bus entered/exited geofences
 */
function checkGeofenceEvents(bus) {
  const { imei, lat, lng } = bus;
  if (!window.busRegistry || !Array.isArray(window.busRegistry)) return;

  const name = busName(imei);

  Object.entries(geofenceCircles).forEach(([geoName, geoCircle]) => {
    const geoLatLng = geoCircle.getLatLng();
    const distance = geoLatLng.distanceTo(L.latLng(lat, lng));
    const radius = geoCircle.getRadius();

    const wasInside = geoCircle._busWasInside || false;
    const isInside = distance <= radius;

    if (isInside && !wasInside) showGeofenceAlert(`${name} entered ${geoName}`, 'success');
    if (!isInside && wasInside) showGeofenceAlert(`${name} exited ${geoName}`, 'warning');

    geoCircle._busWasInside = isInside;
  });
}

/**
 * Show geofence alert toast
 */
function showGeofenceAlert(message, type = 'success') {
  const alertsContainer = document.getElementById('geofenceAlerts');
  if (!alertsContainer) return;

  const alert = document.createElement('div');
  alert.className = `alert alert-${type}`;
  alert.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-close';
  close.innerHTML = '&times;';
  close.onclick = () => alert.remove();
  alert.appendChild(close);

  alertsContainer.insertBefore(alert, alertsContainer.firstChild);

  setTimeout(() => { if (alert.parentElement) alert.remove(); }, 5000);
}

/**
 * Update bus list in sidebar
 */
function updateBusList(buses) {
  const listContainer = document.getElementById('bus-list');
  if (!listContainer) return;

  const countEl = document.getElementById('bt-fleet-count');
  if (countEl) countEl.textContent = buses.length;
  const toolbarCountEl = document.getElementById('bt-toolbar-count');
  if (toolbarCountEl) toolbarCountEl.textContent = buses.length;
  const toggleCountEl = document.getElementById('bt-fleet-toggle-count');
  if (toggleCountEl) toggleCountEl.textContent = buses.length;

  if (!buses.length) {
    listContainer.innerHTML = `<div class="bt-empty"><i data-lucide="alert-circle" class="h-6 w-6"></i>No buses configured yet</div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Numeric-aware sort ("Bus 2" before "Bus 10") rather than API/registry order.
  const sortedBuses = [...buses].sort((a, b) =>
    busName(a.imei).localeCompare(busName(b.imei), undefined, { numeric: true, sensitivity: 'base' })
  );

  listContainer.innerHTML = sortedBuses.map(bus => {
    const name = busName(bus.imei);
    const mv = !!bus.isMoving;
    const isSelected = selectedBusImei === bus.imei;
    const isChecked = selectedImeis.has(bus.imei);
    const spd = Math.round(parseFloat(bus.speed)) || 0;
    const addr = (bus.address || 'Locating…');

    return `
      <div class="bt-list-item ${isSelected ? 'active' : ''} ${isChecked ? '' : 'dimmed'}" title="${bus.imei}" onclick='selectBus(${JSON.stringify(bus.imei)}, ${JSON.stringify(bus)})'>
        <div class="flex items-center gap-2">
          <input class="bt-check" type="checkbox" ${isChecked ? 'checked' : ''}
                 style="width:15px!important;height:15px!important;min-width:15px!important;flex-shrink:0;accent-color:#2563eb!important;cursor:pointer"
                 onclick="event.stopPropagation()" onchange='toggleBusVisibility(${JSON.stringify(bus.imei)}, this.checked)'>
          <div class="bt-avatar ${mv ? 'moving' : 'idle'}"><i data-lucide="bus" class="h-3 w-3"></i></div>
          <div class="flex-1 min-w-0 text-xs font-black text-slate-800 truncate">${name}</div>
          <div class="bt-dot ${mv ? 'moving' : 'idle'}"></div>
        </div>
        <div class="bt-list-meta"><span class="spd ${mv ? 'moving' : 'idle'}">${mv ? `${spd} km/h` : 'Idle'}</span><span class="sep">·</span><span class="bt-addr">${addr}</span></div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

/**
 * Checkbox toggle for one bus's map visibility
 */
function toggleBusVisibility(imei, checked) {
  if (checked) selectedImeis.add(imei);
  else {
    selectedImeis.delete(imei);
    if (selectedBusImei === imei) exitFollowMode();
  }
  redrawMarkers();
  updateBusList(Object.values(allBusData));
}

function selectAllBuses() {
  exitFollowMode();
  Object.keys(allBusData).forEach(imei => selectedImeis.add(imei));
  redrawMarkers();
  updateBusList(Object.values(allBusData));
  fitBusesInBounds();
}

function selectNoneBuses() {
  exitFollowMode();
  selectedImeis.clear();
  redrawMarkers();
  updateBusList(Object.values(allBusData));
}

function closeBusDetails() {
  selectedBusImei = null;
  const panel = document.getElementById('bus-info-panel');
  if (panel) {
    panel.innerHTML = `<div class="bt-info-empty"><i data-lucide="bus" class="h-4 w-4"></i>Select a bus to view details</div>`;
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Turns off follow mode — restores whichever buses were checked before
 * following started (not just clearing to none, which would leave the
 * map blank) and removes the floating card.
 */
function exitFollowMode() {
  if (_followImei === null) { closeBusDetails(); return; }
  if (_preFollowSelectedImeis) selectedImeis = _preFollowSelectedImeis;
  _followImei = null;
  _preFollowSelectedImeis = null;
  closeBusDetails();
  const card = document.getElementById('bt-follow-card');
  if (card) card.remove();
  const toggle = document.getElementById('bt-fleet-toggle');
  if (toggle) toggle.style.display = '';
  redrawMarkers();
  updateBusList(Object.values(allBusData));
}

/**
 * Select a bus, isolate it on the map (every other pin hidden), and
 * follow it — the map re-centers on it every time a fresh position
 * comes in (see redrawMarkers), not just once here.
 */
function selectBus(imei, busData) {
  selectedBusImei = imei;

  if (_followImei !== imei) {
    if (_followImei === null) _preFollowSelectedImeis = new Set(selectedImeis);
    _followImei = imei;
    selectedImeis = new Set([imei]);
    redrawMarkers();
  }

  if (busMarkers[imei]) {
    busMarkers[imei].setIcon(busMarkerIcon(busData, true));
    map.panTo(busMarkers[imei].getLatLng());
  }

  updateBusInfoPanel(busData);
  renderFollowCard(busData);
  updateBusList(Object.values(allBusData));
  // Collapse the fleet sheet instead of expanding it — the whole point of
  // follow mode is a clear, unobstructed view of the map with just the
  // small floating card, not the full bottom sheet covering half the
  // screen (which is what tapping a bus used to open on mobile). The
  // "N buses" toggle pill normally shown while collapsed would otherwise
  // sit right underneath the follow card, so it's hidden too.
  collapseFleetSheet();
  const toggle = document.getElementById('bt-fleet-toggle');
  if (toggle) toggle.style.display = 'none';
}

/**
 * The follow-mode details card floated directly on the map (see
 * #bt-follow-card in _src/styles.css for the semi-transparent/blurred
 * styling) — created once per selection, then just refreshed in place on
 * every subsequent poll tick from redrawMarkers so it stays live while
 * following, without needing to re-click the bus.
 */
function renderFollowCard(bus) {
  const mapContainer = document.getElementById('bus-map-container');
  if (!mapContainer || _followImei !== bus.imei) return;
  let card = document.getElementById('bt-follow-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'bt-follow-card';
    mapContainer.appendChild(card);
  }
  const name = busName(bus.imei);
  const mv = !!bus.isMoving;
  const spd = Math.round(parseFloat(bus.speed)) || 0;
  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px">
      <div style="font-weight:900;font-size:11px;color:#1e293b;line-height:1.2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
      <button type="button" onclick="exitFollowMode()" title="Stop following" style="width:16px;height:16px;border-radius:999px;border:none;background:rgba(15,23,42,0.1);color:#475569;font-size:10px;line-height:1;cursor:pointer;flex-shrink:0">✕</button>
    </div>
    <div style="margin-top:2px"><span style="padding:1.5px 6px;border-radius:999px;font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;${mv ? 'background:rgba(37,99,235,0.15);color:#2563eb' : 'background:rgba(180,83,9,0.15);color:#b45309'}">${mv ? 'Moving' : 'Idle'}</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px">
      <div>
        <div style="font-size:7px;font-weight:800;color:#94a3b8;text-transform:uppercase">Speed</div>
        <div style="font-size:10px;font-weight:900;color:#1e293b">${spd} km/h</div>
      </div>
      <div>
        <div style="font-size:7px;font-weight:800;color:#94a3b8;text-transform:uppercase">Engine</div>
        <div style="font-size:10px;font-weight:900;color:#1e293b">${bus.engine ? 'On' : 'Off'}</div>
      </div>
    </div>
    <div style="display:flex;align-items:flex-start;gap:4px;margin-top:5px;font-size:8px;font-weight:700;color:#475569;line-height:1.3"><i data-lucide="map-pin" style="width:9px;height:9px;color:#2563eb;flex-shrink:0;margin-top:1px"></i><span>${bus.address || 'Locating…'}</span></div>
  `;
  if (window.lucide) lucide.createIcons();
}

/**
 * Update bus info panel with details
 */
function updateBusInfoPanel(bus) {
  const panel = document.getElementById('bus-info-panel');
  if (!panel) return;

  const name = busName(bus.imei);
  const mv = !!bus.isMoving;
  const spd = Math.round(parseFloat(bus.speed)) || 0;
  const etaHtml = calculateETA(bus);

  panel.innerHTML = `
    <div class="bt-info-card">
      <div class="bt-info-head">
        <div>
          <div class="text-sm font-black text-slate-800">${name}</div>
          <div class="text-[10px] text-slate-400 font-bold">${bus.imei}</div>
        </div>
        <div class="bt-badge ${mv ? 'moving' : 'idle'}">${mv ? 'Moving' : 'Idle'}</div>
      </div>
      <div class="bt-info-body">
        <div class="grid grid-cols-2 gap-2">
          <div class="bt-stat">
            <div class="bt-stat-label">Speed</div>
            <div class="bt-stat-val">${spd} km/h</div>
          </div>
          <div class="bt-stat">
            <div class="bt-stat-label">Engine</div>
            <div class="bt-stat-val">${bus.engine ? 'On' : 'Off'}</div>
          </div>
        </div>
        <div class="bt-info-addr"><i data-lucide="map-pin" class="h-3.5 w-3.5 text-blue-600"></i>${bus.address || 'Locating…'}</div>
        ${etaHtml}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

/**
 * Calculate ETA to nearest geofence
 */
function calculateETA(bus) {
  if (!bus.isMoving) return '';

  let nearest = null;
  let minDistance = Infinity;

  Object.entries(geofenceCircles).forEach(([name, circle]) => {
    const latLng = circle.getLatLng();
    const distance = latLng.distanceTo(L.latLng(bus.lat, bus.lng));
    if (distance < minDistance) {
      minDistance = distance;
      nearest = { name, distance };
    }
  });

  if (!nearest || nearest.distance <= 100) return '';

  const speedMs = bus.speed / 3.6;
  const etaMinutes = Math.round((nearest.distance / speedMs) / 60);

  return `<div class="bt-eta"><span><i data-lucide="navigation" class="h-3 w-3 inline"></i> ETA to ${nearest.name}</span><span>${etaMinutes} min · ${(nearest.distance / 1000).toFixed(1)} km</span></div>`;
}

/**
 * Fit all currently visible (checked) buses in map bounds
 */
function fitBusesInBounds() {
  if (Object.keys(busMarkers).length === 0) return;
  const group = new L.featureGroup(Object.values(busMarkers));
  map.fitBounds(group.getBounds().pad(0.1));
}

/**
 * Stop tracking
 */
function stopBusTracking() {
  if (busUpdateInterval) {
    clearInterval(busUpdateInterval);
    busUpdateInterval = null;
  }
}

/**
 * Export bus data as CSV
 */
function exportBusData() {
  if (!Object.keys(busMarkers).length) {
    alert('No bus data to export');
    return;
  }

  const buses = Object.values(busMarkers);
  const headers = ['Bus Name', 'IMEI', 'Latitude', 'Longitude', 'Speed (km/h)', 'Status', 'Address'];
  const rows = buses.map(marker => {
    const bus = marker.busData || {};
    return [
      busName(bus.imei),
      bus.imei,
      bus.lat,
      bus.lng,
      Math.round(parseFloat(bus.speed)) || 0,
      bus.isMoving ? 'Moving' : 'Stationary',
      bus.address,
    ];
  });

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bus-tracking-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Recalculate the map's size after its container becomes visible.
 * The map is initialized inside a hidden tab-pane (display:none), so Leaflet
 * sizes it 0x0; without this call the map stays gray when the tab opens.
 */
function refreshMapSize() {
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

/**
 * Full teardown — used when the map's container div is about to be removed
 * from the DOM (e.g. navigating to a different view in a single-page host),
 * so a later initBusMap() call creates a fresh Leaflet instance instead of
 * silently no-op'ing on the (now-detached) old one.
 */
function resetBusMap() {
  stopBusTracking();
  if (map) { try { map.remove(); } catch (_) {} }
  map = null;
  busMarkers = {};
  allBusData = {};
  selectedImeis = new Set();
  geofenceCircles = {};
  selectedBusImei = null;
  hasFittedOnce = false;
  _followImei = null;
  _preFollowSelectedImeis = null;
  const head = document.getElementById('bt-fleet-head');
  if (head) head.remove();
  const handle = document.getElementById('bt-sheet-handle');
  if (handle) handle.remove();
}

/**
 * Admin-only "who's watching" popover — toggled by clicking the "N
 * watching" text in the toolbar (only rendered clickable for Admin /
 * Student Portal Admin, see loadAdminBusTrackerView's canExportBuses gate).
 */
function renderWatchersList() {
  const popover = document.getElementById('bt-watchers-popover');
  if (!popover) return;
  if (!currentWatchers.length) {
    popover.innerHTML = `<div style="font-size:11px;font-weight:800;color:#94a3b8;text-align:center;padding:10px 4px;">No one else is watching right now.</div>`;
    return;
  }
  popover.innerHTML = `
    <div style="font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;padding:2px 4px 8px;">Currently watching</div>
    ${currentWatchers.map(w => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-top:1px solid #f1f5f9;">
        <span style="width:7px;height:7px;border-radius:999px;background:#22c55e;flex-shrink:0;"></span>
        <span style="font-size:11.5px;font-weight:700;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtmlBt(w.label || 'Viewer')}</span>
      </div>`).join('')}
  `;
}
function escapeHtmlBt(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _closeWatchersListOnOutsideClick(e) {
  const popover = document.getElementById('bt-watchers-popover');
  const trigger = document.getElementById('bt-watchers-trigger');
  if (!popover || popover.classList.contains('hidden')) { document.removeEventListener('click', _closeWatchersListOnOutsideClick); return; }
  if (popover.contains(e.target) || (trigger && trigger.contains(e.target))) return;
  popover.classList.add('hidden');
  document.removeEventListener('click', _closeWatchersListOnOutsideClick);
}
function toggleWatchersList() {
  const popover = document.getElementById('bt-watchers-popover');
  if (!popover) return;
  const opening = popover.classList.contains('hidden');
  popover.classList.toggle('hidden');
  if (opening) {
    renderWatchersList();
    setTimeout(() => document.addEventListener('click', _closeWatchersListOnOutsideClick), 0);
  } else {
    document.removeEventListener('click', _closeWatchersListOnOutsideClick);
  }
}

/**
 * Route History (admin only) — plots where a bus actually drove on one day,
 * from student.bus_location_history (the same table the background poller
 * already writes a point to every ~30s a bus moves >20m; only a rolling 3
 * days is kept — see get_bus_route_history / the poller's own cleanup).
 * No separate "journey" storage needed since every ping is already saved.
 */
let routePolylines = [];
let routeMarkers = [];

// Speed buckets for the multicolor route line — same GPS speed field
// already shown elsewhere, just bucketed here to make jams/waits jump out
// visually instead of reading as a single flat-colored path.
const ROUTE_SPEED_BUCKETS = [
  { max: 2, color: '#6b7280', label: 'Waiting/Stopped (≤2 km/h)' },
  { max: 10, color: '#ef4444', label: 'Jam (3–10 km/h)' },
  { max: 20, color: '#f97316', label: 'Slow (11–20 km/h)' },
  { max: 30, color: '#eab308', label: 'Moderate (21–30 km/h)' },
  { max: Infinity, color: '#22c55e', label: 'Fast (31+ km/h)' },
];
function _routeSpeedColor(spd) {
  const s = Math.round(parseFloat(spd)) || 0;
  return (ROUTE_SPEED_BUCKETS.find(b => s <= b.max) || ROUTE_SPEED_BUCKETS[ROUTE_SPEED_BUCKETS.length - 1]).color;
}
// Compass bearing (0=N, 90=E) from one [lat,lng] to the next — fallback
// for points whose reported `heading` is missing/blank.
function _bearingBetween(a, b) {
  const [lat1, lng1] = a, [lat2, lng2] = b;
  if (lat1 === lat2 && lng1 === lng2) return null;
  const toRad = d => d * Math.PI / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function toggleRoutePanel() {
  const panel = document.getElementById('bt-route-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    renderRouteBusOptions();
    _hideLiveBusMarkers();
  } else {
    clearRouteHistory();
    _showLiveBusMarkers();
  }
}

// Route history and the live fleet's own moving pins fighting for the
// same map at once is just clutter — the live pins hide the moment the
// Route panel opens and come back exactly as they were (redrawMarkers
// reconciles from selectedImeis, so no separate "what was showing"
// bookkeeping is needed here) once the route/panel is gone.
let _liveMarkersHidden = false;
function _hideLiveBusMarkers() {
  _liveMarkersHidden = true;
  Object.keys(busMarkers).forEach(imei => removeMarker(imei));
}
function _showLiveBusMarkers() {
  _liveMarkersHidden = false;
  redrawMarkers();
}

function renderRouteBusOptions() {
  const sel = document.getElementById('bt-route-bus');
  if (!sel || sel.options.length) return; // populate once; allBusData is stable enough for a picker
  const buses = Object.values(allBusData).sort((a, b) => busName(a.imei).localeCompare(busName(b.imei), undefined, { numeric: true }));
  sel.innerHTML = buses.map(b => `<option value="${b.imei}">${busName(b.imei)}</option>`).join('');
  const dateInput = document.getElementById('bt-route-date');
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
}

async function showRouteHistory() {
  const imei = document.getElementById('bt-route-bus')?.value;
  const date = document.getElementById('bt-route-date')?.value;
  const status = document.getElementById('bt-route-status');
  if (!imei || !date) return;
  if (status) status.textContent = 'Loading…';
  clearRouteHistory();
  try {
    const res = await portalFetch('get_bus_route_history', { imei, date });
    if (!res || res.result !== 'success') { if (status) status.textContent = (res && res.message) || 'Failed to load.'; return; }
    const points = (res.points || []).filter(p => p.lat && p.lng);
    if (!points.length) { if (status) status.textContent = 'No route data for that day (only the last 3 days are kept).'; return; }
    const latlngs = points.map(p => [p.lat, p.lng]);
    // One short polyline segment per gap between consecutive points, each
    // colored by the speed at its starting point — a single flat-colored
    // line can't show where the bus was crawling/jammed/waiting along the
    // way, only where it went.
    // Slow/jam/waiting segments are drawn last (on top) — at low zoom
    // (whole-day routes cover a wide area, so fitBounds zooms well out)
    // short segments can sit almost on top of their neighbors, and a
    // solid run of fast/green segments would otherwise visually bury the
    // one red/gray blip that's actually the interesting part.
    const bucketIndexOf = spd => { const s = Math.round(parseFloat(spd)) || 0; return ROUTE_SPEED_BUCKETS.findIndex(b => s <= b.max); };
    const segOrder = points.map((_, i) => i).slice(0, -1)
      .sort((a, b) => bucketIndexOf(points[b].speed) - bucketIndexOf(points[a].speed));
    for (const i of segOrder) {
      const seg = L.polyline([latlngs[i], latlngs[i + 1]], { color: _routeSpeedColor(points[i].speed), weight: 6, opacity: 1 }).addTo(map);
      seg.bindTooltip(`${Math.round(parseFloat(points[i].speed)) || 0} km/h · ${points[i].location_time}`, { sticky: true });
      routePolylines.push(seg);
    }
    // Colored dots at every point too — guarantees the speed coloring
    // reads clearly even where segments are too short to see as a line at
    // the route's overall zoom level (dense clusters of pings while
    // waiting/idling, in particular).
    points.forEach((p, i) => {
      const dot = L.circleMarker(latlngs[i], { radius: 3.5, color: '#fff', weight: 1, fillColor: _routeSpeedColor(p.speed), fillOpacity: 1 }).addTo(map);
      routePolylines.push(dot);
    });
    // Direction arrows along the route — "smart" in that the stride
    // between arrows scales with how many points the day has, so a short
    // hop gets a few arrows and a long day-long route doesn't get
    // cluttered with one every ~30s. Bearing prefers the bus's own
    // reported heading (compass-accurate at low speed, where consecutive
    // GPS fixes are too close together to derive a reliable bearing from)
    // and only falls back to the two-point bearing when heading is
    // missing.
    const arrowStride = Math.max(1, Math.round(latlngs.length / 20));
    for (let i = 0; i < latlngs.length - 1; i += arrowStride) {
      const bearing = (points[i].heading !== null && points[i].heading !== undefined && points[i].heading !== '')
        ? Number(points[i].heading)
        : _bearingBetween(latlngs[i], latlngs[i + 1]);
      if (bearing === null) continue;
      const color = _routeSpeedColor(points[i].speed);
      const arrowIcon = L.divIcon({
        className: '', iconSize: [16, 16], iconAnchor: [8, 8],
        html: `<div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:11px solid ${color};filter:drop-shadow(0 0 1px #fff);transform:rotate(${bearing}deg)"></div>`,
      });
      routeMarkers.push(L.marker(latlngs[i], { icon: arrowIcon, interactive: false }).addTo(map));
    }
    const startIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 2px #10b981"></div>' });
    const endIcon = L.divIcon({ className: '', html: '<div style="width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 0 2px #ef4444"></div>' });
    routeMarkers.push(L.marker(latlngs[0], { icon: startIcon }).addTo(map).bindTooltip('Start · ' + points[0].location_time));
    routeMarkers.push(L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map).bindTooltip('End · ' + points[points.length - 1].location_time));
    const bounds = L.latLngBounds(latlngs);
    map.fitBounds(bounds, { padding: [40, 40] });
    if (status) status.textContent = `${points.length} points · ${points[0].location_time} → ${points[points.length - 1].location_time}`;
    const summaryEl = document.getElementById('bt-route-summary');
    if (summaryEl) summaryEl.innerHTML = _routeSummaryHtml(points);
  } catch (e) {
    if (status) status.textContent = e.message || 'Network error.';
  }
}

// Haversine distance in meters between two [lat,lng] points.
function _haversineM(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function _routeParseTime(s) { const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? null : d; }
function _fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Detail list under the map/legend — distance, elapsed vs. moving time,
// average/top speed, and how long the bus spent in each speed bucket
// (waiting/jam/slow/moderate/fast), plus a count of distinct waiting
// spells (a proxy for "how many times it got stuck"), all derived from
// the same points array the colored polyline/arrows already use — no
// extra fetch needed.
function _routeSummaryHtml(points) {
  let distanceM = 0;
  const bucketMs = {}; ROUTE_SPEED_BUCKETS.forEach(b => { bucketMs[b.label] = 0; });
  let waitingSpells = 0, inWaitingSpell = false;
  let maxSpeed = 0;
  for (let i = 0; i < points.length; i++) {
    const spd = Math.round(parseFloat(points[i].speed)) || 0;
    if (spd > maxSpeed) maxSpeed = spd;
    const bucket = ROUTE_SPEED_BUCKETS.find(b => spd <= b.max) || ROUTE_SPEED_BUCKETS[ROUTE_SPEED_BUCKETS.length - 1];
    const isWaiting = bucket === ROUTE_SPEED_BUCKETS[0];
    if (isWaiting && !inWaitingSpell) waitingSpells++;
    inWaitingSpell = isWaiting;
    if (i < points.length - 1) {
      distanceM += _haversineM([points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]);
      const t1 = _routeParseTime(points[i].location_time), t2 = _routeParseTime(points[i + 1].location_time);
      if (t1 && t2 && t2 > t1) bucketMs[bucket.label] += (t2 - t1);
    }
  }
  const t0 = _routeParseTime(points[0].location_time), tN = _routeParseTime(points[points.length - 1].location_time);
  const totalMs = (t0 && tN) ? (tN - t0) : 0;
  const movingMs = totalMs - bucketMs[ROUTE_SPEED_BUCKETS[0].label];
  const distanceKm = distanceM / 1000;
  const avgSpeed = totalMs > 0 ? (distanceKm / (totalMs / 3600000)) : 0;
  const rows = [
    ['Distance', `${distanceKm.toFixed(1)} km`],
    ['Total Duration', totalMs ? _fmtDuration(totalMs) : '—'],
    ['Moving Time', totalMs ? _fmtDuration(Math.max(0, movingMs)) : '—'],
    ['Avg Speed', `${avgSpeed.toFixed(1)} km/h`],
    ['Top Speed', `${maxSpeed} km/h`],
    ['Waiting Spells', String(waitingSpells)],
  ];
  // Label above value, both right-aligned — fits the narrow right-edged
  // panel this renders into (see #bt-route-panel) far better than a
  // label-left/value-right row would at ~120px wide.
  const bucketRows = ROUTE_SPEED_BUCKETS
    .filter(b => bucketMs[b.label] > 0)
    .map(b => `<div style="margin-bottom:4px"><div style="font-size:6.5px;font-weight:800;color:#94a3b8;text-transform:uppercase">${b.label}<span style="width:5px;height:5px;border-radius:50%;background:${b.color};display:inline-block;margin-left:3px"></span></div><div style="font-size:9px;font-weight:800;color:#334155">${_fmtDuration(bucketMs[b.label])}</div></div>`)
    .join('');
  return `
    <p style="font-size:7px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Route Summary</p>
    <div style="margin-bottom:6px">
      ${rows.map(([label, value]) => `<div style="margin-bottom:4px"><div style="font-size:6.5px;font-weight:800;color:#94a3b8;text-transform:uppercase">${label}</div><div style="font-size:9px;font-weight:800;color:#334155">${value}</div></div>`).join('')}
    </div>
    <p style="font-size:7px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Time by Speed</p>
    <div>${bucketRows}</div>`;
}

function clearRouteHistory() {
  routePolylines.forEach(p => map.removeLayer(p));
  routePolylines = [];
  routeMarkers.forEach(m => map.removeLayer(m));
  routeMarkers = [];
  const status = document.getElementById('bt-route-status');
  if (status) status.textContent = '';
  const summaryEl = document.getElementById('bt-route-summary');
  if (summaryEl) summaryEl.innerHTML = '';
}

// The Clear button specifically means "I'm done with the route" — bring
// the live fleet back. Plain clearRouteHistory() alone stays as the
// reset-before-redraw step showRouteHistory already used (that one must
// NOT bring live pins back, since a new route is about to be hidden
// behind in a moment anyway).
function clearRouteHistoryAndShowLive() {
  clearRouteHistory();
  _showLiveBusMarkers();
}

window.BusTracking = {
  initBusMap,
  stopBusTracking,
  resetBusMap,
  exportBusData,
  selectBus,
  refreshMapSize,
  toggleWatchersList,
  toggleRoutePanel,
  showRouteHistory,
  clearRouteHistory: clearRouteHistoryAndShowLive,
};
