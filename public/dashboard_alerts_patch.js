/**
 * NAUTICAL.OS — Dashboard Live Alerts Patch
 * GSC/public/dashboard_alerts_patch.js
 *
 * - Clears hardcoded alerts on load
 * - Reads IE alerts from localStorage (all shipments ever visited)
 * - Fetches ALL shipments from API (not just today) to catch any active issues
 * - Shows "All Clear" when nothing is wrong
 * - Auto-refreshes every 30s
 */

(function () {
    const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 };

    const SEVERITY_STYLE = {
        CRITICAL: {
            dot:    "#f87171",
            border: "rgba(248,113,113,0.2)",
            bg:     "rgba(248,113,113,0.06)",
            label:  "#f87171",
            icon:   "🔴",
        },
        WARNING: {
            dot:    "#fb923c",
            border: "rgba(251,146,60,0.2)",
            bg:     "rgba(251,146,60,0.06)",
            label:  "#fb923c",
            icon:   "🟠",
        },
        INFO: {
            dot:    "#60a5fa",
            border: "rgba(96,165,250,0.2)",
            bg:     "rgba(96,165,250,0.06)",
            label:  "#60a5fa",
            icon:   "🔵",
        },
    };

    // Step 1: Immediately wipe hardcoded static alerts
    function clearHardcodedAlerts() {
        const container = document.getElementById("alerts-container");
        if (container) {
            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;padding:12px 0;
                    color:#8e9196;font-family:Inter,sans-serif;">
                    <span style="font-size:14px;">⏳</span>
                    <p style="font-size:10px;">Loading alerts...</p>
                </div>`;
        }
    }

    // Step 2: Read IE alerts from localStorage for ALL shipments
    function loadAllIEAlerts() {
        const results = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith("nautical_alerts_v2_")) continue;
            try {
                const alerts = JSON.parse(localStorage.getItem(key) || "[]");
                const shipId = key.replace("nautical_alerts_v2_", "");
                alerts.forEach(a => {
                    if (!a.dismissed) results.push({ ...a, shipmentId: shipId });
                });
            } catch (_) {}
        }
        return results;
    }

    // Step 3: Generate alerts directly from shipment API data
    function alertsFromShipments(shipments) {
        const alerts = [];
        const now    = Date.now();

        shipments.forEach(s => {
            const id        = s._id?.toString() || "unknown";
            const shortId   = id.slice(-8).toUpperCase();
            const name      = s.vessel?.name    || "Unknown vessel";
            const route     = `${s.cargo?.origin || "?"} → ${s.cargo?.destination || "?"}`;
            const isArrived = ["arrived", "at_port", "departed"].includes(s.status);

            // Storm flag
            if (s.latest_weather?.storm_flag) {
                alerts.push({
                    id: `STORM_${id}`, severity: "CRITICAL",
                    title: `⚠ Storm — ${name}`,
                    body: `Active storm at vessel position on route ${route}.`,
                    timestamp: new Date().toISOString(),
                    shipmentId: id, shortId, linkable: true,
                });
            }

            // Delayed status
            if (s.status === "delayed") {
                alerts.push({
                    id: `DELAYED_${id}`, severity: "WARNING",
                    title: `Delayed — ${name}`,
                    body: `Vessel on route ${route} is marked DELAYED.`,
                    timestamp: new Date().toISOString(),
                    shipmentId: id, shortId, linkable: true,
                });
            }

            // Arrival overdue
            const schedArr = s.schedule?.arrival
                ? new Date(s.schedule.arrival).getTime() : null;
            if (schedArr && schedArr < now && !isArrived) {
                const hoursLate = Math.round((now - schedArr) / 3_600_000);
                if (hoursLate > 1) {
                    alerts.push({
                        id: `OVERDUE_${id}`, severity: "CRITICAL",
                        title: `Arrival Overdue — ${name}`,
                        body: `Expected at ${s.cargo?.destination || "destination"} — ${hoursLate}h late. Route: ${route}.`,
                        timestamp: new Date().toISOString(),
                        shipmentId: id, shortId, linkable: true,
                    });
                }
            }

            // Low progress with no days remaining
            if (
                typeof s.progress === "number" &&
                s.progress < 80 &&
                s.days_remaining === 0 &&
                !isArrived
            ) {
                alerts.push({
                    id: `GAP_${id}`, severity: "WARNING",
                    title: `Low Progress — ${name}`,
                    body: `Only ${s.progress}% complete with 0 days remaining. Route: ${route}.`,
                    timestamp: new Date().toISOString(),
                    shipmentId: id, shortId, linkable: true,
                });
            }
        });

        return alerts;
    }

    // Step 4: Merge IE + API alerts, deduplicate, sort by severity
    function mergeAlerts(ieAlerts, apiAlerts) {
        const seen   = new Set(ieAlerts.map(a => a.id));
        const merged = [...ieAlerts];
        apiAlerts.forEach(a => {
            if (!seen.has(a.id)) {
                seen.add(a.id);
                merged.push(a);
            }
        });
        return merged.sort((a, b) =>
            (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
        );
    }

    // Step 5: Render into the panel
    function renderAlerts(alerts) {
        const container = document.getElementById("alerts-container");
        if (!container) return;

        // Update header badge
        const section   = container.closest(".bg-surface-container");
        const headerRow = section?.querySelector(".flex.items-center.gap-2.mb-6");
        if (headerRow) {
            headerRow.querySelector(".alert-badge")?.remove();
            if (alerts.length > 0) {
                const critCount = alerts.filter(a => a.severity === "CRITICAL").length;
                const badge     = document.createElement("span");
                badge.className = "alert-badge";
                badge.style.cssText = `
                    margin-left:auto;font-size:9px;font-weight:800;
                    padding:2px 9px;border-radius:20px;
                    background:${critCount > 0 ? "#f87171" : "#fb923c"};
                    color:white;font-family:Inter,sans-serif;letter-spacing:0.04em;
                `;
                badge.textContent = `${alerts.length} ACTIVE`;
                headerRow.appendChild(badge);
            }
        }

        // All clear
        if (alerts.length === 0) {
            container.innerHTML = `
                <div style="display:flex;align-items:center;gap:10px;padding:14px 0;
                    font-family:Inter,sans-serif;">
                    <span style="font-size:20px;">✅</span>
                    <div>
                        <p style="font-size:11px;font-weight:700;color:#4ADE80;margin:0;">All Clear</p>
                        <p style="font-size:10px;color:#8e9196;margin:3px 0 0;">
                            No active alerts across all shipments
                        </p>
                    </div>
                </div>`;
            return;
        }

        container.innerHTML = alerts.map(a => {
            const st   = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.INFO;
            const ts   = a.timestamp
                ? new Date(a.timestamp).toLocaleString("en-IN", {
                    day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit"
                  })
                : "";
            const link = a.linkable && a.shipmentId
                ? `<a href="DetailShipmentInfo.html?id=${a.shipmentId}"
                      style="font-size:9px;color:${st.label};font-weight:700;
                             text-decoration:none;border:1px solid ${st.border};
                             padding:2px 8px;border-radius:10px;display:inline-block;
                             font-family:Inter,sans-serif;">
                        View #${a.shortId} →
                   </a>`
                : "";
            return `
                <div style="background:${st.bg};border:1px solid ${st.border};
                    border-left:3px solid ${st.dot};border-radius:8px;
                    padding:10px 12px;font-family:Inter,sans-serif;margin-bottom:8px;">
                    <div style="display:flex;align-items:flex-start;gap:8px;">
                        <span style="font-size:12px;margin-top:1px;flex-shrink:0;">${st.icon}</span>
                        <div style="flex:1;min-width:0;">
                            <p style="font-size:10px;font-weight:700;color:${st.label};margin:0 0 3px;">
                                ${a.title}
                            </p>
                            <p style="font-size:10px;color:#c4c6cc;line-height:1.5;margin:0;">
                                ${a.body}
                            </p>
                            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
                                ${link}
                                ${ts ? `<span style="font-size:8px;color:#44474c;">${ts}</span>` : ""}
                            </div>
                        </div>
                    </div>
                </div>`;
        }).join("");
    }

    // Main refresh
    async function refreshDashboardAlerts() {
        const token = localStorage.getItem("token");
        if (!token) return;

        let apiAlerts = [];
        try {
            // ALL shipments — not just today
            const res = await fetch("https://gsc-app-630083017128.us-central1.run.app/api/v1/shipments", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.data)) {
                    apiAlerts = alertsFromShipments(data.data);
                }
            }
        } catch (e) {
            console.warn("[alerts-patch] API fetch failed:", e);
        }

        const ieAlerts = loadAllIEAlerts();
        const merged   = mergeAlerts(ieAlerts, apiAlerts);
        renderAlerts(merged);
    }

    // Boot
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            clearHardcodedAlerts();
            refreshDashboardAlerts();
        });
    } else {
        clearHardcodedAlerts();
        refreshDashboardAlerts();
    }

    setInterval(refreshDashboardAlerts, 30_000);
    window.refreshDashboardAlerts = refreshDashboardAlerts;
})();