/**
 * NAUTICAL.OS — GPS Route
 * POST /api/v1/gps/:deviceId
 *
 * Called every 10 seconds by the vessel's GPS device.
 * Responsibilities:
 *  1. Update latest_weather lat/lng
 *  2. Fetch live weather from Open-Meteo
 *  3. Append weather_snapshots (rolling 10)
 *  4. Check all PENDING checkpoints — mark reached if within threshold
 *  5. Check all PENDING checkpoints — mark missed if ETA has passed
 *  6. Recalculate route_progress
 *  7. Auto-set status to in_transit on first GPS ping
 */

const express  = require("express");
const router   = express.Router();
const Shipment = require("../models/Shipment");
const { isNearCheckpoint, calculateRouteProgress } = require("../utils/routePlanner");

const CHECKPOINT_THRESHOLD_KM = 50;   // radius to mark a checkpoint as reached
const MISSED_GRACE_MINUTES    = 60;   // how many minutes past ETA before marking missed

// ─── Helper: fetch weather from Open-Meteo ────────────────────────────────────
async function fetchOpenMeteoWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=wind_speed_10m,precipitation,temperature_2m` +
      `&wind_speed_unit=kmh`;

    const res  = await fetch(url);
    const data = await res.json();
    const c    = data.current || {};

    const wind_speed_kmh = c.wind_speed_10m   ?? 0;
    const precipitation  = c.precipitation    ?? 0;
    const storm_flag     = wind_speed_kmh > 60 || precipitation > 10;

    return { wind_speed_kmh, precipitation, storm_flag };
  } catch (err) {
    console.error("Open-Meteo fetch failed:", err.message);
    return { wind_speed_kmh: 0, precipitation: 0, storm_flag: false };
  }
}

// ─── POST /api/v1/gps/:deviceId ───────────────────────────────────────────────
router.post("/:deviceId", async (req, res) => {
  try {
    const { deviceId }  = req.params;
    const { lat, lng }  = req.body;

    // Validate payload
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: "lat and lng are required" });
    }
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    if (isNaN(numLat) || isNaN(numLng)) {
      return res.status(400).json({ success: false, message: "lat and lng must be numbers" });
    }

    // Find shipment by GPS device ID
    const shipment = await Shipment.findOne({ gps_device_id: deviceId });
    if (!shipment) {
      return res.status(404).json({ success: false, message: `No shipment found for device: ${deviceId}` });
    }

    const now = new Date();

    // ── 1. Fetch live weather ─────────────────────────────────────────────────
    const weather = await fetchOpenMeteoWeather(numLat, numLng);

    // ── 2. Update latest_weather ──────────────────────────────────────────────
    shipment.latest_weather = {
      lat:            numLat,
      lng:            numLng,
      wind_speed_kmh: weather.wind_speed_kmh,
      storm_flag:     weather.storm_flag,
    };

    // ── 3. Append weather_snapshots (rolling window of 10) ────────────────────
    const snapshot = {
      timestamp:      now,
      lat:            numLat,
      lng:            numLng,
      wind_speed_kmh: weather.wind_speed_kmh,
      precipitation:  weather.precipitation,
      storm_flag:     weather.storm_flag,
    };

    if (shipment.weather_snapshots.length >= 10) {
      shipment.weather_snapshots.shift();
    }
    shipment.weather_snapshots.push(snapshot);

    // ── 4. Auto-transition to in_transit on first GPS ping ────────────────────
    if (shipment.status === "registered" || shipment.status === "at_port") {
      shipment.status = "in_transit";
    }

    // ── 5. Checkpoint logic (only if route was planned) ───────────────────────
    if (shipment.checkpoints && shipment.checkpoints.length > 0) {

      for (let i = 0; i < shipment.checkpoints.length; i++) {
        const cp = shipment.checkpoints[i];

        if (cp.status !== "pending") continue; // skip already-resolved

        // Check REACHED: vessel within threshold radius
        if (isNearCheckpoint(numLat, numLng, cp, CHECKPOINT_THRESHOLD_KM)) {
          shipment.checkpoints[i].status         = "reached";
          shipment.checkpoints[i].actual_arrival = now;
          console.log(`✅ Checkpoint "${cp.name}" reached by ${deviceId}`);
          continue;
        }

        // Check MISSED: ETA has passed by grace period AND vessel never got close
        if (cp.expected_arrival) {
          const minsOverdue = (now - new Date(cp.expected_arrival)) / 60000;
          if (minsOverdue > MISSED_GRACE_MINUTES) {
            shipment.checkpoints[i].status = "missed";
            console.log(`❌ Checkpoint "${cp.name}" missed by ${deviceId} (${Math.round(minsOverdue)}min overdue)`);
          }
        }
      }

      // ── 6. Recalculate route_progress ───────────────────────────────────────
      const progress = calculateRouteProgress(shipment.checkpoints);
      shipment.route_progress = progress;
    }

    // ── 7. Mark shipment as arrived if all checkpoints reached + near dest ────
    // (Optional guard — port staff can also manually mark arrived)
    const allDone = shipment.checkpoints.length > 0 &&
      shipment.checkpoints.every(cp => cp.status === "reached" || cp.status === "missed");
    if (allDone && shipment.status === "in_transit") {
      // Don't auto-arrive — leave that to port staff, but flag it
      console.log(`🏁 All checkpoints resolved for ${deviceId} — awaiting port arrival confirmation`);
    }

    await shipment.save();

    return res.status(200).json({
      success:        true,
      message:        "GPS position updated",
      latest_weather: shipment.latest_weather,
      route_progress: shipment.route_progress,
      checkpoints_summary: shipment.checkpoints.map(cp => ({
        name:   cp.name,
        status: cp.status,
      })),
    });

  } catch (err) {
    console.error("GPS update error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;