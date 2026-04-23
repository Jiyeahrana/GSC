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
    const svg = document.getElementById("route-map-svg");

    if (snapshots.length === 0) {
        svg.innerHTML = `<text x="400" y="250" fill="#44474c" font-family="Inter" font-size="12" text-anchor="middle">No route data available</text>`;
        return;
    }

    const lats = snapshots.map(w => w.lat);
    const lngs = snapshots.map(w => w.lng);

    // Add padding so points aren't at edges
    const latPad = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.3, 5);
    const lngPad = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.3, 5);

    const minLat = Math.min(...lats) - latPad;
    const maxLat = Math.max(...lats) + latPad;
    const minLng = Math.min(...lngs) - lngPad;
    const maxLng = Math.max(...lngs) + lngPad;

    const toX = (lng) => ((lng - minLng) / (maxLng - minLng)) * (W - 140) + 70;
    const toY = (lat) => H - ((lat - minLat) / (maxLat - minLat)) * (H - 140) - 70;

    const first  = snapshots[0];
    const last   = snapshots[snapshots.length - 1];
    const firstX = toX(first.lng);
    const firstY = toY(first.lat);
    const currX  = toX(last.lng);
    const currY  = toY(last.lat);

    // Destination placed intelligently relative to current pos
    // Put it offset from current so dotted line is visible
    const isArrived = ["arrived", "at_port", "departed"].includes(s.status);

    // Destination X/Y: place toward upper-right of the map but away from curr
    const destX = Math.min(currX + 180, W - 80);
    const destY = Math.max(currY - 120, 60);

    // Build smooth path using quadratic curves between snapshots
    let pathD = "";
    if (snapshots.length === 1) {
        pathD = `M ${currX},${currY}`;
    } else {
        pathD = `M ${toX(snapshots[0].lng)},${toY(snapshots[0].lat)}`;
        for (let i = 1; i < snapshots.length; i++) {
            const px = toX(snapshots[i].lng);
            const py = toY(snapshots[i].lat);
            if (i === 1) {
                pathD += ` L ${px},${py}`;
            } else {
                // Midpoint smoothing
                const prevX = toX(snapshots[i-1].lng);
                const prevY = toY(snapshots[i-1].lat);
                const midX  = (prevX + px) / 2;
                const midY  = (prevY + py) / 2;
                pathD += ` Q ${prevX},${prevY} ${midX},${midY}`;
            }
        }
        pathD += ` L ${currX},${currY}`;
    }

    // Label placement — keep origin label away from vessel
    const originLabelX = firstX > 400 ? firstX - 80 : firstX + 10;
    const originLabelY = firstY > 400 ? firstY - 10 : firstY + 18;

    // Coords label — place below vessel if near top, above if near bottom
    const coordLabelX = currX + 20;
    const coordLabelY = currY > 400 ? currY - 20 : currY + 25;

    // Dest label placement
    const destLabelX = destX > 650 ? destX - 100 : destX + 12;
    const destLabelY = destY < 80 ? destY + 18 : destY - 10;

    svg.innerHTML = `
        <!-- Background grid -->
        <line x1="0" y1="${H*0.25}" x2="${W}" y2="${H*0.25}" stroke="rgba(186,200,220,0.04)" stroke-width="1"/>
        <line x1="0" y1="${H*0.5}"  x2="${W}" y2="${H*0.5}"  stroke="rgba(186,200,220,0.04)" stroke-width="1"/>
        <line x1="0" y1="${H*0.75}" x2="${W}" y2="${H*0.75}" stroke="rgba(186,200,220,0.04)" stroke-width="1"/>
        <line x1="${W*0.33}" y1="0" x2="${W*0.33}" y2="${H}" stroke="rgba(186,200,220,0.04)" stroke-width="1"/>
        <line x1="${W*0.66}" y1="0" x2="${W*0.66}" y2="${H}" stroke="rgba(186,200,220,0.04)" stroke-width="1"/>

        <!-- Glow under route -->
        <path d="${pathD}" stroke="#fb6b00" stroke-width="6"
              fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.15"/>

        <!-- Solid actual route -->
        <path d="${pathD}" stroke="#fb6b00" stroke-width="2.5"
              fill="none" stroke-linecap="round" stroke-linejoin="round"/>

        ${!isArrived ? `
        <!-- Dotted future path to destination -->
        <line x1="${currX}" y1="${currY}" x2="${destX}" y2="${destY}"
              stroke="#bac8dc" stroke-width="1.5" stroke-dasharray="6 5" stroke-opacity="0.4"/>
        ` : ""}

        <!-- Origin dot + label -->
        <circle cx="${firstX}" cy="${firstY}" r="5" fill="#fb6b00" opacity="0.8"/>
        <circle cx="${firstX}" cy="${firstY}" r="9" stroke="#fb6b00" stroke-width="1"
                fill="none" opacity="0.3"/>
        <text x="${originLabelX}" y="${originLabelY}" fill="#bac8dc" font-family="Inter"
              font-size="10" font-weight="600">${s.cargo.origin}</text>

        <!-- Destination dot + label -->
        <circle cx="${destX}" cy="${destY}" r="5"
                fill="${isArrived ? '#4ADE80' : '#bac8dc'}" opacity="0.7"/>
        <circle cx="${destX}" cy="${destY}" r="9"
                stroke="${isArrived ? '#4ADE80' : '#bac8dc'}" stroke-width="1"
                fill="none" opacity="0.3"/>
        <text x="${destLabelX}" y="${destLabelY}" fill="#bac8dc" font-family="Inter"
              font-size="10" font-weight="600">${s.cargo.destination}</text>

        ${isArrived ? `
        <!-- Arrived — vessel shown at destination -->
        <circle cx="${destX}" cy="${destY}" r="16" stroke="#4ADE80"
                stroke-width="1.5" fill="rgba(74,222,128,0.1)"/>
        <rect x="${destX - 10}" y="${destY - 10}" width="20" height="20"
              rx="4" fill="#4ADE80"/>
        <text x="${destX - 6}" y="${destY + 5}" fill="#000" font-family="Inter"
              font-size="10" font-weight="900">▲</text>
        <text x="${destX + 20}" y="${destY + 4}" fill="#4ADE80" font-family="Inter"
              font-size="9" font-weight="700">ARRIVED</text>
        ` : `
        <!-- In transit — vessel at current position -->
        <circle cx="${currX}" cy="${currY}" r="16" stroke="#fb6b00"
                stroke-width="1.5" fill="rgba(251,107,0,0.1)"/>
        <rect x="${currX - 10}" y="${currY - 10}" width="20" height="20"
              rx="4" fill="#fb6b00"/>
        <text x="${currX - 6}" y="${currY + 5}" fill="#000" font-family="Inter"
              font-size="10" font-weight="900">▲</text>

        <!-- Coords label — separated from vessel icon -->
        <rect x="${coordLabelX - 2}" y="${coordLabelY - 12}" width="130" height="16"
              rx="3" fill="rgba(0,21,35,0.7)"/>
        <text x="${coordLabelX + 2}" y="${coordLabelY}" fill="#fb6b00" font-family="Inter"
              font-size="9" font-weight="700">${last.lat.toFixed(2)}°N  ${last.lng.toFixed(2)}°E</text>
        `}
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

    // Current position — only show if not yet arrived
    const isArrived = ["arrived", "at_port", "departed"].includes(s.status);
    if (snapshots.length > 0 && !isArrived) {
        const last = snapshots[snapshots.length - 1];
        events.push({
            label:   `Current Position — ${last.lat.toFixed(2)}°N ${last.lng.toFixed(2)}°E`,
            sub:     "Tracking Active",
            done:    false,
            current: true
        });
    }

    // Destination
    const isArrivedFinal = ["arrived", "at_port", "departed"].includes(s.status);
    events.push({
        label:   `${s.cargo.destination} (${s.type === "incoming" ? "Destination" : "Arrival"})`,
        sub:     isArrivedFinal
            ? `Arrived: ${new Date(s.actual?.arrival || s.schedule.departure).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : `ETA: ${new Date(s.schedule.departure).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
        done:    isArrivedFinal,
        current: isArrivedFinal
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