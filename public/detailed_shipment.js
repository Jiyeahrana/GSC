const token  = localStorage.getItem("token");
const portId = localStorage.getItem("port_id");

if (!token) window.location.href = "/index.html";

document.getElementById("sidebar-port-name").textContent =
    localStorage.getItem("port_name") || "Port";

document.getElementById("logout-btn").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = "/index.html";
});

// ── State ─────────────────────────────────────────────────────────────────────

let allShipments  = [];
let filtered      = [];
let sortOrder     = "latest";   // "latest" | "oldest"
let filterType    = "all";      // "all" | "incoming" | "outgoing"
let currentPage   = 1;
const PAGE_SIZE   = 10;

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchShipments() {
    try {
        const res  = await fetch(`https://gsc-app-630083017128.us-central1.run.app/api/v1/shipments`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.success) return;

        allShipments = data.data;
        applyFilters();
        updateStatCards();

    } catch (err) {
        console.error("Fetch shipments error:", err);
    }
}

// ── Filters & Sort ────────────────────────────────────────────────────────────

function applyFilters() {
    let result = [...allShipments];

    if (filterType !== "all") {
        result = result.filter(s => s.type === filterType);
    }

    result.sort((a, b) => {
        const dateA = new Date(a.schedule.arrival);
        const dateB = new Date(b.schedule.arrival);
        return sortOrder === "latest" ? dateB - dateA : dateA - dateB;
    });

    filtered     = result;
    currentPage  = 1;
    renderTable();
    updatePagination();
}

// ── Stat Cards ────────────────────────────────────────────────────────────────

function updateStatCards() {
    const today     = new Date().toDateString();
    const todayAll  = allShipments.filter(s => new Date(s.schedule.arrival).toDateString() === today);
    const incoming  = allShipments.filter(s => s.type === "incoming");
    const outgoing  = allShipments.filter(s => s.type === "outgoing");

    document.getElementById("total-count").textContent    = todayAll.length || allShipments.length;
    document.getElementById("incoming-count").textContent = incoming.length;
    document.getElementById("outgoing-count").textContent = outgoing.length;

    // Next incoming vessel
    const now  = new Date();
    const next = incoming
        .filter(s => new Date(s.schedule.arrival) > now)
        .sort((a, b) => new Date(a.schedule.arrival) - new Date(b.schedule.arrival))[0];

    document.getElementById("next-vessel-label").textContent = next
        ? `Next: ${next.vessel.name} @ ${new Date(next.schedule.arrival).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
        : "No upcoming arrivals";
}

// ── Status config ─────────────────────────────────────────────────────────────

function getStatusConfig(status) {
    switch (status) {
        case "at_port":    return { label: "At Port",    bg: "bg-green-900/40",  text: "text-green-400",  dot: "bg-green-400",  border: "border-green-800/50",  bar: "bg-[#4ADE80]" };
        case "in_transit": return { label: "In Transit", bg: "bg-blue-900/40",   text: "text-blue-400",   dot: "bg-blue-400",   border: "border-blue-800/50",   bar: "bg-blue-500" };
        case "delayed":    return { label: "Delayed",    bg: "bg-red-900/40",    text: "text-red-400",    dot: "bg-red-400",    border: "border-red-800/50",    bar: "bg-red-500" };
        case "registered": return { label: "Scheduled",  bg: "bg-slate-800",     text: "text-slate-400",  dot: "bg-slate-400",  border: "border-slate-700",     bar: "bg-slate-600" };
        case "departed":   return { label: "Departed",   bg: "bg-orange-900/40", text: "text-orange-400", dot: "bg-orange-400", border: "border-orange-800/50", bar: "bg-orange-500" };
        case "arrived":    return { label: "Arrived",    bg: "bg-teal-900/40",   text: "text-teal-400",   dot: "bg-teal-400",   border: "border-teal-800/50",   bar: "bg-teal-500" };
        default:           return { label: status,       bg: "bg-slate-800",     text: "text-slate-400",  dot: "bg-slate-400",  border: "border-slate-700",     bar: "bg-slate-600" };
    }
}

// ── Render Table ──────────────────────────────────────────────────────────────

function renderTable() {
    const tbody     = document.getElementById("shipments-tbody");
    const start     = (currentPage - 1) * PAGE_SIZE;
    const end       = start + PAGE_SIZE;
    const pageItems = filtered.slice(start, end);

    tbody.innerHTML = "";

    if (pageItems.length === 0) {
        tbody.innerHTML = `
            <div class="px-6 py-12 text-center text-on-surface-variant text-sm">
                No shipments found.
            </div>`;
        return;
    }

    pageItems.forEach(s => {
        const sc      = getStatusConfig(s.status);
        const arrival = new Date(s.schedule.arrival);
        const dateStr = arrival.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        const timeStr = arrival.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        const shortId = s._id.toString().slice(-6).toUpperCase();

        const row = document.createElement("div");
        row.className  = "grid grid-cols-12 gap-4 px-6 py-5 items-center data-table-row cursor-pointer group transition-colors";
        row.dataset.id = s._id;

        row.innerHTML = `
            <div class="col-span-2 flex items-center gap-3">
                <div class="w-1.5 h-8 ${sc.bar} rounded-full"></div>
                <span class="font-mono text-sm text-primary">#${shortId}</span>
            </div>
            <div class="col-span-3 flex items-center gap-3">
                <div>
                    <div class="text-sm font-bold text-on-surface">${s.vessel.name}</div>
                    <div class="text-[10px] text-slate-500 uppercase tracking-tight">
                        ${s.type === "incoming" ? "Incoming" : "Outgoing"} • ${s.vessel.container_count} Units
                    </div>
                </div>
            </div>
            <div class="col-span-2">
                <div class="text-sm text-on-surface">${dateStr}</div>
                <div class="text-[10px] text-slate-500 uppercase">${timeStr} ETA</div>
            </div>
            <div class="col-span-2">
                <div class="flex items-center gap-1.5">
                    <span class="material-symbols-outlined text-sm text-slate-500">grid_view</span>
                    <span class="text-xs text-on-surface uppercase font-medium">—</span>
                </div>
            </div>
            <div class="col-span-2">
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${sc.bg} ${sc.text} border ${sc.border} uppercase tracking-tighter">
                    <span class="w-1 h-1 ${sc.dot} rounded-full mr-1.5"></span>
                    ${sc.label}
                </span>
            </div>
            <div class="col-span-1 text-right relative">
                <button onclick="toggleMenu(this)"
                    class="text-slate-500 hover:text-accent-orange transition-colors">
                    <span class="material-symbols-outlined">more_vert</span>
                </button>
                <div class="menu hidden absolute right-0 mt-2 w-32 bg-slate-900 border border-slate-700 rounded-lg shadow-lg z-50">
                    <button onclick="editShipment(this)"
                        class="w-full text-left px-4 py-2 text-sm hover:bg-slate-800 flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">edit</span> Edit
                    </button>
                    <button onclick="deleteRow(this)"
                        class="w-full text-left px-4 py-2 text-sm hover:bg-red-600/20 text-red-400 flex items-center gap-2">
                        <span class="material-symbols-outlined text-sm">delete</span> Delete
                    </button>
                </div>
            </div>
        `;
        row.addEventListener("click", (e) => {
            if (e.target.closest("button")) return; // don't trigger on menu clicks
            window.location.href = `DetailShipmentInfo.html?id=${row.dataset.id}`;
        });

        tbody.appendChild(row);
    });
}

// ── Pagination ────────────────────────────────────────────────────────────────

function updatePagination() {
    const total     = filtered.length;
    const start     = Math.min((currentPage - 1) * PAGE_SIZE + 1, total);
    const end       = Math.min(currentPage * PAGE_SIZE, total);
    const totalPages = Math.ceil(total / PAGE_SIZE);

    document.getElementById("pagination-label").textContent =
        total === 0 ? "No entries" : `Displaying ${start}–${end} of ${total} entries`;

    document.getElementById("btn-prev").disabled = currentPage <= 1;
    document.getElementById("btn-next").disabled = currentPage >= totalPages;
}

document.getElementById("btn-prev").addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderTable(); updatePagination(); }
});

document.getElementById("btn-next").addEventListener("click", () => {
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (currentPage < totalPages) { currentPage++; renderTable(); updatePagination(); }
});

// ── Filter/Sort Buttons ───────────────────────────────────────────────────────

function setActiveBtn(groupId, clickedBtn) {
    document.querySelectorAll(`[data-group="${groupId}"]`).forEach(b => {
        b.classList.remove("bg-accent-orange", "text-on-tertiary");
        b.classList.add("text-slate-500");
    });
    clickedBtn.classList.add("bg-accent-orange", "text-on-tertiary");
    clickedBtn.classList.remove("text-slate-500");
}

document.getElementById("btn-latest").addEventListener("click", function () {
    sortOrder = "latest"; setActiveBtn("sort", this); applyFilters();
});
document.getElementById("btn-oldest").addEventListener("click", function () {
    sortOrder = "oldest"; setActiveBtn("sort", this); applyFilters();
});
document.getElementById("btn-all").addEventListener("click", function () {
    filterType = "all"; setActiveBtn("filter", this); applyFilters();
});
document.getElementById("btn-incoming").addEventListener("click", function () {
    filterType = "incoming"; setActiveBtn("filter", this); applyFilters();
});
document.getElementById("btn-outgoing").addEventListener("click", function () {
    filterType = "outgoing"; setActiveBtn("filter", this); applyFilters();
});

// ── Row Actions ───────────────────────────────────────────────────────────────

function toggleMenu(button) {
    const menu = button.parentElement.querySelector(".menu");
    document.querySelectorAll(".menu").forEach(m => { if (m !== menu) m.classList.add("hidden"); });
    menu.classList.toggle("hidden");
}

async function deleteRow(btn) {
    const row = btn.closest(".data-table-row");
    const id  = row.dataset.id;
    if (!confirm("Delete this shipment?")) return;

    try {
        const res = await fetch(`https://gsc-app-630083017128.us-central1.run.app/api/v1/shipments/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (!res.ok) {
            alert(`Failed to delete shipment. Status: ${res.status}`);
            return;
        }
        const data = await res.json();
        if (data.success) {
            allShipments = allShipments.filter(s => s._id !== id);
            applyFilters();
            updateStatCards();
        } else {
            alert("Failed to delete shipment.");
        }
    } catch (err) {
        console.error("Delete error:", err);
    }
}

function editShipment(btn) {
    const row = btn.closest(".data-table-row");
    window.location.href = `add_shipment.html?id=${row.dataset.id}`;
}

document.addEventListener("click", function (e) {
    if (!e.target.closest(".menu") && !e.target.closest("button")) {
        document.querySelectorAll(".menu").forEach(m => m.classList.add("hidden"));
    }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchShipments();