/**
 * NAUTICAL.OS — Shipment Detail Frontend
 * Full replacement for shipment_detail.js
 *
 * Adds:
 *  - Planned route as blue dashed polyline
 *  - Checkpoint markers (grey/green/red) with popups
 *  - Route progress info panel
 *  - Live polling every 10s refreshes map & progress panel
 */

const token = localStorage.getItem("token");
if (!token) window.location.href = "/index.html";

const shipmentId = new URLSearchParams(window.location.search).get("id");
if (!shipmentId) window.location.href = "/detailed_shipment.html";

let shipmentData     = null;
let leafletMap       = null;
let vesselMarker     = null;
let lastWeatherFetch = 0;
let mapInitializing = false;
// Leaflet layer references — kept global so we can remove/re-add on refresh
let plannedRouteLayer    = null;
let traveledPathLayer    = null;
let traveledGlowLayer    = null;
let destDashedLayer      = null;
let checkpointLayerGroup = null;

// ─────────────────────────────────────────────────────────────────────────────
// Fetch shipment detail
// ─────────────────────────────────────────────────────────────────────────────
async function fetchShipmentDetail() {
    try {
        const res = await fetch(`http://localhost:3000/api/v1/shipments/${shipmentId}/detail?t=${Date.now()}`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success) { showError("Shipment not found"); return; }

        shipmentData = data.data;
        renderPage(shipmentData);

        const lat = shipmentData.latest_weather?.lat;
        const lng = shipmentData.latest_weather?.lng;
        if (lat && lng) fetchWeather(lat, lng, "ship");

    } catch (err) {
        console.error("Detail fetch error:", err);
        showError("Could not load shipment data");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geocode port name → { lat, lng }
// ─────────────────────────────────────────────────────────────────────────────
// Port coordinates — matches routePlanner's known ports
const KNOWN_PORTS = {
    "mumbai":       { lat: 18.9322, lng: 72.8375 },
    "jnpt":         { lat: 18.9480, lng: 72.9500 },
    "nhava sheva":  { lat: 18.9480, lng: 72.9500 },
    "kochi":        { lat: 9.9312,  lng: 76.2673 },
    "cochin":       { lat: 9.9312,  lng: 76.2673 },
    "goa":          { lat: 15.4909, lng: 73.8278 },
    "mangalore":    { lat: 12.8703, lng: 74.8423 },
    "chennai":      { lat: 13.0827, lng: 80.2707 },
    "madras":       { lat: 13.0827, lng: 80.2707 },
    "vizag":        { lat: 17.6868, lng: 83.2185 },
    "visakhapatnam":{ lat: 17.6868, lng: 83.2185 },
    "kolkata":      { lat: 22.5726, lng: 88.3639 },
    "haldia":       { lat: 22.0667, lng: 88.0833 },
    "paradip":      { lat: 20.3167, lng: 86.6167 },
    "kandla":       { lat: 23.0333, lng: 70.2167 },
    "mundra":       { lat: 22.8390, lng: 69.7183 },
    "tuticorin":    { lat: 8.7642,  lng: 78.1348 },
    "thoothukudi":  { lat: 8.7642,  lng: 78.1348 },
    "kozhikode":    { lat: 11.2588, lng: 75.7804 },
    "calicut":      { lat: 11.2588, lng: 75.7804 },
    "ennore":       { lat: 13.2827, lng: 80.3311 },
    "kamarajar":    { lat: 13.2827, lng: 80.3311 },
    "pipavav":      { lat: 20.9167, lng: 71.5167 },
    "hazira":       { lat: 21.1167, lng: 72.6500 },
    "mormugao":     { lat: 15.4139, lng: 73.7993 },
};

function geocodePort(name) {
    if (!name) return null;
    const key = name.toLowerCase().split(",")[0].trim();
    for (const [port, coords] of Object.entries(KNOWN_PORTS)) {
        if (key.includes(port) || port.includes(key)) return coords;
    }
    return null;
}
// ─────────────────────────────────────────────────────────────────────────────
// Fetch live weather
// ─────────────────────────────────────────────────────────────────────────────
async function fetchWeather(lat, lng, source = "ship") {
    const now = Date.now();
    if (now - lastWeatherFetch < 60_000 && source === "phone") return;
    lastWeatherFetch = now;
    setWeatherLoading(true);
    try {
        const url = `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}&longitude=${lng}` +
            `&current=temperature_2m,wind_speed_10m,relative_humidity_2m,visibility` +
            `&wind_speed_unit=kn`;
        const res  = await fetch(url);
        const data = await res.json();
        const c    = data.current;
        if (c?.temperature_2m !== undefined) {
            document.getElementById("live-temp").textContent   = `${c.temperature_2m}°C`;
            document.getElementById("temp-source").textContent = `Live • ${source === "phone" ? "📱 Phone GPS" : "Ship data"}`;
        }
        if (c?.wind_speed_10m !== undefined) {
            document.getElementById("live-wind").textContent   = `${c.wind_speed_10m} kn`;
            document.getElementById("wind-source").textContent = `Live • ${source === "phone" ? "📱 Phone GPS" : "Ship data"}`;
        }
        if (c?.relative_humidity_2m !== undefined) {
            document.getElementById("live-humidity").textContent = `${c.relative_humidity_2m}%`;
        }
        if (c?.visibility !== undefined) {
            document.getElementById("live-visibility").textContent = `${(c.visibility / 1000).toFixed(1)} km`;
        }
    } catch (err) {
        console.error("Weather fetch error:", err);
    } finally {
        setWeatherLoading(false);
    }
}

function setWeatherLoading(on) {
    ["temp-card", "wind-card"].forEach(id => {
        document.getElementById(id)?.classList.toggle("shimmer", on);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status config
// ─────────────────────────────────────────────────────────────────────────────
function getStatusConfig(status) {
    const map = {
        at_port:    { label: "At Port",    color: "#4ADE80" },
        in_transit: { label: "In Transit", color: "#60a5fa" },
        delayed:    { label: "Delayed",    color: "#f87171" },
        registered: { label: "Scheduled",  color: "#94a3b8" },
        departed:   { label: "Departed",   color: "#fb923c" },
        arrived:    { label: "Arrived",    color: "#2dd4bf" },
    };
    return map[status] || { label: status, color: "#94a3b8" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Render all page sections
// ─────────────────────────────────────────────────────────────────────────────
function renderPage(s) {
    document.getElementById("cargo-origin").textContent      = s.cargo.origin;
    document.getElementById("cargo-dest").textContent        = s.cargo.destination;
    document.getElementById("cargo-containers").textContent  = s.vessel.container_count + " units";
    document.getElementById("cargo-capacity").textContent    = s.vessel.capacity + " TEU";
    document.getElementById("cargo-snapshots").textContent   = s.weather_snapshots.length;
    

    const sc        = getStatusConfig(s.status);
    const shortId   = s._id.toString().slice(-8).toUpperCase();
    const arrival   = new Date(s.schedule.arrival).toLocaleDateString("en-IN",  { day: "2-digit", month: "short", year: "numeric" });
    const departure = new Date(s.schedule.departure).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    document.getElementById("ship-id").textContent          = `#${shortId}`;
    document.getElementById("vessel-name").textContent      = s.vessel.name;
    document.getElementById("ship-status").textContent      = sc.label;
    document.getElementById("ship-status").style.color      = sc.color;
    document.getElementById("status-dot").style.background  = sc.color;
    document.getElementById("gps-device").textContent       = s.gps_device_id;
    document.getElementById("route-text").textContent       = `${s.cargo.origin} → ${s.cargo.destination}`;
    document.getElementById("departure-date").textContent   = departure;
    document.getElementById("arrival-date").textContent     = arrival;
    document.getElementById("days-remaining").textContent   = `${s.days_remaining} Days`;
    document.getElementById("container-count").textContent  = s.vessel.container_count.toLocaleString() + " TEU";
    
    document.getElementById("ship-type").textContent        = s.type === "incoming" ? "INCOMING" : "OUTGOING";

    const cpTotal    = s.checkpoints?.length || 0;
const cpReached  = s.checkpoints?.filter(c => c.status === "reached").length || 0;
const cpProgress = cpTotal > 0 ? Math.round((cpReached / cpTotal) * 100) : 0;

document.getElementById("progress-bar").style.width    = `${cpProgress}%`;
document.getElementById("progress-label").textContent  = `${cpProgress}% (${cpReached}/${cpTotal} CPs)`;
document.getElementById("benchmark-bar").style.width   = `${Math.min(cpProgress + 5, 100)}%`;

    if (s.latest_weather?.lat != null && s.latest_weather?.lng != null) {
    document.getElementById("live-lat").textContent    = `${s.latest_weather.lat.toFixed(4)}° N`;
    document.getElementById("live-lng").textContent    = `${s.latest_weather.lng.toFixed(4)}° E`;
        document.getElementById("storm-flag").textContent  = s.latest_weather.storm_flag ? "⚠ STORM ALERT" : "Clear";
        document.getElementById("storm-flag").style.color  = s.latest_weather.storm_flag ? "#fb6b00" : "#4ADE80";
        document.getElementById("live-wind").textContent   = `${s.latest_weather.wind_speed_kmh} km/h`;
    }

    // Render route progress panel (new)
    renderRouteProgressPanel(s);

    initLeafletMap(s);
    renderTimeline(s);
    if (window.runIntelligenceEngine) runIntelligenceEngine(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Progress Panel — injected below the map
// ─────────────────────────────────────────────────────────────────────────────
function renderRouteProgressPanel(s) {
    const rp  = s.route_progress;
    const cps = s.checkpoints || [];

    let panel = document.getElementById("route-progress-panel");
    if (!panel) {
        // Create panel and inject it after the map container
        panel = document.createElement("div");
        panel.id = "route-progress-panel";
        panel.style.cssText = `
            margin-top: 16px;
            background: rgba(23,44,59,0.85);
            backdrop-filter: blur(24px);
            border: 1px solid rgba(186,200,220,0.12);
            border-radius: 12px;
            padding: 20px 24px;
            font-family: 'Inter', sans-serif;
        `;
        const mapEl = document.getElementById("leaflet-map");
        mapEl?.parentNode?.insertBefore(panel, mapEl.nextSibling);
    }

    if (!rp || cps.length === 0) {
        panel.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;color:#8e9196;">
                <span style="font-size:18px;">🗺️</span>
                <span style="font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">
                    No planned route yet — will generate on activation
                </span>
            </div>`;
        return;
    }

    const reached = cps.filter(c => c.status === "reached").length;
    const missed  = cps.filter(c => c.status === "missed").length;
    const pending = cps.filter(c => c.status === "pending").length;
    const total   = cps.length;
    const pct     = Math.round((reached / total) * 100);

    const delayColor  = rp.delay_minutes > 0 ? "#f87171" : rp.delay_minutes < 0 ? "#4ADE80" : "#94a3b8";
    const delayLabel  = rp.delay_minutes > 0
        ? `+${rp.delay_minutes} min BEHIND`
        : rp.delay_minutes < 0
            ? `${Math.abs(rp.delay_minutes)} min AHEAD`
            : "ON SCHEDULE";
    const onTimeColor = rp.on_time ? "#4ADE80" : "#f87171";

    // ETA to next checkpoint
    let etaStr = "—";
    if (rp.eta_to_next_checkpoint_min !== null) {
        const h = Math.floor(rp.eta_to_next_checkpoint_min / 60);
        const m = rp.eta_to_next_checkpoint_min % 60;
        etaStr  = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    panel.innerHTML = `
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:16px;">🧭</span>
                <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#bac8dc;">
                    ROUTE PROGRESS
                </span>
            </div>
            <span style="font-size:11px;font-weight:700;color:${onTimeColor};
                background:${onTimeColor}18;padding:3px 10px;border-radius:20px;letter-spacing:0.05em;">
                ${rp.on_time ? "✓ ON TIME" : "⚠ DELAYED"}
            </span>
        </div>

        <!-- Progress Bar -->
        <div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:11px;color:#8e9196;">${reached} of ${total} checkpoints reached</span>
                <span style="font-size:11px;font-weight:700;color:#d0e5f9;">${pct}%</span>
            </div>
            <div style="width:100%;height:6px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#60a5fa,#bac8dc);
                    border-radius:4px;transition:width 0.6s ease;"></div>
            </div>
        </div>

        <!-- Stats Row -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
            <div style="background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.15);
                border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:18px;font-weight:800;color:#60a5fa;">${reached}</div>
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#8e9196;margin-top:2px;">Reached</div>
            </div>
            <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.15);
                border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:18px;font-weight:800;color:#f87171;">${missed}</div>
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#8e9196;margin-top:2px;">Missed</div>
            </div>
            <div style="background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.15);
                border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:18px;font-weight:800;color:#94a3b8;">${pending}</div>
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#8e9196;margin-top:2px;">Pending</div>
            </div>
            <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
                border-radius:8px;padding:10px;text-align:center;">
                <div style="font-size:14px;font-weight:800;color:${delayColor};">${delayLabel.split(" ")[0]}</div>
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#8e9196;margin-top:2px;">
                    ${rp.delay_minutes === 0 ? "Schedule" : rp.delay_minutes > 0 ? "Behind" : "Ahead"}
                </div>
            </div>
        </div>

        <!-- Next Checkpoint -->
        <div style="display:flex;align-items:center;justify-content:space-between;
            background:rgba(186,200,220,0.05);border:1px solid rgba(186,200,220,0.1);
            border-radius:8px;padding:12px 16px;">
            <div>
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#8e9196;margin-bottom:3px;">
                    Approaching Next
                </div>
                <div style="font-size:13px;font-weight:700;color:#d0e5f9;">${rp.next_checkpoint_name}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:#8e9196;margin-bottom:3px;">
                    ETA
                </div>
                <div style="font-size:18px;font-weight:800;color:#bac8dc;font-family:'Manrope',sans-serif;">${etaStr}</div>
            </div>
        </div>

        <!-- Checkpoint List -->
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;">
            ${cps.map(cp => {
                const icon  = cp.status === "reached" ? "✓" : cp.status === "missed" ? "✗" : "○";
                const color = cp.status === "reached" ? "#4ADE80" : cp.status === "missed" ? "#f87171" : "#94a3b8";
                const bg    = cp.status === "reached" ? "rgba(74,222,128,0.08)" : cp.status === "missed" ? "rgba(248,113,113,0.08)" : "rgba(255,255,255,0.03)";
                const expected = cp.expected_arrival
                    ? new Date(cp.expected_arrival).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })
                    : "—";
                const actual = cp.actual_arrival
                    ? new Date(cp.actual_arrival).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })
                    : cp.status === "missed" ? "MISSED" : "Pending";
                return `
                    <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;
                        background:${bg};border-radius:6px;border-left:2px solid ${color};">
                        <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${color};
                            display:flex;align-items:center;justify-content:center;
                            font-size:10px;font-weight:700;color:${color};flex-shrink:0;">${icon}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:11px;font-weight:600;color:#d0e5f9;">${cp.name}</div>
                            <div style="font-size:9px;color:#8e9196;margin-top:1px;">ETA ${expected}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-size:9px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">
                                ${cp.status}
                            </div>
                            <div style="font-size:9px;color:#8e9196;margin-top:1px;">${actual}</div>
                        </div>
                    </div>`;
            }).join("")}
        </div>

        <!-- Legend -->
        <div style="display:flex;gap:16px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);">
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="width:24px;height:3px;background:#60a5fa;border-radius:2px;
                    border-top:1px dashed #60a5fa;"></div>
                <span style="font-size:9px;color:#8e9196;text-transform:uppercase;letter-spacing:0.06em;">Planned Route</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="width:24px;height:3px;background:#fb6b00;border-radius:2px;"></div>
                <span style="font-size:9px;color:#8e9196;text-transform:uppercase;letter-spacing:0.06em;">Traveled Path</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="width:8px;height:8px;border-radius:50%;background:#4ADE80;"></div>
                <span style="font-size:9px;color:#8e9196;">Reached</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="width:8px;height:8px;border-radius:50%;background:#f87171;"></div>
                <span style="font-size:9px;color:#8e9196;">Missed</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="width:8px;height:8px;border-radius:50%;background:#94a3b8;"></div>
                <span style="font-size:9px;color:#8e9196;">Pending</span>
            </div>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Leaflet Map — full init with planned route + checkpoints
// ─────────────────────────────────────────────────────────────────────────────

async function initLeafletMap(s) {
    if (mapInitializing) return;
    if (!window.L) {
        mapInitializing = true;
        await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
        loadCSS("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
        mapInitializing = false;
    }

    const container = document.getElementById("leaflet-map");
    if (!container) return;

    const snapshots   = s.weather_snapshots || [];
    const routePoints = snapshots.map(w => [w.lat, w.lng]);
    const livePos = (s.latest_weather?.lat != null && s.latest_weather?.lng != null)
    ? [s.latest_weather.lat, s.latest_weather.lng]
    : routePoints[routePoints.length - 1] || null;

    // ── If map already exists: just update dynamic layers ────────────────────
    if (leafletMap) {
        // Update vessel marker position
        if (vesselMarker && livePos) {
            vesselMarker.setLatLng(livePos);
        }
        // Refresh traveled path
        if (traveledPathLayer) { leafletMap.removeLayer(traveledPathLayer); traveledPathLayer = null; }
        if (traveledGlowLayer) { leafletMap.removeLayer(traveledGlowLayer); traveledGlowLayer = null; }
        if (routePoints.length > 1) {
            traveledGlowLayer = L.polyline(routePoints, { color: "#fb6b00", weight: 8,  opacity: 0.15 }).addTo(leafletMap);
            traveledPathLayer = L.polyline(routePoints, { color: "#fb6b00", weight: 3,  opacity: 0.9  }).addTo(leafletMap);
        }
        // Refresh checkpoint markers
        updateCheckpointMarkers(s);
        return;
    }

    // ── First-time map init ───────────────────────────────────────────────────
    const originCoords = geocodePort(s.cargo.origin);
    const destCoords   = geocodePort(s.cargo.destination);

    let mapCenter = [20, 77];
    if (originCoords && destCoords) {
        mapCenter = [(originCoords.lat + destCoords.lat) / 2, (originCoords.lng + destCoords.lng) / 2];
    } else if (livePos) {
        mapCenter = livePos;
    }

    leafletMap = L.map("leaflet-map", { center: mapCenter, zoom: 5, zoomControl: true, attributionControl: false });
    leafletMap.whenReady(() => {
    document.getElementById("map-loading")?.classList.add("hidden");
    });
    L.tileLayer("https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png", { maxZoom: 18 }).addTo(leafletMap);

    // ── PLANNED ROUTE — blue dashed line ──────────────────────────────────────
    const plannedRoute = s.planned_route || [];
    if (plannedRoute.length > 1) {
        const plannedLatLngs = plannedRoute.map(p => [p.lat, p.lng]);
        // Glow
        L.polyline(plannedLatLngs, {
            color: "#60a5fa", weight: 8, opacity: 0.08, dashArray: null
        }).addTo(leafletMap);
        // Main dashed line
        plannedRouteLayer = L.polyline(plannedLatLngs, {
            color: "#60a5fa", weight: 2, opacity: 0.75, dashArray: "10 6"
        }).addTo(leafletMap);
    }

    // ── TRAVELED PATH — orange solid line ────────────────────────────────────
    if (routePoints.length > 1) {
        traveledGlowLayer = L.polyline(routePoints, { color: "#fb6b00", weight: 8, opacity: 0.15 }).addTo(leafletMap);
        traveledPathLayer = L.polyline(routePoints, { color: "#fb6b00", weight: 3, opacity: 0.9  }).addTo(leafletMap);
    }

    // ── DASHED LINE to destination (future path) ──────────────────────────────
    const isArrived = ["arrived", "at_port", "departed"].includes(s.status);
    if (livePos && destCoords && !isArrived) {
        destDashedLayer = L.polyline([livePos, [destCoords.lat, destCoords.lng]], {
            color: "#bac8dc", weight: 2, opacity: 0.35, dashArray: "8 7"
        }).addTo(leafletMap);
    }

    // ── PORT ICONS ────────────────────────────────────────────────────────────
    const portIcon = (color, label) => L.divIcon({
        className: "",
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 0 3px ${color}44,0 0 12px ${color}88;"></div>
          <div style="background:rgba(0,21,35,0.9);color:${color};font-family:monospace;font-size:9px;font-weight:700;
            padding:2px 6px;border-radius:3px;white-space:nowrap;letter-spacing:0.05em;border:1px solid ${color}55;">${label}</div>
        </div>`,
        iconSize: [0,0], iconAnchor: [7,7]
    });

    if (originCoords) {
        L.marker([originCoords.lat, originCoords.lng], { icon: portIcon("#4ADE80", "⚓ " + s.cargo.origin) })
         .addTo(leafletMap).bindPopup(`<b>Origin Port</b><br>${s.cargo.origin}`);
    }
    if (destCoords) {
        L.marker([destCoords.lat, destCoords.lng], { icon: portIcon(isArrived ? "#4ADE80" : "#bac8dc", "🏁 " + s.cargo.destination) })
         .addTo(leafletMap).bindPopup(`<b>Destination Port</b><br>${s.cargo.destination}`);
    }

    // ── VESSEL MARKER ─────────────────────────────────────────────────────────
    if (!document.getElementById("vessel-pulse-style")) {
        const st = document.createElement("style");
        st.id = "vessel-pulse-style";
        st.textContent = `@keyframes vesselPulse {
            0%,100% { box-shadow: 0 0 0 6px rgba(251,107,0,0.15), 0 0 20px rgba(251,107,0,0.4); }
            50%      { box-shadow: 0 0 0 12px rgba(251,107,0,0.05), 0 0 32px rgba(251,107,0,0.2); }
        }`;
        document.head.appendChild(st);
    }

    const vesselIconFn = (color) => L.divIcon({
        className: "",
        html: `<div style="display:flex;align-items:center;justify-content:center;">
          <div style="width:32px;height:32px;border-radius:50%;background:${color}22;border:2px solid ${color};
            box-shadow:0 0 0 6px ${color}22,0 0 20px ${color}66;display:flex;align-items:center;justify-content:center;
            animation:vesselPulse 2s ease-in-out infinite;">
            <span style="color:${color};font-size:14px;">▲</span>
          </div>
        </div>`,
        iconSize: [32,32], iconAnchor: [16,16]
    });

    if (livePos) {
        vesselMarker = L.marker(livePos, { icon: vesselIconFn(isArrived ? "#4ADE80" : "#fb6b00") })
            .addTo(leafletMap)
            .bindPopup(`<b>${s.vessel.name}</b><br>${isArrived ? "✅ Arrived" : "📍 Live Position"}<br>
                        ${livePos[0].toFixed(4)}°N, ${livePos[1].toFixed(4)}°E`);
    }

    // ── CHECKPOINT MARKERS ────────────────────────────────────────────────────
    checkpointLayerGroup = L.layerGroup().addTo(leafletMap);
    updateCheckpointMarkers(s);

    // ── FIT BOUNDS ────────────────────────────────────────────────────────────
    const allPoints = [];
    if (originCoords) allPoints.push([originCoords.lat, originCoords.lng]);
    if (destCoords)   allPoints.push([destCoords.lat,   destCoords.lng]);
    if (livePos)      allPoints.push(livePos);
    routePoints.forEach(p => allPoints.push(p));

    if (allPoints.length > 1) {
        leafletMap.fitBounds(L.latLngBounds(allPoints), { padding: [60, 60] });
    } else if (allPoints.length === 1) {
        leafletMap.setView(allPoints[0], 6);
    }

    
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint Markers — color coded
// ─────────────────────────────────────────────────────────────────────────────
function updateCheckpointMarkers(s) {
    if (!checkpointLayerGroup || !s.checkpoints?.length) return;
    checkpointLayerGroup.clearLayers();

    s.checkpoints.forEach((cp, i) => {
        const color = cp.status === "reached" ? "#4ADE80"
                    : cp.status === "missed"  ? "#f87171"
                    : "#94a3b8";

        const ring  = cp.status === "reached" ? "#4ADE8044"
                    : cp.status === "missed"  ? "#f8717144"
                    : "#94a3b844";

        const icon  = cp.status === "reached" ? "✓"
                    : cp.status === "missed"  ? "✗"
                    : `${i + 1}`;

        const markerIcon = L.divIcon({
            className: "",
            html: `<div style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;">
              <div style="width:22px;height:22px;border-radius:50%;background:${color}22;
                border:2px solid ${color};box-shadow:0 0 0 4px ${ring};
                display:flex;align-items:center;justify-content:center;">
                <span style="font-size:9px;font-weight:800;color:${color};font-family:monospace;">${icon}</span>
              </div>
              <div style="background:rgba(0,21,35,0.9);color:${color};font-size:8px;font-weight:700;
                padding:1px 5px;border-radius:3px;white-space:nowrap;border:1px solid ${color}44;
                letter-spacing:0.04em;">CP${i + 1}</div>
            </div>`,
            iconSize: [0,0], iconAnchor: [11, 11]
        });

        const expectedStr = cp.expected_arrival
            ? new Date(cp.expected_arrival).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })
            : "—";
        const actualStr = cp.actual_arrival
            ? new Date(cp.actual_arrival).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })
            : cp.status === "missed" ? "<span style='color:#f87171'>MISSED</span>" : "<span style='color:#94a3b8'>Pending</span>";

        const statusBadge = `<span style="font-weight:700;color:${color};text-transform:uppercase;">${cp.status}</span>`;

        L.marker([cp.position.lat, cp.position.lng], { icon: markerIcon })
         .addTo(checkpointLayerGroup)
         .bindPopup(`
            <div style="font-family:'Inter',sans-serif;min-width:160px;">
                <div style="font-weight:800;font-size:13px;margin-bottom:6px;color:#111;">${cp.name}</div>
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
                    <span style="color:#888;">Status</span>${statusBadge}
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;">
                    <span style="color:#888;">Expected</span>
                    <span style="font-weight:600;">${expectedStr}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;">
                    <span style="color:#888;">Actual</span>
                    <span>${actualStr}</span>
                </div>
            </div>`);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Script / CSS loaders
// ─────────────────────────────────────────────────────────────────────────────
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const el = document.createElement("script");
        el.src = src; el.onload = resolve; el.onerror = reject;
        document.head.appendChild(el);
    });
}
function loadCSS(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const el = document.createElement("link");
    el.rel = "stylesheet"; el.href = href;
    document.head.appendChild(el);
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// ─────────────────────────────────────────────────────────────────────────────
function renderTimeline(s) {
    const container = document.getElementById("timeline-items");
    const snapshots = s.weather_snapshots || [];
    const now       = new Date();
    const events    = [];

    events.push({
        label: `${s.cargo.origin} (${s.type === "incoming" ? "Origin" : "Departure"})`,
        sub:   `Scheduled: ${new Date(s.schedule.arrival).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}`,
        done: true, current: false
    });

    snapshots.slice(0, -1).forEach((w, i) => {
        const ts = new Date(w.timestamp);
        events.push({
            label:   `Waypoint ${i + 1} — ${w.lat.toFixed(2)}°N ${w.lng.toFixed(2)}°E`,
            sub:     `${ts.toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })} UTC${w.storm_flag ? " ⚠ Storm" : ""}`,
            done: ts < now, current: false
        });
    });

    const isArrived = ["arrived", "at_port", "departed"].includes(s.status);
    if (snapshots.length > 0 && !isArrived) {
        const last = snapshots[snapshots.length - 1];
        events.push({
            label: `Current Position — ${last.lat.toFixed(4)}°N ${last.lng.toFixed(4)}°E`,
            sub:   "Live GPS Tracking Active",
            done: false, current: true
        });
    }

    events.push({
        label: `${s.cargo.destination} (${s.type === "incoming" ? "Destination" : "Arrival"})`,
        sub:   isArrived
            ? `Arrived: ${new Date(s.actual?.arrival || s.schedule.departure).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}`
            : `ETA: ${new Date(s.schedule.departure).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}`,
        done: isArrived, current: isArrived
    });

    container.innerHTML = "";
    events.forEach((ev, i) => {
        const isLast = i === events.length - 1;
        const div    = document.createElement("div");
        div.className = "flex gap-4 items-start relative " + (isLast ? "" : "pb-6");
        div.innerHTML = `
            ${!isLast ? `<div class="w-0.5 h-full absolute left-3 top-6 bg-outline-variant/30"></div>` : ""}
            <div class="w-6 h-6 rounded-full flex items-center justify-center relative z-10 ring-4 ring-background flex-shrink-0
                ${ev.current ? "bg-[#fb6b00] animate-pulse" : ev.done ? "bg-primary" : "bg-surface-container-high border border-outline-variant/40"}">
                ${ev.current
                    ? `<span class="material-symbols-outlined text-[12px] text-background" style="font-variation-settings:'FILL' 1">radio_button_checked</span>`
                    : ev.done
                        ? `<span class="material-symbols-outlined text-[12px] text-background" style="font-variation-settings:'FILL' 1">check</span>`
                        : `<span class="material-symbols-outlined text-[12px] text-outline-variant">schedule</span>`}
            </div>
            <div>
                <p class="text-sm font-bold ${ev.current ? "text-[#fb6b00]" : ev.done ? "text-on-surface" : "text-on-surface-variant"}">${ev.label}</p>
                <p class="text-xs text-on-surface-variant mt-0.5">${ev.sub}</p>
            </div>`;
        container.appendChild(div);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Error state
// ─────────────────────────────────────────────────────────────────────────────
function showError(msg) {
    document.body.innerHTML = `
        <div class="min-h-screen flex items-center justify-center text-on-surface-variant">
            <div class="text-center">
                <span class="material-symbols-outlined text-4xl mb-4 block">error</span>
                <p>${msg}</p>
                <a href="detailed_shipment.html" class="text-primary text-sm mt-4 block">← Back to Shipments</a>
            </div>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
fetchShipmentDetail();
setInterval(fetchShipmentDetail, 10000);