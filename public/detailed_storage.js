// ── Auth ──────────────────────────────────────────────────────────────────────

const token  = localStorage.getItem("token");
const portId = localStorage.getItem("port_id");

if (!token) window.location.href = "/index.html";

// ── Logout ────────────────────────────────────────────────────────────────────

document.getElementById("logout-btn").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = "/index.html";
});

// ── Sidebar port name ─────────────────────────────────────────────────────────

document.getElementById("sidebar-port-name").textContent =
    localStorage.getItem("port_name") || "Port";

// ── State ─────────────────────────────────────────────────────────────────────

let zonesData    = [];
let sensorData   = {};
let selectedZone = null;

// ── Fetch zone definitions from MongoDB ───────────────────────────────────────

async function fetchZones() {
    try {
        const res = await fetch("https://gsc-app-630083017128.us-central1.run.app/api/v1/port/zones", {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "/index.html";
            return;
        }

        const data = await res.json();
        if (!data.success) return;

        zonesData = data.zones;

        document.getElementById("hud-total-capacity").textContent =
            data.total_capacity.toLocaleString() + " UNITS";

        renderZoneCards();
        updateGlobalOccupancy();

    } catch (err) {
        console.error("Fetch zones error:", err);
    }
}

// ── Firebase live sensor listener — registered ONCE ──────────────────────────

function startSensorListener() {
    if (!portId) return;

    firebaseDB.ref(`sensor_readings/${portId}`).on("value", (snapshot) => {
        sensorData = snapshot.val() || {};
        if (zonesData.length > 0) {
            renderZoneCards();
            updateGlobalOccupancy();
        }
        // ← ADD THIS: reload prediction whenever sensor data updates
        loadCapacityPrediction();
    });
}

// ── Calculate occupancy % for a zone ─────────────────────────────────────────

function getZoneOccupancy(zone) {
    if (!zone) return { count: 0, max: 0, pct: 0, available: 0 };

    // Build the Firebase key from zone name — "Zone A" → "zone_A"
    const parts   = zone.name?.split(" ") || [];
    const letter  = parts[1] || zone.zone_id || "A";
    const zoneKey = `zone_${letter}`;

    const sensor  = sensorData[zoneKey];
    const count   = sensor?.container_count || 0;
    const max     = zone.max_capacity || 0;

    return {
        count,
        max,
        pct:       max > 0 ? Math.min(Math.round((count / max) * 100), 100) : 0,
        available: max - count
    };
}

// ── Status label + colors ─────────────────────────────────────────────────────

function getZoneStatus(pct) {
    if (pct >= 90) return { label: "Critical",  bgClass: "bg-error-container",      textClass: "text-on-error-container",      accentColor: "#fb6b00" };
    if (pct >= 70) return { label: "High Load", bgClass: "bg-tertiary-container/20", textClass: "text-tertiary-container",       accentColor: "#fb6b00" };
    if (pct >= 40) return { label: "Optimal",   bgClass: "bg-secondary-container",  textClass: "text-on-secondary-container",   accentColor: "#a4cce8" };
    return             { label: "Low",       bgClass: "bg-secondary-container",  textClass: "text-on-secondary-container",   accentColor: "#a4cce8" };
}

// ── AI insight ────────────────────────────────────────────────────────────────

function getAiInsight(pct, zoneName) {
    if (pct >= 90) return `${zoneName} is at critical capacity. Immediate load balancing or offloading is recommended.`;
    if (pct >= 70) return `${zoneName} is under high load. Monitor closely and consider pre-emptive redistribution.`;
    if (pct >= 40) return `${zoneName} is operating within optimal range. No action required.`;
    return `${zoneName} has low utilization. Available for incoming shipments or reallocation.`;
}

// ── Prediction text ───────────────────────────────────────────────────────────

function getPredictionText(pct) {
    if (pct >= 90) return "At current intake rate, overflow risk within 1–2 days.";
    if (pct >= 70) return "Estimated to reach 90% capacity within 3–5 days.";
    if (pct >= 40) return "Stable. No capacity issues forecast in the next 10 days.";
    return "Low utilization expected to continue. Capacity is not a concern.";
}

// ── Render zone cards ─────────────────────────────────────────────────────────

function renderZoneCards() {
    const container = document.getElementById("zones-grid");
    if (!container) return;
    container.innerHTML = "";

    zonesData.forEach(zone => {
        const { count, max, pct, available } = getZoneOccupancy(zone);
        const status      = getZoneStatus(pct);
        const fillColor   = pct >= 40
            ? "linear-gradient(to top, rgba(251,107,0,0.8), rgba(251,107,0,0.4))"
            : "linear-gradient(to top, rgba(164,204,232,0.8), rgba(164,204,232,0.4))";
        const accentColor = status.accentColor;
        const topZ        = ((pct / 100) * 80) - 40;

        const card = document.createElement("div");
        card.className = "bg-surface-container-high rounded-xl p-6 relative overflow-hidden group hover:bg-surface-variant transition-all duration-500 cursor-pointer";

        card.innerHTML = `
            <div class="absolute top-0 left-0 w-1 h-full" style="background:${accentColor}"></div>
            <div class="flex justify-between items-start mb-8">
                <div>
                    <h3 class="text-xl font-bold font-headline">${zone.name}</h3>
                    <span class="text-[10px] ${status.bgClass} ${status.textClass} px-2 py-0.5 rounded font-bold uppercase">
                        ${status.label}
                    </span>
                </div>
                <span class="text-3xl font-extrabold font-headline" style="color:${accentColor}">${pct}%</span>
            </div>
            <div class="flex justify-center py-8">
                <div class="isometric-cube">
                    <div class="cube-face cube-bottom bg-surface-container-highest"></div>
                    <div class="cube-face cube-back"></div>
                    <div class="cube-face cube-left"></div>
                    <div class="cube-face cube-right overflow-hidden">
                        <div class="fill-volume" style="height:${pct}%; background:${fillColor}"></div>
                    </div>
                    <div class="cube-face cube-front overflow-hidden">
                        <div class="fill-volume" style="height:${pct}%; background:${fillColor}"></div>
                    </div>
                    <div class="cube-face cube-top"
                         style="transform: rotateX(90deg) translateZ(${topZ}px);
                                background: ${accentColor}66;
                                backdrop-filter: blur(2px);
                                border-color: ${accentColor}66">
                    </div>
                </div>
            </div>
            <div class="mt-8 space-y-2">
                <div class="flex justify-between text-xs text-on-surface-variant">
                    <span>Containers</span>
                    <span class="text-on-surface">${count.toLocaleString()} / ${max.toLocaleString()}</span>
                </div>
                <div class="flex justify-between text-xs text-on-surface-variant">
                    <span>Available</span>
                    <span class="text-on-surface">${available.toLocaleString()}</span>
                </div>
                <div class="flex justify-end mt-2">
                    <span class="openBtn material-symbols-outlined cursor-pointer text-on-surface-variant hover:text-primary transition-colors">
                        open_in_full
                    </span>
                </div>
            </div>
        `;

        // ── FIX: use zone._id consistently everywhere ──────────────────────
        card.querySelector(".openBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            openPopup(zone._id);
        });
        card.addEventListener("click", () => openPopup(zone._id));

        container.appendChild(card);
    });
}

// ── Update global occupancy ───────────────────────────────────────────────────

function updateGlobalOccupancy() {
    if (zonesData.length === 0) return;

    let totalContainers = 0;
    let totalCapacity   = 0;

    zonesData.forEach(zone => {
        const { count, max } = getZoneOccupancy(zone);
        totalContainers += count;
        totalCapacity   += max;
    });

    const globalPct = totalCapacity > 0
        ? Math.min(Math.round((totalContainers / totalCapacity) * 100), 100)
        : 0;

    document.getElementById("hud-global-occupancy").textContent = globalPct + "%";
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function openPopup(zoneId) {
    // ── FIX: find by _id ──────────────────────────────────────────────────────
    const zone = zonesData.find(z => z._id === zoneId);
    if (!zone) {
        console.warn("Zone not found for id:", zoneId);
        return;
    }

    selectedZone = zone;

    const { count, max, pct, available } = getZoneOccupancy(zone);
    const status = getZoneStatus(pct);

    document.getElementById("popup-zone-name").textContent  = zone.name.toUpperCase();
    document.getElementById("popup-zone-status").textContent = status.label;
    document.getElementById("popup-total").textContent       = max.toLocaleString();
    document.getElementById("popup-occupied").textContent    = count.toLocaleString();
    document.getElementById("popup-available").textContent   = available.toLocaleString();
    document.getElementById("popup-bar").style.width         = `${pct}%`;
    document.getElementById("popup-pct-label").textContent   = `${pct}% capacity used`;
    document.getElementById("popup-prediction").textContent  = getPredictionText(pct);
    document.getElementById("popup-insight").textContent     = getAiInsight(pct, zone.name);

    const popup = document.getElementById("popup");
    popup.classList.remove("hidden");
    popup.classList.add("flex");
}

function closePopup() {
    const popup = document.getElementById("popup");
    popup.classList.add("hidden");
    popup.classList.remove("flex");
}

document.getElementById("closeBtn").addEventListener("click", closePopup);

document.getElementById("popup").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePopup();
});

async function loadCapacityPrediction() {
    try {
        const currentUsed = Object.values(sensorData)
            .reduce((sum, zone) => sum + (zone.container_count || 0), 0);

        const res = await fetch(
            `https://gsc-app-630083017128.us-central1.run.app/api/v1/port/ports/${portId}/capacity-prediction?current_used=${currentUsed}`,
            { headers: { "Authorization": `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!data.success) return;

        const days = data.days;
        const maxPct = Math.max(...days.map(d => d.pct), 1);
        const peakDate = new Date(data.peak_date).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric"
        });

        // Update peak date card
        document.getElementById("peak-date-label").textContent = peakDate;

        // Overflow risk
        const peakPct = Math.max(...days.map(d => d.pct));
        const riskEl = document.getElementById("overflow-risk-label");
        if (peakPct >= 90)      riskEl.textContent = "High";
        else if (peakPct >= 70) riskEl.textContent = "Medium";
        else if (peakPct >= 40) riskEl.textContent = "Medium-Low";
        else                    riskEl.textContent = "Low";

        // Render bars
        const container = document.querySelector(".chart-bars-container");
        container.innerHTML = "";

        days.forEach(day => {
            const date = new Date(day.date);
            const dateStr = date.toLocaleDateString("en-IN", {
                day: "2-digit", month: "short"
            }).toUpperCase().replace(" ", " ");

            const barHeightPx = Math.max(Math.round((day.pct / maxPct) * 220), 8);
            const innerHeightPct = Math.round(day.pct * 0.75);
            const isToday = date.toDateString() === new Date().toDateString();

            const col = document.createElement("div");
            col.className = "flex flex-col items-center flex-1 group cursor-pointer";
            col.innerHTML = `
                <div class="w-full bg-surface-container-highest rounded-t relative transition-all group-hover:bg-brand-orange/20"
                     style="height: ${barHeightPx}px">
                    <div class="absolute bottom-0 left-0 w-full bg-secondary/30"
                         style="height: ${innerHeightPct}%"></div>
                    <div class="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-brand-orange rounded-full shadow-lg shadow-brand-orange/50"></div>
                    <!-- Tooltip -->
                    <div class="absolute -top-10 left-1/2 -translate-x-1/2 bg-surface-container-highest px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        ${day.pct}% (${day.predicted_used} units)
                    </div>
                </div>
                <span class="mt-4 text-[10px] font-bold uppercase tracking-widest ${isToday ? 'text-brand-orange' : 'text-on-surface-variant'}">
                    ${dateStr}
                </span>
            `;
            container.appendChild(col);
        });

    } catch (err) {
        console.error("Prediction load error:", err);
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchZones();
startSensorListener();