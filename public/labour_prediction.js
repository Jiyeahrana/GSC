const token  = localStorage.getItem("token");
const portId = localStorage.getItem("port_id");

if (!token) window.location.href = "/index.html";

document.getElementById("sidebar-port-name").textContent =
    localStorage.getItem("port_name") || "Port";



// ── Role display config ───────────────────────────────────────────────────────

const ROLE_CONFIG = {
    crane_operators:  { label: "Crane Operators",  icon: "precision_manufacturing", color: "#a4cce8" },
    truck_operators:  { label: "Truck Operators",  icon: "local_shipping",          color: "#fb6b00" },
    customs_officers: { label: "Customs Officers", icon: "policy",                  color: "#ffb692" },
    ground_crew:      { label: "Ground Crew",      icon: "groups",                  color: "#4ADE80" },
    docking_staff:    { label: "Docking Staff",    icon: "anchor",                  color: "#bac8dc" },
};

//loader
function renderSkeletons() {
    // HUD
    document.getElementById("hud-total-workers").innerHTML  = `<span class="sk" style="display:inline-block;width:120px;height:20px;border-radius:4px"></span>`;
    document.getElementById("hud-shortage-days").innerHTML  = `<span class="sk" style="display:inline-block;width:50px;height:20px;border-radius:4px"></span>`;
    document.getElementById("hud-total-shipments").innerHTML = `<span class="sk" style="display:inline-block;width:40px;height:20px;border-radius:4px"></span>`;

    // Role cards
    const roleContainer = document.getElementById("role-cards");
    roleContainer.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        const card = document.createElement("div");
        card.className = "bg-surface-container-high rounded-xl p-4 flex flex-col gap-3";
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="sk" style="width:20px;height:20px;border-radius:4px"></div>
                <div class="sk" style="width:36px;height:28px;border-radius:4px"></div>
            </div>
            <div class="sk" style="height:10px;width:80%;border-radius:4px"></div>
            <div class="sk" style="height:4px;width:100%;border-radius:4px"></div>
        `;
        roleContainer.appendChild(card);
    }

    // Forecast chart
    const chart = document.getElementById("forecast-chart");
    chart.innerHTML = "";
    for (let i = 0; i < 7; i++) {
        const col = document.createElement("div");
        col.className = "flex flex-col items-center flex-1 gap-2 justify-end";
        const h = 60 + Math.random() * 120 | 0;
        col.innerHTML = `
            <div class="sk w-full rounded-t" style="height:${h}px"></div>
            <div class="sk" style="height:10px;width:36px;border-radius:4px"></div>
        `;
        chart.appendChild(col);
    }

    // Day cards
    const dayContainer = document.getElementById("day-cards");
    dayContainer.innerHTML = "";
    for (let i = 0; i < 7; i++) {
        const card = document.createElement("div");
        card.className = "bg-surface-container rounded-xl p-5 border-l-4 border-outline-variant/20 flex flex-col gap-4";
        card.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex flex-col gap-2">
                    <div class="sk" style="height:14px;width:140px;border-radius:4px"></div>
                    <div class="sk" style="height:10px;width:90px;border-radius:4px"></div>
                </div>
                <div class="sk" style="height:36px;width:80px;border-radius:8px"></div>
            </div>
            <div class="flex flex-col gap-2">
                <div class="sk" style="height:10px;width:60px;border-radius:4px"></div>
                <div class="sk" style="height:10px;width:100%;border-radius:4px"></div>
                <div class="sk" style="height:10px;width:90%;border-radius:4px"></div>
                <div class="sk" style="height:10px;width:95%;border-radius:4px"></div>
            </div>
        `;
        dayContainer.appendChild(card);
    }

    // Summary cards
    document.getElementById("peak-day-label").innerHTML        = `<span class="sk" style="display:inline-block;width:100px;height:20px;border-radius:4px"></span>`;
    document.getElementById("shortage-risk-label").innerHTML   = `<span class="sk" style="display:inline-block;width:60px;height:20px;border-radius:4px"></span>`;
    document.getElementById("total-shipments-label").innerHTML = `<span class="sk" style="display:inline-block;width:40px;height:20px;border-radius:4px"></span>`;
}



// ── Fetch and render ──────────────────────────────────────────────────────────

async function fetchLabourPrediction() {
     renderSkeletons();
    try {
        const res  = await fetch("https://gsc-app-630083017128.us-central1.run.app/api/v1/port/labour-prediction", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.success) {
            showError("Could not load labour prediction data");
            return;
        }

        renderHUD(data);
        renderRoleCards(data.workforce.roles, data.workforce.total_workers);
        renderForecastChart(data.days, data.workforce);
        renderDayCards(data.days, data.workforce.shifts);
        renderSummary(data);

    } catch (err) {
        console.error("Labour prediction error:", err);
        showError("Server connection error");
    }
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function renderHUD(data) {
    document.getElementById("hud-total-workers").textContent =
        `${data.workforce.total_workers.toLocaleString()} Workers`;
    document.getElementById("hud-shortage-days").textContent =
        `${data.summary.days_with_shortage} / 7`;
    document.getElementById("hud-total-shipments").textContent =
        data.summary.total_shipments;

    // Color shortage days red if any
    if (data.summary.days_with_shortage > 0) {
        document.getElementById("hud-shortage-days").style.color = "#f87171";
    }
}

// ── Role Cards ────────────────────────────────────────────────────────────────

function renderRoleCards(roles, total) {
    const container = document.getElementById("role-cards");
    container.innerHTML = "";

    Object.entries(ROLE_CONFIG).forEach(([key, cfg]) => {
        const count = roles[key] || 0;
        const pct   = total > 0 ? Math.round((count / total) * 100) : 0;

        const card  = document.createElement("div");
        card.className = "bg-surface-container-high rounded-xl p-4 flex flex-col gap-3";
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <span class="material-symbols-outlined text-sm" style="color:${cfg.color}">${cfg.icon}</span>
                <span class="text-2xl font-extrabold font-headline" style="color:${cfg.color}">${count}</span>
            </div>
            <div>
                <p class="text-xs font-bold text-on-surface-variant uppercase tracking-wider">${cfg.label}</p>
                <p class="text-[10px] text-outline mt-0.5">${pct}% of workforce</p>
            </div>
            <div class="w-full h-1 bg-surface-container rounded-full">
                <div class="h-1 rounded-full transition-all duration-700"
                     style="width:${pct}%; background:${cfg.color}"></div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ── Forecast Chart ────────────────────────────────────────────────────────────

function renderForecastChart(days, workforce) {
    const container  = document.getElementById("forecast-chart");
    container.innerHTML = "";

    const totalAvailable = workforce.total_workers;

    // Find max demand for scaling
    const maxDemand = Math.max(
        ...days.map(d => Object.values(d.total_demand).reduce((a, b) => a + b, 0)),
        totalAvailable,
        1
    );

    days.forEach(day => {
        const date        = new Date(day.date);
        const isToday     = date.toDateString() === new Date().toDateString();
        const totalDemand = Object.values(day.total_demand).reduce((a, b) => a + b, 0);
        const hasShortage = day.has_shortage;

        const demandPct    = Math.round((totalDemand    / maxDemand) * 220);
        const availablePct = Math.round((totalAvailable / maxDemand) * 220);

        const dateStr = date.toLocaleDateString("en-IN", {
            day: "2-digit", month: "short"
        }).toUpperCase();

        const col = document.createElement("div");
        col.className = "flex flex-col items-center flex-1 group cursor-pointer relative";

        col.innerHTML = `
            <div class="w-full rounded-t relative transition-all group-hover:opacity-90"
                 style="height:${Math.max(demandPct, 8)}px;
                        background:${hasShortage ? '#ef4444' : '#fb6b00'};
                        opacity:0.9">

                <!-- Tooltip -->
                <div class="absolute -top-16 left-1/2 -translate-x-1/2 bg-surface-container-highest
                            px-3 py-2 rounded-lg text-[10px] font-bold whitespace-nowrap
                            opacity-0 group-hover:opacity-100 transition-opacity z-10
                            border border-outline-variant/30 min-w-max">
                    <p class="text-primary">${totalDemand} needed</p>
                    <p class="text-secondary">${totalAvailable} available</p>
                    ${hasShortage ? `<p class="text-red-400">⚠ Shortage</p>` : `<p class="text-green-400">✓ Sufficient</p>`}
                </div>
            </div>
            <span class="mt-3 text-[10px] font-bold uppercase tracking-widest
                         ${isToday ? 'text-brand-orange' : 'text-on-surface-variant'}">
                ${dateStr}
            </span>
            ${hasShortage ? `<span class="w-1.5 h-1.5 rounded-full bg-red-400 mt-1 shortage-pulse"></span>` : `<span class="w-1.5 h-1.5 mt-1"></span>`}
        `;
        container.appendChild(col);
    });

// Fixed available capacity line across full chart width
container.style.position = "relative";

const availableBottomPx = Math.round((totalAvailable / maxDemand) * 220);

// Fixed label — always top-right of chart, never overlaps bars/dates
const lineLabel = document.createElement("div");
lineLabel.style.cssText = `
    position: absolute;
    top: -24px;
    right: 0;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #a4cce8;
    background: rgba(12,34,48,0.9);
    padding: 2px 8px;
    border-radius: 4px;
    z-index: 10;
    white-space: nowrap;
`;
lineLabel.textContent = `Available: ${totalAvailable}`;
container.appendChild(lineLabel);
}

// ── Day Cards ─────────────────────────────────────────────────────────────────

function renderDayCards(days, shifts) {
    const container = document.getElementById("day-cards");
    container.innerHTML = "";

    days.forEach(day => {
        const date     = new Date(day.date);
        const isToday  = date.toDateString() === new Date().toDateString();
        const dateStr  = date.toLocaleDateString("en-IN", {
            weekday: "short", day: "2-digit", month: "short"
        }).toUpperCase();

        const totalDemand = Object.values(day.total_demand).reduce((a, b) => a + b, 0);

        const card = document.createElement("div");
        card.className = `bg-surface-container rounded-xl overflow-hidden border-l-4
            ${day.has_shortage ? 'border-red-500' : 'border-primary/30'}`;

        // Build role demand rows
        const roleRows = Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
            const needed  = day.total_demand[key]    || 0;
            const avail   = day.day_shortages[key]?.available || 0;
            const deficit = day.day_shortages[key]?.deficit   || 0;
            const ok      = day.day_shortages[key]?.ok ?? true;

            return `
                <div class="flex items-center gap-3 py-1.5 border-b border-outline-variant/10 last:border-0">
                    <span class="material-symbols-outlined text-xs" style="color:${cfg.color};font-size:14px">${cfg.icon}</span>
                    <span class="text-xs text-on-surface-variant flex-1">${cfg.label}</span>
                    <span class="text-xs font-bold ${ok ? 'text-on-surface' : 'text-red-400'}">${needed} needed</span>
                    <span class="text-[10px] text-outline">/ ${avail} avail</span>
                    ${!ok ? `<span class="text-[10px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">-${deficit}</span>` : `<span class="text-[10px] font-bold text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">✓</span>`}
                </div>
            `;
        }).join("");

        // Build shift breakdown
        const shiftRows = day.shift_demands?.length > 0
            ? day.shift_demands.map(shift => {
                const shiftTotal = Object.values(shift.demand).reduce((a, b) => a + b, 0);
                return `
                    <div class="flex items-center justify-between py-1.5 border-b border-outline-variant/10 last:border-0">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-xs text-outline" style="font-size:12px">schedule</span>
                            <span class="text-[10px] text-on-surface-variant">${shift.label}</span>
                            <span class="text-[10px] text-outline">(${shift.shipment_count} ships)</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold ${shift.has_shortage ? 'text-red-400' : 'text-on-surface'}">${shiftTotal} workers</span>
                            ${shift.has_shortage ? `<span class="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded font-bold">SHORTAGE</span>` : `<span class="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded font-bold">OK</span>`}
                        </div>
                    </div>
                `;
            }).join("")
            : `<p class="text-[10px] text-outline py-2">No shifts configured</p>`;

        card.innerHTML = `
            <div class="p-5">
                <!-- Day Header -->
                <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center gap-3">
                        <div>
                            <p class="text-sm font-extrabold font-headline ${isToday ? 'text-brand-orange' : 'text-on-surface'}">
                                ${isToday ? 'TODAY — ' : ''}${dateStr}
                            </p>
                            <p class="text-[10px] text-outline">${day.shipment_count} shipment${day.shipment_count !== 1 ? 's' : ''} scheduled</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-right">
                            <p class="text-xs text-on-surface-variant">Total demand</p>
                            <p class="text-xl font-extrabold font-headline ${day.has_shortage ? 'text-red-400' : 'text-primary'}">${totalDemand}</p>
                        </div>
                        ${day.has_shortage
                            ? `<div class="px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg">
                                   <p class="text-[10px] font-bold text-red-400 uppercase tracking-wider">⚠ Shortage</p>
                               </div>`
                            : totalDemand === 0
                                ? `<div class="px-3 py-1.5 bg-outline/10 border border-outline/20 rounded-lg">
                                       <p class="text-[10px] font-bold text-outline uppercase tracking-wider">No Shipments</p>
                                   </div>`
                                : `<div class="px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg">
                                       <p class="text-[10px] font-bold text-green-400 uppercase tracking-wider">✓ Sufficient</p>
                                   </div>`
                        }
                    </div>
                </div>

                ${day.shipment_count > 0 ? `
                <!-- Role Breakdown -->
                <div class="mb-4">
                    <p class="text-[10px] uppercase tracking-widest text-outline font-bold mb-2">By Role</p>
                    ${roleRows}
                </div>

                <!-- Shift Breakdown -->
                <div>
                    <p class="text-[10px] uppercase tracking-widest text-outline font-bold mb-2">By Shift</p>
                    ${shiftRows}
                </div>
                ` : `<p class="text-sm text-on-surface-variant">No shipments scheduled — full workforce available.</p>`}
            </div>
        `;

        container.appendChild(card);
    });
}

// ── Summary ───────────────────────────────────────────────────────────────────

function renderSummary(data) {
    const peakDate = data.summary.peak_demand_date
        ? new Date(data.summary.peak_demand_date).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric"
          })
        : "—";

    const shortageCount = data.summary.days_with_shortage;
    const riskLabel     = shortageCount === 0 ? "None"
                        : shortageCount <= 2   ? "Low"
                        : shortageCount <= 4   ? "Medium"
                        : "High";
    const riskColor     = shortageCount === 0 ? "#4ADE80"
                        : shortageCount <= 2   ? "#ffb692"
                        : shortageCount <= 4   ? "#fb6b00"
                        : "#f87171";

    document.getElementById("peak-day-label").textContent       = peakDate;
    document.getElementById("shortage-risk-label").textContent  = riskLabel;
    document.getElementById("shortage-risk-label").style.color  = riskColor;
    document.getElementById("total-shipments-label").textContent = data.summary.total_shipments;
}

// ── Error state ───────────────────────────────────────────────────────────────

function showError(msg) {
    document.querySelector("main").innerHTML += `
        <div class="mt-8 p-6 bg-error-container rounded-xl text-on-error-container text-sm flex items-center gap-3">
            <span class="material-symbols-outlined">error</span>
            <span>${msg}</span>
        </div>`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchLabourPrediction();