
"""
NAUTICAL.OS — Smart Rule-Based Intelligence Service
ml_service.py  (v4 — deterministic reasoning engine, no ML libraries needed)
 
Replaces XGBoost/LightGBM with a multi-factor reasoning engine that:
  - Models storm trajectory intersection (not just probability)
  - Computes congestion compounding across time windows
  - Accounts for cargo sensitivity, vessel class, coast-crossing penalties
  - Produces a full narrative reasoning chain, not just numbers
 
POST /predict      — main inference endpoint
GET  /health       — liveness check
GET  /model-info   — factor weights + port registry
"""
 
import math, time, json
from flask import Flask, request, jsonify
from flask_cors import CORS
import warnings
warnings.filterwarnings("ignore")
 
app = Flask(__name__)
CORS(app)
 
# ─────────────────────────────────────────────────────────────────────────────
# PORT REGISTRY
# ─────────────────────────────────────────────────────────────────────────────
PORTS = {
    "JNPT":     {"name": "Jawaharlal Nehru Port", "state": "MH", "lat": 18.95, "lng": 72.95, "coast": "west",
                 "base_cong": 68, "berth_slots": 24, "tide_sensitive": False, "customs_delay_avg": 4},
    "MUNDRA":   {"name": "Mundra Port",            "state": "GJ", "lat": 22.84, "lng": 69.72, "coast": "west",
                 "base_cong": 55, "berth_slots": 30, "tide_sensitive": False, "customs_delay_avg": 2},
    "KANDLA":   {"name": "Kandla Port",            "state": "GJ", "lat": 23.03, "lng": 70.22, "coast": "west",
                 "base_cong": 42, "berth_slots": 18, "tide_sensitive": True,  "customs_delay_avg": 3},
    "MORMUGAO": {"name": "Mormugao Port",          "state": "GA", "lat": 15.41, "lng": 73.80, "coast": "west",
                 "base_cong": 38, "berth_slots": 12, "tide_sensitive": True,  "customs_delay_avg": 2},
    "KOCHI":    {"name": "Cochin Port",            "state": "KL", "lat":  9.93, "lng": 76.27, "coast": "west",
                 "base_cong": 46, "berth_slots": 20, "tide_sensitive": False, "customs_delay_avg": 3},
    "CHENNAI":  {"name": "Chennai Port",           "state": "TN", "lat": 13.08, "lng": 80.27, "coast": "east",
                 "base_cong": 82, "berth_slots": 16, "tide_sensitive": False, "customs_delay_avg": 6},
    "VIZAG":    {"name": "Visakhapatnam Port",     "state": "AP", "lat": 17.69, "lng": 83.22, "coast": "east",
                 "base_cong": 61, "berth_slots": 22, "tide_sensitive": False, "customs_delay_avg": 4},
    "PARADIP":  {"name": "Paradip Port",           "state": "OD", "lat": 20.32, "lng": 86.61, "coast": "east",
                 "base_cong": 48, "berth_slots": 14, "tide_sensitive": True,  "customs_delay_avg": 3},
    "KOLKATA":  {"name": "Kolkata Port",           "state": "WB", "lat": 22.57, "lng": 88.36, "coast": "east",
                 "base_cong": 57, "berth_slots": 18, "tide_sensitive": True,  "customs_delay_avg": 8},
    "ENNORE":   {"name": "Ennore Port",            "state": "TN", "lat": 13.21, "lng": 80.32, "coast": "east",
                 "base_cong": 34, "berth_slots": 10, "tide_sensitive": False, "customs_delay_avg": 3},
}
 
PORT_KEYS = list(PORTS.keys())
 
# ─────────────────────────────────────────────────────────────────────────────
# CARGO PROFILES
# Each cargo has: risk multiplier, weather sensitivity, customs flag risk,
# perishability (higher = more urgent), hazmat level
# ─────────────────────────────────────────────────────────────────────────────
CARGO_PROFILES = {
    "Containers":  {"risk_mult": 1.00, "weather_sens": 0.8,  "customs_risk": 0.5, "perishable": 0.1, "hazmat": 0},
    "Crude Oil":   {"risk_mult": 1.30, "weather_sens": 1.2,  "customs_risk": 0.3, "perishable": 0.0, "hazmat": 2},
    "Coal":        {"risk_mult": 0.70, "weather_sens": 0.6,  "customs_risk": 0.2, "perishable": 0.0, "hazmat": 0},
    "Iron Ore":    {"risk_mult": 0.75, "weather_sens": 0.5,  "customs_risk": 0.2, "perishable": 0.0, "hazmat": 0},
    "Electronics": {"risk_mult": 1.40, "weather_sens": 1.5,  "customs_risk": 0.9, "perishable": 0.3, "hazmat": 0},
    "Automobiles": {"risk_mult": 1.20, "weather_sens": 1.1,  "customs_risk": 0.7, "perishable": 0.0, "hazmat": 0},
    "Fertilizers": {"risk_mult": 1.00, "weather_sens": 0.9,  "customs_risk": 0.6, "perishable": 0.1, "hazmat": 1},
    "Food Grains": {"risk_mult": 1.10, "weather_sens": 1.0,  "customs_risk": 0.8, "perishable": 0.7, "hazmat": 0},
    "Textiles":    {"risk_mult": 0.85, "weather_sens": 0.7,  "customs_risk": 0.4, "perishable": 0.0, "hazmat": 0},
    "Chemicals":   {"risk_mult": 1.35, "weather_sens": 1.3,  "customs_risk": 0.7, "perishable": 0.2, "hazmat": 2},
}
 
# ─────────────────────────────────────────────────────────────────────────────
# VESSEL PROFILES
# ─────────────────────────────────────────────────────────────────────────────
VESSEL_PROFILES = {
    "Container Ship": {"speed_kn": 18, "weather_limit_wave": 6.0, "storm_speed_factor": 0.55, "maneuver": "high"},
    "Bulk Carrier":   {"speed_kn": 14, "weather_limit_wave": 5.0, "storm_speed_factor": 0.45, "maneuver": "low"},
    "Tanker":         {"speed_kn": 13, "weather_limit_wave": 5.5, "storm_speed_factor": 0.50, "maneuver": "low"},
    "RoRo Vessel":    {"speed_kn": 16, "weather_limit_wave": 4.5, "storm_speed_factor": 0.40, "maneuver": "medium"},
    "General Cargo":  {"speed_kn": 12, "weather_limit_wave": 4.5, "storm_speed_factor": 0.40, "maneuver": "medium"},
}
 
ROUTE_LABELS = ["A", "B", "C"]
 
# ─────────────────────────────────────────────────────────────────────────────
# GEOMETRY
# ─────────────────────────────────────────────────────────────────────────────
def haversine_nm(lat1, lon1, lat2, lon2):
    R = 3440.065
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat/2)**2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
 
def get_waypoint(ok, dk):
    o, d = PORTS[ok], PORTS[dk]
    if o["coast"] != d["coast"]:
        return "KOCHI"
    if o["coast"] == "west":
        return "MORMUGAO" if o["lat"] > 14 else "MUNDRA"
    return "ENNORE"
 
def get_alt_port(dest_key, dest_cong):
    d_coast = PORTS[dest_key]["coast"]
    candidates = [k for k in PORT_KEYS if k != dest_key and PORTS[k]["coast"] == d_coast]
    best, best_score = dest_key, dest_cong
    for k in candidates:
        # Score alt port by congestion + customs delay
        score = PORTS[k]["base_cong"] + PORTS[k]["customs_delay_avg"] * 2
        if score < best_score:
            best, best_score = k, score
    return best
 
def route_distances(ok, dk):
    o, d = PORTS[ok], PORTS[dk]
    wp_key = get_waypoint(ok, dk)
    wp = PORTS[wp_key]
    dist_a = haversine_nm(o["lat"], o["lng"], d["lat"], d["lng"])
    dist_b = (haversine_nm(o["lat"], o["lng"], wp["lat"], wp["lng"])
              + haversine_nm(wp["lat"], wp["lng"], d["lat"], d["lng"]))
    alt_key = get_alt_port(dk, PORTS[dk]["base_cong"] + PORTS[dk]["customs_delay_avg"] * 2)
    alt = PORTS[alt_key]
    dist_c = haversine_nm(o["lat"], o["lng"], alt["lat"], alt["lng"])
    return dist_a, dist_b, dist_c, wp_key, alt_key
 
 
# ─────────────────────────────────────────────────────────────────────────────
# CORE REASONING ENGINE
# All delay factors are computed independently, then composed.
# Each factor returns (hours, explanation_string)
# ─────────────────────────────────────────────────────────────────────────────
 
def factor_storm(cyclone_prob, wave_height, hours_until_storm,
                 storm_duration, vessel_type, dist_nm, cargo_type):
    """
    Storm delay reasoning:
    - If storm arrives AFTER ship completes voyage → 0 delay
    - If ship can outrun storm (clear before it hits) → 0 delay
    - If storm hits mid-voyage → partial or full delay based on overlap window
    - Wave height adds independent sea-state delay regardless of cyclone
    """
    vp = VESSEL_PROFILES.get(vessel_type, VESSEL_PROFILES["Container Ship"])
    cp = CARGO_PROFILES.get(cargo_type, CARGO_PROFILES["Containers"])
 
    speed_kn = vp["speed_kn"]
    voyage_hours = dist_nm / speed_kn  # estimated total voyage time
 
    reasons = []
    total_delay = 0.0
 
    # ── Cyclone component ────────────────────────────────────────────────────
    if cyclone_prob > 0.05 and storm_duration > 0:
        # When does ship reach the storm zone?
        # Approximate: storm zone is at midpoint of voyage
        hours_to_storm_zone = voyage_hours * 0.5
 
        # Can ship outrun the storm? (clear storm zone before storm arrives)
        can_outrun = hours_to_storm_zone < hours_until_storm
 
        if can_outrun:
            reasons.append(
                f"Cyclone ({int(cyclone_prob*100)}% probability) arrives in {hours_until_storm:.1f}h "
                f"but ship clears storm zone in ~{hours_to_storm_zone:.1f}h — no cyclone delay."
            )
        elif hours_until_storm >= voyage_hours:
            reasons.append(
                f"Cyclone arrives in {hours_until_storm:.1f}h, voyage completes in {voyage_hours:.1f}h "
                f"— ship docks before storm hits. No cyclone delay."
            )
        else:
            # Storm overlaps voyage window
            storm_start = max(0, hours_until_storm)
            storm_end   = storm_start + storm_duration
            voyage_end  = voyage_hours
 
            # Overlap = portion of voyage inside storm window
            overlap_start = max(storm_start, 0)
            overlap_end   = min(storm_end, voyage_end)
            overlap_hours = max(0, overlap_end - overlap_start)
            overlap_frac  = overlap_hours / max(voyage_hours, 1)
 
            # During storm: vessel slows to storm_speed_factor
            normal_speed  = speed_kn
            storm_speed   = speed_kn * vp["storm_speed_factor"]
            extra_time    = overlap_hours * (normal_speed / storm_speed - 1)
 
            # Scale by cyclone probability and cargo weather sensitivity
            storm_delay = extra_time * cyclone_prob * cp["weather_sens"]
 
            # Vessel weather limit check
            if wave_height > vp["weather_limit_wave"]:
                storm_delay *= 1.4
                reasons.append(
                    f"Wave height {wave_height}m exceeds vessel limit {vp['weather_limit_wave']}m "
                    f"— vessel must heave-to. Storm delay amplified."
                )
 
            total_delay += storm_delay
            reasons.append(
                f"Cyclone window ({hours_until_storm:.1f}h → {hours_until_storm+storm_duration:.1f}h) "
                f"overlaps voyage by {overlap_hours:.1f}h ({overlap_frac*100:.0f}% of transit). "
                f"Speed reduces to {storm_speed:.1f}kn during overlap → +{storm_delay:.1f}h delay."
            )
    elif cyclone_prob <= 0.05:
        reasons.append("Cyclone probability negligible (<5%) — no cyclone factor applied.")
 
    # ── Wave / sea-state component (independent of cyclone) ─────────────────
    if wave_height > 2.0:
        # Progressive scale: small penalty for moderate seas, large for heavy
        if wave_height <= 3.5:
            wave_delay = (wave_height - 2.0) * 0.4
            reasons.append(f"Moderate seas ({wave_height}m) — minor speed reduction → +{wave_delay:.1f}h.")
        elif wave_height <= 5.5:
            wave_delay = 0.6 + (wave_height - 3.5) * 1.2
            reasons.append(f"Rough seas ({wave_height}m) — significant speed reduction → +{wave_delay:.1f}h.")
        else:
            wave_delay = 2.7 + (wave_height - 5.5) * 2.5
            reasons.append(f"Very rough seas ({wave_height}m) — vessel operating at reduced capacity → +{wave_delay:.1f}h.")
        total_delay += wave_delay * cp["weather_sens"]
    else:
        reasons.append(f"Sea state calm ({wave_height}m) — no wave delay.")
 
    return round(total_delay, 1), reasons
 
 
def factor_congestion(dest_port_key, dest_cong_override, voyage_hours,
                      hours_until_storm, storm_duration, cargo_type):
    cp = CARGO_PROFILES.get(cargo_type, CARGO_PROFILES["Containers"])

    # Handle missing port key — fall back to a generic port profile
    if dest_port_key is not None and dest_port_key in PORTS:
        port = PORTS[dest_port_key]
    else:
        port = {
            "name": "Generic Port",
            "tide_sensitive": False,
            "customs_delay_avg": 3,
        }

    cong_pct = dest_cong_override if dest_cong_override > 0 else port.get("base_cong", 55)

    reasons = []
    total_delay = 0.0

    # ── Base berth wait ──────────────────────────────────────────────────────
    if cong_pct < 30:
        berth_wait = 0.2
    elif cong_pct < 50:
        berth_wait = 0.2 + (cong_pct - 30) * 0.04
    elif cong_pct < 70:
        berth_wait = 1.0 + (cong_pct - 50) * 0.15
    elif cong_pct < 85:
        berth_wait = 4.0 + (cong_pct - 70) * 0.35
    else:
        berth_wait = 9.25 + (cong_pct - 85) * 0.6

    reasons.append(
        f"Destination congestion {cong_pct}% → estimated berth wait {berth_wait:.1f}h."
    )
    total_delay += berth_wait

    # ── Storm-induced berth slot miss ────────────────────────────────────────
    if storm_duration > 0 and hours_until_storm < voyage_hours:
        slot_miss_hours = storm_duration % 6
        if slot_miss_hours > 0:
            extra_berth = slot_miss_hours * (cong_pct / 100) * 1.5
            total_delay += extra_berth
            reasons.append(
                f"Storm delay shifts arrival by {storm_duration:.0f}h → berth slot missed. "
                f"Next available slot adds +{extra_berth:.1f}h at {cong_pct}% congestion."
            )

    # ── Tide-sensitive port ──────────────────────────────────────────────────
    if port.get("tide_sensitive", False):
        tidal_wait = 1.5 + (cong_pct / 100) * 2.0
        total_delay += tidal_wait
        reasons.append(
            f"{port['name']} is tide-sensitive — tidal window constraint adds ~{tidal_wait:.1f}h."
        )

    # ── Customs / inspection delay ───────────────────────────────────────────
    customs_base = port.get("customs_delay_avg", 3)
    customs_extra = customs_base * cp["customs_risk"]
    if cp["hazmat"] > 0:
        customs_extra += cp["hazmat"] * 2.0
        reasons.append(
            f"Hazmat cargo (level {cp['hazmat']}) requires special inspection → "
            f"+{cp['hazmat']*2:.0f}h additional customs processing."
        )
    if customs_extra > 0.5:
        total_delay += customs_extra
        reasons.append(
            f"Customs inspection at {port['name']}: base {customs_base}h × "
            f"cargo risk {cp['customs_risk']} = +{customs_extra:.1f}h."
        )

    if cp["perishable"] > 0.5:
        reasons.append(
            f"⚠ Perishable cargo — {int(cp['perishable']*100)}% spoilage sensitivity. "
            f"Every hour of delay has compounding cargo value impact."
        )

    return round(total_delay, 1), reasons
 
 
def factor_coast_crossing(ok, dk, vessel_type):
    """
    Coast-crossing penalty:
    - West→East or East→West routes must round Sri Lanka (Cape Comorin)
    - Adds ~300nm, weather exposure through Palk Strait
    - Some vessel types handle this better than others
    """
    o_coast = PORTS[ok]["coast"]
    d_coast = PORTS[dk]["coast"]
 
    if o_coast == d_coast:
        return 0.0, [f"Same coast ({o_coast}) — no cape rounding required."]
 
    vp = VESSEL_PROFILES.get(vessel_type, VESSEL_PROFILES["Container Ship"])
    # Cape rounding adds ~300nm, at vessel speed
    extra_nm = 310
    extra_hours = extra_nm / vp["speed_kn"]
 
    # Palk Strait is shallow and has tidal currents
    palk_penalty = 1.5 if vp["maneuver"] == "low" else 0.5
 
    total = extra_hours + palk_penalty
    return round(total, 1), [
        f"Coast crossing ({o_coast} → {d_coast}) requires rounding Cape Comorin. "
        f"+{extra_nm}nm ({extra_hours:.1f}h at {vp['speed_kn']}kn) + "
        f"Palk Strait navigation penalty {palk_penalty:.1f}h."
    ]
 
 
def factor_carrier_reliability(reliability, voyage_hours):
    """
    Carrier reliability factor:
    - Models mechanical breakdown probability, schedule adherence history
    - Low reliability = higher chance of unplanned stops
    """
    if reliability >= 0.90:
        return 0.0, [f"Carrier reliability {reliability:.0%} — excellent. No reliability penalty."]
    elif reliability >= 0.75:
        penalty = (0.90 - reliability) * voyage_hours * 0.08
        return round(penalty, 1), [
            f"Carrier reliability {reliability:.0%} — moderate. "
            f"Historical schedule deviation risk adds +{penalty:.1f}h."
        ]
    elif reliability >= 0.55:
        penalty = 1.5 + (0.75 - reliability) * voyage_hours * 0.15
        return round(penalty, 1), [
            f"Carrier reliability {reliability:.0%} — below average. "
            f"Elevated risk of unplanned stops → +{penalty:.1f}h."
        ]
    else:
        penalty = 3.0 + (0.55 - reliability) * voyage_hours * 0.25
        return round(penalty, 1), [
            f"Carrier reliability {reliability:.0%} — poor. "
            f"High probability of mechanical or scheduling issues → +{penalty:.1f}h. "
            f"Consider alternate carrier."
        ]
 
 
def factor_origin_congestion(origin_cong, vessel_type):
    """
    Origin port departure delay:
    - High congestion at origin = delayed departure clearance
    """
    if origin_cong < 40:
        return 0.0, [f"Origin congestion {origin_cong}% — departure clearance fast."]
    elif origin_cong < 65:
        delay = (origin_cong - 40) * 0.04
        return round(delay, 1), [
            f"Origin congestion {origin_cong}% — moderate departure queue → +{delay:.1f}h clearance delay."
        ]
    else:
        delay = 1.0 + (origin_cong - 65) * 0.08
        return round(delay, 1), [
            f"Origin congestion {origin_cong}% — heavy departure backlog → +{delay:.1f}h. "
            f"Vessel may miss tide/slot window."
        ]
 
 
# ─────────────────────────────────────────────────────────────────────────────
# RISK SCORE COMPOSER
# Converts delay factors into a 0-100 risk score with proper weighting
# ─────────────────────────────────────────────────────────────────────────────
def compute_risk_score(delay_total, storm_delay, cong_delay, coast_delay,
                       reliability_delay, cyclone_prob, wave_height,
                       cargo_type, vessel_type, dest_cong):
    cp = CARGO_PROFILES.get(cargo_type, CARGO_PROFILES["Containers"])
    vp = VESSEL_PROFILES.get(vessel_type, VESSEL_PROFILES["Container Ship"])
 
    # Base risk from delay magnitude (0-50 points)
    delay_risk = min(50, delay_total * 1.2)
 
    # Storm severity risk (0-25 points)
    storm_risk = min(25, cyclone_prob * 20 + max(0, wave_height - 2) * 1.5)
 
    # Congestion risk (0-15 points)
    cong_risk = min(15, (dest_cong / 100) * 15)
 
    # Cargo sensitivity risk (0-10 points)
    cargo_risk = min(10, cp["risk_mult"] * 5 + cp["perishable"] * 3 + cp["hazmat"] * 2)
 
    total = delay_risk + storm_risk + cong_risk + cargo_risk
    return min(100, max(0, round(total)))
 
 
# ─────────────────────────────────────────────────────────────────────────────
# ROUTE SCORER
# Scores each route option on 4 dimensions
# ─────────────────────────────────────────────────────────────────────────────
def score_route(dist_nm, port_cong, cyclone_prob, wave_height,
                reliability, fuel_cost, vessel_type, cargo_type,
                cyc_factor=1.0, storm_hours_until=999, storm_dur=0):
    vp = VESSEL_PROFILES.get(vessel_type, VESSEL_PROFILES["Container Ship"])
    cp = CARGO_PROFILES.get(cargo_type, CARGO_PROFILES["Containers"])
 
    voyage_hours = dist_nm / vp["speed_kn"]
 
    # Delay score (lower delay = better)
    eff_cyclone = cyclone_prob * cyc_factor
    _, storm_reasons = factor_storm(eff_cyclone, wave_height, storm_hours_until,
                                    storm_dur, vessel_type, dist_nm, cargo_type)
    s_delay, _ = factor_storm(eff_cyclone, wave_height, storm_hours_until,
                              storm_dur, vessel_type, dist_nm, cargo_type)
    c_delay, _ = factor_congestion(None, port_cong, voyage_hours, storm_hours_until, storm_dur, cargo_type)
    total_delay = s_delay + c_delay
    delay_score = max(0, 1 - total_delay / 30)
 
    # Cost score (lower dist * fuel = better)
    cost_score = max(0, 1 - (dist_nm * fuel_cost * 0.0001) / 3)
 
    # Congestion score
    cong_score = 1 - port_cong / 100
 
    # Safety score
    safety_score = max(0, 1 - eff_cyclone * cp["weather_sens"])
 
    return (0.40 * delay_score + 0.30 * cost_score
            + 0.20 * cong_score + 0.10 * safety_score)
 
 
# ─────────────────────────────────────────────────────────────────────────────
# ROUTE DETAIL BUILDER
# ─────────────────────────────────────────────────────────────────────────────
def build_route_details(body, delay_direct, risk_score, best_route, alt_port_key):
    ok       = body.get("origin_port", "JNPT")
    dk       = body.get("destination_port", "CHENNAI")
    fuel_idx = float(body.get("fuel_cost", 88))
    cyclone  = float(body.get("cyclone_probability", 0.1))
    wave     = float(body.get("wave_height", 2.0))
    rel      = float(body.get("carrier_reliability", 0.8))
    dest_cong = float(body.get("destination_congestion", 55))
    vessel   = body.get("vessel_type", "Container Ship")
    cargo    = body.get("cargo_type", "Containers")
    h_storm  = float(body.get("hours_until_storm", 999))
    dur_storm = float(body.get("storm_duration_hours", 0))
 
    dist_a, dist_b, dist_c, wp_key, _ = route_distances(ok, dk)
    wp_cong  = PORTS[wp_key]["base_cong"]
    alt_cong = PORTS[alt_port_key]["base_cong"]
    vp = VESSEL_PROFILES.get(vessel, VESSEL_PROFILES["Container Ship"])
 
    def total_delay_for(dist, cong_key, cong_val, cyc_factor=1.0):
        voyage_h = dist / vp["speed_kn"]
        s, _ = factor_storm(cyclone * cyc_factor, wave, h_storm, dur_storm, vessel, dist, cargo)
        c, _ = factor_congestion(cong_key, cong_val, voyage_h, h_storm, dur_storm, cargo)
        r, _ = factor_carrier_reliability(rel, voyage_h)
        return round(s + c + r, 1)
 
    def fuel_inr(dist):
        return round(dist * fuel_idx * 850 / 1000)
 
    delay_a = delay_direct
    delay_b = total_delay_for(dist_b, wp_key, wp_cong, 0.7)
    delay_c = total_delay_for(dist_c, alt_port_key, alt_cong, 0.8)
 
    cost_a, cost_b, cost_c = fuel_inr(dist_a), fuel_inr(dist_b), fuel_inr(dist_c)
 
    routes = {
        "A": {
            "id": "A", "label": "Direct Route",
            "waypoints": [ok, dk],
            "waypoint_coords": [
                {"key": ok, **{k: PORTS[ok][k] for k in ["name","lat","lng"]}},
                {"key": dk, **{k: PORTS[dk][k] for k in ["name","lat","lng"]}},
            ],
            "distance_nm": round(dist_a),
            "delay_hours": delay_a,
            "fuel_cost_inr": cost_a,
            "congestion_pct": round(dest_cong),
            "extra_cost_inr": 0,
            "recommended": best_route == "A",
        },
        "B": {
            "id": "B", "label": f"Via {PORTS[wp_key]['name']}",
            "waypoints": [ok, wp_key, dk],
            "waypoint_coords": [
                {"key": ok,     **{k: PORTS[ok][k]     for k in ["name","lat","lng"]}},
                {"key": wp_key, **{k: PORTS[wp_key][k] for k in ["name","lat","lng"]}},
                {"key": dk,     **{k: PORTS[dk][k]     for k in ["name","lat","lng"]}},
            ],
            "distance_nm": round(dist_b),
            "delay_hours": delay_b,
            "fuel_cost_inr": cost_b,
            "congestion_pct": round(wp_cong),
            "extra_cost_inr": max(0, cost_b - cost_a),
            "recommended": best_route == "B",
        },
        "C": {
            "id": "C", "label": f"Port Shift → {PORTS[alt_port_key]['name']}",
            "waypoints": [ok, alt_port_key],
            "waypoint_coords": [
                {"key": ok,          **{k: PORTS[ok][k]          for k in ["name","lat","lng"]}},
                {"key": alt_port_key,**{k: PORTS[alt_port_key][k] for k in ["name","lat","lng"]}},
            ],
            "distance_nm": round(dist_c),
            "delay_hours": delay_c,
            "fuel_cost_inr": cost_c,
            "congestion_pct": round(alt_cong),
            "extra_cost_inr": max(0, cost_c - cost_a),
            "recommended": best_route == "C",
            "alt_port_name": PORTS[alt_port_key]["name"],
            "alt_port_state": PORTS[alt_port_key]["state"],
        },
    }
 
    best_delay  = routes[best_route]["delay_hours"]
    time_saved  = round(max(0, delay_a - best_delay), 1)
 
    return {
        "routes": routes,
        "best_route_id": best_route,
        "time_saved_hours": time_saved,
        "recommendation_action": (
            "SHIFT PORT" if best_route == "C" else
            "REROUTE"    if best_route == "B" else
            "ON TRACK"
        ),
    }
 
 
# ─────────────────────────────────────────────────────────────────────────────
# MAIN PREDICT FUNCTION
# ─────────────────────────────────────────────────────────────────────────────
def run_prediction(body):
    ok     = body["origin_port"]
    dk     = body["destination_port"]
    vessel = body.get("vessel_type", "Container Ship")
    cargo  = body.get("cargo_type", "Containers")
 
    wave        = float(body.get("wave_height", 2.0))
    wind        = float(body.get("wind_speed", 15))
    cyclone     = float(body.get("cyclone_probability", 0.1))
    origin_cong = float(body.get("origin_congestion", 50))
    dest_cong   = float(body.get("destination_congestion", 55))
    fuel_cost   = float(body.get("fuel_cost", 88))
    reliability = float(body.get("carrier_reliability", 0.8))
 
    # New temporal storm fields — these make storm reasoning accurate
    hours_until_storm  = float(body.get("hours_until_storm", 999))   # 999 = no storm incoming
    storm_duration     = float(body.get("storm_duration_hours", 0))
 
    dist_a, dist_b, dist_c, wp_key, alt_key = route_distances(ok, dk)
    vp = VESSEL_PROFILES.get(vessel, VESSEL_PROFILES["Container Ship"])
    voyage_hours = dist_a / vp["speed_kn"]
 
    # ── Run all delay factors ────────────────────────────────────────────────
    all_reasons = []
 
    storm_delay, storm_reasons = factor_storm(
        cyclone, wave, hours_until_storm, storm_duration,
        vessel, dist_a, cargo
    )
    all_reasons.extend(storm_reasons)
 
    cong_delay, cong_reasons = factor_congestion(
        dk, dest_cong, voyage_hours,
        hours_until_storm, storm_duration, cargo
    )
    all_reasons.extend(cong_reasons)
 
    coast_delay, coast_reasons = factor_coast_crossing(ok, dk, vessel)
    all_reasons.extend(coast_reasons)
 
    rel_delay, rel_reasons = factor_carrier_reliability(reliability, voyage_hours)
    all_reasons.extend(rel_reasons)
 
    origin_delay, origin_reasons = factor_origin_congestion(origin_cong, vessel)
    all_reasons.extend(origin_reasons)
 
    total_delay = round(storm_delay + cong_delay + coast_delay + rel_delay + origin_delay, 1)
 
    # ── Risk score ───────────────────────────────────────────────────────────
    risk_score = compute_risk_score(
        total_delay, storm_delay, cong_delay, coast_delay, rel_delay,
        cyclone, wave, cargo, vessel, dest_cong
    )
    risk_tier = (
        "CRITICAL" if risk_score >= 76 else
        "HIGH"     if risk_score >= 51 else
        "MEDIUM"   if risk_score >= 26 else "LOW"
    )
 
    # ── Route selection ──────────────────────────────────────────────────────
    wp_cong  = PORTS[wp_key]["base_cong"]
    alt_cong = PORTS[alt_key]["base_cong"]
 
    sc_a = score_route(dist_a, dest_cong, cyclone, wave, reliability, fuel_cost, vessel, cargo,
                       1.0, hours_until_storm, storm_duration)
    sc_b = score_route(dist_b, wp_cong,   cyclone, wave, reliability, fuel_cost, vessel, cargo,
                       0.7, hours_until_storm, storm_duration)
    sc_c = score_route(dist_c, alt_cong,  cyclone, wave, reliability, fuel_cost, vessel, cargo,
                       0.8, hours_until_storm, storm_duration)
 
    if sc_a >= sc_b and sc_a >= sc_c:
        best_route = "A"
        route_confidence = round((sc_a / (sc_a + sc_b + sc_c)) * 100, 1)
    elif sc_b >= sc_c:
        best_route = "B"
        route_confidence = round((sc_b / (sc_a + sc_b + sc_c)) * 100, 1)
    else:
        best_route = "C"
        route_confidence = round((sc_c / (sc_a + sc_b + sc_c)) * 100, 1)
 
    # ── Build narrative situation ────────────────────────────────────────────
    storm_flag = cyclone > 0.5 or wave > 5.0 or (hours_until_storm < voyage_hours and storm_duration > 0)
 
    # Find top 2 delay contributors for narrative
    factor_map = {
        "storm/weather": storm_delay,
        "destination congestion": cong_delay,
        "coast crossing": coast_delay,
        "carrier reliability": rel_delay,
        "origin congestion": origin_delay,
    }
    top_factors = sorted(factor_map.items(), key=lambda x: x[1], reverse=True)[:2]
    top_str = " and ".join([f"{k} (+{v}h)" for k, v in top_factors if v > 0])
 
    if storm_flag and hours_until_storm < voyage_hours:
        situation = (
            f"Storm window detected: cyclone {int(cyclone*100)}% probability, "
            f"arriving in {hours_until_storm:.1f}h, duration {storm_duration:.0f}h. "
            f"Voyage time {voyage_hours:.1f}h — storm overlaps transit. "
            f"Total predicted delay: +{total_delay}h."
        )
        rec_action = (
            f"Initiate reroute assessment. Route {best_route} scores best "
            f"({route_confidence:.0f}% confidence). "
            f"Storm delay component: +{storm_delay}h."
        )
    elif risk_score >= 76:
        situation = (
            f"Critical risk score {risk_score}/100. Primary drivers: {top_str}. "
            f"Destination {PORTS[dk]['name']} at {dest_cong}% congestion. "
            f"Total delay: +{total_delay}h."
        )
        rec_action = "Escalate to port authority. Revise ETA for all stakeholders immediately."
    elif risk_score >= 51:
        situation = (
            f"Elevated risk {risk_score}/100. Delay drivers: {top_str}. "
            f"Route {best_route} recommended with {route_confidence:.0f}% confidence."
        )
        rec_action = f"Monitor closely. {'Reroute via ' + PORTS[wp_key]['name'] if best_route == 'B' else 'Consider port shift' if best_route == 'C' else 'Maintain course'}."
    elif best_route != "A":
        situation = (
            f"Conditions within normal range (risk {risk_score}/100) but Route {best_route} "
            f"outperforms direct route. Delay: +{total_delay}h — primarily {top_str}."
        )
        rec_action = f"Optimise route: shift to Route {best_route} to reduce delay by {round(total_delay - build_route_details(body, total_delay, risk_score, best_route, alt_key)['routes'][best_route]['delay_hours'], 1)}h."
    else:
        situation = (
            f"Shipment tracking normally. Risk score {risk_score}/100 ({risk_tier}). "
            f"{'No significant delay factors active.' if total_delay < 2 else f'Minor delay: +{total_delay}h from {top_str}.'}"
        )
        rec_action = "Continue monitoring. No immediate action required."
 
    reasoning = " | ".join(all_reasons[:4])  # top 4 factors for panel display
 
    # ── Route details with coords ────────────────────────────────────────────
    route_details = build_route_details(body, total_delay, risk_score, best_route, alt_key)
 
    return {
        "success": True,
        "predicted_delay_hours":  total_delay,
        "risk_score":             risk_score,
        "risk_tier":              risk_tier,
        "best_route":             best_route,
        "route_confidence_pct":   route_confidence,
        "alternate_port_key":     alt_key,
        "alternate_port_name":    PORTS[alt_key]["name"],
        "alternate_port_state":   PORTS[alt_key]["state"],
        "alternate_port_coords":  {"lat": PORTS[alt_key]["lat"], "lng": PORTS[alt_key]["lng"]},
        "storm_flag":             storm_flag,
        "situation":              situation,
        "recommended_action":     rec_action,
        "reasoning":              reasoning,
        "recommendation_action":  route_details["recommendation_action"],
        "delay_breakdown": {
            "storm_weather":     storm_delay,
            "destination_cong":  cong_delay,
            "coast_crossing":    coast_delay,
            "carrier_reliability": rel_delay,
            "origin_congestion": origin_delay,
        },
        "reasoning_chain":        all_reasons,   # full chain for debug/display
        "routes":                 route_details["routes"],
        "best_route_id":          route_details["best_route_id"],
        "time_saved_hours":       route_details["time_saved_hours"],
        "origin_coords":   {"lat": PORTS[ok]["lat"], "lng": PORTS[ok]["lng"], "name": PORTS[ok]["name"]},
        "dest_coords":     {"lat": PORTS[dk]["lat"], "lng": PORTS[dk]["lng"], "name": PORTS[dk]["name"]},
        "model": {
            "framework":        "Deterministic reasoning engine v4",
            "factors":          ["storm_trajectory", "congestion_compounding", "coast_crossing",
                                 "carrier_reliability", "cargo_sensitivity", "tidal_windows",
                                 "customs_inspection", "berth_slot_miss"],
            "delay_mae_hours":  "N/A (deterministic)",
            "route_accuracy":   "Score-based optimisation",
            "trained_on":       "Domain-encoded Indian maritime rules",
        }
    }
 
 
# ─────────────────────────────────────────────────────────────────────────────
# FLASK ROUTES
# ─────────────────────────────────────────────────────────────────────────────
 
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "reasoning-v4", "models_loaded": ["reasoning_engine"]})
 
 
@app.route("/model-info", methods=["GET"])
def model_info():
    return jsonify({
        "engine": "Deterministic Reasoning Engine v4",
        "factors": {
            "storm_trajectory":       "Computes storm/voyage window intersection, not just probability",
            "congestion_compounding": "Models berth slot miss when storm delays arrival",
            "coast_crossing":         "Cape Comorin rounding penalty for coast changes",
            "carrier_reliability":    "Probabilistic breakdown/schedule risk",
            "cargo_sensitivity":      "Per-cargo weather sensitivity, perishability, hazmat",
            "tidal_windows":          "Tide-sensitive port arrival constraints",
            "customs_inspection":     "Port + cargo type customs delay model",
            "berth_slot_miss":        "Storm-induced arrival shift vs berth schedule",
        },
        "new_optional_inputs": {
            "hours_until_storm":     "Hours until storm front reaches route (default 999 = none)",
            "storm_duration_hours":  "Duration of storm window in hours (default 0)",
        },
        "ports": {k: v["name"] for k, v in PORTS.items()},
        "cargo_types": list(CARGO_PROFILES.keys()),
        "vessel_types": list(VESSEL_PROFILES.keys()),
    })
 
 
@app.route("/predict", methods=["POST"])
def predict():
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"error": "Invalid JSON"}), 400
 
    ok = body.get("origin_port")
    dk = body.get("destination_port")
    if not ok or not dk:
        return jsonify({"error": "origin_port and destination_port are required"}), 400
    if ok not in PORTS:
        return jsonify({"error": f"Unknown origin_port: {ok}. Valid: {PORT_KEYS}"}), 400
    if dk not in PORTS:
        return jsonify({"error": f"Unknown destination_port: {dk}. Valid: {PORT_KEYS}"}), 400
    if ok == dk:
        return jsonify({"error": "origin and destination must differ"}), 400
 
    result = run_prediction(body)
    return jsonify(result)
 
 
# ─────────────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*60)
    print("  NAUTICAL.OS — Reasoning Engine v4")
    print("  Storm trajectory · Congestion compounding · Tidal windows")
    print("  Cargo sensitivity · Coast crossing · Berth slot miss")
    print("="*60 + "\n")
    print("🚀  Flask listening on http://localhost:5001\n")
    app.run(host="0.0.0.0", port=5001, debug=False)