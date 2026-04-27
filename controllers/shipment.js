const Shipment = require("../models/shipment");
const {
    generatePlannedRoute,
    calculateRouteProgress,
    resolvePortCoords
} = require("../utils/routePlanner");

// ── attachPlannedRoute ────────────────────────────────────────────────────────
// Calls generatePlannedRoute with port name strings + schedule dates,
// then persists planned_route, checkpoints, and route_progress on the shipment.

// Normalize a user-entered port name to the "City, India" format
// that routePlanner's PORT_COORDS keys use.
function normalizePortName(name) {
    if (!name) return name;
    const trimmed = name.trim();
    // Already has a country suffix — leave as-is
    if (trimmed.includes(",")) return trimmed;
    // Append India so routePlanner's partial match and getCoast() both work correctly
    return `${trimmed}, India`;
}

function attachPlannedRoute(shipment) {
    try {
        const originName = normalizePortName(shipment.cargo.origin);
        const destName   = normalizePortName(shipment.cargo.destination);

        // Validate that routePlanner knows both ports before doing anything
        const originCoords = resolvePortCoords(originName);
        const destCoords   = resolvePortCoords(destName);

        if (!originCoords || !destCoords) {
            console.warn(
                `[attachPlannedRoute] Unknown port(s) — "${originName}" or "${destName}" ` +
                `not in routePlanner's port list. Skipping route attachment for ${shipment._id}.`
            );
            return;
        }

        // generatePlannedRoute(originName, destName, departureTime, arrivalTime, numCheckpoints)
        // returns { planned_route: [{lat,lng}], checkpoints: [...] }
        const { planned_route, checkpoints } = generatePlannedRoute(
            originName,
            destName,
            shipment.schedule.departure,   // departureTime
            shipment.schedule.arrival,     // arrivalTime
            5                              // numCheckpoints
        );

        // Build initial route_progress from the fresh checkpoints
        const route_progress = calculateRouteProgress(checkpoints);

        // Persist
        shipment.planned_route  = planned_route;
        shipment.checkpoints    = checkpoints;
        shipment.route_progress = route_progress;

        shipment.save()
            .then(() => console.log(
                `[attachPlannedRoute] ✅ Route attached — ` +
                `${planned_route.length} waypoints, ${checkpoints.length} checkpoints ` +
                `for shipment ${shipment._id}`
            ))
            .catch(err => console.error("[attachPlannedRoute] Save error:", err.message));

    } catch (err) {
        // Non-fatal — log and continue so shipment creation still succeeds
        console.error("[attachPlannedRoute] Error:", err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller functions
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Compute checkpoint statuses based on GPS position + time
// Called on every getShipmentDetail request — no cron job needed
// ─────────────────────────────────────────────────────────────────────────────
function computeCheckpointStatuses(shipment) {
    if (!shipment.checkpoints?.length) return shipment;

    const now     = new Date();
    const livePos = shipment.latest_weather;
    let changed   = false;

    shipment.checkpoints = shipment.checkpoints.map(cp => {
        // Never downgrade a reached checkpoint
        if (cp.status === "reached") return cp;

        // Mark missed: expected time has passed, still pending, AND we have GPS proof
        // the vessel has moved past it. Without live GPS we cannot confirm the ship
        // has actually passed the checkpoint, so we leave it pending.
        if (
            cp.status === "pending" &&
            cp.expected_arrival &&
            new Date(cp.expected_arrival) < now &&
            livePos?.lat && livePos?.lng           // ← require live GPS to ever mark missed
        ) {
            // Give benefit of doubt if vessel is still nearby (within 50 km)
            if (cp.position?.lat && cp.position?.lng) {
                const dist = haversineKmBackend(
                    livePos.lat, livePos.lng,
                    cp.position.lat, cp.position.lng
                );
                if (dist < 50) return cp;
            }
            changed = true;
            return { ...cp.toObject(), status: "missed" };
        }

        // Mark reached: vessel is within 30km of checkpoint and time is close
        if (cp.status === "pending" && livePos?.lat && livePos?.lng && cp.position?.lat && cp.position?.lng) {
            const dist = haversineKmBackend(
                livePos.lat, livePos.lng,
                cp.position.lat, cp.position.lng
            );
            if (dist < 30) {
                changed = true;
                return {
                    ...cp.toObject(),
                    status: "reached",
                    actual_arrival: cp.actual_arrival || now
                };
            }
        }

        return cp;
    });

    // Update route_progress counters
    const reached = shipment.checkpoints.filter(c => c.status === "reached").length;
    const total   = shipment.checkpoints.length;
    const next    = shipment.checkpoints.find(c => c.status === "pending");

    shipment.route_progress = {
        ...shipment.route_progress,
        checkpoints_reached:  reached,
        total_checkpoints:    total,
        next_checkpoint_name: next?.name || "Destination",
        last_updated:         now,
    };

    return { shipment, changed };
}

function haversineKmBackend(lat1, lon1, lat2, lon2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 +
                 Math.cos(lat1 * Math.PI/180) *
                 Math.cos(lat2 * Math.PI/180) *
                 Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Get all shipments
const getAllShipments = async (req, res) => {
    try {
        const shipments = await Shipment.find({ port_id: req.user.port_id });
        res.status(200).json({ success: true, count: shipments.length, data: shipments });
    } catch (error) {
        console.log("error: ", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get all shipments of today
const getTodayShipments = async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const shipments = await Shipment.find({
            port_id: req.user.port_id,
            $or: [
                { "schedule.arrival":   { $gte: startOfDay, $lte: endOfDay } },
                { "schedule.departure": { $gte: startOfDay, $lte: endOfDay } }
            ]
        });

        res.status(200).json({ success: true, count: shipments.length, data: shipments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get a particular shipment
const getShipment = async (req, res) => {
    try {
        const shipment = await Shipment.findOne({
            _id: req.params.id,
            port_id: req.user.port_id
        });

        if (!shipment) {
            return res.status(404).json({ success: false, message: "Shipment not found" });
        }

        res.status(200).json({ success: true, data: shipment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create a new shipment
const createShipment = async (req, res) => {
    try {
        const {
            vessel,
            cargo,
            schedule,
            type,
            status,
            gps_device_id,
            sender_name,
            sender_email
        } = req.body;

        // ── Validate ──────────────────────────────────────────────────────────

        if (!vessel?.name || !vessel?.capacity) {
            return res.status(400).json({
                success: false,
                message: "Vessel name and capacity are required"
            });
        }
        if (!vessel?.name || !vessel?.capacity || !vessel?.container_count) {
            return res.status(400).json({
                success: false,
                message: "Vessel name, capacity and container count are required"
            });
        }
        if (!cargo?.origin || !cargo?.destination) {
            return res.status(400).json({
                success: false,
                message: "Cargo origin and destination are required"
            });
        }
        if (!schedule?.arrival || !schedule?.departure) {
            return res.status(400).json({
                success: false,
                message: "Arrival and departure dates are required"
            });
        }
        if (new Date(schedule.arrival) >= new Date(schedule.departure)) {
            return res.status(400).json({
                success: false,
                message: "Arrival date must be before departure date"
            });
        }
        if (!gps_device_id) {
            return res.status(400).json({
                success: false,
                message: "GPS device ID is required"
            });
        }
        if (!sender_name || !sender_email) {
            return res.status(400).json({
                success: false,
                message: "Sender name and email are required"
            });
        }

        // ── Create ────────────────────────────────────────────────────────────

        const shipment = await Shipment.create({
            port_id:  req.user.port_id,
            type,
            status:   status || "registered",
            vessel: {
                name:            vessel.name,
                capacity:        vessel.capacity,
                container_count: vessel.container_count
            },
            cargo: {
                origin:      cargo.origin,
                destination: cargo.destination
            },
            schedule: {
                arrival:   new Date(schedule.arrival),
                departure: new Date(schedule.departure)
            },
            actual: {
                arrival:   null,
                departure: null
            },
            gps_device_id,
            sender_name,
            sender_email,
            weather_snapshots: []
        });

        // ── Attach planned route (geocodes ports + builds checkpoints) ─────────
        await attachPlannedRoute(shipment);

        return res.status(201).json({
            success: true,
            message: "Shipment created successfully",
            data:    shipment
        });

    } catch (error) {
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({
                success: false,
                message: messages.join(", ")
            });
        }

        console.error("Create shipment error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

const deleteShipment = async (req, res) => {
    try {
        const shipment = await Shipment.findOneAndDelete({
            _id: req.params.id,
            port_id: req.user.port_id
        });
        if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found" });
        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const updateShipment = async (req, res) => {
    try {
        const shipment = await Shipment.findOne({
            _id: req.params.id,
            port_id: req.user.port_id
        });

        if (!shipment) {
            return res.status(404).json({ success: false, message: "Shipment not found" });
        }

        const {
            vessel, cargo, schedule, type,
            status, gps_device_id, sender_name, sender_email
        } = req.body;

        if (vessel) {
            shipment.vessel.name            = vessel.name            || shipment.vessel.name;
            shipment.vessel.capacity        = vessel.capacity        || shipment.vessel.capacity;
            shipment.vessel.container_count = vessel.container_count || shipment.vessel.container_count;
        }
        if (cargo) {
            shipment.cargo.origin      = cargo.origin      || shipment.cargo.origin;
            shipment.cargo.destination = cargo.destination || shipment.cargo.destination;
        }
        if (schedule) {
            if (schedule.arrival)   shipment.schedule.arrival   = new Date(schedule.arrival);
            if (schedule.departure) shipment.schedule.departure = new Date(schedule.departure);
        }
        if (type)          shipment.type          = type;
        if (status)        shipment.status        = status;
        if (gps_device_id) shipment.gps_device_id = gps_device_id;
        if (sender_name)   shipment.sender_name   = sender_name;
        if (sender_email)  shipment.sender_email  = sender_email;

        if (shipment.schedule.arrival >= shipment.schedule.departure) {
            return res.status(400).json({
                success: false,
                message: "Arrival date must be before departure date"
            });
        }

        await shipment.save();

        return res.status(200).json({
            success: true,
            message: "Shipment updated successfully",
            data: shipment
        });

    } catch (error) {
        console.error("Update shipment error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/v1/shipments/calendar?year=2026&month=4
const getCalendarShipments = async (req, res) => {
    try {
        const year  = parseInt(req.query.year)  || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;

        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth   = new Date(year, month, 0, 23, 59, 59, 999);

        const shipments = await Shipment.find({
            port_id: req.user.port_id,
            $or: [
                { "schedule.arrival":   { $gte: startOfMonth, $lte: endOfMonth } },
                { "schedule.departure": { $gte: startOfMonth, $lte: endOfMonth } }
            ]
        }, "vessel.name type status schedule.arrival schedule.departure");

        const grouped = {};

        shipments.forEach(s => {
            const arrDate = new Date(s.schedule.arrival);
            const depDate = new Date(s.schedule.departure);

            const arrKey = `${arrDate.getFullYear()}-${String(arrDate.getMonth()+1).padStart(2,"0")}-${String(arrDate.getDate()).padStart(2,"0")}`;
            const depKey = `${depDate.getFullYear()}-${String(depDate.getMonth()+1).padStart(2,"0")}-${String(depDate.getDate()).padStart(2,"0")}`;

            if (!grouped[arrKey]) grouped[arrKey] = [];
            grouped[arrKey].push({
                _id:         s._id,
                vessel_name: s.vessel.name,
                type:        s.type,
                status:      s.status,
                arrival:     s.schedule.arrival,
                departure:   s.schedule.departure,
                event:       "arrival"
            });

            if (depKey !== arrKey) {
                if (!grouped[depKey]) grouped[depKey] = [];
                grouped[depKey].push({
                    _id:         s._id,
                    vessel_name: s.vessel.name,
                    type:        s.type,
                    status:      s.status,
                    arrival:     s.schedule.arrival,
                    departure:   s.schedule.departure,
                    event:       "departure"
                });
            }
        });

        return res.status(200).json({ success: true, year, month, data: grouped });

    } catch (err) {
        console.error("Calendar shipments error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};
const getShipmentDetail = async (req, res) => {
    try {
        // 1. Fetch shipment first
        const shipment = await Shipment.findOne({
            _id:     req.params.id,
            port_id: req.user.port_id
        });

        if (!shipment) {
            return res.status(404).json({ success: false, message: "Shipment not found" });
        }

        // 2. Compute checkpoint statuses on every fetch
        const result = computeCheckpointStatuses(shipment);
        const s      = result.shipment;
        const changed = result.changed;

        if (changed) {
            await Shipment.updateOne(
                { _id: s._id },
                {
                    $set: {
                        checkpoints:    s.checkpoints,
                        route_progress: s.route_progress,
                    }
                }
            );
        }

        // 3. Compute progress and days remaining
        const now      = new Date();
        const start    = new Date(s.schedule.arrival);
        const end      = new Date(s.schedule.departure);
        const totalMs  = end - start;
        const elapsed  = now - start;
        const progress = totalMs > 0
            ? Math.min(Math.max(Math.round((elapsed / totalMs) * 100), 0), 100)
            : 0;

        const daysLeft = Math.max(Math.ceil((end - now) / (1000 * 60 * 60 * 24)), 0);
        const latest   = s.latest_weather || s.weather_snapshots?.at(-1) || null;

        return res.status(200).json({
            success: true,
            data: {
                _id:               s._id,
                vessel:            s.vessel,
                cargo:             s.cargo,
                type:              s.type,
                status:            s.status,
                schedule:          s.schedule,
                actual:            s.actual,
                gps_device_id:     s.gps_device_id,
                sender_name:       s.sender_name,
                sender_email:      s.sender_email,
                weather_snapshots: s.weather_snapshots,
                latest_weather:    latest,
                planned_route:     s.planned_route,
                checkpoints:       s.checkpoints,
                route_progress:    s.route_progress,
                progress,
                days_remaining:    daysLeft
            }
        });

    } catch (error) {
        console.error("Shipment detail error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// REPLACE everything from the PORT_COORDS line down to the end of
// syncShipmentStatuses in controllers/shipment.js
// ─────────────────────────────────────────────────────────────────────────────

// Known port coordinates — used to check if vessel is actually near destination
const KNOWN_PORT_COORDS = {
    "mumbai":        { lat: 18.9322, lng: 72.8375 },
    "jnpt":          { lat: 18.9480, lng: 72.9500 },
    "nhava sheva":   { lat: 18.9480, lng: 72.9500 },
    "kochi":         { lat: 9.9312,  lng: 76.2673 },
    "cochin":        { lat: 9.9312,  lng: 76.2673 },
    "goa":           { lat: 15.4909, lng: 73.8278 },
    "mangalore":     { lat: 12.8703, lng: 74.8423 },
    "chennai":       { lat: 13.0827, lng: 80.2707 },
    "madras":        { lat: 13.0827, lng: 80.2707 },
    "vizag":         { lat: 17.6868, lng: 83.2185 },
    "visakhapatnam": { lat: 17.6868, lng: 83.2185 },
    "kolkata":       { lat: 22.5726, lng: 88.3639 },
    "haldia":        { lat: 22.0667, lng: 88.0833 },
    "paradip":       { lat: 20.3167, lng: 86.6167 },
    "kandla":        { lat: 23.0333, lng: 70.2167 },
    "mundra":        { lat: 22.8390, lng: 69.7183 },
    "tuticorin":     { lat: 8.7642,  lng: 78.1348 },
    "thoothukudi":   { lat: 8.7642,  lng: 78.1348 },
    "kozhikode":     { lat: 11.2588, lng: 75.7804 },
    "calicut":       { lat: 11.2588, lng: 75.7804 },
    "ennore":        { lat: 13.2827, lng: 80.3311 },
    "kamarajar":     { lat: 13.2827, lng: 80.3311 },
    "pipavav":       { lat: 20.9167, lng: 71.5167 },
    "hazira":        { lat: 21.1167, lng: 72.6500 },
    "mormugao":      { lat: 15.4139, lng: 73.7993 },
};

// How close (km) the vessel must be to the destination port to count as arrived
const ARRIVAL_RADIUS_KM = 15;

// Resolve a port name string → { lat, lng } or null
function resolveDestCoords(portName) {
    if (!portName) return null;
    const key = portName.toLowerCase().split(",")[0].trim();
    for (const [port, coords] of Object.entries(KNOWN_PORT_COORDS)) {
        if (key.includes(port) || port.includes(key)) return coords;
    }
    return null;
}

// Haversine distance in km
function distanceKm(lat1, lng1, lat2, lng2) {
    const R    = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                 Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calculate real GPS-based progress (0–100) between origin and destination
function calcGpsProgress(shipment, livePos) {
    const originCoords = resolveDestCoords(shipment.cargo.origin);
    const destCoords   = resolveDestCoords(shipment.cargo.destination);

    if (!originCoords || !destCoords || !livePos?.lat || !livePos?.lng) {
        // Fall back to time-based progress if we can't do GPS math
        const now      = Date.now();
        const start    = new Date(shipment.schedule.arrival).getTime();
        const end      = new Date(shipment.schedule.departure).getTime();
        const totalMs  = end - start;
        const elapsed  = now - start;
        return totalMs > 0
            ? Math.min(Math.max(Math.round((elapsed / totalMs) * 100), 0), 100)
            : 0;
    }

    const totalKm   = distanceKm(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng);
    const coveredKm = distanceKm(originCoords.lat, originCoords.lng, livePos.lat, livePos.lng);

    // Clamp: covered can never exceed total (e.g. GPS noise past destination)
    return Math.min(Math.max(Math.round((coveredKm / totalKm) * 100), 0), 100);
}

const syncShipmentStatuses = async (req, res) => {
    try {
        const shipments = await Shipment.find({ port_id: req.user.port_id });
        const now       = new Date();
        let   updated   = 0;

        for (const s of shipments) {
            const latest      = s.latest_weather || s.weather_snapshots?.at(-1);
            const arrival     = new Date(s.schedule.arrival);
            const depart      = new Date(s.schedule.departure);

            // Resolve THIS shipment's actual destination coords (not a hardcoded port)
            const destCoords  = resolveDestCoords(s.cargo.destination);
            const originCoords = resolveDestCoords(s.cargo.origin);

            let newStatus = s.status;

            if (latest?.lat != null && latest?.lng != null) {
                // ── We have live GPS — use it ─────────────────────────────────

                const distToDest   = destCoords
                    ? distanceKm(latest.lat, latest.lng, destCoords.lat, destCoords.lng)
                    : Infinity;

                const distToOrigin = originCoords
                    ? distanceKm(latest.lat, latest.lng, originCoords.lat, originCoords.lng)
                    : Infinity;

                if (distToDest <= ARRIVAL_RADIUS_KM) {
                    // Ship is physically near the DESTINATION port
                    newStatus = now > depart ? "departed" : "at_port";

                } else if (distToOrigin <= ARRIVAL_RADIUS_KM && now < arrival) {
                    // Ship is still at the ORIGIN port, hasn't left yet
                    newStatus = "registered";

                } else if (now < arrival) {
                    // Scheduled arrival hasn't happened yet — still registered
                    newStatus = "registered";

                } else if (now > depart) {
                    // Past departure date but NOT near destination = delayed, not arrived
                    // Only mark "arrived" if GPS confirms it's at the destination
                    newStatus = "delayed";

                } else {
                    // Within the arrival→departure window and moving
                    newStatus = "in_transit";
                }

            } else {
                // ── No GPS data — fall back to schedule dates only ────────────
                // Never auto-mark "arrived" without GPS confirmation
                if      (now < arrival) newStatus = "registered";
                else if (now > depart)  newStatus = "delayed";   // was: "arrived" — FIXED
                else                    newStatus = "in_transit";
            }

            // Compute checkpoint statuses based on current GPS + time
            const { shipment: withCPs, changed } = computeCheckpointStatuses(s);
            if (changed) {
                s.checkpoints    = withCPs.checkpoints;
                s.route_progress = withCPs.route_progress;
            }

            // Save if status changed or checkpoints were updated
            if (newStatus !== s.status || changed) {
                s.status = newStatus;
                if (newStatus === "at_port"  && !s.actual?.arrival)   s.actual.arrival   = now;
                if (newStatus === "departed" && !s.actual?.departure)  s.actual.departure = now;
                await s.save();
                updated++;
                console.log(`[syncStatuses] ${s.vessel.name} → ${newStatus} (was ${s.status})`);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Updated ${updated} shipment statuses`
        });

    } catch (error) {
        console.error("Sync statuses error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAllShipments,
    getTodayShipments,
    getShipment,
    createShipment,
    deleteShipment,
    updateShipment,
    getCalendarShipments,
    getShipmentDetail,
    syncShipmentStatuses,
    attachPlannedRoute      // exported so the router or other utils can call it
};