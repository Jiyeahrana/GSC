const BASE_URL = "http://localhost:3000/api/v1/public";

// ── Load ports into dropdown on page load ─────────────────────────────────────

async function loadPorts() {
    try {
        const res  = await fetch(`${BASE_URL}/ports`);
        const data = await res.json();

        if (!data.success) return;

        const select = document.getElementById("portSelect");
        select.innerHTML = `<option value="">-- Select a Port --</option>`;

        data.data.forEach(port => {
            const option   = document.createElement("option");
            option.value   = port.id;
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

        if (!data.success) {
            alert("Could not load timeline for this port");
            return;
        }

        document.getElementById("portTitle").textContent =
            data.port.name.toUpperCase();

        const inPort   = data.shipments.filter(s => s.status === "at_port").length;
        const upcoming = data.shipments.filter(s =>
            ["registered", "in_transit"].includes(s.status)
        ).length;

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

    if (shipments.length === 0) {
        container.innerHTML = `<p class="text-on-surface-variant text-sm pl-12">No shipments scheduled</p>`;
        return;
    }

    // Show next 10 only
    shipments.slice(0, 10).forEach(shipment => {
        const arrival  = new Date(shipment.schedule.arrival);
        const now      = new Date();
        const isToday  = arrival.toDateString() === now.toDateString();
        const isFuture = arrival > now;

        const timeStr = arrival.toLocaleTimeString("en-IN", {
            hour:   "2-digit",
            minute: "2-digit"
        });

        const dateStr = isToday ? "TODAY" : arrival.toLocaleDateString("en-IN", {
            day: "2-digit", month: "short"
        }).toUpperCase();

        const typeColor  = shipment.type === "incoming" ? "#639922"  : "#E24B4A";
        const typeLabel  = shipment.type === "incoming" ? "ARRIVAL"  : "DEPARTURE";
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
                        <span class="text-[10px] font-bold uppercase block mb-1"
                              style="color: ${typeColor}">${typeLabel}</span>
                        <h3 class="font-bold text-sm">${shipment.vessel.name}</h3>
                    </div>
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold"
                          style="color: ${statusColor}; background: ${statusColor}20">
                        ${shipment.status.replace("_", " ").toUpperCase()}
                    </span>
                </div>
            </div>
        `;

        container.appendChild(item);
    });
}

function getStatusColor(status) {
    switch (status) {
        case "at_port":    return "#5DCAA5";
        case "in_transit": return "#bac8dc";
        case "delayed":    return "#ffb692";
        case "arrived":    return "#639922";
        case "departed":   return "#E24B4A";
        default:           return "#8e9196";
    }
}

// ── Track shipment by ID ──────────────────────────────────────────────────────

async function trackShipment() {
    const trackingId = document.getElementById("trackingInput").value.trim();

    if (!trackingId) {
        showTrackingError("Please enter a tracking ID");
        return;
    }

    const btn = document.getElementById("searchbtn");
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

// ── Populate tracking result card ─────────────────────────────────────────────

function populateTrackingResult(shipment) {
    // Hide error if showing
    document.getElementById("tracking-error").classList.add("hidden");

    // ETA calculation
    const eta = shipment.actual?.arrival
        ? new Date(shipment.actual.arrival).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : new Date(shipment.schedule.arrival).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    // Location from latest weather snapshot
    const lat = shipment.latest_weather?.lat?.toFixed(4) || "—";
    const lng = shipment.latest_weather?.lng?.toFixed(4) || "—";

    const statusColor = getStatusColor(shipment.status);

    document.getElementById("result-vessel").textContent  = shipment.vessel_name;
    document.getElementById("result-type").textContent    = shipment.type === "incoming" ? "INCOMING" : "OUTGOING";
    document.getElementById("result-status").textContent  = shipment.status.replace("_", " ").toUpperCase();
    document.getElementById("result-status").style.color  = statusColor;
    document.getElementById("result-eta").textContent     = eta;
    document.getElementById("result-lat").textContent     = lat + "° N";
    document.getElementById("result-lng").textContent     = lng + "° E";

    // Weather info
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
}

function showTrackingError(message) {
    document.getElementById("trackingResult").classList.add("hidden");
    document.getElementById("trackingresult").classList.add("hidden");
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

document.addEventListener("DOMContentLoaded", () => {
    loadPorts();
});

document.getElementById("searchbtn").addEventListener("click", trackShipment);

document.getElementById("trackingInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") trackShipment();
});