// ── Auth ──────────────────────────────────────────────────────────────────────

const token = localStorage.getItem("token");
if (!token) window.location.href = "/index.html";

document.getElementById("logout-btn").addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.clear();
    window.location.href = "/index.html";
});

document.getElementById("sidebar-port-name").textContent =
    localStorage.getItem("port_name") || "Port";

// ── State ─────────────────────────────────────────────────────────────────────

let currentView  = "month";         // "month" | "week" | "day"
let currentDate  = new Date();      // anchor date — today on load
let calendarData = {};              // grouped shipments from backend { "YYYY-MM-DD": [...] }

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── Color helpers ─────────────────────────────────────────────────────────────

function getDotColor(shipment) {
    if (shipment.status === "delayed")  return "#ffb692";
    if (shipment.status === "at_port")  return "#5DCAA5";
    if (shipment.type   === "outgoing") return "#E24B4A";
    return "#639922";
}

function getStatusLabel(shipment) {
    if (shipment.status === "delayed")  return "DELAYED";
    if (shipment.status === "at_port")  return "DOCKED";
    if (shipment.type   === "outgoing") return "OUTBOUND";
    return "INBOUND";
}

function getArrow(shipment) {
    if (shipment.status === "delayed")  return "⚠";
    if (shipment.type   === "outgoing") return "↑";
    return "↓";
}

// ── Format helpers ────────────────────────────────────────────────────────────

function toDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}

function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function isToday(date) {
    const t = new Date();
    return date.getDate()     === t.getDate()  &&
           date.getMonth()    === t.getMonth() &&
           date.getFullYear() === t.getFullYear();
}

// ── Fetch from backend ────────────────────────────────────────────────────────

async function fetchCalendarData(year, month) {
    try {
        const res  = await fetch(
            `https://gsc-app-630083017128.us-central1.run.app/api/v1/shipments/calendar?year=${year}&month=${month}`,
            { headers: { "Authorization": `Bearer ${token}` } }
        );
        if (res.status === 401) {
            localStorage.clear();
            window.location.href = "/index.html";
            return;
        }
        const data = await res.json();
        if (data.success) calendarData = data.data;
    } catch (err) {
        console.error("Calendar fetch error:", err);
    }
}

// ── Popup ─────────────────────────────────────────────────────────────────────

function showPopup(dateKey, anchorEl) {
    const popup    = document.getElementById("global-popup");
    const list     = document.getElementById("popup-list");
    const label    = document.getElementById("popup-date-label");
    const shipments = calendarData[dateKey] || [];

    // Format label
    const [y, m, d] = dateKey.split("-");
    label.textContent = `${d} ${MONTHS[parseInt(m)-1]} ${y}`;

    if (shipments.length === 0) {
        list.innerHTML = `<li class="text-on-surface-variant text-center py-2">No shipments</li>`;
    } else {
        list.innerHTML = shipments.map(s => {
            const color = getDotColor(s);
            const arrow = getArrow(s);
            const time  = formatTime(s.event === "arrival" ? s.arrival : s.departure);
            return `
                <li class="flex items-center justify-between gap-2 py-1 border-b border-white/5 last:border-0">
                    <div class="flex items-center gap-2">
                        <span style="color:${color}">${arrow}</span>
                        <span class="truncate max-w-[120px]">${s.vessel_name}</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-on-surface-variant">${time}</span>
                        <span class="w-1.5 h-1.5 rounded-full" style="background:${color}"></span>
                    </div>
                </li>
            `;
        }).join("");
    }

    // Position popup near the clicked cell
    const rect  = anchorEl.getBoundingClientRect();
    const pW    = 256; // popup width
    let   left  = rect.left + window.scrollX;
    let   top   = rect.bottom + window.scrollY + 4;

    // Prevent going off screen right
    if (left + pW > window.innerWidth - 16) left = window.innerWidth - pW - 16;

    popup.style.left = left + "px";
    popup.style.top  = top  + "px";
    popup.classList.remove("hidden");
}

function closePopup() {
    document.getElementById("global-popup").classList.add("hidden");
}

document.getElementById("popup-close").addEventListener("click", closePopup);
document.addEventListener("click", (e) => {
    const popup = document.getElementById("global-popup");
    if (!popup.contains(e.target)) closePopup();
});

// ── Month View ────────────────────────────────────────────────────────────────

function renderMonth() {
    const year  = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-indexed

    document.getElementById("calendar-label").textContent =
        `${MONTHS[month]} ${year}`;
    document.getElementById("day-headers").classList.remove("hidden");

    const container = document.getElementById("calendar-container");
    container.className = "calendar-grid bg-surface-container-lowest rounded-xl overflow-hidden border border-white/5 shadow-inner";
    container.innerHTML = "";

    // First day of month (0=Sun, convert to Mon-based)
    const firstDay  = new Date(year, month, 1).getDay();
    const startPad  = (firstDay === 0) ? 6 : firstDay - 1;
    const daysInMonth   = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    // Prev month padding
    for (let i = startPad - 1; i >= 0; i--) {
        const day = daysInPrevMonth - i;
        container.appendChild(createGhostCell(day));
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
        const date    = new Date(year, month, d);
        const dateKey = toDateKey(date);
        const ships   = calendarData[dateKey] || [];
        const today   = isToday(date);

        const cell = document.createElement("div");
        cell.className = `group relative border-r border-b border-white/5 p-3 transition-colors cursor-pointer
            ${today ? "bg-surface-container-high/70" : "bg-surface hover:bg-surface-bright"}`;

        // Dots
        const dotsHtml = ships.length > 0 ? `
            <div class="mt-2 flex flex-wrap gap-1">
                ${ships.slice(0, 6).map(s =>
                    `<span class="w-2 h-2 rounded-full" style="background:${getDotColor(s)}" title="${s.vessel_name}"></span>`
                ).join("")}
                ${ships.length > 6 ? `<span class="text-[9px] text-on-surface-variant">+${ships.length-6}</span>` : ""}
            </div>` : "";

        cell.innerHTML = `
            <span class="text-xs font-headline font-bold ${today ? "text-tertiary" : "text-on-surface"}">${String(d).padStart(2,"0")}</span>
            ${dotsHtml}
        `;

        cell.addEventListener("click", (e) => {
            e.stopPropagation();
            showPopup(dateKey, cell);
        });

        container.appendChild(cell);
    }

    // Next month padding
    const totalCells = startPad + daysInMonth;
    const endPad     = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= endPad; i++) {
        container.appendChild(createGhostCell(i));
    }
}

function createGhostCell(dayNum) {
    const div = document.createElement("div");
    div.className = "bg-surface-container-low/30 border-r border-b border-white/5 p-3 opacity-30 select-none";
    div.innerHTML = `<span class="text-xs font-headline font-bold text-on-surface-variant">${String(dayNum).padStart(2,"0")}</span>`;
    return div;
}

// ── Week View ─────────────────────────────────────────────────────────────────

function renderWeek() {
    // Find Monday of current week
    const day    = currentDate.getDay();
    const diff   = (day === 0) ? -6 : 1 - day;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + diff);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    document.getElementById("calendar-label").textContent =
        `${monday.getDate()} ${MONTHS[monday.getMonth()]} — ${sunday.getDate()} ${MONTHS[sunday.getMonth()]} ${sunday.getFullYear()}`;
    document.getElementById("day-headers").classList.remove("hidden");

    const container = document.getElementById("calendar-container");
    container.className = "week-grid bg-surface-container-lowest rounded-xl overflow-hidden border border-white/5 shadow-inner";
    container.innerHTML = "";

    for (let i = 0; i < 7; i++) {
        const date    = new Date(monday);
        date.setDate(monday.getDate() + i);
        const dateKey = toDateKey(date);
        const ships   = calendarData[dateKey] || [];
        const today   = isToday(date);

        const cell = document.createElement("div");
        cell.className = `relative border-r border-white/5 p-3 transition-colors cursor-pointer overflow-hidden
            ${today ? "bg-surface-container-high/70" : "bg-surface hover:bg-surface-bright"}
            ${i === 6 ? "border-r-0" : ""}`;

        const shipsHtml = ships.length > 0
            ? ships.slice(0, 4).map(s => {
                const color = getDotColor(s);
                const time  = formatTime(s.event === "arrival" ? s.arrival : s.departure);
                return `
                    <div class="mt-1 px-1.5 py-1 rounded text-[9px] font-bold truncate"
                         style="background:${color}22; border-left: 2px solid ${color}; color:${color}">
                        ${time} ${s.vessel_name}
                    </div>`;
            }).join("") + (ships.length > 4 ? `<div class="text-[9px] text-on-surface-variant mt-1">+${ships.length-4} more</div>` : "")
            : "";

        cell.innerHTML = `
            <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-headline font-bold ${today ? "text-tertiary" : "text-on-surface"}">
                    ${String(date.getDate()).padStart(2,"0")}
                </span>
                ${ships.length > 0 ? `<span class="text-[9px] text-on-surface-variant">${ships.length}</span>` : ""}
            </div>
            ${shipsHtml}
        `;

        cell.addEventListener("click", (e) => {
            e.stopPropagation();
            showPopup(dateKey, cell);
        });

        container.appendChild(cell);
    }
}

// ── Day View ──────────────────────────────────────────────────────────────────

function renderDay() {
    const dateKey = toDateKey(currentDate);
    const ships   = calendarData[dateKey] || [];
    const today   = isToday(currentDate);

    document.getElementById("calendar-label").textContent =
        `${currentDate.getDate()} ${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    document.getElementById("day-headers").classList.add("hidden");

    const container = document.getElementById("calendar-container");
    container.className = "bg-surface-container-lowest rounded-xl overflow-hidden border border-white/5 shadow-inner";

    if (ships.length === 0) {
        container.innerHTML = `
            <div class="p-12 text-center text-on-surface-variant">
                <span class="material-symbols-outlined text-4xl mb-3 block">directions_boat</span>
                <p class="text-sm">No shipments scheduled for this day</p>
            </div>`;
        return;
    }

    container.innerHTML = ships.map(s => {
        const color      = getDotColor(s);
        const statusLbl  = getStatusLabel(s);
        const arrTime    = formatTime(s.arrival);
        const depTime    = formatTime(s.departure);
        const eventLabel = s.event === "arrival" ? "Arriving" : "Departing";

        return `
            <div class="flex items-center gap-6 p-5 border-b border-white/5 hover:bg-surface-bright transition-colors">
                <div class="w-1 self-stretch rounded-full" style="background:${color}"></div>
                <div class="w-16 shrink-0">
                    <p class="text-xs font-bold" style="color:${color}">${eventLabel}</p>
                    <p class="text-[10px] text-on-surface-variant">${s.event === "arrival" ? arrTime : depTime}</p>
                </div>
                <div class="flex-1">
                    <p class="text-sm font-bold font-headline">${s.vessel_name}</p>
                    <p class="text-[10px] text-on-surface-variant mt-0.5">
                        Arrival: ${arrTime} &nbsp;·&nbsp; Departure: ${depTime}
                    </p>
                </div>
                <span class="text-[10px] font-bold px-2 py-1 rounded-full"
                      style="color:${color}; background:${color}22">
                    ${statusLbl}
                </span>
            </div>
        `;
    }).join("");
}

// mute button till fetch data
function disableViewControls() {
    ["day", "week", "month"].forEach(v => {
        const btn = document.getElementById(`view-${v}`);
        btn.disabled = true;
        btn.classList.add("opacity-40", "cursor-not-allowed");
        btn.classList.remove("hover:text-primary");
    });
    document.getElementById("btn-prev").disabled  = true;
    document.getElementById("btn-next").disabled  = true;
    document.getElementById("btn-today").disabled = true;
    document.getElementById("btn-prev").classList.add("opacity-40", "cursor-not-allowed");
    document.getElementById("btn-next").classList.add("opacity-40", "cursor-not-allowed");
    document.getElementById("btn-today").classList.add("opacity-40", "cursor-not-allowed");
}

function enableViewControls() {
    ["day", "week", "month"].forEach(v => {
        const btn = document.getElementById(`view-${v}`);
        btn.disabled = false;
        btn.classList.remove("opacity-40", "cursor-not-allowed");
        btn.classList.add("hover:text-primary");
    });
    document.getElementById("btn-prev").disabled  = false;
    document.getElementById("btn-next").disabled  = false;
    document.getElementById("btn-today").disabled = false;
    document.getElementById("btn-prev").classList.remove("opacity-40", "cursor-not-allowed");
    document.getElementById("btn-next").classList.remove("opacity-40", "cursor-not-allowed");
    document.getElementById("btn-today").classList.remove("opacity-40", "cursor-not-allowed");
}

// ── Render Skeleton ───────────────────────────────────────────────────────────

function showCalendarSkeleton() {
    const container = document.getElementById("calendar-container");
    document.getElementById("calendar-label").innerHTML =
    `<span class="poms-skel" style="width:160px; height:14px; border-radius:4px; display:inline-block;"></span>`;

    if (currentView === "month") {
        document.getElementById("day-headers").classList.remove("hidden");
        container.className = "calendar-grid bg-surface-container-lowest rounded-xl overflow-hidden border border-white/5 shadow-inner";
        container.innerHTML = "";

        for (let i = 0; i < 35; i++) {
            const cell = document.createElement("div");
            // Every ~3rd cell gets a "busier" look for visual variety
            const hasDots = i % 3 === 0;
            const dotCount = hasDots ? (i % 2 === 0 ? 3 : 2) : 0;

            cell.className = "border-r border-b border-white/5 p-3";
            cell.innerHTML = `
                <!-- Date number skeleton -->
                <span class="poms-skel block rounded" style="width:18px; height:12px;"></span>

                <!-- Dot row skeleton — only on some cells -->
                ${hasDots ? `
                <div class="flex gap-1 mt-2">
                    ${Array(dotCount).fill(0).map(() =>
                        `<span class="poms-skel rounded-full" style="width:8px; height:8px;"></span>`
                    ).join("")}
                </div>` : ""}
            `;
            container.appendChild(cell);
        }

    } else if (currentView === "week") {
        document.getElementById("day-headers").classList.remove("hidden");
        container.className = "week-grid bg-surface-container-lowest rounded-xl overflow-hidden border border-white/5 shadow-inner";
        container.innerHTML = "";

        for (let i = 0; i < 7; i++) {
            const eventCount = [2, 1, 3, 0, 2, 1, 0][i]; // realistic variation
            const cell = document.createElement("div");
            cell.className = `border-r border-white/5 p-3 ${i === 6 ? "border-r-0" : ""}`;
            cell.innerHTML = `
                <!-- Date number + count -->
                <div class="flex items-center justify-between mb-2">
                    <span class="poms-skel block rounded" style="width:20px; height:12px;"></span>
                    ${eventCount > 0 ? `<span class="poms-skel block rounded" style="width:10px; height:10px;"></span>` : ""}
                </div>
                <!-- Event pill skeletons -->
                ${Array(eventCount).fill(0).map((_, j) => `
                    <div class="mt-1 px-1.5 py-1 rounded" style="background:rgba(186,200,220,0.06); border-left: 2px solid rgba(186,200,220,0.15);">
                        <span class="poms-skel block rounded" style="width:${60 + j * 15}%; height:10px;"></span>
                    </div>
                `).join("")}
            `;
            container.appendChild(cell);
        }

    } else {
        // Day view
        document.getElementById("day-headers").classList.add("hidden");
        container.className = "bg-surface-container-lowest rounded-xl overflow-hidden border border-white/5 shadow-inner";
        container.innerHTML = "";

        for (let i = 0; i < 5; i++) {
            const row = document.createElement("div");
            row.className = "flex items-center gap-6 p-5 border-b border-white/5";
            row.innerHTML = `
                <!-- Color bar -->
                <span class="poms-skel rounded-full flex-shrink-0" style="width:4px; height:40px;"></span>
                <!-- Time block -->
                <div class="space-y-1 flex-shrink-0" style="width:64px;">
                    <span class="poms-skel block rounded" style="width:52px; height:11px;"></span>
                    <span class="poms-skel block rounded" style="width:36px; height:9px;"></span>
                </div>
                <!-- Vessel name + meta -->
                <div class="flex-1 space-y-1">
                    <span class="poms-skel block rounded" style="width:55%; height:13px;"></span>
                    <span class="poms-skel block rounded" style="width:75%; height:9px;"></span>
                </div>
                <!-- Status badge -->
                <span class="poms-skel rounded-full flex-shrink-0" style="width:60px; height:20px;"></span>
            `;
            container.appendChild(row);
        }
    }
}
// ── Render dispatcher ─────────────────────────────────────────────────────────

async function render() {
    closePopup();

    disableViewControls();
    showCalendarSkeleton();
    // Fetch data for the relevant month
    const year  = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    await fetchCalendarData(year, month);

    if      (currentView === "month") renderMonth();
    else if (currentView === "week")  renderWeek();
    else                              renderDay();

    updateViewButtons();
    enableViewControls();
}

// ── View toggle buttons ───────────────────────────────────────────────────────

function updateViewButtons() {
    ["day","week","month"].forEach(v => {
        const btn = document.getElementById(`view-${v}`);
        if (v === currentView) {
            btn.className = "view-btn px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded bg-secondary-container text-on-secondary-container";
        } else {
            btn.className = "view-btn px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded text-on-surface-variant hover:text-primary transition-colors";
        }
    });
}

document.getElementById("view-month").addEventListener("click", () => {
    currentView = "month"; render();
});
document.getElementById("view-week").addEventListener("click", () => {
    currentView = "week"; render();
});
document.getElementById("view-day").addEventListener("click", () => {
    currentView = "day"; render();
});

// ── Navigation ────────────────────────────────────────────────────────────────

document.getElementById("btn-prev").addEventListener("click", () => {
    if (currentView === "month") {
        currentDate.setMonth(currentDate.getMonth() - 1);
    } else if (currentView === "week") {
        currentDate.setDate(currentDate.getDate() - 7);
    } else {
        currentDate.setDate(currentDate.getDate() - 1);
    }
    render();
});

document.getElementById("btn-next").addEventListener("click", () => {
    if (currentView === "month") {
        currentDate.setMonth(currentDate.getMonth() + 1);
    } else if (currentView === "week") {
        currentDate.setDate(currentDate.getDate() + 7);
    } else {
        currentDate.setDate(currentDate.getDate() + 1);
    }
    render();
});

document.getElementById("btn-today").addEventListener("click", () => {
    currentDate = new Date();
    render();
});

// ── Boot ──────────────────────────────────────────────────────────────────────

render();