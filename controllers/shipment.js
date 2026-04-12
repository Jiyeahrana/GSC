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

module.exports = { getAllShipments, getTodayShipments, getShipment, createShipment };