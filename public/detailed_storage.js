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

let zonesData    = [];   // MongoDB zone definitions
let sensorData   = {};   // Firebase live sensor counts
let selectedZone = null; // currently open in popup

// ── Fetch zone definitions from MongoDB ───────────────────────────────────────

async function fetchZones() {
    try {
        const res = await fetch("http://localhost:3000/api/v1/port/zones", {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "/index.html";
            return;
        }

        const data = await res.json();
console.log("Full API response:", JSON.stringify(data));
        if (!data.success) return;

        zonesData = data.zones;

        // Update header HUD total capacity
        document.getElementById("hud-total-capacity").textContent =
            data.total_capacity.toLocaleString() + " UNITS";

        renderZoneCards();

        // ✅ FIX: Also update global occupancy after zones load,
        // in case Firebase fires before zonesData is populated
        updateGlobalOccupancy();

    } catch (err) {
        console.error("Fetch zones error:", err);
    }
}

// ── Firebase live sensor listener ─────────────────────────────────────────────

function startSensorListener() {
    if (!portId) return;

    firebaseDB.ref(`sensor_readings/${portId}`).on("value", (snapshot) => {
        sensorData = snapshot.val() || {};
        console.log("Firebase sensorData:", sensorData);  // ← add this
        if (zonesData.length > 0) {
            renderZoneCards();
            updateGlobalOccupancy();
        }
    });

    firebaseDB.ref(`sensor_readings/${portId}`).on("value", (snapshot) => {
        sensorData = snapshot.val() || {};
        renderZoneCards();
        updateGlobalOccupancy();
    });
}

// ── Calculate occupancy % for a zone ─────────────────────────────────────────

function getZoneOccupancy(zone) {
    if (!zone || !zone._id) return { count: 0, max: zone?.max_capacity || 0, pct: 0, available: zone?.max_capacity || 0 };
    const zoneKey = `zone_${zone.name.split(' ')[1]}`;
    const sensor  = sensorData[zoneKey];
    const count   = sensor?.container_count || 0;
    const max     = zone.max_capacity;
    return {
        count,
        max,
        pct:       max > 0 ? Math.min(Math.round((count / max) * 100), 100) : 0,
        available: max - count
    };
}

// ── Status label + colors based on % ─────────────────────────────────────────

function getZoneStatus(pct) {
    if (pct >= 90) return {
        label: "Critical",
        bgClass: "bg-error-container",
        textClass: "text-on-error-container",
        accentColor: "#fb6b00"
    };
    if (pct >= 70) return {
        label: "High Load",
        bgClass: "bg-tertiary-container/20",
        textClass: "text-tertiary-container",
        accentColor: "#fb6b00"
    };
    if (pct >= 40) return {
        label: "Optimal",
        bgClass: "bg-secondary-container",
        textClass: "text-on-secondary-container",
        accentColor: "#a4cce8"
    };
    return {
        label: "Low",
        bgClass: "bg-secondary-container",
        textClass: "text-on-secondary-container",
        accentColor: "#a4cce8"
    };
}

// ── AI insight text based on % ────────────────────────────────────────────────

function getAiInsight(pct, zoneId) {
    if (pct >= 90) return `Zone ${zoneId} is at critical capacity. Immediate load balancing or offloading is recommended.`;
    if (pct >= 70) return `Zone ${zoneId} is under high load. Monitor closely and consider pre-emptive redistribution.`;
    if (pct >= 40) return `Zone ${zoneId} is operating within optimal range. No action required.`;
    return `Zone ${zoneId} has low utilization. Available for incoming shipments or reallocation.`;
}

// ── Prediction text based on % ────────────────────────────────────────────────

function getPredictionText(pct) {
    if (pct >= 90) return "At current intake rate, overflow risk within 1–2 days.";
    if (pct >= 70) return "Estimated to reach 90% capacity within 3–5 days.";
    if (pct >= 40) return "Stable. No capacity issues forecast in the next 10 days.";
    return "Low utilization expected to continue. Capacity is not a concern.";
}

// ── Render all zone cards dynamically ────────────────────────────────────────

function renderZoneCards() {
    const container = document.getElementById("zones-grid");
    console.log("zonesData:", zonesData);
    console.log("container:", container);
    if (!container) return;
    container.innerHTML = "";

    zonesData.forEach(zone => {
        const { count, max, pct, available } = getZoneOccupancy(zone);
        const status      = getZoneStatus(pct);
        const fillColor   = pct >= 40
            ? "linear-gradient(to top, rgba(251,107,0,0.8), rgba(251,107,0,0.4))"
            : "linear-gradient(to top, rgba(164,204,232,0.8), rgba(164,204,232,0.4))";
        const accentColor = status.accentColor;

        // Cube top translateZ: maps 0%→-40px, 100%→+40px
        const topZ = ((pct / 100) * 80) - 40;

        const card = document.createElement("div");
        card.className = "surface-container-high rounded-xl p-6 relative overflow-hidden group hover:bg-surface-variant transition-all duration-500 cursor-pointer";
        card.dataset.zoneId = zone._id;

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

    card.querySelector(".openBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        openPopup(zone.zone_id);  // → openPopup(zone._id)
    });
    card.addEventListener("click", () => openPopup(zone.zone_id));  // → openPopup(zone._id)

            container.appendChild(card);
        });
    }

// ── Update global occupancy in header HUD ────────────────────────────────────

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
    const zone = zonesData.find(z => z._id === zoneId);
    if (!zone) return;

    selectedZone = zone;

    const { count, max, pct, available } = getZoneOccupancy(zone);
    const status = getZoneStatus(pct);

    // Populate popup fields
    document.getElementById("popup-zone-name").textContent = zone.name.toUpperCase();
    document.getElementById("popup-zone-status").textContent = status.label;
    document.getElementById("popup-total").textContent       = max.toLocaleString();
    document.getElementById("popup-occupied").textContent    = count.toLocaleString();
    document.getElementById("popup-available").textContent   = available.toLocaleString();
    document.getElementById("popup-bar").style.width         = `${pct}%`;
    document.getElementById("popup-pct-label").textContent   = `${pct}% capacity used`;

    // ✅ FIX: Populate prediction and AI insight dynamically
    document.getElementById("popup-prediction").textContent  = getPredictionText(pct);
    document.getElementById("popup-insight").textContent     = getAiInsight(pct, zone.name)

    // Show popup
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

// Close on backdrop click
document.getElementById("popup").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePopup();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchZones();
startSensorListener();