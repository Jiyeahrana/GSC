/**
 * NAUTICAL.OS — Intelligence Engine v4.1
 * intelligenceEngine.js
 *
 * FIXES:
 *   1. Stationary detection — uses schedule-based elapsed time, not GPS drift.
 *      A ship is "stationary" if no checkpoints reached AND scheduled departure
 *      was more than STATIONARY_THRESHOLD_DAYS ago.
 *   2. Risk score — stationary time overrides ML score: 60d stationary = 100/100.
 *   3. Auto-cancellation flag — fires when stationary > CANCEL_THRESHOLD_DAYS.
 *   4. Risk tier logic now accounts for stationary overrides.
 *   5. "Days overdue" computed from schedule.departure and shown prominently.
 */

const IE_COLORS = {
    critical : "#f87171",
    warning  : "#fb923c",
    info     : "#60a5fa",
    success  : "#4ADE80",
    neutral  : "#94a3b8",
    accent   : "#fb6b00",
};

const ML_SERVICE_URL    = "http://localhost:5001/predict";
const ALERT_STORAGE_KEY = (id) => `nautical_alerts_v4_${id}`;
const CP_STORAGE_KEY    = (id) => `nautical_checkpoints_${id}`;

// ── Stationary thresholds ─────────────────────────────────────────────────────
const STATIONARY_THRESHOLD_DAYS  = 3;   // flag as stationary if no progress for 3+ days
const CRITICAL_STATIONARY_DAYS   = 14;  // risk score forced to 90+ after 2 weeks
const CANCEL_THRESHOLD_DAYS      = 30;  // recommend cancellation after 1 month

let _currentShipmentId = null;
let _lastMLResult      = null;
let _routeLayers       = [];

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
async function runIntelligenceEngine(s) {
    _currentShipmentId = s._id?.toString() || "unknown";
    s = mergePersistedCheckpoints(s);
    renderLoadingState();

    const payload = buildMLPayload(s);

    let mlResult = null;
    try {
        const res = await fetch(ML_SERVICE_URL, {
            method  : "POST",
            headers : { "Content-Type": "application/json" },
            body    : JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`ML service HTTP ${res.status}`);
        mlResult = await res.json();
    } catch (err) {
        console.warn("[IE] Reasoning engine unreachable — using fallback", err.message);
        mlResult = ruleBasedFallback(s, payload);
    }

    _lastMLResult = mlResult;

    const metrics = computeLocalMetrics(s, mlResult);

    // ── Override ML risk score based on real-world stationary state ──────────
    mlResult = applyStationaryOverride(mlResult, metrics);

    const alerts  = runAlertEngine(s, metrics, mlResult);

    renderIntelligencePanel(s, metrics, alerts, mlResult);
    attachActionHandlers(s, metrics, alerts, mlResult);
    renderMLRouteMap(mlResult, s);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIONARY OVERRIDE
// If the ship has been stationary beyond thresholds, override ML risk score
// and recommendation. The ML engine can't know about elapsed real time.
// ─────────────────────────────────────────────────────────────────────────────
function applyStationaryOverride(ml, m) {
    if (!m.isStationary) return ml;

    const daysStat = m.stationaryDays;

    // Risk score: scales from current ML score → 100 over CANCEL_THRESHOLD_DAYS
    let overrideRisk = ml.risk_score;
    if (daysStat >= CANCEL_THRESHOLD_DAYS) {
        overrideRisk = 100;
    } else if (daysStat >= CRITICAL_STATIONARY_DAYS) {
        // Interpolate from 90 to 99 between 14d and 30d
        overrideRisk = Math.round(90 + ((daysStat - CRITICAL_STATIONARY_DAYS) /
            (CANCEL_THRESHOLD_DAYS - CRITICAL_STATIONARY_DAYS)) * 9);
    } else if (daysStat >= STATIONARY_THRESHOLD_DAYS) {
        // Interpolate from current score to 90 between 3d and 14d
        overrideRisk = Math.max(
            ml.risk_score,
            Math.round(ml.risk_score + ((daysStat - STATIONARY_THRESHOLD_DAYS) /
                (CRITICAL_STATIONARY_DAYS - STATIONARY_THRESHOLD_DAYS)) * (90 - ml.risk_score))
        );
    }

    overrideRisk = Math.min(100, overrideRisk);

    const overrideTier = overrideRisk >= 90 ? "CRITICAL"
                       : overrideRisk >= 76 ? "CRITICAL"
                       : overrideRisk >= 51 ? "HIGH"
                       : overrideRisk >= 26 ? "MEDIUM"
                       : "LOW";

    const daysStr = daysStat >= 1 ? `${Math.round(daysStat)} days` : `${Math.round(daysStat * 24)} hours`;

    return {
        ...ml,
        risk_score             : overrideRisk,
        risk_tier              : overrideTier,
        recommendation_action  : daysStat >= CANCEL_THRESHOLD_DAYS
            ? "CANCEL"
            : daysStat >= CRITICAL_STATIONARY_DAYS
                ? "ESCALATE"
                : ml.recommendation_action,
        situation              : daysStat >= CANCEL_THRESHOLD_DAYS
            ? `⚠ CANCELLATION RECOMMENDED — Vessel has been stationary for ${daysStr} with zero checkpoint progress. ` +
              `Risk score: ${overrideRisk}/100 CRITICAL. Shipment is ${Math.round(m.daysOverdue)} days overdue.`
            : daysStat >= CRITICAL_STATIONARY_DAYS
                ? `⚠ CRITICAL — Vessel stationary for ${daysStr}. No GPS movement detected, 0/${m.totalCPs} checkpoints reached. ` +
                  `Overdue by ${Math.round(m.daysOverdue)} days. Escalation required.`
                : `Vessel has not moved for ${daysStr}. ${ml.situation}`,
        recommended_action     : daysStat >= CANCEL_THRESHOLD_DAYS
            ? "Initiate shipment termination. Notify all stakeholders. File port authority incident report. Cargo handling assessment required."
            : daysStat >= CRITICAL_STATIONARY_DAYS
                ? "Escalate to port authority immediately. Contact captain. Consider re-routing or termination."
                : ml.recommended_action,
        _stationary_override   : true,
        _stationary_days       : daysStat,
        _should_cancel         : daysStat >= CANCEL_THRESHOLD_DAYS,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL METRICS — now includes proper stationary detection and overdue tracking
// ─────────────────────────────────────────────────────────────────────────────
function computeLocalMetrics(s, ml) {
    const snaps    = s.weather_snapshots || [];
    const cps      = s.checkpoints || [];
    const schedule = s.schedule || {};

    // ── Distance traveled (GPS snapshots) ────────────────────────────────────
    let totalKm = 0;
    for (let i = 1; i < snaps.length; i++) {
        totalKm += haversineKm(snaps[i-1].lat, snaps[i-1].lng, snaps[i].lat, snaps[i].lng);
    }

    // ── Stationary detection — DO NOT rely on GPS coordinates alone ───────────
    // Phone GPS drifts ±50-200m, so coordinate equality is unreliable.
    // Instead: if no checkpoints reached AND days since scheduled departure
    // exceeds threshold → ship is stationary/stuck.
    const schedDeparture = schedule.arrival
        ? new Date(schedule.arrival)
        : schedule.departure ? new Date(schedule.departure) : null;
    const schedArrival   = schedule.departure
        ? new Date(schedule.departure)
        : schedule.arrival ? new Date(schedule.arrival) : null;

    const now = Date.now();

    // Days since the vessel was SUPPOSED to depart
    const daysSinceDeparture = schedDeparture
        ? (now - schedDeparture.getTime()) / 86_400_000
        : 0;

    // Days the vessel is overdue (past expected arrival)
    const daysOverdue = schedArrival
        ? Math.max(0, (now - schedArrival.getTime()) / 86_400_000)
        : 0;

    // Total journey duration (scheduled)
    const totalScheduledDays = schedDeparture && schedArrival
        ? Math.max((schedArrival - schedDeparture) / 86_400_000, 1)
        : 1;

    const reachedCPs = cps.filter(c => c.status === "reached").length;
    const missedCPs  = cps.filter(c => c.status === "missed").length;
    const pendingCPs = cps.filter(c => c.status === "pending").length;
    const totalCPs   = cps.length;

    // A ship is stationary if:
    // - No checkpoints reached (0 progress)
    // - It's been more than STATIONARY_THRESHOLD_DAYS since departure
    // GPS distance < 5km is secondary confirmation (accounts for drift)
    const gpsStationary    = totalKm < 5 && snaps.length > 1;
    const schedStationary  = reachedCPs === 0 && daysSinceDeparture > STATIONARY_THRESHOLD_DAYS;
    const isStationary     = schedStationary || (gpsStationary && daysSinceDeparture > 1);

    // How long has the ship been stationary?
    // Best estimate: time since departure (since we have no real movement data)
    const stationaryDays   = isStationary ? daysSinceDeparture : 0;

    // Progress percentages
    const actualPct   = totalCPs > 0 ? Math.round((reachedCPs / totalCPs) * 100) : 0;
    const expectedPct = Math.min(Math.round((daysSinceDeparture / totalScheduledDays) * 100), 100);
    const progressGap = expectedPct - actualPct;

    // Speed (meaningful only if not stationary)
    const elapsedHours  = Math.max(daysSinceDeparture * 24, 1);
    const avgSpeedKmh   = (!isStationary && totalKm > 0) ? totalKm / elapsedHours : 0;
    const avgSpeedKnots = avgSpeedKmh * 0.539957;

    let instSpeedKnots = 0;
    if (!isStationary && snaps.length >= 2) {
        const segH   = elapsedHours / Math.max(snaps.length - 1, 1);
        const lastKm = haversineKm(
            snaps.at(-2).lat, snaps.at(-2).lng,
            snaps.at(-1).lat, snaps.at(-1).lng
        );
        instSpeedKnots = (lastKm / segH) * 0.539957;
    }

    return {
        avgSpeedKnots,
        instSpeedKnots,
        totalDistanceKm   : totalKm,
        expectedPct,
        actualPct,
        progressGap,
        totalCPs,
        missedCPs,
        reachedCPs,
        pendingCPs,
        stormFlag         : ml.storm_flag,
        riskScore         : ml.risk_score,
        riskTier          : ml.risk_tier,
        isStationary,
        stationaryDays,
        elapsedHours,
        daysOverdue,
        daysSinceDeparture,
        totalScheduledDays,
        scheduledETA      : schedArrival || new Date(),
        etaDeltaHours     : ml.predicted_delay_hours > 0 ? ml.predicted_delay_hours : null,
        shouldCancel      : stationaryDays >= CANCEL_THRESHOLD_DAYS,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD ML PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────
function buildMLPayload(s) {
    const weather  = s.latest_weather || {};
    const schedule = s.schedule       || {};
    const cargo    = s.cargo          || {};
    const vessel   = s.vessel         || {};

    const originKey  = geocodeToPortKey(cargo.origin);
    const destKey    = geocodeToPortKey(cargo.destination);
    const vesselType = mapVesselType(vessel.type || vessel.vessel_type || "Container Ship");
    const cargoType  = mapCargoType(cargo.type   || cargo.cargo_type   || "Containers");

    const hoursUntilStorm  = parseFloat(weather.hours_until_storm  || weather.storm_eta_hours  || 999);
    const stormDuration    = parseFloat(weather.storm_duration_hours || weather.cyclone_duration ||
        (weather.storm_flag ? 6 : 0));

    return {
        origin_port            : originKey  || "JNPT",
        destination_port       : destKey    || "CHENNAI",
        vessel_type            : vesselType,
        cargo_type             : cargoType,
        wave_height            : parseFloat(weather.wave_height || weather.waves || 2.0),
        wind_speed             : parseFloat(weather.wind_speed  || weather.wind  || 15),
        cyclone_probability    : weather.storm_flag
                                    ? Math.max(0.75, parseFloat(weather.cyclone_probability || 0.75))
                                    : parseFloat(weather.cyclone_probability || 0.1),
        origin_congestion      : parseFloat(weather.origin_congestion      || 50),
        destination_congestion : parseFloat(weather.destination_congestion  || 55),
        fuel_cost              : parseFloat(weather.fuel_cost || 88),
        carrier_reliability    : parseFloat(vessel.reliability || 0.8),
        hours_until_storm      : hoursUntilStorm,
        storm_duration_hours   : stormDuration,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PORT / VESSEL / CARGO MAPPING
// ─────────────────────────────────────────────────────────────────────────────
const PORT_ALIASES = {
    "mumbai":        "JNPT", "jnpt":          "JNPT", "nhava sheva": "JNPT",
    "mundra":        "MUNDRA",
    "kandla":        "KANDLA",
    "mormugao":      "MORMUGAO", "goa":        "MORMUGAO",
    "kochi":         "KOCHI",    "cochin":     "KOCHI",
    "chennai":       "CHENNAI",  "madras":     "CHENNAI",
    "vizag":         "VIZAG",    "visakhapatnam": "VIZAG",
    "paradip":       "PARADIP",
    "kolkata":       "KOLKATA",  "calcutta":   "KOLKATA", "haldia": "KOLKATA",
    "ennore":        "ENNORE",   "kamarajar":  "ENNORE",
};

const VESSEL_ALIASES = {
    "container":     "Container Ship", "container ship": "Container Ship",
    "bulk":          "Bulk Carrier",   "bulk carrier":   "Bulk Carrier",
    "tanker":        "Tanker",         "vlcc":           "Tanker",
    "ro-ro":         "RoRo Vessel",    "roro":           "RoRo Vessel",
    "general":       "General Cargo",  "general cargo":  "General Cargo",
};

const CARGO_ALIASES = {
    "container":     "Containers",  "containers":   "Containers",
    "crude":         "Crude Oil",   "crude oil":    "Crude Oil", "oil": "Crude Oil",
    "coal":          "Coal",
    "iron":          "Iron Ore",    "iron ore":     "Iron Ore",
    "electronics":   "Electronics",
    "auto":          "Automobiles", "automobiles":  "Automobiles", "cars": "Automobiles",
    "fertilizer":    "Fertilizers", "fertilizers":  "Fertilizers",
    "food":          "Food Grains", "grain":        "Food Grains", "food grains": "Food Grains",
    "textile":       "Textiles",    "textiles":     "Textiles",
    "chemical":      "Chemicals",   "chemicals":    "Chemicals",
};

function geocodeToPortKey(name) {
    if (!name) return null;
    const k = name.toLowerCase().split(",")[0].trim();
    for (const [alias, key] of Object.entries(PORT_ALIASES)) {
        if (k.includes(alias) || alias.includes(k)) return key;
    }
    return null;
}
function mapVesselType(v) {
    const k = (v || "").toLowerCase();
    for (const [alias, type] of Object.entries(VESSEL_ALIASES)) {
        if (k.includes(alias)) return type;
    }
    return "Container Ship";
}
function mapCargoType(c) {
    const k = (c || "").toLowerCase();
    for (const [alias, type] of Object.entries(CARGO_ALIASES)) {
        if (k.includes(alias)) return type;
    }
    return "Containers";
}

// ─────────────────────────────────────────────────────────────────────────────
// RULE-BASED FALLBACK
// ─────────────────────────────────────────────────────────────────────────────
function ruleBasedFallback(s, payload) {
    const c    = payload.cyclone_probability;
    const w    = payload.wave_height;
    const cong = payload.destination_congestion;
    const rel  = payload.carrier_reliability;
    const hStorm = payload.hours_until_storm || 999;
    const dur    = payload.storm_duration_hours || 0;

    const CARGO_RISK = {
        "Containers":1.0,"Crude Oil":1.3,"Coal":0.7,"Iron Ore":0.75,
        "Electronics":1.4,"Automobiles":1.2,"Fertilizers":1.0,
        "Food Grains":1.1,"Textiles":0.85,"Chemicals":1.35
    };
    const crisk = CARGO_RISK[payload.cargo_type] || 1.0;

    const estVoyageH = 20;
    const stormContrib = (hStorm < estVoyageH && dur > 0)
        ? c * Math.min(dur, estVoyageH - hStorm) * 1.2
        : c * 3;
    const congContrib = cong > 70 ? (cong - 70) * 0.2 + 2 : cong > 50 ? (cong - 50) * 0.1 : 0.3;

    const delay = Math.max(0, (stormContrib + w * 0.4 + congContrib + (1 - rel) * 2) * crisk);
    const risk  = Math.min(100, Math.round(delay * 1.5 + c * 20 + cong * 0.15));
    const tier  = risk >= 76 ? "CRITICAL" : risk >= 51 ? "HIGH" : risk >= 26 ? "MEDIUM" : "LOW";

    return {
        success: true,
        predicted_delay_hours : Math.round(delay * 10) / 10,
        risk_score            : risk,
        risk_tier             : tier,
        best_route            : risk > 50 ? "B" : "A",
        recommendation_action : risk > 75 ? "REROUTE" : risk > 50 ? "MONITOR" : "ON TRACK",
        storm_flag            : c > 0.5 || w > 5 || (hStorm < estVoyageH && dur > 0),
        situation             : `Rule-based fallback (reasoning engine offline). Risk ${risk}/100.`,
        recommended_action    : "Check reasoning engine connection.",
        reasoning             : "Service unreachable — using simplified fallback.",
        time_saved_hours      : 0,
        routes                : {},
        delay_breakdown       : {},
        reasoning_chain       : ["Reasoning engine offline — fallback active."],
        origin_coords         : null,
        dest_coords           : null,
        model                 : { framework: "Rule-based fallback" },
        _fallback             : true,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKPOINT PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────
function mergePersistedCheckpoints(s) {
    if (!s.checkpoints?.length) return s;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CP_STORAGE_KEY(_currentShipmentId)) || "{}"); } catch (_) {}
    const merged = s.checkpoints.map(cp => {
        const key = cp._id?.toString() || cp.name;
        if (cp.status === "reached") saved[key] = { status:"reached", actual_arrival: cp.actual_arrival || new Date().toISOString() };
        if (saved[key]?.status === "reached") return { ...cp, status:"reached", actual_arrival: cp.actual_arrival || saved[key].actual_arrival };
        return cp;
    });
    try { localStorage.setItem(CP_STORAGE_KEY(_currentShipmentId), JSON.stringify(saved)); } catch (_) {}
    return { ...s, checkpoints: merged };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT ENGINE — now includes stationary-specific alerts
// ─────────────────────────────────────────────────────────────────────────────
function runAlertEngine(s, m, ml) {
    const stored   = loadAlerts();
    const existing = new Map(stored.map(a => [a.id, a]));
    const now      = new Date().toISOString();
    const reroute  = ml.recommendation_action;

    const daysStr  = m.stationaryDays >= 1
        ? `${Math.round(m.stationaryDays)} days`
        : `${Math.round(m.stationaryDays * 24)} hours`;
    const overdueStr = `${Math.round(m.daysOverdue)} days overdue`;

    const rules = [
        // Cancellation — highest priority
        { id:"CANCEL_RECOMMENDED",
          condition: ml._should_cancel || reroute === "CANCEL",
          severity:"CRITICAL",
          title:"⛔ Shipment Cancellation Recommended",
          body:`Vessel stationary for ${daysStr} with 0/${m.totalCPs} checkpoints reached. ${overdueStr}. Initiate termination process.` },

        // Escalation — stationary beyond critical threshold
        { id:"ESCALATE_STATIONARY",
          condition: m.stationaryDays >= CRITICAL_STATIONARY_DAYS && !ml._should_cancel,
          severity:"CRITICAL",
          title:`🚨 Vessel Stationary ${daysStr} — Escalate Now`,
          body:`No movement since scheduled departure. ${overdueStr}. Risk score: ${ml.risk_score}/100. Port authority escalation required.` },

        // Early stationary warning
        { id:"STATIONARY_WARN",
          condition: m.isStationary && m.stationaryDays < CRITICAL_STATIONARY_DAYS && m.stationaryDays >= STATIONARY_THRESHOLD_DAYS,
          severity:"WARNING",
          title:`⚠ Vessel Stationary — ${daysStr}`,
          body:`No checkpoint progress since scheduled departure. Contact captain and verify vessel status.` },

        // ML-driven reroute
        { id:"ML_REROUTE",
          condition: reroute === "REROUTE",
          severity:"CRITICAL",
          title:"Reasoning Engine Recommends Reroute",
          body:`Route ${ml.best_route} preferred. Predicted delay: +${ml.predicted_delay_hours}h. Confidence: ${ml.route_confidence_pct || "—"}%.` },

        { id:"ML_SHIFT_PORT",
          condition: reroute === "SHIFT PORT",
          severity:"CRITICAL",
          title:"Reasoning Engine Recommends Port Shift",
          body:`Shift destination to ${ml.alternate_port_name || "alternate port"}. Time saved: ${ml.time_saved_hours}h.` },

        { id:"STORM_ACTIVE",
          condition: m.stormFlag,
          severity:"CRITICAL",
          title:"Storm Detected on Route",
          body:"Storm conditions active on transit path. Reroute assessment required." },

        { id:"RISK_CRITICAL",
          condition: ml.risk_score >= 76 && !m.isStationary,
          severity:"CRITICAL",
          title:`Critical Risk Score: ${ml.risk_score}/100`,
          body:`Risk engine: ${ml.risk_score}/100 CRITICAL. Predicted delay +${ml.predicted_delay_hours}h.` },

        { id:"RISK_HIGH",
          condition: ml.risk_score >= 51 && ml.risk_score < 76 && !m.isStationary,
          severity:"WARNING",
          title:`Elevated Risk: ${ml.risk_score}/100`,
          body:`Route ${ml.best_route} recommended. Monitor closely.` },

        { id:"MISSED_CP",
          condition: m.missedCPs > 0,
          severity:"WARNING",
          title:`${m.missedCPs} Checkpoint${m.missedCPs > 1 ? "s" : ""} Missed`,
          body:`Vessel missed ${m.missedCPs} of ${m.totalCPs} planned checkpoints.` },

        { id:"ON_TRACK",
          condition: ml.risk_score < 26 && !m.stormFlag && m.missedCPs === 0 && !m.isStationary && reroute === "ON TRACK",
          severity:"INFO",
          title:"Shipment Progressing Normally",
          body:`Risk ${ml.risk_score}/100 — LOW. No action required.` },
    ];

    const newAlerts = [];
    rules.forEach(r => {
        if (!r.condition) return;
        if (existing.has(r.id) && existing.get(r.id).dismissed) { newAlerts.push(existing.get(r.id)); return; }
        if (existing.has(r.id)) { newAlerts.push({ ...existing.get(r.id), body: r.body, title: r.title }); return; }
        newAlerts.push({ id:r.id, severity:r.severity, title:r.title, body:r.body, timestamp:now, dismissed:false });
    });
    saveAlerts(newAlerts);
    return newAlerts;
}

function loadAlerts()  { try { return JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY(_currentShipmentId)) || "[]"); } catch { return []; } }
function saveAlerts(a) { localStorage.setItem(ALERT_STORAGE_KEY(_currentShipmentId), JSON.stringify(a)); }
function dismissAlert(id) {
    const alerts = loadAlerts().map(a => a.id === id ? { ...a, dismissed:true } : a);
    saveAlerts(alerts);
    document.getElementById(`alert-${a.id}`)?.remove();
    const rem   = alerts.filter(a => !a.dismissed).length;
    const badge = document.getElementById("ie-alert-badge");
    if (badge) { badge.textContent = rem; badge.style.display = rem > 0 ? "inline-flex" : "none"; }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING SKELETON
// ─────────────────────────────────────────────────────────────────────────────
function renderLoadingState() {
    const panel = document.getElementById("intelligence-panel");
    if (!panel) return;
    panel.innerHTML = `
    <style>
        @keyframes ie-shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
        .ie-skel { background:linear-gradient(90deg,rgba(255,255,255,0.03) 0%,rgba(255,255,255,0.07) 50%,rgba(255,255,255,0.03) 100%);
            background-size:400px 100%; animation:ie-shimmer 1.4s infinite; border-radius:4px; }
    </style>
    <div style="font-size:9px;color:#60a5fa;font-family:Inter,sans-serif;margin-bottom:12px;display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#60a5fa;animation:ie-shimmer 1s infinite;"></span>
        Running reasoning engine…
    </div>
    ${[64,48,80,56,40].map(w => `<div class="ie-skel" style="height:10px;width:${w}%;margin-bottom:8px;"></div>`).join("")}
    `;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER INTELLIGENCE PANEL
// ─────────────────────────────────────────────────────────────────────────────
function renderIntelligencePanel(s, m, alerts, ml) {
    const panel = document.getElementById("intelligence-panel");
    if (!panel) return;
    const activeAlerts  = alerts.filter(a => !a.dismissed);
    const criticalCount = activeAlerts.filter(a => a.severity === "CRITICAL").length;

    const recColor = {
        "CANCEL"     : "#dc2626",
        "ESCALATE"   : "#f87171",
        "SHIFT PORT" : "#fb923c",
        "REROUTE"    : "#f87171",
        "ON TRACK"   : "#4ADE80",
        "MONITOR"    : "#60a5fa",
    }[ml.recommendation_action] || "#94a3b8";

    const breakdown = ml.delay_breakdown || {};
    const breakdownFactors = [
        { label:"Storm / Weather",        val: breakdown.storm_weather       || 0, color:"#f87171" },
        { label:"Destination Congestion", val: breakdown.destination_cong    || 0, color:"#fb923c" },
        { label:"Coast Crossing",         val: breakdown.coast_crossing      || 0, color:"#a78bfa" },
        { label:"Carrier Reliability",    val: breakdown.carrier_reliability || 0, color:"#fbbf24" },
        { label:"Origin Congestion",      val: breakdown.origin_congestion   || 0, color:"#60a5fa" },
    ].filter(f => f.val > 0);

    const maxBreakdown = Math.max(...breakdownFactors.map(f => f.val), 1);

    // ── Stationary summary card (shown only when stationary) ─────────────────
    const stationaryBanner = m.isStationary ? `
    <div style="margin-bottom:14px;padding:12px 14px;border-radius:8px;
        background:rgba(220,38,38,.10);border:1px solid rgba(220,38,38,.35);font-family:Inter,sans-serif;">
        <div style="font-size:11px;font-weight:700;color:#f87171;margin-bottom:6px;">
            ${ml._should_cancel ? "⛔ CANCELLATION RECOMMENDED" : "🚨 VESSEL STATIONARY — ACTION REQUIRED"}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
                <div style="font-size:8px;text-transform:uppercase;letter-spacing:.09em;color:#8e9196;margin-bottom:2px;">Stationary for</div>
                <div style="font-size:18px;font-weight:800;font-family:Manrope,sans-serif;color:#f87171;line-height:1;">
                    ${Math.round(m.stationaryDays)} <span style="font-size:10px;font-weight:400;color:#8e9196;">days</span>
                </div>
            </div>
            <div>
                <div style="font-size:8px;text-transform:uppercase;letter-spacing:.09em;color:#8e9196;margin-bottom:2px;">Overdue by</div>
                <div style="font-size:18px;font-weight:800;font-family:Manrope,sans-serif;color:#fb923c;line-height:1;">
                    ${Math.round(m.daysOverdue)} <span style="font-size:10px;font-weight:400;color:#8e9196;">days</span>
                </div>
            </div>
            <div>
                <div style="font-size:8px;text-transform:uppercase;letter-spacing:.09em;color:#8e9196;margin-bottom:2px;">Checkpoints reached</div>
                <div style="font-size:18px;font-weight:800;font-family:Manrope,sans-serif;color:#f87171;line-height:1;">
                    ${m.reachedCPs}<span style="font-size:10px;color:#8e9196;">/${m.totalCPs}</span>
                </div>
            </div>
            <div>
                <div style="font-size:8px;text-transform:uppercase;letter-spacing:.09em;color:#8e9196;margin-bottom:2px;">Risk score</div>
                <div style="font-size:18px;font-weight:800;font-family:Manrope,sans-serif;color:#f87171;line-height:1;">
                    ${ml.risk_score}<span style="font-size:10px;color:#8e9196;">/100</span>
                </div>
            </div>
        </div>
        <div style="margin-top:10px;font-size:9px;color:#d0e5f9;line-height:1.6;">
            ${ml.situation}
        </div>
    </div>` : "";

    panel.innerHTML = `
    <style>
        #intelligence-panel * { box-sizing:border-box; }
        .ie-sec  { margin-bottom:14px; }
        .ie-lbl  { font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#8e9196;
            font-family:Inter,sans-serif;margin-bottom:7px;display:flex;align-items:center;gap:6px; }
        .ie-sbox { flex:1;background:rgba(255,255,255,.03);border:1px solid rgba(186,200,220,.08);border-radius:6px;padding:8px; }
        .ie-sval { font-size:17px;font-weight:800;font-family:Manrope,sans-serif;color:#d0e5f9;line-height:1; }
        .ie-ssub { font-size:8px;color:#8e9196;text-transform:uppercase;letter-spacing:.06em;margin-top:3px; }
        .ie-ai   { background:rgba(96,165,250,.05);border:1px solid rgba(96,165,250,.18);border-radius:8px;padding:12px; }
        .ie-fbar { height:3px;border-radius:2px;margin-top:3px;background:rgba(255,255,255,.06);overflow:hidden; }
        .ie-ffill{ height:100%;border-radius:2px;transition:width .6s ease; }
        .ie-alert{ padding:9px 10px;border-radius:6px;margin-bottom:5px;display:flex;gap:8px;
            align-items:flex-start;border-left:2px solid;font-family:Inter,sans-serif; }
        .ie-alert.CRITICAL{background:rgba(248,113,113,.07);border-color:#f87171;}
        .ie-alert.WARNING {background:rgba(251,146,60,.07); border-color:#fb923c;}
        .ie-alert.INFO    {background:rgba(96,165,250,.07); border-color:#60a5fa;}
        .ie-atitle{font-size:10px;font-weight:700;color:#d0e5f9;}
        .ie-abody {font-size:9px;color:#8e9196;margin-top:2px;line-height:1.4;}
        .ie-dismiss{margin-left:auto;flex-shrink:0;cursor:pointer;color:#44474c;font-size:11px;
            padding:2px 4px;border-radius:3px;background:transparent;border:none;}
        .ie-dismiss:hover{color:#d0e5f9;background:rgba(255,255,255,.06);}
        .ie-btn{width:100%;padding:8px 10px;border-radius:6px;border:1px solid;font-size:9px;
            font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
            text-align:left;display:flex;align-items:center;gap:7px;font-family:Inter,sans-serif;
            transition:all .15s;margin-bottom:5px;background:none;}
        .ie-btn:disabled{opacity:.3;cursor:default;}
        .ie-btn:not(:disabled):hover{filter:brightness(1.2);transform:translateX(2px);}
        .ie-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;
            display:flex;align-items:center;justify-content:center;}
        .ie-modal{background:#0c2230;border:1px solid rgba(186,200,220,.15);border-radius:12px;
            padding:24px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;
            font-family:Inter,sans-serif;position:relative;}
        .ie-modal h3{font-family:Manrope,sans-serif;font-size:16px;font-weight:800;color:#d0e5f9;margin:0 0 12px;}
        .ie-mclose{position:absolute;top:14px;right:14px;background:none;border:none;
            color:#8e9196;cursor:pointer;font-size:18px;}
        .ie-modal textarea,.ie-modal input{width:100%;background:rgba(255,255,255,.04);
            border:1px solid rgba(186,200,220,.15);border-radius:6px;padding:8px 10px;
            color:#d0e5f9;font-size:12px;font-family:Inter,sans-serif;resize:vertical;margin-top:6px;outline:none;}
        .ie-msub{margin-top:12px;padding:8px 16px;border-radius:6px;border:none;color:white;
            font-weight:700;font-size:11px;cursor:pointer;letter-spacing:.05em;
            text-transform:uppercase;font-family:Inter,sans-serif;}
        .ie-route-card{border-radius:6px;border:1px solid rgba(186,200,220,.1);padding:9px 10px;
            margin-bottom:6px;cursor:pointer;transition:border-color .15s;position:relative;}
        .ie-route-card.best{border-color:rgba(96,165,250,.5);background:rgba(96,165,250,.04);}
        .ie-route-card:hover{border-color:rgba(186,200,220,.25);}
        .ie-rc-badge{font-size:8px;font-weight:700;padding:1px 6px;border-radius:8px;
            background:rgba(96,165,250,.15);color:#60a5fa;margin-left:5px;}
        .ie-chain-item{font-size:9px;color:#8e9196;line-height:1.5;padding:4px 0;
            border-bottom:1px solid rgba(255,255,255,.04);font-family:Inter,sans-serif;}
        .ie-chain-item:last-child{border-bottom:none;}
        .ie-chain-item.has-delay{color:#d0e5f9;}
    </style>

    ${stationaryBanner}

    <!-- ENGINE BADGE -->
    ${ml._fallback ? `
    <div style="font-size:8px;background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.3);border-radius:4px;padding:4px 8px;color:#fb923c;font-family:Inter,sans-serif;margin-bottom:10px;">
        ⚠ Reasoning engine offline — fallback active
    </div>` : `
    <div style="font-size:8px;background:rgba(96,165,250,.07);border:1px solid rgba(96,165,250,.15);border-radius:4px;padding:4px 8px;color:#60a5fa;font-family:Inter,sans-serif;margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;">
        <span>⚙ Reasoning Engine v4</span>
        <span style="color:#44474c;">|</span>
        <span>Storm trajectory · Congestion compounding · Tidal windows</span>
        ${ml._stationary_override ? '<span style="color:#44474c;">|</span><span style="color:#f87171;">Stationary override applied</span>' : ""}
    </div>`}

    <!-- SPEED TELEMETRY -->
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
                <div class="ie-ssub">GPS traveled</div>
            </div>
        </div>
        ${m.isStationary ? `
        <div style="margin-top:6px;font-size:9px;color:#f87171;font-weight:700;font-family:Inter,sans-serif;
            padding:6px 8px;background:rgba(248,113,113,.07);border-radius:4px;">
            ⚠ No checkpoint progress for ${Math.round(m.stationaryDays)} days — vessel classified as stationary
            ${m.totalDistanceKm > 5 ? `<span style="color:#8e9196;font-weight:400;"> (GPS shows ${m.totalDistanceKm.toFixed(0)} km — likely phone GPS drift, not actual ship movement)</span>` : ""}
        </div>` : ""}
    </div>

    <!-- DELAY RISK MODEL -->
    <div class="ie-sec">
        <div class="ie-lbl">🧠 Delay Risk Model</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
            ${buildRiskGaugeSVG(ml.risk_score, ml.risk_tier)}
            <div style="flex:1;">
                <div style="font-size:18px;font-weight:800;font-family:Manrope,sans-serif;color:#f87171;line-height:1;">
                    ${m.isStationary
                        ? `${Math.round(m.daysOverdue)}d OVERDUE`
                        : `+${ml.predicted_delay_hours}h`}
                    <span style="font-size:9px;font-weight:400;color:#8e9196;margin-left:4px;">
                        ${m.isStationary ? "past scheduled arrival" : "predicted delay"}
                    </span>
                </div>
                <div style="font-size:11px;color:#8e9196;line-height:1.8;margin-top:4px;font-family:Inter,sans-serif;">
                    <span style="color:${m.progressGap > 5 ? IE_COLORS.warning : m.progressGap < -5 ? IE_COLORS.success : "#d0e5f9"};font-weight:600;">
                        ${m.progressGap > 0 ? m.progressGap.toFixed(1)+"% BEHIND" : m.progressGap < 0 ? Math.abs(m.progressGap).toFixed(1)+"% AHEAD" : "ON SCHEDULE"}
                    </span><br>
                    CPs: <span style="color:#d0e5f9;font-weight:600;">${m.reachedCPs}/${m.totalCPs}</span>
                    &nbsp;|&nbsp; Storm: <span style="color:${m.stormFlag ? IE_COLORS.critical : IE_COLORS.success};font-weight:600;">${m.stormFlag ? "ACTIVE" : "CLEAR"}</span>
                </div>
            </div>
        </div>

        ${breakdownFactors.length > 0 ? `
        <div style="margin-bottom:10px;">
            <div style="font-size:8px;color:#8e9196;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;font-family:Inter,sans-serif;">Delay Breakdown</div>
            ${breakdownFactors.map(f => `
            <div style="margin-bottom:5px;">
                <div style="display:flex;justify-content:space-between;font-size:8px;font-family:Inter,sans-serif;">
                    <span style="color:#8e9196;">${f.label}</span>
                    <span style="color:${f.color};font-weight:700;">+${f.val}h</span>
                </div>
                <div class="ie-fbar">
                    <div class="ie-ffill" style="width:${(f.val/maxBreakdown*100).toFixed(0)}%;background:${f.color};"></div>
                </div>
            </div>`).join("")}
        </div>` : ""}

        <div style="display:flex;flex-direction:column;gap:5px;">
            ${[
                {label:"Total predicted delay",  pct: m.isStationary ? 100 : Math.min(100,(ml.predicted_delay_hours/30)*100), color:"#f87171", val: m.isStationary ? `${Math.round(m.daysOverdue)}d overdue` : `+${ml.predicted_delay_hours}h`},
                {label:"Risk score",              pct: ml.risk_score,                                                           color:ml.risk_score>=76?"#f87171":ml.risk_score>=51?"#fb923c":"#fbbf24", val:`${ml.risk_score}/100`},
                {label:"Progress deviation",      pct: Math.min(100,Math.abs(m.progressGap)*2),                                 color:"#fb923c", val:`${m.progressGap.toFixed(1)}%`},
                {label:"Checkpoint compliance",   pct: m.totalCPs > 0 ? (m.reachedCPs/m.totalCPs)*100 : 100,                   color:"#4ADE80", val:`${m.reachedCPs}/${m.totalCPs}`},
            ].map(f => `
            <div>
                <div style="display:flex;justify-content:space-between;font-size:8px;color:#d0e5f9;font-family:Inter,sans-serif;">
                    <span>${f.label}</span><span style="color:${f.color}">${f.val}</span>
                </div>
                <div class="ie-fbar"><div class="ie-ffill" style="width:${f.pct.toFixed(0)}%;background:${f.color}"></div></div>
            </div>`).join("")}
        </div>
    </div>

    <!-- ROUTE RECOMMENDATION (hide if cancellation is recommended) -->
    ${!ml._should_cancel ? `
    <div class="ie-sec">
        <div class="ie-lbl">🗺 Route Model</div>
        <div style="margin-bottom:8px;padding:8px 10px;border-radius:6px;background:${recColor}18;border:1px solid ${recColor}44;display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">${ml.recommendation_action==="SHIFT PORT"?"⚓":ml.recommendation_action==="REROUTE"?"🔁":ml.recommendation_action==="ON TRACK"?"✓":ml.recommendation_action==="ESCALATE"?"🚨":"◎"}</span>
            <div style="flex:1;">
                <div style="font-size:11px;font-weight:700;color:${recColor};font-family:Manrope,sans-serif;">${ml.recommendation_action}</div>
                <div style="font-size:9px;color:#8e9196;font-family:Inter,sans-serif;margin-top:1px;">${ml.reasoning?.split("|")[0] || ""}</div>
            </div>
            ${ml.time_saved_hours > 0 ? `<div style="text-align:right;flex-shrink:0;">
                <div style="font-size:13px;font-weight:800;color:#4ADE80;font-family:Manrope,sans-serif;">-${ml.time_saved_hours}h</div>
                <div style="font-size:8px;color:#8e9196;">time saved</div>
            </div>` : ""}
        </div>
        ${buildRouteCards(ml)}
    </div>` : ""}

    <!-- REASONING CHAIN -->
    ${ml.reasoning_chain?.length > 0 ? `
    <div class="ie-sec">
        <div class="ie-lbl">🔍 Reasoning Chain
            <span style="font-size:8px;color:#44474c;font-weight:400;text-transform:none;letter-spacing:0;">${ml.reasoning_chain.length} factors evaluated</span>
        </div>
        <div style="background:rgba(255,255,255,.02);border:1px solid rgba(186,200,220,.07);border-radius:6px;padding:8px;">
            ${ml.reasoning_chain.map((r) => {
                const hasDelay = r.includes("+") && r.includes("h");
                const isGood   = r.includes("no") || r.includes("calm") || r.includes("negligible") || r.includes("clears") || r.includes("fast");
                const dotColor = isGood ? "#4ADE80" : hasDelay ? "#fb923c" : "#44474c";
                return `<div class="ie-chain-item ${hasDelay ? "has-delay" : ""}">
                    <span style="color:${dotColor};margin-right:5px;">●</span>${r}
                </div>`;
            }).join("")}
        </div>
    </div>` : ""}

    <!-- SITUATION ANALYSIS -->
    <div class="ie-sec">
        <div class="ie-lbl">📋 Situation Analysis</div>
        <div class="ie-ai">
            <div style="font-size:11px;color:#d0e5f9;line-height:1.6;font-family:Inter,sans-serif;margin-bottom:10px;">${ml.situation}</div>
            <div style="font-size:9px;color:#fb6b00;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px;font-family:Inter,sans-serif;">Recommended Action</div>
            <div style="font-size:10px;color:#d0e5f9;font-family:Inter,sans-serif;">${ml.recommended_action}</div>
        </div>
    </div>

    <!-- ACTIVE ALERTS -->
    <div class="ie-sec">
        <div class="ie-lbl">🔔 Active Alerts
            <span id="ie-alert-badge" style="background:${criticalCount>0?IE_COLORS.critical:IE_COLORS.warning};color:white;font-size:8px;font-weight:800;padding:1px 6px;border-radius:10px;display:${activeAlerts.length>0?"inline-flex":"none"};font-family:Inter,sans-serif;">${activeAlerts.length}</span>
        </div>
        <div id="ie-alert-feed">
            ${activeAlerts.length === 0
                ? `<div style="font-size:10px;color:#8e9196;padding:8px 0;font-family:Inter,sans-serif;">No active alerts</div>`
                : activeAlerts.map(a => buildAlertHTML(a)).join("")}
        </div>
    </div>

    <!-- OPS DECISION ENGINE -->
    <div class="ie-sec">
        <div class="ie-lbl">⚙️ Ops Decision Engine</div>
        ${buildDecisionButtons(s, m, alerts, ml)}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE CARDS
// ─────────────────────────────────────────────────────────────────────────────
function buildRouteCards(ml) {
    if (!ml.routes || Object.keys(ml.routes).length === 0) {
        return `<div style="font-size:10px;color:#8e9196;font-family:Inter,sans-serif;">Route data unavailable</div>`;
    }
    const routeColors = { A:"#60a5fa", B:"#fb923c", C:"#4ADE80" };

    return Object.values(ml.routes).map(r => {
        const color    = routeColors[r.id] || "#94a3b8";
        const costLakh = r.fuel_cost_inr ? (r.fuel_cost_inr / 100000).toFixed(2) : "—";
        const extraLakh = r.extra_cost_inr > 0 ? `+₹${(r.extra_cost_inr/100000).toFixed(2)}L` : "—";
        return `
        <div class="ie-route-card${r.recommended ? " best" : ""}" onclick="focusMapRoute('${r.id}')" data-route-id="${r.id}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <span style="width:20px;height:3px;border-radius:2px;background:${color};display:inline-block;"></span>
                    <span style="font-size:10px;font-weight:700;color:#d0e5f9;font-family:Inter,sans-serif;">Route ${r.id}: ${r.label}</span>
                    ${r.recommended ? `<span class="ie-rc-badge">✓ Best</span>` : ""}
                </div>
                <span style="font-size:9px;color:${r.delay_hours > 8 ? "#f87171" : r.delay_hours > 3 ? "#fb923c" : "#4ADE80"};font-weight:700;font-family:Manrope,sans-serif;">${r.delay_hours}h delay</span>
            </div>
            <div style="font-size:9px;color:#8e9196;font-family:Inter,sans-serif;margin-bottom:5px;">${(r.waypoint_coords||[]).map(w=>w.name).join(" → ")}</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;font-size:9px;font-family:Inter,sans-serif;">
                <div><span style="color:#44474c;">Distance</span><br><strong style="color:#d0e5f9;">${r.distance_nm} nm</strong></div>
                <div><span style="color:#44474c;">Fuel cost</span><br><strong style="color:#d0e5f9;">₹${costLakh}L</strong></div>
                <div><span style="color:#44474c;">Congestion</span><br><strong style="color:${r.congestion_pct>70?"#f87171":r.congestion_pct>50?"#fb923c":"#4ADE80"}">${r.congestion_pct}%</strong></div>
                <div><span style="color:#44474c;">Extra cost</span><br><strong style="color:${r.extra_cost_inr>0?"#fb923c":"#4ADE80"}">${extraLakh}</strong></div>
            </div>
        </div>`;
    }).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAP ROUTE RENDERING
// ─────────────────────────────────────────────────────────────────────────────
function renderMLRouteMap(ml, s) {
    // Skip if detail page has set this flag
    if (window._ieSkipMapRoutes) return;

    const tryRender = (attempts = 0) => {
        const map = window._leafletMap || window.leafletMapInstance;
        if (!map && attempts < 20) { setTimeout(() => tryRender(attempts + 1), 500); return; }
        if (!map) return;

        _routeLayers.forEach(l => { try { map.removeLayer(l); } catch(_) {} });
        _routeLayers = [];

        const routes = ml.routes;
        if (!routes || Object.keys(routes).length === 0) return;

        const ROUTE_STYLE = {
            A: { color:"#60a5fa", weight:3, dashArray:"8,5",  opacity:0.85 },
            B: { color:"#fb923c", weight:3, dashArray:"4,4",  opacity:0.85 },
            C: { color:"#4ADE80", weight:3, dashArray:null,    opacity:0.85 },
        };

        Object.values(routes).forEach(route => {
            const coords = (route.waypoint_coords || []).map(w => [w.lat, w.lng]);
            if (coords.length < 2) return;

            const style = ROUTE_STYLE[route.id] || { color:"#94a3b8", weight:2, opacity:0.7 };
            const isHit = route.recommended;

            if (isHit) {
                const glow = L.polyline(coords, { color: style.color, weight: 8, opacity: 0.12 });
                glow.addTo(map);
                _routeLayers.push(glow);
            }

            const line = L.polyline(coords, {
                color    : style.color,
                weight   : isHit ? 4 : 2.5,
                opacity  : isHit ? 1 : 0.55,
                dashArray: style.dashArray,
            });

            const costLakh = route.fuel_cost_inr ? (route.fuel_cost_inr / 100000).toFixed(2) : "—";
            const extra    = route.extra_cost_inr > 0 ? ` (+₹${(route.extra_cost_inr/100000).toFixed(2)}L)` : "";
            line.bindPopup(`
                <div style="min-width:180px;">
                    <b>Route ${route.id}: ${route.label}</b><br>
                    ${(route.waypoint_coords||[]).map(w=>w.name).join(" → ")}<br><br>
                    <b>Distance:</b> ${route.distance_nm} nm<br>
                    <b>Delay:</b> ${route.delay_hours}h<br>
                    <b>Fuel cost:</b> ₹${costLakh}L${extra}<br>
                    <b>Congestion:</b> ${route.congestion_pct}%<br>
                    ${route.recommended ? "<br><b style='color:#4ADE80'>✓ Recommended</b>" : ""}
                </div>
            `, { maxWidth: 240 });

            line.addTo(map);
            _routeLayers.push(line);

            if (coords.length >= 2) {
                const mid  = coords[Math.floor(coords.length / 2)];
                const icon = L.divIcon({
                    className : "",
                    html      : `<div style="background:${style.color}22;border:1px solid ${style.color}99;
                        color:${style.color};font-size:9px;font-weight:700;padding:2px 7px;
                        border-radius:10px;white-space:nowrap;font-family:Inter,sans-serif;backdrop-filter:blur(4px);">
                        ${route.id} · ₹${costLakh}L · ${route.delay_hours}h${route.recommended ? " ✓" : ""}
                    </div>`,
                    iconAnchor: [40, 10],
                });
                const marker = L.marker(mid, { icon, interactive: false });
                marker.addTo(map);
                _routeLayers.push(marker);
            }
        });

        const allWaypoints = new Map();
        Object.values(routes).forEach(r => {
            (r.waypoint_coords || []).forEach(w => allWaypoints.set(w.key, w));
        });
        allWaypoints.forEach(w => {
            const icon = L.divIcon({
                className : "",
                html      : `<div style="width:12px;height:12px;border-radius:50%;
                    background:#bac8dc;border:2px solid #8e9196;
                    box-shadow:0 0 0 3px rgba(186,200,220,.1);"></div>`,
                iconAnchor: [6, 6],
            });
            const mk = L.marker([w.lat, w.lng], { icon }).bindPopup(`<b>${w.name}</b>`);
            mk.addTo(map);
            _routeLayers.push(mk);
        });
    };
    tryRender();
}

window.focusMapRoute = function(routeId) {
    if (!_lastMLResult?.routes) return;
    const route = _lastMLResult.routes[routeId];
    if (!route?.waypoint_coords?.length) return;
    const map = window._leafletMap || window.leafletMapInstance;
    if (!map) return;
    const bounds = L.latLngBounds(route.waypoint_coords.map(w => [w.lat, w.lng]));
    map.fitBounds(bounds, { padding: [60, 60] });
    document.querySelectorAll(".ie-route-card").forEach(el => {
        el.style.borderColor = el.dataset.routeId === routeId
            ? (routeId === "A" ? "#60a5fa" : routeId === "B" ? "#fb923c" : "#4ADE80")
            : "rgba(186,200,220,0.1)";
    });
};

// ─────────────────────────────────────────────────────────────────────────────
// ALERT HTML
// ─────────────────────────────────────────────────────────────────────────────
function buildAlertHTML(a) {
    const icons = { CRITICAL:"🔴", WARNING:"🟠", INFO:"🔵" };
    const ts    = new Date(a.timestamp).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
    return `
        <div class="ie-alert ${a.severity}" id="alert-${a.id}">
            <span style="font-size:11px;margin-top:1px;">${icons[a.severity]||"⚪"}</span>
            <div style="flex:1;">
                <div class="ie-atitle">${a.title}</div>
                <div class="ie-abody">${a.body}</div>
                <div style="font-size:8px;color:#44474c;margin-top:3px;">${ts}</div>
            </div>
            <button class="ie-dismiss" id="dismiss-${a.id}">✕</button>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISION BUTTONS — terminate is always enabled for stationary ships
// ─────────────────────────────────────────────────────────────────────────────
function buildDecisionButtons(s, m, alerts, ml) {
    const hasCritical = alerts.some(a => a.severity === "CRITICAL" && !a.dismissed);
    const hasWarning  = alerts.some(a => !a.dismissed && a.severity !== "INFO");
    const hasDelay    = ml.predicted_delay_hours > 0 || m.daysOverdue > 0;

    const actions = [
        { key:"terminate", emoji:"🛑",
          label: ml._should_cancel ? "Terminate Shipment (RECOMMENDED)" : "Terminate Shipment",
          color: ml._should_cancel ? "#dc2626" : "#dc2626",
          enabled: m.isStationary || ml._should_cancel },
        { key:"reroute",   emoji:"🔁", label:"Open Reroute Decision Center", color:IE_COLORS.critical, enabled: (ml.stormFlag || m.riskScore > 50) && !ml._should_cancel },
        { key:"captain",   emoji:"📞", label:"Contact Captain",              color:IE_COLORS.warning,  enabled: hasWarning || m.isStationary },
        { key:"escalate",  emoji:"📢", label:"Escalate to Port Authority",   color:"#a78bfa",          enabled: hasCritical || m.isStationary },
        { key:"flag",      emoji:"📦", label:"Flag Cargo At Risk",           color:IE_COLORS.warning,  enabled: (ml.stormFlag || m.isStationary) && hasDelay },
        { key:"eta",       emoji:"⏱",  label:"Revise ETA",                  color:IE_COLORS.info,     enabled: hasDelay || m.progressGap > 5 || m.isStationary },
    ];

    return actions.map(a => `
        <button class="ie-btn" data-ie-action="${a.key}" ${a.enabled ? "" : "disabled"}
            style="border-color:${a.color}${a.enabled?"55":"22"};
                   color:${a.enabled ? a.color : "#44474c"};
                   background:${a.color}${a.enabled?"11":"06"};">
            <span style="font-size:13px;">${a.emoji}</span>
            <span>${a.label}</span>
        </button>`).join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK GAUGE SVG
// ─────────────────────────────────────────────────────────────────────────────
function buildRiskGaugeSVG(score, tier) {
    const s     = Math.max(0, Math.min(score, 100));
    const color = { CRITICAL:"#f87171", HIGH:"#fb923c", MEDIUM:"#fbbf24", LOW:"#4ADE80" }[tier] || "#94a3b8";
    const r     = 28, circ = Math.PI * r;
    return `
        <svg width="76" height="48" viewBox="0 0 76 48" style="flex-shrink:0;">
            <path d="M 10 38 A 28 28 0 0 1 66 38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5" stroke-linecap="round"/>
            <path d="M 10 38 A 28 28 0 0 1 66 38" fill="none" stroke="${color}" stroke-width="5"
                stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ*(1-s/100)}"/>
            <text x="38" y="35" text-anchor="middle" font-size="13" font-weight="800"
                fill="${color}" font-family="Manrope,sans-serif">${s}</text>
            <text x="38" y="45" text-anchor="middle" font-size="6.5" fill="#8e9196"
                font-family="Inter,sans-serif" letter-spacing="0.05em">${tier}</text>
        </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS + MODALS
// ─────────────────────────────────────────────────────────────────────────────
function attachActionHandlers(s, m, alerts, ml) {
    alerts.filter(a => !a.dismissed).forEach(a => {
        document.getElementById(`dismiss-${a.id}`)?.addEventListener("click", () => dismissAlert(a.id));
    });
    const handlers = {
        reroute  : () => openRerouteModal(s, m, ml),
        captain  : () => openCaptainModal(s, m, ml),
        escalate : () => openEscalateModal(s, m, alerts, ml),
        flag     : () => openFlagCargoModal(s, m, ml),
        eta      : () => openReviseETAModal(s, m, ml),
        terminate: () => openTerminateModal(s, m, ml),
    };
    document.querySelectorAll("[data-ie-action]").forEach(btn => {
        btn.addEventListener("click", () => handlers[btn.getAttribute("data-ie-action")]?.());
    });
}

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

function openRerouteModal(s, m, ml) {
    const win = window.open(`reroute_decision.html?id=${_currentShipmentId}`, '_blank');
    if (!win) return;
    const payload = { type: 'nautical_ml_data', ml, shipment: s };
    const interval = setInterval(() => win.postMessage(payload, window.location.origin), 300);
    setTimeout(() => clearInterval(interval), 5000);
    window.addEventListener('message', (e) => {
        if (e.data?.type === 'nautical_ml_ack') clearInterval(interval);
    }, { once: true });
}

function openCaptainModal(s, m, ml) {
    const daysStr = `${Math.round(m.stationaryDays)} days`;
    const breakdown = ml.delay_breakdown || {};
    const bdLines = Object.entries(breakdown)
        .filter(([,v]) => v > 0)
        .map(([k,v]) => `  - ${k.replace(/_/g," ")}: +${v}h`)
        .join("\n");

    const stationaryNote = m.isStationary
        ? `\n⚠ URGENT: Vessel has been stationary for ${daysStr}.\nNo checkpoint progress. ${Math.round(m.daysOverdue)} days overdue.\n${ml._should_cancel ? "CANCELLATION IS RECOMMENDED.\n" : ""}`
        : "";

    const msg = `Captain,\n\nOps alert — Vessel: ${s.vessel?.name} | #${s._id?.toString().slice(-8).toUpperCase()}\n${stationaryNote}\nReasoning Engine Report:\n- Predicted delay: +${ml.predicted_delay_hours}h\n- Risk score: ${ml.risk_score}/100 (${ml.risk_tier})\n- Recommended route: ${ml.best_route_id || "—"} (${ml.recommendation_action})\n\nDelay breakdown:\n${bdLines}\n\n${ml.storm_flag ? "⚠ Storm conditions active on route\n" : ""}Progress: ${m.actualPct}% (expected ${m.expectedPct.toFixed(0)}%)\nAvg speed: ${m.isStationary ? "STATIONARY — NO MOVEMENT DETECTED" : m.avgSpeedKnots.toFixed(1) + " kn"}\n\nPlease confirm current situation and ETA immediately.\n\nNAUTICAL.OS Operations`;
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>📞 Contact Captain</h3>
        <textarea rows="14">${msg}</textarea>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="ie-msub" style="background:#fb6b00;"
                onclick="navigator.clipboard?.writeText(this.closest('.ie-modal').querySelector('textarea').value);this.textContent='✓ Copied!'">Copy</button>
            <button class="ie-msub" style="background:#1d4ed8;"
                onclick="this.textContent='✓ Sent via GMDSS';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">Send via GMDSS</button>
        </div>`);
}

function openEscalateModal(s, m, alerts, ml) {
    const crits = alerts.filter(a => !a.dismissed && a.severity === "CRITICAL");
    const stationaryNote = m.isStationary
        ? `\nCRITICAL: Vessel stationary for ${Math.round(m.stationaryDays)} days.\n${Math.round(m.daysOverdue)} days past scheduled arrival.\n` : "";
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>📢 Escalate to Port Authority</h3>
        <div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:10px;margin-bottom:12px;">
            <div style="font-size:10px;font-weight:700;color:#f87171;margin-bottom:6px;">CRITICAL INCIDENTS (${crits.length})</div>
            ${crits.map(a => `<div style="font-size:10px;color:#d0e5f9;margin-bottom:3px;">• ${a.title}</div>`).join("")||'<div style="font-size:10px;color:#8e9196;">None</div>'}
        </div>
        <textarea rows="8">Vessel: ${s.vessel?.name}
Route: ${s.cargo?.origin} → ${s.cargo?.destination}
Risk Score: ${ml.risk_score}/100 (${ml.risk_tier})
Predicted Delay: +${ml.predicted_delay_hours}h${stationaryNote}
Recommended Action: ${ml.recommendation_action}
Incidents: ${crits.map(a=>a.title).join("; ")||"None"}
Requesting port authority assessment and intervention.</textarea>
        <button class="ie-msub" style="background:#7c3aed;"
            onclick="this.textContent='✓ Escalation Filed';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">
            Submit Escalation Report
        </button>`);
}

function openFlagCargoModal(s, m, ml) {
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>📦 Flag Cargo At Risk</h3>
        <div style="background:rgba(251,146,60,.07);border:1px solid rgba(251,146,60,.2);border-radius:8px;padding:10px;margin-bottom:12px;font-size:11px;color:#d0e5f9;line-height:1.8;">
            ${ml.storm_flag ? "• Active storm on route<br>" : ""}
            ${m.isStationary ? `• Vessel stationary ${Math.round(m.stationaryDays)} days<br>` : ""}
            ${m.daysOverdue > 0 ? `• Shipment ${Math.round(m.daysOverdue)} days overdue<br>` : ""}
            • ${s.vessel?.container_count || "—"} TEU containers affected<br>
            • Risk score: ${ml.risk_score}/100
        </div>
        <textarea rows="3" placeholder="Cargo sensitivity, handling requirements..."></textarea>
        <button class="ie-msub" style="background:#d97706;"
            onclick="this.textContent='✓ Cargo Flagged';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">Confirm Flag</button>`);
}

function openReviseETAModal(s, m, ml) {
    const schedStr   = m.scheduledETA.toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const deltaHours = ml.predicted_delay_hours || 0;
    const revisedStr = new Date(m.scheduledETA.getTime() + deltaHours * 3_600_000)
        .toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const overdueLabel = m.daysOverdue > 0
        ? `<div style="text-align:center;font-size:13px;color:#f87171;font-family:Inter,sans-serif;margin-bottom:8px;">${Math.round(m.daysOverdue)} days past scheduled arrival</div>`
        : "";
    openModal(`
        <button class="ie-mclose">✕</button>
        <h3>⏱ Revise ETA</h3>
        ${overdueLabel}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
            <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;">
                <div style="font-size:9px;color:#8e9196;text-transform:uppercase;margin-bottom:4px;">Scheduled ETA</div>
                <div style="font-size:12px;font-weight:700;color:#d0e5f9;">${schedStr}</div>
            </div>
            <div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:10px;">
                <div style="font-size:9px;color:#8e9196;text-transform:uppercase;margin-bottom:4px;">Revised ETA</div>
                <div style="font-size:11px;font-weight:700;color:#f87171;">${m.daysOverdue > 0 ? "UNKNOWN — vessel not moving" : revisedStr}</div>
            </div>
        </div>
        <div style="text-align:center;font-size:22px;font-weight:800;font-family:Manrope,sans-serif;color:${deltaHours>0?"#f87171":"#4ADE80"};margin-bottom:12px;">
            ${m.daysOverdue > 0 ? `${Math.round(m.daysOverdue)} DAYS OVERDUE` : deltaHours > 0 ? `+${deltaHours}h DELAY` : "On Schedule"}
        </div>
        <input type="text" placeholder="Notify stakeholders — email addresses (comma separated)...">
        <button class="ie-msub" style="background:#fb6b00;"
            onclick="this.textContent='✓ ETA Revision Sent';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),1500)">
            Confirm & Notify
        </button>`);
}

function openTerminateModal(s, m, ml) {
    const urgency = ml._should_cancel
        ? `<div style="background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.4);border-radius:8px;padding:12px;margin-bottom:14px;">
            <div style="font-size:11px;color:#f87171;font-weight:700;margin-bottom:6px;">⛔ CANCELLATION RECOMMENDED BY INTELLIGENCE ENGINE</div>
            <div style="font-size:11px;color:#d0e5f9;line-height:1.8;">
                Vessel stationary for <strong>${Math.round(m.stationaryDays)} days</strong> — ${Math.round(m.daysOverdue)} days overdue.<br>
                Zero checkpoints reached out of ${m.totalCPs}.<br>
                Risk score: ${ml.risk_score}/100 CRITICAL.
            </div>
          </div>`
        : `<div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);border-radius:8px;padding:12px;margin-bottom:14px;">
            <div style="font-size:11px;color:#f87171;font-weight:700;margin-bottom:6px;">⚠ This action cannot be undone</div>
            <div style="font-size:11px;color:#d0e5f9;line-height:1.8;">
                Vessel: <strong>${s.vessel?.name}</strong><br>
                Stationary: ~${Math.round(m.stationaryDays)} days<br>
                ${s.vessel?.container_count} TEU containers affected
            </div>
          </div>`;

    openModal(`
        <button class="ie-mclose">✕</button>
        <h3 style="color:#f87171;">🛑 Terminate Shipment</h3>
        ${urgency}
        <textarea rows="3" placeholder="State reason for audit trail..."></textarea>
        <div style="display:flex;gap:8px;margin-top:12px;">
            <button class="ie-msub" style="background:#374151;flex:1;" onclick="document.querySelector('.ie-modal-backdrop')?.remove()">Cancel</button>
            <button class="ie-msub" style="background:#dc2626;flex:1;"
                onclick="this.textContent='✓ Termination Filed';this.disabled=true;setTimeout(()=>document.querySelector('.ie-modal-backdrop')?.remove(),2000)">
                Confirm Terminate
            </button>
        </div>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dL = (lat2-lat1)*Math.PI/180, dN = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dN/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

window.runIntelligenceEngine = runIntelligenceEngine;