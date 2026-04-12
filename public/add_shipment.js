const token  = localStorage.getItem("token");
const portId = localStorage.getItem("port_id");

if (!token) window.location.href = "/index.html";

// ── Load user + port info from localStorage ───────────────────────────────────

const userName = localStorage.getItem("user_name") || "";
const portName = localStorage.getItem("port_name") || "Port";

document.getElementById("user-avatar").textContent      = userName.substring(0, 2).toUpperCase() || "--";
document.getElementById("sidebar-port-name").textContent = portName;
document.getElementById("sidebar-user-name").textContent = userName;

// ── Populate zone dropdown from localStorage ──────────────────────────────────

function populateZones() {
    const zones     = JSON.parse(localStorage.getItem("zones") || "[]");
    const select    = document.getElementById("assigned-zone");
    select.innerHTML = `<option value="">-- Select Zone --</option>`;

    zones.forEach(zone => {
        const option   = document.createElement("option");
        option.value   = zone.zone_id;
        option.textContent = `Zone ${zone.zone_id} — ${zone.name} (max: ${zone.max_capacity})`;
        select.appendChild(option);
    });
}

populateZones();

// ── Fetch telemetry data ──────────────────────────────────────────────────────

async function fetchTelemetry() {
    try {
        // Port details for capacity + zones
        const portRes  = await fetch("http://localhost:3000/api/v1/port/me", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const portData = await portRes.json();

        if (portData.success) {
            document.getElementById("telemetry-capacity").textContent = portData.data.total_capacity;
            document.getElementById("telemetry-zones").textContent    = portData.data.zones.length;

            // Also refresh zones dropdown with latest data
            localStorage.setItem("zones", JSON.stringify(portData.data.zones));
            populateZones();
        }

        // Today's shipments for incoming/outgoing count
        const shipRes  = await fetch("http://localhost:3000/api/v1/shipments/today", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const shipData = await shipRes.json();

        if (shipData.success) {
            const incoming = shipData.data.filter(s => s.type === "incoming").length;
            const outgoing = shipData.data.filter(s => s.type === "outgoing").length;
            document.getElementById("telemetry-incoming").textContent = incoming;
            document.getElementById("telemetry-outgoing").textContent = outgoing;
        }

    } catch (err) {
        console.error("Telemetry fetch error:", err);
    }
}

fetchTelemetry();

// ── Error / success helpers ───────────────────────────────────────────────────

function showError(message) {
    const box = document.getElementById("form-error");
    document.getElementById("form-error-message").textContent = message;
    document.getElementById("form-success").classList.add("hidden");
    box.classList.remove("hidden");
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showSuccess(message) {
    const box = document.getElementById("form-success");
    document.getElementById("form-success-message").textContent = message;
    document.getElementById("form-error").classList.add("hidden");
    box.classList.remove("hidden");
}

function hideMessages() {
    document.getElementById("form-error").classList.add("hidden");
    document.getElementById("form-success").classList.add("hidden");
}

// ── Form submit ───────────────────────────────────────────────────────────────

document.getElementById("shipment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessages();

    const vesselName     = document.getElementById("vessel-name").value.trim();
    const vesselCapacity = document.getElementById("vessel-capacity").value;
    const cargoOrigin    = document.getElementById("cargo-origin").value.trim();
    const cargoDest      = document.getElementById("cargo-destination").value.trim();
    const arrival        = document.getElementById("schedule-arrival").value;
    const departure      = document.getElementById("schedule-departure").value;
    const type           = document.getElementById("shipment-type").value;
    const status         = document.getElementById("shipment-status").value;
    const assignedZone   = document.getElementById("assigned-zone").value;
    const containerCount = document.getElementById("vessel-container-count").value;
    const gpsDeviceId    = document.getElementById("gps-device-id").value.trim();
    const senderName     = document.getElementById("sender-name").value.trim();
    const senderEmail    = document.getElementById("sender-email").value.trim();

    // ── Validate ──────────────────────────────────────────────────────────────

    if (!vesselName || !cargoOrigin || !cargoDest || !arrival || !departure || !senderName || !senderEmail) {
        showError("Please fill in all required fields");
        return;
    }
    if (!containerCount || parseInt(containerCount) < 1) {
        showError("Container count must be at least 1");
        return;
    }

    if (new Date(arrival) >= new Date(departure)) {
        showError("Arrival date must be before departure date");
        return;
    }

    // ── Build payload ─────────────────────────────────────────────────────────

    const payload = {
        vessel: {
            name:            vesselName,
            capacity:        parseInt(vesselCapacity)    || 0,
            container_count: parseInt(containerCount)
        },
        cargo: {
            origin:      cargoOrigin,
            destination: cargoDest
        },
        schedule: {
            arrival:   new Date(arrival).toISOString(),
            departure: new Date(departure).toISOString()
        },
        type,
        status,
        gps_device_id: gpsDeviceId,
        sender_name:   senderName,
        sender_email:  senderEmail
    };

    // ── Submit ────────────────────────────────────────────────────────────────

    const btn = document.getElementById("submit-btn");
    btn.disabled    = true;
    btn.textContent = "Logging...";

    try {
        const res  = await fetch("http://localhost:3000/api/v1/shipments", {
            method:  "POST",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (data.success) {
            showSuccess(`Shipment logged successfully! Tracking ID: ${data.data._id}`);
            document.getElementById("shipment-form").reset();
        } else {
            showError(data.message || "Failed to log shipment");
        }

    } catch (err) {
        console.error("Submit error:", err);
        showError("Could not connect to server, please try again");
    } finally {
        btn.disabled    = false;
        btn.textContent = "Log Shipment";
    }
});