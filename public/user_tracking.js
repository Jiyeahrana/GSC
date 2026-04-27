/**
 * NAUTICAL.OS — Public Tracking Page (user_tracking.js)
 * Full replacement — adds route progress panel to the tracking result.
 */

const BASE_URL = "http://localhost:3000/api/v1/public";

// ── Load ports into dropdown ──────────────────────────────────────────────────
async function loadPorts() {
    try {
        const res  = await fetch(`${BASE_URL}/ports`);
        const data = await res.json();
        if (!data.success) return;

        const select = document.getElementById("portSelect");
        select.innerHTML = `<option value="">-- Select a Port --</option>`;
        data.data.forEach(port => {
            const option       = document.createElement("option");
            option.value       = port.id;
            option.textContent = `${port.name} — ${port.city}, ${port.country}`;
            select.appendChild(option);
        });
    } catch (err) {
        console.error("Load ports error:", err);
    }
}

// ── Load port timeline ────────────────────────────────────────────────────────
async function loadPortTimeline() {
    const portId = document.getElementById("portSelect").value;
    if (!portId) return;
    try {
        const res  = await fetch(`${BASE_URL}/ports/${portId}/timeline`);
        const data = await res.json();
        if (!data.success) { alert("Could not load timeline for this port"); return; }

        document.getElementById("portTitle").textContent = data.port.name.toUpperCase();

        const inPort   = data.shipments.filter(s => s.status === "at_port").length;
        const upcoming = data.shipments.filter(s => ["registered","in_transit"].includes(s.status)).length;
        document.getElementById("timeline-upcoming").textContent = `UPCOMING: ${upcoming}`;
        document.getElementById("timeline-inport").textContent   = `IN PORT: ${inPort}`;

        renderTimeline(data.shipments);
        document.getElementById("portTimeline").classList.remove("hidden");
    } catch (err) {
        console.error("Load timeline error:", err);
    }
}

// ── Render timeline items ─────────────────────────────────────────────────────
function renderTimeline(shipments) {
    const container = document.getElementById("timeline-items");
    container.innerHTML = "";

    if (!shipments.length) {
        container.innerHTML = `<p class="text-on-surface-variant text-sm pl-12">No shipments scheduled</p>`;
        return;
    }

    shipments.slice(0, 10).forEach(shipment => {
        const arrival  = new Date(shipment.schedule.arrival);
        const now      = new Date();
        const isToday  = arrival.toDateString() === now.toDateString();

        const timeStr = arrival.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });
        const dateStr = isToday ? "TODAY" : arrival.toLocaleDateString("en-IN", { day:"2-digit", month:"short" }).toUpperCase();

        const typeColor   = shipment.type === "incoming" ? "#639922" : "#E24B4A";
        const typeLabel   = shipment.type === "incoming" ? "ARRIVAL"  : "DEPARTURE";
        const statusColor = getStatusColor(shipment.status);

        const item = document.createElement("div");
        item.className = "relative pl-12 flex flex-col md:flex-row md:items-center gap-4";
        item.innerHTML = `
            <div class="absolute left-[13px] top-1.5 w-2 h-2 rounded-full ring-4 ring-surface"
                 style="background: ${typeColor}"></div>
            <div class="w-24 shrink-0">
                <div class="text-xs font-bold">${timeStr}</div>
                <div class="text-[10px] text-outline">${dateStr}</div>
            </div>
            <div class="flex-1 bg-surface-container-low p-4 rounded-lg">
                <div class="flex justify-between items-start">
                    <div>
                        <span class="text-[10px] font-bold uppercase block mb-1" style="color:${typeColor}">${typeLabel}</span>
                        <h3 class="font-bold text-sm">${shipment.vessel.name}</h3>
                    </div>
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold"
                          style="color:${statusColor};background:${statusColor}20">
                        ${shipment.status.replace("_"," ").toUpperCase()}
                    </span>
                </div>
            </div>`;
        container.appendChild(item);
    });
}

function getStatusColor(status) {
    const map = {
        at_port:    "#5DCAA5", in_transit: "#bac8dc",
        delayed:    "#ffb692", arrived:    "#639922",
        departed:   "#E24B4A"
    };
    return map[status] || "#8e9196";
}

// ── Track shipment by ID ──────────────────────────────────────────────────────
async function trackShipment() {
    const trackingId = document.getElementById("trackingInput").value.trim();
    if (!trackingId) { showTrackingError("Please enter a tracking ID"); return; }

    const btn       = document.getElementById("searchbtn");
    btn.textContent = "Searching...";
    btn.disabled    = true;

    try {
        const res  = await fetch(`${BASE_URL}/track/${trackingId}`);
        const data = await res.json();

        if (!data.success) {
            showTrackingError("Shipment not found. Please check your tracking ID.");
            return;
        }
        populateTrackingResult(data.data);
    } catch (err) {
        console.error("Track error:", err);
        showTrackingError("Could not connect to server. Please try again.");
    } finally {
        btn.textContent = "Search";
        btn.disabled    = false;
    }
}

// ── Populate tracking result + route progress ─────────────────────────────────
function populateTrackingResult(shipment) {
    document.getElementById("tracking-error").classList.add("hidden");

    const eta = shipment.actual?.arrival
        ? new Date(shipment.actual.arrival).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" })
        : new Date(shipment.schedule.arrival).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });

    const lat = shipment.latest_weather?.lat?.toFixed(4) || "—";
    const lng = shipment.latest_weather?.lng?.toFixed(4) || "—";
    const statusColor = getStatusColor(shipment.status);

    document.getElementById("result-vessel").textContent  = shipment.vessel_name;
    document.getElementById("result-type").textContent    = shipment.type === "incoming" ? "INCOMING" : "OUTGOING";
    document.getElementById("result-status").textContent  = shipment.status.replace("_"," ").toUpperCase();
    document.getElementById("result-status").style.color  = statusColor;
    document.getElementById("result-eta").textContent     = eta;
    document.getElementById("result-lat").textContent     = lat + "° N";
    document.getElementById("result-lng").textContent     = lng + "° E";

    if (shipment.latest_weather) {
        document.getElementById("result-wind").textContent  = shipment.latest_weather.wind_speed_kmh + " km/h";
        document.getElementById("result-storm").textContent = shipment.latest_weather.storm_flag ? "YES — CAUTION" : "No";
        document.getElementById("result-storm").style.color = shipment.latest_weather.storm_flag ? "#ffb692" : "#5DCAA5";
        document.getElementById("weather-row").classList.remove("hidden");
    } else {
        document.getElementById("weather-row").classList.add("hidden");
    }

    document.getElementById("trackingResult").classList.remove("hidden");
    document.getElementById("trackingresult").classList.remove("hidden");

    // ── Route Progress Panel (NEW) ───────────────────────────────────────────
    renderPublicRouteProgress(shipment);
}

// ── Public Route Progress Panel ───────────────────────────────────────────────
function renderPublicRouteProgress(shipment) {
    // Remove any existing panel
    document.getElementById("public-route-panel")?.remove();

    const rp  = shipment.route_progress;
    const cps = shipment.checkpoints || [];

    const panel = document.createElement("div");
    panel.id    = "public-route-panel";

    // Inject after the telemetry card
    const telemetry = document.getElementById("trackingresult");
    telemetry?.parentNode?.insertBefore(panel, telemetry.nextSibling);

    if (!rp || cps.length === 0) {
        panel.innerHTML = `
            <div style="margin-top:12px;background:rgba(23,44,59,0.7);backdrop-filter:blur(24px);
                border-top:1px solid rgba(214,228,249,0.1);border-radius:12px;padding:16px;
                display:flex;align-items:center;gap:10px;color:#8e9196;">
                <span style="font-size:16px;">🗺️</span>
                <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">
                    Route planning in progress
                </span>
            </div>`;
        return;
    }

    const reached = cps.filter(c => c.status === "reached").length;
    const missed  = cps.filter(c => c.status === "missed").length;
    const total   = cps.length;
    const pct     = Math.round((reached / total) * 100);
    const onTimeColor = rp.on_time ? "#5DCAA5" : "#ffb692";

    const delayLabel = rp.delay_minutes > 0
        ? `+${rp.delay_minutes}min behind`
        : rp.delay_minutes < 0
            ? `${Math.abs(rp.delay_minutes)}min ahead`
            : "On schedule";

    let etaStr = "—";
    if (rp.eta_to_next_checkpoint_min !== null) {
        const h = Math.floor(rp.eta_to_next_checkpoint_min / 60);
        const m = rp.eta_to_next_checkpoint_min % 60;
        etaStr  = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    panel.innerHTML = `
        <div style="margin-top:12px;background:rgba(23,44,59,0.7);backdrop-filter:blur(24px);
            border-top:1px solid rgba(214,228,249,0.1);border-radius:12px;padding:16px;
            font-family:'Inter',sans-serif;">

            <!-- Header -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#bac8dc;">
                    🧭 Route Progress
                </span>
                <span style="font-size:10px;font-weight:700;color:${onTimeColor};
                    background:${onTimeColor}18;padding:2px 8px;border-radius:20px;">
                    ${rp.on_time ? "✓ On Time" : "⚠ Delayed"} · ${delayLabel}
                </span>
            </div>

            <!-- Progress bar -->
            <div style="margin-bottom:12px;">
                <div style="width:100%;height:5px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;">
                    <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#60a5fa,#bac8dc);
                        border-radius:4px;transition:width 0.6s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;margin-top:4px;">
                    <span style="font-size:9px;color:#8e9196;">${reached}/${total} checkpoints</span>
                    <span style="font-size:9px;font-weight:700;color:#d0e5f9;">${pct}%</span>
                </div>
            </div>

            <!-- Stats -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
                <div style="background:rgba(96,165,250,0.08);border-radius:8px;padding:8px;text-align:center;">
                    <div style="font-size:16px;font-weight:800;color:#60a5fa;">${reached}</div>
                    <div style="font-size:8px;color:#8e9196;text-transform:uppercase;letter-spacing:0.06em;">Reached</div>
                </div>
                <div style="background:rgba(248,113,113,0.08);border-radius:8px;padding:8px;text-align:center;">
                    <div style="font-size:16px;font-weight:800;color:#f87171;">${missed}</div>
                    <div style="font-size:8px;color:#8e9196;text-transform:uppercase;letter-spacing:0.06em;">Missed</div>
                </div>
                <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;text-align:center;">
                    <div style="font-size:14px;font-weight:800;color:#bac8dc;">${etaStr}</div>
                    <div style="font-size:8px;color:#8e9196;text-transform:uppercase;letter-spacing:0.06em;">To Next CP</div>
                </div>
            </div>

            <!-- Next checkpoint -->
            <div style="display:flex;justify-content:space-between;align-items:center;
                background:rgba(186,200,220,0.05);border-radius:8px;padding:10px 12px;
                border-left:2px solid #60a5fa;">
                <div>
                    <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#8e9196;">Approaching</div>
                    <div style="font-size:12px;font-weight:700;color:#d0e5f9;margin-top:2px;">${rp.next_checkpoint_name}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:8px;text-transform:uppercase;letter-spacing:0.08em;color:#8e9196;">ETA</div>
                    <div style="font-size:16px;font-weight:800;color:#bac8dc;font-family:'Manrope',sans-serif;">${etaStr}</div>
                </div>
            </div>

            <!-- Checkpoint pills -->
            <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
                ${cps.map((cp, i) => {
                    const c = cp.status === "reached" ? "#4ADE80"
                            : cp.status === "missed"  ? "#f87171"
                            : "#94a3b8";
                    const icon = cp.status === "reached" ? "✓" : cp.status === "missed" ? "✗" : `${i+1}`;
                    return `<div title="${cp.name} · ${cp.status}"
                        style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;
                            background:${c}15;border:1px solid ${c}44;font-size:9px;font-weight:700;color:${c};">
                        ${icon} CP${i+1}
                    </div>`;
                }).join("")}
            </div>
        </div>`;
}

function showTrackingError(message) {
    document.getElementById("trackingResult").classList.add("hidden");
    document.getElementById("trackingresult").classList.add("hidden");
    document.getElementById("public-route-panel")?.remove();
    const err = document.getElementById("tracking-error");
    err.textContent = message;
    err.classList.remove("hidden");
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById("searchbtn").addEventListener("click", trackShipment);
document.getElementById("trackingInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") trackShipment();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => { loadPorts(); });