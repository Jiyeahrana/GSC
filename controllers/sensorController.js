const db       = require("../config/firebase");
const Shipment = require("../models/shipment");

// ── Helper: get current container count for a zone ───────────────────────────

async function getZoneCount(portId, zoneId) {
    const snapshot = await db
        .ref(`sensor_readings/${portId}/${zoneId}/container_count`)
        .once("value");
    return snapshot.val() || 0;
}

// ── POST /api/v1/sensors/entry ────────────────────────────────────────────────

const entryTrigger = async (req, res) => {
    try {
        const { port_id, zone_id } = req.body;

        if (!port_id || !zone_id) {
            return res.status(400).json({ success: false, message: "port_id and zone_id are required" });
        }

        const currentCount = await getZoneCount(port_id, zone_id);
        const newCount = currentCount + 1;

        await db.ref(`sensor_readings/${port_id}/${zone_id}`).update({
            container_count: newCount,
            last_updated:    Date.now(),
            last_event:      "entry"
        });

        return res.status(200).json({
            success: true,
            message: "Entry recorded",
            data: { port_id, zone_id, container_count: newCount, event: "entry" }
        });

    } catch (err) {
        console.error("Entry trigger error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── POST /api/v1/sensors/exit ─────────────────────────────────────────────────

const exitTrigger = async (req, res) => {
    try {
        const { port_id, zone_id } = req.body;

        if (!port_id || !zone_id) {
            return res.status(400).json({ success: false, message: "port_id and zone_id are required" });
        }

        const currentCount = await getZoneCount(port_id, zone_id);

        if (currentCount <= 0) {
            return res.status(400).json({ success: false, message: "Container count is already 0, cannot subtract" });
        }

        const newCount = currentCount - 1;

        await db.ref(`sensor_readings/${port_id}/${zone_id}`).update({
            container_count: newCount,
            last_updated:    Date.now(),
            last_event:      "exit"
        });

        return res.status(200).json({
            success: true,
            message: "Exit recorded",
            data: { port_id, zone_id, container_count: newCount, event: "exit" }
        });

    } catch (err) {
        console.error("Exit trigger error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── GET /api/v1/sensors/:port_id ──────────────────────────────────────────────

const getPortSensorData = async (req, res) => {
    try {
        const { port_id } = req.params;

        const snapshot = await db.ref(`sensor_readings/${port_id}`).once("value");
        const data = snapshot.val();

        if (!data) {
            return res.status(404).json({ success: false, message: "No sensor data found for this port" });
        }

        return res.status(200).json({ success: true, data });

    } catch (err) {
        console.error("Get sensor data error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ── POST /api/v1/sensors/gps ──────────────────────────────────────────────────

const gpsPush = async (req, res) => {
    try {
        const { gps_device_id, lat, lng, wind_speed_kmh, storm_flag } = req.body;

        if (!gps_device_id || lat == null || lng == null) {
            return res.status(400).json({ success: false, message: "gps_device_id, lat and lng are required" });
        }

        const shipments = await Shipment.find({ gps_device_id });
        if (!shipments.length) {
            return res.status(404).json({ success: false, message: "No shipment found for this GPS device" });
        }

        const now = new Date();

        for (const shipment of shipments) {
            shipment.latest_weather = {
                lat,
                lng,
                wind_speed_kmh: wind_speed_kmh || 0,
                storm_flag:     storm_flag     || false
            };

            shipment.weather_snapshots.push({
                timestamp:      now,
                lat,
                lng,
                wind_speed_kmh: wind_speed_kmh || 0,
                precipitation:  0,
                storm_flag:     storm_flag     || false
            });

            if (shipment.weather_snapshots.length > 10) {
                shipment.weather_snapshots.shift();
            }

            await shipment.save();
        }

        return res.status(200).json({
            success: true,
            message: `GPS location updated for ${shipments.length} shipment(s)`,
            data: { gps_device_id, lat, lng }
        });

    } catch (err) {
        console.error("GPS push error:", err);
        return res.status(500).json({ success: false, message: err.message });
    }
};

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { entryTrigger, exitTrigger, getPortSensorData, gpsPush };