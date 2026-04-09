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

module.exports = { getAllShipments, getTodayShipments, getShipment };