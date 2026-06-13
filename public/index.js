// Clears input on reload
window.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("input").forEach(input => {
        input.value = "";
    });
});

// Prevents reload from submission
document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  loginUser();
});

// helper — shows error inside the login box
function showLoginError(message) {
  const box = document.getElementById("login-error");
  const msg = document.getElementById("login-error-message");
  msg.textContent = message;
  box.classList.remove("hidden");
}

function hideLoginError() {
  document.getElementById("login-error").classList.add("hidden");
}

async function loginUser() {
  hideLoginError();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!email || !password) {
    showLoginError("Please enter your email and password");
    return;
  }

  // Show loading state
  const btn = document.getElementById("login-btn");
  const content = document.getElementById("login-btn-content");
  const loading = document.getElementById("login-btn-loading");
  btn.disabled = true;
  btn.classList.add("opacity-80", "cursor-not-allowed");
  content.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const response = await fetch("http://localhost:3000/api/v1/port/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

if (data.success) {
    localStorage.setItem("token",          data.token);
    localStorage.setItem("port_id",        data.data.port_id);
    localStorage.setItem("user_name",      data.data.name);

    window.location.href = "/Dashboardport.html";
}
    else {
      showLoginError(data.message || "Login failed, please try again");
    }
    
  } catch (error) {
    console.error("Login error:", error);
    showLoginError("Could not connect to server, please try again later");
  } finally {
    // Reset button state on failure (success redirects so this only runs on error)
    btn.disabled = false;
    btn.classList.remove("opacity-80", "cursor-not-allowed");
    content.classList.remove("hidden");
    loading.classList.add("hidden");
  }
}

// Toggle password view
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const icon = btn.querySelector(".material-symbols-outlined");

  if (input.type === "password") {
    input.type = "text";
    icon.textContent = "visibility_off";
  } else {
    input.type = "password";
    icon.textContent = "visibility";
  }
}



// ── Register error/success helpers ───────────────────────────────────────────

function showRegisterError(message) {
  const box = document.getElementById("register-error");
  const msg = document.getElementById("register-error-message");
  document.getElementById("register-success").classList.add("hidden");
  msg.textContent = message;
  box.classList.remove("hidden");
}

function showRegisterSuccess(message) {
  const box = document.getElementById("register-success");
  const msg = document.getElementById("register-success-message");
  document.getElementById("register-error").classList.add("hidden");
  msg.textContent = message;
  box.classList.remove("hidden");
}

function hideRegisterMessages() {
  document.getElementById("register-error").classList.add("hidden");
  document.getElementById("register-success").classList.add("hidden");
}

// ── Detect location using browser Geolocation API ────────────────────────────

function fetchLocation() {
  const btn = document.getElementById("location-btn");
  const btnText = document.getElementById("location-btn-text");

  if (!navigator.geolocation) {
    showRegisterError("Geolocation is not supported by your browser");
    return;
  }

  btnText.textContent = "Detecting...";
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById("reg-lat").value = position.coords.latitude.toFixed(6);
      document.getElementById("reg-lng").value = position.coords.longitude.toFixed(6);
      btnText.textContent = "Location Detected";
      btn.disabled = false;
    },
    (error) => {
      btnText.textContent = "Detect My Location";
      btn.disabled = false;

      switch (error.code) {
        case error.PERMISSION_DENIED:
          showRegisterError("Location access denied. Please enter coordinates manually or allow location access.");
          break;
        case error.POSITION_UNAVAILABLE:
          showRegisterError("Location unavailable. Please enter coordinates manually.");
          break;
        case error.TIMEOUT:
          showRegisterError("Location request timed out. Please try again.");
          break;
        default:
          showRegisterError("Could not detect location. Please enter coordinates manually.");
      }
    },
    { timeout: 10000 }
  );
}

// ── Collect zones from the DOM ────────────────────────────────────────────────

function collectZones() {
  const rows = document.querySelectorAll(".zone-row");
  const zones = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  rows.forEach((row, index) => {
    const capacityInput = row.querySelector("input[type='number']");
    const capacity = parseInt(capacityInput?.value);

    if (!capacityInput?.value || isNaN(capacity) || capacity <= 0) {
      return; // skip invalid rows
    }

    zones.push({
      zone_name: `Zone ${letters[index]}`,
      max_capacity: capacity,
    });
  });

  return zones;
}

// ── Zone management ───────────────────────────────────────────────────────────

let zoneCount = 0;
const container = document.getElementById("zones-container");

function addZone() {
    zoneCount++;
    const div       = document.createElement("div");
    div.className   = "flex items-center gap-3 zone-row";
    const zoneLetter = String.fromCharCode(64 + zoneCount + 1);
    div.innerHTML = `
        <span class="text-xs font-bold text-on-surface-variant w-10">${zoneLetter}</span>
        <input class="flex-1 bg-surface-container-lowest border-none text-sm py-2 px-2 rounded zone-capacity"
               placeholder="Capacity" type="number"/>
        <button type="button" class="text-error text-xs px-2 remove-zone">✕</button>
    `;
    container.appendChild(div);
}

container.addEventListener("click", (e) => {
    if (e.target.classList.contains("remove-zone")) {
        e.target.parentElement.remove();
    }
});

// ── Workforce management ──────────────────────────────────────────────────────

let shiftCount = 0;

const ROLE_KEYS = [
    { key: "crane_operators",  label: "Crane Operators",  inputId: "wf-crane"   },
    { key: "truck_operators",  label: "Truck Operators",  inputId: "wf-truck"   },
    { key: "customs_officers", label: "Customs Officers", inputId: "wf-customs" },
    { key: "ground_crew",      label: "Ground Crew",      inputId: "wf-ground"  },
    { key: "docking_staff",    label: "Docking Staff",    inputId: "wf-docking" },
];

// Update total workers display
function updateTotalWorkers() {
    const total = ROLE_KEYS.reduce((sum, r) => {
        return sum + (parseInt(document.getElementById(r.inputId)?.value) || 0);
    }, 0);
    document.getElementById("wf-total").textContent = total;
    return total;
}

// Recalculate shift times based on shift count
function getShiftTimes() {
    const count        = shiftCount;
    const totalMins    = 1440;
    const perShift     = Math.floor(totalMins / count);
    const times        = [];
    for (let i = 0; i < count; i++) {
        const startMins = perShift * i;
        const endMins   = i === count - 1 ? totalMins : perShift * (i + 1);
        const toTime    = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
        times.push({ start: toTime(startMins), end: toTime(endMins >= 1440 ? 0 : endMins) });
    }
    return times;
}

// Rebuild shift time labels when shifts are added/removed
function rebuildShiftLabels() {
    const times   = getShiftTimes();
    const headers = document.querySelectorAll(".shift-label");
    headers.forEach((el, i) => {
        if (times[i]) {
            el.textContent = `Shift ${i + 1} (${times[i].start}–${times[i].end})`;
        }
    });
}

function addShift() {
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
                    <input type="number" min="0" value="0"
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
    btn.closest(".shift-block").remove();
    shiftCount--;
    // Renumber remaining shifts
    document.querySelectorAll(".shift-block").forEach((block, i) => {
        block.dataset.shift = i + 1;
    });
    rebuildShiftLabels();
    validateShiftTotals();
}

// Update the "/ max" labels on each shift input
function updateShiftMaxes() {
    updateTotalWorkers();
    ROLE_KEYS.forEach(r => {
        const total = parseInt(document.getElementById(r.inputId)?.value) || 0;
        document.querySelectorAll(`.shift-max-label[data-role="${r.key}"]`)
            .forEach(el => { el.textContent = `/ ${total}`; });
    });
    validateShiftTotals();
}

// Validate shifts don't exceed total per role
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

// ── Collect workforce data ────────────────────────────────────────────────────

function collectWorkforce() {
    const roles = {};
    ROLE_KEYS.forEach(r => {
        roles[r.key] = parseInt(document.getElementById(r.inputId)?.value) || 0;
    });

    const shifts = [];
    document.querySelectorAll(".shift-block").forEach(block => {
        const shiftWorkers = {};
        ROLE_KEYS.forEach(r => {
            const inp = block.querySelector(`.shift-worker-input[data-role="${r.key}"]`);
            shiftWorkers[r.key] = parseInt(inp?.value) || 0;
        });
        shifts.push(shiftWorkers);
    });

    return { roles, shifts };
}

// ── Register function ─────────────────────────────────────────────────────────

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideRegisterMessages();

  const port_name       = document.getElementById("reg-port-name").value.trim();
  const email           = document.getElementById("reg-email").value.trim();
  const representative_name = document.getElementById("reg-rep-name").value.trim();
  const password        = document.getElementById("registerPassword").value;
  const lat             = parseFloat(document.getElementById("reg-lat").value);
  const lng             = parseFloat(document.getElementById("reg-lng").value);
  const zones           = collectZones();

  // ── Validate ──────────────────────────────────────────────────────────────

  if (!port_name || !email || !representative_name || !password) {
    showRegisterError("Please fill in all required fields");
    return;
  }

  if (isNaN(lat) || isNaN(lng)) {
    showRegisterError("Please enter a valid location or use Detect My Location");
    return;
  }

  if (zones.length === 0) {
    showRegisterError("Please add at least one zone with a valid capacity");
    return;
  }

  // ── Build payload ─────────────────────────────────────────────────────────

const { roles, shifts } = collectWorkforce();

  // Validate shifts before submitting
  if (shifts.length > 0 && !validateShiftTotals()) {
      showRegisterError("Shift worker assignments exceed total available workers for one or more roles");
      return;
  }

  const payload = {
      port_name,
      email,
      representative_name,
      password,
      location: { lat, lng },
      zones,
      workforce_roles:  roles,
      workforce_shifts: shifts
  };

  // ── Disable button while submitting ──────────────────────────────────────

  const submitBtn = document.querySelector("#register-form button[type='submit']");
  submitBtn.disabled = true;
  submitBtn.textContent = "Registering...";

  try {
    const response = await fetch("http://localhost:3000/api/v1/port/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem("token", data.token);
      localStorage.setItem("port_id", data.data.port.id);
      localStorage.setItem("user_name", data.data.user.name);

      showRegisterSuccess("Port registered successfully! Redirecting...");

      setTimeout(() => {
        window.location.href = "/Dashboardport.html";
      }, 1500);
    } else {
      showRegisterError(data.message || "Registration failed, please try again");
    }
  } catch (error) {
    console.error("Register error:", error);
    showRegisterError("Could not connect to server, please try again later");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Register Port Facility";
  }
});