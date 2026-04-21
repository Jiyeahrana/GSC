const token = localStorage.getItem("token");
if (!token) window.location.href = "/index.html";

const shipmentId = new URLSearchParams(window.location.search).get("id");
if (!shipmentId) window.location.href = "/detailed_shipment.html";

let shipmentData = null;

// ── Fetch shipment detail ─────────────────────────────────────────────────────

async function fetchShipmentDetail() {
    try {
        const res  = await fetch(`http://localhost:3000/api/v1/shipments/${shipmentId}/detail`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success) { showError("Shipment not found"); return; }

        shipmentData = data.data;
        renderPage(shipmentData);

        // Fetch weather from Open-Meteo if we have coords
        if (shipmentData.latest_weather?.lat && shipmentData.latest_weather?.lng) {
            fetchWeather(shipmentData.latest_weather.lat, shipmentData.latest_weather.lng);
        }

    } catch (err) {
        console.error("Detail fetch error:", err);
        showError("Could not load shipment data");
    }
}

// ── Fetch live weather from Open-Meteo (free, no API key needed) ──────────────

async function fetchWeather(lat, lng) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m&wind_speed_unit=kn`;
        const res  = await fetch(url);
        const data = await res.json();

        const temp  = data.current?.temperature_2m;
        const wind  = data.current?.wind_speed_10m;

        if (temp !== undefined) {
            document.getElementById("live-temp").textContent  = `${temp}°C`;
        }
        if (wind !== undefined) {
            document.getElementById("live-wind").textContent  = `${wind} kn`;
        }

    } catch (err) {
        console.error("Weather fetch error:", err);
    }
}

// ── Status config ─────────────────────────────────────────────────────────────

function getStatusConfig(status) {
    switch (status) {
        case "at_port":    return { label: "At Port",    color: "#4ADE80" };
        case "in_transit": return { label: "In Transit", color: "#60a5fa" };
        case "delayed":    return { label: "Delayed",    color: "#f87171" };
        case "registered": return { label: "Scheduled",  color: "#94a3b8" };
        case "departed":   return { label: "Departed",   color: "#fb923c" };
        case "arrived":    return { label: "Arrived",    color: "#2dd4bf" };
        default:           return { label: status,       color: "#94a3b8" };
    }
}

// ── Render all page sections ──────────────────────────────────────────────────

function renderPage(s) {
    document.getElementById("cargo-origin").textContent     = s.cargo.origin;
    document.getElementById("cargo-dest").textContent       = s.cargo.destination;
    document.getElementById("cargo-containers").textContent = s.vessel.container_count + " units";
    document.getElementById("cargo-capacity").textContent   = s.vessel.capacity + " TEU";
    document.getElementById("cargo-snapshots").textContent  = s.weather_snapshots.length;
    document.getElementById("sender-name-card").textContent = s.sender_name;
    document.getElementById("sender-email-card").textContent = s.sender_email;
    const sc      = getStatusConfig(s.status);
    const shortId = s._id.toString().slice(-8).toUpperCase();
    const arrival = new Date(s.schedule.arrival).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric"
    });
    const departure = new Date(s.schedule.departure).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric"
    });

    // ── Header panel ──────────────────────────────────────────────────────────
    document.getElementById("ship-id").textContent       = `#${shortId}`;
    document.getElementById("vessel-name").textContent   = s.vessel.name;
    document.getElementById("ship-status").textContent   = sc.label;
    document.getElementById("ship-status").style.color   = sc.color;
    document.getElementById("status-dot").style.background = sc.color;
    document.getElementById("gps-device").textContent    = s.gps_device_id;
    document.getElementById("route-text").textContent    = `${s.cargo.origin} → ${s.cargo.destination}`;
    document.getElementById("departure-date").textContent = departure;
    document.getElementById("arrival-date").textContent  = arrival;
    document.getElementById("days-remaining").textContent = `${s.days_remaining} Days`;
    document.getElementById("container-count").textContent = s.vessel.container_count.toLocaleString() + " TEU";
    document.getElementById("sender-name").textContent   = s.sender_name;
    document.getElementById("sender-email").textContent  = s.sender_email;
    document.getElementById("ship-type").textContent     = s.type === "incoming" ? "INCOMING" : "OUTGOING";

    // ── Progress bars ─────────────────────────────────────────────────────────
    document.getElementById("progress-bar").style.width      = `${s.progress}%`;
    document.getElementById("progress-label").textContent    = `${s.progress}%`;
    document.getElementById("benchmark-bar").style.width     = `${Math.min(s.progress + 5, 100)}%`;

    // ── Latest GPS coords ─────────────────────────────────────────────────────
    if (s.latest_weather) {
        document.getElementById("live-lat").textContent = `${s.latest_weather.lat.toFixed(2)}° N`;
        document.getElementById("live-lng").textContent = `${s.latest_weather.lng.toFixed(2)}° E`;
        document.getElementById("storm-flag").textContent = s.latest_weather.storm_flag ? "⚠ STORM ALERT" : "Clear";
        document.getElementById("storm-flag").style.color = s.latest_weather.storm_flag ? "#fb6b00" : "#4ADE80";
        // Wind from DB as fallback until API loads
        document.getElementById("live-wind").textContent = `${s.latest_weather.wind_speed_kmh} km/h`;
    }

    // ── Map ───────────────────────────────────────────────────────────────────
    renderMap(s);

    // ── Timeline ──────────────────────────────────────────────────────────────
    renderTimeline(s);
}

// ── Render SVG Map ────────────────────────────────────────────────────────────

function renderMap(s) {
    const snapshots = s.weather_snapshots || [];
    const W = 800, H = 500;

    // Collect all points: snapshots + destination (approximate)
    // We'll normalize coords to SVG space
    if (snapshots.length === 0) return;

    const lats = snapshots.map(w => w.lat);
    const lngs = snapshots.map(w => w.lng);

    const minLat = Math.min(...lats) - 3;
    const maxLat = Math.max(...lats) + 3;
    const minLng = Math.min(...lngs) - 3;
    const maxLng = Math.max(...lngs) + 3;

    const toX = (lng) => ((lng - minLng) / (maxLng - minLng)) * (W - 100) + 50;
    const toY = (lat) => H - ((lat - minLat) / (maxLat - minLat)) * (H - 100) - 50;

    // Build solid path from snapshots (actual route taken)
    const solidPoints = snapshots.map(w => `${toX(w.lng)},${toY(w.lat)}`).join(" L ");
    const solidPath   = `M ${solidPoints}`;

    // Current position = last snapshot
    const last    = snapshots[snapshots.length - 1];
    const currX   = toX(last.lng);
    const currY   = toY(last.lat);

    // First position
    const first   = snapshots[0];
    const firstX  = toX(first.lng);
    const firstY  = toY(first.lat);

    // Destination dot — place at far right as placeholder since we don't have dest coords
    const destX = W - 60;
    const destY = 60;

    const svg = document.getElementById("route-map-svg");
    svg.innerHTML = `
        <!-- Grid lines -->
        <line x1="0" y1="${H*0.25}" x2="${W}" y2="${H*0.25}" stroke="rgba(186,200,220,0.05)" stroke-width="1"/>
        <line x1="0" y1="${H*0.5}"  x2="${W}" y2="${H*0.5}"  stroke="rgba(186,200,220,0.05)" stroke-width="1"/>
        <line x1="0" y1="${H*0.75}" x2="${W}" y2="${H*0.75}" stroke="rgba(186,200,220,0.05)" stroke-width="1"/>

        <!-- Dotted future path to destination -->
        <line x1="${currX}" y1="${currY}" x2="${destX}" y2="${destY}"
              stroke="#fb6b00" stroke-width="2" stroke-dasharray="8 6" stroke-opacity="0.5"/>

        <!-- Solid actual route -->
        <path d="${solidPath}" stroke="#fb6b00" stroke-width="3"
              fill="none" stroke-linecap="round" stroke-linejoin="round"/>

        <!-- Origin dot -->
        <circle cx="${firstX}" cy="${firstY}" r="5" fill="#fb6b00"/>
        <text x="${firstX + 8}" y="${firstY + 4}" fill="#bac8dc" font-family="Inter"
              font-size="10" font-weight="600">${s.cargo.origin}</text>

        <!-- Destination dot -->
        <circle cx="${destX}" cy="${destY}" r="5" fill="#bac8dc" opacity="0.6"/>
        <text x="${destX - 10}" y="${destY - 10}" fill="#bac8dc" font-family="Inter"
              font-size="10" font-weight="600">${s.cargo.destination}</text>

        <!-- Current vessel -->
        <circle cx="${currX}" cy="${currY}" r="14" stroke="#fb6b00"
                stroke-width="1.5" fill="rgba(251,107,0,0.1)" class="animate-pulse"/>
        <rect x="${currX - 10}" y="${currY - 10}" width="20" height="20"
              rx="4" fill="#fb6b00"/>
        <text x="${currX - 6}" y="${currY + 5}" fill="#000" font-family="Inter"
              font-size="10" font-weight="900">▲</text>

        <!-- Coords label -->
        <text x="${currX + 18}" y="${currY - 4}" fill="#fb6b00" font-family="Inter"
              font-size="9" font-weight="700">${last.lat.toFixed(2)}°N, ${last.lng.toFixed(2)}°E</text>
    `;
}

// ── Render Timeline ───────────────────────────────────────────────────────────

function renderTimeline(s) {
    const container  = document.getElementById("timeline-items");
    const snapshots  = s.weather_snapshots || [];
    const now        = new Date();

    // Build timeline events from snapshots + schedule
    const events = [];

    // Scheduled departure (origin)
    events.push({
        label:    `${s.cargo.origin} (${s.type === "incoming" ? "Origin" : "Departure"})`,
        sub:      `Scheduled: ${new Date(s.schedule.arrival).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        done:     true,
        current:  false
    });

    // Weather snapshots as waypoints
    snapshots.slice(0, -1).forEach((w, i) => {
        const ts = new Date(w.timestamp);
        events.push({
            label:   `Waypoint ${i + 1} — ${w.lat.toFixed(1)}°N ${w.lng.toFixed(1)}°E`,
            sub:     `${ts.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} UTC${w.storm_flag ? " ⚠ Storm" : ""}`,
            done:    ts < now,
            current: false
        });
    });

    // Current position
    if (snapshots.length > 0) {
        const last = snapshots[snapshots.length - 1];
        events.push({
            label:   `Current Position — ${last.lat.toFixed(2)}°N ${last.lng.toFixed(2)}°E`,
            sub:     "Tracking Active",
            done:    false,
            current: true
        });
    }

    // Destination
    events.push({
        label:   `${s.cargo.destination} (${s.type === "incoming" ? "Destination" : "Arrival"})`,
        sub:     `ETA: ${new Date(s.schedule.departure).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        done:    false,
        current: false
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
                        : `<span class="material-symbols-outlined text-[12px] text-outline-variant">schedule</span>`
                }
            </div>
            <div>
                <p class="text-sm font-bold ${ev.current ? "text-[#fb6b00]" : ev.done ? "text-on-surface" : "text-on-surface-variant"}">${ev.label}</p>
                <p class="text-xs text-on-surface-variant mt-0.5">${ev.sub}</p>
            </div>
        `;
        container.appendChild(div);
    });
}

// ── Error state ───────────────────────────────────────────────────────────────

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

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchShipmentDetail();