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
      localStorage.setItem("token", data.token);
      localStorage.setItem("port_id", data.data.port_id);
      localStorage.setItem("user_name", data.data.name);

      window.location.href = "/Dashboardport.html";
    } else {
      showLoginError(data.message || "Login failed, please try again");
    }
  } catch (error) {
    console.error("Login error:", error);
    showLoginError("Could not connect to server, please try again later");
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

  const payload = {
    port_name,
    email,
    representative_name,
    password,
    location: { lat, lng },
    zones,
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