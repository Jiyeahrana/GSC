const db = require("../config/firebase");

// ── Helper: get current container count for a zone ───────────────────────────

async function getZoneCount(portId, zoneId) {
    const snapshot = await db
        .ref(`sensor_readings/${portId}/${zoneId}/container_count`)
        .once("value");
    return snapshot.val() || 0;
}

// ── POST /api/v1/sensors/entry ────────────────────────────────────────────────
// Called when entry gate IR sensor is triggered — adds one container

const entryTrigger = async (req, res) => {
    try {
        const { port_id, zone_id } = req.body;

        if (!port_id || !zone_id) {
            return res.status(400).json({
                success: false,
                message: "port_id and zone_id are required"
            });
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
            data: {
                port_id,
                zone_id,
                container_count: newCount,
                event: "entry"
            }
        });

    } catch (err) {
        console.error("Entry trigger error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// ── POST /api/v1/sensors/exit ─────────────────────────────────────────────────
// Called when exit gate IR sensor is triggered — subtracts one container

const exitTrigger = async (req, res) => {
    try {
        const { port_id, zone_id } = req.body;

        if (!port_id || !zone_id) {
            return res.status(400).json({
                success: false,
                message: "port_id and zone_id are required"
            });
        }

        const currentCount = await getZoneCount(port_id, zone_id);

        // Prevent going below 0
        if (currentCount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Container count is already 0, cannot subtract"
            });
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
            data: {
                port_id,
                zone_id,
                container_count: newCount,
                event: "exit"
            }
        });

    } catch (err) {
        console.error("Exit trigger error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// ── GET /api/v1/sensors/:port_id ──────────────────────────────────────────────
// Returns live count for all zones of a port

const getPortSensorData = async (req, res) => {
    try {
        const { port_id } = req.params;

        const snapshot = await db
            .ref(`sensor_readings/${port_id}`)
            .once("value");

        const data = snapshot.val();

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "No sensor data found for this port"
            });
        }

        return res.status(200).json({
            success: true,
            data
        });

    } catch (err) {
        console.error("Get sensor data error:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

module.exports = { entryTrigger, exitTrigger, getPortSensorData };