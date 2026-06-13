const token  = localStorage.getItem("token");
const portId = localStorage.getItem("port_id");

if (!token) window.location.href = "/index.html";

const userName = localStorage.getItem("user_name") || "";
document.getElementById("user-avatar").textContent       = userName.substring(0, 2).toUpperCase() || "--";
document.getElementById("sidebar-port-name").textContent  = localStorage.getItem("port_name") || "Port";

// ── Role config ────────────────────────────────────────────────────────────────

const ROLE_KEYS = [
    { key: "crane_operators",  label: "Crane Operators",  inputId: "wf-crane"   },
    { key: "truck_operators",  label: "Truck Operators",  inputId: "wf-truck"   },
    { key: "customs_officers", label: "Customs Officers", inputId: "wf-customs" },
    { key: "ground_crew",      label: "Ground Crew",      inputId: "wf-ground"  },
    { key: "docking_staff",    label: "Docking Staff",    inputId: "wf-docking" },
];

let shiftCount = 0;

// ── Fetch current workforce ───────────────────────────────────────────────────

async function fetchWorkforce() {
    try {
        const res  = await fetch("http://localhost:3000/api/v1/port/workforce", {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const data = await res.json();

        if (!data.success) {
            showError("Could not load workforce data");
            return;
        }

        populateForm(data.workforce);

        document.getElementById("workforce-loading").classList.add("hidden");
        document.getElementById("workforce-content").classList.remove("hidden");

    } catch (err) {
        console.error("Fetch workforce error:", err);
        showError("Could not connect to server");
    }
}

// ── Populate form with existing data ──────────────────────────────────────────

function populateForm(workforce) {
    const roles  = workforce.roles  || {};
    const shifts = workforce.shifts || [];

    // Role totals
    ROLE_KEYS.forEach(r => {
        document.getElementById(r.inputId).value = roles[r.key] || 0;
    });
    updateTotalWorkers();

    // ── Reset shift container before rebuilding ──────────────────────────────
    document.getElementById("shifts-container").innerHTML = "";
    shiftCount = 0;

    if (shifts.length > 0) {
        shifts.forEach(shift => addShift(shift.workers));
    } else {
        addShift();
    }

    updateShiftMaxes();
}

// ── Total workers display ─────────────────────────────────────────────────────

function updateTotalWorkers() {
    const total = ROLE_KEYS.reduce((sum, r) => {
        return sum + (parseInt(document.getElementById(r.inputId)?.value) || 0);
    }, 0);
    document.getElementById("wf-total").textContent = total;
    return total;
}

// ── Shift time recalculation (display only — backend recalculates on save) ───

function getShiftTimes() {
    const count    = shiftCount;
    const totalMins = 1440;
    const perShift  = Math.floor(totalMins / count);
    const times     = [];
    for (let i = 0; i < count; i++) {
        const startMins = perShift * i;
        const endMins   = i === count - 1 ? totalMins : perShift * (i + 1);
        const toTime    = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
        times.push({ start: toTime(startMins), end: toTime(endMins >= 1440 ? 0 : endMins) });
    }
    return times;
}

function rebuildShiftLabels() {
    const times   = getShiftTimes();
    const headers = document.querySelectorAll(".shift-label");
    headers.forEach((el, i) => {
        if (times[i]) {
            el.textContent = `Shift ${i + 1} (${times[i].start}–${times[i].end})`;
        }
    });
}

// ── Add / Remove shift blocks ─────────────────────────────────────────────────

function addShift(existingWorkers = null) {
    shiftCount++;
    const shiftsContainer = document.getElementById("shifts-container");
    const shiftDiv        = document.createElement("div");
    shiftDiv.className    = "shift-block bg-surface-container-low rounded-lg p-3 border border-primary/10";
    shiftDiv.dataset.shift = shiftCount;

    shiftDiv.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <span class="shift-label text-xs font-bold text-primary uppercase tracking-wider">
                Shift ${shiftCount}
            </span>
            <button type="button" onclick="removeShift(this)"
                class="text-error text-xs hover:opacity-80">✕ Remove</button>
        </div>
        <div class="grid grid-cols-1 gap-2">
            ${ROLE_KEYS.map(r => `
                <div class="flex items-center gap-2">
                    <label class="text-[10px] text-on-surface-variant w-32 shrink-0">${r.label}</label>
                    <input type="number" min="0" value="${existingWorkers?.[r.key] ?? 0}"
                        data-role="${r.key}"
                        class="flex-1 bg-surface-container-lowest border-none text-sm py-1.5 px-2 rounded shift-worker-input focus:ring-1 focus:ring-secondary"
                        oninput="validateShiftTotals()"/>
                    <span class="text-[10px] text-outline shift-max-label" data-role="${r.key}">
                        / 0
                    </span>
                </div>
            `).join("")}
        </div>
    `;

    shiftsContainer.appendChild(shiftDiv);
    rebuildShiftLabels();
    updateShiftMaxes();
    validateShiftTotals();
}

function removeShift(btn) {
    const container = document.getElementById("shifts-container");
    if (container.children.length <= 1) {
        showError("At least one shift is required");
        return;
    }

    btn.closest(".shift-block").remove();
    shiftCount--;

    // Renumber remaining shifts
    document.querySelectorAll(".shift-block").forEach((block, i) => {
        block.dataset.shift = i + 1;
    });
    rebuildShiftLabels();
    validateShiftTotals();
}

// ── Update "/ max" labels ──────────────────────────────────────────────────────

function updateShiftMaxes() {
    updateTotalWorkers();
    ROLE_KEYS.forEach(r => {
        const total = parseInt(document.getElementById(r.inputId)?.value) || 0;
        document.querySelectorAll(`.shift-max-label[data-role="${r.key}"]`)
            .forEach(el => { el.textContent = `/ ${total}`; });
    });
    validateShiftTotals();
}

// ── Validate shift totals vs role totals ──────────────────────────────────────

function validateShiftTotals() {
    const validationBox = document.getElementById("shift-validation");
    const errors        = [];

    ROLE_KEYS.forEach(r => {
        const total    = parseInt(document.getElementById(r.inputId)?.value) || 0;
        const shiftSum = Array.from(
            document.querySelectorAll(`.shift-worker-input[data-role="${r.key}"]`)
        ).reduce((sum, inp) => sum + (parseInt(inp.value) || 0), 0);

        if (shiftSum > total) {
            errors.push(`${r.label}: assigned ${shiftSum} across shifts but total is ${total}`);
        }
    });

    if (errors.length > 0) {
        validationBox.innerHTML = errors.map(e =>
            `<p class="text-[10px] text-error flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">warning</span>${e}
            </p>`
        ).join("");
        validationBox.classList.remove("hidden");
    } else {
        validationBox.classList.add("hidden");
    }

    return errors.length === 0;
}

// ── Collect form data ──────────────────────────────────────────────────────────

function collectWorkforce() {
    const roles = {};
    ROLE_KEYS.forEach(r => {
        roles[r.key] = parseInt(document.getElementById(r.inputId)?.value) || 0;
    });

    const shifts = [];
    document.querySelectorAll(".shift-block").forEach(block => {
        const workers = {};
        ROLE_KEYS.forEach(r => {
            const inp = block.querySelector(`.shift-worker-input[data-role="${r.key}"]`);
            workers[r.key] = parseInt(inp?.value) || 0;
        });
        shifts.push({ workers });
    });

    return { roles, shifts };
}

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

// ── Submit ─────────────────────────────────────────────────────────────────────

document.getElementById("workforce-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideMessages();

    if (!validateShiftTotals()) {
        showError("Shift worker assignments exceed total available workers for one or more roles");
        return;
    }

    const { roles, shifts } = collectWorkforce();

    const btn        = document.getElementById("submit-btn");
    const btnContent = document.getElementById("submit-btn-content");
    const btnLoading = document.getElementById("submit-btn-loading");
    btn.disabled = true;
    btnContent.classList.add("hidden");
    btnLoading.classList.remove("hidden");
    btnLoading.style.display = "flex";

    try {
        const res = await fetch("http://localhost:3000/api/v1/port/workforce", {
            method:  "PUT",
            headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ roles, shifts })
        });

        const data = await res.json();

        if (data.success) {
            showSuccess("Workforce updated successfully!");
            // Refresh shift labels to reflect server-recalculated times
            populateForm(data.workforce);
        } else {
            if (data.errors?.length) {
                showError(`${data.message}: ${data.errors.join("; ")}`);
            } else {
                showError(data.message || "Failed to update workforce");
            }
        }

    } catch (err) {
        console.error("Submit error:", err);
        showError("Could not connect to server, please try again");

    } finally {
        btn.disabled = false;
        btnContent.classList.remove("hidden");
        btnLoading.classList.add("hidden");
        btnLoading.style.display = "none";
    }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

fetchWorkforce();