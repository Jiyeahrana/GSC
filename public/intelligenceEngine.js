/**
 * NAUTICAL.OS — Intelligence Engine v2
 * intelligenceEngine.js
 *
 * Pure rule-based + ML scoring.
 * Fixed: elapsed time, button handlers, speed calc, stationary detection.
 * New: terminate action, stationary alerts, ML narrative generator.
 */

const IE_COLORS = {
    critical : "#f87171",
    warning  : "#fb923c",
    info     : "#60a5fa",
    success  : "#4ADE80",
    neutral  : "#94a3b8",
    accent   : "#fb6b00",
};

const ALERT_STORAGE_KEY = (id) => `nautical_alerts_v2_${id}`;
let _currentShipmentId = null;

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────
function runIntelligenceEngine(s) {
    _currentShipmentId = s._id?.toString() || "unknown";

    // Merge persisted checkpoint states with live data
    s = mergePersistedCheckpoints(s);

    const metrics = computeMetrics(s);
    const alerts  = runAlertEngine(s, metrics);
    renderIntelligencePanel(s, metrics, alerts);
    attachActionHandlers(s, metrics, alerts);
}
// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT PERSISTENCE
// Once a checkpoint is marked "reached", it stays reached forever in localStorage.
// Merges persisted state onto live backend data so progress never regresses.
// ─────────────────────────────────────────────────────────────────────────────
const CP_STORAGE_KEY = (id) => `nautical_checkpoints_${id}`;

function mergePersistedCheckpoints(s) {
    if (!s.checkpoints?.length) return s;

    // Load what we've previously saved
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(CP_STORAGE_KEY(_currentShipmentId)) || "{}");
    } catch (_) {}

    // Merge: if backend says reached, save it. If saved says reached, keep it.
    const merged = s.checkpoints.map(cp => {
        const key = cp._id?.toString() || cp.name;

        // If backend marks it reached now, save that permanently
        if (cp.status === "reached") {
            saved[key] = {
                status: "reached",
                actual_arrival: cp.actual_arrival || new Date().toISOString()
            };
        }

        // If we have a saved "reached" state, override whatever backend says
        if (saved[key]?.status === "reached") {
            return {
                ...cp,
                status: "reached",
                actual_arrival: cp.actual_arrival || saved[key].actual_arrival
            };
        }

        return cp;
    });

    // Persist updated state
    try {
        localStorage.setItem(CP_STORAGE_KEY(_currentShipmentId), JSON.stringify(saved));
    } catch (_) {}

    return { ...s, checkpoints: merged };
}
// ─────────────────────────────────────────────────────────────────────────────
// 1. METRICS
// ─────────────────────────────────────────────────────────────────────────────
function computeMetrics(s) {
    const snapshots   = s.weather_snapshots || [];
    const checkpoints = s.checkpoints || [];

    // Distance traveled
    let totalDistanceKm = 0;
    for (let i = 1; i < snapshots.length; i++) {
        totalDistanceKm += haversineKm(
            snapshots[i-1].lat, snapshots[i-1].lng,
            snapshots[i].lat,   snapshots[i].lng
        );
    }

    const isStationary = totalDistanceKm < 0.5 && snapshots.length > 0;
    if (isStationary) {
        const originCoords = geocodePortIE(s.cargo?.origin);
        const livePos      = s.latest_weather;
        if (originCoords && livePos?.lat && livePos?.lng) {
            totalDistanceKm = haversineKm(
                originCoords.lat, originCoords.lng,
                livePos.lat, livePos.lng
            );
        }
    }

    // Elapsed time
    let journeyStartMs;
    if (snapshots.length > 0 && snapshots[0].timestamp) {
        journeyStartMs = new Date(snapshots[0].timestamp).getTime();
    } else {
        journeyStartMs = new Date(s.schedule?.arrival || s.schedule?.departure).getTime();
    }
    const elapsedHours = Math.max((Date.now() - journeyStartMs) / 3_600_000, 1);

    // ── Checkpoints FIRST — needed for progress calculation ──────────────────
    const totalCPs   = checkpoints.length;
    const missedCPs  = checkpoints.filter(c => c.status === "missed").length;
    const reachedCPs = checkpoints.filter(c => c.status === "reached").length;
    const stormFlag  = s.latest_weather?.storm_flag || false;

    // Speed
    const avgSpeedKmh   = isStationary ? 0 : totalDistanceKm / elapsedHours;
    const avgSpeedKnots = avgSpeedKmh * 0.539957;

    let instSpeedKnots = 0;
    if (!isStationary && snapshots.length >= 2) {
        const segHours = elapsedHours / Math.max(snapshots.length - 1, 1);
        const last2Km  = haversineKm(
            snapshots[snapshots.length-2].lat, snapshots[snapshots.length-2].lng,
            snapshots[snapshots.length-1].lat, snapshots[snapshots.length-1].lng
        );
        instSpeedKnots = (last2Km / segHours) * 0.539957;
    }

    // Progress — purely checkpoint based
    const actualPct   = totalCPs > 0 ? Math.round((reachedCPs / totalCPs) * 100) : 0;

    // Expected benchmark — time based
    const schedStart  = new Date(s.schedule?.arrival  || s.schedule?.departure);
    const schedEnd    = new Date(s.schedule?.departure || s.schedule?.arrival);
    const totalDays   = Math.max((schedEnd.getTime() - schedStart.getTime()) / 86_400_000, 1);
    const elapsedDays = elapsedHours / 24;
    const expectedPct = Math.min((elapsedDays / totalDays) * 100, 100);
    const progressGap = expectedPct - actualPct;

    // ML Risk Score
   const gapScore    = Math.max(0, Math.min(progressGap / 50, 1)) * 30;
const cpScore     = totalCPs > 0 ? (missedCPs / totalCPs) * 25 : 0;
const stormScore  = stormFlag ? 20 : 0;
const normalSpeed = 12;
const speedDrop   = isStationary ? 1 : Math.max(0, (normalSpeed - avgSpeedKnots) / normalSpeed);
const speedScore  = speedDrop > 0.8 ? 20 : speedDrop > 0.5 ? 12 : speedDrop > 0.3 ? 6 : 0;

// Stationary score — scales with hours stopped, not a flat bonus
// 0-2h: 10pts, 2-6h: 25pts, 6-12h: 45pts, 12-24h: 65pts, 24h+: 80pts
const statScore = !isStationary ? 0
    : elapsedHours < 2  ? 10
    : elapsedHours < 6  ? 25
    : elapsedHours < 12 ? 45
    : elapsedHours < 24 ? 65
    : 80;

const riskScore = Math.min(Math.round(gapScore + cpScore + stormScore + speedScore + statScore), 100);
const riskTier  = riskScore >= 76 ? "CRITICAL" : riskScore >= 51 ? "HIGH" : riskScore >= 26 ? "MEDIUM" : "LOW";
    // Revised ETA
    let revisedETA = null, etaDeltaHours = null;
    if (avgSpeedKmh > 0.5) {
        const originC = geocodePortIE(s.cargo?.origin);
        const destC   = geocodePortIE(s.cargo?.destination);
        if (originC && destC) {
            const totalRouteKm = haversineKm(originC.lat, originC.lng, destC.lat, destC.lng);
            const remainingKm  = Math.max(totalRouteKm - totalDistanceKm, 0);
            revisedETA    = new Date(Date.now() + (remainingKm / avgSpeedKmh) * 3_600_000);
            etaDeltaHours = (revisedETA.getTime() - schedEnd.getTime()) / 3_600_000;
        }
    }

    const mlNarrative = generateMLNarrative({
        isStationary, riskScore, riskTier, progressGap, actualPct, expectedPct,
        avgSpeedKnots, instSpeedKnots, missedCPs, totalCPs, stormFlag,
        etaDeltaHours, elapsedHours, totalDays, elapsedDays
    });

    return {
        avgSpeedKnots, instSpeedKnots, totalDistanceKm,
        expectedPct, actualPct, progressGap,
        totalCPs, missedCPs, reachedCPs,
        stormFlag, riskScore, riskTier,
        revisedETA, scheduledETA: schedEnd, etaDeltaHours,
        elapsedHours, elapsedDays, totalDays,
        isStationary, mlNarrative
    };
}
 
// ─────────────────────────────────────────────────────────────────────────────
// 2. ML NARRATIVE
// ─────────────────────────────────────────────────────────────────────────────
function generateMLNarrative(f) {
    const confidence = f.isStationary ? "MEDIUM"
                     : f.elapsedHours < 2 ? "LOW"
                     : f.elapsedHours > 12 ? "HIGH" : "MEDIUM";

    let situation = "";
    if (f.isStationary) {
        situation = `Vessel GPS shows no movement across all ${f.elapsedHours < 2 ? "recent" : Math.round(f.elapsedHours) + "h of"} tracking snapshots. The device is reporting identical coordinates, indicating the vessel is anchored, in a port hold, or the GPS unit is not transmitting position updates.`;
    } else if (f.riskScore >= 76) {
        situation = `Critical risk conditions detected. Vessel is ${f.progressGap.toFixed(1)}% behind expected schedule at ${f.avgSpeedKnots.toFixed(1)} kn avg — below the 12 kn baseline. Multiple delay factors are compounding simultaneously.`;
    } else if (f.riskScore >= 51) {
        situation = `Elevated risk detected. Progress at ${f.actualPct}% vs expected ${f.expectedPct.toFixed(0)}%. Speed and checkpoint deviations suggest schedule pressure is building and requires monitoring.`;
    } else if (f.progressGap < -5) {
        situation = `Vessel is ahead of schedule by ${Math.abs(f.progressGap).toFixed(1)}%. Current avg speed ${f.avgSpeedKnots.toFixed(1)} kn is performing above the 12 kn baseline. Conditions are nominal.`;
    } else {
        situation = `Shipment is tracking within normal parameters. Progress at ${f.actualPct}% against expected ${f.expectedPct.toFixed(0)}%. ML risk score ${f.riskScore}/100 — ${f.riskTier} tier. No critical issues detected.`;
    }

    let predictedDelayHours = 0;
    if (f.isStationary) {
        predictedDelayHours = Math.round(f.elapsedHours * 1.2);
    } else if (f.etaDeltaHours !== null) {
        predictedDelayHours = Math.max(0, Math.round(f.etaDeltaHours));
    } else if (f.progressGap > 0) {
        predictedDelayHours = Math.round((f.progressGap / 100) * f.totalDays * 24);
    }

    let recommendedAction = "", reasoning = "";
    if (f.isStationary && f.elapsedHours > 10) {
        recommendedAction = "Consider terminating or rescheduling this shipment immediately.";
        reasoning = `Vessel stationary for ${Math.round(f.elapsedHours)}h — likely mechanical failure, port hold, or GPS device fault.`;
    } else if (f.isStationary) {
        recommendedAction = "Contact captain to confirm vessel status and GPS device functionality.";
        reasoning = "Stationary GPS with active in-transit status requires immediate ops verification.";
    } else if (f.stormFlag) {
        recommendedAction = "Initiate reroute assessment to bypass active storm zone.";
        reasoning = "Storm at vessel position is the primary risk driver — rerouting reduces delay accumulation.";
    } else if (f.missedCPs > 0) {
        recommendedAction = `Investigate ${f.missedCPs} missed checkpoint${f.missedCPs > 1 ? "s" : ""} and adjust ETA accordingly.`;
        reasoning = "Checkpoint misses indicate route deviation or speed inconsistency needing ops review.";
    } else if (f.progressGap > 25) {
        recommendedAction = "Escalate to port authority and revise ETA for all stakeholders.";
        reasoning = `${f.progressGap.toFixed(0)}% schedule gap exceeds critical threshold — port coordination required.`;
    } else if (f.progressGap > 10) {
        recommendedAction = "Monitor closely. Contact captain to request speed recovery.";
        reasoning = "Current trajectory will result in late arrival without corrective action.";
    } else {
        recommendedAction = "Continue monitoring. No immediate action required.";
        reasoning = "All ML model factors within acceptable thresholds.";
    }

    const factors = [
        { label: "Progress deviation", value: f.progressGap > 0 ? f.progressGap.toFixed(1) + "% BEHIND" : f.progressGap < 0 ? Math.abs(f.progressGap).toFixed(1) + "% AHEAD" : "ON SCHEDULE", weight: 30, active: Math.abs(f.progressGap) > 5 },
        { label: "Checkpoint compliance", value: `${f.totalCPs - f.missedCPs}/${f.totalCPs} passed`, weight: 25, active: f.missedCPs > 0 },
        { label: "Storm risk", value: f.stormFlag ? "ACTIVE" : "CLEAR", weight: 20, active: f.stormFlag },
        { label: "Speed deviation", value: f.isStationary ? "STATIONARY" : f.avgSpeedKnots.toFixed(1) + " kn", weight: 20, active: f.isStationary || f.avgSpeedKnots < 8 },
       { label: "Stationary penalty", value: f.isStationary ? `+${f.elapsedHours < 2 ? 10 : f.elapsedHours < 6 ? 25 : f.elapsedHours < 12 ? 45 : f.elapsedHours < 24 ? 65 : 80} pts` : "NONE", weight: f.isStationary ? (f.elapsedHours < 2 ? 10 : f.elapsedHours < 6 ? 25 : f.elapsedHours < 12 ? 45 : f.elapsedHours < 24 ? 65 : 80) : 5, active: f.isStationary },
    ];

    return { situation, predictedDelayHours, confidence, recommendedAction, reasoning, factors };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ALERT ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function runAlertEngine(s, m) {
    const stored   = loadAlerts();
    const existing = new Map(stored.map(a => [a.id, a]));
    const now      = new Date().toISOString();

    const rules = [
        {
            id: "STORM_ACTIVE", condition: m.stormFlag, severity: "CRITICAL",
            title: "Storm Detected on Route",
            body: `Active storm at vessel position (${s.latest_weather?.lat?.toFixed(2)}°N). Reroute required.`
        },
        {
            id: "VESSEL_STATIONARY_CRIT",
            condition: m.isStationary && m.elapsedHours > 10, severity: "CRITICAL",
            title: `Vessel Stationary — ${Math.round(m.elapsedHours)}h No Movement`,
            body: `No GPS movement for over ${Math.round(m.elapsedHours)} hours. Termination or rescheduling should be considered.`
        },
        {
            id: "VESSEL_STATIONARY_WARN",
            condition: m.isStationary && m.elapsedHours <= 10, severity: "WARNING",
            title: "Vessel Appears Stationary",
            body: `All GPS snapshots at identical coordinates. Vessel may be anchored or GPS device not updating. Contact captain.`
        },
        {
            id: "PROGRESS_LAG_CRIT",
            condition: !m.isStationary && m.progressGap > 25, severity: "CRITICAL",
            title: "Severe Schedule Deviation",
            body: `Vessel is ${m.progressGap.toFixed(1)}% behind expected benchmark. Estimated ${m.etaDeltaHours ? Math.abs(m.etaDeltaHours).toFixed(0) + "h" : "unknown"} delay.`
        },
        {
            id: "PROGRESS_LAG_WARN",
            condition: !m.isStationary && m.progressGap > 15 && m.progressGap <= 25, severity: "WARNING",
            title: "Vessel Falling Behind Schedule",
            body: `Progress gap ${m.progressGap.toFixed(1)}%. Expected ${m.expectedPct.toFixed(0)}% complete, actual ${m.actualPct}%.`
        },
        {
            id: "MISSED_CP", condition: m.missedCPs > 0, severity: "WARNING",
            title: `${m.missedCPs} Checkpoint${m.missedCPs > 1 ? "s" : ""} Missed`,
            body: `Vessel missed ${m.missedCPs} of ${m.totalCPs} planned checkpoints.`
        },
        {
            id: "SPEED_LOW",
            condition: !m.isStationary && m.avgSpeedKnots < 5 && m.totalDistanceKm > 10, severity: "WARNING",
            title: "Abnormally Low Speed",
            body: `Avg speed ${m.avgSpeedKnots.toFixed(1)} kn critically below 12 kn baseline. Possible mechanical issue.`
        },
        {
            id: "RISK_CRITICAL", condition: m.riskScore > 75, severity: "CRITICAL",
            title: "Critical ML Risk Score",
            body: `ML risk model score ${m.riskScore}/100 — multiple delay factors compounding. Immediate action required.`
        },
        {
            id: "RISK_HIGH", condition: m.riskScore > 50 && m.riskScore <= 75, severity: "WARNING",
            title: "Elevated ML Risk Score",
            body: `ML risk score ${m.riskScore}/100. Combination of factors indicate elevated delay probability.`
        },
        {
            id: "ON_TRACK",
            condition: m.riskScore <= 25 && m.progressGap <= 5 && !m.stormFlag && m.missedCPs === 0 && !m.isStationary,
            severity: "INFO",
            title: "Shipment Progressing Normally",
            body: `All systems nominal. ML risk score ${m.riskScore}/100. No active delay factors.`
        },
    ];

    const newAlerts = [];
    rules.forEach(rule => {
        if (!rule.condition) return;
        if (existing.has(rule.id) && existing.get(rule.id).dismissed) {
            newAlerts.push(existing.get(rule.id));
        } else if (existing.has(rule.id)) {
            newAlerts.push({ ...existing.get(rule.id), body: rule.body, title: rule.title });
        } else {
            newAlerts.push({ id: rule.id, severity: rule.severity, title: rule.title, body: rule.body, timestamp: now, dismissed: false });
        }
    });

    saveAlerts(newAlerts);
    return newAlerts;
}

function loadAlerts() {
    try { return JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY(_currentShipmentId)) || "[]"); }
    catch { return []; }
}
function saveAlerts(a) {
    localStorage.setItem(ALERT_STORAGE_KEY(_currentShipmentId), JSON.stringify(a));
}
function dismissAlert(alertId) {
    const alerts   = loadAlerts().map(a => a.id === alertId ? { ...a, dismissed: true } : a);
    saveAlerts(alerts);
    document.getElementById(`alert-${alertId}`)?.remove();
    const remaining = alerts.filter(a => !a.dismissed).length;
    const badge = document.getElementById("ie-alert-badge");
    if (badge) { badge.textContent = remaining; badge.style.display = remaining > 0 ? "inline-flex" : "none"; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RENDER PANEL
// ─────────────────────────────────────────────────────────────────────────────
function renderIntelligencePanel(s, m, alerts) {
    const panel = document.getElementById("intelligence-panel");
    if (!panel) return;
    const activeAlerts  = alerts.filter(a => !a.dismissed);
    const criticalCount = activeAlerts.filter(a => a.severity === "CRITICAL").length;
    const n             = m.mlNarrative;

    panel.innerHTML = `
    <style>
        #intelligence-panel * { box-sizing:border-box; }
        .ie-sec { margin-bottom:14px; }
        .ie-lbl { font-size:9px; text-transform:uppercase; letter-spacing:0.1em; color:#8e9196;
            font-family:Inter,sans-serif; margin-bottom:7px; display:flex; align-items:center; gap:6px; }
        .ie-alert { padding:9px 10px; border-radius:6px; margin-bottom:5px; display:flex; gap:8px;
            align-items:flex-start; border-left:2px solid; font-family:Inter,sans-serif; }
        .ie-alert.CRITICAL { background:rgba(248,113,113,0.07); border-color:#f87171; }
        .ie-alert.WARNING  { background:rgba(251,146,60,0.07);  border-color:#fb923c; }
        .ie-alert.INFO     { background:rgba(96,165,250,0.07);  border-color:#60a5fa; }
        .ie-atitle { font-size:10px; font-weight:700; color:#d0e5f9; }
        .ie-abody  { font-size:9px; color:#8e9196; margin-top:2px; line-height:1.4; }
        .ie-dismiss { margin-left:auto; flex-shrink:0; cursor:pointer; color:#44474c; font-size:11px;
            padding:2px 4px; border-radius:3px; background:transparent; border:none; }
        .ie-dismiss:hover { color:#d0e5f9; background:rgba(255,255,255,0.06); }
        .ie-btn { width:100%; padding:8px 10px; border-radius:6px; border:1px solid; font-size:9px;
            font-weight:700; letter-spacing:0.06em; text-transform:uppercase; cursor:pointer;
            text-align:left; display:flex; align-items:center; gap:7px; font-family:Inter,sans-serif;
            transition:all 0.15s; margin-bottom:5px; background:none; }
        .ie-btn:disabled { opacity:0.3; cursor:default; }
        .ie-btn:not(:disabled):hover { filter:brightness(1.2); transform:translateX(2px); }
        .ie-sbox { flex:1; background:rgba(255,255,255,0.03); border:1px solid rgba(186,200,220,0.08);
            border-radius:6px; padding:8px; }
        .ie-sval { font-size:17px; font-weight:800; font-family:Manrope,sans-serif; color:#d0e5f9; line-height:1; }
        .ie-ssub { font-size:8px; color:#8e9196; text-transform:uppercase; letter-spacing:0.06em; margin-top:3px; }
        .ie-ai { background:rgba(96,165,250,0.05); border:1px solid rgba(96,165,250,0.18); border-radius:8px; padding:12px; }
        .ie-fbar { height:3px; border-radius:2px; margin-top:3px; background:rgba(255,255,255,0.06); overflow:hidden; }
        .ie-ffill { height:100%; border-radius:2px; transition:width 0.6s ease; }
        .ie-modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9999;
            display:flex; align-items:center; justify-content:center; }
        .ie-modal { background:#0c2230; border:1px solid rgba(186,200,220,0.15); border-radius:12px;
            padding:24px; max-width:480px; width:90%; max-height:80vh; overflow-y:auto;
            font-family:Inter,sans-serif; position:relative; }
        .ie-modal h3 { font-family:Manrope,sans-serif; font-size:16px; font-weight:800; color:#d0e5f9; margin:0 0 12px; }
        .ie-mclose { position:absolute; top:14px; right:14px; background:none; border:none;
            color:#8e9196; cursor:pointer; font-size:18px; }
        .ie-modal textarea, .ie-modal input { width:100%; background:rgba(255,255,255,0.04);
            border:1px solid rgba(186,200,220,0.15); border-radius:6px; padding:8px 10px;
            color:#d0e5f9; font-size:12px; font-family:Inter,sans-serif; resize:vertical; margin-top:6px; outline:none; }
        .ie-msub { margin-top:12px; padding:8px 16px; border-radius:6px; border:none; color:white;
            font-weight:700; font-size:11px; cursor:pointer; letter-spacing:0.05em;
            text-transform:uppercase; font-family:Inter,sans-serif; }
    </style>

    <!-- SPEED -->
    <div class="ie-sec">
        <div class="ie-lbl">⚡ Speed Telemetry</div>
        <div style="display:flex;gap:8px;">
            <div class="ie-sbox">
                <div class="ie-sval">${m.isStationary ? "0.0" : m.instSpeedKnots.toFixed(1)}<span style="font-size:9px;color:#8e9196;margin-left:3px;">kn</span></div>
                <div class="ie-ssub">Instantaneous</div>
            </div>
            <div class="ie-sbox">
                <div class="ie-sval">${m.isStationary ? "0.0" : m.avgSpeedKnots.toFixed(1)}<span style="font-size:9px;color:#8e9196;margin-left:3px;">kn</span></div>
                <div class="ie-ssub">Average</div>
            </div>
            <div class="ie-sbox">
                <div class="ie-sval">${m.totalDistanceKm.toFixed(0)}<span style="font-size:9px;color:#8e9196;margin-left:3px;">km</span></div>
                <div class="ie-ssub">Traveled</div>
            </div>
        </div>
        ${m.isStationary ? `<div style="margin-top:6px;font-size:9px;color:#fb923c;font-weight:600;font-family:Inter,sans-serif;">⚠ Vessel stationary — GPS not updating</div>` : ""}
    </div>

    <!-- RISK -->
    <div class="ie-sec">
        <div class="ie-lbl">🧠 ML Delay Risk Model</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            ${buildRiskGaugeSVG(m.riskScore, m.riskTier)}
            <div style="flex:1;font-size:11px;color:#8e9196;line-height:1.7;font-family:Inter,sans-serif;">
                <div>Progress gap: <span style="color:${m.progressGap > 5 ? IE_COLORS.warning : m.progressGap < -5 ? IE_COLORS.success : "#d0e5f9"};font-weight:600;">
    ${m.progressGap > 0 ? `${m.progressGap.toFixed(1)}% BEHIND` : m.progressGap < 0 ? `${Math.abs(m.progressGap).toFixed(1)}% AHEAD` : "ON SCHEDULE"}
</span></div>
                <div>Missed CPs: <span style="color:#d0e5f9;font-weight:600;">${m.missedCPs}/${m.totalCPs}</span></div>
                <div>Storm: <span style="color:${m.stormFlag ? IE_COLORS.critical : IE_COLORS.success};font-weight:600;">${m.stormFlag ? "ACTIVE" : "CLEAR"}</span></div>
                <div>Stationary: <span style="color:${m.isStationary ? IE_COLORS.warning : IE_COLORS.success};font-weight:600;">${m.isStationary ? "YES" : "NO"}</span></div>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
            ${n.factors.map(f => `
            <div>
                <div style="display:flex;justify-content:space-between;font-size:8px;color:${f.active ? "#d0e5f9" : "#44474c"};font-family:Inter,sans-serif;">
                    <span>${f.label}</span>
                    <span style="color:${f.active ? IE_COLORS.warning : "#44474c"}">${f.value}</span>
                </div>
                <div class="ie-fbar"><div class="ie-ffill" style="width:${f.weight}%;background:${f.active ? IE_COLORS.warning : "rgba(255,255,255,0.04)"};"></div></div>
            </div>`).join("")}
        </div>
    </div>

    <!-- ML ANALYSIS -->
    <div class="ie-sec">
        <div class="ie-lbl">🤖 ML Situation Analysis</div>
        <div class="ie-ai">
            <div style="font-size:11px;color:#d0e5f9;line-height:1.6;font-family:Inter,sans-serif;margin-bottom:10px;">${n.situation}</div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px;">
                <span style="font-size:9px;padding:2px 9px;border-radius:10px;background:rgba(248,113,113,0.1);color:#f87171;font-weight:700;font-family:Inter,sans-serif;">
                    Delay: ${n.predictedDelayHours > 0 ? "+" + n.predictedDelayHours + "h" : "On time"}
                </span>
                <span style="font-size:9px;padding:2px 9px;border-radius:10px;font-weight:700;font-family:Inter,sans-serif;
                    background:${n.confidence === "HIGH" ? "rgba(74,222,128,0.1)" : n.confidence === "MEDIUM" ? "rgba(251,146,60,0.1)" : "rgba(248,113,113,0.1)"};
                    color:${n.confidence === "HIGH" ? "#4ADE80" : n.confidence === "MEDIUM" ? "#fb923c" : "#f87171"};">
                    Confidence: ${n.confidence}
                </span>
            </div>
            <div style="font-size:9px;color:#fb6b00;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:3px;font-family:Inter,sans-serif;">Recommended Action</div>
            <div style="font-size:10px;color:#d0e5f9;margin-bottom:4px;font-family:Inter,sans-serif;">${n.recommendedAction}</div>
            <div style="font-size:9px;color:#8e9196;font-style:italic;font-family:Inter,sans-serif;">${n.reasoning}</div>
        </div>
    </div>

    <!-- ALERTS -->
    <div class="ie-sec">
        <div class="ie-lbl">
            🔔 Active Alerts
            <span id="ie-alert-badge" style="background:${criticalCount > 0 ? IE_COLORS.critical : IE_COLORS.warning};
                color:white;font-size:8px;font-weight:800;padding:1px 6px;border-radius:10px;
                display:${activeAlerts.length > 0 ? "inline-flex" : "none"};font-family:Inter,sans-serif;">
                ${activeAlerts.length}
            </span>
        </div>
        <div id="ie-alert-feed">
            ${activeAlerts.length === 0
                ? `<div style="font-size:10px;color:#8e9196;padding:8px 0;font-family:Inter,sans-serif;">No active alerts</div>`
                : activeAlerts.map(a => buildAlertHTML(a)).join("")}
        </div>
    </div>

    <!-- DECISIONS -->
    <div class="ie-sec">
        <div class="ie-lbl">⚙️ Ops Decision Engine</div>
        ${buildDecisionButtons(s, m, alerts)}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ATTACH HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
function attachActionHandlers(s, m, alerts) {
    alerts.filter(a => !a.dismissed).forEach(a => {
        document.getElementById(`dismiss-${a.id}`)
            ?.addEventListener("click", () => dismissAlert(a.id));
    });

    const handlers = {
        reroute:   () => openRerouteModal(s, m),
        captain:   () => openCaptainModal(s, m),
        escalate:  () => openEscalateModal(s, m, alerts),
        flag:      () => openFlagCargoModal(s, m),
        eta:       () => openReviseETAModal(s, m),
        terminate: () => openTerminateModal(s, m),
    };

    document.querySelectorAll("[data-ie-action]").forEach(btn => {
        btn.addEventListener("click", () => handlers[btn.getAttribute("data-ie-action")]?.());
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ALERT HTML
// ─────────────────────────────────────────────────────────────────────────────
function buildAlertHTML(a) {
    const icons = { CRITICAL:"🔴", WARNING:"🟠", INFO:"🔵" };
    const ts    = new Date(a.timestamp).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
    return `
        <div class="ie-alert ${a.severity}" id="alert-${a.id}">
            <span style="font-size:11px;margin-top:1px;">${icons[a.severity] || "⚪"}</span>
            <div style="flex:1;">
                <div class="ie-atitle">${a.title}</div>
                <div class="ie-abody">${a.body}</div>
                <div style="font-size:8px;color:#44474c;margin-top:3px;">${ts}</div>
            </div>
            <button class="ie-dismiss" id="dismiss-${a.id}">✕</button>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. DECISION BUTTONS
// ─────────────────────────────────────────────────────────────────────────────
function buildDecisionButtons(s, m, alerts) {
    const hasCritical = alerts.some(a => a.severity === "CRITICAL" && !a.dismissed);
    const hasWarning  = alerts.some(a => !a.dismissed && (a.severity === "WARNING" || a.severity === "CRITICAL"));
    const hasDelay    = m.etaDeltaHours !== null && m.etaDeltaHours > 0;

    const actions = [
        { key:"reroute",   emoji:"🔁", label:"Reroute Vessel",            color:IE_COLORS.critical, enabled: m.stormFlag || m.riskScore > 50,           reason:"Active when storm or risk > 50" },
        { key:"captain",   emoji:"📞", label:"Contact Captain",            color:IE_COLORS.warning,  enabled: hasWarning || m.isStationary,               reason:"Active when WARNING alert exists" },
        { key:"escalate",  emoji:"📢", label:"Escalate to Port Authority", color:"#a78bfa",          enabled: hasCritical,                                reason:"Active when CRITICAL alert exists" },
        { key:"flag",      emoji:"📦", label:"Flag Cargo At Risk",         color:IE_COLORS.warning,  enabled: m.stormFlag && hasDelay,                    reason:"Active when storm + delay detected" },
        { key:"eta",       emoji:"⏱",  label:"Revise ETA",                color:IE_COLORS.info,     enabled: hasDelay || m.progressGap > 5 || m.isStationary, reason:"Active when delay detected" },
        { key:"terminate", emoji:"🛑", label:"Terminate Shipment",         color:"#dc2626",          enabled: m.isStationary && m.elapsedHours > 10,      reason:"Active when stationary > 10h" },
    ];

    return actions.map(a => `
        <button class="ie-btn" data-ie-action="${a.key}" ${a.enabled ? "" : "disabled"}
            style="border-color:${a.color}${a.enabled ? "55" : "22"};
                   color:${a.enabled ? a.color : "#44474c"};
                   background:${a.color}${a.enabled ? "11" : "06"};">
            <span style="font-size:13px;">${a.emoji}</span>
            <span>${a.label}</span>
            ${!a.enabled ? `<span style="margin-left:auto;font-size:8px;color:#44474c;font-weight:400;text-transform:none;letter-spacing:0;">${a.reason}</span>` : ""}
        </button>`).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. RISK GAUGE SVG
// ─────────────────────────────────────────────────────────────────────────────
function buildRiskGaugeSVG(score, tier) {
    const s     = Math.max(0, Math.min(score, 100));
    const color = { CRITICAL:"#f87171", HIGH:"#fb923c", MEDIUM:"#fbbf24", LOW:"#4ADE80" }[tier] || "#94a3b8";
    const r     = 28, circ = Math.PI * r;
    return `
        <svg width="76" height="48" viewBox="0 0 76 48" style="flex-shrink:0;">
            <path d="M 10 38 A 28 28 0 0 1 66 38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5" stroke-linecap="round"/>
            <path d="M 10 38 A 28 28 0 0 1 66 38" fill="none" stroke="${color}" stroke-width="5"
                stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - s / 100)}"/>
            <text x="38" y="35" text-anchor="middle" font-size="13" font-weight="800"
                fill="${color}" font-family="Manrope,sans-serif">${s}</text>
            <text x="38" y="45" text-anchor="middle" font-size="6.5" fill="#8e9196"
                font-family="Inter,sans-serif" letter-spacing="0.05em">${tier}</text>
        </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. MODALS
// ─────────────────────────────────────────────────────────────────────────────
function openModal(html) {
    document.querySelector(".ie-modal-backdrop")?.remove();
    const b = document.createElement("div");
    b.className = "ie-modal-backdrop";
    b.innerHTML = `<div class="ie-modal">${html}</div>`;
    b.addEventListener("click", e => { if (e.target === b) b.remove(); });
    document.body.appendChild(b);
    b.querySelector(".ie-mclose")?.addEventListener("click", () => b.remove());
    return b;
}

function openRerouteModal(s, m) {
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>🔁 Reroute Vessel</h3>
        <p style="font-size:12px;color:#8e9196;margin-bottom:12px;">
            Route: <strong style="color:#d0e5f9;">${s.cargo?.origin} → ${s.cargo?.destination}</strong><br>
            Risk: <strong style="color:#f87171;">${m.riskScore}/100</strong> &nbsp;|&nbsp;
            Storm: <strong style="color:${m.stormFlag ? "#f87171" : "#4ADE80"};">${m.stormFlag ? "ACTIVE" : "CLEAR"}</strong>
        </p>
        <div style="background:rgba(251,107,0,0.07);border:1px solid rgba(251,107,0,0.2);border-radius:8px;padding:12px;margin-bottom:12px;">
            <div style="font-size:10px;font-weight:700;color:#fb6b00;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Suggested Alternate Waypoints</div>
            <div style="font-size:11px;color:#d0e5f9;line-height:1.9;">
                ${m.stormFlag
                    ? "1. Divert 40km south of current heading<br>2. Bypass storm zone via coastal corridor<br>3. Re-enter planned route at next checkpoint"
                    : "1. Maintain current heading<br>2. Increase speed to 14 kn to recover schedule<br>3. Request priority docking clearance"}
            </div>
        </div>
        <label style="font-size:10px;color:#8e9196;text-transform:uppercase;letter-spacing:0.08em;">Ops Notes</label>
        <textarea rows="3" placeholder="Add reroute justification..."></textarea>
        <button class="ie-msub" style="background:#fb6b00;"
            onclick="this.textContent='✓ Reroute Order Filed';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">
            File Reroute Order
        </button>`);
}

function openCaptainModal(s, m) {
    const msg = `Captain,\n\nOps alert — Vessel: ${s.vessel?.name} | #${s._id?.toString().slice(-8).toUpperCase()}\n\nStatus:\n- Progress: ${m.actualPct}% (expected ${m.expectedPct.toFixed(0)}%)\n- Avg speed: ${m.isStationary ? "STATIONARY — No GPS movement" : m.avgSpeedKnots.toFixed(1) + " kn"}\n- ML Risk score: ${m.riskScore}/100 (${m.riskTier})\n${m.stormFlag ? "- ⚠ Storm conditions active\n" : ""}${m.isStationary ? "- ⚠ GPS showing no movement — please confirm vessel status and device\n" : ""}\nPlease confirm current situation and provide ETA update.\n\nNAUTICAL.OS Operations`;
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>📞 Contact Captain</h3>
        <p style="font-size:12px;color:#8e9196;margin-bottom:8px;">Auto-filled from current shipment state:</p>
        <textarea rows="11">${msg}</textarea>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="ie-msub" style="background:#fb6b00;"
                onclick="navigator.clipboard?.writeText(this.closest('.ie-modal').querySelector('textarea').value);this.textContent='✓ Copied!'">Copy</button>
            <button class="ie-msub" style="background:#1d4ed8;"
                onclick="this.textContent='✓ Sent via GMDSS';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">Send via GMDSS</button>
        </div>`);
}

function openEscalateModal(s, m, alerts) {
    const crits = (alerts || loadAlerts()).filter(a => !a.dismissed && a.severity === "CRITICAL");
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>📢 Escalate to Port Authority</h3>
        <div style="background:rgba(248,113,113,0.07);border:1px solid rgba(248,113,113,0.2);border-radius:8px;padding:10px;margin-bottom:12px;">
            <div style="font-size:10px;font-weight:700;color:#f87171;margin-bottom:6px;">CRITICAL INCIDENTS (${crits.length})</div>
            ${crits.map(a => `<div style="font-size:10px;color:#d0e5f9;margin-bottom:3px;">• ${a.title}</div>`).join("") || '<div style="font-size:10px;color:#8e9196;">None</div>'}
        </div>
        <label style="font-size:10px;color:#8e9196;text-transform:uppercase;letter-spacing:0.08em;">Incident Report</label>
        <textarea rows="5" style="margin-top:6px;">Vessel: ${s.vessel?.name}
Route: ${s.cargo?.origin} → ${s.cargo?.destination}
Incidents: ${crits.map(a => a.title).join("; ") || "None"}
ML Risk Score: ${m.riskScore}/100
Requesting port authority assessment and coordination.</textarea>
        <button class="ie-msub" style="background:#7c3aed;"
            onclick="this.textContent='✓ Escalation Filed';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">
            Submit Escalation Report
        </button>`);
}

function openFlagCargoModal(s, m) {
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>📦 Flag Cargo At Risk</h3>
        <div style="background:rgba(251,146,60,0.07);border:1px solid rgba(251,146,60,0.2);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;color:#d0e5f9;line-height:1.8;">
            <strong style="color:#fb923c;">Risk Factors:</strong><br>
            ${m.stormFlag ? "• Active storm at vessel position<br>" : ""}
            ${m.etaDeltaHours > 0 ? `• Delay: +${m.etaDeltaHours.toFixed(0)}h<br>` : ""}
            • ${s.vessel?.container_count} TEU containers affected<br>
            • ML Risk score: ${m.riskScore}/100
        </div>
        <label style="font-size:10px;color:#8e9196;text-transform:uppercase;letter-spacing:0.08em;">Risk Notes</label>
        <textarea rows="3" placeholder="Cargo sensitivity, handling requirements..."></textarea>
        <button class="ie-msub" style="background:#d97706;"
            onclick="this.textContent='✓ Cargo Flagged';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">
            Confirm Flag
        </button>`);
}

function openReviseETAModal(s, m) {
    const schedStr   = m.scheduledETA.toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const revisedStr = m.revisedETA ? m.revisedETA.toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : m.isStationary ? "Indeterminate" : "Insufficient data";
    const deltaStr   = m.etaDeltaHours !== null ? `${m.etaDeltaHours > 0 ? "+" : ""}${m.etaDeltaHours.toFixed(0)}h ${m.etaDeltaHours > 0 ? "DELAY" : "AHEAD"}` : m.isStationary ? "Unknown" : "—";
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>⏱ Revise ETA</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;">
                <div style="font-size:9px;color:#8e9196;text-transform:uppercase;margin-bottom:4px;">Scheduled ETA</div>
                <div style="font-size:12px;font-weight:700;color:#d0e5f9;">${schedStr}</div>
            </div>
            <div style="background:rgba(248,113,113,0.07);border:1px solid rgba(248,113,113,0.2);border-radius:8px;padding:10px;">
                <div style="font-size:9px;color:#8e9196;text-transform:uppercase;margin-bottom:4px;">Revised ETA</div>
                <div style="font-size:11px;font-weight:700;color:#f87171;">${revisedStr}</div>
            </div>
        </div>
        <div style="text-align:center;font-size:20px;font-weight:800;font-family:Manrope,sans-serif;color:${m.etaDeltaHours > 0 ? "#f87171" : "#4ADE80"};margin-bottom:12px;">${deltaStr}</div>
        <div style="font-size:10px;color:#8e9196;margin-bottom:10px;">
            ${m.isStationary ? "Cannot project ETA — vessel is stationary. Resume movement to enable calculation." : `Based on avg speed ${m.avgSpeedKnots.toFixed(1)} kn over ${m.totalDistanceKm.toFixed(0)} km traveled.`}
        </div>
        <label style="font-size:10px;color:#8e9196;text-transform:uppercase;letter-spacing:0.08em;">Notify Stakeholders</label>
        <input type="text" placeholder="Email addresses (comma separated)..." style="margin-top:6px;">
        <button class="ie-msub" style="background:#fb6b00;"
            onclick="this.textContent='✓ ETA Revision Sent';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">
            Confirm & Notify
        </button>`);
}

function openTerminateModal(s, m) {
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3 style="color:#f87171;">🛑 Terminate Shipment</h3>
        <div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:12px;margin-bottom:14px;">
            <div style="font-size:11px;color:#f87171;font-weight:700;margin-bottom:6px;">⚠ This action cannot be undone</div>
            <div style="font-size:11px;color:#d0e5f9;line-height:1.8;">
                Vessel: <strong>${s.vessel?.name}</strong><br>
                Route: ${s.cargo?.origin} → ${s.cargo?.destination}<br>
                Stationary for: ~${Math.round(m.elapsedHours)}h<br>
                ${s.vessel?.container_count} TEU containers affected
            </div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;color:#d0e5f9;line-height:1.7;">
            <strong style="color:#fb923c;">Consider alternatives:</strong><br>
            • Wait — vessel may resume movement<br>
            • Reroute — redirect to nearest port<br>
            • Reschedule — defer to next slot
        </div>
        <label style="font-size:10px;color:#8e9196;text-transform:uppercase;letter-spacing:0.08em;">Termination Reason (required)</label>
        <textarea rows="3" placeholder="State reason for audit trail..."></textarea>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="ie-msub" style="background:#374151;flex:1;"
                onclick="document.querySelector('.ie-modal-backdrop')?.remove()">Cancel</button>
            <button class="ie-msub" style="background:#dc2626;flex:1;"
                onclick="this.textContent='✓ Termination Filed';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),2000)">
                Confirm Terminate
            </button>
        </div>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const IE_KNOWN_PORTS = {
    "mumbai":{ lat:18.9322,lng:72.8375 }, "jnpt":{ lat:18.9480,lng:72.9500 },
    "nhava sheva":{ lat:18.9480,lng:72.9500 }, "kochi":{ lat:9.9312,lng:76.2673 },
    "cochin":{ lat:9.9312,lng:76.2673 }, "goa":{ lat:15.4909,lng:73.8278 },
    "mangalore":{ lat:12.8703,lng:74.8423 }, "chennai":{ lat:13.0827,lng:80.2707 },
    "vizag":{ lat:17.6868,lng:83.2185 }, "visakhapatnam":{ lat:17.6868,lng:83.2185 },
    "kolkata":{ lat:22.5726,lng:88.3639 }, "haldia":{ lat:22.0667,lng:88.0833 },
    "kandla":{ lat:23.0333,lng:70.2167 }, "mundra":{ lat:22.8390,lng:69.7183 },
    "tuticorin":{ lat:8.7642,lng:78.1348 }, "thoothukudi":{ lat:8.7642,lng:78.1348 },
    "kozhikode":{ lat:11.2588,lng:75.7804 }, "calicut":{ lat:11.2588,lng:75.7804 },
    "pipavav":{ lat:20.9167,lng:71.5167 }, "hazira":{ lat:21.1167,lng:72.6500 },
    "mormugao":{ lat:15.4139,lng:73.7993 },
};

function geocodePortIE(name) {
    if (!name) return null;
    const key = name.toLowerCase().split(",")[0].trim();
    for (const [port, coords] of Object.entries(IE_KNOWN_PORTS)) {
        if (key.includes(port) || port.includes(key)) return coords;
    }
    return null;
}

window.runIntelligenceEngine = runIntelligenceEngine; 