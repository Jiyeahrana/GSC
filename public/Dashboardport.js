// ── Auth ──────────────────────────────────────────────────────────────────────

const token = localStorage.getItem("token");
if (!token) window.location.href = "/index.html";

// ── Logout ────────────────────────────────────────────────────────────────────

document.getElementById("logout-btn").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = "/index.html";
});

// ── User info from localStorage ───────────────────────────────────────────────

const userName = localStorage.getItem("user_name") || "";
document.getElementById("user-avatar").textContent = userName.substring(0, 2).toUpperCase() || "--";
document.getElementById("sidebar-port-name").textContent = userName || "Port";

// ── Timeline state ────────────────────────────────────────────────────────────
// windowStart = left edge of the timeline, snapped to the current hour.
// windowHours = 24 or 48 — total span of the timeline.
// All position math is done in milliseconds from windowStart, then converted
// to a percentage of the total window. This is timezone-safe because Date
// objects always operate in local time for getHours() etc., and ISO strings
// are parsed correctly into UTC then displayed in local time automatically.

let windowHours = 24;

function getWindowStart() {
    const d = new Date();
    d.setMinutes(0, 0, 0); // snap to start of current hour
    return d;
}

// Computed once on load; stays fixed. Refreshes only on hard reload.
const windowStart = getWindowStart();

// ── Colour / status helpers ───────────────────────────────────────────────────
// IMPORTANT: Tailwind JIT cannot resolve dynamic class strings like
// `border-${color}` at runtime — only full static strings present in source
// are included. All colours are applied via inline `style` attributes instead.

const STYLES = {
    docked: {
        borderColor: "#b2c8e7",
        textColor:   "#b2c8e7",
        bgColor:     "rgba(178,200,231,0.10)",
        label:       "DOCKED",
    },
    inbound: {
        borderColor: "#bac8dc",
        textColor:   "#bac8dc",
        bgColor:     "rgba(186,200,220,0.10)",
        label:       "INBOUND",
    },
    outbound: {
        borderColor: "#ffb692",
        textColor:   "#ffb692",
        bgColor:     "rgba(255,182,146,0.10)",
        label:       "OUTBOUND",
    },
    delayed: {
        borderColor: "#ffb4ab",
        textColor:   "#ffb4ab",
        bgColor:     "rgba(255,180,171,0.10)",
        label:       "DELAYED",
    },
};

function resolveStyle(shipment) {
    if (shipment.status === "delayed" || shipment.status === "issue") {
        return { ...STYLES.delayed, icon: "warning" };
    }
    if (shipment.status === "at_port") {
        // Docked: use secondary colour, but show direction via icon
        return { ...STYLES.docked, icon: shipment.type === "outgoing" ? "sailing" : "anchor" };
    }
    if (shipment.type === "outgoing") {
        return { ...STYLES.outbound, icon: "sailing" };
    }
    return { ...STYLES.inbound, icon: "anchor" };
}

// ── Time markers ──────────────────────────────────────────────────────────────

function renderTimeMarkers() {
    const container = document.getElementById("timeMarkers");
    container.innerHTML = "";

    const markerIntervalHours = 4;
    const markerCount = windowHours / markerIntervalHours; // e.g. 6 gaps for 24h

    for (let i = 0; i <= markerCount; i++) {
        const markerTime = new Date(windowStart.getTime() + i * markerIntervalHours * 3600000);
        const hh = markerTime.getHours().toString().padStart(2, "0");

        // Day label: D2, D3... if the marker has crossed midnight past windowStart
        const dayDiff = Math.floor(
            (markerTime.setHours(0,0,0,0) - new Date(windowStart).setHours(0,0,0,0))
            / 86400000
        );
        // Restore markerTime (setHours mutates, so recalculate display hour)
        const realMarkerTime = new Date(windowStart.getTime() + i * markerIntervalHours * 3600000);
        const displayHH = realMarkerTime.getHours().toString().padStart(2, "0");
        const label = dayDiff === 0 ? `${displayHH}:00` : `D${dayDiff + 1} ${displayHH}:00`;

        const span = document.createElement("span");
        span.className = "text-[10px] text-on-surface-variant font-bold";
        span.textContent = label;
        container.appendChild(span);
    }
}

// ── Live time indicator ───────────────────────────────────────────────────────

function updateLiveTimeLine() {
    const now = new Date();
    const hh  = now.getHours().toString().padStart(2, "0");
    const mm  = now.getMinutes().toString().padStart(2, "0");

    document.getElementById("live-time-label").textContent = `LIVE: ${hh}:${mm}`;

    const windowMs    = windowHours * 3600000;
    const msFromStart = now.getTime() - windowStart.getTime();
    const pct         = (msFromStart / windowMs) * 100;
    const clamped     = Math.max(0, Math.min(pct, 100));

    document.getElementById("live-time-line").style.left = `${clamped}%`;
}

// ── Timeline rows ─────────────────────────────────────────────────────────────

function renderTimelineRows(shipments) {
    const container = document.getElementById("timeline-rows");
    container.innerHTML = "";

    if (!shipments || shipments.length === 0) {
        container.innerHTML = `<p class="text-on-surface-variant text-sm text-center py-8">No shipments scheduled</p>`;
        return;
    }

    const windowMs  = windowHours * 3600000;
    const windowEnd = new Date(windowStart.getTime() + windowMs);

    // Only show shipments that overlap our visible window
    const visible = shipments.filter(s => {
        const arr = new Date(s.schedule.arrival);
        const dep = new Date(s.schedule.departure);
        return dep > windowStart && arr < windowEnd;
    });

    if (visible.length === 0) {
        container.innerHTML = `<p class="text-on-surface-variant text-sm text-center py-8">No shipments in this time window</p>`;
        return;
    }

    visible.forEach(shipment => {
        const arrMs = new Date(shipment.schedule.arrival).getTime();
        const depMs = new Date(shipment.schedule.departure).getTime();

        // Clamp bar start/end to visible window
        const barStartMs = Math.max(arrMs, windowStart.getTime());
        const barEndMs   = Math.min(depMs, windowEnd.getTime());

        const leftPct  = ((barStartMs - windowStart.getTime()) / windowMs) * 100;
        const widthPct = ((barEndMs   - barStartMs)            / windowMs) * 100;

        // Guard against sub-pixel or negative widths
        const finalLeft  = Math.max(0,   Math.min(leftPct,  99));
        const finalWidth = Math.max(3.5,  Math.min(widthPct, 100 - finalLeft));

        const s = resolveStyle(shipment);

        const row = document.createElement("div");
        row.className = "relative h-12";
        row.innerHTML = `
            <div class="absolute inset-y-0 rounded-r flex items-center gap-3 px-3 overflow-hidden"
                 style="
                    left: ${finalLeft}%;
                    width: ${finalWidth}%;
                    background: ${s.bgColor};
                    border-left: 3px solid ${s.borderColor};
                    box-shadow: inset 0 0 0 1px ${s.borderColor}18;
                 ">
                <span class="material-symbols-outlined text-sm flex-shrink-0"
                      style="color:${s.borderColor}">${s.icon}</span>
                <span class="text-xs font-bold truncate" style="color:#d8e4ec">${shipment.vessel.name}</span>
                <span class="ml-auto text-[10px] px-2 py-0.5 rounded-full hidden md:block flex-shrink-0 font-semibold"
                      style="color:${s.textColor}; background:${s.bgColor}; border:1px solid ${s.borderColor}55">
                    ${s.label}
                </span>
            </div>
        `;
        container.appendChild(row);
    });
}

// ── Toggle buttons ────────────────────────────────────────────────────────────

const btn24 = document.getElementById("btn24");
const btn48 = document.getElementById("btn48");
const timelineEl = document.getElementById("timelineContainer");

function activateToggle(activeBtn, inactiveBtn) {
    activeBtn.classList.add("bg-surface-container-high", "text-primary");
    activeBtn.classList.remove("text-on-surface-variant");
    inactiveBtn.classList.remove("bg-surface-container-high", "text-primary");
    inactiveBtn.classList.add("text-on-surface-variant");
}

btn24.addEventListener("click", () => {
    windowHours = 24;
    timelineEl.style.minWidth = "1200px";
    activateToggle(btn24, btn48);
    renderTimeMarkers();
    updateLiveTimeLine();
    if (window._lastShipments) renderTimelineRows(window._lastShipments);
});

btn48.addEventListener("click", () => {
    windowHours = 48;
    timelineEl.style.minWidth = "2400px";
    activateToggle(btn48, btn24);
    renderTimeMarkers();
    updateLiveTimeLine();
    if (window._lastShipments) renderTimelineRows(window._lastShipments);
});

// ── Fetch shipments ───────────────────────────────────────────────────────────

async function fetchTodayShipments() {
    try {
        const res = await fetch("http://localhost:3000/api/v1/shipments/today", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });

        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "/index.html";
            return;
        }

        const data = await res.json();
        if (!data.success) { console.error("Failed:", data.message); return; }
        populateDashboard(data.data);

    } catch (err) {
        console.error("Error fetching shipments:", err);
    }
}

// ── Populate dashboard ────────────────────────────────────────────────────────

function populateDashboard(shipments) {
    window._lastShipments = shipments;

    const incoming = shipments.filter(s => s.type === "incoming");
    const outgoing = shipments.filter(s => s.type === "outgoing");

    document.getElementById("incoming-count").textContent = incoming.length;
    document.getElementById("outgoing-count").textContent = outgoing.length;

    const now = new Date();
    const next = incoming
        .filter(s => new Date(s.schedule.arrival) > now)
        .sort((a, b) => new Date(a.schedule.arrival) - new Date(b.schedule.arrival))[0];

    if (next) {
        const diffMin = Math.floor((new Date(next.schedule.arrival) - now) / 60000);
        const h = Math.floor(diffMin / 60), m = diffMin % 60;
        document.getElementById("next-vessel-label").textContent =
            h > 0 ? `Next vessel in ${h}h ${m}m` : `Next vessel in ${diffMin}m`;
    } else {
        document.getElementById("next-vessel-label").textContent = "No more arrivals today";
    }

    renderTimelineRows(shipments);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

renderTimeMarkers();
updateLiveTimeLine();
setInterval(updateLiveTimeLine, 30000);
activateToggle(btn24, btn48);
fetchTodayShipments();