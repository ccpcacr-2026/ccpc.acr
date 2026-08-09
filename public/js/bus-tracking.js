/**
 * Bus Tracking UI Component
 * Real-time bus positions, geofence alerts, ETA tracking via Leaflet map
 */

let map = null;
let busMarkers = {};
let geofenceCircles = {};
let busUpdateInterval = null;
let selectedBusImei = null;
let hasFittedOnce = false;

const BUS_SVG = '<svg viewBox="0 0 24 24"><path d="M18 11h-1V7c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v10h1c0 1.1.9 2 2 2s2-.9 2-2h6c0 1.1.9 2 2 2s2-.9 2-2h1v-4c0-1.1-.9-2-2-2zM6 18c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm11 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-7H5V7h11v4z"/></svg>';

/**
 * Initialize Leaflet map
 */
function initBusMap() {
  const mapContainer = document.getElementById('bus-map-container');
  if (!mapContainer) return;

  // Default center (Dhaka, Bangladesh)
  const defaultLat = 23.8103;
  const defaultLng = 90.4125;

  if (!map) {
    map = L.map('bus-map-container').setView([defaultLat, defaultLng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    const fitBtn = document.createElement('button');
    fitBtn.className = 'bt-fit-btn';
    fitBtn.innerHTML = '<i data-lucide="maximize" class="h-3.5 w-3.5"></i> Fit all';
    fitBtn.onclick = fitBusesInBounds;
    mapContainer.appendChild(fitBtn);
    if (window.lucide) lucide.createIcons();
  }

  loadBusTrackingConfig();
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
  busUpdateInterval = setInterval(updateBusPositions, 30000);
}

/**
 * Update bus positions from API
 */
async function updateBusPositions() {
  try {
    const response = await portalFetch('get_bus_data', {});

    if (!response.data || !Array.isArray(response.data)) {
      console.warn('Invalid bus data response');
      return;
    }

    response.data.forEach(bus => updateBusMarker(bus));
    updateBusList(response.data);

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
    const found = window.busRegistry.find(b => b[1] === imei);
    if (found) return found[0];
  }
  return imei;
}

/**
 * Update or create bus marker on map
 */
function updateBusMarker(bus) {
  const { imei, lat, lng } = bus;
  if (!imei || isNaN(lat) || isNaN(lng)) return;

  const selected = selectedBusImei === imei;
  const icon = busMarkerIcon(bus, selected);
  const label = `<b>${busName(imei)}</b> · ${bus.isMoving ? `${bus.speed} km/h` : 'Idle'}`;

  if (busMarkers[imei]) {
    busMarkers[imei].setLatLng([lat, lng]);
    busMarkers[imei].setIcon(icon);
    busMarkers[imei].setTooltipContent(label);
  } else {
    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker.bindTooltip(label, { permanent: true, direction: 'top', className: 'bt-marker-label', offset: [0, selected ? -22 : -18] });
    marker.on('click', () => selectBus(imei, bus));
    busMarkers[imei] = marker;
  }
  busMarkers[imei].busData = bus; // kept for CSV export

  checkGeofenceEvents(bus);
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

  if (!buses.length) {
    listContainer.innerHTML = `<div class="bt-empty"><i data-lucide="alert-circle" class="h-6 w-6"></i>No buses configured yet</div>`;
    if (window.lucide) lucide.createIcons();
    return;
  }

  listContainer.innerHTML = buses.map(bus => {
    const name = busName(bus.imei);
    const mv = !!bus.isMoving;
    const isSelected = selectedBusImei === bus.imei;
    const spd = parseFloat(bus.speed) || 0;
    const spdPct = Math.min(100, Math.round((spd / 80) * 100));
    const addr = (bus.address || 'Locating…');

    return `
      <div class="bt-list-item ${isSelected ? 'active' : ''}" onclick='selectBus(${JSON.stringify(bus.imei)}, ${JSON.stringify(bus)})'>
        <div class="flex items-center gap-2.5">
          <div class="bt-avatar ${mv ? 'moving' : 'idle'}"><i data-lucide="bus" class="h-4 w-4"></i></div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-black text-slate-800 truncate">${name}</div>
            <div class="text-[10px] text-slate-400 font-bold">${bus.imei}</div>
          </div>
          <div class="bt-dot ${mv ? 'moving' : 'idle'}"></div>
        </div>
        <div class="mt-2">
          <div class="flex justify-between text-[10px] font-bold text-slate-400 mb-1"><span>${mv ? 'Moving' : 'Idle'}</span><span>${spd} km/h</span></div>
          <div class="bt-speed-track"><div class="bt-speed-fill ${mv ? 'moving' : 'idle'}" style="width:${spdPct}%"></div></div>
        </div>
        <div class="mt-2 text-[10px] text-slate-400 font-semibold truncate flex items-center gap-1"><i data-lucide="map-pin" class="h-3 w-3 text-blue-600 shrink-0"></i>${addr}</div>
      </div>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons();
}

/**
 * Select a bus and highlight on map
 */
function selectBus(imei, busData) {
  selectedBusImei = imei;

  if (busMarkers[imei]) {
    busMarkers[imei].setIcon(busMarkerIcon(busData, true));
    map.panTo(busMarkers[imei].getLatLng());
  }

  updateBusInfoPanel(busData);
  updateBusList(Object.values(busMarkers).map(m => m.busData).filter(Boolean));
}

/**
 * Update bus info panel with details
 */
function updateBusInfoPanel(bus) {
  const panel = document.getElementById('bus-info-panel');
  if (!panel) return;

  const name = busName(bus.imei);
  const mv = !!bus.isMoving;
  const spd = parseFloat(bus.speed) || 0;
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
 * Fit all buses in map bounds
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
      bus.speed,
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
  geofenceCircles = {};
  selectedBusImei = null;
  hasFittedOnce = false;
}

window.BusTracking = {
  initBusMap,
  stopBusTracking,
  resetBusMap,
  exportBusData,
  selectBus,
  refreshMapSize,
};
