const Shipment = require("../models/shipment");

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

        if (vessel)   {
            shipment.vessel.name            = vessel.name            || shipment.vessel.name;
            shipment.vessel.capacity        = vessel.capacity        || shipment.vessel.capacity;
            shipment.vessel.container_count = vessel.container_count || shipment.vessel.container_count;
        }
        if (cargo)    {
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

        // Group by date string "YYYY-MM-DD"
        const grouped = {};

        shipments.forEach(s => {
            const arrDate = new Date(s.schedule.arrival);
            const depDate = new Date(s.schedule.departure);

            const arrKey = `${arrDate.getFullYear()}-${String(arrDate.getMonth()+1).padStart(2,"0")}-${String(arrDate.getDate()).padStart(2,"0")}`;
            const depKey = `${depDate.getFullYear()}-${String(depDate.getMonth()+1).padStart(2,"0")}-${String(depDate.getDate()).padStart(2,"0")}`;

            // Add to arrival date
            if (!grouped[arrKey]) grouped[arrKey] = [];
            grouped[arrKey].push({
                _id:          s._id,
                vessel_name:  s.vessel.name,
                type:         s.type,
                status:       s.status,
                arrival:      s.schedule.arrival,
                departure:    s.schedule.departure,
                event:        "arrival"
            });

            // Add to departure date only if different from arrival
            if (depKey !== arrKey) {
                if (!grouped[depKey]) grouped[depKey] = [];
                grouped[depKey].push({
                    _id:          s._id,
                    vessel_name:  s.vessel.name,
                    type:         s.type,
                    status:       s.status,
                    arrival:      s.schedule.arrival,
                    departure:    s.schedule.departure,
                    event:        "departure"
                });
            }
        });

        return res.status(200).json({
            success: true,
            year,
            month,
            data: grouped
        });

    } catch (err) {
        console.error("Calendar shipments error:", err);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

const getShipmentDetail = async (req, res) => {
    try {
        const shipment = await Shipment.findOne({
            _id: req.params.id,
            port_id: req.user.port_id
        });

        if (!shipment) {
            return res.status(404).json({ success: false, message: "Shipment not found" });
        }

        // Calculate progress % based on schedule
        const now        = new Date();
        const start      = new Date(shipment.schedule.arrival);
        const end        = new Date(shipment.schedule.departure);
        const totalMs    = end - start;
        const elapsedMs  = now - start;
        const progress   = totalMs > 0
            ? Math.min(Math.max(Math.round((elapsedMs / totalMs) * 100), 0), 100)
            : 0;

        // Days remaining
        const daysLeft = Math.max(Math.ceil((end - now) / (1000 * 60 * 60 * 24)), 0);

        // Latest weather snapshot
        const latest = shipment.weather_snapshots?.at(-1) || null;

        return res.status(200).json({
            success: true,
            data: {
                _id:            shipment._id,
                vessel:         shipment.vessel,
                cargo:          shipment.cargo,
                type:           shipment.type,
                status:         shipment.status,
                schedule:       shipment.schedule,
                actual:         shipment.actual,
                gps_device_id:  shipment.gps_device_id,
                sender_name:    shipment.sender_name,
                sender_email:   shipment.sender_email,
                weather_snapshots: shipment.weather_snapshots,
                latest_weather: latest,
                progress,
                days_remaining: daysLeft
            }
        });

    } catch (error) {
        console.error("Shipment detail error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getAllShipments, getTodayShipments, getShipment, createShipment,deleteShipment,updateShipment, getCalendarShipments,getShipmentDetail };